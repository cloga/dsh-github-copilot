import type { Agent } from '@deepseek-ai/dsh-agent'
import BasicCompactionEngine from '@deepseek-ai/dsh-compaction-basic'
import type { ContentBlock, Message, TokenUsage, ToolSchema } from '@deepseek-ai/dsh-llm'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { CommandId } from '@deepseek-ai/dsh-commands/brand'
import type { CompactionResult } from '@deepseek-ai/dsh-compaction'
import { GITHUB_COPILOT_PREVIEW_PROVIDER_ID } from './copilot-identity.ts'
import { calculateRequestBudget, resolveRequestBudgetPolicy } from './request-budget.ts'
import type {} from './preview-route.ts'

interface RecoveryMessage {
  readonly role: string
  readonly content: readonly { readonly type: string; readonly id?: string }[]
  readonly toolCallId?: string
}

interface RecoveryInput<M> {
  readonly messages: readonly M[]
  readonly tools?: readonly ToolSchema[]
}

interface RecoveryResult {
  readonly summary: ContentBlock[]
  readonly provider: string
  readonly model: string
  readonly maxTokens?: number
  readonly usage?: TokenUsage
}

interface RecoveryOptions<M extends RecoveryMessage, R extends RecoveryResult> {
  readonly input: RecoveryInput<M>
  readonly inputLimit: number
  readonly maxCalls?: number
  readonly signal: AbortSignal
  readonly estimate: (input: RecoveryInput<M>) => number
  readonly summarize: (input: RecoveryInput<M>) => Promise<R>
  readonly makeCheckpoint: (summary: readonly ContentBlock[]) => M
  readonly assertCurrent?: () => void
}

function recoverError(code: string): Error {
  return new Error(`COPILOT_MANUAL_RECOVERY_${code}`)
}

function sumUsage(usages: readonly TokenUsage[]): TokenUsage {
  const required = (key: 'inputTokens' | 'outputTokens') => usages.reduce((sum, usage) => sum + usage[key], 0)
  const optional = (key: 'totalTokens' | 'cacheReadTokens' | 'cacheWriteTokens' | 'reasoningTokens') =>
    usages.every(usage => usage[key] !== undefined)
      ? { [key]: usages.reduce((sum, usage) => sum + usage[key]!, 0) }
      : {}
  return {
    inputTokens: required('inputTokens'), outputTokens: required('outputTokens'),
    ...optional('totalTokens'), ...optional('cacheReadTokens'), ...optional('cacheWriteTokens'),
    ...optional('reasoningTokens'),
  }
}

/**
 * Bounded, explicit manual-only map/fold. The native engine still owns the only
 * durable transaction, source-stability check, shrink check and cancellation.
 */
export async function summarizeOversizedManualInput<M extends RecoveryMessage, R extends RecoveryResult>(
  options: RecoveryOptions<M, R>,
): Promise<RecoveryResult> {
  const { input, signal, estimate, summarize, makeCheckpoint, assertCurrent } = options
  const maxCalls = options.maxCalls ?? 16
  if (!Number.isSafeInteger(maxCalls) || maxCalls < 2 || maxCalls > 32
    || !Number.isSafeInteger(options.inputLimit) || options.inputLimit <= 0) throw recoverError('INVALID_POLICY')
  const prefix = input.messages[0]?.role === 'system' ? input.messages.slice(0, 1) : []
  const messages = input.messages.slice(prefix.length)
  if (messages.length === 0) throw recoverError('NO_HISTORY')
  const pending = new Set<string>()
  const safeBoundaries = new Set<number>([0])
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index]!
    if (message.role === 'assistant') {
      for (const block of message.content) {
        if (block.type === 'tool-call') {
          if (!block.id || pending.has(block.id)) throw recoverError('UNBALANCED')
          pending.add(block.id)
        }
      }
    }
    if (message.role === 'tool') {
      if (!message.toolCallId || !pending.delete(message.toolCallId)) throw recoverError('UNBALANCED')
    }
    if (pending.size === 0) safeBoundaries.add(index + 1)
  }
  if (pending.size !== 0) throw recoverError('UNBALANCED')

  let previous: RecoveryResult | undefined
  let offset = 0
  let calls = 0
  const usages: TokenUsage[] = []
  while (offset < messages.length) {
    signal.throwIfAborted()
    assertCurrent?.()
    const carry = previous === undefined ? [] : [makeCheckpoint(previous.summary)]
    const head = [...prefix, ...carry]
    if (estimate({ tools: input.tools, messages: head }) >= options.inputLimit) throw recoverError('FIXED_PREFIX')
    let end = offset
    for (let index = offset + 1; index <= messages.length; index++) {
      if (estimate({ tools: input.tools, messages: [...head, ...messages.slice(offset, index)] }) > options.inputLimit) break
      if (safeBoundaries.has(index)) end = index
    }
    if (end === offset) throw recoverError('INDIVISIBLE')
    if (++calls > maxCalls) throw recoverError('CALL_LIMIT')
    const result = await summarize({ tools: input.tools, messages: [...head, ...messages.slice(offset, end)] })
    signal.throwIfAborted()
    assertCurrent?.()
    if (previous !== undefined && (result.provider !== previous.provider || result.model !== previous.model
      || result.maxTokens !== previous.maxTokens)) throw recoverError('ROUTE_CHANGED')
    if (result.summary.length === 0 || result.summary.some(block => block.type !== 'text')
      || !result.summary.some(block => block.type === 'text' && block.text.trim())) {
      throw recoverError('EMPTY_SUMMARY')
    }
    if (result.usage !== undefined) usages.push(result.usage)
    previous = result
    offset = end
  }
  if (previous === undefined) throw recoverError('NO_HISTORY')
  // An unmarked result is deliberately NOT one llm.stream call. Core records
  // the aggregate usage only when every underlying call supplied real usage.
  return {
    summary: [...previous.summary], provider: previous.provider, model: previous.model,
    ...previous.maxTokens === undefined ? {} : { maxTokens: previous.maxTokens },
    ...usages.length === calls ? { usage: sumUsage(usages) } : {},
  }
}

