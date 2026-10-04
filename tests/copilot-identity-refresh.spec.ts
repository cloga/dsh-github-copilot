import { Context } from '@deepseek-ai/cordis'
import { expect, it, vi } from 'vitest'
import { CopilotAccountsHost } from '../src/copilot-accounts-host.ts'

const A = '11111111-1111-4111-8111-111111111111'
function fixture(accountId = 'canonical') {
  const ctx = new Context()
  let selected = 'canonical'
  const key = accountId === 'canonical' ? 'llm-pi-ai/github-copilot' : `github-copilot/account-${accountId}`
  ctx.provide('settings', {
    describe: () => [{ ns: 'github-copilot', revision: 1, value: { activeAccountId: selected } }],
    mutate: vi.fn(),
  })
  ctx.provide('credentials', {
    listRecords: async () => [{ key, kind: 'grant' }],
    readRecord: async () => ({ kind: 'grant', payload: {
      type: 'oauth', refresh: 'synthetic-refresh', access: 'synthetic-access', expires: 9999999999999,
    } }),
    modifyRecord: vi.fn(), deleteRecord: vi.fn(),
  })
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ login: 'synthetic-user', id: 123 })))
  const host = new CopilotAccountsHost(ctx, { fetch: fetcher, routeDiagnostic: () => undefined })
  return { ctx, host, fetcher, key, change() { selected = A; host.selectionChanged() } }
}

it.each(['canonical', A])('renews expired identity once for account %s without changing metadata-only reads', async accountId => {
  const f = fixture(accountId)
  const clock = vi.spyOn(Date, 'now').mockReturnValue(1000000)
  try {
    await Promise.all([f.host.ensureIdentityFor(accountId), f.host.ensureIdentityFor(accountId)])
    expect(f.fetcher).toHaveBeenCalledOnce()
    await f.host.ensureIdentityFor(accountId)
    expect(f.fetcher).toHaveBeenCalledOnce()
    clock.mockReturnValue(1600000)
    const expired = await f.host.viewForAccount(accountId)
    expect(expired.accounts.find(row => row.id === accountId)?.identityState).toBe('unknown')
    expect(f.fetcher).toHaveBeenCalledOnce()
    const renewed = await f.host.ensureIdentityFor(accountId)
    expect(renewed.activeAccountId).toBe(accountId)
    expect(renewed.accounts.find(row => row.id === accountId)?.identityState).toBe('ready')
    expect(f.fetcher).toHaveBeenCalledTimes(2)
  } finally { clock.mockRestore(); f.host.dispose(); await f.ctx.fiber.dispose() }
})

it('cools down failures, permits explicit retry and renews after credential invalidation', async () => {
  const f = fixture()
  const clock = vi.spyOn(Date, 'now').mockReturnValue(1000000)
  f.fetcher.mockImplementationOnce(async () => new Response(null, { status: 429 }))
  try {
    expect(await f.host.ensureIdentity()).toMatchObject({ diagnostic: 'COPILOT_ACCOUNTS_IDENTITY_RATE_LIMITED' })
    await f.host.ensureIdentity()
    expect(f.fetcher).toHaveBeenCalledOnce()
    await f.host.refreshIdentity()
    expect(f.fetcher).toHaveBeenCalledTimes(2)
    f.host.credentialChanged(f.key)
    await f.host.ensureIdentity()
    expect(f.fetcher).toHaveBeenCalledTimes(3)
  } finally { clock.mockRestore(); f.host.dispose(); await f.ctx.fiber.dispose() }
})

it('rejects late identity after credential notification even when the token bytes are unchanged', async () => {
  const f = fixture()
  let complete!: (response: Response) => void
  f.fetcher.mockImplementationOnce(() => new Promise(resolve => { complete = resolve }))
  try {
    const pending = f.host.ensureIdentity()
    await vi.waitFor(() => expect(f.fetcher).toHaveBeenCalledOnce())
    f.host.credentialChanged(f.key)
    complete(new Response(JSON.stringify({ login: 'old-user', id: 123 })))
    expect(await pending).toMatchObject({ diagnostic: 'COPILOT_ACCOUNTS_CHANGED' })
    expect(f.host.cachedIdentity('canonical')).toBeUndefined()
    await f.host.ensureIdentity()
    expect(f.host.cachedIdentity('canonical')?.login).toBe('synthetic-user')
  } finally { f.host.dispose(); await f.ctx.fiber.dispose() }
})

