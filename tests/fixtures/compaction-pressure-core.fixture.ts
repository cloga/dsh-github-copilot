/**
 * Exact tagged-source integration: real AgentLoop, LLM runtime, token
 * meter and unmodified BasicCompactionEngine. Only the external model and
 * authenticated account snapshot are synthetic. This exercises durable
 * in-memory Session events, not disk persistence, OAuth or live model transport.
 * The existing runner owns source identity/aliases; no private Core imports,
 * fabricated history, prototype changes or replacement compaction implementation.
 */
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { SessionController } from '@deepseek-ai/dsh-api-session-controller'
import BasicCompactionEngine from '@deepseek-ai/dsh-compaction-basic'
import Commands from '@deepseek-ai/dsh-commands'
import LocalJobs from '@deepseek-ai/dsh-jobs-local'
import LlmRuntime, { LlmAdapter, LlmError, ToolCallId, createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk, TokenUsage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId, SessionLogOffset, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import { deriveTurnTokenUsage } from '@deepseek-ai/dsh-token-meter/client'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import * as PiEstimate from '@earendil-works/pi-ai/utils/estimate'
import '@earendil-works/pi-ai/api/openai-responses'
import { sessionFormatCatalog } from '@deepseek-ai/dsh-session-format-catalog'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { installCopilotCompactionPressure } from '../../src/compaction-pressure.ts'
import { installCopilotPreStepPressure } from '../../src/pre-step-pressure.ts'
import { installAutoModelRouting } from '../../src/auto-model-host.ts'
import { estimateTurnInputTokens } from '../../src/auto-model-routing.ts'
import { installSessionContinuation } from '../../src/session-continuation-host.ts'
import CopilotManualRecoveryCompactionEngine from '../../src/manual-compaction-recovery.ts'
import previewPlugin from '../../src/preview-route.ts'
import { installCompactionReplay } from '../../src/compaction-replay.ts'
import type { CompactionReplayRecovery } from '../../src/compaction-replay.ts'
import type { AccountModelDescriptor } from '../../src/account-model-catalog.ts'
import {
  GITHUB_COPILOT_AUTO_MODEL_ID as autoModel, GITHUB_COPILOT_PREVIEW_PROVIDER_ID as provider,
  GITHUB_COPILOT_CREDENTIAL_KEY,
} from '../../src/copilot-identity.ts'

const contextWindow = 100_000
const oldSentinel = 'OLD_HISTORY_SENTINEL'
const currentSentinel = 'CURRENT_REQUEST_SENTINEL'
const checkpoint = 'RECOVERY_CHECKPOINT'
const contexts: Context[] = []
const expectedSessionFormatVersion = process.env.DSH_PUBLISHED_CORE_RELEASE?.startsWith('0.2.0-') ? 4 : 3
type SummaryMode = 'stop' | 'max-tokens' | 'await-abort' | 'reject-overflow' | 'slow'

vi.mock('@earendil-works/pi-ai/utils/estimate', async importOriginal => {
  const actual = await importOriginal<typeof PiEstimate>()
  return { ...actual, estimateContextTokens: vi.fn(actual.estimateContextTokens) }
})

interface RequestObservation {
  readonly provider: string
  readonly model: string
  readonly text: string
  readonly maxTokens: number | undefined
}

function autoCandidate(id: string): AccountModelDescriptor {
  return {
    id,
    name: id,
    api: 'openai-responses',
    contextWindow,
    maxTokens: 8192,
    input: ['text'],
    reasoning: { advertisedEfforts: ['low', 'medium', 'high'], unmappedEfforts: [] },
    evidence: {
      endpoints: ['/responses'],
      unsupportedEndpointCount: 0,
      selectedEndpoint: '/responses',
      apiSource: 'advertised-native',
      policySource: 'server-enabled',
      contextWindowSource: 'max_context_window_tokens',
    },
  }
}

function requestText(options: GenerateOptions): string {
  return options.messages.flatMap(message => message.content.flatMap(block => block.type === 'text' ? [block.text] : [])).join('\n')
}

function observeRequest(options: GenerateOptions): RequestObservation {
  return { provider: options.provider, model: options.model, text: requestText(options), maxTokens: options.maxTokens }
}

/** Model double at the public adapter seam; every compaction decision remains Core-owned. */
class FixtureAdapter extends LlmAdapter {
  firstSummaryFailure?: string
  onSummary?: () => void
  nextUsage?: TokenUsage
  defaultUsage?: TokenUsage
  nextTool = false
  readonly conversation: RequestObservation[] = []
  readonly summaries: RequestObservation[] = []
  readonly summaryStarted = Promise.withResolvers<void>()
  continuation?: ReturnType<typeof installSessionContinuation>
  readonly continued: unknown[] = []
  compactionReplay?: CompactionReplayRecovery

  constructor(readonly summaryMode: SummaryMode) { super() }

  override async resolveModel(route: string, model: string): Promise<LlmResolvedModelInfo> {
    return { provider: route, id: model, name: model, context: { contextWindow }, defaultMaxTokens: 8192 }
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const summary = options.purpose === 'compaction'
    if (summary) {
      if (this.compactionReplay || this.continuation) {
        const payload = { input: [
          { type: 'reasoning', encrypted_content: 'synthetic-old-replay', summary: [] },
          { type: 'message', role: 'user', content: requestText(options) },
        ] }
        const transform = this.compactionReplay?.prepare(options) ?? this.continuation?.prepare(options)
        const dispatched = transform ? await transform(payload) : payload
        if (JSON.stringify(dispatched).includes('synthetic-old-replay'))
          throw new LlmError('COPILOT_RESPONSES_REPLAY_SCOPE_MISMATCH: synthetic scope rejection', 'INVALID_REQUEST')
      }
      this.onSummary?.()
      this.summaries.push(observeRequest(options))
      this.summaryStarted.resolve()
      if (this.summaries.length === 1 && this.firstSummaryFailure) {
        throw new LlmError('Synthetic summary failure', this.firstSummaryFailure)
      }
      if (this.summaryMode === 'slow') {
        await new Promise<void>(resolve => {
          const timer = setTimeout(resolve, 360_000)
          options.signal?.addEventListener('abort', () => { clearTimeout(timer); resolve() }, { once: true })
        })
      }
      if (this.summaryMode === 'reject-overflow' && Buffer.byteLength(JSON.stringify({
        messages: options.messages, tools: options.tools,
      }), 'utf8') > 12000) throw new Error('COPILOT_REQUEST_INPUT_LIMIT_EXCEEDED')
      if (this.summaryMode === 'await-abort') {
        const signal = options.signal
        if (signal === undefined) throw new Error('fixture summary requires the Core cancellation signal')
        if (!signal.aborted) {
          await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }))
        }
      }
    } else {
      const transform = this.continuation?.prepare(options)
      if (transform) this.continued.push(await transform({ input: [
        { type: 'reasoning', encrypted_content: 'x'.repeat(17 * 1024 * 1024), summary: [] },
        { type: 'message', content: requestText(options) },
      ] }))
      this.conversation.push(observeRequest(options))
    }
    if (options.signal?.aborted) {
      yield { type: 'finish', reason: { kind: 'aborted', failure: { code: 'ABORTED', message: 'fixture cancelled' } } }
      return
    }
    const text = summary ? (this.summaryMode === 'max-tokens' ? 'PARTIAL_CHECKPOINT' : checkpoint) : 'CONVERSATION_REPLY'
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    const usage = this.nextUsage ?? this.defaultUsage
    if (!summary && usage !== undefined) {
      yield { type: 'usage', usage }
      this.nextUsage = undefined
    }
    if (!summary && this.nextTool) {
      this.nextTool = false
      yield { type: 'block-start', index: 1, blockType: 'tool-call' }
      yield { type: 'block-end', index: 1, block: {
        type: 'tool-call', id: ToolCallId('pre-step-tool'), name: 'pressure_fixture_tool', arguments: '{}',
      } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    yield { type: 'finish', reason: { kind: summary && this.summaryMode === 'max-tokens' ? 'max-tokens' : 'stop' } }
  }
}

