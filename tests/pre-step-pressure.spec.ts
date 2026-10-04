import type { Context } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { describe, expect, it, vi } from 'vitest'
import { installCopilotPreStepPressure } from '../src/pre-step-pressure.ts'

function fixture() {
  const config = { provider: 'github-copilot-preview', model: 'account-model', maxTokens: 8192 }
  const session = { id: 'session-a', requestHeader: () => ({ config }), append: vi.fn() }
  const measure = vi.fn(() => ({ totalTokens: 900 }))
  const compactIfNeeded = vi.fn(async () => { measure.mockReturnValue({ totalTokens: 600 }); return null })
  const engine = { config: { auto: true, maxOverflowRetries: 1, modelPolicies: [] as object[] }, compactIfNeeded }
  const selection = { pending: null }
  const services = new Map<string, unknown>([
    ['githubCopilotPreview', { getView: () => ({ provider: config.provider }) }],
    ['tokenMeter', { measure }], ['compaction', engine],
    ['sessionProjections', { stateOf: () => selection }],
  ])
  const agent = { session, ctx: { get: (key: string) => services.get(key) } } as unknown as Agent
  type Listener = (payload: { agent: Agent; step: number; signal: AbortSignal },
    next: () => Promise<PreStepDecision>) => Promise<PreStepDecision>
  let listener: Listener | undefined
  const on = vi.fn((_event: string, callback: Listener) => {
    listener = callback; return () => { listener = undefined }
  })
  const logger = { warn: vi.fn() }
  const ctx = { get: (key: string) => services.get(key), logger, on } as unknown as Context
  const resolve = vi.fn((): { inputBudgetTokens: number } | undefined => ({ inputBudgetTokens: 800 }))
  const dispose = installCopilotPreStepPressure(ctx, { resolve })
  const signal = new AbortController()
  const next = vi.fn(async (): Promise<PreStepDecision> => ({ kind: 'enter', messages: [] }))
  const run = (step = 2) => {
    if (listener === undefined) throw new Error('Missing pre-step listener')
    return listener({ agent, signal: signal.signal, step }, next)
  }
  return { config, session, measure, compactIfNeeded, engine, selection, services, agent,
    logger, resolve, dispose, signal, next, run, on }
}

