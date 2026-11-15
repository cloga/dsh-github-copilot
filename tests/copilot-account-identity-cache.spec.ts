import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CopilotAccountsHost } from '../src/copilot-accounts-host.ts'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const nativeKey = 'llm-pi-ai/github-copilot'
function fixture() {
  const ctx = new Context()
  const grant = (id: string) => ({ kind: 'grant', payload: {
    type: 'oauth', refresh: `synthetic-${id}`, access: 'synthetic-access', expires: Date.now() + 3_600_000,
  } })
  const accountA = grant(A)
  const records = new Map<string, ReturnType<typeof grant>>([
    [nativeKey, structuredClone(accountA)],
    [`github-copilot/account-${A}`, accountA],
    [`github-copilot/account-${B}`, grant(B)],
  ])
  ctx.provide('settings', {
    describe: () => [{ ns: 'github-copilot', revision: 1, value: { activeAccountId: A } }],
    mutate: vi.fn(async () => { throw new Error('Identity reads must not mutate settings') }),
  })
  const read = vi.fn(async (key: string) => records.get(key))
  ctx.provide('credentials', {
    listRecords: async () => [...records].map(([key, value]) => ({ key, kind: value.kind })),
    readRecord: read,
    modifyRecord: async () => { throw new Error('Identity reads must not modify credentials') },
    deleteRecord: async () => { throw new Error('Identity reads must not delete credentials') },
  })
  const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const alice = new Headers(init?.headers).get('Authorization')?.endsWith(A)
    return Response.json({ login: alice ? 'alice' : 'bob', id: alice ? 1 : 2 })
  })
  const host = new CopilotAccountsHost(ctx, { fetch, routeDiagnostic: () => undefined })
  return { ctx, host, fetch, read, records }
}
afterEach(() => vi.restoreAllMocks())
describe('account identity display cache', () => {
  it('retains inactive verified names after freshness expiry without identity discovery in status', async () => {
    const f = fixture()
    expect((await f.host.ensureIdentityFor(A)).state).toBe('ready')
    expect((await f.host.ensureIdentityFor(B)).state).toBe('ready')
    f.fetch.mockClear(); f.read.mockClear()
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 600_001)
    const view = await f.host.get()
    expect(view.accounts.find(row => row.id === B)?.identity?.login).toBe('bob')
    expect(f.host.cachedIdentity(B)?.login).toBe('bob')
    expect(f.fetch).not.toHaveBeenCalled()
    expect(new Set(f.read.mock.calls.map(([key]) => key))).toEqual(new Set([
      nativeKey, `github-copilot/account-${A}`,
    ]))
    await f.host.ensureIdentityFor(B)
    expect(f.fetch).toHaveBeenCalledOnce()
    f.host.dispose()
  })
  it('hydrates saved inactive names without activating them, then reuses them', async () => {
    const f = fixture()
    const view = await f.host.ensureIdentity()
    expect(view.activeAccountId).toBe(A)
    expect(view.accounts.find(row => row.id === B)?.identity?.login).toBe('bob')
    expect(f.fetch).toHaveBeenCalledTimes(2)
    await f.host.ensureIdentity()
    expect(f.fetch).toHaveBeenCalledTimes(2)
    f.host.dispose()
  })
  it('invalidates cached names on credential changes and hides names for removed records', async () => {
    const f = fixture()
    await f.host.ensureIdentity()
    f.host.credentialChanged(`github-copilot/account-${B}`)
    expect(f.host.cachedIdentity(B)).toBeUndefined()
    expect((await f.host.get()).accounts.find(row => row.id === B)?.identity).toBeUndefined()
    f.records.delete(`github-copilot/account-${A}`)
    expect((await f.host.get()).accounts.find(row => row.id === A)).toBeUndefined()
    f.host.dispose()
  })
  it('keeps inactive lookup failures visible without rejecting the selected account or repeatedly fetching', async () => {
    const f = fixture()
    const warning = vi.spyOn(f.ctx.logger, 'warn')
    f.fetch.mockImplementation(async (_url, init) => new Headers(init?.headers).get('Authorization')?.endsWith(A)
      ? Response.json({ login: 'alice', id: 1 }) : new Response(null, { status: 429 }))
    const view = await f.host.ensureAccountNamesFor(A)
    expect(view.state).toBe('ready')
    expect(view.accounts.find(row => row.id === B)).toMatchObject({ identityState: 'unavailable' })
    expect(warning).toHaveBeenCalledWith('[github-copilot] %s', 'COPILOT_ACCOUNTS_IDENTITY_RATE_LIMITED')
    await f.host.ensureAccountNamesFor(A)
    expect(f.fetch).toHaveBeenCalledTimes(2)
    f.host.dispose()
  })
})