/**
 * Deployment-selected alternative to stock BasicCompactionEngine. Do not
 * mount both: Cordis compaction is a singleton, not an overridable service.
 */
export class CopilotManualRecoveryCompactionEngine extends BasicCompactionEngine {
  private readonly manual = new WeakMap<Agent, number>()

  override async compactNow(agent: Agent, signal: AbortSignal, sourceCommandId?: CommandId): Promise<CompactionResult | null> {
    this.manual.set(agent, (this.manual.get(agent) ?? 0) + 1)
    try {
      return await super.compactNow(agent, signal, sourceCommandId)
    } finally {
      const remaining = this.manual.get(agent)! - 1
      if (remaining === 0) this.manual.delete(agent)
      else this.manual.set(agent, remaining)
    }
  }

  protected override async summarize(
    input: RecoveryInput<Message>,
    agent: Agent,
    signal?: AbortSignal,
  ) {
    const routed = agent.session.requestHeader()?.config
    const policy = this.config.modelPolicies.find(item => item.provider === routed?.provider && item.model === routed.model)
    const configuredProvider = policy?.summarizationProvider ?? this.config.summarizationProvider
    const configuredModel = policy?.summarizationModel ?? this.config.summarizationModel
    const selected = configuredProvider.length > 0 ? { provider: configuredProvider, model: configuredModel }
      : routed?.provider && routed.model ? routed
        : { provider: agent.options.provider, model: agent.options.model }
    const summaryProvider = selected.provider
    const summaryModel = selected.model
    if (!this.manual.has(agent) || summaryProvider !== GITHUB_COPILOT_PREVIEW_PROVIDER_ID || !summaryModel) {
      return super.summarize(input, agent, signal)
    }
    const preview = this.ctx.get('githubCopilotPreview')
    const lease = preview?.recoveryLimits(summaryModel)
    if (lease === undefined) throw recoverError('ACCOUNT_PROOF_UNAVAILABLE')
    const maxTokens = policy?.maxTokens ?? this.config.maxTokens
    const budget = calculateRequestBudget(lease.limits, maxTokens, resolveRequestBudgetPolicy(lease.policy))
    if (!budget.ok) throw recoverError(budget.code)
    // Reserve space for the Core-added summary directive and estimator
    // variance. The provider's final native guard remains authoritative.
    const toolHistoryBytes = Buffer.byteLength(JSON.stringify(agent.session.toolHistory()), 'utf8')
    const inputLimit = budget.budget.hardInputLimit - 4096 - toolHistoryBytes
    if (inputLimit <= 0) throw recoverError('FIXED_PREFIX')
    const operationSignal = signal ?? new AbortController().signal
    const estimate = (candidate: RecoveryInput<Message>): number =>
      Buffer.byteLength(JSON.stringify(candidate), 'utf8')
    if (estimate(input) <= inputLimit) return super.summarize(input, agent, signal)
    return summarizeOversizedManualInput({
      input, inputLimit, signal: operationSignal, estimate,
      assertCurrent: lease.assertCurrent,
      makeCheckpoint: summary => createUserMessage({
        source: { kind: 'user' },
        content: [
          { type: 'text', text: 'Prior intermediate checkpoint (merge with newer context):\n<compacted-summary>' },
          ...summary,
          { type: 'text', text: '</compacted-summary>' },
        ],
      }),
      summarize: candidate => super.summarize(candidate, agent, signal),
    })
  }
}

export default CopilotManualRecoveryCompactionEngine
