import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AuthorizationService from '@deepseek-ai/dsh-authorization'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import { createModels } from '@earendil-works/pi-ai'
import { githubCopilotProvider } from '@earendil-works/pi-ai/providers/github-copilot'
import { CopilotAccountsHost } from '../../src/copilot-accounts-host.ts'
import { CopilotAccountsViewSchema } from '../../src/copilot-accounts-remote.ts'
import { createGitHubCopilotCredentialStore } from '../../src/copilot-auth.ts'
import { GITHUB_COPILOT_CREDENTIAL_KEY } from '../../src/copilot-identity.ts'
import { GitHubCopilotAuthorizationController } from '../../src/authorization-controller.ts'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const key = (id: string) => `github-copilot/account-${id}`
const grant = (id: string) => ({ kind: 'grant' as const, payload: {
  type: 'oauth', refresh: `synthetic-${id}`, access: `synthetic-access-${id}`, expires: Date.now() + 3_600_000,
} })
afterEach(() => vi.unstubAllGlobals())
function fixture(activeAccountId: unknown = undefined) {
  const ctx = new Context()
  const records = new Map([[GITHUB_COPILOT_CREDENTIAL_KEY, grant('canonical')], [key(A), grant(A)], [key(B), grant(B)]])
  let revision = 1
  const settings = {
    describe: () => [{ ns: 'github-copilot', revision, value: { activeAccountId } }],
    mutate: vi.fn(async (_ns: string, operations: readonly { value: string }[], expected: number) => {
      if (revision !== expected) throw new Error('conflict')
      activeAccountId = operations[0]!.value
      revision++
    }),
  }
  const credentials = {
    describeRecord: vi.fn(async (key: string) => ({ key, configured: records.has(key), writable: true, kind: records.get(key)?.kind })),
    listRecords: vi.fn(async () => [...records].map(([key, record]) => ({ key, kind: record.kind }))),
    readRecord: vi.fn(async (key: string) => records.get(key)),
    modifyRecord: vi.fn(async (key: string, mutate: (current: unknown) => Promise<unknown>) => {
      const next = await mutate(records.get(key))
      if (next !== undefined) records.set(key, next as ReturnType<typeof grant>)
      return records.get(key)
    }),
    deleteRecord: vi.fn(async (key: string) => { records.delete(key) }),
  }
  ctx.provide('credentials', credentials)
  ctx.provide('settings', settings)
  const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => Response.json({
    login: new Headers(init?.headers).get('Authorization')?.endsWith(A) ? 'alice' : 'bob',
    id: new Headers(init?.headers).get('Authorization')?.endsWith(A) ? 1 : 2,
    email: 'must-not-leak@example.invalid',
  }))
  const validateModels = vi.fn(async (): Promise<void> => undefined)
  const host = new CopilotAccountsHost(ctx, { fetch, validateModels, routeDiagnostic: () => undefined })
  return { ctx, host, records, credentials, settings, fetch, validateModels,
    externalSelect(id: unknown) { activeAccountId = id; revision++; host.selectionChanged() } }
}

