/**
 * Exact alpha2 tagged-source integration: real AgentLoop, LLM runtime, token
 * meter and unmodified BasicCompactionEngine. Only the external model and
 * authenticated account snapshot are synthetic. This exercises durable
 * in-memory Session events, not disk persistence, OAuth or live model transport.
 * The existing runner owns source identity/aliases; no private Core imports,
 * history seeding, prototype changes or replacement compaction implementation.
 */
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import BasicCompactionEngine from '@deepseek-ai/dsh-compaction-basic'
import LlmRuntime, { LlmAdapter, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { installCopilotCompactionPressure } from '../../src/compaction-pressure.ts'
import { GITHUB_COPILOT_PREVIEW_PROVIDER_ID as provider } from '../../src/copilot-identity.ts'

const contextWindow = 100_000
const oldSentinel = 'OLD_HISTORY_SENTINEL'
const currentSentinel = 'CURRENT_REQUEST_SENTINEL'
const checkpoint = 'RECOVERY_CHECKPOINT'
const contexts: Context[] = []
type SummaryMode = 'stop' | 'max-tokens' | 'await-abort'

interface RequestObservation {
  readonly provider: string
  readonly model: string
  readonly text: string
  readonly maxTokens: number | undefined
}

function requestText(options: GenerateOptions): string {
  return options.messages.flatMap(message => message.content.flatMap(block => block.type === 'text' ? [block.text] : [])).join('\n')
}

function observeRequest(options: GenerateOptions): RequestObservation {
  return { provider: options.provider, model: options.model, text: requestText(options), maxTokens: options.maxTokens }
}

/** Model double at the public adapter seam; every compaction decision remains Core-owned. */
class FixtureAdapter extends LlmAdapter {
  readonly conversation: RequestObservation[] = []
  readonly summaries: RequestObservation[] = []
  readonly summaryStarted = Promise.withResolvers<void>()

  constructor(readonly summaryMode: SummaryMode) { super() }

  override async resolveModel(route: string, model: string): Promise<LlmResolvedModelInfo> {
    return { provider: route, id: model, name: model, context: { contextWindow }, defaultMaxTokens: 8192 }
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const summary = options.purpose === 'compaction'
    if (summary) {
      this.summaries.push(observeRequest(options))
      this.summaryStarted.resolve()
      if (this.summaryMode === 'await-abort') {
        const signal = options.signal
        if (signal === undefined) throw new Error('fixture summary requires the Core cancellation signal')
        if (!signal.aborted) {
          await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }))
        }
      }
    } else {
      this.conversation.push(observeRequest(options))
    }
    if (options.signal?.aborted) {
      yield { type: 'finish', reason: { kind: 'aborted', failure: { code: 'ABORTED', message: 'fixture cancelled' } } }
      return
    }
    const text = summary ? (this.summaryMode === 'max-tokens' ? 'PARTIAL_CHECKPOINT' : checkpoint) : 'CONVERSATION_REPLY'
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'finish', reason: { kind: summary && this.summaryMode === 'max-tokens' ? 'max-tokens' : 'stop' } }
  }
}

beforeAll(() => {
  expect(process.env.DSH_CORE_EVIDENCE).toBe('tagged-source-runtime')
  expect(process.env.DSH_PUBLISHED_CORE_RELEASE).toBe('0.1.6-alpha.2')
  expect(SESSION_FORMAT_VERSION).toBe(3)
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

async function fixture(mode: SummaryMode = 'stop') {
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
  await ctx.plugin(BasicCompactionEngine, {
    auto: true,
    thresholdRatio: 1,
    retainTokens: 100,
    maxTokens: 8192,
    compactionRetries: 0,
    maxOverflowRetries: 1,
  })
  expect(ctx.compaction).toBeInstanceOf(BasicCompactionEngine)
  expect(ctx.tokenMeter).toBeInstanceOf(TokenMeter)
  const adapter = new FixtureAdapter(mode)
  ctx.llm.registerAdapter([provider], adapter)
  ctx.systemPrompt.section({ name: 'compaction-fixture', order: 0, complete: true, text: () => 'Fixture system guidance.' })

  // Synthetic account ownership only; no discovery, settings or credentials.
  ctx.provide('githubCopilotPreview', { getView: () => ({ provider }) })
  let model = 'fixture-model-A'
  let inputBudgetTokens: number | undefined
  ctx.on('agent/request', async (_payload, next) => ({ ...await next(), provider, model }))
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
  const agent = await ctx.agentLoop.create(id, { provider, model, maxTokens: 8192 })
  const send = (text: string): void => {
    agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
  }
  send(`${oldSentinel} ${'historical detail '.repeat(1000)}`)
  await agent.whenIdle()
  expect(adapter.conversation).toHaveLength(1)
  expect(adapter.summaries).toHaveLength(0)
  expect(events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
  const seedCount = events.length
  const originalGeneration = agent.session.surface.replaceGeneration
  const oldUser = events.find(event => event.type === 'user/message'
    && event.data.content.some(block => block.type === 'text' && block.text.includes(oldSentinel)))
  expect(oldUser).toBeDefined()
  const originalTokens = ctx.tokenMeter.measure(agent.session).totalTokens
  expect(originalTokens).toBeGreaterThan(1000)
  expect(originalTokens).toBeLessThan(contextWindow)

  return {
    ctx, adapter, agent, events, failures, priced, forbiddenFetch, seedCount, originalGeneration, originalTokens,
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

describe('alpha2 stock compaction driven by the Copilot local pressure signal', () => {
  it('shrinks durable history and rebuilds the switched model request without sending the oversized original', async () => {
    const f = await fixture()
    f.enable()
    f.send(`${currentSentinel}: continue with the latest selected model`)
    await f.agent.whenIdle()

    expect(f.agent.options.model).toBe('fixture-model-A')
    expect(f.agent.session.requestHeader()?.config.model).toBe('fixture-model-B')
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
