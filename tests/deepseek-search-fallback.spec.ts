import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import previewPlugin from '../src/preview-route.ts'
import { GITHUB_COPILOT_CREDENTIAL_KEY } from '../src/copilot-identity.ts'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createLaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import {
  DEEPSEEK_DEFAULT_API_VERSION,
  DEEPSEEK_DEFAULT_BASE_URL,
  DEEPSEEK_DEFAULT_MAX_TOKENS,
  DEEPSEEK_DEFAULT_MAX_USES,
  DEEPSEEK_DEFAULT_MODEL,
  WEB_SEARCH_DEEPSEEK_SETTINGS_NAMESPACE,
} from '@deepseek-ai/dsh-web-search-deepseek'
import type { Config, DeepSeekSearchLlmRequest } from '@deepseek-ai/dsh-web-search-deepseek'
import { createDeepSeekSearchFallback } from '../src/deepseek-search-fallback.ts'

// The public provider and launch-environment API are real. Only the IO boundary is
// intercepted; no Core prototypes/registries, live contexts, home files or keys.
const fetchMock = vi.fn<typeof fetch>()
beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockImplementation(async () => { throw new Error('Unexpected fetch in keyless test') })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { vi.unstubAllGlobals() })

type CredentialValue = { value: string } | undefined
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function harness(config: Config | undefined = {}, values: Record<string, string> = {}) {
  let currentConfig: Config | undefined = config
  const resolve = vi.fn<(ref: string) => Promise<CredentialValue>>(async () => ({ value: 'synthetic-service-key' }))
  let credentials: { resolve: typeof resolve } | undefined = { resolve }
  const snapshot = createLaunchEnvironmentSnapshot([{ source: 'process', values }])
  const environmentGet = vi.fn(snapshot.get)
  const settingsGet = vi.fn((namespace: string) => {
    expect(namespace).toBe(WEB_SEARCH_DEEPSEEK_SETTINGS_NAMESPACE)
    return currentConfig
  })
  const get = vi.fn((name: string) => {
    switch (name) {
      case 'settings': return { get: settingsGet }
      case 'credentials': return credentials
      case 'launchEnvironment': return { get: environmentGet, getFrom: snapshot.getFrom }
      default: throw new Error(`Unexpected service access: ${name}`)
    }
  })
  const append = vi.fn<(event: string, request: DeepSeekSearchLlmRequest) => void>()
  const owner = { session: { append } } as unknown as Agent
  const canContinue = vi.fn(() => true)
  return {
    ctx: { get } as unknown as Context, owner, append, get, resolve, settingsGet, environmentGet, canContinue,
    setConfig: (value: Config | undefined) => { currentConfig = value },
    removeCredentials: () => { credentials = undefined },
  }
}

function success() {
  return Response.json({ content: [{ type: 'web_search_tool_result', content: [
    { type: 'web_search_result', url: 'https://example.test/source', title: 'Source' },
  ] }] })
}

function sent(index = 0) {
  const [endpoint, init] = fetchMock.mock.calls[index]!
  expect(typeof init?.body).toBe('string')
  return { endpoint, init: init!, headers: new Headers(init?.headers), body: JSON.parse(init!.body as string) as DeepSeekSearchLlmRequest['body'] }
}

