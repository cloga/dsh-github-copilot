import '@earendil-works/pi-ai/api/openai-responses'
import { normalizeContext } from '@earendil-works/pi-ai/utils/transcript'
import { githubCopilotProvider } from '@earendil-works/pi-ai/providers/github-copilot'
import { describe, expect, it, vi } from 'vitest'
import { createAccountProvider, ManagedWireAbortError } from '../src/preview-provider.ts'
import { normalizeAccountModelCatalog } from '../src/account-model-catalog.ts'
import type { StreamOptions } from '@earendil-works/pi-ai'

const baseURL = 'https://api.individual.githubcopilot.com'
const descriptor = normalizeAccountModelCatalog({ data: [{
  id: 'synthetic-transport-model', name: 'Synthetic model', model_picker_enabled: true,
  policy: { state: 'enabled' }, supported_endpoints: ['/responses'],
  capabilities: { supports: { streaming: true, tool_calls: true, reasoning_effort: [] },
    limits: { max_context_window_tokens: 1050000, max_output_tokens: 8192 } },
}] }).models[0]!
const context = normalizeContext({ messages: [{ role: 'user', content: 'Synthetic prompt', timestamp: 1 }] })
const sse = (event: object) => `data: ${JSON.stringify(event)}\n\n`
const partial = [
  { type: 'response.output_item.added', output_index: 0, item: { id: 'm1', type: 'message', role: 'assistant', content: [] } },
  { type: 'response.output_text.delta', output_index: 0, delta: 'Partial synthetic output' },
].map(sse).join('')

async function call(managed: boolean, fetch: NonNullable<StreamOptions['fetch']>, controller = new AbortController(),
  wire = new AbortController()) {
  const released = vi.fn()
  const onWireAbort = vi.fn()
  const { provider, models } = createAccountProvider([descriptor], {
    selectedModelId: descriptor.id, signal: controller.signal,
    assertActive() {}, assertAccount() {}, assertEntitled() {}, onWireAbort,
    beforeWire: async (_model, options) => ({
      signal: AbortSignal.any([controller.signal, wire.signal, ...options?.signal ? [options.signal] : []]),
      release() { released(); wire.abort() },
    }),
  }, baseURL)
  const model = models[0]!
  const stream = (managed ? provider : githubCopilotProvider()).streamSimple(model, context, {
    apiKey: 'synthetic-test-key', signal: controller.signal, maxRetries: 0, fetch,
  })
  const events = []
  for await (const event of stream) events.push(event)
  // lazyStream forwards the terminal event before the producer's cleanup microtask.
  await new Promise(resolve => setTimeout(resolve, 0))
  return { events, result: await stream.result(), released, onWireAbort, callerAborted: controller.signal.aborted }
}

