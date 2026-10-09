import '@earendil-works/pi-ai/api/openai-responses'
import { normalizeContext } from '@earendil-works/pi-ai/utils/transcript'
import { githubCopilotProvider } from '@earendil-works/pi-ai/providers/github-copilot'
import { describe, expect, it, vi } from 'vitest'
import { createAccountProvider, ManagedWireAbortError } from '../src/preview-provider.ts'
import { normalizeAccountModelCatalog } from '../src/account-model-catalog.ts'
import type { StreamOptions } from '@earendil-works/pi-ai'
import { DiagnosticsCollector } from '../src/diagnostics-collector.ts'
import type { PreviewProviderGuard } from '../src/preview-provider.ts'

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
  wire = new AbortController(), requestDiagnostics?: PreviewProviderGuard['requestDiagnostics'], maxRetries = 0,
  requestContext = context) {
  const released = vi.fn()
  const onWireAbort = vi.fn()
  const { provider, models } = createAccountProvider([descriptor], {
    selectedModelId: descriptor.id, signal: controller.signal,
    assertActive() {}, assertAccount() {}, assertEntitled() {}, onWireAbort, requestDiagnostics,
    beforeWire: async (_model, options) => ({
      signal: AbortSignal.any([controller.signal, wire.signal, ...options?.signal ? [options.signal] : []]),
      release() { released(); wire.abort() },
    }),
  }, baseURL)
  const model = models[0]!
  const stream = (managed ? provider : githubCopilotProvider()).streamSimple(model, requestContext, {
    apiKey: 'synthetic-test-key', signal: controller.signal, maxRetries, fetch,
  })
  const events = []
  for await (const event of stream) events.push(event)
  // lazyStream forwards the terminal event before the producer's cleanup microtask.
  await new Promise(resolve => setTimeout(resolve, 0))
  return { events, result: await stream.result(), released, onWireAbort, callerAborted: controller.signal.aborted }
}

