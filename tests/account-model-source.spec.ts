import { afterEach, describe, expect, it, vi } from 'vitest'
import { AccountModelSource, AccountModelSourceError, createAccountModelSource } from '../src/account-model-source.ts'
import type { AccountModelAuth, AccountModelSourceDependencies } from '../src/account-model-source.ts'

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const auth: AccountModelAuth = {
  apiKey: 'SYNTHETIC_SECRET_ACCESS', baseURL: 'https://api.individual.githubcopilot.com',
  accountKey: 'opaque-account-a', availableModelIds: ['future-lab-r17'],
}
function metadata(id = 'future-lab-r17') {
  return { data: [{ id, name: id, model_picker_enabled: true, policy: { state: 'enabled' }, supported_endpoints: ['/responses'],
    capabilities: { supports: { tool_calls: true, streaming: true, vision: false, reasoning_effort: ['high'] },
      limits: { max_context_window_tokens: 10000, max_prompt_tokens: 8000, max_output_tokens: 2000 } },
  }] }
}
function response(id?: string) { return new Response(JSON.stringify(metadata(id))) }
const sources: AccountModelSource[] = []
function setup(overrides: Partial<AccountModelSourceDependencies> = {}) {
  let clock = 1000
  const resolveAuth = vi.fn(async () => auth)
  const assertAuthCurrent = vi.fn(async () => undefined)
  const fetch = vi.fn<typeof globalThis.fetch>(async () => response())
  const source = createAccountModelSource({ resolveAuth, assertAuthCurrent, fetch, now: () => clock, ttlMs: 100, failureCooldownMs: 0, timeoutMs: 1000, ...overrides })
  sources.push(source)
  return { source, resolveAuth, assertAuthCurrent, fetch, advance: (by: number) => { clock += by } }
}
afterEach(() => {
  for (const source of sources.splice(0)) source.dispose()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('account-bound model source', () => {
  it('is lazy, uses exact trusted root GET with non-forwarding redirects, and freezes only public snapshot data', async () => {
    const { source, fetch, resolveAuth, assertAuthCurrent } = setup({ headers: { 'Editor-Version': 'synthetic-editor' } })
    expect(source.getView()).toMatchObject({ state: 'idle', modelCount: 0 })
    expect(source.readSnapshot()).toBeUndefined()
    expect(resolveAuth).not.toHaveBeenCalled()
    const snapshot = await source.load()
    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, options] = fetch.mock.calls[0]!
    expect(url).toBe('https://api.individual.githubcopilot.com/models')
    expect(options).toMatchObject({ method: 'GET', redirect: 'error', credentials: 'omit', cache: 'no-store' })
    const headers = new Headers(options?.headers)
    expect(headers.get('Authorization')).toBe(`Bearer ${auth.apiKey}`)
    expect(headers.get('Accept')).toBe('application/json')
    expect(headers.get('Editor-Version')).toBe('synthetic-editor')
    expect(assertAuthCurrent).toHaveBeenCalledTimes(3)
    expect(snapshot).toMatchObject({ accountKey: auth.accountKey, fetchedAt: 1000, models: [{ id: 'future-lab-r17', api: 'openai-responses', maxInputTokens: 8000 }] })
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(snapshot.models)).toBe(true)
    expect(Object.isFrozen(snapshot.models[0]!.reasoning)).toBe(true)
    expect(JSON.stringify(snapshot)).not.toContain(auth.apiKey)
    expect(JSON.stringify(source.getView())).not.toContain(auth.apiKey)
    expect(source.getView()).not.toHaveProperty('accountKey')
    expect(source.readSnapshot()).toBe(snapshot)
  })

  it('coalesces force and ordinary callers while one request is in flight', async () => {
    const gate = deferred<Response>()
    const entered = deferred<void>()
    const fetch = vi.fn<typeof globalThis.fetch>(async () => { entered.resolve(); return gate.promise })
    const { source, resolveAuth } = setup({ fetch })
    const first = source.load()
    await entered.promise
    const second = source.load({ force: true })
    const third = source.load()
    gate.resolve(response())
    const snapshots = await Promise.all([first, second, third])
    expect(snapshots[0]).toBe(snapshots[1])
    expect(snapshots[1]).toBe(snapshots[2])
    expect(resolveAuth).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('uses fresh TTL cache, treats expiry as stale, and force starts a new generation', async () => {
    const { source, fetch, resolveAuth, advance } = setup()
    const first = await source.load()
    advance(99)
    expect(await source.load()).toBe(first)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(resolveAuth).toHaveBeenCalledTimes(1)
    advance(1)
    expect(source.readSnapshot()).toBeUndefined()
    expect(source.getView().state).toBe('stale')
    const second = await source.load()
    expect(second.generation).toBeGreaterThan(first.generation)
    const third = await source.load({ force: true })
    expect(third.generation).toBeGreaterThan(second.generation)
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('retains same-generation display metadata across TTL expiry, loading, and fetch failure without fresh reuse', async () => {
    const { source, fetch, advance } = setup()
    const snapshot = await source.load()
    advance(100)
    expect(source.readDisplaySnapshot()).toBe(snapshot)
    expect(source.readSnapshot()).toBeUndefined()
    expect(source.getView()).toMatchObject({ state: 'stale', modelCount: 1, fetchedAt: snapshot.fetchedAt })
    const entered = deferred<void>()
    const gate = deferred<Response>()
    fetch.mockImplementationOnce(async () => { entered.resolve(); return gate.promise })
    const pending = source.load({ force: true })
    const failed = expect(pending).rejects.toMatchObject({ code: 'COPILOT_MODEL_SOURCE_FETCH_FAILED' })
    await entered.promise
    expect(source.readDisplaySnapshot()).toBe(snapshot)
    expect(source.getView()).toMatchObject({ state: 'loading', generation: snapshot.generation, modelCount: 1 })
    expect(source.readSnapshot()).toBeUndefined()
    gate.reject(new Error('synthetic offline'))
    await failed
    expect(source.readSnapshot()).toBeUndefined()
    expect(source.readDisplaySnapshot()).toBe(snapshot)
    expect(source.getView()).toMatchObject({ state: 'error', modelCount: 1 })
    const next = await source.load()
    expect(next).not.toBe(snapshot)
    expect(source.readSnapshot()).toBe(next)
    expect(source.readDisplaySnapshot()).toBe(next)
  })

  it('never reauthorizes a still-young snapshot after a forced load fails', async () => {
    const { source, fetch } = setup()
    const snapshot = await source.load()
    fetch.mockRejectedValueOnce(new Error('synthetic offline'))
    await expect(source.load({ force: true })).rejects.toThrow('COPILOT_MODEL_SOURCE_FETCH_FAILED')
    expect(source.readSnapshot()).toBeUndefined()
    expect(source.readDisplaySnapshot()).toBe(snapshot)
    source.invalidate()
    expect(source.readDisplaySnapshot()).toBeUndefined()
    await source.load()
    source.dispose()
    expect(source.readDisplaySnapshot()).toBeUndefined()
  })

  it.each([-1, Number.NaN, Infinity])('refuses display metadata for an invalid clock delta %s', async delta => {
    const { source, advance } = setup()
    await source.load()
    advance(delta)
    expect(source.readSnapshot()).toBeUndefined()
    expect(source.readDisplaySnapshot()).toBeUndefined()
    expect(source.getView().modelCount).toBe(0)
  })

  it.each(['account', 'auth', 'check', '401', '403'] as const)('clears previous display metadata on revoked proof: %s', async kind => {
    const { source, fetch, resolveAuth, assertAuthCurrent } = setup()
    await source.load()
    if (kind === 'account') resolveAuth.mockResolvedValue({ ...auth, accountKey: 'opaque-account-b' })
    if (kind === 'auth') resolveAuth.mockRejectedValue(new Error('synthetic read failure'))
    if (kind === 'check') assertAuthCurrent.mockRejectedValue(new Error('synthetic permission change'))
    fetch.mockImplementation(async () => {
      expect(source.readDisplaySnapshot()).toBeUndefined()
      return new Response('', { status: 503 })
    })
    if (kind === '401' || kind === '403') fetch.mockResolvedValue(new Response('', { status: Number(kind) }))
    await expect(source.load({ force: true })).rejects.toBeInstanceOf(AccountModelSourceError)
    expect(source.readDisplaySnapshot()).toBeUndefined()
    expect(source.readSnapshot()).toBeUndefined()
  })

  it('defaults to a day-long metadata cache and a five-minute passive failure cooldown', async () => {
    const { source, fetch, resolveAuth, advance } = setup({ ttlMs: undefined, failureCooldownMs: undefined })
    const snapshot = await source.load()
    advance(86_400_000 - 1)
    expect(await source.load()).toBe(snapshot)
    advance(1)
    fetch.mockRejectedValueOnce(new Error('synthetic offline'))
    await expect(source.load()).rejects.toThrow('COPILOT_MODEL_SOURCE_FETCH_FAILED')
    advance(300_000 - 1)
    await expect(source.load()).rejects.toThrow('COPILOT_MODEL_SOURCE_FETCH_FAILED')
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(resolveAuth).toHaveBeenCalledTimes(2)
    expect(source.readDisplaySnapshot()).toBe(snapshot)
    advance(1)
    expect(await source.load()).not.toBe(snapshot)
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('force bypasses the cooldown, concurrent callers coalesce, and invalidation resets it', async () => {
    const { source, fetch, resolveAuth } = setup({ failureCooldownMs: 500 })
    fetch.mockRejectedValueOnce(new Error('synthetic offline'))
    await expect(source.load()).rejects.toThrow('COPILOT_MODEL_SOURCE_FETCH_FAILED')
    const entered = deferred<void>()
    const gate = deferred<Response>()
    fetch.mockImplementationOnce(async () => { entered.resolve(); return gate.promise })
    const forced = source.load({ force: true })
    await entered.promise
    const passive = source.load()
    gate.resolve(response())
    expect(await passive).toBe(await forced)
    fetch.mockRejectedValueOnce(new Error('synthetic offline'))
    await expect(source.load({ force: true })).rejects.toThrow('COPILOT_MODEL_SOURCE_FETCH_FAILED')
    await expect(source.load()).rejects.toThrow('COPILOT_MODEL_SOURCE_FETCH_FAILED')
    source.invalidate()
    await source.load()
    expect(fetch).toHaveBeenCalledTimes(4)
    expect(resolveAuth).toHaveBeenCalledTimes(4)
  })

  it('reads bounded live cache settings without scheduling discovery', async () => {
    let ttlMs = 500
    let cooldownMs = 500
    const { source, fetch, advance } = setup({ ttlMs: () => ttlMs, failureCooldownMs: () => cooldownMs })
    await source.load()
    advance(100)
    expect(source.readSnapshot()).toBeDefined()
    ttlMs = 50
    expect(source.readSnapshot()).toBeUndefined()
    expect(fetch).toHaveBeenCalledTimes(1)
    fetch.mockRejectedValueOnce(new Error('synthetic offline'))
    await expect(source.load()).rejects.toThrow('COPILOT_MODEL_SOURCE_FETCH_FAILED')
    advance(100)
    await expect(source.load()).rejects.toThrow('COPILOT_MODEL_SOURCE_FETCH_FAILED')
    cooldownMs = 50
    await source.load()
    expect(fetch).toHaveBeenCalledTimes(3)
    ttlMs = Infinity
    expect(() => source.readSnapshot()).toThrow('COPILOT_MODEL_SOURCE_INVALID_CONFIG')
  })

  it('revokes an exact rejected snapshot and backs off passive recovery without revoking a newer generation', async () => {
    const { source, fetch } = setup({ failureCooldownMs: 300_000 })
    const first = await source.load()
    expect(source.rejectSnapshot(first)).toBe(true)
    expect(source.readDisplaySnapshot()).toBeUndefined()
    expect(source.readSnapshot()).toBeUndefined()
    await expect(source.load()).rejects.toThrow('COPILOT_MODEL_SOURCE_INVALIDATED')
    expect(fetch).toHaveBeenCalledTimes(1)
    const next = await source.load({ force: true })
    expect(source.rejectSnapshot(first)).toBe(false)
    expect(source.readSnapshot()).toBe(next)
  })

  it('does not let a cancelled waiter abort another waiter', async () => {
    const gate = deferred<Response>()
    const entered = deferred<AbortSignal>()
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, options) => { entered.resolve(options!.signal!); return gate.promise })
    const { source } = setup({ fetch })
    const caller = new AbortController()
    const first = source.load({ signal: caller.signal })
    const caught = first.catch(error => error)
    const second = source.load()
    const underlying = await entered.promise
    caller.abort(new Error('PRIVATE_ABORT_REASON'))
    expect(await caught).toMatchObject({ code: 'COPILOT_MODEL_SOURCE_ABORTED' })
    expect(underlying.aborted).toBe(false)
    gate.resolve(response())
    expect((await second).models).toHaveLength(1)
    expect(source.getView().state).toBe('ready')
  })

  it('cancels orphaned work when all waiters abort and does not publish a late result', async () => {
    const gate = deferred<Response>()
    const entered = deferred<AbortSignal>()
    const { source } = setup({ fetch: async (_url, options) => { entered.resolve(options!.signal!); return gate.promise } })
    const caller = new AbortController()
    const pending = source.load({ signal: caller.signal }).catch(error => error)
    const underlying = await entered.promise
    caller.abort()
    expect(await pending).toMatchObject({ code: 'COPILOT_MODEL_SOURCE_ABORTED' })
    expect(underlying.aborted).toBe(true)
    const cancelled = deferred<void>()
    const cancel = vi.fn(() => { cancelled.resolve() })
    gate.resolve(new Response(new ReadableStream({ cancel })))
    await cancelled.promise
    expect(source.readSnapshot()).toBeUndefined()
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('does not start work for an already-aborted caller', async () => {
    const { source, resolveAuth } = setup()
    const controller = new AbortController()
    controller.abort('PRIVATE_ABORT_REASON')
    await expect(source.load({ signal: controller.signal })).rejects.toMatchObject({ code: 'COPILOT_MODEL_SOURCE_ABORTED' })
    expect(resolveAuth).not.toHaveBeenCalled()
  })

  it('does not invoke auth when the sole caller cancels before the first microtask', async () => {
    const { source, resolveAuth } = setup()
    const controller = new AbortController()
    const pending = source.load({ signal: controller.signal }).catch(error => error)
    controller.abort()
    expect(await pending).toMatchObject({ code: 'COPILOT_MODEL_SOURCE_ABORTED' })
    expect(resolveAuth).not.toHaveBeenCalled()
  })

  it('enforces the whole-operation deadline even before its timer callback can run', async () => {
    let monotonic = 0
    vi.spyOn(performance, 'now').mockImplementation(() => monotonic)
    const { source, fetch } = setup({ timeoutMs: 10, resolveAuth: async () => { monotonic = 20; return auth } })
    await expect(source.load()).rejects.toMatchObject({ code: 'COPILOT_MODEL_SOURCE_TIMEOUT' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('allows natural token refresh invalidation during auth and captures the new epoch before HTTP', async () => {
    const gate = deferred<AccountModelAuth>()
    const entered = deferred<AbortSignal>()
    const { source, fetch } = setup({ resolveAuth: async signal => { entered.resolve(signal); return gate.promise } })
    const pending = source.load()
    const signal = await entered.promise
    const before = source.getView().generation
    source.invalidate()
    expect(signal.aborted).toBe(false)
    gate.resolve({ ...auth, apiKey: 'SYNTHETIC_FRESH_ACCESS' })
    const snapshot = await pending
    expect(snapshot.generation).toBeGreaterThan(before)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(new Headers(fetch.mock.calls[0]![1]!.headers).get('Authorization')).toBe('Bearer SYNTHETIC_FRESH_ACCESS')
  })

  it('rejects auth that was switched while resolving instead of sending the old token', async () => {
    const { source, fetch } = setup({ assertAuthCurrent: async () => { throw new Error(auth.apiKey) } })
    await expect(source.load()).rejects.toMatchObject({ code: 'COPILOT_MODEL_SOURCE_AUTH_CHANGED' })
    expect(fetch).not.toHaveBeenCalled()
    expect(JSON.stringify(source.getView())).not.toContain(auth.apiKey)
  })

  it.each(['account', 'token'] as const)('rejects an actual %s switch while HTTP is pending', async kind => {
    const gate = deferred<Response>()
    const entered = deferred<void>()
    let current = { ...auth }
    const { source } = setup({ resolveAuth: async () => current,
      assertAuthCurrent: async captured => {
        if (captured.accountKey !== current.accountKey || captured.apiKey !== current.apiKey) throw new Error('PRIVATE_AUTH_CHANGE')
      },
      fetch: async () => { entered.resolve(); return gate.promise },
    })
    const pending = source.load().catch(error => error)
    await entered.promise
    current = kind === 'account' ? { ...current, accountKey: 'opaque-account-b' } : { ...current, apiKey: 'NEW_SECRET_ACCESS' }
    gate.resolve(response())
    expect(await pending).toMatchObject({ code: 'COPILOT_MODEL_SOURCE_AUTH_CHANGED' })
    expect(source.readSnapshot()).toBeUndefined()
  })

  it('invalidates a cached result without starting another auth or HTTP operation', async () => {
    const { source, resolveAuth, fetch } = setup()
    await source.load()
    source.invalidate()
    expect(source.readSnapshot()).toBeUndefined()
    expect(source.getView()).toMatchObject({ state: 'idle', modelCount: 0 })
    expect(resolveAuth).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('zero TTL disables cache reuse without disabling successful load results', async () => {
    const { source, fetch } = setup({ ttlMs: 0 })
    const first = await source.load()
    expect(first.models).toHaveLength(1)
    expect(source.readSnapshot()).toBeUndefined()
    await source.load()
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('does not fall back to an old cached account after a forced refresh failure', async () => {
    let calls = 0
    const { source } = setup({ resolveAuth: async () => { if (++calls > 1) throw new Error('PRIVATE_FAILURE'); return auth } })
    await source.load()
    await expect(source.load({ force: true })).rejects.toMatchObject({ code: 'COPILOT_MODEL_SOURCE_AUTH_FAILED' })
    expect(source.readSnapshot()).toBeUndefined()
    expect(source.getView().state).toBe('error')
  })

  it('invalidate is network-free and an invalidated HTTP result cannot overwrite a newer load', async () => {
    const gate = deferred<Response>()
    const entered = deferred<AbortSignal>()
    let calls = 0
    const { source } = setup({ fetch: async (_url, options) => {
      if (++calls === 1) { entered.resolve(options!.signal!); return gate.promise }
      return response('new-model')
    } })
    const first = source.load().catch(error => error)
    const signal = await entered.promise
    source.invalidate()
    expect(calls).toBe(1)
    expect(signal.aborted).toBe(true)
    expect(await first).toMatchObject({ code: 'COPILOT_MODEL_SOURCE_INVALIDATED' })
    const next = await source.load()
    gate.resolve(response('old-model'))
    await gate.promise
    await Promise.resolve()
    expect(source.readSnapshot()).toBe(next)
    expect(next.models[0]?.id).toBe('new-model')
  })

  it.each([2, 3])('rejects account/token changes at auth validation checkpoint %s without publishing', async checkpoint => {
    let calls = 0
    const { source } = setup({ assertAuthCurrent: async () => { if (++calls === checkpoint) throw new Error('PRIVATE_TOKEN_CHANGE') } })
    await expect(source.load()).rejects.toMatchObject({ code: 'COPILOT_MODEL_SOURCE_AUTH_CHANGED' })
    expect(source.readSnapshot()).toBeUndefined()
    expect(source.getView()).toMatchObject({ state: 'error', error: 'COPILOT_MODEL_SOURCE_AUTH_CHANGED' })
  })

  it('invalidates during the final asynchronous validation even if that callback later succeeds', async () => {
    const gate = deferred<void>()
    const entered = deferred<void>()
    let checks = 0
    const { source } = setup({ assertAuthCurrent: async () => { if (++checks === 3) { entered.resolve(); await gate.promise } } })
    const pending = source.load().catch(error => error)
    await entered.promise
    source.invalidate()
    expect(await pending).toMatchObject({ code: 'COPILOT_MODEL_SOURCE_INVALIDATED' })
    gate.resolve()
    await gate.promise
    expect(source.readSnapshot()).toBeUndefined()
  })

  it.each(['auth', 'fetch', 'body', 'check'] as const)('bounds timeout during %s even if the dependency ignores cancellation', async phase => {
    vi.useFakeTimers()
    const entered = deferred<void>()
    const never = deferred<never>()
    const cancel = vi.fn()
    const { source } = setup({ timeoutMs: 10,
      resolveAuth: async () => { if (phase === 'auth') { entered.resolve(); return never.promise } return auth },
      fetch: async () => {
        if (phase === 'fetch') { entered.resolve(); return never.promise }
        if (phase === 'body') return new Response(new ReadableStream({ pull() { entered.resolve(); return never.promise }, cancel }))
        return response()
      },
      assertAuthCurrent: async () => { if (phase === 'check') { entered.resolve(); await never.promise } },
    })
    const pending = source.load().catch(error => error)
    await entered.promise
    await vi.advanceTimersByTimeAsync(11)
    expect(await pending).toMatchObject({ code: 'COPILOT_MODEL_SOURCE_TIMEOUT' })
    expect(source.readSnapshot()).toBeUndefined()
    if (phase === 'body') expect(cancel).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['auth', 'fetch'] as const)('dispose cancels %s and future loads without late publication', async phase => {
    const entered = deferred<AbortSignal>()
    const gate = deferred<never>()
    const { source } = setup({
      resolveAuth: async signal => { if (phase === 'auth') { entered.resolve(signal); return gate.promise } return auth },
      fetch: async (_url, options) => { entered.resolve(options!.signal!); return gate.promise },
    })
    const pending = source.load().catch(error => error)
    const signal = await entered.promise
    source.dispose()
    source.dispose()
    expect(signal.aborted).toBe(true)
    expect(await pending).toMatchObject({ code: 'COPILOT_MODEL_SOURCE_DISPOSED' })
    await expect(source.load()).rejects.toMatchObject({ code: 'COPILOT_MODEL_SOURCE_DISPOSED' })
    expect(source.getView().state).toBe('disposed')
    expect(source.readSnapshot()).toBeUndefined()
  })

  it.each(['http://example.test', 'https://user:password@example.test', 'https://example.test/path', 'https://example.test/?secret=1', 'https://example.test/#secret', 'https://example.test/?', 'https://example.test/#', ' https://example.test', 'not a url'])('refuses invalid auth endpoint %s before fetch', async baseURL => {
    const { source, fetch } = setup({ resolveAuth: async () => ({ ...auth, baseURL }) })
    await expect(source.load()).rejects.toMatchObject({ code: 'COPILOT_MODEL_SOURCE_INVALID_AUTH' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('freezes captured auth leaves and static headers against external mutation', async () => {
    const raw = { ...auth }
    const custom = { 'Editor-Version': 'original-editor' }
    const entered = deferred<void>()
    const gate = deferred<void>()
    let checks = 0
    const fetch = vi.fn<typeof globalThis.fetch>(async () => response())
    const { source } = setup({ headers: custom, resolveAuth: async () => raw, fetch,
      assertAuthCurrent: async captured => {
        expect(Object.isFrozen(captured)).toBe(true)
        if (++checks === 1) { entered.resolve(); await gate.promise }
      },
    })
    const pending = source.load()
    await entered.promise
    raw.apiKey = 'MUTATED_PRIVATE_ACCESS'
    raw.baseURL = 'https://untrusted.invalid'
    custom['Editor-Version'] = 'mutated-editor'
    gate.resolve()
    await pending
    const [url, options] = fetch.mock.calls[0]!
    expect(url).toBe('https://api.individual.githubcopilot.com/models')
    expect(new Headers(options!.headers).get('Authorization')).toBe(`Bearer ${auth.apiKey}`)
    expect(new Headers(options!.headers).get('Editor-Version')).toBe('original-editor')
  })

  it('accepts an already-validated enterprise HTTPS root without choosing URLs from metadata', async () => {
    const { source } = setup({ resolveAuth: async () => ({ ...auth, baseURL: 'https://copilot-api.enterprise.example/' }), fetch: async (url) => {
      expect(url).toBe('https://copilot-api.enterprise.example/models')
      return new Response(JSON.stringify({ ...metadata(), baseURL: 'https://attacker.invalid' }))
    } })
    expect((await source.load()).models).toHaveLength(1)
  })

  it.each([401, 403, 429, 500])('does not retry HTTP %s or expose the response body', async status => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(auth.apiKey, { status }))
    const { source } = setup({ fetch })
    const error = await source.load().catch(value => value)
    expect(error).toMatchObject({ code: 'COPILOT_MODEL_SOURCE_HTTP_ERROR' })
    expect(String(error)).not.toContain(auth.apiKey)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it.each(['auth', 'fetch', 'body'])('sanitizes arbitrary %s exceptions', async phase => {
    const { source } = setup({
      resolveAuth: async () => { if (phase === 'auth') throw new Error(auth.apiKey); return auth },
      fetch: async () => {
        if (phase === 'fetch') throw new Error(auth.apiKey)
        return new Response(new ReadableStream({ pull(controller) { controller.error(new Error(auth.apiKey)) } }))
      },
    })
    const error = await source.load().catch(value => value)
    expect(error).toBeInstanceOf(AccountModelSourceError)
    expect(String(error)).not.toContain(auth.apiKey)
    expect(JSON.stringify(source.getView())).not.toContain(auth.apiKey)
  })

  it('rejects declared excessive content length without reading the body', async () => {
    const cancel = vi.fn()
    const { source } = setup({ fetch: async () => new Response(new ReadableStream({ cancel }), { headers: { 'Content-Length': String(2 * 1024 * 1024 + 1) } }) })
    await expect(source.load()).rejects.toMatchObject({ code: 'COPILOT_MODEL_SOURCE_RESPONSE_TOO_LARGE' })
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('enforces cumulative UTF-8 byte limits rather than trusting content length', async () => {
    const cancel = vi.fn()
    let chunk = 0
    const { source } = setup({ fetch: async () => new Response(new ReadableStream({
      pull(controller) { if (++chunk <= 3) controller.enqueue(new Uint8Array(1024 * 1024)) }, cancel,
    }), { headers: { 'Content-Length': '1' } }) })
    await expect(source.load()).rejects.toMatchObject({ code: 'COPILOT_MODEL_SOURCE_RESPONSE_TOO_LARGE' })
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('rejects malformed UTF-8 and clears the reader without preserving response contents', async () => {
    const { source } = setup({ fetch: async () => new Response(new Uint8Array([0xff, 0xfe, 0xff])) })
    await expect(source.load()).rejects.toMatchObject({ code: 'COPILOT_MODEL_SOURCE_INVALID_RESPONSE' })
    expect(source.readSnapshot()).toBeUndefined()
  })

  it('rejects an injected redirected response even though fetch was told not to redirect', async () => {
    const redirected = response()
    Object.defineProperty(redirected, 'redirected', { value: true })
    const { source } = setup({ fetch: async () => redirected })
    await expect(source.load()).rejects.toMatchObject({ code: 'COPILOT_MODEL_SOURCE_REDIRECTED_RESPONSE' })
  })

  it('applies the parser model count bound before publishing a snapshot', async () => {
    const item = metadata().data[0]
    const { source } = setup({ fetch: async () => new Response(JSON.stringify({ data: Array.from({ length: 513 }, (_, index) => ({ ...item, id: `new-${index}` })) })) })
    await expect(source.load()).rejects.toMatchObject({ code: 'COPILOT_MODEL_SOURCE_INVALID_CATALOG' })
  })

  it('uses proven account IDs only for absent policy, without overriding explicit denial', async () => {
    const allowed = { ...metadata().data[0], id: 'future-lab-r17' }
    Reflect.deleteProperty(allowed, 'policy')
    const denied = { ...metadata().data[0], id: 'denied-id', policy: { state: 'disabled' } }
    const { source } = setup({ resolveAuth: async () => ({ ...auth, availableModelIds: new Set(['future-lab-r17', 'denied-id']) }),
      fetch: async () => new Response(JSON.stringify({ data: [allowed, denied] })),
    })
    const snapshot = await source.load()
    expect(snapshot.models.map(model => model.id)).toEqual(['future-lab-r17'])
    expect(snapshot.models[0]!.evidence.policySource).toBe('account-available-id')
    expect(snapshot.rejected.map(item => item.id)).toEqual(['denied-id'])
  })

  it.each(['{"data":', 'null', '{"data":{}}'])('rejects malformed catalog text rather than publishing it: %s', async body => {
    const { source } = setup({ fetch: async () => new Response(body) })
    await expect(source.load()).rejects.toMatchObject({ code: 'COPILOT_MODEL_SOURCE_INVALID_CATALOG' })
    expect(source.readSnapshot()).toBeUndefined()
  })

  it('retains explicit model rejection diagnostics without storing unknown response fields or mutating grants', async () => {
    const originalIds = Object.freeze(['future-lab-r17'])
    const raw = metadata('new-server-model')
    const { source } = setup({ resolveAuth: async () => ({ ...auth, availableModelIds: originalIds }), fetch: async () => new Response(JSON.stringify({
      ...raw, secretExtra: auth.apiKey,
      data: [...raw.data, { ...raw.data[0], id: 'disabled-model', policy: { state: 'disabled' }, hidden: auth.apiKey }],
    })) })
    const snapshot = await source.load()
    expect(snapshot.models.map(model => model.id)).toEqual(['new-server-model'])
    expect(snapshot.rejected).toContainEqual({ id: 'disabled-model', code: 'POLICY_NOT_ENABLED' })
    expect(originalIds).toEqual(['future-lab-r17'])
    expect(JSON.stringify(snapshot)).not.toContain(auth.apiKey)
  })

  it.each(['Authorization', 'Host', 'Content-Length', 'Cookie', 'Proxy-Authorization'])('refuses sensitive header override %s', name => {
    expect(() => setup({ headers: { [name]: 'PRIVATE_VALUE' } })).toThrow('COPILOT_MODEL_SOURCE_INVALID_CONFIG')
  })

  it.each([{ timeoutMs: 0 }, { timeoutMs: Infinity }, { ttlMs: -1 }, { ttlMs: Number.NaN }, { failureCooldownMs: -1 }, { failureCooldownMs: Infinity }, { failureCooldownMs: 2_147_483_648 }])('rejects invalid timer configuration %j', config => {
    expect(() => setup(config)).toThrow('COPILOT_MODEL_SOURCE_INVALID_CONFIG')
  })
})
