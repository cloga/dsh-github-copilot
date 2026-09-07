// Load the real public SDK modules during collection, not inside a model-operation timeout.
import '@earendil-works/pi-ai/api/openai-responses'
import '@earendil-works/pi-ai/api/openai-completions'
import '@earendil-works/pi-ai/api/anthropic-messages'
import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { accountModelFromDescriptor, createAccountProvider, copilotPublicHeaders } from '../src/preview-provider.ts'
import type { AccountProviderGuard } from '../src/preview-provider.ts'
import { normalizeAccountModelCatalog } from '../src/account-model-catalog.ts'
import type { AccountModelApi } from '../src/account-model-catalog.ts'
import { Config as CoreConfig, PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'
import type { ResolvedPiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import { BlockAssembler, ReasoningEffortId, resolveRetryPolicy } from '@deepseek-ai/dsh-llm'
import { GITHUB_COPILOT_PREVIEW_PROVIDER_ID as PREVIEW } from '../src/copilot-identity.ts'

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