describe('native background compaction lifetime', () => {
  it('refuses explicit replay recovery for unsupported account-bound summary protocols', async () => {
    const f = await fixture('stop', true, false, true, true)
    installCompactionReplay(f.ctx)
    const original = f.ctx.githubCopilotPreview.recoveryLimits
    f.ctx.githubCopilotPreview.recoveryLimits = (...args) => {
      const lease = original(...args)
      return lease ? { ...lease, api: 'anthropic-messages' } : undefined
    }
    await f.ctx.commands.execute(f.agent, '/copilot-compact visible-history', [], new AbortController().signal)
    const job = f.ctx.jobs.list(f.agent.id).find(item => item.kind === 'copilot-compaction')!
    await f.ctx.jobs.wait(job.id, 10000, f.agent.id)
    expect(f.ctx.jobs.get(job.id, f.agent.id)).toMatchObject({
      status: 'failed', detail: expect.stringContaining('COPILOT_COMPACTION_REPLAY_UNAVAILABLE'),
    })
    expect(f.adapter.summaries).toHaveLength(0)
    expect(f.events.filter(event => event.type === 'compaction/summary')).toHaveLength(0)
    expect(f.agent.session.surface.replaceGeneration).toBe(f.originalGeneration)
  })

  it('recovers only an explicitly authorized manual job through one native transaction', async () => {
    const f = await fixture('stop', true, false, true, true)
    f.adapter.compactionReplay = installCompactionReplay(f.ctx)
    const source = JSON.stringify(f.events)
    const sourceCount = f.events.length
    await f.ctx.commands.execute(f.agent, '/copilot-compact', [], new AbortController().signal)
    const failed = f.ctx.jobs.list(f.agent.id).find(job => job.kind === 'copilot-compaction')!
    await f.ctx.jobs.wait(failed.id, 10000, f.agent.id)
    expect(f.ctx.jobs.get(failed.id, f.agent.id)).toMatchObject({
      status: 'failed', detail: expect.stringContaining('COPILOT_RESPONSES_REPLAY_SCOPE_MISMATCH'),
    })
    expect(f.agent.session.surface.replaceGeneration).toBe(f.originalGeneration)
    expect(f.events.filter(event => event.type === 'compaction/summary')).toHaveLength(0)
    await f.ctx.commands.execute(f.agent, '/copilot-compact visible-history', [], new AbortController().signal)
    const recovered = f.ctx.jobs.list(f.agent.id).find(job => job.kind === 'copilot-compaction' && job.id !== failed.id)!
    await f.ctx.jobs.wait(recovered.id, 10000, f.agent.id)
    expect(f.ctx.jobs.get(recovered.id, f.agent.id).status).toBe('completed')
    expect(f.events.filter(event => event.type === 'compaction/summary')).toHaveLength(1)
    expect(f.agent.session.surface.replaceGeneration).toBeGreaterThan(f.originalGeneration)
    expect(JSON.stringify(f.events.slice(0, sourceCount))).toBe(source)
    expect(f.adapter.conversation).toHaveLength(1)
    expect(f.forbiddenFetch).not.toHaveBeenCalled()
  })

  it('commits beyond the carrier deadline without a model wakeup and keeps status owner-scoped', async () => {
    const f = await fixture('slow', true, false, true, true)
    const settlements: boolean[] = []
    f.ctx.jobs.events.subscribe({ owner: f.agent.id }, event => {
      if (event.type === 'settled') settlements.push(event.awaited)
    })
    vi.useFakeTimers()
    try {
      const caller = new AbortController()
      const admitted = await f.ctx.commands.execute(f.agent, '/copilot-compact', [], caller.signal)
      expect(admitted?.result.text).toContain('started, not completed')
      await f.adapter.summaryStarted.promise
      const job = f.ctx.jobs.list(f.agent.id).find(item => item.kind === 'copilot-compaction')!
        expect(job.owner).toBe(f.agent.id)
      caller.abort()
      await vi.advanceTimersByTimeAsync(305_000)
      expect(f.ctx.jobs.get(job.id, f.agent.id).status).toBe('running')
      expect(f.agent.session.surface.replaceGeneration).toBe(f.originalGeneration)
      const duplicate = await f.ctx.commands.execute(f.agent, '/copilot-compact', [], new AbortController().signal)
      expect(duplicate?.result.text).toContain('already running')
      await vi.advanceTimersByTimeAsync(55_000)
      expect(f.ctx.jobs.get(job.id, f.agent.id).status).toBe('completed')
      expect(settlements).toEqual([true])
      expect(f.agent.session.surface.replaceGeneration).toBeGreaterThan(f.originalGeneration)
      expect(f.events.filter(event => event.type === 'compaction/summary')).toHaveLength(1)
      expect(f.adapter.conversation).toHaveLength(1)
      expect(f.agent.status).toBe('idle')
      expect(f.forbiddenFetch).not.toHaveBeenCalled()
    } finally { vi.useRealTimers() }
  })

  it.each(['cancel', 'unload', 'owner-disposal'] as const)('drains native recovery without replacing history on %s', async action => {
    const f = await fixture('await-abort', true, false, true, true)
    const admitted = await f.ctx.commands.execute(f.agent, '/copilot-compact', [], new AbortController().signal)
    expect(admitted?.result.text).toContain('started')
    await f.adapter.summaryStarted.promise
    const job = f.ctx.jobs.list(f.agent.id).find(item => item.kind === 'copilot-compaction')!
    const settled = f.ctx.jobs.wait(job.id, 1000, f.agent.id)
    if (action === 'cancel') {
      const cancelled = await f.ctx.commands.execute(f.agent, '/copilot-compact cancel', [], new AbortController().signal)
      expect(cancelled?.result.text).toContain('requested')
    } else if (action === 'unload') {
      await f.engineMount.dispose()
      expect(f.ctx.commands.list(f.agent).some(command => command.name === 'copilot-compact')).toBe(false)
    } else {
      await f.ownerHandle!.dispose()
    }
    // Owner teardown cancels native maintenance before jobs receive agent/disposed.
    expect((await settled).status).toBe(action === 'owner-disposal' ? 'failed' : 'killed')
    expect(f.agent.session.surface.replaceGeneration).toBe(f.originalGeneration)
    expect(f.events.filter(event => event.type === 'compaction/summary')).toHaveLength(0)
    expect(f.events.filter(event => event.type === 'compaction/start')).toHaveLength(1)
    expect(f.events.filter(event => event.type === 'compaction/end')).toHaveLength(1)
  })
})

