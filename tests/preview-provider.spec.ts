// Load the real public SDK modules during collection, not inside a model-operation timeout.
import '@earendil-works/pi-ai/api/openai-responses'
import '@earendil-works/pi-ai/api/openai-completions'
import '@earendil-works/pi-ai/api/anthropic-messages'
import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all'
import { lazyStream } from '@earendil-works/pi-ai'
import * as copilotSdk from '@earendil-works/pi-ai/providers/github-copilot'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { accountModelFromDescriptor, createAccountProvider, copilotPublicHeaders } from '../src/preview-provider.ts'
import type { AccountProviderGuard } from '../src/preview-provider.ts'
import { normalizeAccountModelCatalog } from '../src/account-model-catalog.ts'
import type { AccountModelApi } from '../src/account-model-catalog.ts'
import { Config as CoreConfig, PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'
import type { ResolvedPiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import { BlockAssembler, ReasoningEffortId, resolveRetryPolicy } from '@deepseek-ai/dsh-llm'
import { GITHUB_COPILOT_PREVIEW_PROVIDER_ID as PREVIEW } from '../src/copilot-identity.ts'

// Preserve the real factory by default; one observer identity test replaces only
// its returned stream entrypoint, without modifying the installed ESM module.
vi.mock('@earendil-works/pi-ai/providers/github-copilot', async importOriginal => {
  const original = await importOriginal<typeof import('@earendil-works/pi-ai/providers/github-copilot')>()
  return { ...original, githubCopilotProvider: vi.fn(original.githubCopilotProvider) }
})

const baseURL = 'https://api.individual.githubcopilot.com'
const endpoint: Record<AccountModelApi, string> = { 'openai-responses': '/responses', 'openai-completions': '/chat/completions', 'anthropic-messages': '/v1/messages' }
function descriptor(api: AccountModelApi, id = 'future-lab-r17', efforts = ['high', 'max'], adaptive = true) {
  const parsed = normalizeAccountModelCatalog({ data: [{ id, name: 'Unseen model', model_picker_enabled: true,
    policy: { state: 'enabled' }, supported_endpoints: [endpoint[api]],
    capabilities: { supports: { streaming: true, tool_calls: true, vision: true, reasoning_effort: efforts, adaptive_thinking: adaptive },
      limits: { max_context_window_tokens: 65536, max_prompt_tokens: 32768, max_output_tokens: 8192 } },
  }] })
  expect(parsed.rejected).toEqual([])
  return parsed.models[0]!
}
function accountGuard(modelId: string): AccountProviderGuard {
  const controller = new AbortController()
  return { signal: controller.signal, selectedModelId: modelId,
    assertActive() {}, assertAccount() {},
    assertEntitled(credential, selected) {
      if (selected !== modelId || !credential.availableModelIds?.includes(selected)) throw new Error('MODEL_NOT_ENTITLED')
    },
    beforeWire: async (_model, options) => {
      if (options?.apiKey !== 'synthetic-account-token') throw new Error('UNVERIFIED_KEY')
      return { signal: controller.signal, release() {} }
    },
  }
}
function nativeEvents(api: AccountModelApi): Response {
  const sse = (value: object) => `data: ${JSON.stringify(value)}\n\n`
  if (api === 'openai-responses') return new Response([
    { type: 'response.output_item.added', output_index: 0, item: { id: 'r1', type: 'reasoning' } },
    { type: 'response.reasoning_summary_text.delta', output_index: 0, summary_index: 0, delta: 'Public summary.' },
    { type: 'response.output_item.done', output_index: 0, item: { id: 'r1', type: 'reasoning', summary: [{ type: 'summary_text', text: 'Public summary.' }], encrypted_content: 'opaque' } },
    { type: 'response.output_item.added', output_index: 1, item: { id: 'm1', type: 'message', role: 'assistant', content: [] } },
    { type: 'response.output_text.delta', output_index: 1, delta: 'Hello.' },
    { type: 'response.output_item.done', output_index: 1, item: { id: 'm1', type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Hello.' }] } },
    { type: 'response.completed', response: { status: 'completed', usage: { input_tokens: 1, output_tokens: 2 } } },
  ].map(sse).join(''), { headers: { 'content-type': 'text/event-stream' } })
  if (api === 'openai-completions') return new Response([
    sse({ choices: [{ index: 0, delta: { role: 'assistant', reasoning_content: 'Public summary.', content: 'Hello.' }, finish_reason: null }] }),
    sse({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 2 } }),
    'data: [DONE]\n\n',
  ].join(''), { headers: { 'content-type': 'text/event-stream' } })
  const events = [
    { type: 'message_start', message: { id: 'a1', role: 'assistant', content: [], usage: { input_tokens: 1, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Public summary.' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'opaque' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Hello.' } },
    { type: 'content_block_stop', index: 1 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } },
    { type: 'message_stop' },
  ]
  return new Response(events.map(value => `event: ${value.type}\n${sse(value)}`).join(''), { headers: { 'content-type': 'text/event-stream' } })
}
async function accountCall(api: AccountModelApi, effort?: string, headers?: Record<string, string>) {
  const item = descriptor(api)
  const guarded = accountGuard(item.id)
  const { provider } = createAccountProvider([item], guarded, baseURL)
  const defaults = CoreConfig({ providers: { [PREVIEW]: {} } }).providers![PREVIEW]!
  const profile: ResolvedPiAiProviderProfile = { provider: PREVIEW, displayName: 'Account models', piProvider: provider,
    streamIdleTimeoutMs: defaults.streamIdleTimeoutMs!, maxRequestImageBytes: defaults.maxRequestImageBytes!,
    requestImagePixelBudget: defaults.requestImagePixelBudget!, requestImageMaxBytes: defaults.requestImageMaxBytes!,
    retryPolicy: resolveRetryPolicy(undefined, 'fixture'), configuredMaxTokens: new Map(),
    ...headers === undefined ? {} : { headers },
  }
  const credential = { type: 'oauth' as const, refresh: 'synthetic-account', access: 'synthetic-account-token', expires: Date.now() + 3600000, availableModelIds: [item.id] }
  const env = vi.fn(async () => 'must-not-use')
  const adapter = new PiAiAdapter({ profiles: () => new Map([[PREVIEW, profile]]), resolveApiKey: async () => undefined,
    auth: { authContext: { env, fileExists: async () => false }, credentials: {
      read: async () => credential, list: async () => [{ providerId: PREVIEW, type: 'oauth' }],
      modify: async (_id, change) => await change(credential) ?? credential, delete: async () => undefined,
    } },
  })
  const prepared = await adapter.prepareCall(PREVIEW, item.id)
  const assembler = new BlockAssembler()
  for await (const chunk of prepared.stream({ provider: PREVIEW, model: item.id, messages: [],
    ...effort === undefined ? {} : { reasoningEffort: ReasoningEffortId(effort) },
  })) assembler.push(chunk)
  return { assembler, model: prepared.model, env }
}
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('account-driven native provider', () => {
  it.each(['openai-responses', 'openai-completions', 'anthropic-messages'] as const)('routes an unseen ID through published Core and native %s with Bearer auth', async api => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'must-not-use')
    let body: Record<string, unknown> | undefined
    let requestUrl = ''
    let requestHeaders = new Headers()
    const fetch = vi.fn(async (input: unknown, init?: RequestInit) => {
      requestUrl = String(input)
      requestHeaders = new Headers(init?.headers)
      body = JSON.parse(String(init?.body))
      return nativeEvents(api)
    })
    vi.stubGlobal('fetch', fetch)
    const result = await accountCall(api, 'high', { authorization: 'Bearer forged', 'X-API-KEY': 'must-not-use' })
    expect(result.assembler.finish).toEqual({ kind: 'stop' })
    expect(new URL(requestUrl).origin + new URL(requestUrl).pathname).toBe(baseURL + endpoint[api])
    expect(requestHeaders.get('authorization')).toBe('Bearer synthetic-account-token')
    expect(requestHeaders.get('x-api-key')).toBeNull()
    expect(requestHeaders.get('openai-intent')).toBe('conversation-edits')
    expect(requestHeaders.get('user-agent')).not.toContain('claude-cli')
    expect(body?.model).toBe('future-lab-r17')
    expect(result.assembler.blocks()).toContainEqual({ type: 'reasoning', text: 'Public summary.' })
    expect(result.assembler.blocks()).toContainEqual({ type: 'text', text: 'Hello.' })
    expect(result.env).not.toHaveBeenCalled()
    expect(result.model.provider).toBe(PREVIEW)
    if (api === 'openai-responses') expect(body?.reasoning).toEqual({ effort: 'high', summary: 'auto' })
    if (api === 'openai-completions') expect(body?.reasoning_effort).toBe('high')
    if (api === 'anthropic-messages') {
      expect(body?.thinking).toMatchObject({ type: 'adaptive' })
      expect(body?.output_config).toMatchObject({ effort: 'high' })
    }
  })
  it.each(['openai-responses', 'openai-completions', 'anthropic-messages'] as const)('does not synthesize none or disabled thinking by default for %s', async api => {
    vi.stubGlobal('fetch', vi.fn(async (_input: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      expect(body.reasoning).toBeUndefined()
      expect(body.reasoning_effort).toBeUndefined()
      expect(body.thinking).toBeUndefined()
      return nativeEvents(api)
    }))
    expect((await accountCall(api)).assembler.finish).toEqual({ kind: 'stop' })
  })
  it('takes protocol and independent input limits from descriptor evidence rather than the local GPT-6 catalog', () => {
    const local = getBuiltinModels('github-copilot').find(model => model.id === 'gpt-6-astra')!
    expect(local.api).toBe('openai-completions')
    const converted = accountModelFromDescriptor(descriptor('openai-responses', local.id), baseURL)
    expect(converted.api).toBe('openai-responses')
    expect(converted.contextWindow).toBe(65536)
    expect(converted.maxInputTokens).toBe(32768)
    expect(local.api).toBe('openai-completions')
  })
  it('does not infer controls from a name or unfamiliar advertised effort labels', () => {
    const converted = accountModelFromDescriptor(descriptor('openai-responses', 'future-lab-r17', ['turbo', 'none', 'off']), baseURL)
    expect(converted.thinkingLevelMap).toEqual({ off: null, minimal: null, low: null, medium: null, high: null, xhigh: null, max: null })
    expect(converted.unmappedReasoningEfforts).toEqual(['none', 'off', 'turbo'])
    expect(converted.reasoning).toBe(false)
  })
  it('does not invent budget-mode effort mappings without advertised adaptive support', () => {
    const converted = accountModelFromDescriptor(descriptor('anthropic-messages', 'future-lab-r17', ['low', 'high'], false), baseURL)
    expect(converted.reasoning).toBe(false)
    expect(converted.unmappedReasoningEfforts).toEqual(['high', 'low'])
  })
})

describe('account provider model HTTP authorization observation', () => {
  const apis = ['openai-responses', 'openai-completions', 'anthropic-messages'] as const
  function rejectedResponse(status = 401) {
    return new Response(JSON.stringify({ error: { type: 'authentication_error', message: 'synthetic rejected request' } }), {
      status, headers: { 'content-type': 'application/json' },
    })
  }
  function observedProvider(api: AccountModelApi, onUnauthorized?: () => void) {
    const item = descriptor(api)
    const controller = new AbortController()
    const caller = new AbortController()
    const wire = new AbortController()
    const order: string[] = []
    const release = vi.fn(() => { order.push('release'); wire.abort() })
    const unauthorized = vi.fn(() => { order.push('unauthorized'); onUnauthorized?.() })
    const guard: AccountProviderGuard = { ...accountGuard(item.id), signal: controller.signal,
      beforeWire: async (_model, options) => {
        expect(options?.apiKey).toBe('synthetic-account-token')
        return { signal: AbortSignal.any([controller.signal, caller.signal, wire.signal]), release }
      },
      onUnauthorized: unauthorized,
    }
    const { provider, models } = createAccountProvider([item], guard, baseURL)
    return { controller, caller, wire, order, release, unauthorized,
      async call(fetch?: typeof globalThis.fetch) {
        const options = { apiKey: 'synthetic-account-token', signal: caller.signal, maxRetries: 0,
          ...fetch === undefined ? {} : { fetch },
        }
        const stream = provider.streamSimple(models[0]!, { messages: [] }, options)
        for await (const _event of stream) { /* Drain native events, including the unchanged terminal failure. */ }
        const result = await stream.result()
        await vi.waitFor(() => expect(release).toHaveBeenCalledTimes(1))
        return result
      },
    }
  }

  it('passes the exact custom fetch arguments and Response through the public observer', async () => {
    const input = new Request(`${baseURL}/responses`, { method: 'POST' })
    const init: RequestInit = { method: 'POST', headers: { 'x-synthetic': 'unchanged' }, body: 'synthetic-body' }
    const response = rejectedResponse()
    const customFetch = vi.fn(async (..._args: Parameters<typeof globalThis.fetch>) => response)
    const ambientFetch = vi.fn(async () => { throw new Error('Custom fetch must not reach the ambient transport') })
    vi.stubGlobal('fetch', ambientFetch)
    const native = copilotSdk.githubCopilotProvider()
    let receivedResponse: Response | undefined
    let bodyUsedBeforeNative: boolean | undefined
    // Only this seam test supplies the request arguments itself. The native SDK
    // still consumes the returned Response and produces the terminal error.
    const factory = vi.mocked(copilotSdk.githubCopilotProvider)
    const originalFactory = factory.getMockImplementation()!
    factory.mockImplementationOnce(() => ({ ...native,
      streamSimple: (model, context, options) => lazyStream(model, async () => {
        receivedResponse = await options!.fetch!(input, init)
        bodyUsedBeforeNative = receivedResponse.bodyUsed
        return native.streamSimple(model, context, { ...options, fetch: async () => receivedResponse! })
      }),
    }))
    try {
      const harness = observedProvider('openai-responses')
      const result = await harness.call(customFetch)
      expect(customFetch).toHaveBeenCalledTimes(1)
      expect(customFetch.mock.calls[0]![0]).toBe(input)
      expect(customFetch.mock.calls[0]![1]).toBe(init)
      expect(receivedResponse).toBe(response)
      expect(bodyUsedBeforeNative).toBe(false)
      expect(ambientFetch).not.toHaveBeenCalled()
      expect(result.stopReason).toBe('error')
      expect(result.errorMessage).toContain('401')
      expect(harness.order).toEqual(['release', 'unauthorized'])
    } finally { factory.mockReset().mockImplementation(originalFactory) }
  })

  it.each(apis)('reports a real %s HTTP 401 once after releasing its wire without replay', async api => {
    const harness = observedProvider(api)
    const fetch = vi.fn(async () => {
      expect(harness.release).not.toHaveBeenCalled()
      expect(harness.unauthorized).not.toHaveBeenCalled()
      return rejectedResponse()
    })
    const result = await harness.call(fetch)
    expect(result.stopReason).toBe('error')
    expect(result.errorMessage).toContain('401')
    expect(result.errorMessage).toContain('synthetic rejected request')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(harness.wire.signal.aborted).toBe(true)
    expect(harness.unauthorized).toHaveBeenCalledTimes(1)
    expect(harness.order).toEqual(['release', 'unauthorized'])
  })

  it.each(apis)('observes the existing global fetch fallback for %s without adding requests', async api => {
    const fetch = vi.fn(async () => rejectedResponse())
    vi.stubGlobal('fetch', fetch)
    const harness = observedProvider(api)
    const result = await harness.call()
    expect(result.stopReason).toBe('error')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(harness.order).toEqual(['release', 'unauthorized'])
  })

  it.each(apis)('does not treat a %s HTTP 403 as token rejection', async api => {
    const harness = observedProvider(api)
    const fetch = vi.fn(async () => rejectedResponse(403))
    const result = await harness.call(fetch)
    expect(result.stopReason).toBe('error')
    expect(result.errorMessage).toContain('403')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(harness.unauthorized).not.toHaveBeenCalled()
    expect(harness.order).toEqual(['release'])
  })

  it.each(apis)('does not infer HTTP status from a thrown %s transport error', async api => {
    const harness = observedProvider(api)
    const fetch = vi.fn(async () => { throw new Error('401 API key is invalid: synthetic transport failure, not a Response') })
    const result = await harness.call(fetch)
    expect(result.stopReason).toBe('error')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(harness.unauthorized).not.toHaveBeenCalled()
    expect(harness.order).toEqual(['release'])
  })

  it.each(apis)('does not interpret a %s successful response body as an HTTP 401', async api => {
    const harness = observedProvider(api)
    const fetch = vi.fn(async () => new Response((await nativeEvents(api).text()).replaceAll('Hello.', '401 API key is invalid.'), {
      headers: { 'content-type': 'text/event-stream' },
    }))
    const result = await harness.call(fetch)
    expect(result.stopReason).toBe('stop')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(harness.unauthorized).not.toHaveBeenCalled()
    expect(harness.order).toEqual(['release'])
  })

  it.each(apis.flatMap(api => (['caller', 'controller'] as const).map(owner => ({ api, owner }))))(
    'does not retire credentials when $owner cancellation races with a $api HTTP 401', async ({ api, owner }) => {
      const harness = observedProvider(api)
      const fetch = vi.fn(async () => {
        harness[owner].abort()
        return rejectedResponse()
      })
      const result = await harness.call(fetch)
      expect(result.stopReason).toBe('aborted')
      expect(fetch).toHaveBeenCalledTimes(1)
      expect(harness.unauthorized).not.toHaveBeenCalled()
      expect(harness.order).toEqual(['release'])
    },
  )

  it.each(apis)('preserves the native %s failure when the rejection callback throws', async api => {
    const baseline = observedProvider(api)
    const expected = await baseline.call(async () => rejectedResponse())
    const harness = observedProvider(api, () => { throw new Error('synthetic callback failure must not replace native error') })
    const fetch = vi.fn(async () => rejectedResponse())
    const result = await harness.call(fetch)
    expect(result.stopReason).toBe(expected.stopReason)
    expect(result.errorMessage).toBe(expected.errorMessage)
    expect(result.errorMessage).not.toContain('synthetic callback failure')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(harness.unauthorized).toHaveBeenCalledTimes(1)
    expect(harness.order).toEqual(['release', 'unauthorized'])
  })
})

describe('account provider ownership and auth boundaries', () => {
  it('creates only the supplied descriptor models without mutating shared catalog or accepting server headers', () => {
    const before = getBuiltinModels('github-copilot').map(model => [model.id, model.api])
    const entries = (['openai-responses', 'openai-completions', 'anthropic-messages'] as const)
      .map((api, index) => descriptor(api, `future-${index}`))
    const hostile = Object.defineProperties({ ...entries[0]! }, {
      headers: { get() { throw new Error('server headers must not be read') } },
      baseURL: { get() { throw new Error('server baseURL must not be read') } },
    })
    const model = accountModelFromDescriptor(hostile, baseURL)
    expect(Object.isFrozen(model)).toBe(true)
    expect(Object.isFrozen(model.input)).toBe(true)
    expect(model.input).not.toBe(entries[0]!.input)
    const { provider } = createAccountProvider(entries, accountGuard(entries[0]!.id), baseURL)
    expect(provider.getModels().map(model => model.id)).toEqual(entries.map(entry => entry.id))
    expect(provider.getModels().every(model => model.provider === PREVIEW)).toBe(true)
    expect(provider).not.toHaveProperty('refreshModels')
    expect(getBuiltinModels('github-copilot').map(model => [model.id, model.api])).toEqual(before)
  })
  it('takes only shared public Copilot transport headers from the native SDK', () => {
    const headers = copilotPublicHeaders()
    expect(Object.keys(headers).sort()).toEqual(['Copilot-Integration-Id', 'Editor-Plugin-Version', 'Editor-Version', 'User-Agent'])
    expect(Object.isFrozen(headers)).toBe(true)
    for (const model of getBuiltinModels('github-copilot')) {
      for (const [name, value] of Object.entries(headers)) expect(model.headers?.[name]).toBe(value)
    }
  })
  it('offers no API-key environment fallback or second login flow', async () => {
    const item = descriptor('openai-responses')
    const { provider } = createAccountProvider([item], accountGuard(item.id), baseURL)
    expect(provider.auth.apiKey).toBeUndefined()
    await expect(provider.auth.oauth!.login({ signal: new AbortController().signal,
      prompt: async () => { throw new Error('must not prompt') }, notify: () => { throw new Error('must not notify') },
    })).rejects.toThrow('COPILOT_MANAGED_USE_CANONICAL_SIGN_IN')
  })
  it('checks selected-model entitlement before deriving auth and refuses unprepared metadata views', async () => {
    const item = descriptor('openai-responses')
    const credential = { type: 'oauth' as const, refresh: 'synthetic', access: 'synthetic', expires: 1, availableModelIds: [] }
    const { provider } = createAccountProvider([item], accountGuard(item.id), baseURL)
    await expect(provider.auth.oauth!.toAuth(credential)).rejects.toThrow('MODEL_NOT_ENTITLED')
    const guard = accountGuard(item.id)
    const unprepared = createAccountProvider([item], { ...guard, selectedModelId: undefined }, baseURL)
    await expect(unprepared.provider.auth.oauth!.toAuth(credential)).rejects.toThrow('COPILOT_MANAGED_MODEL_NOT_PREPARED')
  })
})
