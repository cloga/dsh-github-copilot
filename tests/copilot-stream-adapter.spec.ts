import '@earendil-works/pi-ai/api/openai-responses'
import { describe, expect, it, vi } from 'vitest'
import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'
import { resolveRetryPolicy } from '@deepseek-ai/dsh-llm'
import { createAccountProvider } from '../src/preview-provider.ts'
import { normalizeAccountModelCatalog } from '../src/account-model-catalog.ts'
import { CopilotStreamIdleError } from '../src/copilot-stream-liveness.ts'

const providerId = 'github-copilot-preview'
const item = normalizeAccountModelCatalog({ data: [{
  id: 'synthetic-liveness-model', name: 'Synthetic liveness model', model_picker_enabled: true,
  policy: { state: 'enabled' }, supported_endpoints: ['/responses'],
  capabilities: { supports: { streaming: true, tool_calls: true, reasoning_effort: [] },
    limits: { max_context_window_tokens: 65536, max_output_tokens: 8192 } },
}] }).models[0]!
const encode = (value: object) => new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`)

async function run(mode: 'baseline' | 'late-output' | 'heartbeat-only' | 'stall') {
  const caller = new AbortController()
  const timeout = vi.fn()
  let bytes = 0
  let timer: ReturnType<typeof setInterval> | undefined
  const fetch = vi.fn(async (_input: unknown, init?: RequestInit) => new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      const signal = init?.signal
      const abort = () => {
        clearInterval(timer)
        controller.error(new Error('Synthetic transport aborted'))
      }
      signal?.addEventListener('abort', abort, { once: true })
      if (mode === 'stall') return
      timer = setInterval(() => {
        bytes++
        controller.enqueue(new TextEncoder().encode(': heartbeat\n\n'))
        if (mode === 'late-output' && bytes === 14) {
          clearInterval(timer)
          controller.enqueue(encode({ type: 'response.output_item.added', output_index: 0,
            item: { id: 'm1', type: 'message', role: 'assistant', content: [] } }))
          controller.enqueue(encode({ type: 'response.output_text.delta', output_index: 0, delta: 'Late output' }))
          controller.enqueue(encode({ type: 'response.completed', response: {
            status: 'completed', usage: { input_tokens: 1, output_tokens: 1 },
          } }))
          controller.close()
          signal?.removeEventListener('abort', abort)
        }
      }, 50)
    },
    cancel() { clearInterval(timer) },
  }), { headers: { 'content-type': 'text/event-stream' } }))
  const { provider } = createAccountProvider([item], {
    signal: caller.signal, selectedModelId: item.id,
    assertActive() {}, assertAccount() {}, assertEntitled() {},
    beforeWire: async (_model, options) => ({
      signal: AbortSignal.any([caller.signal, ...options?.signal ? [options.signal] : []]),
      release() {},
    }),
    ...mode === 'baseline' ? {} : { streamIdleTimeoutMs: 500, onStreamIdleTimeout: timeout },
  }, 'https://api.individual.githubcopilot.com')
  const profile = {
    provider: providerId, displayName: 'Synthetic liveness route', piProvider: provider,
    streamIdleTimeoutMs: mode === 'baseline' ? 500 : 1000,
    maxRequestImageBytes: 20_971_520, requestImagePixelBudget: 4_194_304, requestImageMaxBytes: 1_048_576,
    retryPolicy: resolveRetryPolicy(undefined, 'fixture'),
    configuredMaxTokens: new Map<string, number>(), modelErrors: new Map<string, string>(),
  }
  const adapter = new PiAiAdapter({
    profiles: () => new Map([[providerId, profile]]),
    resolveApiKey: async () => 'synthetic-test-key',
    auth: {
      authContext: { env: async () => undefined, fileExists: async () => false },
      credentials: {
        read: async () => ({ type: 'oauth', refresh: 'synthetic-account', access: 'synthetic-test-key',
          expires: Date.now() + 3_600_000, availableModelIds: [item.id] }),
        list: async () => [{ providerId, type: 'oauth' }],
        modify: async () => undefined, delete: async () => undefined,
      },
    },
  })
  vi.stubGlobal('fetch', fetch)
  const chunks = []
  let error: unknown
  try {
    for await (const chunk of adapter.stream({ provider: providerId, model: item.id, messages: [], signal: caller.signal })) chunks.push(chunk)
  } catch (cause) { error = cause }
  finally { clearInterval(timer); vi.unstubAllGlobals() }
  return { error, chunks, timeout, fetch, caller, bytes }
}

describe('byte-aware idle handling through the unchanged native adapter', () => {
  it('reproduces native semantic timeout despite ongoing SSE bytes', async () => {
    const result = await run('baseline')
    expect(result.error).toMatchObject({ code: 'TIMEOUT' })
    expect(result.bytes).toBeGreaterThan(2)
    expect(result.fetch).toHaveBeenCalledTimes(1)
  })
  it('allows real late output after the original semantic-idle boundary', async () => {
    const result = await run('late-output')
    expect(result.error).toBeUndefined()
    expect(result.chunks).toContainEqual({ type: 'text-delta', index: 0, text: 'Late output' })
    expect(result.timeout).not.toHaveBeenCalled()
    expect(result.fetch).toHaveBeenCalledTimes(1)
  })
  it('retains a native hard semantic deadline for an endless heartbeat stream', async () => {
    const result = await run('heartbeat-only')
    expect(result.error).toMatchObject({ code: 'TIMEOUT' })
    expect(result.timeout).not.toHaveBeenCalled()
    expect(result.fetch).toHaveBeenCalledTimes(1)
    expect(result.caller.signal.aborted).toBe(false)
  })
  it('reports a real byte-idle failure exactly once without aborting the caller', async () => {
    const result = await run('stall')
    expect(result.timeout).toHaveBeenCalledTimes(1)
    expect(result.timeout.mock.calls[0]?.[0]).toBeInstanceOf(CopilotStreamIdleError)
    expect(result.fetch).toHaveBeenCalledTimes(1)
    expect(result.caller.signal.aborted).toBe(false)
  })
})