describe('Copilot pre-step pressure prevention', () => {
  it('reduces a continuing committed route before model attempt admission without writing usage', async () => {
    const h = fixture()
    expect(await h.run()).toEqual({ kind: 'enter', messages: [] })
    expect(h.on.mock.calls[0]?.[0]).toBe('agent/pre-step')
    expect(h.compactIfNeeded).toHaveBeenCalledExactlyOnceWith(h.agent, 'context-overflow', h.signal.signal)
    expect(h.measure).toHaveBeenCalledOnce()
    expect(h.session.append).not.toHaveBeenCalled()
    expect(h.next).toHaveBeenCalledOnce()
  })
  it('leaves first-step route resolution and hard admission under their existing owners', async () => {
    const h = fixture()
    await h.run(1)
    expect(h.compactIfNeeded).not.toHaveBeenCalled()
    expect(h.resolve).not.toHaveBeenCalled()
  })
  it('skips pending selection instead of compressing against the previous route', async () => {
    const h = fixture()
    Object.assign(h.selection, { pending: { provider: 'github-copilot-preview', model: 'other-model' } })
    await h.run()
    expect(h.compactIfNeeded).not.toHaveBeenCalled()
    expect(h.resolve).not.toHaveBeenCalled()
  })
  it('skips a selection notice added by another pre-step listener', async () => {
    const h = fixture()
    h.next.mockResolvedValue({ kind: 'enter', messages: [createUserMessage({
      content: [], source: { kind: 'model-selection', form: 'notice', summary: 'change' },
    })] })
    await h.run()
    expect(h.compactIfNeeded).not.toHaveBeenCalled()
  })
  it.each([false, true])('respects automatic recovery and zero retry policy (auto=%s)', async auto => {
    const h = fixture()
    h.engine.config.auto = auto
    h.engine.config.maxOverflowRetries = 0
    await h.run()
    expect(h.compactIfNeeded).not.toHaveBeenCalled()
  })
  it('does not borrow the global engine when the bound preset has no compaction', async () => {
    const h = fixture()
    h.services.set('agentPresets', { composedPreset: () => 'isolated', serviceFor: () => undefined })
    await h.run()
    expect(h.compactIfNeeded).not.toHaveBeenCalled()
  })
  it('uses the current Agent preset service', async () => {
    const h = fixture()
    const serviceFor = vi.fn(() => h.engine)
    h.services.set('agentPresets', { composedPreset: () => 'isolated', serviceFor })
    await h.run()
    expect(serviceFor).toHaveBeenCalledExactlyOnceWith(h.agent, 'compaction')
    expect(h.compactIfNeeded).toHaveBeenCalledOnce()
  })
  it('respects the committed model policy instead of unrelated model policies', async () => {
    const h = fixture()
    h.engine.config.modelPolicies = [
      { provider: h.config.provider, model: 'another-model', maxOverflowRetries: 1 },
      { provider: h.config.provider, model: h.config.model, maxOverflowRetries: 0 },
    ]
    await h.run()
    expect(h.compactIfNeeded).not.toHaveBeenCalled()
  })
  it('keeps account invalidation and other routes under final admission', async () => {
    const h = fixture()
    h.resolve.mockReturnValue(undefined)
    await h.run()
    expect(h.compactIfNeeded).not.toHaveBeenCalled()
    expect(h.measure).not.toHaveBeenCalled()
    h.resolve.mockClear()
    h.config.provider = 'other-provider'
    await h.run()
    expect(h.resolve).not.toHaveBeenCalled()
  })
  it.each([-1, NaN, 1.5])('delegates invalid overflow policies with a named diagnostic (%s)', async retries => {
    const h = fixture()
    h.engine.config.maxOverflowRetries = retries
    await h.run()
    expect(h.compactIfNeeded).not.toHaveBeenCalled()
    expect(h.logger.warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('COPILOT_PRE_STEP_PRESSURE_UNAVAILABLE'))
  })
  it('does not compact after cancellation before pre-step inspection', async () => {
    const h = fixture()
    h.signal.abort()
    await h.run()
    expect(h.resolve).not.toHaveBeenCalled()
    expect(h.compactIfNeeded).not.toHaveBeenCalled()
  })
  it('does not start an artificial attempt or a second recovery loop when compaction fails', async () => {
    const h = fixture()
    const cause = new Error('synthetic native compaction failure')
    h.compactIfNeeded.mockRejectedValue(cause)
    await expect(h.run()).rejects.toBe(cause)
    expect(h.compactIfNeeded).toHaveBeenCalledOnce()
    expect(h.session.append).not.toHaveBeenCalled()
  })
  it('retains the existing final fallback when native reduction makes no progress', async () => {
    const h = fixture()
    h.compactIfNeeded.mockImplementation(async () => null)
    expect(await h.run()).toEqual({ kind: 'enter', messages: [] })
    expect(h.compactIfNeeded).toHaveBeenCalledOnce()
  })
  it('cancellation wins before admission', async () => {
    const h = fixture()
    const cause = new Error('cancel')
    h.compactIfNeeded.mockImplementation(async () => { h.signal.abort(cause); return null })
    await expect(h.run()).rejects.toBe(cause)
  })
  it('delegates rejected decisions and below-budget contexts', async () => {
    const h = fixture()
    h.next.mockResolvedValue({ kind: 'reject' })
    expect(await h.run()).toEqual({ kind: 'reject' })
    expect(h.resolve).not.toHaveBeenCalled()
    h.next.mockResolvedValue({ kind: 'enter', messages: [] })
    h.measure.mockReturnValue({ totalTokens: 800 })
    await h.run()
    expect(h.compactIfNeeded).not.toHaveBeenCalled()
  })
  it('fails closed to existing admission if projection evidence is absent or unreadable', async () => {
    const h = fixture()
    h.services.delete('sessionProjections')
    await h.run()
    expect(h.compactIfNeeded).not.toHaveBeenCalled()
    expect(h.logger.warn).toHaveBeenCalledOnce()
    h.services.set('sessionProjections', { stateOf: () => { throw new Error('sensitive') } })
    await h.run()
    expect(h.logger.warn).toHaveBeenCalledOnce()
    expect(h.logger.warn.mock.calls[0]?.[0]).not.toContain('sensitive')
  })
  it('disposes only its own reversible listener', () => {
    const h = fixture()
    h.dispose()
    expect(() => h.run()).toThrow('Missing pre-step listener')
  })
})