beforeAll(() => {
  expect(['tagged-source-runtime', 'installed-artifact-runtime']).toContain(process.env.DSH_CORE_EVIDENCE)
  expect(['0.1.6-alpha.2', '0.2.0-rc.1', '0.2.0-rc.2']).toContain(process.env.DSH_PUBLISHED_CORE_RELEASE)
  expect(SESSION_FORMAT_VERSION).toBe(expectedSessionFormatVersion)
})

afterEach(async () => {
  try {
    // Start every owned teardown even if one fails. Real factory teardown
    // cancels/drains an in-flight summary before Session/scoped service release.
    const outcomes = await Promise.allSettled(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
    const failures = outcomes.filter((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected')
    if (failures.length > 0) throw new AggregateError(failures.map(outcome => outcome.reason), 'fixture cleanup failed')
  } finally {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  }
})

async function fixture(mode: SummaryMode = 'stop', recovery = false, nativeAdmission = false, recoveryEngine = recovery, background = false,
  recoveryConfig: { automaticRecovery?: boolean; auto?: boolean } = {}) {
  const ctx = new Context()
  contexts.push(ctx)
  const forbiddenFetch = vi.fn((): never => { throw new Error('compaction-fixture-network-forbidden') })
  vi.stubGlobal('fetch', forbiddenFetch)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime, {})
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(TokenMeter)
  if (background) {
    await ctx.plugin(Commands)
    await ctx.plugin(LocalJobs)
  }
  const compactionConfig = {
    auto: true,
    thresholdRatio: 1,
    retainTokens: 100,
    maxTokens: 8192,
    compactionRetries: 0,
    maxOverflowRetries: 1,
    ...recoveryConfig,
  }
  const engineMount = recoveryEngine
    ? ctx.plugin(CopilotManualRecoveryCompactionEngine, compactionConfig)
    : ctx.plugin(BasicCompactionEngine, compactionConfig)
  await engineMount
  expect(ctx.compaction).toBeInstanceOf(BasicCompactionEngine)
  expect(ctx.tokenMeter).toBeInstanceOf(TokenMeter)
  const adapter = new FixtureAdapter(mode)
  const removeAdapter = ctx.llm.registerAdapter([provider], adapter)
  ctx.systemPrompt.section({ name: 'compaction-fixture', order: 0, complete: true,
    text: () => nativeAdmission
      ? `NATIVE_SYSTEM_SENTINEL ${'Preserve engineering constraints. '.repeat(20)}`
      : 'Fixture system guidance.' })
  if (nativeAdmission) {
    ctx.tools.register(defineTool({
      name: 'native_fixture_tool',
      description: `NATIVE_TOOL_SENTINEL ${'Read the requested source before editing. '.repeat(10)}`,
      parameters: { path: { type: 'string', description: 'Exact repository-relative path.' } },
      output: { schema: { type: 'string' }, render: (_args, text) => [{ type: 'text', text }] },
      execute: async () => { throw new Error('Summary must not execute tools') },
    }))
  }

  // Synthetic account ownership only; no discovery, settings or credentials.
  if (!nativeAdmission) ctx.provide('githubCopilotPreview', {
    getView: () => ({ provider }),
    recoveryLimits: () => ({
      api: 'openai-responses',
      limits: { contextWindow, maxInputTokens: 12000, maxTokens: 8192 },
      policy: { safetyTokens: 0 },
      assertCurrent: () => {},
    }),
  })
  let model = 'fixture-model-A'
  let inputBudgetTokens: number | undefined
  let autoLoads = 0
  const removeAuto = nativeAdmission ? () => {} : installAutoModelRouting(ctx, {
    async loadModels() {
      autoLoads++
      return [autoCandidate(model)]
    },
  })
  ctx.effect(() => removeAuto)
  // Exact stand-in for Core's model-selection middleware: the plugin's prepended
  // listener must observe this resolved virtual route after awaiting next().
  if (!nativeAdmission) ctx.on('agent/request', async (_payload, next) => ({ ...await next(), provider, model: autoModel }))
  const failures: Array<{ code: string; message: string }> = []
  ctx.on('agent/request-error', async ({ failure }, next) => {
    failures.push({ code: failure.code, message: failure.message })
    return next()
  }, { prepend: true })
  const priced: RequestObservation[] = []
  installCopilotCompactionPressure(ctx, {
    resolve(request) {
      if (inputBudgetTokens === undefined || request.provider !== provider || request.model !== model) return undefined
      priced.push(observeRequest(request))
      return { inputBudgetTokens }
    },
  })

  const id = SessionId(`compaction-pressure-${mode}`)
  const events: SessionEvent[] = []
  // Consume the post-commit public event feed, not synchronous Session-history
  // APIs or manufactured baseline-specific assistant/chunk seed records.
  ctx.on('session/event', (session, event) => { if (session.id === id) events.push(event) })
  const ownerHandle = background
    ? await ctx.agents.create({ sessionId: id, agentOptions: { provider, model, maxTokens: 8192 } })
    : undefined
  const agent = ownerHandle?.agent ?? await ctx.agentLoop.create(id, { provider, model, maxTokens: 8192 })
  if (recoveryEngine) adapter.onSummary = () => expect(ctx.agents.currentInitiator()).toBe(agent)
  const send = (text: string): void => {
    agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
  }
  send(`${oldSentinel} ${'historical detail '.repeat(recovery ? 100 : 1000)}`)
  await agent.whenIdle()
  expect(adapter.conversation, JSON.stringify(events.at(-1)?.data)).toHaveLength(1)
  expect(adapter.summaries).toHaveLength(0)
  expect(events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
  const seedCount = events.length
  const originalGeneration = agent.session.surface.replaceGeneration
  const oldUser = events.find(event => event.type === 'user/message'
    && event.data.content.some(block => block.type === 'text' && block.text.includes(oldSentinel)))
  expect(oldUser).toBeDefined()
  const originalTokens = ctx.tokenMeter.measure(agent.session).totalTokens
  expect(originalTokens).toBeGreaterThan(recovery ? 100 : 1000)
  expect(originalTokens).toBeLessThan(contextWindow)

  return {
    ctx, adapter, agent, events, failures, priced, forbiddenFetch, seedCount, originalGeneration, originalTokens, removeAdapter, engineMount, ownerHandle,
    autoLoads: () => autoLoads,
    oldUserSeq: oldUser!.seq,
    enable(budget = 1000, selectedModel = 'fixture-model-B') { inputBudgetTokens = budget; model = selectedModel },
    send,
    currentEvents: () => events.slice(seedCount),
  }
}

function replacements(events: readonly SessionEvent[]): SessionEvent[] {
  return events.filter(event => event.type === 'user/message' && typeof event.surfaceOp === 'object')
}

function compactionEvents(events: readonly SessionEvent[]): SessionEvent[] {
  return events.filter(event => event.type === 'compaction/start' || event.type === 'compaction/summary' || event.type === 'compaction/end')
}

function installController(ctx: Context): void {
  const forbidden = vi.fn(async (): Promise<never> => { throw new Error('no native open') })
  const register = () => () => {}
  ctx.provide('typert', {
    lookups: { configure: register, register },
    contexts: { configureHost: register, registerHost: register },
  })
  ctx.provide('fileUploads', { registerAgentResolver: register })
  ctx.provide('agentDefaultModel', { currentSelection: () => undefined, saveSelection: forbidden })
  new SessionController(ctx, { nativeOpen: false }, { canOpenPath: () => false, openPath: forbidden })
}

describe('alpha2 stock compaction driven by the Copilot local pressure signal', () => {
  it.each([false, true])('persistent policy restores automatic replay-blocked compaction without a command, recovery engine=%s', async recoveryEngine => {
    const f = await fixture('stop', recoveryEngine, false, recoveryEngine, true)
    const value = { continuationDefaultHistory: [{ enabled: false, changedAt: 0 }],
      sessionContinuation: [{ sessionId: f.agent.session.id, version: 1, enabled: true, consentedAt: 1 }] }
    f.ctx.provide('settings', { describe: () => [{ ns: 'github-copilot', value, revision: 1 }] })
    const owner = installSessionContinuation(f.ctx)
    f.ctx.effect(() => () => owner.dispose())
    await owner.ready
    f.adapter.continuation = owner
    const lifecycle: unknown[] = []
    f.ctx.sessionProjections.onChanged((session, key, value) => {
      if (session === f.agent.session && key === 'githubCopilotCompactionLifecycle') lifecycle.push(value)
    })
    f.ctx.sessionProjections.stateOf(f.agent.session, 'githubCopilotCompactionLifecycle')
    const oldSource = JSON.stringify(f.events)
    const oldCount = f.events.length
    expect(f.originalTokens).toBeGreaterThan(200)
    f.enable(200)
    f.send(`${currentSentinel}: continue without manual recovery`)
    await f.agent.whenIdle()
    expect(f.currentEvents().at(-1), JSON.stringify(f.currentEvents().at(-1)?.data)).toMatchObject({
      type: 'turn/end', data: { reason: { kind: 'completed' } },
    })
    expect(compactionEvents(f.currentEvents()).map(event => event.type)).toEqual([
      'compaction/start', 'compaction/summary', 'compaction/end',
    ])
    expect(JSON.stringify(f.events.slice(0, oldCount))).toBe(oldSource)
    expect(f.agent.session.surface.replaceGeneration).toBeGreaterThan(f.originalGeneration)
    expect(await f.ctx.githubCopilotSessionContinuation.get(f.agent)).toMatchObject({ compaction: { state: 'completed' } })
    expect(f.adapter.summaries).toHaveLength(1)
    expect(f.adapter.conversation).toHaveLength(2)
    expect(lifecycle).toEqual(expect.arrayContaining([
      expect.objectContaining({ running: true }), expect.objectContaining({ running: false }),
    ]))
    expect(f.forbiddenFetch).not.toHaveBeenCalled()
  })

  it.each([false, true])('compacts and rebuilds an Auto request with large historical continuation reasoning, continuing=%s', async continuing => {
    const f = await fixture('stop', false, false, false, true)
    installController(f.ctx)
    const value = {
      continuationDefaultHistory: [{ enabled: false, changedAt: 0 }],
      sessionContinuation: [{ sessionId: f.agent.session.id, version: 1, enabled: true, consentedAt: 1 }],
    }
    f.ctx.provide('settings', { describe: () => [{ ns: 'github-copilot', value, revision: 1 }] })
    const owner = installSessionContinuation(f.ctx)
    f.ctx.effect(() => () => owner.dispose())
    await owner.ready
    f.adapter.continuation = owner
    const budget = continuing ? f.originalTokens + 200 : 1000
    const selectedModel = continuing ? 'fixture-model-A' : 'fixture-model-B'
    f.enable(budget, selectedModel)
    if (continuing) {
      f.ctx.tools.register(defineTool({
        name: 'pressure_fixture_tool', description: 'Synthetic continuation pressure.',
        parameters: {}, output: { schema: { type: 'string' }, render: (_args, text) => [{ type: 'text', text }] },
        execute: async () => 'synthetic tool output '.repeat(100),
      }))
      f.adapter.nextTool = true
      installCopilotPreStepPressure(f.ctx, { resolve: () => ({ inputBudgetTokens: budget }) })
    }
    f.send(`${currentSentinel}: continue after native compaction`)
    await f.agent.whenIdle()
    expect(f.currentEvents().at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
    expect(f.adapter.summaries).toHaveLength(1)
    expect(f.adapter.continued).toHaveLength(continuing ? 2 : 1)
    expect(f.adapter.continued.at(-1)).toEqual({ input: [
      { type: 'message', content: expect.stringContaining(checkpoint) },
    ] })
    expect(f.adapter.conversation.at(-1)?.text).not.toContain(oldSentinel)
    expect(f.adapter.conversation.at(-1)?.model).toBe(selectedModel)
    expect(f.agent.session.surface.replaceGeneration).toBeGreaterThan(f.originalGeneration)
    expect(replacements(f.currentEvents())).toHaveLength(1)
    expect(compactionEvents(f.currentEvents()).map(event => event.type)).toEqual(['compaction/start', 'compaction/summary', 'compaction/end'])
    expect(f.failures).toHaveLength(continuing ? 0 : 1)
    expect(f.failures.every(failure => failure.code === 'CONTEXT_WINDOW_EXCEEDED')).toBe(true)
    expect(f.forbiddenFetch).not.toHaveBeenCalled()
  })

  it.each([false, true])('prevents continuing-step pressure attempts while retaining complete native turn usage, preStep=%s', async preStep => {
    const f = await fixture()
    installController(f.ctx)
    f.ctx.tools.register(defineTool({
      name: 'pressure_fixture_tool', description: 'Synthetic pressure output.',
      parameters: {}, output: { schema: { type: 'string' }, render: (_args, text) => [{ type: 'text', text }] },
      execute: async () => 'synthetic tool output '.repeat(100),
    }))
    const samples = { inputTokens: 20, outputTokens: 5, totalTokens: 25, cacheReadTokens: 0, cacheWriteTokens: 0 }
    f.adapter.defaultUsage = samples
    f.adapter.nextTool = true
    const budget = f.originalTokens + 200
    f.enable(budget, 'fixture-model-A')
    if (preStep) installCopilotPreStepPressure(f.ctx, {
      resolve: () => ({ inputBudgetTokens: budget }),
    })
    f.send('Synthetic same-turn tool continuation.')
    await f.agent.whenIdle()
    const events = f.currentEvents()
    expect(events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
    expect(events.filter(event => event.type === 'step/start')).toHaveLength(2)
    expect(events.filter(event => event.type === 'assistant/attempt')).toHaveLength(preStep ? 0 : 1)
    expect(f.adapter.conversation).toHaveLength(3)
    expect(f.adapter.summaries).toHaveLength(1)
    const secondStart = events.filter(event => event.type === 'step/start')[1]!
    expect(compactionEvents(events).every(event => event.seq < secondStart.seq)).toBe(preStep)
    // Native turn-tail matches by recorded turn, not by the compaction event range.
    const usageEvents = events.filter(event => 'turn' in event.data && event.data.turn === 2)
    if (preStep) {
      expect(deriveTurnTokenUsage(usageEvents)).toMatchObject({
        uncachedInputTokens: 40, outputTokens: 10, totalTokens: 50,
      })
    } else expect(deriveTurnTokenUsage(usageEvents)).toBeUndefined()
    expect(f.failures).toHaveLength(preStep ? 0 : 1)
    f.send('Synthetic independent subsequent turn.')
    await f.agent.whenIdle()
    const subsequent = f.currentEvents().filter(event => 'turn' in event.data && event.data.turn === 3)
    expect(subsequent.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
    expect(deriveTurnTokenUsage(subsequent)).toMatchObject({
      uncachedInputTokens: 20, outputTokens: 5, totalTokens: 25,
    })
    expect(f.forbiddenFetch).not.toHaveBeenCalled()
  })
  it.each([false, true])('uses real managed admission with full native summary input and large prior usage, recovery=%s', async recoveryEngine => {
    const f = await fixture('stop', true, true, recoveryEngine)
    for (let turn = 0; turn < 26; turn++) {
      if (turn === 25) f.adapter.nextUsage = { inputTokens: 508198, outputTokens: 10, totalTokens: 508208 }
      f.send(`NATIVE_HISTORY_${turn} ${'historical engineering detail '.repeat(70)}`)
      await f.agent.whenIdle()
    }
    expect(f.ctx.tokenMeter.measure(f.agent.session).totalTokens).toBeGreaterThanOrEqual(508198)
    const generation = f.agent.session.surface.replaceGeneration
    const source = JSON.stringify(f.events)
    const sourceLength = f.events.length
    f.removeAdapter()
    const grant = { kind: 'grant', payload: { type: 'oauth', refresh: 'synthetic-refresh',
      access: 'synthetic-access', expires: Date.now() + 3_600_000, availableModelIds: ['fixture-model-A'] } }
    f.ctx.provide('credentials', {
      readRecord: async (key: string) => { expect(key).toBe(GITHUB_COPILOT_CREDENTIAL_KEY); return grant },
      modifyRecord: async () => { throw new Error('Fresh synthetic grant must not refresh') },
      listRecords: async () => [{ key: GITHUB_COPILOT_CREDENTIAL_KEY, kind: 'grant' }],
      deleteRecord: async () => { throw new Error('Synthetic grant must not be deleted') },
    })
    const bodies: Record<string, unknown>[] = []
    vi.stubGlobal('fetch', async (url: unknown, init?: RequestInit) => {
      if (String(url).endsWith('/models')) return new Response(JSON.stringify({ data: [{
        id: 'fixture-model-A', name: 'Fixture model', model_picker_enabled: true,
        policy: { state: 'enabled' }, supported_endpoints: ['/responses'],
        capabilities: { supports: { streaming: true, tool_calls: true },
          limits: { max_context_window_tokens: contextWindow, max_prompt_tokens: 12000, max_output_tokens: 8192 } },
      }] }), { headers: { 'content-type': 'application/json' } })
      expect(String(url)).toMatch(/\/responses$/)
      expect(f.agent.session.surface.replaceGeneration).toBe(generation)
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      const output = { type: 'message', id: `synthetic-summary-${bodies.length}`, role: 'assistant',
        content: [{ type: 'output_text', text: checkpoint }] }
      const event = (type: string, data: Record<string, unknown>) => `data: ${JSON.stringify({ type, ...data })}\n\n`
      return new Response([
        event('response.created', { response: { id: `synthetic-response-${bodies.length}` } }),
        event('response.output_item.added', { output_index: 0, item: output }),
        event('response.output_text.delta', { output_index: 0, delta: checkpoint }),
        event('response.output_item.done', { output_index: 0, item: output }),
        event('response.completed', { response: { status: 'completed', output: [output],
          usage: { input_tokens: 42, output_tokens: 10, total_tokens: 52 } } }),
      ].join(''), { headers: { 'content-type': 'text/event-stream' } })
    })
    await f.ctx.plugin(previewPlugin, { requestBudget: { safetyTokens: 0 } })
    await f.ctx.githubCopilotPreview.refresh()
    await f.ctx.githubCopilotPreview.discover()
    expect(f.ctx.githubCopilotPreview.recoveryLimits('fixture-model-A'), JSON.stringify(f.ctx.githubCopilotPreview.getView())).toBeDefined()
    const estimates = vi.mocked(PiEstimate.estimateContextTokens)
    estimates.mockClear()
    const operation = f.ctx.compaction.compactNow(f.agent, new AbortController().signal)
    if (recoveryEngine) {
      expect(await operation).not.toBeNull()
      expect(bodies.length).toBeGreaterThan(1)
      expect(bodies.length).toBeLessThanOrEqual(16)
      expect(f.agent.session.surface.replaceGeneration).toBeGreaterThan(generation)
      const summary = f.events.slice(sourceLength).find(event => event.type === 'compaction/summary')
      expect(summary).toMatchObject({ data: { usage: {
        inputTokens: bodies.length * 42, outputTokens: bodies.length * 10, totalTokens: bodies.length * 52,
      } } })
      expect(summary?.data).not.toHaveProperty('llmStreamCall')
      expect(estimates.mock.results.every(result => result.type === 'return' && result.value.tokens <= 12000)).toBe(true)
    } else {
      await expect(operation).rejects.toMatchObject({ cause: { code: 'CONTEXT_WINDOW_EXCEEDED' } })
      expect(bodies).toHaveLength(0)
      expect(f.agent.session.surface.replaceGeneration).toBe(generation)
      expect(estimates.mock.results.some(result => result.type === 'return' && result.value.tokens > 12000)).toBe(true)
    }
    expect(JSON.stringify(f.events.slice(0, sourceLength))).toBe(source)
    expect(estimates).toHaveBeenCalled()
    expect(estimates.mock.calls.some(([context]) => context.messages.some(message => message.role === 'assistant'))).toBe(true)
    for (const [context] of estimates.mock.calls) {
      const serialized = JSON.stringify(context)
      expect(serialized).toContain('NATIVE_SYSTEM_SENTINEL')
      expect(serialized).toContain('NATIVE_TOOL_SENTINEL')
      expect(serialized).toContain('You are now acting as a compaction engine')
      expect(serialized).toContain('## Critical Context')
      for (const message of context.messages) {
        if (message.role === 'user') expect(message.timestamp).toBe(0)
        if (message.role === 'assistant') {
          expect(message.timestamp).toBe(0)
          expect(message.usage.totalTokens).toBe(0)
        }
      }
    }
    for (const result of estimates.mock.results) {
      expect(result.type).toBe('return')
      if (result.type === 'return') expect(result.value.usageTokens).toBe(0)
    }
    for (const body of bodies) {
      expect(body.max_output_tokens).toBe(8192)
      expect(JSON.stringify(body)).toContain('NATIVE_TOOL_SENTINEL')
      expect(JSON.stringify(body)).toContain('## Critical Context')
    }
  })

  it('recovers oversized manual history with one native transaction and honest multi-call audit', async () => {
    const f = await fixture('reject-overflow', true, false, true, false, { automaticRecovery: false })
    for (let turn = 0; turn < 6; turn++) {
      f.send(`HISTORICAL_TURN_${turn} ${'historical detail '.repeat(100)}`)
      await f.agent.whenIdle()
    }
    const before = f.agent.session.surface.replaceGeneration
    const result = await f.ctx.compaction.compactNow(f.agent, new AbortController().signal)
    expect(result).not.toBeNull()
    expect(f.adapter.summaries.length).toBeGreaterThan(1)
    expect(f.adapter.summaries.every(request => request.model === 'fixture-model-A')).toBe(true)
    expect(f.events.filter(event => event.type === 'compaction/start' || event.type === 'compaction/end')).toMatchObject([
      { type: 'compaction/start', data: { turn: null } },
      { type: 'compaction/end' },
    ])
    const summary = f.events.find(event => event.type === 'compaction/summary')
    expect(summary).toMatchObject({ data: { provider, model: 'fixture-model-A', maxTokens: 8192 } })
    expect(summary?.data).not.toHaveProperty('llmStreamCall')
    expect(f.agent.session.surface.replaceGeneration).toBeGreaterThan(before)
    expect(f.forbiddenFetch).not.toHaveBeenCalled()
  })

  it.each(['enabled', 'disabled', 'auto-off'] as const)('defaults automatic oversized recovery on without a manual command, enabled=%s', async mode => {
    const enabled = mode === 'enabled'
    const f = await fixture('reject-overflow', true, false, true, false,
      enabled ? {} : mode === 'disabled' ? { automaticRecovery: false } : { auto: false })
    for (let turn = 0; turn < 6; turn++) {
      f.send(`AUTOMATIC_HISTORY_${turn} ${'historical detail '.repeat(100)}`)
      await f.agent.whenIdle()
    }
    const generation = f.agent.session.surface.replaceGeneration
    const source = JSON.stringify(f.events)
    const length = f.events.length
    f.enable(1000, 'fixture-model-A')
    f.send(currentSentinel)
    await f.agent.whenIdle()
    const summaries = f.events.slice(length).filter(event => event.type === 'compaction/summary')
    expect(summaries).toHaveLength(enabled ? 1 : 0)
    if (enabled) {
      expect(f.adapter.summaries.length).toBeGreaterThan(1)
      expect(f.adapter.summaries.length).toBeLessThanOrEqual(16)
      expect(f.agent.session.surface.replaceGeneration).toBeGreaterThan(generation)
      expect(summaries[0]?.data).not.toHaveProperty('llmStreamCall')
      expect(f.events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
      expect(f.adapter.conversation.at(-1)?.text).toContain(checkpoint)
      expect(f.adapter.conversation.at(-1)?.text).toContain(currentSentinel)
    } else {
      expect(f.adapter.summaries).toHaveLength(mode === 'auto-off' ? 0 : 1)
      expect(f.agent.session.surface.replaceGeneration).toBe(generation)
    }
    expect(JSON.stringify(f.events.slice(0, length))).toBe(source)
    expect(f.forbiddenFetch).not.toHaveBeenCalled()
  })

  it('cancels automatic segmented recovery without a partial checkpoint', async () => {
    const f = await fixture('await-abort', true)
    for (let turn = 0; turn < 6; turn++) {
      f.send(`CANCEL_HISTORY_${turn} ${'historical detail '.repeat(100)}`)
      await f.agent.whenIdle()
    }
    const generation = f.agent.session.surface.replaceGeneration
    f.enable(1000, 'fixture-model-A')
    f.send(currentSentinel)
    await Promise.race([f.adapter.summaryStarted.promise, f.agent.whenIdle().then(() => {
      throw new Error('Expected automatic segmented recovery')
    })])
    f.agent.cancel({ kind: 'user' })
    await f.agent.whenIdle()
    expect(f.agent.session.surface.replaceGeneration).toBe(generation)
    expect(f.events.filter(event => event.type === 'compaction/summary')).toHaveLength(0)
    expect(f.adapter.summaries).toHaveLength(1)
    expect(f.events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'aborted' } } })
  })

  it.each(['CONTEXT_WINDOW_EXCEEDED', 'TIMEOUT', 'AUTH', 'RATE_LIMIT', 'NETWORK_ERROR'])(
    'escalates only a typed summary capacity failure once: %s', async code => {
      const f = await fixture('stop', true)
      for (let turn = 0; turn < 3; turn++) {
        f.send(`SMALL_HISTORY_${turn} ${'detail '.repeat(50)}`)
        await f.agent.whenIdle()
      }
      f.adapter.firstSummaryFailure = code
      const generation = f.agent.session.surface.replaceGeneration
      f.enable(700, 'fixture-model-A')
      f.send(currentSentinel)
      await f.agent.whenIdle()
      if (code === 'CONTEXT_WINDOW_EXCEEDED') {
        expect(f.adapter.summaries.length).toBeGreaterThan(2)
        expect(f.adapter.summaries.length).toBeLessThanOrEqual(16)
        expect(f.agent.session.surface.replaceGeneration).toBeGreaterThan(generation)
        const summary = f.events.find(event => event.type === 'compaction/summary')
        expect(summary?.data).not.toHaveProperty('llmStreamCall')
        expect(summary?.data).not.toHaveProperty('usage')
      } else {
        expect(f.adapter.summaries).toHaveLength(1)
        expect(f.agent.session.surface.replaceGeneration).toBe(generation)
        expect(f.events.filter(event => event.type === 'compaction/summary')).toHaveLength(0)
      }
      expect(f.forbiddenFetch).not.toHaveBeenCalled()
    })

  it('closes a cancelled oversized manual transaction without replacing its source', async () => {
    const f = await fixture('await-abort', true)
    for (let turn = 0; turn < 6; turn++) {
      f.send(`HISTORICAL_TURN_${turn} ${'historical detail '.repeat(100)}`)
      await f.agent.whenIdle()
    }
    const generation = f.agent.session.surface.replaceGeneration
    const abort = new AbortController()
    const running = f.ctx.compaction.compactNow(f.agent, abort.signal)
    await f.adapter.summaryStarted.promise
    abort.abort()
    await expect(running).rejects.toMatchObject({ name: 'AbortError' })
    expect(compactionEvents(f.events).map(event => event.type)).toEqual(['compaction/start', 'compaction/end'])
    expect(f.agent.session.surface.replaceGeneration).toBe(generation)
    expect(replacements(f.events)).toEqual([])
  })

  it.each(['bindings', 'switch'])('follows parents using %s across real turns, independent Auto inputs and reconstructed histories', async mode => {
    const ctx = new Context()
    contexts.push(ctx)
    const forbidden = vi.fn((): never => { throw new Error('follow-fixture-external-side-effect') })
    vi.stubGlobal('fetch', forbidden)
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(ToolRuntime, {})
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(TokenMeter)
    const register = () => () => {}
    ctx.provide('typert', {
      lookups: { configure: register, register },
      contexts: { configureHost: register, registerHost: register },
    })
    ctx.provide('fileUploads', { registerAgentResolver: register })
    ctx.provide('agentDefaultModel', { currentSelection: () => undefined, saveSelection: forbidden })
    new SessionController(ctx, { nativeOpen: false }, { canOpenPath: () => false, openPath: forbidden })
    const adapter = new FixtureAdapter('stop')
    ctx.llm.registerAdapter([provider], adapter)
    const parent = await ctx.agentLoop.create(SessionId('follow-loop-parent'), { provider, model: 'fixture-A' })
    const childId = SessionId('follow-loop-child')
    const siblingId = SessionId('follow-loop-sibling')
    const inputs: string[] = []
    const errors: unknown[] = []
    ctx.on('agent/error', ({ error }) => { errors.push(error) })
    const removeAuto = installAutoModelRouting(ctx, {
      followParentModel: () => mode === 'switch',
      parentModelBindings: () => mode === 'switch' ? [] : [childId, siblingId].map(childSessionId => ({
        childSessionId, parentSessionId: parent.id,
      })),
      loadModels: async () => [autoCandidate('fixture-A'), autoCandidate('fixture-B')],
    })
    ctx.effect(() => removeAuto)
    const create = (id: typeof childId, seed?: readonly SessionEvent[]) => ctx.agents.create({
      sessionId: id, parentAgent: parent,
      meta: { parentSession: parent.id, origin: 'subagent', delegationDepth: 1, isSeeded: false },
      inheritedEventCount: SessionLogOffset(0),
      agentOptions: { provider, model: 'fixture-initial', maxTokens: 8192 },
      ...(seed === undefined ? {} : { seed }),
      setup(_agentCtx, agent) {
        if (seed !== undefined) return
        Reflect.apply(agent.session.append, agent.session, ['subagent/descriptor', {
          version: 3, provider: 'spawn', mode: 'continuable', label: 'Native-loop fixture',
          agentProvider: provider, agentModel: 'fixture-initial',
        }])
      },
    })
    const send = async (agent: typeof parent, text: string) => {
      agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
      await agent.whenIdle()
      if (errors.length > 0) throw new AggregateError(errors, 'Native child turn failed')
      expect(agent.session.requestHeader()).toBeDefined()
    }
    parent.session.append('model/selection', { provider, model: 'fixture-A' })
    const child = await create(childId)
    await send(child.agent, 'CHILD_FIRST')
    expect(child.agent.session.requestHeader()?.config.model).toBe('fixture-A')
    parent.session.append('model/selection', { provider, model: 'fixture-B' })
    await send(child.agent, 'CHILD_SECOND')
    expect(child.agent.session.requestHeader()?.config.model).toBe('fixture-B')
    const sibling = await create(siblingId)
    for (const preference of ['auto', 'auto-efficiency', 'auto-intelligence']) {
      parent.session.append('model/selection', { provider, model: preference })
      await Promise.all([send(child.agent, `CHILD_${preference}`), send(sibling.agent, `SIBLING_${preference}`)])
      const requests = adapter.conversation.slice(-2)
      expect(requests.every(request => ['fixture-A', 'fixture-B'].includes(request.model))).toBe(true)
      expect(requests.some(request => request.text.includes(`CHILD_${preference}`) && !request.text.includes('SIBLING_'))).toBe(true)
      expect(requests.some(request => request.text.includes(`SIBLING_${preference}`) && !request.text.includes('CHILD_'))).toBe(true)
      inputs.push(...requests.map(request => request.text))
    }
    expect(inputs).toHaveLength(6)
    const header = JSON.parse(JSON.stringify(child.agent.session.header))
    const reader = sessionFormatCatalog.createRestore(sessionFormatCatalog.encodeCurrentHeader(header, 0), {
      recovery: 'strict', validation: 'current',
    })
    for (const event of child.agent.session.snapshotEvents()) {
      reader.decodeRow(sessionFormatCatalog.encodeCurrentEvent(JSON.parse(JSON.stringify(event))))
    }
    const restored = reader.finish()
    expect(restored.events.some(event => event.type === 'model/selection')).toBe(false)
    await child.dispose()
    parent.session.append('model/selection', { provider, model: 'fixture-A' })
    const resumed = await create(childId, restored.events)
    await send(resumed.agent, 'CHILD_RECONSTRUCTED')
    expect(resumed.agent.session.requestHeader()?.config.model).toBe('fixture-A')
    resumed.agent.session.append('model/selection', { provider, model: 'fixture-A' })
    parent.session.append('model/selection', { provider, model: 'fixture-B' })
    await send(resumed.agent, 'CHILD_EXPLICIT_OVERRIDE')
    expect(resumed.agent.session.requestHeader()?.config.model).toBe('fixture-A')
    expect(forbidden).not.toHaveBeenCalled()
  })

  it('prices Core assistant text and reasoning with the unchanged native token meter', async () => {
    const f = await fixture()
    const message = createAssistantMessage({
      source: { provider, model: 'fixture-model-A' },
      content: [
        { type: 'text', text: 'x'.repeat(400_000) },
        { type: 'reasoning', text: 'r'.repeat(400_000) },
      ],
    })
    const estimate = vi.fn((input: unknown) => {
      expect(input).toBe(message)
      return f.ctx.tokenMeter.estimateMessage(message)
    })
    expect(estimateTurnInputTokens([message], estimate)).toBe(200_012)
    expect(estimate).toHaveBeenCalledExactlyOnceWith(message)
  })

  it('shrinks durable history and rebuilds the switched model request without sending the oversized original', async () => {
    const f = await fixture()
    f.enable()
    f.send(`${currentSentinel}: continue with the latest selected model`)
    await f.agent.whenIdle()

    expect(f.agent.options.model).toBe('fixture-model-A')
    expect(f.agent.session.requestHeader()?.config.model).toBe('fixture-model-B')
    expect(f.autoLoads()).toBe(2)
    expect(f.failures).toEqual([{ code: 'CONTEXT_WINDOW_EXCEEDED', message: expect.stringContaining('Copilot local estimated input budget exceeded') }])
    expect(f.priced).toHaveLength(2)
    expect(f.priced[0]?.text).toContain(oldSentinel)
    expect(f.priced.every(request => request.model === 'fixture-model-B')).toBe(true)
    expect(f.adapter.summaries).toHaveLength(1)
    expect(f.adapter.summaries[0]).toMatchObject({ provider, model: 'fixture-model-B', maxTokens: 8192 })
    expect(f.adapter.summaries[0]?.text).toContain(oldSentinel)
    expect(f.adapter.conversation).toHaveLength(2)
    const rebuilt = f.adapter.conversation[1]!
    expect(rebuilt.model).toBe('fixture-model-B')
    expect(rebuilt.text).toContain(checkpoint)
    expect(rebuilt.text).toContain(currentSentinel)
    expect(rebuilt.text).not.toContain(oldSentinel)
    expect(f.agent.session.surface.replaceGeneration).toBeGreaterThan(f.originalGeneration)
    expect(f.agent.session.surface.nodes).not.toContain(f.oldUserSeq)
    expect(f.ctx.tokenMeter.measure(f.agent.session).totalTokens).toBeLessThan(1000)

    const events = f.currentEvents()
    expect(events.filter(event => event.type === 'github-copilot/auto-model-decision')).toEqual([])
    const transaction = compactionEvents(events)
    expect(transaction.map(event => event.type)).toEqual(['compaction/start', 'compaction/summary', 'compaction/end'])
    expect(transaction[1]).toMatchObject({ type: 'compaction/summary',
      data: { provider, model: 'fixture-model-B', maxTokens: 8192 } })
    const replaced = replacements(events)
    expect(replaced).toHaveLength(1)
    expect(replaced[0]!.seq).toBeGreaterThan(transaction[1]!.seq)
    expect(replaced[0]!.seq).toBeLessThan(transaction[2]!.seq)
    const start = events.find(event => event.type === 'step/start')!
    const end = events.find(event => event.type === 'step/end')!
    expect(events.filter(event => event.type === 'step/start')).toHaveLength(1)
    expect(transaction.every(event => event.seq > start.seq && event.seq < end.seq)).toBe(true)
    expect(events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
    expect(f.forbiddenFetch).not.toHaveBeenCalled()
  })

  it('honors the stock overflow retry bound when a reduced checkpoint still exceeds the input budget', async () => {
    const f = await fixture()
    f.enable(1)
    f.send(`${currentSentinel}: continue`)
    await f.agent.whenIdle()

    expect(f.failures).toHaveLength(2)
    expect(f.failures.every(failure => failure.code === 'CONTEXT_WINDOW_EXCEEDED')).toBe(true)
    expect(f.priced).toHaveLength(2)
    expect(f.adapter.summaries).toHaveLength(1)
    expect(f.adapter.conversation).toHaveLength(1)
    expect(compactionEvents(f.currentEvents()).map(event => event.type)).toEqual(['compaction/start', 'compaction/summary', 'compaction/end'])
    expect(replacements(f.currentEvents())).toHaveLength(1)
    expect(f.ctx.tokenMeter.measure(f.agent.session).totalTokens).toBeLessThan(f.originalTokens)
    expect(f.currentEvents().at(-1)).toMatchObject({
      type: 'turn/end', data: { reason: { kind: 'error', error: { code: 'CONTEXT_WINDOW_EXCEEDED' } } },
    })
    expect(f.forbiddenFetch).not.toHaveBeenCalled()
  })

  it('rejects a max-tokens summary without committing partial text or retrying the original request', async () => {
    const f = await fixture('max-tokens')
    f.enable()
    f.send(`${currentSentinel}: continue`)
    await f.agent.whenIdle()

    expect(f.adapter.summaries).toHaveLength(1)
    expect(f.adapter.conversation).toHaveLength(1)
    expect(f.failures).toHaveLength(1)
    expect(compactionEvents(f.currentEvents()).map(event => event.type)).toEqual(['compaction/start', 'compaction/end'])
    expect(f.currentEvents().find(event => event.type === 'compaction/end')).toMatchObject({
      data: { error: expect.stringContaining('summarization truncated at the token cap') },
    })
    expect(replacements(f.currentEvents())).toEqual([])
    expect(f.agent.session.surface.replaceGeneration).toBe(f.originalGeneration)
    expect(f.agent.session.surface.nodes).toContain(f.oldUserSeq)
    expect(f.currentEvents().at(-1)).toMatchObject({
      type: 'turn/end', data: { reason: { kind: 'error', error: { code: 'CONTEXT_WINDOW_EXCEEDED' } } },
    })
    expect(f.forbiddenFetch).not.toHaveBeenCalled()
  })

  it('keeps manual compaction truncation classified as a summary failure with no replacement', async () => {
    const f = await fixture('max-tokens')
    await expect(f.ctx.compaction.compactNow(f.agent, new AbortController().signal)).rejects.toMatchObject({ code: 'summary' })
    expect(compactionEvents(f.currentEvents()).map(event => event.type)).toEqual(['compaction/start', 'compaction/end'])
    expect(f.currentEvents().find(event => event.type === 'compaction/start')).toMatchObject({ data: { turn: null } })
    expect(replacements(f.currentEvents())).toEqual([])
    expect(f.agent.session.surface.replaceGeneration).toBe(f.originalGeneration)
    expect(f.agent.session.surface.nodes).toContain(f.oldUserSeq)
    expect(f.adapter.summaries).toHaveLength(1)
    expect(f.forbiddenFetch).not.toHaveBeenCalled()
  })

  it('closes a cancelled automatic summary without landing a checkpoint or dispatching the pending conversation', async () => {
    const f = await fixture('await-abort')
    f.enable()
    f.send(`${currentSentinel}: continue`)
    await Promise.race([f.adapter.summaryStarted.promise, f.agent.whenIdle().then(() => {
      throw new Error('turn settled before the expected cancellable summary started')
    })])
    f.agent.cancel({ kind: 'user' })
    await f.agent.whenIdle()

    expect(compactionEvents(f.currentEvents()).map(event => event.type)).toEqual(['compaction/start', 'compaction/end'])
    expect(replacements(f.currentEvents())).toEqual([])
    expect(f.agent.session.surface.replaceGeneration).toBe(f.originalGeneration)
    expect(f.adapter.conversation).toHaveLength(1)
    expect(f.currentEvents().at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'aborted' } } })
    expect(f.forbiddenFetch).not.toHaveBeenCalled()
  })
})
