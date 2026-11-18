import { Context } from '@deepseek-ai/cordis'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import { Config as NativeConfig } from '@deepseek-ai/dsh-llm-pi-ai'
import { WebRuntime } from '@deepseek-ai/dsh-web'
import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { captureNativeCopilot, nativeCopilotModels } from '../src/native-copilot-access.ts'
import { createNativeCopilotSearch } from '../src/native-copilot-search.ts'

vi.mock('../src/native-copilot-access.ts', async importOriginal => ({
  ...await importOriginal<typeof import('../src/native-copilot-access.ts')>(),
  captureNativeCopilot: vi.fn(),
}))

const candidates = getBuiltinModels('github-copilot').filter(model => model.api === 'openai-responses').slice(0, 2)
const model = candidates[0]!
const secondModel = candidates[1]!
const key = credentialKey('llm-pi-ai', 'github-copilot')
const contexts: Context[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

function setup() {
  const ctx = new Context()
  contexts.push(ctx)
  const assertCurrent = vi.fn()
  const webSettings: { searchProvider?: string } = { searchProvider: 'github-copilot-hosted' }
  const copilotSettings: { nativeSearchModel?: string } = {}
  ctx.provide('settings', {
    get: (ns: string) => ns === 'web' ? webSettings : ns === 'github-copilot' ? copilotSettings : undefined,
  })
  const nativeProfile = NativeConfig({ providers: { 'github-copilot': {
    compat: { supportsStrictMode: false }, models: candidates.map(candidate => ({ id: candidate.id })),
  } } }).providers.get()['github-copilot']!
  const models = nativeCopilotModels(nativeProfile, getBuiltinModels('github-copilot'))
  vi.mocked(captureNativeCopilot).mockResolvedValue(models === undefined ? undefined
    : { namespace: 'llm-pi-ai', models, accountModelIds: undefined, assertCurrent })
  const readRecord = vi.fn(async (record: string) => {
    expect(record).toBe(key)
    return { kind: 'grant', payload: { type: 'oauth', refresh: 'synthetic-refresh',
      access: 'synthetic-access', expires: Date.now() + 3_600_000, availableModelIds: candidates.map(candidate => candidate.id) } }
  })
  ctx.provide('credentials', {
    readRecord, listRecords: async () => [{ key, kind: 'grant' }],
    modifyRecord: async () => { throw new Error('unexpected refresh') },
    deleteRecord: async () => { throw new Error('unexpected deletion') },
  })
  const requests: Record<string, unknown>[] = []
  const fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    expect(init?.redirect).toBe('error')
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer synthetic-access')
    if (String(url).endsWith('/models')) return Response.json({ data: candidates.map(candidate => ({
      id: candidate.id, model_picker_enabled: true, policy: { state: 'enabled' },
      supported_endpoints: ['/responses'],
      capabilities: { supports: { tool_calls: true, streaming: true },
        limits: { max_context_window_tokens: 32000, max_output_tokens: 4096 } },
    })) })
    const body: Record<string, unknown> = JSON.parse(String(init?.body))
    requests.push(body)
    return Response.json({ output: [
      { type: 'web_search_call', status: 'completed', action: { sources: [{ type: 'url', url: 'https://example.com', title: 'Example' }] } },
      { type: 'message', content: [{ type: 'output_text', text: 'A sourced answer.' }] },
    ] })
  })
  vi.stubGlobal('fetch', fetch)
  return { ctx, provider: createNativeCopilotSearch(ctx), readRecord, fetch, requests,
    assertCurrent, webSettings, copilotSettings, nativeProfile }
}

