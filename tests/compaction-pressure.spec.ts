import type { Context } from '@deepseek-ai/cordis'
import { callConfigEquals, markAgentLoopRequest } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmCallConfig, StreamChunk } from '@deepseek-ai/dsh-llm'
import { describe, expect, it, vi } from 'vitest'
import { installCopilotCompactionPressure } from '../src/compaction-pressure.ts'
import { GITHUB_COPILOT_PREVIEW_PROVIDER_ID as provider } from '../src/copilot-identity.ts'

type Middleware = (request: GenerateOptions, next: () => AsyncIterable<StreamChunk>) => AsyncIterable<StreamChunk>

function fixture() {
  const config: LlmCallConfig = { provider, model: 'account-model', maxTokens: 8192 }
  const session = { id: 'session-a', requestHeader: vi.fn(() => ({ config })), append: vi.fn() }
  const owner = { session, options: { provider: 'old-provider', model: 'old-model' } }
  const measure = vi.fn(() => ({ totalTokens: 900 }))
  const compactIfNeeded = vi.fn()
  const compaction = { config: { auto: true, maxOverflowRetries: 1, modelPolicies: [] as object[] }, compactIfNeeded }
  const services = new Map<string, unknown>([
    ['agents', { currentInitiator: vi.fn(() => owner) }],
    ['githubCopilotPreview', { getView: () => ({ provider }) }],
    ['tokenMeter', { measure }],
    ['compaction', compaction],
  ])
  let middleware: Middleware | undefined
  const warn = vi.fn()
  const on = vi.fn((_event: string, listener: Middleware, _options: unknown) => {
    middleware = listener
    return () => { middleware = undefined }
  })
  const ctx = { get: (key: string) => services.get(key), on, logger: { warn } } as unknown as Context
  const resolve = vi.fn((_request: GenerateOptions): { inputBudgetTokens: number } | undefined => ({ inputBudgetTokens: 800 }))
  const next = vi.fn(async function* (): AsyncGenerator<StreamChunk> {
    yield { type: 'finish', reason: { kind: 'stop' } }
  })
  const request = (overrides: Partial<GenerateOptions> = {}, marked = true): GenerateOptions => {
    const options: GenerateOptions = {
      ...config, messages: [], sessionId: session.id as NonNullable<GenerateOptions['sessionId']>, ...overrides,
    }
    return Object.freeze(marked ? markAgentLoopRequest(options) : options)
  }
  const stream = (options = request()): AsyncIterable<StreamChunk> => middleware === undefined ? next() : middleware(options, next)
  const run = async (options = request()): Promise<StreamChunk[]> => {
    const chunks: StreamChunk[] = []
    for await (const chunk of stream(options)) chunks.push(chunk)
    return chunks
  }
  const dispose = installCopilotCompactionPressure(ctx, { resolve })
  return { config, session, owner, services, measure, compactIfNeeded, compaction, warn, on, resolve, next, request, stream, run, dispose }
}

const delegated = [{ type: 'finish', reason: { kind: 'stop' } }]

