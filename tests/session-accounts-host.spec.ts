import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { CopilotAccountsHost } from '../src/copilot-accounts-host.ts'
import { GITHUB_COPILOT_CREDENTIAL_KEY } from '../src/copilot-identity.ts'
import { captureNativeCopilot } from '../src/native-copilot-access.ts'
import { SessionAccountsHost } from '../src/session-accounts-host.ts'

vi.mock('../src/native-copilot-access.ts', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/native-copilot-access.ts')>(),
  captureNativeCopilot: vi.fn(),
}))

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
function fixture() {
  const ctx = new Context()
  const value: Record<string, unknown> = { activeAccountId: A, enabled: true, excludedModelIds: ['preserved'] }
  let revision = 1
  const records = new Set([A, B])
  const mutate = vi.fn(async (_ns: string, operations: readonly { path: string[]; value: unknown }[], expected: number) => {
    if (expected !== revision) throw new Error('conflict')
    expect(operations).toHaveLength(1)
    expect(operations[0]?.path).toEqual(['sessionAccounts'])
    value.sessionAccounts = operations[0]!.value
    revision++
  })
  const readRecord = vi.fn(async (_key: string): Promise<{
    kind: 'grant'; payload: { type: 'oauth'; refresh: string; access: string; expires: number }
  } | undefined> => { throw new Error('Preference operations must not read credentials') })
  ctx.provide('settings', { describe: () => [{ ns: 'github-copilot', revision, value }], mutate })
  ctx.provide('credentials', {
    listRecords: async () => [...records].map(id => ({ key: `github-copilot/account-${id}`, kind: 'grant' })),
    readRecord,
    modifyRecord: async () => { throw new Error('Unexpected credential mutation') },
    deleteRecord: async () => { throw new Error('Unexpected credential deletion') },
  })
  const host = new CopilotAccountsHost(ctx, { routeDiagnostic: () => undefined })
  vi.spyOn(host, 'ensureIdentityFor').mockImplementation(accountId => host.viewForAccount(accountId))
  ctx.provide('githubCopilotAccounts', { host })
  const owner = new SessionAccountsHost(ctx)
  ctx.provide('githubCopilotSessionAccounts', owner)
  return { ctx, host, owner, value, mutate, records, readRecord, revision: () => revision,
    selectGlobal(id: string) { value.activeAccountId = id; revision++; host.selectionChanged() } }
}

function nativeProof(f: ReturnType<typeof fixture>, matches: Promise<boolean>) {
  vi.mocked(captureNativeCopilot).mockResolvedValue({
    namespace: 'llm-pi-ai',
    models: new Map([['native-model', { id: 'native-model', api: 'openai-responses' }]]),
    assertCurrent: () => {},
  })
  f.readRecord.mockResolvedValue({ kind: 'grant', payload: {
    type: 'oauth', refresh: 'synthetic-refresh', access: 'synthetic-access', expires: Date.now() + 60_000,
  } })
  return vi.spyOn(f.host, 'nativeCredentialMatches').mockReturnValue(matches)
}