describe('optional native Copilot hosted search', () => {
  it('preserves implicit native selection until explicitly selected, and unregisters cleanly', async () => {
    const fixture = setup()
    delete fixture.webSettings.searchProvider
    await fixture.ctx.plugin(WebRuntime, {
      searchProvider: undefined, fetchProvider: undefined,
    })
    const nativeSearch = vi.fn(async () => ({ content: 'native', sources: [], truncated: false }))
    fixture.ctx.web.registerSearchProvider({ id: 'native', available: () => true, search: nativeSearch })
    const dispose = fixture.ctx.web.registerSearchProvider(fixture.provider)
    expect(fixture.provider.available()).toBe(false)
    await expect(fixture.ctx.web.search({ query: 'native' })).resolves.toMatchObject({ content: 'native' })
    expect(fixture.fetch).not.toHaveBeenCalled()
    dispose()
    await expect(fixture.ctx.web.search({ query: 'still native' })).resolves.toMatchObject({ content: 'native' })
    expect(nativeSearch).toHaveBeenCalledTimes(2)
  })

  it('preserves native route-specific search preferences when Copilot search is not selected', async () => {
    const fixture = setup()
    delete fixture.webSettings.searchProvider
    await fixture.ctx.plugin(WebRuntime, { searchProvider: undefined, fetchProvider: undefined })
    const messages = vi.fn(async () => ({ content: 'messages', sources: [], truncated: false }))
    const api = vi.fn(async () => ({ content: 'api', sources: [], truncated: false }))
    fixture.ctx.web.registerSearchProvider({ id: 'deepseek-official', available: () => true, search: messages })
    fixture.ctx.web.registerSearchProvider({ id: 'deepseek-search-api', available: () => true, search: api })
    fixture.ctx.web.registerSearchProvider(fixture.provider)

    for (const [llmProvider, expected] of [
      ['deepseek-official', 'messages'], ['deepseek-account', 'messages'], ['github-copilot', 'api'],
    ] as const) {
      await expect(fixture.ctx.web.searchReady(llmProvider)).resolves.toBe(true)
      await expect(fixture.ctx.web.search({ query: 'native', llmProvider })).resolves.toMatchObject({ content: expected })
    }
    await expect(fixture.ctx.web.search({ query: 'outside a request' })).resolves.toMatchObject({ content: 'api' })
    expect(messages).toHaveBeenCalledTimes(2)
    expect(api).toHaveBeenCalledTimes(2)
    expect(fixture.fetch).not.toHaveBeenCalled()
  })

  it('honors explicit Copilot search selection over the native route preference', async () => {
    const fixture = setup()
    await fixture.ctx.plugin(WebRuntime, { searchProvider: 'github-copilot-hosted', fetchProvider: undefined })
    const nativeSearch = vi.fn(async () => ({ content: 'native', sources: [], truncated: false }))
    fixture.ctx.web.registerSearchProvider({ id: 'deepseek-official', available: () => true, search: nativeSearch })
    fixture.ctx.web.registerSearchProvider({ id: 'deepseek-search-api', available: () => true, search: nativeSearch })
    fixture.ctx.web.registerSearchProvider(fixture.provider)

    await expect(fixture.ctx.web.searchReady('deepseek-account')).resolves.toBe(true)
    await expect(fixture.ctx.web.search({ query: 'explicit selection', llmProvider: 'deepseek-account' }))
      .resolves.toMatchObject({ content: 'A sourced answer.' })
    expect(fixture.requests).toHaveLength(2)
    expect(nativeSearch).not.toHaveBeenCalled()
  })

  it('registers without I/O and checks readiness without discovery or refresh', async () => {
    const fixture = setup()
    expect(fixture.fetch).not.toHaveBeenCalled()
    expect(fixture.readRecord).not.toHaveBeenCalled()
    const before = structuredClone(fixture.nativeProfile)
    expect(fixture.nativeProfile.compat).toEqual({
      chatTemplateKwargs: {}, chatTemplateArgs: {}, supportsStrictMode: false,
    })
    expect(await fixture.provider.ready?.('github-copilot')).toBe(true)
    expect(fixture.nativeProfile).toEqual(before)
    expect(fixture.fetch).not.toHaveBeenCalled()
  })

  it('sends one fixed proof and one user query using the canonical account', async () => {
    const fixture = setup()
    const result = await fixture.provider.search({ query: 'unique user query' })
    expect(fixture.requests).toHaveLength(2)
    expect(JSON.stringify(fixture.requests[0])).not.toContain('unique user query')
    expect(JSON.stringify(fixture.requests[1])).toContain('unique user query')
    expect(result).toMatchObject({ content: 'A sourced answer.', sources: [{ url: 'https://example.com' }] })
    for (const body of fixture.requests) expect(body).not.toHaveProperty('temperature')
  })

  it('does not turn a native completions override into a Responses search candidate', async () => {
    const fixture = setup()
    const models = nativeCopilotModels({ ...fixture.nativeProfile, api: 'openai-completions' }, getBuiltinModels('github-copilot'))
    expect(models?.get(model.id)?.api).toBe('openai-completions')
    vi.mocked(captureNativeCopilot).mockResolvedValue({
      namespace: 'llm-pi-ai', models: models!, accountModelIds: undefined, assertCurrent: fixture.assertCurrent,
    })
    await expect(fixture.provider.search({ query: 'must not send' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_UNAVAILABLE' })
    expect(fixture.requests).toHaveLength(0)
    expect(fixture.fetch).toHaveBeenCalledTimes(1)
    expect(String(fixture.fetch.mock.calls[0]?.[0])).toMatch(/\/models$/u)
  })
  it('uses the explicitly selected eligible model for both proof and query', async () => {
    const fixture = setup()
    const selected = [model.id, secondModel.id].sort((a, b) => a.localeCompare(b))[1]!
    fixture.copilotSettings.nativeSearchModel = selected
    await fixture.provider.search({ query: 'selected model' })
    expect(fixture.requests.map(request => request.model)).toEqual([selected, selected])
  })

  it('fails without a proof or query when the selected model is unavailable', async () => {
    const fixture = setup()
    fixture.copilotSettings.nativeSearchModel = 'missing-model'
    await expect(fixture.provider.search({ query: 'must not send' })).rejects.toMatchObject({
      code: 'WEB_PROVIDER_UNAVAILABLE', message: 'COPILOT_NATIVE_SEARCH_MODEL_UNAVAILABLE',
    })
    expect(fixture.requests).toHaveLength(0)
  })

  it('lists account-proven Responses candidates without running a search', async () => {
    const fixture = setup()
    delete fixture.webSettings.searchProvider
    await expect(fixture.provider.models()).resolves.toEqual({
      models: candidates.map(candidate => ({ id: candidate.id })).sort((a, b) => a.id.localeCompare(b.id)),
    })
    expect(fixture.requests).toHaveLength(0)
  })

  it('revokes an in-flight search if the chosen search model changes', async () => {
    const fixture = setup()
    const original = fixture.fetch.getMockImplementation()!
    fixture.fetch.mockImplementation(async (url, init) => {
      const response = await original(url, init)
      if (String(url).endsWith('/responses')) {
        fixture.copilotSettings.nativeSearchModel = secondModel.id
        fixture.ctx.emit('settings/updated', 'github-copilot')
      }
      return response
    })
    await expect(fixture.provider.search({ query: 'must not send' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_UNAVAILABLE' })
    expect(fixture.requests).toHaveLength(1)
  })

  it('refuses an unqualified route even when search is called without ready', async () => {
    const fixture = setup()
    vi.mocked(captureNativeCopilot).mockResolvedValue(undefined)
    await expect(fixture.provider.search({ query: 'must not send' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_UNAVAILABLE' })
    expect(fixture.fetch).not.toHaveBeenCalled()
  })

  it('does not send the user query when the proof has no search evidence', async () => {
    const fixture = setup()
    const original = fixture.fetch.getMockImplementation()!
    fixture.fetch.mockImplementation(async (url, init) => {
      const response = await original(url, init)
      return String(url).endsWith('/responses') ? Response.json({ output: [] }) : response
    })
    await expect(fixture.provider.search({ query: 'must not send' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_UNAVAILABLE' })
    expect(fixture.requests).toHaveLength(1)
  })

  it('does not retry a failed final query', async () => {
    const fixture = setup()
    const original = fixture.fetch.getMockImplementation()!
    fixture.fetch.mockImplementation(async (url, init) => {
      const response = await original(url, init)
      return fixture.requests.length === 2 ? new Response('private upstream body', { status: 400 }) : response
    })
    await expect(fixture.provider.search({ query: 'one final query' })).rejects.toMatchObject({
      code: 'WEB_PROVIDER_ERROR', message: 'COPILOT_NATIVE_SEARCH_FAILED',
    })
    expect(fixture.requests).toHaveLength(2)
  })

  it('bounds concurrency and cancels uncooperative metadata fetches', async () => {
    const fixture = setup()
    fixture.fetch.mockImplementation(() => new Promise<Response>(() => {}))
    const controller = new AbortController()
    const operations = Array.from({ length: 4 }, () =>
      fixture.provider.search({ query: 'bounded' }, controller.signal).catch(error => error))
    await vi.waitFor(() => expect(fixture.fetch).toHaveBeenCalledTimes(4))
    await expect(fixture.provider.search({ query: 'fifth' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_UNAVAILABLE' })
    controller.abort()
    expect(await Promise.all(operations)).toEqual(Array.from({ length: 4 }, () => expect.objectContaining({ code: 'ABORTED' })))
  })

  it('revokes an in-flight operation on canonical credential change without retry', async () => {
    const fixture = setup()
    const original = fixture.fetch.getMockImplementation()!
    fixture.fetch.mockImplementation(async (url, init) => {
      const response = await original(url, init)
      if (String(url).endsWith('/responses')) fixture.ctx.emit('credentials/record-updated', key)
      return response
    })
    await expect(fixture.provider.search({ query: 'must not send' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_UNAVAILABLE' })
    expect(fixture.requests).toHaveLength(1)
  })

  it('rejects oversized queries and already-cancelled calls before I/O', async () => {
    const fixture = setup()
    await expect(fixture.provider.search({ query: 'x'.repeat(16385) })).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
    await expect(fixture.provider.search({ query: 'cancelled' }, AbortSignal.abort())).rejects.toMatchObject({ code: 'ABORTED' })
    expect(fixture.fetch).not.toHaveBeenCalled()
  })
})
