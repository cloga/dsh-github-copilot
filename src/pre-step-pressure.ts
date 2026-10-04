import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import { agentCompaction } from './agent-compaction.ts'
import type { CopilotCompactionPressureCallbacks } from './compaction-pressure.ts'
import { GITHUB_COPILOT_PREVIEW_PROVIDER_ID } from './copilot-identity.ts'
import { isPluginPreviewProvider } from './model-protocol.ts'

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function positive(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}
interface Engine {
  readonly config: Record<string, unknown>
  compactIfNeeded(agent: Agent, trigger: 'context-overflow', signal: AbortSignal): Promise<unknown>
}
function isEngine(value: unknown): value is Engine {
  return record(value) && record(value.config) && typeof value.compactIfNeeded === 'function'
}

/**
 * Prevent a continuing, unchanged route's known pressure from becoming an
 * unsampled model attempt. Final converted-request admission stays independent.
 */
export function installCopilotPreStepPressure(ctx: Context, callbacks: CopilotCompactionPressureCallbacks): () => void {
  let warned = false
  const unavailable = () => {
    if (warned) return
    warned = true
    ctx.logger.warn('COPILOT_PRE_STEP_PRESSURE_UNAVAILABLE: pre-step evidence is unavailable; retaining final request admission.')
  }
  return ctx.on('agent/pre-step', async ({ agent, step, signal }, next) => {
    const decision = await next()
    if (decision.kind !== 'enter' || signal.aborted || step <= 1
      || decision.messages.some(message => message.source?.kind === 'model-selection')) return decision
    let engine: Engine | undefined
    try {
      const header = agent.session.requestHeader()
      if (header?.config.provider !== GITHUB_COPILOT_PREVIEW_PROVIDER_ID
        || !isPluginPreviewProvider(ctx, header.config.provider)) return decision
      const projections: unknown = ctx.get('sessionProjections')
      if (!record(projections) || typeof projections.stateOf !== 'function') {
        unavailable()
        return decision
      }
      const selection: unknown = projections.stateOf(agent.session, 'modelSelection')
      if (!record(selection) || !Object.hasOwn(selection, 'pending')) {
        unavailable()
        return decision
      }
      if (selection.pending !== null) return decision
      const budget = callbacks.resolve({ ...header.config, messages: [], sessionId: agent.session.id } satisfies GenerateOptions)
      if (budget === undefined || !positive(budget.inputBudgetTokens)) return decision
      const candidate = agentCompaction(agent)
      if (!isEngine(candidate)) {
        unavailable()
        return decision
      }
      const config = candidate.config
      if (config.auto === false) return decision
      if (config.auto !== true) {
        unavailable()
        return decision
      }
      const policy = Array.isArray(config.modelPolicies)
        ? config.modelPolicies.find((value: unknown) => record(value)
          && value.provider === header.config.provider && value.model === header.config.model) : undefined
      const retries = record(policy) ? policy.maxOverflowRetries ?? config.maxOverflowRetries : config.maxOverflowRetries
      if (retries === 0) return decision
      if (!positive(retries)) { unavailable(); return decision }
      const meter: unknown = ctx.get('tokenMeter')
      if (!record(meter) || typeof meter.measure !== 'function') { unavailable(); return decision }
      const measured: unknown = meter.measure(agent.session)
      if (!record(measured) || typeof measured.totalTokens !== 'number'
        || !Number.isSafeInteger(measured.totalTokens) || measured.totalTokens < 0) {
        unavailable()
        return decision
      }
      if (measured.totalTokens <= budget.inputBudgetTokens) return decision
      engine = candidate
    } catch {
      unavailable()
      return decision
    }
    signal.throwIfAborted()
    // One native transaction, not request-error retries. Native failures remain failures.
    await engine.compactIfNeeded(agent, 'context-overflow', signal)
    signal.throwIfAborted()
    return decision
  }, { prepend: true })
}