describe('official DeepSeek fallback factory (keyless public-provider integration)', () => {
  it.each(['expiry', 'silent revocation', 'unchanged', 'caller cancellation'] as const)(
    'checks the actual managed proof after native fallback auth: %s', async change => {
      const start = Date.now()
      const clock = vi.spyOn(Date, 'now').mockReturnValue(start)
      const expires = start + 3_600_000
      const initial = { kind: 'grant', payload: { type: 'oauth', refresh: 'synthetic-copilot-account',
        access: 'synthetic-copilot-access', expires, availableModelIds: ['account-model'] } }
      let current: typeof initial | undefined = initial
      const previewOwner = new Context()
      fetchMock.mockImplementation(async input => {
        if (String(input).endsWith('/models')) return Response.json({ data: [{
          id: 'account-model', name: 'Account model', model_picker_enabled: true, policy: { state: 'enabled' },
          supported_endpoints: ['/responses'], capabilities: { supports: { streaming: true, tool_calls: true },
            limits: { max_context_window_tokens: 128000, max_output_tokens: 8192 } },
        }] })
        return success()
      })
      try {
        await previewOwner.plugin({ apply(ctx: Context) {
          ctx.provide('credentials', {
            readRecord: async () => current,
            listRecords: async () => [{ key: GITHUB_COPILOT_CREDENTIAL_KEY, kind: 'grant' }],
            deleteRecord: async () => { throw new Error('Synthetic fixture must not delete credentials') },
            modifyRecord: async () => { throw new Error('No synthetic grant refresh permitted') },
          } as unknown as Context['credentials'])
        } })
        await previewOwner.plugin(LlmRuntime)
        await previewOwner.plugin(previewPlugin)
        const preview = previewOwner.get('githubCopilotPreview')!
        await preview.discover()
        expect(preview.getView().error).toBeUndefined()
        expect(preview.getView()).toMatchObject({ state: 'ready', available: true })
        expect(preview.routeFacts('account-model')).toMatchObject({ api: 'openai-responses' })
        const heldProof = preview.captureSearchProof()
        const h = harness()
        const pending = deferred<CredentialValue>()
        const started = deferred<void>()
        h.resolve.mockImplementationOnce(() => { started.resolve(); return pending.promise })
        const provider = await createDeepSeekSearchFallback(h.ctx, h.owner, heldProof)
        fetchMock.mockClear()
        const controller = new AbortController()
        const search = provider.search({ query: 'pending fallback key' }, controller.signal)
          .then(value => ({ value }), error => ({ error }))
        await started.promise
        expect(h.append).not.toHaveBeenCalled()
        expect(fetchMock).not.toHaveBeenCalled()
        if (change === 'expiry') clock.mockReturnValue(expires)
        else if (change === 'silent revocation') {
          current = undefined
          // The actual private PreviewLifetime.change runs through a stored read;
          // no record-updated notification and no router generation is simulated.
          await preview.refresh()
        } else if (change === 'caller cancellation') controller.abort()
        pending.resolve({ value: 'synthetic-late-deepseek-key' })
        const outcome = await search
        const permitted = change === 'unchanged'
        expect(h.append).toHaveBeenCalledTimes(permitted ? 1 : 0)
        expect(fetchMock).toHaveBeenCalledTimes(permitted ? 1 : 0)
        if (permitted) expect(outcome).toHaveProperty('value')
        else expect(outcome).toMatchObject({ error: { code: change === 'caller cancellation' ? 'WEB_ABORTED' : 'WEB_PROVIDER_UNAVAILABLE' } })
        if (change === 'expiry' || change === 'silent revocation') expect(heldProof()).toBe(false)
      } finally {
        await previewOwner.fiber.dispose()
        clock.mockRestore()
      }
    },
  )

  it.each([false, true])('checks continuity after native literal-key auth (permitted=%s)', async permitted => {
    const h = harness({ apiKey: 'synthetic-literal-key' })
    fetchMock.mockResolvedValueOnce(success())
    const provider = await createDeepSeekSearchFallback(h.ctx, h.owner, h.canContinue)
    const search = provider.search({ query: 'literal key' })
      .then(value => ({ value }), error => ({ error }))
    // Native apiKey is async even for literal settings: change continuity before
    // its continuation, without substituting the actual native provider class.
    h.canContinue.mockReturnValue(permitted)
    const outcome = await search
    expect(h.resolve).not.toHaveBeenCalled()
    expect(h.append).toHaveBeenCalledTimes(permitted ? 1 : 0)
    expect(fetchMock).toHaveBeenCalledTimes(permitted ? 1 : 0)
    if (permitted) expect(outcome).toHaveProperty('value')
    else expect(outcome).toMatchObject({ error: { code: 'WEB_PROVIDER_UNAVAILABLE' } })
  })

  it('composes the native provider lazily with no service reads, credential resolution or network', async () => {
    const h = harness()
    const provider = await createDeepSeekSearchFallback(h.ctx, h.owner, h.canContinue)
    expect(provider.id).toBe('deepseek-official')
    expect(h.get).not.toHaveBeenCalled()
    expect(h.resolve).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(h.append).not.toHaveBeenCalled()

    expect(provider.available()).toBe(true)
    expect(provider.available()).toBe(true)
    expect(h.settingsGet).toHaveBeenCalledTimes(2)
    expect(h.resolve).not.toHaveBeenCalled()
    expect(h.environmentGet).not.toHaveBeenCalledWith('DEEPSEEK_API_KEY')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(h.append).not.toHaveBeenCalled()
  })

  it('uses search defaults rather than chat configuration or chat environment', async () => {
    const h = harness(undefined, {
      DEEPSEEK_BASE_URL: 'https://chat-only.invalid/v1', DEEPSEEK_MODEL: 'chat-only-model',
    })
    fetchMock.mockResolvedValueOnce(success())
    const provider = await createDeepSeekSearchFallback(h.ctx, h.owner, h.canContinue)
    await provider.search({ query: 'a query' })
    const request = sent()
    expect(request.endpoint).toBe(`${DEEPSEEK_DEFAULT_BASE_URL}/messages`)
    expect(request.endpoint).toBe('https://api.deepseek.com/anthropic/v1/messages')
    expect(request.body).toMatchObject({
      model: DEEPSEEK_DEFAULT_MODEL, max_tokens: DEEPSEEK_DEFAULT_MAX_TOKENS,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: DEEPSEEK_DEFAULT_MAX_USES }],
    })
    expect(request.headers.get('anthropic-version')).toBe(DEEPSEEK_DEFAULT_API_VERSION)
    expect(h.environmentGet).not.toHaveBeenCalledWith('DEEPSEEK_BASE_URL')
    expect(h.environmentGet).not.toHaveBeenCalledWith('DEEPSEEK_MODEL')
  })

  it('snapshots each search before pending auth while reading updated settings on the next search', async () => {
    const initial = { apiKeyEnv: 'FIRST_KEY', baseURL: 'https://first.invalid/anthropic/v1', model: 'first-model', apiVersion: 'first-version', maxTokens: 123, maxUses: 2 }
    const h = harness(initial)
    const pending = deferred<CredentialValue>()
    const started = deferred<void>()
    h.resolve.mockImplementationOnce(() => { started.resolve(); return pending.promise })
    fetchMock.mockImplementation(async () => success())
    const provider = await createDeepSeekSearchFallback(h.ctx, h.owner, h.canContinue)
    const first = provider.search({ query: 'first query' })
    await started.promise
    // Even an in-place settings object update must not mix an old key with a new endpoint.
    Object.assign(initial, { apiKeyEnv: 'SECOND_KEY', baseURL: 'https://second.invalid/anthropic/v1', model: 'second-model', apiVersion: 'second-version', maxTokens: 321, maxUses: 3 })
    pending.resolve({ value: 'synthetic-first-key' })
    const firstResult = await first
    const secondResult = await provider.search({ query: 'second query' })
    expect(firstResult.content).toContain('origin=https://first.invalid')
    expect(firstResult.content).toContain('model="first-model"')
    expect(firstResult.content).not.toContain('second-model')
    expect(secondResult.content).toContain('origin=https://second.invalid')
    expect(secondResult.content).toContain('model="second-model"')
    expect(secondResult.content).toContain('endpoint=custom')
    expect(h.settingsGet).toHaveBeenCalledTimes(2)
    expect(h.resolve.mock.calls).toEqual([['FIRST_KEY'], ['SECOND_KEY']])
    expect(sent(0).endpoint).toBe('https://first.invalid/anthropic/v1/messages')
    expect(sent(0).body).toMatchObject({ model: 'first-model', max_tokens: 123, tools: [{ max_uses: 2 }] })
    expect(sent(0).headers.get('anthropic-version')).toBe('first-version')
    expect(sent(0).headers.get('x-api-key')).toBe('synthetic-first-key')
    expect(sent(1).endpoint).toBe('https://second.invalid/anthropic/v1/messages')
    expect(sent(1).body).toMatchObject({ model: 'second-model', max_tokens: 321, tools: [{ max_uses: 3 }] })
    expect(sent(1).headers.get('anthropic-version')).toBe('second-version')
  })

  it('keeps backend disclosure attached to each concurrent option snapshot', async () => {
    const h = harness({ baseURL: 'https://a.invalid/v1', model: 'model-a' })
    const keyA = deferred<CredentialValue>()
    const startedA = deferred<void>()
    h.resolve.mockImplementationOnce(() => { startedA.resolve(); return keyA.promise })
    fetchMock.mockImplementation(async () => success())
    const provider = await createDeepSeekSearchFallback(h.ctx, h.owner, h.canContinue)
    const a = provider.search({ query: 'A' })
    await startedA.promise
    h.setConfig({ baseURL: 'https://b.invalid/v1', model: 'model-b' })
    const b = await provider.search({ query: 'B' })
    keyA.resolve({ value: 'synthetic-a' })
    const first = await a
    expect(first.content).toContain('origin=https://a.invalid; model="model-a"')
    expect(first.content).not.toContain('model-b')
    expect(b.content).toContain('origin=https://b.invalid; model="model-b"')
    expect(b.content).not.toContain('model-a')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('uses credentials service precedence and resolves a fresh credential for every search', async () => {
    const h = harness({ apiKeyEnv: 'SEARCH_KEY' }, { SEARCH_KEY: 'synthetic-env-key' })
    h.resolve.mockResolvedValueOnce({ value: 'synthetic-service-one' }).mockResolvedValueOnce({ value: 'synthetic-service-two' })
    fetchMock.mockImplementation(async () => success())
    const provider = await createDeepSeekSearchFallback(h.ctx, h.owner, h.canContinue)
    await provider.search({ query: 'one' })
    await provider.search({ query: 'two' })
    expect(h.resolve.mock.calls).toEqual([['SEARCH_KEY'], ['SEARCH_KEY']])
    expect(sent(0).headers.get('x-api-key')).toBe('synthetic-service-one')
    expect(sent(1).headers.get('authorization')).toBe('Bearer synthetic-service-two')
    expect(h.environmentGet).not.toHaveBeenCalledWith('SEARCH_KEY')
  })

  it.each([undefined, { value: '' }])('does not fall through an empty credentials service result to environment: %j', async value => {
    const h = harness({}, { DEEPSEEK_API_KEY: 'synthetic-env-key' })
    h.resolve.mockResolvedValue(value)
    const provider = await createDeepSeekSearchFallback(h.ctx, h.owner, h.canContinue)
    expect(provider.available()).toBe(true) // Synchronous capability, not auth readiness.
    await expect(provider.search({ query: 'test' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_CREDENTIAL_MISSING' })
    expect(h.environmentGet).not.toHaveBeenCalledWith('DEEPSEEK_API_KEY')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(h.append).not.toHaveBeenCalled()
  })

  it('does not retry failed credential resolution or fall through to environment', async () => {
    const h = harness({}, { DEEPSEEK_API_KEY: 'synthetic-env-key' })
    h.resolve.mockRejectedValueOnce(new Error('synthetic credential service failure'))
    const provider = await createDeepSeekSearchFallback(h.ctx, h.owner, h.canContinue)
    await expect(provider.search({ query: 'test' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
    expect(h.resolve).toHaveBeenCalledOnce()
    expect(h.environmentGet).not.toHaveBeenCalledWith('DEEPSEEK_API_KEY')
    expect(h.append).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('uses the synthetic launch environment only when the credential service is absent', async () => {
    const h = harness({ apiKeyEnv: 'SEARCH_KEY' }, { SEARCH_KEY: 'synthetic-env-key', DEEPSEEK_SEARCH_BASE_URL: 'https://environment.invalid/anthropic/v1' })
    h.removeCredentials()
    fetchMock.mockResolvedValueOnce(success())
    const provider = await createDeepSeekSearchFallback(h.ctx, h.owner, h.canContinue)
    await provider.search({ query: 'test' })
    expect(sent().endpoint).toBe('https://environment.invalid/anthropic/v1/messages')
    expect(sent().headers.get('x-api-key')).toBe('synthetic-env-key')
    expect(h.resolve).not.toHaveBeenCalled()
    expect(h.environmentGet).toHaveBeenCalledWith('SEARCH_KEY')
  })

  it.each([undefined, ''])('rejects missing/empty launch credentials without dispatch: %j', async value => {
    const h = harness({}, value === undefined ? {} : { DEEPSEEK_API_KEY: value })
    h.removeCredentials()
    const provider = await createDeepSeekSearchFallback(h.ctx, h.owner, h.canContinue)
    await expect(provider.search({ query: 'test' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_CREDENTIAL_MISSING' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('preserves official literal-key and configured-endpoint precedence', async () => {
    const h = harness({ apiKey: 'synthetic-literal-key', baseURL: 'https://configured.invalid/anthropic/v1' }, {
      DEEPSEEK_API_KEY: 'synthetic-env-key', DEEPSEEK_SEARCH_BASE_URL: 'https://environment.invalid/anthropic/v1',
    })
    fetchMock.mockResolvedValueOnce(success())
    const provider = await createDeepSeekSearchFallback(h.ctx, h.owner, h.canContinue)
    await provider.search({ query: 'test' })
    expect(sent().endpoint).toBe('https://configured.invalid/anthropic/v1/messages')
    expect(sent().headers.get('x-api-key')).toBe('synthetic-literal-key')
    expect(h.resolve).not.toHaveBeenCalled()
    expect(h.environmentGet).not.toHaveBeenCalledWith('DEEPSEEK_API_KEY')
    expect(h.environmentGet).not.toHaveBeenCalledWith('DEEPSEEK_SEARCH_BASE_URL')
  })

  it('treats an empty literal key as absent and sees replacement settings on reuse', async () => {
    const h = harness({ apiKey: '' })
    fetchMock.mockImplementation(async () => success())
    const provider = await createDeepSeekSearchFallback(h.ctx, h.owner, h.canContinue)
    await provider.search({ query: 'one' })
    h.setConfig({ apiKey: 'synthetic-new-literal', model: 'new-model' })
    await provider.search({ query: 'two' })
    expect(h.resolve).toHaveBeenCalledOnce()
    expect(sent(0).headers.get('x-api-key')).toBe('synthetic-service-key')
    expect(sent(1).headers.get('x-api-key')).toBe('synthetic-new-literal')
    expect(sent(1).body.model).toBe('new-model')
  })

  it('records the exact auxiliary request on the captured owner before fetch, with no credential/header fields', async () => {
    const h = harness({ apiKeyEnv: 'SEARCH_KEY' }, { SEARCH_KEY: 'synthetic-env-key' })
    const other = harness()
    const pending = deferred<CredentialValue>()
    const started = deferred<void>()
    h.resolve.mockImplementationOnce(() => { started.resolve(); return pending.promise })
    fetchMock.mockImplementation(async () => {
      expect(h.append).toHaveBeenCalledOnce()
      return success()
    })
    let currentOwner = h.owner
    const provider = await createDeepSeekSearchFallback(h.ctx, currentOwner, h.canContinue)
    const search = provider.search({ query: 'query supplied to the auxiliary model' })
    await started.promise
    currentOwner = other.owner
    pending.resolve({ value: 'synthetic-secret-service-value' })
    await search
    expect(currentOwner).toBe(other.owner)
    expect(other.append).not.toHaveBeenCalled()
    const request = sent()
    expect(h.append).toHaveBeenCalledWith('web/deepseek-search-llm-request', {
      endpoint: request.endpoint, apiVersion: DEEPSEEK_DEFAULT_API_VERSION, body: request.body,
    })
    expect(Object.keys(h.append.mock.calls[0]![1]).sort()).toEqual(['apiVersion', 'body', 'endpoint'])
    const serialized = JSON.stringify(h.append.mock.calls)
    for (const secret of ['synthetic-secret-service-value', 'synthetic-env-key', 'SEARCH_KEY', 'authorization', 'x-api-key']) expect(serialized).not.toContain(secret)
  })

  it('does not look up a substitute owner when none was captured', async () => {
    const h = harness()
    fetchMock.mockResolvedValueOnce(success())
    const provider = await createDeepSeekSearchFallback(h.ctx, undefined, h.canContinue)
    await provider.search({ query: 'test' })
    expect(h.append).not.toHaveBeenCalled()
    expect(h.get).not.toHaveBeenCalledWith('agents')
  })

  it('does not dispatch when captured-owner recording fails', async () => {
    const h = harness()
    const failure = new Error('synthetic append failure')
    h.append.mockImplementation(() => { throw failure })
    const provider = await createDeepSeekSearchFallback(h.ctx, h.owner, h.canContinue)
    await expect(provider.search({ query: 'test' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('cancels before resolving a credential, recording or dispatching', async () => {
    const h = harness()
    const controller = new AbortController()
    controller.abort(new Error('caller cancelled'))
    const provider = await createDeepSeekSearchFallback(h.ctx, h.owner, h.canContinue)
    await expect(provider.search({ query: 'test' }, controller.signal)).rejects.toMatchObject({ code: 'WEB_ABORTED' })
    expect(h.resolve).not.toHaveBeenCalled()
    expect(h.environmentGet).not.toHaveBeenCalledWith('DEEPSEEK_API_KEY')
    expect(h.append).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(['resolve', 'reject'] as const)('cancels pending auth immediately and observes its late %s without dispatch', async settlement => {
    const h = harness()
    const pending = deferred<CredentialValue>()
    const started = deferred<void>()
    h.resolve.mockImplementationOnce(() => { started.resolve(); return pending.promise })
    const provider = await createDeepSeekSearchFallback(h.ctx, h.owner, h.canContinue)
    const controller = new AbortController()
    const search = provider.search({ query: 'test' }, controller.signal)
    const rejected = expect(search).rejects.toMatchObject({ code: 'WEB_ABORTED' })
    await started.promise
    controller.abort()
    await rejected // Must settle before the uncooperative credentials promise does.
    if (settlement === 'resolve') pending.resolve({ value: 'synthetic-late-secret' })
    else pending.reject(new Error('synthetic late auth failure'))
    await Promise.resolve()
    await Promise.resolve()
    expect(h.resolve).toHaveBeenCalledOnce()
    expect(h.append).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('delegates redirect refusal and caller cancellation to the real fetch transport', async () => {
    const h = harness()
    const controller = new AbortController()
    const started = deferred<void>()
    fetchMock.mockImplementation((_url, init) => {
      expect(init?.redirect).toBe('error')
      expect(init?.signal).toBe(controller.signal)
      started.resolve()
      return new Promise((_resolve, reject) => { init!.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }) })
    })
    const provider = await createDeepSeekSearchFallback(h.ctx, h.owner, h.canContinue)
    const search = provider.search({ query: 'test' }, controller.signal)
    const rejected = expect(search).rejects.toMatchObject({ code: 'WEB_ABORTED' })
    await started.promise
    controller.abort()
    await rejected
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('does not retry a refused redirect or invent another transport', async () => {
    const h = harness()
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed: unexpected redirect'))
    const provider = await createDeepSeekSearchFallback(h.ctx, h.owner, h.canContinue)
    await expect(provider.search({ query: 'test' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
    expect(sent().init.redirect).toBe('error')
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it.each([
    'https://synthetic-user:synthetic-password@example.test/anthropic/v1',
    'https://example.test/anthropic/v1?key=synthetic-query-secret',
    'https://example.test/anthropic/v1#synthetic-fragment-secret',
    'https://example.test/anthropic/v1?',
    'https://example.test/anthropic/v1#',
    'file:///synthetic-private-path',
    'ftp://example.test/anthropic/v1',
    'synthetic-malformed-base',
  ])('rejects unsafe or malformed API bases before auth/recording/fetch: %s', async baseURL => {
    for (const source of ['settings', 'environment'] as const) {
      const h = harness(source === 'settings' ? { baseURL } : {}, source === 'environment' ? { DEEPSEEK_SEARCH_BASE_URL: baseURL } : {})
      const provider = await createDeepSeekSearchFallback(h.ctx, h.owner, h.canContinue)
      expect(h.get).not.toHaveBeenCalled() // Validation stays lazy too.
      const error = await provider.search({ query: 'test' }).catch((reason: unknown) => reason)
      expect(error).toMatchObject({ code: 'WEB_PROVIDER_UNAVAILABLE' })
      expect(String(error)).toBe('InvalidFallbackBase: DeepSeek fallback requires an HTTP(S) API base URL without userinfo, query or fragment')
      expect(() => provider.available()).toThrow('DeepSeek fallback requires an HTTP(S) API base URL without userinfo, query or fragment')
      expect(h.get).not.toHaveBeenCalledWith('credentials')
      expect(h.resolve).not.toHaveBeenCalled()
      expect(h.append).not.toHaveBeenCalled()
      expect(fetchMock).not.toHaveBeenCalled()
    }
  })

  it.each(['https://example.test/custom%3Fpath/v1', 'http://localhost:1234/custom/v1'])('preserves allowed HTTP(S) base paths without rewriting or a host allowlist: %s', async baseURL => {
    const h = harness({ baseURL })
    fetchMock.mockResolvedValueOnce(success())
    const provider = await createDeepSeekSearchFallback(h.ctx, h.owner, h.canContinue)
    expect(provider.available()).toBe(true)
    await provider.search({ query: 'test' })
    expect(sent().endpoint).toBe(`${baseURL}/messages`)
  })

  it.each([{ maxTokens: 0 }, { maxUses: -1 }, { maxUses: 1.5 }])('retains official availability validation without auth/network: %j', async config => {
    const h = harness(config)
    const provider = await createDeepSeekSearchFallback(h.ctx, h.owner, h.canContinue)
    expect(provider.available()).toBe(false)
    expect(h.resolve).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('delegates native structured-result parsing, citation joining and URL deduplication', async () => {
    const h = harness()
    fetchMock.mockResolvedValueOnce(Response.json({ content: [
      { type: 'text', text: 'untrusted prose is not a substitute result', citations: [
        { url: 'https://example.test/a', cited_text: 'first excerpt' },
        { url: 'https://example.test/a', cited_text: 'duplicate excerpt' },
      ] },
      { type: 'web_search_tool_result', content: [
        { type: 'web_search_result', url: 'https://example.test/a', title: 'A', page_age: '2026-01-01' },
        { type: 'web_search_result', url: 'https://example.test/a', title: 'Duplicate' },
        { type: 'web_search_result', url: 'https://example.test/b', title: 'B' },
      ] },
    ] }))
    const provider = await createDeepSeekSearchFallback(h.ctx, h.owner, h.canContinue)
    // The official web seam owns maxResults truncation, not this provider factory.
    await expect(provider.search({ query: 'test', maxResults: 1 })).resolves.toMatchObject({ content: expect.stringContaining('origin=https://api.deepseek.com'), sources: [
      { url: 'https://example.test/a', title: 'A', publishedAt: '2026-01-01', snippet: 'first excerpt' },
      { url: 'https://example.test/b', title: 'B' },
    ], truncated: false })
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('sanitizes native HTTP error detail while retaining safe backend metadata without retry', async () => {
    const h = harness()
    fetchMock.mockResolvedValueOnce(Response.json({ error: { message: 'synthetic upstream failure detail' } }, { status: 503 }))
    const provider = await createDeepSeekSearchFallback(h.ctx, h.owner, h.canContinue)
    const error = await provider.search({ query: 'test' }).catch((reason: unknown) => reason)
    expect(error).toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
    expect(String(error)).not.toContain('synthetic upstream failure detail')
    expect(error).toMatchObject({ backend: {
      provider: 'deepseek-official', origin: 'https://api.deepseek.com', model: DEEPSEEK_DEFAULT_MODEL, customEndpoint: false,
    } })
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(h.resolve).toHaveBeenCalledOnce()
    expect(h.append).toHaveBeenCalledOnce()
  })

  it('rejects prose-only responses without leaking their text or retrying', async () => {
    const h = harness()
    fetchMock.mockResolvedValueOnce(Response.json({ content: [{ type: 'text', text: 'synthetic-private-response-body' }] }))
    const provider = await createDeepSeekSearchFallback(h.ctx, h.owner, h.canContinue)
    const error = await provider.search({ query: 'test' }).catch((reason: unknown) => reason)
    expect(error).toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
    expect(String(error)).not.toContain('synthetic-private-response-body')
    expect(String(error)).not.toContain('synthetic-service-key')
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})