describe('Copilot compaction pressure', () => {
  it('emits a local terminal overflow before dispatch without mutating the frozen request or history', async () => {
    const h = fixture()
    const request = h.request()
    const chunks = await h.run(request)
    expect(chunks).toEqual([{
      type: 'finish', reason: { kind: 'error', failure: {
        code: 'CONTEXT_WINDOW_EXCEEDED',
        message: 'Copilot local estimated input budget exceeded (900 estimated tokens > 800 budget tokens); requesting stock compaction before provider dispatch.',
      } },
    }])
    expect(h.next).not.toHaveBeenCalled()
    expect(h.measure).toHaveBeenCalledExactlyOnceWith(h.session)
    expect(h.compactIfNeeded).not.toHaveBeenCalled()
    expect(h.session.append).not.toHaveBeenCalled()
    expect(Object.isFrozen(request)).toBe(true)
    expect(callConfigEquals(request, h.config)).toBe(true)
    expect(h.warn).not.toHaveBeenCalled()
  })

  it.each([0, 799, 800])('delegates at or below budget (%s)', async (totalTokens) => {
    const h = fixture()
    h.measure.mockReturnValue({ totalTokens })
    expect(await h.run()).toEqual(delegated)
    expect(h.next).toHaveBeenCalledOnce()
  })

  it('remeasures a rebuilt request after stock reduction without owning retry state', async () => {
    const h = fixture()
    expect(await h.run()).not.toEqual(delegated)
    h.measure.mockReturnValue({ totalTokens: 600 })
    expect(await h.run()).toEqual(delegated)
    expect(h.measure).toHaveBeenCalledTimes(2)
    expect(h.next).toHaveBeenCalledOnce()
  })

  it.each([
    ['another provider', { provider: 'github-copilot' }, true],
    ['compaction call', { purpose: 'compaction' }, true],
    ['title call', { purpose: 'session-title' }, true],
    ['unmarked call', {}, false],
    ['missing session', { sessionId: undefined }, true],
    ['another session', { sessionId: 'session-b' }, true],
  ] as const)('delegates %s without measuring', async (_name, changes, marked) => {
    const h = fixture()
    expect(await h.run(h.request(changes as Partial<GenerateOptions>, marked))).toEqual(delegated)
    expect(h.measure).not.toHaveBeenCalled()
  })

  it('requires ownership of the managed provider rather than its spelling alone', async () => {
    const h = fixture()
    h.services.delete('githubCopilotPreview')
    expect(await h.run()).toEqual(delegated)
    expect(h.resolve).not.toHaveBeenCalled()
  })

  it('uses the committed switched route, never stale Agent.options', async () => {
    const h = fixture()
    expect(h.owner.options.model).not.toBe(h.config.model)
    expect(await h.run()).not.toEqual(delegated)
    expect(h.resolve).toHaveBeenCalledWith(expect.objectContaining({ model: h.config.model }))
  })

  it.each([
    { provider: 'old-provider' }, { model: 'old-model' }, { maxTokens: 4096 }, { temperature: 0.5 },
  ])('skips a mismatched committed config %j', async (changes) => {
    const h = fixture()
    const request = h.request()
    Object.assign(h.config, changes)
    expect(await h.run(request)).toEqual(delegated)
    expect(h.measure).not.toHaveBeenCalled()
    expect(h.resolve).not.toHaveBeenCalled()
  })

  it('skips an absent header', async () => {
    const h = fixture()
    h.session.requestHeader.mockReturnValue(undefined as unknown as ReturnType<typeof h.session.requestHeader>)
    expect(await h.run()).toEqual(delegated)
    expect(h.measure).not.toHaveBeenCalled()
  })

  it('skips absent or revoked authenticated budget evidence', async () => {
    const h = fixture()
    h.resolve.mockReturnValue(undefined)
    expect(await h.run()).toEqual(delegated)
    expect(h.measure).not.toHaveBeenCalled()
    expect(h.warn).not.toHaveBeenCalled()
  })

  it.each([0, -1, NaN, Infinity, 1.5])('skips invalid budget %s for the native hard guard', async (inputBudgetTokens) => {
    const h = fixture()
    h.resolve.mockReturnValue({ inputBudgetTokens })
    expect(await h.run()).toEqual(delegated)
    expect(h.measure).not.toHaveBeenCalled()
  })

  it.each(['agents', 'tokenMeter', 'compaction'])('skips missing optional %s and bounds its diagnostic', async (service) => {
    const h = fixture()
    h.services.delete(service)
    expect(await h.run()).toEqual(delegated)
    expect(await h.run()).toEqual(delegated)
    expect(h.warn).toHaveBeenCalledOnce()
    expect(h.warn.mock.calls[0]?.[0]).toContain('COPILOT_COMPACTION_PRESSURE_UNAVAILABLE')
  })

  it('skips an agentless invocation without substituting another Session', async () => {
    const h = fixture()
    h.services.set('agents', { currentInitiator: () => undefined })
    expect(await h.run()).toEqual(delegated)
    expect(h.measure).not.toHaveBeenCalled()
  })

  it.each([
    { config: { auto: true } },
    { compactIfNeeded: () => undefined },
  ])('skips an unsupported stock compaction shape %j', async (compaction) => {
    const h = fixture()
    h.services.set('compaction', compaction)
    expect(await h.run()).toEqual(delegated)
    expect(h.measure).not.toHaveBeenCalled()
  })

  it('respects deliberately disabled automatic compaction without warnings', async () => {
    const h = fixture()
    h.compaction.config.auto = false
    expect(await h.run()).toEqual(delegated)
    expect(h.measure).not.toHaveBeenCalled()
    expect(h.warn).not.toHaveBeenCalled()
  })

  it('respects deliberately disabled overflow recovery, including exact model overrides', async () => {
    const h = fixture()
    h.compaction.config.maxOverflowRetries = 0
    expect(await h.run()).toEqual(delegated)
    h.compaction.config.maxOverflowRetries = 1
    h.compaction.config.modelPolicies.push({ provider, model: h.config.model, maxOverflowRetries: 0 })
    expect(await h.run()).toEqual(delegated)
    expect(h.measure).not.toHaveBeenCalled()
    expect(h.warn).not.toHaveBeenCalled()
  })

  it('allows an exact model override to enable stock recovery', async () => {
    const h = fixture()
    h.compaction.config.maxOverflowRetries = 0
    h.compaction.config.modelPolicies.push({ provider, model: h.config.model, maxOverflowRetries: 1 })
    expect(await h.run()).not.toEqual(delegated)
  })

  it.each([-1, NaN, Infinity, 1.5])('delegates invalid meter price %s instead of inventing pressure', async (totalTokens) => {
    const h = fixture()
    h.measure.mockReturnValue({ totalTokens })
    expect(await h.run()).toEqual(delegated)
    expect(h.warn).toHaveBeenCalledOnce()
  })

  it('contains optional meter failures without exposing their content or throwing middleware', async () => {
    const h = fixture()
    h.measure.mockImplementation(() => { throw new Error('secret transcript') })
    expect(await h.run()).toEqual(delegated)
    expect(await h.run()).toEqual(delegated)
    expect(h.warn).toHaveBeenCalledOnce()
    expect(h.warn.mock.calls[0]?.[0]).not.toContain('secret transcript')
  })

  it('contains a failed policy snapshot read for the final hard guard', async () => {
    const h = fixture()
    h.resolve.mockImplementation(() => { throw new Error('secret credential') })
    expect(await h.run()).toEqual(delegated)
    expect(h.warn.mock.calls[0]?.[0]).not.toContain('secret credential')
  })

  it('does not replace cancellation with compaction pressure', async () => {
    const h = fixture()
    const signal = AbortSignal.abort()
    expect(await h.run(h.request({ signal }))).toEqual(delegated)
    expect(h.measure).not.toHaveBeenCalled()
  })

  it('lets cancellation win after middleware returns but before the first stream iteration', async () => {
    const h = fixture()
    const controller = new AbortController()
    const stream = h.stream(h.request({ signal: controller.signal }))
    controller.abort(new Error('private cancellation detail'))
    const chunks: StreamChunk[] = []
    for await (const chunk of stream) chunks.push(chunk)
    expect(chunks).toEqual([{
      type: 'finish', reason: { kind: 'aborted', failure: {
        code: 'ABORTED', message: 'Copilot request cancelled before provider dispatch.',
      } },
    }])
    expect(h.next).not.toHaveBeenCalled()
    expect(h.compactIfNeeded).not.toHaveBeenCalled()
  })

  it.each(['resolve', 'measure'] as const)('preserves synchronous cancellation from %s instead of reporting pressure', async (hook) => {
    const h = fixture()
    const controller = new AbortController()
    if (hook === 'resolve') {
      h.resolve.mockImplementation(() => {
        controller.abort()
        return { inputBudgetTokens: 800 }
      })
    } else {
      h.measure.mockImplementation(() => {
        controller.abort()
        return { totalTokens: 900 }
      })
    }
    expect(await h.run(h.request({ signal: controller.signal }))).toEqual([{
      type: 'finish', reason: { kind: 'aborted', failure: {
        code: 'ABORTED', message: 'Copilot request cancelled before provider dispatch.',
      } },
    }])
    expect(h.next).not.toHaveBeenCalled()
    expect(h.compactIfNeeded).not.toHaveBeenCalled()
  })

  it('registers ahead of short-circuiting wire middleware and disposes reversibly', async () => {
    const h = fixture()
    expect(h.on).toHaveBeenCalledWith('llm/stream', expect.any(Function), { prepend: true })
    h.dispose()
    expect(await h.run()).toEqual(delegated)
    expect(h.measure).not.toHaveBeenCalled()
  })
})