describe('managed Responses failure boundaries with native SDK and no network', () => {
  it.each([false, true])('preserves an observed HTTP408 with managed=%s without retrying in the provider', async managed => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({
      error: { message: 'Timed out reading request body. Try again, or use a smaller request size.', code: 'user_request_timeout' },
    }), { status: 408, headers: { 'content-type': 'application/json' } }))
    const { result, callerAborted, released } = await call(managed, fetch)
    expect(result.stopReason).toBe('error')
    expect(result.errorMessage).toContain('408')
    expect(result.errorMessage).toContain('user_request_timeout')
    expect(callerAborted).toBe(false)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(released).toHaveBeenCalledTimes(managed ? 1 : 0)
  })

  it.each([false, true])('preserves missing-terminal EOF as error, not aborted, with managed=%s', async managed => {
    const fetch = vi.fn(async () => new Response(partial, { headers: { 'content-type': 'text/event-stream' } }))
    const { result, callerAborted, events } = await call(managed, fetch)
    expect(result.stopReason).toBe('error')
    expect(result.errorMessage).toContain('stream ended before a terminal response event')
    expect(result.content).toContainEqual({ type: 'text', text: 'Partial synthetic output' })
    expect(events.some(event => event.type === 'done')).toBe(false)
    expect(callerAborted).toBe(false)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it.each([false, true])('retains transport termination without replaying partial output with managed=%s', async managed => {
    const fetch = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode(partial)) },
      pull(controller) { controller.error(new TypeError('terminated')) },
    }), { headers: { 'content-type': 'text/event-stream' } }))
    const { result, callerAborted } = await call(managed, fetch)
    expect(result.stopReason).toBe('error')
    expect(result.errorMessage).toContain('terminated')
    expect(callerAborted).toBe(false)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('does not reclassify real caller cancellation as a retryable transport error', async () => {
    const controller = new AbortController()
    const fetch = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
      start(stream) { stream.enqueue(new TextEncoder().encode(partial)) },
      pull(stream) { controller.abort(); stream.close() },
    }), { headers: { 'content-type': 'text/event-stream' } }))
    const { result, callerAborted, onWireAbort } = await call(true, fetch, controller)
    expect(result.stopReason).toBe('aborted')
    expect(callerAborted).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(onWireAbort).not.toHaveBeenCalled()
  })

  it('reports a proven plugin credential abort before the terminal error without borrowing upstream text', async () => {
    const wire = new AbortController()
    const fetch = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
      start(stream) { stream.enqueue(new TextEncoder().encode(partial)) },
      pull(stream) { wire.abort(new ManagedWireAbortError('COPILOT_PREVIEW_CREDENTIAL_CHANGED')); stream.close() },
    }), { headers: { 'content-type': 'text/event-stream' } }))
    const { result, callerAborted, onWireAbort, released } = await call(true, fetch, new AbortController(), wire)
    expect(result.stopReason).toBe('aborted')
    expect(result.errorMessage).toContain('stream ended before a terminal response event')
    expect(callerAborted).toBe(false)
    expect(onWireAbort).toHaveBeenCalledExactlyOnceWith('COPILOT_PREVIEW_CREDENTIAL_CHANGED')
    expect(onWireAbort.mock.invocationCallOrder[0]).toBeLessThan(released.mock.invocationCallOrder[0]!)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('never interprets an unbranded abort message as an owned credential invalidation', async () => {
    const wire = new AbortController()
    const fetch = vi.fn(async () => {
      wire.abort(new Error('COPILOT_PREVIEW_CREDENTIAL_CHANGED'))
      return new Response(partial, { headers: { 'content-type': 'text/event-stream' } })
    })
    const { onWireAbort } = await call(true, fetch, new AbortController(), wire)
    expect(onWireAbort).not.toHaveBeenCalled()
  })

  it('does not duplicate the native serialized input or enlarge it during normalization', async () => {
    const bodies: string[] = []
    const fetch = vi.fn(async (_input, init) => {
      bodies.push(String(init?.body))
      return new Response(sse({ type: 'response.completed', response: { status: 'completed', usage: { input_tokens: 3, output_tokens: 0 } } }),
        { headers: { 'content-type': 'text/event-stream' } })
    })
    await call(false, fetch)
    await call(true, fetch)
    expect(JSON.parse(bodies[1]!)).toEqual(JSON.parse(bodies[0]!))
    expect(Buffer.byteLength(bodies[1]!)).toBe(Buffer.byteLength(bodies[0]!))
  })

  it('retains genuine zero usage as well as the SDK default zero when measurement is absent', async () => {
    const missing = await call(true, async () => new Response(partial, { headers: { 'content-type': 'text/event-stream' } }))
    const measured = await call(true, async () => new Response(sse({
      type: 'response.completed', response: {
        status: 'completed', usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
      },
    }), { headers: { 'content-type': 'text/event-stream' } }))
    expect(missing.result.stopReason).toBe('error')
    expect(measured.result.stopReason).toBe('stop')
    for (const { result } of [missing, measured]) {
      expect(result.usage).toMatchObject({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 })
    }
  })
})