describe('independent Copilot account ownership', () => {
  it('lists membership from metadata only and defaults an absent selector to canonical', async () => {
    const f = fixture()
    expect(await f.host.get()).toMatchObject({ state: 'ready', activeAccountId: 'canonical', revision: 1 })
    expect(f.credentials.readRecord).not.toHaveBeenCalled()
    expect(f.fetch).not.toHaveBeenCalled()
  })
  it('rejects invalid and missing selectors without canonical fallback', async () => {
    const f = fixture('bad')
    expect(await f.host.get()).toMatchObject({ state: 'error', diagnostic: 'COPILOT_ACCOUNTS_SELECTOR_INVALID' })
    expect(() => f.host.capture()).toThrow('COPILOT_ACCOUNTS_SELECTOR_INVALID')
    const g = fixture(A)
    g.records.delete(key(A))
    expect(await g.host.get()).toMatchObject({ state: 'error', diagnostic: 'COPILOT_ACCOUNTS_SELECTED_MISSING' })
  })
  it('never writes a captured A refresh into B after an external selection change', async () => {
    const f = fixture(A)
    const binding = f.host.capture()
    const store = createGitHubCopilotCredentialStore(f.ctx, 'github-copilot', binding)
    await expect(store.modify('github-copilot', async current => {
      f.externalSelect(B)
      return current
    })).rejects.toThrow('COPILOT_ACCOUNTS_CHANGED')
    expect(f.records.get(key(B))?.payload.refresh).toBe(`synthetic-${B}`)
    expect(f.credentials.modifyRecord).toHaveBeenCalledWith(key(A), expect.any(Function))
  })
  it('blocks switching during preparation and preserves the selector', async () => {
    const f = fixture(A)
    const lease = f.host.acquire()
    expect(await f.host.switchAccount(B, 1)).toMatchObject({ state: 'error', diagnostic: 'COPILOT_ACCOUNTS_BUSY' })
    expect(f.settings.mutate).not.toHaveBeenCalled()
    lease.release()
    expect(await f.host.switchAccount(B, 1)).toMatchObject({ state: 'ready', activeAccountId: B })
    expect(f.settings.mutate).toHaveBeenCalledWith('github-copilot',
      [{ op: 'set', path: ['activeAccountId'], value: B }], 1)
  })
  it('keeps failed preparation and stale CAS from changing the active account', async () => {
    const f = fixture(A)
    f.validateModels.mockRejectedValueOnce(new Error('private provider details'))
    expect(await f.host.switchAccount(B, 1)).toMatchObject({ diagnostic: 'COPILOT_ACCOUNTS_MODELS_FAILED', activeAccountId: A })
    expect(f.settings.mutate).not.toHaveBeenCalled()
    expect(await f.host.switchAccount(B, 0)).toMatchObject({ diagnostic: 'COPILOT_ACCOUNTS_CONFLICT' })
  })
  it('blocks admission and switching until active sign-out settles', async () => {
    const f = fixture(A)
    let finish!: () => void
    f.credentials.deleteRecord.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
    const signingOut = f.host.signOutActive()
    await vi.waitFor(() => expect(finish).toBeDefined())
    expect(() => f.host.acquire()).toThrow('COPILOT_ACCOUNTS_BUSY')
    expect(await f.host.switchAccount(B, 1)).toMatchObject({ diagnostic: 'COPILOT_ACCOUNTS_BUSY' })
    finish()
    await signingOut
    expect(f.credentials.deleteRecord).toHaveBeenCalledWith(key(A))
    expect(f.records.has(GITHUB_COPILOT_CREDENTIAL_KEY)).toBe(true)
    const lease = f.host.acquire()
    lease.release()
  })
  it('keeps selected-missing requests fail-closed while exposing explicit recovery', async () => {
    const f = fixture(A)
    await f.host.signOutActive()
    const view = await f.host.get()
    expect(view).toMatchObject({ state: 'error', activeAccountId: A, switchable: true,
      diagnostic: 'COPILOT_ACCOUNTS_SELECTED_MISSING' })
    expect(CopilotAccountsViewSchema.safeParse(view).success).toBe(true)
    await expect(createGitHubCopilotCredentialStore(f.ctx, 'github-copilot', f.host.capture())
      .read('github-copilot')).resolves.toBeUndefined()
    expect(await f.host.switchAccount(B, 1)).toMatchObject({ state: 'ready', activeAccountId: B })
  })
  it('rejects target identity replacement between identity and model preflight', async () => {
    const f = fixture(A)
    f.validateModels.mockImplementationOnce(async () => { f.records.set(key(B), grant('another-account')) })
    expect(await f.host.switchAccount(B, 1)).toMatchObject({ diagnostic: 'COPILOT_ACCOUNTS_CHANGED', activeAccountId: A })
    expect(f.settings.mutate).not.toHaveBeenCalled()
  })
  it('fails closed on unavailable public route and Session evidence', async () => {
    const f = fixture(A)
    const host = new CopilotAccountsHost(f.ctx)
    expect(await host.switchAccount(B, 1)).toMatchObject({ diagnostic: 'COPILOT_ACCOUNTS_EVIDENCE_INCOMPLETE' })
    expect(f.settings.mutate).not.toHaveBeenCalled()
  })
  it('normalizes identity and rejects late responses from another account', async () => {
    const f = fixture(A)
    const view = await f.host.refreshIdentity()
    expect(view.accounts.find(row => row.id === A)).toMatchObject({ identity: { login: 'alice', userId: 1 }, identityState: 'ready' })
    expect(JSON.stringify(view)).not.toContain('must-not-leak')
    expect(f.fetch.mock.calls[0]?.[1]).toMatchObject({ redirect: 'error', cache: 'no-store' })
    f.fetch.mockImplementationOnce(async () => { f.externalSelect(B); return Response.json({ login: 'alice', id: 1 }) })
    expect(await f.host.refreshIdentity()).toMatchObject({ diagnostic: 'COPILOT_ACCOUNTS_CHANGED' })
  })
  it('holds the admission fence throughout target preparation, including competing remove calls', async () => {
    const f = fixture(A)
    let finish!: () => void
    f.validateModels.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const switching = f.host.switchAccount(B, 1)
    await vi.waitFor(() => expect(finish).toBeDefined())
    expect(() => f.host.acquire()).toThrow('COPILOT_ACCOUNTS_BUSY')
    expect(await f.host.remove(B, 1)).toMatchObject({ diagnostic: 'COPILOT_ACCOUNTS_BUSY' })
    expect(() => f.host.acquire()).toThrow('COPILOT_ACCOUNTS_BUSY')
    finish()
    expect(await switching).toMatchObject({ activeAccountId: B, state: 'ready' })
  })
  it('reports committed-but-unreadable selector state as uncertain and never rolls back', async () => {
    const f = fixture(A)
    f.settings.mutate.mockImplementationOnce(async () => { f.externalSelect(B); throw new Error('readback failed') })
    expect(await f.host.switchAccount(B, 1)).toMatchObject({ diagnostic: 'COPILOT_ACCOUNTS_COMMIT_UNCERTAIN' })
    expect(f.settings.mutate).toHaveBeenCalledTimes(1)
  })
  it('preserves uncertain commit ahead of missing-slot recovery', async () => {
    const f = fixture(A)
    f.settings.mutate.mockImplementationOnce(async () => {
      f.externalSelect(B)
      f.records.delete(key(B))
    })
    expect(await f.host.switchAccount(B, 1)).toMatchObject({
      diagnostic: 'COPILOT_ACCOUNTS_COMMIT_UNCERTAIN', activeAccountId: B, switchable: false,
    })
    expect(await f.host.get()).toMatchObject({ diagnostic: 'COPILOT_ACCOUNTS_COMMIT_UNCERTAIN', switchable: false })
  })
  it('rejects canonical controller authorization while switch preparation owns admission', async () => {
    const f = fixture()
    f.records.delete(GITHUB_COPILOT_CREDENTIAL_KEY)
    f.ctx.provide('githubCopilotAccounts', { host: f.host, get: () => f.host.get() })
    const native = new AuthorizationService(f.ctx)
    native.registerFlow({ key: credentialKey('llm-pi-ai', 'github-copilot'), label: 'Synthetic',
      methods: [{ id: 'oauth', label: 'Synthetic' }], run: async () => { throw new Error('Must not start') } })
    const begin = vi.spyOn(native, 'begin')
    let finish!: () => void
    f.validateModels.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const switching = f.host.switchAccount(B, 1)
    await vi.waitFor(() => expect(finish).toBeDefined())
    const controller = new GitHubCopilotAuthorizationController(f.ctx)
    await expect(controller.start()).rejects.toThrow('COPILOT_ACCOUNTS_BUSY')
    expect(begin).not.toHaveBeenCalled()
    finish()
    expect(await switching).toMatchObject({ activeAccountId: B, state: 'ready' })
    f.host.dispose()
  })
  it('rechecks externally started canonical authorization before selector CAS', async () => {
    const f = fixture()
    const native = new AuthorizationService(f.ctx)
    native.registerFlow({ key: credentialKey('llm-pi-ai', 'github-copilot'), label: 'Synthetic',
      methods: [{ id: 'oauth', label: 'Synthetic' }],
      run: session => new Promise((_resolve, reject) => session.signal.addEventListener('abort', () => reject(session.signal.reason))) })
    let finish!: () => void
    f.validateModels.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const switching = f.host.switchAccount(B, 1)
    await vi.waitFor(() => expect(finish).toBeDefined())
    const authorizing = native.begin({ key: credentialKey('llm-pi-ai', 'github-copilot'), method: 'oauth',
      interaction: { notify() {}, prompt: async () => '' } }).catch(() => undefined)
    finish()
    expect(await switching).toMatchObject({ diagnostic: 'COPILOT_ACCOUNTS_BUSY', activeAccountId: 'canonical' })
    expect(f.settings.mutate).not.toHaveBeenCalled()
    native.cancel(credentialKey('llm-pi-ai', 'github-copilot'))
    await authorizing
    f.host.dispose()
  })
  it('retains canonical admission through polling and cancellation settlement', async () => {
    const f = fixture()
    f.records.delete(GITHUB_COPILOT_CREDENTIAL_KEY)
    f.ctx.provide('githubCopilotAccounts', { host: f.host, get: () => f.host.get() })
    const native = new AuthorizationService(f.ctx)
    let settle!: () => void
    native.registerFlow({ key: credentialKey('llm-pi-ai', 'github-copilot'), label: 'Synthetic',
      methods: [{ id: 'oauth', label: 'Synthetic' }],
      run: () => new Promise<void>(resolve => { settle = resolve }) })
    const controller = new GitHubCopilotAuthorizationController(f.ctx)
    expect(await controller.start()).toMatchObject({ phase: 'authorizing' })
    await vi.waitFor(() => expect(settle).toBeDefined())
    expect(await controller.status()).toMatchObject({ inFlight: true })
    expect(await f.host.switchAccount(B, 1)).toMatchObject({ diagnostic: 'COPILOT_ACCOUNTS_BUSY' })
    await controller.cancel()
    expect(() => f.host.acquire()).toThrow('COPILOT_ACCOUNTS_BUSY')
    settle()
    await vi.waitFor(async () => expect((await f.host.get()).operation).toBeUndefined())
    const lease = f.host.acquire()
    lease.release()
    f.host.dispose()
  })
  it('rejects extra credential fields and unsafe URLs at the separate Remote boundary', async () => {
    const f = fixture()
    const view = await f.host.get()
    expect(CopilotAccountsViewSchema.safeParse(view).success).toBe(true)
    expect(CopilotAccountsViewSchema.safeParse({ ...view, access: 'not-allowed' }).success).toBe(false)
    expect(CopilotAccountsViewSchema.safeParse({ ...view, notices: [{ message: 'Open', url: 'https://example.invalid' }] }).success).toBe(false)
  })
  it('supports independent native lazy refresh with stable record binding and preserves failed refreshes', async () => {
    const f = fixture(A)
    f.records.set(key(A), { ...grant(A), payload: { ...grant(A).payload, expires: 0 } })
    const beforeB = f.records.get(key(B))
    const fetch = vi.fn(async (input: unknown) => {
      if (String(input).endsWith('/copilot_internal/v2/token')) {
        return Response.json({ token: 'new-synthetic-token', expires_at: Math.floor(Date.now() / 1000) + 7200 })
      }
      if (String(input).endsWith('/models')) return Response.json({ data: [] })
      throw new Error('Unexpected test URL')
    })
    vi.stubGlobal('fetch', fetch)
    const models = createModels({ credentials: createGitHubCopilotCredentialStore(f.ctx, 'github-copilot', f.host.capture()) })
    const provider = githubCopilotProvider()
    models.setProvider({ ...provider, auth: { oauth: provider.auth.oauth! } })
    expect((await models.getAuth('github-copilot'))?.auth.apiKey).toBe('new-synthetic-token')
    expect(f.records.get(key(B))).toBe(beforeB)
    const count = fetch.mock.calls.length
    await models.getAuth('github-copilot')
    expect(fetch).toHaveBeenCalledTimes(count)
    const expired = { ...grant(A), payload: { ...grant(A).payload, expires: 0 } }
    f.records.set(key(A), expired)
    fetch.mockRejectedValueOnce(new Error('synthetic renewal refusal'))
    await expect(models.getAuth('github-copilot')).rejects.toThrow()
    expect(f.records.get(key(A))).toBe(expired)
    expect(f.records.get(key(B))).toBe(beforeB)
  })
  it('registers public native OAuth and writes directly to a new independent record', async () => {
    const f = fixture()
    f.records.delete(key(A)); f.records.delete(key(B))
    f.fetch.mockImplementation(async (_url, init) => Response.json({
      login: new Headers(init?.headers).get('Authorization') === 'token synthetic-new-github' ? 'new-user' : 'canonical-user',
      id: new Headers(init?.headers).get('Authorization') === 'token synthetic-new-github' ? 3 : 1,
    }))
    const native = new AuthorizationService(f.ctx)
    const begin = vi.spyOn(native, 'begin')
    vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
      const url = String(input)
      if (url.endsWith('/login/device/code')) return Response.json({ device_code: 'synthetic-device', user_code: 'TEST-CODE',
        verification_uri: 'https://github.com/login/device', interval: 0.001, expires_in: 60 })
      if (url.endsWith('/login/oauth/access_token')) return Response.json({ access_token: 'synthetic-new-github' })
      if (url.endsWith('/copilot_internal/v2/token')) return Response.json({ token: 'synthetic-new-copilot', expires_at: Math.floor(Date.now() / 1000) + 7200 })
      if (url.endsWith('/models')) return Response.json({ data: [] })
      throw new Error('Unexpected test URL')
    }))
    const original = f.records.get(GITHUB_COPILOT_CREDENTIAL_KEY)
    f.credentials.modifyRecord.mockImplementation(async (key, mutate) => {
      const next = await mutate(f.records.get(key))
      if (next !== undefined) {
        f.records.set(key, next as ReturnType<typeof grant>)
        f.ctx.emit('credentials/record-updated', credentialKey('github-copilot', key.slice('github-copilot/'.length)))
      }
      return f.records.get(key)
    })
    const adding = await f.host.add()
    expect(adding.operation).toBe('authorizing')
    await vi.waitFor(async () => expect((await f.host.get()).operation).toBeUndefined(), { timeout: 15_000 })
    await expect(begin.mock.results[0]!.value).resolves.toEqual({ status: 'authorized' })
    expect(await f.host.get()).toMatchObject({ state: 'ready', activeAccountId: 'canonical' })
    expect(f.records.get(GITHUB_COPILOT_CREDENTIAL_KEY)).toBe(original)
    const added = [...f.records.keys()].find(value => value !== GITHUB_COPILOT_CREDENTIAL_KEY)!
    expect(added).toMatch(/^github-copilot\/account-[0-9a-f-]{36}$/)
    expect(f.records.get(added)?.payload.refresh).toBe('synthetic-new-github')
    expect(native.describe(credentialKey('github-copilot', added.slice('github-copilot/'.length)))).toBeUndefined()
    const beforeRenewal = f.records.get(added)
    const transport = globalThis.fetch
    vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: RequestInit) =>
      String(input).endsWith('/login/oauth/access_token') ? Response.json({ access_token: 'synthetic-replacement-github' })
        : transport(input as RequestInfo, init)))
    f.fetch.mockImplementation(async (_url, init) => {
      const token = new Headers(init?.headers).get('Authorization')
      return Response.json({ login: token === 'token synthetic-replacement-github' ? 'unexpected-user' : 'known-user',
        id: token === 'token synthetic-replacement-github' ? 4 : token === 'token synthetic-new-github' ? 3 : 1 })
    })
    const savedId = added.slice('github-copilot/account-'.length)
    expect(await f.host.reauthorize(savedId, 0)).toMatchObject({ diagnostic: 'COPILOT_ACCOUNTS_CONFLICT' })
    expect(begin).toHaveBeenCalledTimes(1)
    await f.host.reauthorize(savedId, 1)
    await vi.waitFor(async () => expect((await f.host.get()).operation).toBeUndefined(), { timeout: 15_000 })
    expect(await f.host.get()).toMatchObject({ diagnostic: 'COPILOT_ACCOUNTS_IDENTITY_CHANGED' })
    expect(f.records.get(added)).toBe(beforeRenewal)
    expect(f.records.get(GITHUB_COPILOT_CREDENTIAL_KEY)).toBe(original)
    vi.stubGlobal('fetch', transport)
    await f.host.reauthorize(savedId, 1)
    await vi.waitFor(async () => expect((await f.host.get()).operation).toBeUndefined(), { timeout: 15_000 })
    expect(await f.host.get()).toMatchObject({ state: 'ready' })
    expect(f.records.get(added)?.payload.refresh).toBe('synthetic-new-github')
    expect(f.records.get(GITHUB_COPILOT_CREDENTIAL_KEY)).toBe(original)
    const beforeConflict = f.records.get(added)
    let savedIdentityReads = 0
    f.fetch.mockImplementation(async (_url, init) => {
      const saved = new Headers(init?.headers).get('Authorization') === 'token synthetic-new-github'
      if (saved && ++savedIdentityReads === 2) f.externalSelect('canonical')
      return Response.json({ login: saved ? 'known-user' : 'canonical-user', id: saved ? 3 : 1 })
    })
    await f.host.reauthorize(savedId, 1)
    await vi.waitFor(async () => expect((await f.host.get()).operation).toBeUndefined(), { timeout: 15_000 })
    expect(await f.host.get()).toMatchObject({ diagnostic: 'COPILOT_ACCOUNTS_CONFLICT' })
    expect(f.records.get(added)).toBe(beforeConflict)
    expect(await f.host.reauthorize(A, 2)).toMatchObject({ diagnostic: 'COPILOT_ACCOUNTS_SELECTED_MISSING' })
    expect(await f.host.reauthorize('canonical', 2)).toMatchObject({ diagnostic: 'COPILOT_ACCOUNTS_AUTH_UNAVAILABLE' })
    f.host.dispose()
  })
})