it('expires failure cooldown exactly at thirty seconds and never extends it on metadata reads', async () => {
  const f = fixture()
  const clock = vi.spyOn(Date, 'now').mockReturnValue(1000000)
  f.fetcher.mockImplementation(async () => new Response(null, { status: 503 }))
  try {
    await f.host.ensureIdentity()
    clock.mockReturnValue(1029999)
    await f.host.ensureIdentity()
    await f.host.get()
    expect(f.fetcher).toHaveBeenCalledOnce()
    clock.mockReturnValue(1030000)
    expect(await f.host.ensureIdentity()).toMatchObject({ diagnostic: 'COPILOT_ACCOUNTS_IDENTITY_HTTP_ERROR' })
    expect(f.fetcher).toHaveBeenCalledTimes(2)
  } finally { clock.mockRestore(); f.host.dispose(); await f.ctx.fiber.dispose() }
})

it('joins forced refresh to active ensure and revokes it on a default selection change', async () => {
  const f = fixture()
  f.fetcher.mockImplementationOnce(() => new Promise(() => {}))
  try {
    const first = f.host.ensureIdentity()
    await vi.waitFor(() => expect(f.fetcher).toHaveBeenCalledOnce())
    const forced = f.host.refreshIdentity()
    f.change()
    expect(await first).toMatchObject({ diagnostic: 'COPILOT_ACCOUNTS_CHANGED' })
    expect(await forced).toMatchObject({ diagnostic: 'COPILOT_ACCOUNTS_CHANGED' })
    expect(f.fetcher).toHaveBeenCalledOnce()
    expect(f.host.cachedIdentity('canonical')).toBeUndefined()
  } finally { f.host.dispose(); await f.ctx.fiber.dispose() }
})

it('releases uncooperative pending requests on disposal without publishing identity', async () => {
  const f = fixture()
  f.fetcher.mockImplementationOnce(() => new Promise(() => {}))
  try {
    const pending = f.host.ensureIdentity()
    await vi.waitFor(() => expect(f.fetcher).toHaveBeenCalledOnce())
    f.host.dispose()
    expect(await pending).toMatchObject({ diagnostic: 'COPILOT_ACCOUNTS_CHANGED' })
    expect(f.host.cachedIdentity('canonical')).toBeUndefined()
  } finally { f.host.dispose(); await f.ctx.fiber.dispose() }
})

it.each([
  [{ cause: { code: 'CERT_HAS_EXPIRED' } }, 'COPILOT_ACCOUNTS_IDENTITY_TLS'],
  [{ cause: { code: 'ECONNRESET' } }, 'COPILOT_ACCOUNTS_IDENTITY_NETWORK'],
])('classifies structured transport failures without exposing provider text', async (error, code) => {
  const f = fixture()
  Object.defineProperty(error, 'message', { get() { throw new Error('Never read raw error text') } })
  f.fetcher.mockRejectedValueOnce(error)
  try {
    expect(await f.host.ensureIdentity()).toMatchObject({ diagnostic: code })
  } finally { f.host.dispose(); await f.ctx.fiber.dispose() }
})

it('bounds a stalled body by the total ten-second identity deadline', async () => {
  const f = fixture()
  const cancelled = vi.fn()
  f.fetcher.mockImplementationOnce(async () => new Response(new ReadableStream({
    cancel: cancelled,
  })))
  const started = performance.now()
  try {
    expect(await f.host.ensureIdentity()).toMatchObject({ diagnostic: 'COPILOT_ACCOUNTS_IDENTITY_TIMEOUT' })
    expect(performance.now() - started).toBeGreaterThanOrEqual(9000)
    expect(performance.now() - started).toBeLessThan(20000)
    expect(cancelled).toHaveBeenCalledOnce()
    expect(f.host.cachedIdentity('canonical')).toBeUndefined()
  } finally { f.host.dispose(); await f.ctx.fiber.dispose() }
}, 25000)

it('recognizes GitHub 403 rate-limit metadata without guessing from response text', async () => {
  const f = fixture()
  f.fetcher.mockImplementationOnce(async () => new Response(null, {
    status: 403, headers: { 'x-ratelimit-remaining': '0' },
  }))
  try {
    expect(await f.host.ensureIdentity()).toMatchObject({ diagnostic: 'COPILOT_ACCOUNTS_IDENTITY_RATE_LIMITED' })
  } finally { f.host.dispose(); await f.ctx.fiber.dispose() }
})