describe('managed Responses failure boundaries with native SDK and no network', () => {
  const observed = () => {
    const collector = new DiagnosticsCollector('0.4.2-alpha.3', 'host')
    collector.setRequestEnabled(true)
    return { collector, requestDiagnostics: {
      enabled: () => collector.isRequestEnabled(), begin: collector.beginRequest.bind(collector), failed: vi.fn(),
    } }
  }
  it('does not wait for large-request composition before native success and updates the exact settled row', async () => {
    const { collector, requestDiagnostics } = observed()
    const large = normalizeContext({ messages: [{ role: 'user',
      content: 'SYNTHETIC_PRIVATE'.repeat(1400000), timestamp: 1 }] })
    const bodies: string[] = []
    const fetch = vi.fn(async (_input, init) => {
      bodies.push(String(init?.body))
      return new Response(sse({ type: 'response.completed', response: { status: 'completed',
        usage: { input_tokens: 1, output_tokens: 0 } } }))
    })
    const native = await call(false, fetch, new AbortController(), new AbortController(), undefined, 0, large)
    const managed = await call(true, fetch, new AbortController(), new AbortController(), requestDiagnostics, 0, large)
    expect({ ...managed.result, timestamp: 0 }).toEqual({ ...native.result, timestamp: 0 })
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(bodies[1]).toBe(bodies[0])
    expect(collector.snapshot().requests!.rows[0]!.composition.state).toBe('size-limit')
    await vi.waitFor(() => expect(collector.snapshot().requests!.rows[0]!.composition).toMatchObject({
      state: 'complete', totalBytes: Buffer.byteLength(bodies[1]!), imageBlockBytes: 0, opaqueReplayBytes: 0,
    }), { timeout: 3000 })
    expect(collector.snapshot().requests!.rows[0]!.outcome).toBe('stream-done')
    expect(JSON.stringify(collector.snapshot())).not.toContain('SYNTHETIC_PRIVATE')
  })
  it('records verified 408 once without changing the native error, serialized input or dispatch count', async () => {
    const { collector, requestDiagnostics } = observed()
    const bodies: string[] = []
    const fetch = vi.fn(async (_input, init) => {
      bodies.push(String(init?.body))
      return new Response(JSON.stringify({ error: { code: 'user_request_timeout',
        message: 'Timed out reading request body. Try again, or use a smaller request size.' } }),
        { status: 408, headers: { 'content-type': 'application/json' } })
    })
    const native = await call(false, fetch)
    const instrumented = await call(true, fetch, new AbortController(), new AbortController(), requestDiagnostics)
    expect(instrumented.result.errorMessage).toBe(native.result.errorMessage)
    expect(bodies[0]).toBe(bodies[1])
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(collector.snapshot().requests!.rows).toMatchObject([{ outcome: 'http-error',
      reason: 'request-body-timeout', httpStatus: 408, model: descriptor.id, dispatchIndex: 1,
      wireBytes: Buffer.byteLength(bodies[1]!), composition: { state: 'complete', totalBytes: Buffer.byteLength(bodies[1]!) },
      upload: { state: 'unavailable' } }])
    expect(requestDiagnostics.failed).not.toHaveBeenCalled()
    expect(JSON.stringify(collector.snapshot())).not.toContain('Synthetic prompt')
    expect(JSON.stringify(collector.snapshot())).not.toContain('synthetic-test-key')
  })
  it('isolates simultaneous streams and distinguishes missing terminal from real signal abort', async () => {
    const { collector, requestDiagnostics } = observed()
    const controller = new AbortController()
    await Promise.all([
      call(true, async () => new Response(partial), new AbortController(), new AbortController(), requestDiagnostics),
      call(true, async () => new Response(sse({ type: 'response.completed', response: { status: 'completed',
        usage: { input_tokens: 0, output_tokens: 0 } } })), new AbortController(), new AbortController(), requestDiagnostics),
      call(true, async () => { controller.abort(); throw new Error('synthetic-private-transport') },
        controller, new AbortController(), requestDiagnostics),
    ])
    const rows = collector.snapshot().requests!.rows
    expect(rows).toHaveLength(3)
    expect(new Set(rows.map(row => row.streamId)).size).toBe(3)
    expect(rows.map(row => [row.outcome, row.reason])).toEqual(expect.arrayContaining([
      ['stream-error', 'unknown'], ['stream-done', 'none'], ['cancelled', 'caller-abort'],
    ]))
    expect(rows.every(row => row.dispatchIndex === 1)).toBe(true)
    expect(JSON.stringify(rows)).not.toContain('synthetic-private-transport')
  })
  it('records SDK physical redispatch order without adding retries or claiming the Core retry counter', async () => {
    const { collector, requestDiagnostics } = observed()
    const fetch = vi.fn(async () => new Response(JSON.stringify({ error: { code: 'user_request_timeout',
      message: 'Timed out reading request body. Try again, or use a smaller request size.' } }),
      { status: 408, headers: { 'content-type': 'application/json' } }))
    const native = await call(false, fetch, new AbortController(), new AbortController(), undefined, 1)
    const nativeCount = fetch.mock.calls.length
    expect(nativeCount).toBe(2)
    fetch.mockClear()
    const measured = await call(true, fetch, new AbortController(), new AbortController(), requestDiagnostics, 1)
    expect(fetch).toHaveBeenCalledTimes(nativeCount)
    expect(measured.result.errorMessage).toBe(native.result.errorMessage)
    const rows = collector.snapshot().requests!.rows
    expect(rows).toHaveLength(nativeCount)
    expect(rows.map(row => row.dispatchIndex)).toEqual(Array.from({ length: nativeCount }, (_, index) => index + 1))
    expect(new Set(rows.map(row => row.streamId)).size).toBe(1)
  })
  it('does not alter native delivery when observation fails and reports only a fixed diagnostic', async () => {
    const failed = vi.fn()
    const fetch = vi.fn(async () => new Response(partial))
    const result = await call(true, fetch, new AbortController(), new AbortController(), {
      enabled: () => true, begin() { throw new Error('private-diagnostic-error') }, failed,
    })
    expect(result.result.stopReason).toBe('error')
    expect(result.result.errorMessage).toContain('stream ended before a terminal response event')
    expect(result.result.errorMessage).not.toContain('private-diagnostic-error')
    expect(failed).toHaveBeenCalledExactlyOnceWith()
    expect(fetch).toHaveBeenCalledTimes(1)
  })
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
