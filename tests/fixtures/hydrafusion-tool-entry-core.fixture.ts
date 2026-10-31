/**
 * Public rc.3 tool-entry boundary, not an SDK bridge or Fusion execution.
 * The first suite calls ToolRuntime outside a turn. The second drives a native
 * turn with a synthetic adapter and tool. Neither starts an SDK or Fusion run.
 */
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { LlmAdapter, ToolCallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk, ToolCallBlock } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import Projections from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools, { defineTool, type PreToolDecision, type ToolExecution, type ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { HydraFusionToolHandoff } from '../../src/hydrafusion-tool-handoff.ts'
import type { HydraFusionNativeToolReply, HydraFusionNativeTurn } from '../../src/hydrafusion-tool-handoff.ts'

const contexts: Context[] = []

beforeAll(() => {
  expect(['tagged-source-runtime', 'published-artifact-runtime']).toContain(process.env.DSH_CORE_EVIDENCE)
  expect(process.env.DSH_PUBLISHED_CORE_RELEASE).toBe('0.2.1-rc.3')
})

afterEach(async () => {
  try {
    const outcomes = await Promise.allSettled(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
    const failures = outcomes.filter((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected')
    if (failures.length > 0) throw new AggregateError(failures.map(outcome => outcome.reason), 'tool-entry fixture cleanup failed')
  } finally {
    vi.unstubAllGlobals()
  }
})

async function fixture(body: (signal: AbortSignal) => Promise<string> = async () => 'synthetic-result') {
  const ctx = new Context()
  contexts.push(ctx)
  const fetch = vi.fn((): never => { throw new Error('tool-entry-fixture-network-forbidden') })
  vi.stubGlobal('fetch', fetch)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(Projections)
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(Tools, {})
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop, { agents: [] })
  const id = SessionId('hydrafusion-tool-entry-fixture')
  const events: SessionEvent[] = []
  ctx.on('session/event', (session, event) => { if (session.id === id) events.push(event) })
  const { agent } = await ctx.agents.create({ sessionId: id })
  let requests = 0
  ctx.on('agent/request', async (_payload, next) => { requests++; return next() })
  const signals: AbortSignal[] = []
  const results: ToolExecutionResult[] = []
  const tokens: ToolExecution['token'][] = []
  ctx.on('tools/result', (exec, result) => { tokens.push(exec.token); results.push(result) })
  ctx.tools.register(defineTool({
    name: 'synthetic_tool_entry',
    description: 'In-memory test tool; no external effects.',
    parameters: {},
    output: { schema: { type: 'string' }, render: (_args, text) => [{ type: 'text', text }] },
    async execute(_args, exec) {
      expect(ctx.agents.requireInitiator().id).toBe(agent.id)
      expect(exec.agent?.id).toBe(agent.id)
      signals.push(exec.signal)
      return body(exec.signal)
    },
  }))
  const invoke = (signal = new AbortController().signal) => ctx.agents.withInitiator(agent, () => ctx.tools.execute({
    callId: ToolCallId('synthetic-call'),
    name: 'synthetic_tool_entry',
    arguments: {},
    agent,
    signal,
  }))
  return { ctx, agent, invoke, signals, results, tokens, events, fetch, requests: () => requests }
}

const nativeProvider = 'synthetic-native-tool-entry'
const nativeModel = 'synthetic-native-model'
const nativeCallId = ToolCallId('synthetic-native-call')
const nativeToolName = 'synthetic_native_tool'

class NativeTurnAdapter extends LlmAdapter {
  handoffStep?: (options: GenerateOptions) => Promise<ToolCallBlock | undefined>
  readonly requests: {
    sessionId: GenerateOptions['sessionId']
    signal: GenerateOptions['signal']
    results: { callId: string; isError: boolean | undefined; text: string }[]
  }[] = []

  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return { provider, id: model, name: model, context: { contextWindow: 100_000 }, defaultMaxTokens: 1024 }
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const pending = await this.handoffStep?.(options)
    const results = options.messages.flatMap(message => message.role === 'tool' ? [{
      callId: message.toolCallId,
      isError: message.isError,
      text: message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join(''),
    }] : [])
    this.requests.push({ sessionId: options.sessionId, signal: options.signal, results })
    if (this.requests.length === 1) {
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'block-end', index: 0, block: pending ?? {
        type: 'tool-call', id: nativeCallId, name: nativeToolName, arguments: '{}',
      } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'synthetic final answer' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

async function nativeTurnFixture(options: {
  conclude?: boolean
  body?: (signal: AbortSignal) => Promise<string>
} = {}) {
  const f = await fixture()
  const adapter = new NativeTurnAdapter()
  f.ctx.llm.registerAdapter([nativeProvider], adapter)
  f.ctx.systemPrompt.section({ name: 'synthetic-native-tool-entry', order: 0, complete: true,
    text: () => 'Synthetic native tool-entry fixture.' })
  const admissions: { turn: number; step: number; signal: AbortSignal }[] = []
  f.ctx.on('agent/request', async ({ turn, step, signal }, next) => {
    admissions.push({ turn, step, signal })
    return { ...await next(), provider: nativeProvider, model: nativeModel }
  })
  const toolSignals: AbortSignal[] = []
  f.ctx.tools.register(defineTool({
    name: nativeToolName,
    description: 'In-memory native-loop test tool; no external effects.',
    parameters: {},
    output: { schema: { type: 'string' }, render: (_args, text) => [{ type: 'text', text }] },
    async execute(_args, exec) {
      expect(f.ctx.agents.requireInitiator().id).toBe(f.agent.id)
      expect(exec.agent?.id).toBe(f.agent.id)
      toolSignals.push(exec.signal)
      const value = await (options.body?.(exec.signal) ?? Promise.resolve('synthetic native result'))
      if (options.conclude) exec.concludeTurn()
      return value
    },
  }))
  const send = () => f.agent.followup(createUserMessage({
    content: [{ type: 'text', text: 'Run the synthetic native tool.' }],
    source: { kind: 'user' },
  }))
  return { ...f, adapter, admissions, toolSignals, send }
}

async function handoffFixture(options: Parameters<typeof nativeTurnFixture>[0] = {}) {
  const f = await nativeTurnFixture(options)
  const transport = {
    submitResult: vi.fn(async (_reply: HydraFusionNativeToolReply, _signal: AbortSignal) => {}),
    requestStop: vi.fn(async () => {}),
    whenIdle: vi.fn(async () => {}),
  }
  const requests: GenerateOptions[] = []
  let bound: { scope: HydraFusionNativeTurn; handoff: HydraFusionToolHandoff } | undefined
  let cursor = 0
  const binding = () => {
    if (!bound) throw new Error('synthetic handoff has not entered a native turn')
    return bound
  }
  const collectAndFlush = async () => {
    const { handoff, scope } = binding()
    for (; cursor < f.events.length; cursor++) {
      const event = f.events[cursor]
      if (event?.type === 'tool/call' || event?.type === 'tool/result') handoff.record(scope, event)
    }
    const flushed = await handoff.flush(scope)
    if (flushed.status !== 'complete') throw new Error('FUSION_TOOL_RESULTS_PENDING')
  }
  f.adapter.handoffStep = async request => {
    requests.push(request)
    const admission = f.admissions.at(-1)
    if (!admission || request.sessionId !== f.agent.session.id || request.signal !== admission.signal) {
      throw new Error('synthetic native admission mismatch')
    }
    if (!bound) {
      const scope = { sessionId: f.agent.session.id, turn: admission.turn, signal: admission.signal }
      const handoff = new HydraFusionToolHandoff(scope, () => {
        if (f.events.some(event => event.type === 'turn/end' && event.data.turn === scope.turn)) {
          throw new Error('synthetic native turn closed')
        }
      }, transport)
      bound = { scope, handoff }
      cursor = f.events.length
      // This is an internal fake pending call, not an SDK RPC or Tool handler.
      return handoff.project(scope, { id: nativeCallId, name: nativeToolName, arguments: '{}' })
    }
    if (admission.turn !== bound.scope.turn || request.signal !== bound.scope.signal) {
      throw new Error('synthetic native handoff scope changed')
    }
    await collectAndFlush()
    return undefined
  }
  f.agent.ctx.on('agent/turn-stopping', collectAndFlush)
  return { ...f, transport, binding, requests }
}

describe('Fusion candidate public native tool entry (not turn integration)', () => {
  it('executes with causal attribution but does not admit a turn or append native history', async () => {
    const f = await fixture()
    const eventCount = f.events.length
    const result = await f.invoke()
    expect(result).toMatchObject({ isError: false, value: 'synthetic-result' })
    expect(f.results).toHaveLength(1)
    expect(f.results[0]).toBe(result)
    expect(Object.isFrozen(result)).toBe(true)
    expect(f.requests()).toBe(0)
    expect(f.events).toHaveLength(eventCount)
    expect(f.agent.status).toBe('idle')
    expect(f.fetch).not.toHaveBeenCalled()
  })

  it('does not deduplicate repeated call IDs on behalf of an SDK consumer', async () => {
    const f = await fixture()
    await f.invoke()
    await f.invoke()
    expect(f.signals).toHaveLength(2)
    expect(f.results).toHaveLength(2)
    expect(new Set(f.tokens).size).toBe(2)
  })

  it('honors a scoped monotonic guard after an allowing pre-execute hook', async () => {
    const f = await fixture()
    f.ctx.on('tools/pre-execute', async (): Promise<PreToolDecision> => ({ kind: 'allow' }))
    f.agent.ctx.tools.guard(() => 'synthetic-scoped-denial')
    expect(await f.invoke()).toMatchObject({ isError: true, error: { message: 'synthetic-scoped-denial' } })
    expect(f.signals).toHaveLength(0)
    expect(f.results).toHaveLength(1)
  })

  it('denies an ask when no approval service is composed', async () => {
    const f = await fixture()
    f.ctx.on('tools/pre-execute', async (): Promise<PreToolDecision> => ({ kind: 'ask', reason: 'synthetic-approval-required' }))
    expect(await f.invoke()).toMatchObject({ isError: true, error: { message: 'synthetic-approval-required' } })
    expect(f.signals).toHaveLength(0)
  })

  it('normalizes a thrown body failure through post-execute and final notification', async () => {
    const f = await fixture(async () => { throw new Error('synthetic-body-failure') })
    const postResults: ToolExecutionResult[] = []
    f.ctx.on('tools/post-execute', async (_exec, result, next) => { postResults.push(result); return next() })
    const result = await f.invoke()
    expect(result).toMatchObject({ isError: true, error: { message: 'synthetic-body-failure' } })
    expect(postResults).toHaveLength(1)
    expect(postResults[0]?.isError).toBe(true)
    expect(f.results).toHaveLength(1)
    expect(f.results[0]).toBe(result)
  })

  it('waits for a cancelled admission hook and never invokes the body', async () => {
    const f = await fixture()
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    f.ctx.on('tools/pre-execute', async (): Promise<PreToolDecision> => {
      entered.resolve()
      await release.promise
      return { kind: 'allow' }
    })
    const controller = new AbortController()
    const pending = f.invoke(controller.signal)
    try {
      await Promise.race([entered.promise, pending.then(() => { throw new Error('admission hook did not enter') })])
      controller.abort()
      await Promise.resolve()
      expect(f.results).toHaveLength(0)
      expect(f.signals).toHaveLength(0)
    } finally {
      release.resolve()
      await pending
    }
    expect(await pending).toMatchObject({ isError: true, error: { info: { code: 'ABORTED_BEFORE_DISPATCH' } } })
    expect(f.signals).toHaveLength(0)
    expect(f.results).toHaveLength(1)
  })

  it('drains a started body and fences its late success without treating native idle as quiescence', async () => {
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const f = await fixture(async () => { entered.resolve(); await release.promise; return 'late-success' })
    const controller = new AbortController()
    const pending = f.invoke(controller.signal)
    try {
      await Promise.race([entered.promise, pending.then(() => { throw new Error('tool body did not enter') })])
      controller.abort()
      await Promise.resolve()
      expect(f.signals[0]?.aborted).toBe(true)
      expect(f.results).toHaveLength(0)
      // This call is outside the native driver; whenIdle does not own it.
      await f.agent.whenIdle()
      expect(f.agent.status).toBe('idle')
      expect(f.results).toHaveLength(0)
    } finally {
      release.resolve()
      await pending
    }
    expect(await pending).toMatchObject({ isError: true, error: { info: { code: 'ABORTED' } } })
    expect(f.results).toHaveLength(1)
    expect(f.fetch).not.toHaveBeenCalled()
  })
})

describe('Fusion candidate native-turn boundary (no SDK bridge)', () => {
  it('records one native tool call and result before the next model step', async () => {
    const f = await nativeTurnFixture()
    f.send()
    await f.agent.whenIdle()

    expect(f.toolSignals).toHaveLength(1)
    expect(f.admissions.map(({ turn, step }) => ({ turn, step }))).toEqual([
      { turn: 1, step: 1 }, { turn: 1, step: 2 },
    ])
    expect(f.admissions[1]?.signal).toBe(f.admissions[0]?.signal)
    expect(f.adapter.requests).toHaveLength(2)
    expect(f.adapter.requests[0]?.sessionId).toBe(f.agent.session.id)
    expect(f.adapter.requests[1]?.signal).toBe(f.admissions[0]?.signal)
    expect(f.adapter.requests[1]?.results).toEqual([{
      callId: nativeCallId, isError: false, text: 'synthetic native result',
    }])

    const calls = f.events.filter(event => event.type === 'tool/call')
    const results = f.events.filter(event => event.type === 'tool/result')
    expect(calls).toHaveLength(1)
    expect(results).toHaveLength(1)
    expect(calls[0]).toMatchObject({ data: { turn: 1, step: 1, callId: nativeCallId } })
    expect(results[0]).toMatchObject({
      data: { turn: 1, step: 1, message: { role: 'tool', toolCallId: nativeCallId, isError: false } },
      sourceEventSeqs: [calls[0]?.seq],
    })
    const secondStep = f.events.find(event => event.type === 'step/start' && event.data.step === 2)
    expect(calls[0]?.seq).toBeLessThan(results[0]?.seq ?? 0)
    expect(results[0]?.seq).toBeLessThan(secondStep?.seq ?? 0)
    const messages = f.events.filter(event => event.type === 'assistant/message')
    expect(messages).toHaveLength(2)
    expect(messages.every(event => event.data.usage === undefined)).toBe(true)
    expect(messages.flatMap(event => event.data.message.content.flatMap(block =>
      block.type === 'text' ? [block.text] : []))).toEqual(['synthetic final answer'])
    expect(f.events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
    expect(f.fetch).not.toHaveBeenCalled()
  })

  it('feeds a scoped native guard denial back without invoking the tool', async () => {
    const f = await nativeTurnFixture()
    f.agent.ctx.tools.guard(() => 'synthetic native denial')
    f.send()
    await f.agent.whenIdle()

    expect(f.toolSignals).toHaveLength(0)
    expect(f.adapter.requests).toHaveLength(2)
    expect(f.adapter.requests[1]?.results).toEqual([{
      callId: nativeCallId, isError: true, text: 'Error: synthetic native denial',
    }])
    expect(f.events.filter(event => event.type === 'tool/call')).toHaveLength(1)
    expect(f.events.filter(event => event.type === 'tool/result')).toHaveLength(1)
    expect(f.events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
  })

  it('does not start another model step when a native tool concludes the turn', async () => {
    const f = await nativeTurnFixture({ conclude: true })
    f.send()
    await f.agent.whenIdle()

    expect(f.toolSignals).toHaveLength(1)
    expect(f.adapter.requests).toHaveLength(1)
    expect(f.events.filter(event => event.type === 'tool/call')).toHaveLength(1)
    expect(f.events.filter(event => event.type === 'tool/result')).toHaveLength(1)
    expect(f.events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
  })

  it('awaits the native stopping hook after a concluding tool result', async () => {
    const entered = Promise.withResolvers<{ turn: number; signal: AbortSignal }>()
    const release = Promise.withResolvers<void>()
    const f = await nativeTurnFixture({ conclude: true })
    f.agent.ctx.on('agent/turn-stopping', async ({ turn, signal }) => {
      entered.resolve({ turn, signal })
      await release.promise
    })
    f.send()
    const idle = f.agent.whenIdle()
    let settled = false
    void idle.then(() => { settled = true })
    try {
      const stopping = await Promise.race([
        entered.promise,
        idle.then(() => { throw new Error('native stopping hook was not reached') }),
      ])
      expect(stopping.turn).toBe(1)
      expect(stopping.signal).toBe(f.admissions[0]?.signal)
      const result = f.events.find(event => event.type === 'tool/result')
      const stepEnd = f.events.find(event => event.type === 'step/end')
      expect(result?.seq).toBeLessThan(stepEnd?.seq ?? 0)
      expect(f.events.filter(event => event.type === 'turn/end')).toHaveLength(0)
      expect(f.agent.status).toBe('running')
      expect(settled).toBe(false)
    } finally {
      release.resolve()
      await idle
    }
    expect(f.events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
  })

  it('waits for a cancelled native tool and records its result without another model step', async () => {
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const f = await nativeTurnFixture({
      body: async () => { entered.resolve(); await release.promise; return 'late synthetic result' },
    })
    const stopping = vi.fn()
    f.agent.ctx.on('agent/turn-stopping', stopping)
    f.send()
    const idle = f.agent.whenIdle()
    let settled = false
    void idle.then(() => { settled = true })
    try {
      await Promise.race([entered.promise, idle.then(() => { throw new Error('native tool did not start') })])
      f.agent.cancel({ kind: 'user' })
      await Promise.resolve()
      expect(f.toolSignals[0]?.aborted).toBe(true)
      expect(settled).toBe(false)
    } finally {
      release.resolve()
      await idle
    }

    expect(f.adapter.requests).toHaveLength(1)
    expect(f.events.filter(event => event.type === 'tool/call')).toHaveLength(1)
    const results = f.events.filter(event => event.type === 'tool/result')
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({
      data: { message: { role: 'tool', toolCallId: nativeCallId, isError: true }, error: { code: 'ABORTED' } },
    })
    expect(stopping).not.toHaveBeenCalled()
    expect(f.events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'aborted' } } })
    expect(f.fetch).not.toHaveBeenCalled()
  })
})

describe('Fusion internal transport through native tool ownership (no SDK)', () => {
  it.each([false, true])('rejects an unpaired call at the native boundary (concluding: %s)', async conclude => {
    const f = await handoffFixture({
      conclude,
      body: async (): Promise<string> => {
        const { handoff, scope } = f.binding()
        handoff.project(scope, { id: ToolCallId('synthetic-unpaired-call'), name: nativeToolName, arguments: '{}' })
        return 'synthetic native result'
      },
    })
    f.send()
    await f.agent.whenIdle()
    try {
      expect(f.transport.submitResult).toHaveBeenCalledTimes(1)
      expect(f.events.filter(event => event.type === 'tool/result')).toHaveLength(1)
      expect(f.events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'error' } } })
    } finally {
      await f.binding().handoff.stopAndDrain()
    }
  })

  it.each(['success', 'failure', 'denied'])('returns the native %s result once to the internal transport', async outcome => {
    const f = await handoffFixture({
      body: async () => {
        if (outcome === 'failure') throw new Error('synthetic tool failure')
        return 'synthetic native result'
      },
    })
    if (outcome === 'denied') f.agent.ctx.tools.guard(() => 'synthetic native denial')
    f.send()
    await f.agent.whenIdle()
    try {
      expect(f.toolSignals).toHaveLength(outcome === 'denied' ? 0 : 1)
      const calls = f.events.filter(event => event.type === 'tool/call')
      const results = f.events.filter(event => event.type === 'tool/result')
      expect(calls).toHaveLength(1)
      expect(results).toHaveLength(1)
      expect(f.transport.submitResult).toHaveBeenCalledTimes(1)
      expect(f.transport.submitResult.mock.calls[0]).toEqual([{
        sessionId: f.agent.session.id, turn: 1, callSeq: calls[0]?.seq, resultSeq: results[0]?.seq,
        message: results[0]?.data.message,
      }, f.binding().scope.signal])
      expect(results[0]?.data.message.isError).toBe(outcome !== 'success')
      expect(f.binding().handoff.snapshot()).toMatchObject({ lifecycle: 'active', acknowledged: 1 })
      expect(f.events.filter(event => event.type === 'assistant/message').every(event => event.data.usage === undefined)).toBe(true)
      expect(f.fetch).not.toHaveBeenCalled()
    } finally {
      await f.binding().handoff.stopAndDrain()
    }
  })

  it('submits a concluding tool result at the awaited stopping hook without another model step', async () => {
    const f = await handoffFixture({ conclude: true })
    f.send()
    await f.agent.whenIdle()
    try {
      expect(f.adapter.requests).toHaveLength(1)
      expect(f.transport.submitResult).toHaveBeenCalledTimes(1)
      expect(f.events.filter(event => event.type === 'tool/result')).toHaveLength(1)
      expect(f.events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
    } finally {
      await f.binding().handoff.stopAndDrain()
    }
  })

  it('retains the native turn and result identity when steering continues after a stopping hook', async () => {
    const f = await handoffFixture()
    let steered = false
    f.agent.ctx.on('agent/turn-stopping', () => {
      if (steered) return
      steered = true
      f.agent.steer(createUserMessage({
        source: { kind: 'user' }, content: [{ type: 'text', text: 'synthetic steering' }],
      }))
    })
    f.send()
    await f.agent.whenIdle()
    try {
      expect(f.requests).toHaveLength(3)
      expect(f.admissions.map(row => row.turn)).toEqual([1, 1, 1])
      expect(f.requests.every(request => request.signal === f.binding().scope.signal)).toBe(true)
      expect(f.requests[2]?.messages.some(message => message.role === 'user'
        && message.content.some(block => block.type === 'text' && block.text === 'synthetic steering'))).toBe(true)
      expect(f.transport.submitResult).toHaveBeenCalledTimes(1)
      expect(f.events.filter(event => event.type === 'tool/result')).toHaveLength(1)
    } finally {
      await f.binding().handoff.stopAndDrain()
    }
  })

  it('keeps external drain separate from native idle and rejects cancelled late results', async () => {
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const externalIdle = Promise.withResolvers<void>()
    const f = await handoffFixture({
      body: async () => { entered.resolve(); await release.promise; return 'late synthetic result' },
    })
    f.transport.whenIdle.mockImplementation(() => externalIdle.promise)
    f.send()
    const nativeIdle = f.agent.whenIdle()
    let drain: Promise<void> | undefined
    try {
      await Promise.race([entered.promise, nativeIdle.then(() => { throw new Error('native tool did not start') })])
      f.agent.cancel({ kind: 'user' })
      drain = f.binding().handoff.stopAndDrain()
      release.resolve()
      await nativeIdle
      expect(f.agent.status).toBe('idle')
      expect(f.binding().handoff.snapshot().lifecycle).toBe('stopping')
      expect(f.transport.submitResult).not.toHaveBeenCalled()
      const result = f.events.find(event => event.type === 'tool/result')
      if (!result) throw new Error('native cancellation result missing')
      expect(() => f.binding().handoff.record(f.binding().scope, result)).toThrow('FUSION_TOOL_NOT_ACTIVE')
    } finally {
      release.resolve()
      externalIdle.resolve()
      await nativeIdle
      await drain
    }
    expect(f.binding().handoff.snapshot()).toEqual({ lifecycle: 'idle', acknowledged: 0 })
  })

  it('preserves a terminal native error when transport delivery is uncertain', async () => {
    const f = await handoffFixture()
    f.transport.submitResult.mockRejectedValue(new Error('synthetic transport failure'))
    f.send()
    await f.agent.whenIdle()
    try {
      expect(f.transport.submitResult).toHaveBeenCalledTimes(1)
      expect(f.events.filter(event => event.type === 'tool/result')).toHaveLength(1)
      expect(f.events.at(-1)).toMatchObject({ type: 'turn/end', data: { reason: { kind: 'error' } } })
      expect(f.binding().handoff.snapshot()).toMatchObject({ lifecycle: 'blocked', acknowledged: 0 })
    } finally {
      await f.binding().handoff.stopAndDrain()
    }
  })
})
