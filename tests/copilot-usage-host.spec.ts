import { Context } from '@deepseek-ai/cordis'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { afterEach, describe, expect, it, vi } from 'vitest'
import GitHubCopilotUsageController, { CopilotUsageSource, COPILOT_USAGE_ENDPOINT } from '../src/copilot-usage-host.ts'

const grant = { type: 'oauth', refresh: 'synthetic-github-token', access: 'synthetic-copilot-token', expires: 1 }
const quota = { token_based_billing: true, quota_snapshots: { premium_interactions: {
  unlimited: false, entitlement: '100', percent_remaining: 75, quota_remaining: 75,
} } }
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
function fixture() {
  let stored: unknown = { ...grant }, now = 1_800_000_000_000
  const readCredential = vi.fn(async () => stored)
  const fetcher = vi.fn<typeof fetch>(async () => Response.json(quota))
  const source = new CopilotUsageSource({ readCredential, fetch: fetcher, now: () => now })
  return { source, fetcher, readCredential, setGrant: (value: unknown) => { stored = value },
    advance: (ms: number) => { now += ms } }
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('Copilot usage Host lifecycle', () => {
  it('is lazy and uses only the existing GitHub grant at the fixed endpoint without refreshing OAuth', async () => {
    const f = fixture()
    expect(f.readCredential).not.toHaveBeenCalled()
    expect(f.fetcher).not.toHaveBeenCalled()
    expect(await f.source.get()).toMatchObject({ state: 'ready', used: 25 })
    expect(f.fetcher).toHaveBeenCalledWith(COPILOT_USAGE_ENDPOINT, expect.objectContaining({
      redirect: 'error', headers: expect.objectContaining({ Authorization: `token ${grant.refresh}` }),
    }))
    expect(JSON.stringify(await f.source.get())).not.toContain('synthetic')
  })
  it('bounds get TTL, single-flights requests and throttles explicit refresh', async () => {
    const f = fixture(), pending = deferred<Response>()
    f.fetcher.mockReturnValueOnce(pending.promise)
    const first = f.source.get(), second = f.source.refresh()
    await vi.waitFor(() => expect(f.fetcher).toHaveBeenCalledTimes(1))
    pending.resolve(Response.json(quota))
    expect(await first).toEqual(await second)
    await f.source.refresh(); expect(f.fetcher).toHaveBeenCalledTimes(1)
    f.advance(10_001); await f.source.refresh(); expect(f.fetcher).toHaveBeenCalledTimes(2)
    f.advance(59_999); await f.source.get(); expect(f.fetcher).toHaveBeenCalledTimes(2)
    f.advance(2); await f.source.get(); expect(f.fetcher).toHaveBeenCalledTimes(3)
  })
  it('retains only clearly stale same-account amounts on network failure with cooldown', async () => {
    const f = fixture()
    const before = await f.source.get()
    f.advance(60_001)
    f.fetcher.mockRejectedValue(new Error('private server body synthetic-github-token'))
    expect(await f.source.get()).toEqual({ ...before, state: 'stale', diagnostic: 'COPILOT_USAGE_NETWORK' })
    await f.source.refresh(); expect(f.fetcher).toHaveBeenCalledTimes(2)
    f.advance(30_001); await f.source.refresh(); expect(f.fetcher).toHaveBeenCalledTimes(3)
  })
  it.each([401, 403])('revokes old values on HTTP %i', async status => {
    const f = fixture(); await f.source.get(); f.advance(10_001)
    f.fetcher.mockResolvedValue(new Response('private server body', { status }))
    expect(await f.source.refresh()).toEqual({ state: 'unavailable', billing: 'unknown', budget: 'unknown',
      diagnostic: 'COPILOT_USAGE_AUTH_REJECTED' })
    expect(await f.source.get()).not.toHaveProperty('used')
    expect(f.fetcher).toHaveBeenCalledTimes(2)
  })
  it('rechecks the canonical grant even on cache hits and never returns another account snapshot', async () => {
    const f = fixture(); await f.source.get()
    f.setGrant(undefined)
    expect(await f.source.get()).toMatchObject({ state: 'signed-out' })
    f.setGrant({ ...grant, refresh: 'synthetic-other-account' })
    expect(await f.source.get()).toMatchObject({ state: 'ready' })
    expect(f.fetcher).toHaveBeenCalledTimes(2)
  })
  it.each([null, {}, { type: 'api_key', key: 'synthetic' }, { ...grant, expires: NaN }])('fails invalid grants without a request: %j', async value => {
    const f = fixture(); f.setGrant(value)
    expect(await f.source.get()).toMatchObject({ state: 'unavailable', diagnostic: 'COPILOT_USAGE_INVALID_GRANT' })
    expect(f.fetcher).not.toHaveBeenCalled()
  })
  it('does not guess custom enterprise hosts', async () => {
    const f = fixture(); f.setGrant({ ...grant, enterpriseUrl: 'https://enterprise.example' })
    expect(await f.source.get()).toMatchObject({ diagnostic: 'COPILOT_USAGE_ENTERPRISE_UNSUPPORTED' })
    expect(f.fetcher).not.toHaveBeenCalled()
  })
  it('rejects an account change during the request without publishing old quota', async () => {
    const f = fixture(), pending = deferred<Response>()
    f.fetcher.mockReturnValueOnce(pending.promise)
    const request = f.source.get()
    await vi.waitFor(() => expect(f.fetcher).toHaveBeenCalledOnce())
    f.setGrant({ ...grant, refresh: 'synthetic-new-account' })
    pending.resolve(Response.json(quota))
    expect(await request).toMatchObject({ state: 'unavailable', diagnostic: 'COPILOT_USAGE_ACCOUNT_CHANGED' })
    expect(await f.source.get()).toMatchObject({ state: 'ready' })
    expect(f.fetcher).toHaveBeenCalledTimes(2)
  })
  it('rejects invalidation during the initial read and after a request even with unchanged account identity', async () => {
    const f = fixture(), read = deferred<unknown>()
    f.readCredential.mockReturnValueOnce(read.promise)
    const initial = f.source.get()
    f.source.invalidate()
    read.resolve(grant)
    expect(await initial).toMatchObject({ diagnostic: 'COPILOT_USAGE_ACCOUNT_CHANGED' })
    expect(f.fetcher).not.toHaveBeenCalled()
    const pending = deferred<Response>(); f.fetcher.mockReturnValueOnce(pending.promise)
    const request = f.source.get()
    await vi.waitFor(() => expect(f.fetcher).toHaveBeenCalledOnce())
    f.source.invalidate()
    pending.resolve(Response.json(quota))
    expect(await request).toMatchObject({ diagnostic: 'COPILOT_USAGE_ACCOUNT_CHANGED' })
  })
  it('checks account identity immediately before sending and after failed requests', async () => {
    const f = fixture()
    f.readCredential.mockResolvedValueOnce(grant).mockResolvedValueOnce({ ...grant, refresh: 'changed-before-send' })
    expect(await f.source.get()).toMatchObject({ diagnostic: 'COPILOT_USAGE_ACCOUNT_CHANGED' })
    expect(f.fetcher).not.toHaveBeenCalled()
    const pending = deferred<Response>(); f.fetcher.mockReturnValueOnce(pending.promise)
    const request = f.source.get()
    await vi.waitFor(() => expect(f.fetcher).toHaveBeenCalledOnce())
    f.setGrant(undefined); pending.resolve(new Response('', { status: 500 }))
    expect(await request).toMatchObject({ state: 'signed-out' })
  })
  it('redacts read failures, rejects redirects, and bounds the streamed response', async () => {
    const f = fixture()
    f.readCredential.mockRejectedValueOnce(new Error('private store detail'))
    expect(await f.source.get()).toMatchObject({ diagnostic: 'COPILOT_USAGE_CREDENTIALS_UNAVAILABLE' })
    f.fetcher.mockResolvedValueOnce(new Response('', { status: 302, headers: { Location: 'https://untrusted.invalid' } }))
    expect(await f.source.get()).toMatchObject({ diagnostic: 'COPILOT_USAGE_REDIRECT' })
    f.advance(30_001)
    f.fetcher.mockResolvedValueOnce(new Response('x'.repeat(262_145)))
    expect(await f.source.refresh()).toMatchObject({ diagnostic: 'COPILOT_USAGE_BODY_TOO_LARGE' })
    expect(f.fetcher).toHaveBeenCalledTimes(2)
  })
  it('does not turn malformed responses into successful or cached quota', async () => {
    const f = fixture(); await f.source.get(); f.advance(60_001)
    f.fetcher.mockResolvedValue(new Response('{"user":"private","quota_snapshots":{"secret":"synthetic"}}'))
    const result = await f.source.get()
    expect(result.state).toBe('unavailable')
    expect(result).not.toHaveProperty('used')
    expect(JSON.stringify(result)).not.toMatch(/private|synthetic/u)
    f.advance(30_001); f.fetcher.mockResolvedValue(new Response('malformed json'))
    expect(await f.source.refresh()).toMatchObject({ diagnostic: 'COPILOT_USAGE_INVALID_RESPONSE' })
  })
  it('keeps returned values independent of the internal cache and accepts access-token rotation', async () => {
    const f = fixture()
    const result = await f.source.get()
    Object.assign(result, { used: 999 })
    f.setGrant({ ...grant, access: 'rotated-api-token', expires: 99 })
    expect(await f.source.get()).toMatchObject({ used: 25 })
    expect(f.fetcher).toHaveBeenCalledOnce()
  })
  it('does not let an obsolete request erase or publish over a newer generation', async () => {
    const f = fixture(), oldResponse = deferred<Response>()
    f.fetcher.mockReturnValueOnce(oldResponse.promise)
    const old = f.source.get()
    await vi.waitFor(() => expect(f.fetcher).toHaveBeenCalledOnce())
    f.source.invalidate(); f.setGrant({ ...grant, refresh: 'new-account' })
    expect(await f.source.get()).toMatchObject({ state: 'ready', used: 25 })
    oldResponse.resolve(Response.json({ ...quota, token_based_billing: false }))
    expect(await old).toMatchObject({ diagnostic: 'COPILOT_USAGE_ACCOUNT_CHANGED' })
    expect(await f.source.get()).toMatchObject({ state: 'ready', billing: 'credits' })
    expect(f.fetcher).toHaveBeenCalledTimes(2)
  })
  it('rejects overlarge declared lengths before consuming the response', async () => {
    const f = fixture(), cancel = vi.fn()
    const body = new ReadableStream({ cancel })
    f.fetcher.mockResolvedValueOnce(new Response(body, { headers: { 'content-length': '9999999999' } }))
    expect(await f.source.get()).toMatchObject({ diagnostic: 'COPILOT_USAGE_BODY_TOO_LARGE' })
    expect(cancel).toHaveBeenCalledOnce()
  })
  it('cancels a stalled body when the request deadline expires', async () => {
    vi.useFakeTimers()
    const f = fixture(), cancel = vi.fn()
    f.fetcher.mockResolvedValueOnce(new Response(new ReadableStream({ cancel })))
    const request = f.source.get()
    await vi.advanceTimersByTimeAsync(10_001)
    expect(await request).toMatchObject({ diagnostic: 'COPILOT_USAGE_TIMEOUT' })
    expect(cancel).toHaveBeenCalledOnce()
  })
  it('bounds stalled requests and disposal without needing a cooperative fetch implementation', async () => {
    vi.useFakeTimers()
    const f = fixture()
    f.fetcher.mockReturnValue(new Promise(() => {}))
    const request = f.source.get()
    await vi.advanceTimersByTimeAsync(10_001)
    expect(await request).toMatchObject({ diagnostic: 'COPILOT_USAGE_TIMEOUT' })
    f.advance(30_001)
    const next = f.source.refresh()
    await vi.advanceTimersByTimeAsync(1)
    f.source.dispose()
    expect(await next).toMatchObject({ diagnostic: 'COPILOT_USAGE_DISPOSED' })
    expect(await f.source.get()).toMatchObject({ diagnostic: 'COPILOT_USAGE_DISPOSED' })
  })
  it('mounts the actual Host service without startup fetch and invalidates on relevant public events', async () => {
    const ctx = new Context()
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(quota))
    ctx.provide('credentials', {
      readRecord: async () => ({ kind: 'grant', payload: grant }), listRecords: async () => [],
      modifyRecord: vi.fn(), deleteRecord: vi.fn(),
    })
    const controller = new GitHubCopilotUsageController(ctx)
    try {
      expect(fetcher).not.toHaveBeenCalled()
      expect(await controller.get()).toMatchObject({ state: 'ready' })
      ctx.emit('credentials/record-updated', credentialKey('other', 'record')); await controller.get()
      ctx.emit('settings/updated', 'unrelated' as SettingsNamespace, {}, {}, 'update'); await controller.get()
      expect(fetcher).toHaveBeenCalledTimes(1)
      ctx.emit('credentials/record-updated', credentialKey('llm-pi-ai', 'github-copilot')); await controller.get()
      expect(fetcher).toHaveBeenCalledTimes(2)
      ctx.emit('settings/updated', 'github-copilot' as SettingsNamespace, {}, {}, 'update')
      await controller.get(); expect(fetcher).toHaveBeenCalledTimes(3)
    } finally { await ctx.fiber.dispose() }
    expect(await controller.get()).toMatchObject({ diagnostic: 'COPILOT_USAGE_DISPOSED' })
  })
})