describe('Session account Host admission and CAS', () => {
  it('records native evidence only after matching account proof and delivery', async () => {
    const f = fixture(), agent = { session: { id: 'a' } }, signal = new AbortController().signal
    nativeProof(f, Promise.resolve(true))
    f.owner.admitNative(agent, 1, signal, A, 'native-model')
    expect(f.owner.turns.evidence(agent.session, 1)).toBeUndefined()
    f.owner.recordNativeRequest(signal, 'other-session', 'native-model')
    await vi.waitFor(() => expect(f.host.ensureIdentityFor).toHaveBeenCalledOnce())
    expect(f.owner.turns.evidence(agent.session, 1)).toBeUndefined()
    f.owner.recordNativeRequest(signal, 'a', 'native-model')
    await vi.waitFor(() => expect(f.owner.turns.evidence(agent.session, 1)).toMatchObject({ accountId: A, source: 'global' }))
    f.owner.dispose(); f.host.dispose()
  })
  it('keeps native evidence separate from managed account admission and identity', async () => {
    const f = fixture(), agent = { session: { id: 'a' } }, signal = new AbortController().signal
    f.value.sessionAccounts = [{ sessionId: 'a', accountId: B }]
    nativeProof(f, Promise.resolve(true))
    vi.spyOn(f.host, 'cachedIdentity').mockImplementation(accountId =>
      accountId === B ? { login: 'bob', userId: 2 } : undefined)
    vi.mocked(f.host.ensureIdentityFor).mockImplementation(() => new Promise(() => {}))
    f.owner.admitNative(agent, 1, signal, A, 'native-model')
    f.owner.recordNativeRequest(signal, 'a', 'native-model')
    await vi.waitFor(() => expect(f.owner.turns.evidence(agent.session, 1)).toMatchObject({ accountId: A, source: 'global' }))
    expect(f.owner.turns.current(agent.session)).toBeUndefined()
    expect(f.owner.admit(agent, 1, signal).accountId).toBe(B)
    f.owner.recordRequest(signal)
    expect(f.owner.turns.evidence(agent.session, 1)?.identity).toBeUndefined()
    f.owner.credentialChanged(GITHUB_COPILOT_CREDENTIAL_KEY)
    expect(f.owner.requestBinding(signal).accountId).toBe(B)
    f.owner.dispose(); f.host.dispose()
  })
  it('leaves native evidence unknown when adapter ownership cannot be proven', async () => {
    const f = fixture(), agent = { session: { id: 'a' } }, signal = new AbortController().signal
    nativeProof(f, Promise.resolve(true))
    vi.mocked(captureNativeCopilot).mockResolvedValue(undefined)
    const warn = vi.spyOn(f.ctx.logger, 'warn')
    f.owner.admitNative(agent, 1, signal, A, 'native-model')
    f.owner.recordNativeRequest(signal, 'a', 'native-model')
    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith('[github-copilot] %s', 'COPILOT_NATIVE_ACCOUNT_EVIDENCE_UNPROVEN'))
    expect(f.owner.turns.evidence(agent.session, 1)).toBeUndefined()
    f.owner.dispose(); f.host.dispose()
  })
  it('leaves native evidence unknown when the selected and canonical accounts differ', async () => {
    const f = fixture(), agent = { session: { id: 'a' } }, signal = new AbortController().signal
    const matches = nativeProof(f, Promise.resolve(false))
    const warn = vi.spyOn(f.ctx.logger, 'warn')
    f.owner.admitNative(agent, 1, signal, A, 'native-model')
    f.owner.recordNativeRequest(signal, 'a', 'native-model')
    await vi.waitFor(() => expect(matches).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith('[github-copilot] %s', 'COPILOT_NATIVE_ACCOUNT_EVIDENCE_MISMATCH'))
    expect(f.owner.turns.evidence(agent.session, 1)).toBeUndefined()
    expect(f.owner.turns.current(agent.session)).toBeUndefined()
    f.owner.dispose(); f.host.dispose()
  })
  it.each([
    ['canonical change', GITHUB_COPILOT_CREDENTIAL_KEY, false],
    ['selected account change', `github-copilot/account-${A}`, false],
    ['unrelated account change', `github-copilot/account-${B}`, true],
  ])('fences pending native evidence on %s', async (_label, key, retained) => {
    const f = fixture(), agent = { session: { id: 'a' } }, signal = new AbortController().signal
    let finish!: (value: boolean) => void
    const pending = new Promise<boolean>(resolve => { finish = resolve })
    const matches = nativeProof(f, pending)
    f.owner.admitNative(agent, 1, signal, A, 'native-model')
    f.owner.recordNativeRequest(signal, 'a', 'native-model')
    await vi.waitFor(() => expect(matches).toHaveBeenCalledOnce())
    f.owner.credentialChanged(key)
    finish(true)
    if (retained) {
      await vi.waitFor(() => expect(f.owner.turns.evidence(agent.session, 1)).toMatchObject({ accountId: A }))
    } else {
      await pending
      await Promise.resolve()
      expect(f.owner.turns.evidence(agent.session, 1)).toBeUndefined()
      expect(f.owner.turns.current(agent.session)).toBeUndefined()
    }
    f.owner.dispose(); f.host.dispose()
  })
  it.each(['credential change', 'route change'])('fences qualified native evidence on %s before delivery', async change => {
    const f = fixture(), agent = { session: { id: 'a' } }, signal = new AbortController().signal
    nativeProof(f, Promise.resolve(true))
    const assertCurrent = vi.fn()
    vi.mocked(captureNativeCopilot).mockResolvedValue({
      namespace: 'llm-pi-ai',
      models: new Map([['native-model', { id: 'native-model', api: 'openai-responses' }]]),
      assertCurrent,
    })
    f.owner.admitNative(agent, 1, signal, A, 'native-model')
    await vi.waitFor(() => expect(f.host.ensureIdentityFor).toHaveBeenCalledOnce())
    if (change === 'credential change') f.owner.credentialChanged(GITHUB_COPILOT_CREDENTIAL_KEY)
    else assertCurrent.mockImplementation(() => { throw new Error('route changed') })
    f.owner.recordNativeRequest(signal, 'a', 'native-model')
    expect(f.owner.turns.evidence(agent.session, 1)).toBeUndefined()
    f.owner.dispose(); f.host.dispose()
  })
  it.each(['turn end', 'disposal', 'abort'])('ignores native proof after %s', async settlement => {
    const f = fixture(), agent = { session: { id: 'a' } }, controller = new AbortController(), signal = controller.signal
    let finish!: (value: boolean) => void
    const pending = new Promise<boolean>(resolve => { finish = resolve })
    const matches = nativeProof(f, pending)
    f.owner.admitNative(agent, 1, signal, A, 'native-model')
    f.owner.recordNativeRequest(signal, 'a', 'native-model')
    await vi.waitFor(() => expect(matches).toHaveBeenCalledOnce())
    if (settlement === 'turn end') f.owner.end(agent.session, 1)
    else if (settlement === 'disposal') f.owner.dispose()
    else controller.abort()
    finish(true)
    await pending
    await Promise.resolve()
    expect(f.owner.turns.evidence(agent.session, 1)).toBeUndefined()
    expect(f.owner.turns.current(agent.session)).toBeUndefined()
    f.owner.dispose(); f.host.dispose()
  })
  it('retains admission identity across cache invalidation without querying or recording before delivery', () => {
    const f = fixture(), agent = { session: { id: 'a' } }, signal = new AbortController().signal
    const cached = vi.spyOn(f.host, 'cachedIdentity').mockReturnValue({ login: 'alice', userId: 1 })
    f.owner.admit(agent, 1, signal)
    cached.mockReturnValue(undefined)
    expect(f.owner.turns.evidence(agent.session, 1)).toBeUndefined()
    expect(f.host.ensureIdentityFor).not.toHaveBeenCalled()
    f.owner.recordRequest(signal)
    expect(f.owner.turns.evidence(agent.session, 1)?.identity).toEqual({ login: 'alice', userId: 1 })
    f.owner.dispose(); f.host.dispose()
  })
  it('ensures the admitted inactive account once without blocking delivery or borrowing the default', async () => {
    const f = fixture(), agent = { session: { id: 'a' } }, signal = new AbortController().signal
    let finish!: () => void
    const waiting = new Promise<void>(resolve => { finish = resolve })
    const cached = vi.spyOn(f.host, 'cachedIdentity').mockReturnValue(undefined)
    vi.mocked(f.host.ensureIdentityFor).mockImplementation(async accountId => {
      await waiting
      return f.host.viewForAccount(accountId)
    })
    f.owner.admit(agent, 1, signal)
    f.owner.admit(agent, 1, signal)
    f.owner.recordRequest(signal)
    expect(f.owner.turns.evidence(agent.session, 1)?.identity).toBeUndefined()
    f.selectGlobal(B)
    cached.mockImplementation(accountId => accountId === A ? { login: 'alice', userId: 1 } : { login: 'bob', userId: 2 })
    finish()
    await vi.waitFor(() => expect(f.owner.turns.evidence(agent.session, 1)?.identity?.login).toBe('alice'))
    expect(f.host.ensureIdentityFor).toHaveBeenCalledExactlyOnceWith(A)
    f.owner.dispose(); f.host.dispose()
  })
  it('ignores identity completion after the turn ends', async () => {
    const f = fixture(), agent = { session: { id: 'a' } }, signal = new AbortController().signal
    let finish!: () => void
    const waiting = new Promise<void>(resolve => { finish = resolve })
    const cached = vi.spyOn(f.host, 'cachedIdentity').mockReturnValue(undefined)
    vi.mocked(f.host.ensureIdentityFor).mockImplementation(async accountId => {
      await waiting
      return f.host.viewForAccount(accountId)
    })
    f.owner.admit(agent, 1, signal)
    f.owner.recordRequest(signal)
    f.owner.end(agent.session, 1)
    vi.mocked(f.host.ensureIdentityFor).mockImplementationOnce(() => new Promise(() => {}))
    f.owner.admit(agent, 2, signal)
    f.owner.recordRequest(signal)
    cached.mockReturnValue({ login: 'alice', userId: 1 })
    finish()
    await vi.mocked(f.host.ensureIdentityFor).mock.results[0]?.value
    await Promise.resolve()
    expect(f.owner.turns.evidence(agent.session, 1)?.identity).toBeUndefined()
    expect(f.owner.turns.evidence(agent.session, 2)?.identity).toBeUndefined()
    f.owner.dispose(); f.host.dispose()
  })
  it('reports the selected Session record independently of missing global or explicit records', async () => {
    const f = fixture()
    f.records.delete(B)
    expect(await f.host.viewForAccount(B)).toMatchObject({ activeAccountId: B, state: 'error',
      diagnostic: 'COPILOT_ACCOUNTS_SELECTED_MISSING' })
    f.records.add(B); f.records.delete(A)
    expect(await f.host.get()).toMatchObject({ state: 'error', diagnostic: 'COPILOT_ACCOUNTS_SELECTED_MISSING' })
    expect(await f.host.viewForAccount(B)).toMatchObject({ activeAccountId: B, state: 'ready' })
    f.owner.dispose(); f.host.dispose()
  })
  it('changes only this Session preference and retains explicit same-as-default selections', async () => {
    const f = fixture(), a = { session: { id: 'session-a' } }, b = { session: { id: 'session-b' } }
    await f.owner.set(a, A, 1)
    expect(f.value).toMatchObject({ activeAccountId: A, enabled: true, excludedModelIds: ['preserved'] })
    f.selectGlobal(B)
    expect(f.owner.selected(a)).toEqual({ accountId: A, source: 'session' })
    expect(f.owner.selected(b)).toEqual({ accountId: B, source: 'global' })
    await f.owner.set(a, null, f.revision())
    expect(f.owner.selected(a)).toEqual({ accountId: B, source: 'global' })
    f.owner.dispose(); f.host.dispose()
  })
  it('freezes a running turn while allowing later Session/default choices independently', async () => {
    const f = fixture(), a = { session: { id: 'a' } }, b = { session: { id: 'b' } }
    const signal = new AbortController().signal
    const binding = f.owner.admit(a, 1, signal)
    await f.owner.set(a, B, f.revision())
    f.selectGlobal(B)
    expect(() => binding.assertCurrent()).not.toThrow()
    expect(f.owner.requestBinding(signal).accountId).toBe(A)
    expect(f.owner.admit(a, 1, signal).accountId).toBe(A)
    expect(f.owner.admit(b, 1, new AbortController().signal).accountId).toBe(B)
    f.owner.recordRequest(signal)
    f.owner.end(a.session, 1)
    expect(f.owner.turns.evidence(a.session, 1)).toEqual({ accountId: A, source: 'global' })
    expect(f.owner.admit(a, 2, new AbortController().signal).accountId).toBe(B)
    f.owner.dispose(); f.host.dispose()
  })
  it('holds account mutation fencing through abort until the actual turn boundary', async () => {
    const f = fixture(), a = { session: { id: 'a' } }, signal = new AbortController()
    f.owner.admit(a, 1, signal.signal)
    f.selectGlobal(B)
    signal.abort()
    expect(await f.host.remove(A, f.revision())).toMatchObject({ diagnostic: 'COPILOT_ACCOUNTS_BUSY' })
    expect(f.owner.turns.current(a.session)?.accountId).toBe(A)
    f.owner.end(a.session, 1)
    expect(f.owner.turns.current(a.session)).toBeUndefined()
    f.owner.dispose(); f.host.dispose()
  })
  it('rejects stale CAS and missing accounts instead of persisting a fallback', async () => {
    const f = fixture(), a = { session: { id: 'a' } }
    await expect(f.owner.set(a, B, 0)).rejects.toThrow('COPILOT_ACCOUNTS_CONFLICT')
    f.records.delete(B)
    await expect(f.owner.set(a, B, 1)).rejects.toThrow('COPILOT_ACCOUNTS_SELECTED_MISSING')
    expect(f.mutate).not.toHaveBeenCalled()
    f.owner.dispose(); f.host.dispose()
  })
  it('does not change the active turn on a wrong end boundary', () => {
    const f = fixture(), a = { session: { id: 'a' } }, signal = new AbortController().signal
    f.owner.admit(a, 1, signal)
    f.owner.end(a.session, 0)
    expect(f.owner.requestBinding(signal).accountId).toBe(A)
    f.owner.remove(a.session)
    expect(f.owner.turns.forSignal(signal)).toBeUndefined()
    f.owner.dispose(); f.host.dispose()
  })
})
