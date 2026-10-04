import { randomUUID } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-authorization'
import { createModels } from '@earendil-works/pi-ai'
import { githubCopilotProvider } from '@earendil-works/pi-ai/providers/github-copilot'
import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all'
import { createGitHubCopilotCredentialStore, captureActiveGitHubCopilotBinding } from './copilot-auth.ts'
import { normalizeGitHubCopilotOAuthCredential } from './copilot-grant.ts'
import type { GitHubCopilotOAuthCredential } from './copilot-grant.ts'
import { abortable } from './http.ts'
import { createAccountModelAuth, copilotAccountKey } from './account-model-auth.ts'
import { createAccountModelSource } from './account-model-source.ts'
import { copilotPublicHeaders } from './preview-provider.ts'
import { migrationStatus } from './migration-status.ts'
import { onSettingsNamespaceUpdated } from './settings-reader.ts'
import { GITHUB_COPILOT_CREDENTIAL_KEY, GITHUB_COPILOT_PROVIDER_ID } from './copilot-identity.ts'
import { COPILOT_ACCOUNT_ID_PATTERN, COPILOT_ACCOUNTS_MAX } from './copilot-accounts-types.ts'
import type { CopilotAccountBinding, CopilotAccountIdentity, CopilotAccountLease, CopilotAccountsDiagnostic,
  CopilotAccountsNotice, CopilotAccountsView, CopilotAccountView } from './copilot-accounts-types.ts'
import type {} from './copilot-accounts-remote.ts'

const IDENTITY_TTL = 600_000
const TIMEOUT = 10_000
const MAX_BODY = 65_536
interface Settings {
  describe(options: { redactSecrets: true }): readonly { ns: string; revision: number; value?: unknown }[]
  mutate(namespace: string, operations: readonly { op: 'set'; path: readonly string[]; value: string }[], revision: number): Promise<void>
}
interface Dependencies {
  fetch?: typeof globalThis.fetch
  validateModels?: (binding: CopilotAccountBinding, signal: AbortSignal) => Promise<void>
  routeDiagnostic?: () => CopilotAccountsDiagnostic | undefined
}
class AccountsFailure extends Error {
  constructor(readonly diagnostic: CopilotAccountsDiagnostic) { super(diagnostic) }
}
function fail(code: CopilotAccountsDiagnostic): never { throw new AccountsFailure(code) }
function diagnostic(error: unknown, fallback: CopilotAccountsDiagnostic): CopilotAccountsDiagnostic {
  return error instanceof AccountsFailure ? error.diagnostic : fallback
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !COPILOT_ACCOUNT_ID_PATTERN.test(value)) fail('COPILOT_ACCOUNTS_SELECTOR_INVALID')
  return value
}
function recordKey(accountId: string) {
  id(accountId)
  return accountId === 'canonical' ? credentialKey('llm-pi-ai', 'github-copilot')
    : credentialKey('github-copilot', `account-${accountId}`)
}
export function isCopilotAccountRecord(key: string): boolean {
  return key === GITHUB_COPILOT_CREDENTIAL_KEY
    || key.startsWith('github-copilot/account-') && COPILOT_ACCOUNT_ID_PATTERN.test(key.slice('github-copilot/account-'.length))
      && key !== 'github-copilot/account-canonical'
}
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function isSettings(value: unknown): value is Settings {
  return object(value) && typeof value.describe === 'function' && typeof value.mutate === 'function'
}

/** Account membership is credential metadata; only the selector lives in Settings. */
export class CopilotAccountsHost {
  private generation = 0
  private selectionSignature: string | undefined
  private disposed = false
  private readonly leases = new Set<() => void>()
  private readonly identities = new Map<string, { identity: CopilotAccountIdentity; key: string; at: number }>()
  private readonly unavailableIdentities = new Set<string>()
  private readonly listeners = new Set<() => void>()
  private readonly abort = new AbortController()
  private operation: 'authorizing' | 'switching' | undefined
  private attemptKey: string | undefined
  private authorizationAbort: AbortController | undefined
  private notices: CopilotAccountsNotice[] = []
  private lastFailure: CopilotAccountsDiagnostic | undefined

  constructor(private readonly ctx: Context, private readonly dependencies: Dependencies = {}) {}
  private settings(): Settings {
    const value: unknown = this.ctx.get('settings')
    if (!isSettings(value)) {
      fail('COPILOT_ACCOUNTS_SETTINGS_UNAVAILABLE')
    }
    return value
  }
  private selection(): { accountId: string; revision: number } {
    if (this.disposed) fail('COPILOT_ACCOUNTS_DISPOSED')
    let rows: ReturnType<Settings['describe']>
    try { rows = this.settings().describe({ redactSecrets: true }) }
    catch (error) { fail(diagnostic(error, 'COPILOT_ACCOUNTS_SETTINGS_UNAVAILABLE')) }
    const matching = rows.filter(row => row.ns === 'github-copilot')
    const descriptor = matching[0]
    if (matching.length !== 1 || !descriptor || !Number.isSafeInteger(descriptor.revision) || descriptor.revision < 0
      || !object(descriptor.value)) fail('COPILOT_ACCOUNTS_SETTINGS_UNAVAILABLE')
    const accountId = descriptor.value.activeAccountId === undefined ? 'canonical' : id(descriptor.value.activeAccountId)
    const signature = accountId
    const changed = this.selectionSignature !== undefined && this.selectionSignature !== signature
    this.selectionSignature = signature
    if (changed) this.revoke()
    return { accountId, revision: descriptor.revision }
  }
  private revoke(): void {
    this.generation++
    this.identities.clear()
    this.unavailableIdentities.clear()
    for (const listener of this.listeners) listener()
  }
  selectionChanged(): void {
    try { this.selection() } catch { this.revoke() }
  }
  credentialChanged(key: string): void {
    if (!isCopilotAccountRecord(key)) return
    const accountId = key === GITHUB_COPILOT_CREDENTIAL_KEY ? 'canonical' : key.slice('github-copilot/account-'.length)
    this.identities.delete(accountId)
    this.unavailableIdentities.delete(accountId)
    // Existing proof owners separately observe every record update, including
    // native refresh. Selector generations must not redirect that refresh.
  }
  onChanged(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  capture(accountId?: string): CopilotAccountBinding {
    const selected = this.selection()
    const target = accountId === undefined ? selected.accountId : id(accountId)
    const generation = this.generation
    return Object.freeze({ accountId: target, key: recordKey(target), generation,
      assertCurrent: () => {
        const current = this.selection()
        if (this.disposed || current.accountId !== selected.accountId || generation !== this.generation) {
          fail('COPILOT_ACCOUNTS_CHANGED')
        }
      },
    })
  }
  acquire(signal?: AbortSignal, requireManaged = true): CopilotAccountLease {
    if (this.operation !== undefined || this.ctx.get('authorization')?.describe(recordKey('canonical'))?.inFlight === true) {
      fail('COPILOT_ACCOUNTS_BUSY')
    }
    if (signal?.aborted) fail('COPILOT_ACCOUNTS_CHANGED')
    const binding = this.capture()
    if (requireManaged && binding.accountId !== 'canonical') {
      const blocked = this.routeDiagnostic(false)
      if (blocked) fail(blocked)
    }
    const release = () => { this.leases.delete(release); signal?.removeEventListener('abort', release) }
    this.leases.add(release)
    signal?.addEventListener('abort', release, { once: true })
    return { binding, release }
  }
  acquireCanonicalAuthorization(): CopilotAccountLease {
    if (this.busy()) fail('COPILOT_ACCOUNTS_BUSY')
    const binding = this.capture()
    if (binding.accountId !== 'canonical') fail('COPILOT_ACCOUNTS_CHANGED')
    this.operation = 'authorizing'
    let released = false
    const release = () => {
      if (released) return
      released = true
      this.operation = undefined
      this.leases.delete(release)
    }
    this.leases.add(release)
    return { binding, release }
  }
  private routeDiagnostic(includeActivity = true): CopilotAccountsDiagnostic | undefined {
    if (this.dependencies.routeDiagnostic) return this.dependencies.routeDiagnostic()
    const evidence = migrationStatus(this.ctx)
    if (!evidence.complete.routes || includeActivity && (!evidence.complete.sessions || !evidence.complete.defaultSelection)
      || !evidence.capabilities.settingsCas) return 'COPILOT_ACCOUNTS_EVIDENCE_INCOMPLETE'
    if (evidence.routes.nativeConfigured || evidence.routes.nativeRegistered || !evidence.routes.managedRegistered
      || includeActivity && (evidence.defaultSelection?.provider === GITHUB_COPILOT_PROVIDER_ID
        || evidence.sessions.some(row => row.effectiveSelection?.provider === GITHUB_COPILOT_PROVIDER_ID
          || row.activeRequestSelection?.provider === GITHUB_COPILOT_PROVIDER_ID))) return 'COPILOT_ACCOUNTS_ROUTE_BLOCKED'
    if (includeActivity && evidence.sessions.some(row => row.status === 'running'
      && row.effectiveSelection?.provider === 'github-copilot-preview')) return 'COPILOT_ACCOUNTS_BUSY'
    return undefined
  }
  private busy(): boolean {
    return this.leases.size > 0 || this.operation !== undefined
      || this.ctx.get('authorization')?.describe(recordKey('canonical'))?.inFlight === true
  }
  private async membership(): Promise<CopilotAccountView[]> {
    let records: readonly { key: string; kind: string }[]
    try {
      const credentials = this.ctx.get('credentials')
      if (!credentials) fail('COPILOT_ACCOUNTS_CREDENTIALS_UNAVAILABLE')
      records = await credentials.listRecords()
    }
    catch { fail('COPILOT_ACCOUNTS_CREDENTIALS_UNAVAILABLE') }
    const owned = records.filter(row => isCopilotAccountRecord(row.key))
    if (owned.length > COPILOT_ACCOUNTS_MAX - (owned.some(row => row.key === GITHUB_COPILOT_CREDENTIAL_KEY) ? 0 : 1)) {
      fail('COPILOT_ACCOUNTS_LIMIT')
    }
    const rows: CopilotAccountView[] = []
    const seen = new Set<string>()
    for (const record of [{ key: GITHUB_COPILOT_CREDENTIAL_KEY, kind: 'missing' }, ...owned]) {
      const accountId = record.key === GITHUB_COPILOT_CREDENTIAL_KEY ? 'canonical' : record.key.slice('github-copilot/account-'.length)
      if (seen.has(accountId)) continue
      seen.add(accountId)
      const configured = owned.find(row => row.key === record.key)?.kind === 'grant'
      const cached = this.identities.get(accountId)
      const identity = configured && cached && Date.now() - cached.at < IDENTITY_TTL ? cached.identity : undefined
      rows.push({ id: accountId, configured, identityState: identity ? 'ready'
        : this.unavailableIdentities.has(accountId) ? 'unavailable' : 'unknown', ...identity ? { identity } : {} })
    }
    return rows
  }
  async get(): Promise<CopilotAccountsView> {
    let activeAccountId = 'canonical', revision: number | undefined
    let accounts: CopilotAccountView[] = [], writable = false
    let problem: CopilotAccountsDiagnostic | undefined
    try {
      const selection = this.selection()
      activeAccountId = selection.accountId; revision = selection.revision; writable = true
      accounts = await this.membership()
      const current = this.selection()
      if (current.accountId !== activeAccountId || current.revision !== revision) fail('COPILOT_ACCOUNTS_CHANGED')
      if (activeAccountId !== 'canonical' && !accounts.some(row => row.id === activeAccountId && row.configured)) {
        fail('COPILOT_ACCOUNTS_SELECTED_MISSING')
      }
      problem = this.lastFailure ?? this.routeDiagnostic()
    } catch (error) { problem = diagnostic(error, 'COPILOT_ACCOUNTS_CREDENTIALS_UNAVAILABLE') }
    if (this.lastFailure === 'COPILOT_ACCOUNTS_COMMIT_UNCERTAIN') problem = this.lastFailure
    const recovery = problem === 'COPILOT_ACCOUNTS_SELECTED_MISSING' && writable && this.routeDiagnostic() === undefined
    return { state: problem ? 'error' : 'ready', activeAccountId, ...revision === undefined ? {} : { revision },
      writable, switchable: (!problem || recovery) && writable && !this.busy(), accounts,
      ...this.operation === undefined ? {} : { operation: this.operation },
      notices: this.operation === 'authorizing' ? [...this.notices] : [],
      ...problem ? { diagnostic: problem } : {} }
  }
  private async identity(binding: CopilotAccountBinding, signal: AbortSignal): Promise<CopilotAccountIdentity> {
    const store = createGitHubCopilotCredentialStore(this.ctx, GITHUB_COPILOT_PROVIDER_ID, binding)
    const raw = await store.read(GITHUB_COPILOT_PROVIDER_ID)
    if (raw === undefined) fail('COPILOT_ACCOUNTS_SELECTED_MISSING')
    const grant = normalizeGitHubCopilotOAuthCredential(raw)
    if (grant.enterpriseUrl !== undefined) fail('COPILOT_ACCOUNTS_ENTERPRISE_UNSUPPORTED')
    const before = copilotAccountKey(grant)
    const identity = await this.fetchIdentity(grant, signal)
    const latest = await store.read(GITHUB_COPILOT_PROVIDER_ID)
    if (!latest || copilotAccountKey(normalizeGitHubCopilotOAuthCredential(latest)) !== before) fail('COPILOT_ACCOUNTS_CHANGED')
    binding.assertCurrent()
    const previous = this.identities.get(binding.accountId)
    if (previous && previous.identity.userId !== identity.userId) fail('COPILOT_ACCOUNTS_IDENTITY_CHANGED')
    if (!this.identities.has(binding.accountId) && this.identities.size >= COPILOT_ACCOUNTS_MAX) {
      this.identities.delete(this.identities.keys().next().value!)
    }
    this.identities.set(binding.accountId, { identity, key: before, at: Date.now() })
    this.unavailableIdentities.delete(binding.accountId)
    return identity
  }
  private async fetchIdentity(grant: GitHubCopilotOAuthCredential, signal: AbortSignal): Promise<CopilotAccountIdentity> {
    if (grant.enterpriseUrl !== undefined) fail('COPILOT_ACCOUNTS_ENTERPRISE_UNSUPPORTED')
    signal.throwIfAborted()
    const response = await abortable((this.dependencies.fetch ?? globalThis.fetch)('https://api.github.com/user', {
      method: 'GET', redirect: 'error', cache: 'no-store', signal,
      headers: { Authorization: `token ${grant.refresh}`, Accept: 'application/json', 'X-GitHub-Api-Version': '2022-11-28' },
    }), signal)
    if (!response.ok || response.redirected || !response.body) {
      void response.body?.cancel().catch(() => undefined)
      fail('COPILOT_ACCOUNTS_IDENTITY_UNAVAILABLE')
    }
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let bytes = 0
    const cancel = () => { void reader.cancel().catch(() => undefined) }
    signal.addEventListener('abort', cancel, { once: true })
    try {
      while (true) {
        if (signal.aborted) fail('COPILOT_ACCOUNTS_CHANGED')
        const chunk = await abortable(reader.read(), signal)
        if (chunk.done) break
        bytes += chunk.value.byteLength
        if (bytes > MAX_BODY) { cancel(); fail('COPILOT_ACCOUNTS_IDENTITY_INVALID') }
        chunks.push(chunk.value)
      }
    } finally { signal.removeEventListener('abort', cancel); reader.releaseLock() }
    if (signal.aborted) fail('COPILOT_ACCOUNTS_CHANGED')
    const buffer = new Uint8Array(bytes)
    let offset = 0
    for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength }
    let value: unknown
    try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer)) }
    catch { fail('COPILOT_ACCOUNTS_IDENTITY_INVALID') }
    if (!object(value) || typeof value.login !== 'string' || value.login.length > 39
      || !/^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/u.test(value.login)
      || typeof value.id !== 'number' || !Number.isSafeInteger(value.id) || value.id <= 0) fail('COPILOT_ACCOUNTS_IDENTITY_INVALID')
    return Object.freeze({ login: value.login, userId: value.id })
  }
  async refreshIdentity(): Promise<CopilotAccountsView> {
    let lease: CopilotAccountLease | undefined
    try {
      lease = this.acquire(undefined, false)
      await this.identity(lease.binding, AbortSignal.any([this.abort.signal, AbortSignal.timeout(TIMEOUT)]))
      this.lastFailure = undefined
    } catch (error) {
      if (lease) { this.identities.delete(lease.binding.accountId); this.unavailableIdentities.add(lease.binding.accountId) }
      this.lastFailure = diagnostic(error, 'COPILOT_ACCOUNTS_IDENTITY_UNAVAILABLE')
    } finally { lease?.release() }
    return this.get()
  }
  private async validateModels(binding: CopilotAccountBinding, signal: AbortSignal): Promise<void> {
    try {
      if (this.dependencies.validateModels) return await this.dependencies.validateModels(binding, signal)
      const credentials = createGitHubCopilotCredentialStore(this.ctx, GITHUB_COPILOT_PROVIDER_ID, binding)
      const source = createAccountModelSource({ ...createAccountModelAuth(credentials),
        headers: copilotPublicHeaders(),
        nativeApis: new Map(getBuiltinModels('github-copilot').map(model => [model.id, model.api])) })
      try {
        const snapshot = await source.load({ signal })
        if (snapshot.models.length === 0) fail('COPILOT_ACCOUNTS_MODELS_FAILED')
      } finally { source.dispose() }
    } catch (error) { fail(diagnostic(error, 'COPILOT_ACCOUNTS_MODELS_FAILED')) }
  }
  private async assertIdentityCurrent(binding: CopilotAccountBinding, expectedKey: string | undefined): Promise<void> {
    const value = await createGitHubCopilotCredentialStore(this.ctx, GITHUB_COPILOT_PROVIDER_ID, binding).read(GITHUB_COPILOT_PROVIDER_ID)
    if (!expectedKey || value === undefined || copilotAccountKey(normalizeGitHubCopilotOAuthCredential(value)) !== expectedKey) {
      fail('COPILOT_ACCOUNTS_CHANGED')
    }
  }
  async switchAccount(accountId: string, expectedRevision: number): Promise<CopilotAccountsView> {
    let committed = false, fenced = false
    try {
      id(accountId)
      const before = this.selection()
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || before.revision !== expectedRevision) fail('COPILOT_ACCOUNTS_CONFLICT')
      if (this.busy()) fail('COPILOT_ACCOUNTS_BUSY')
      const blocked = this.routeDiagnostic()
      if (blocked) fail(blocked)
      this.operation = 'switching'; fenced = true
      const rows = await this.membership()
      if (!rows.some(row => row.id === accountId && row.configured)) fail('COPILOT_ACCOUNTS_SELECTED_MISSING')
      const binding = this.capture(accountId)
      const signal = AbortSignal.any([this.abort.signal, AbortSignal.timeout(60_000)])
      await this.identity(binding, signal)
      const identityKey = this.identities.get(accountId)?.key
      await this.validateModels(binding, signal)
      await this.assertIdentityCurrent(binding, identityKey)
      binding.assertCurrent()
      const finalRoute = this.routeDiagnostic()
      if (finalRoute) fail(finalRoute)
      if (this.leases.size > 0 || this.ctx.get('authorization')?.describe(recordKey('canonical'))?.inFlight === true) {
        fail('COPILOT_ACCOUNTS_BUSY')
      }
      const current = this.selection()
      if (current.revision !== expectedRevision || current.accountId !== before.accountId) fail('COPILOT_ACCOUNTS_CONFLICT')
      try { await this.settings().mutate('github-copilot', [{ op: 'set', path: ['activeAccountId'], value: accountId }], expectedRevision) }
      catch {
        try {
          const after = this.selection()
          if (after.accountId !== before.accountId || after.revision !== before.revision) fail('COPILOT_ACCOUNTS_COMMIT_UNCERTAIN')
        } catch { fail('COPILOT_ACCOUNTS_COMMIT_UNCERTAIN') }
        fail('COPILOT_ACCOUNTS_CONFLICT')
      }
      committed = true
      const after = this.selection()
      if (after.accountId !== accountId || after.revision === expectedRevision) fail('COPILOT_ACCOUNTS_COMMIT_UNCERTAIN')
      await this.assertIdentityCurrent(this.capture(accountId), identityKey)
      if (!(await this.membership()).some(row => row.id === accountId && row.configured)) fail('COPILOT_ACCOUNTS_COMMIT_UNCERTAIN')
      this.lastFailure = undefined
    } catch (error) {
      this.lastFailure = committed ? 'COPILOT_ACCOUNTS_COMMIT_UNCERTAIN' : diagnostic(error, 'COPILOT_ACCOUNTS_CHANGED')
    } finally { if (fenced) this.operation = undefined }
    return this.get()
  }
  async add(): Promise<CopilotAccountsView> { return this.authorize(randomUUID()) }
  async reauthorize(accountId: string, expectedRevision: number): Promise<CopilotAccountsView> {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      this.lastFailure = 'COPILOT_ACCOUNTS_CONFLICT'
      return this.get()
    }
    return this.authorize(accountId, expectedRevision)
  }
  async authorize(accountId: string, expectedRevision?: number): Promise<CopilotAccountsView> {
    let removeFlow: (() => void) | undefined
    let fenced = false
    try {
      id(accountId)
      if (accountId === 'canonical') fail('COPILOT_ACCOUNTS_AUTH_UNAVAILABLE')
      const assertRevision = () => {
        if (expectedRevision !== undefined && this.selection().revision !== expectedRevision) fail('COPILOT_ACCOUNTS_CONFLICT')
      }
      assertRevision()
      if (this.busy()) fail('COPILOT_ACCOUNTS_BUSY')
      this.operation = 'authorizing'; fenced = true
      this.authorizationAbort = new AbortController()
      const attemptSignal = AbortSignal.any([this.abort.signal, this.authorizationAbort.signal])
      const rows = await this.membership()
      assertRevision()
      if (this.selection().accountId !== 'canonical'
        && !rows.some(row => row.id === this.selection().accountId && row.configured)) {
        const blocked = this.routeDiagnostic()
        if (blocked) fail(blocked)
      }
      if (expectedRevision !== undefined && !rows.some(row => row.id === accountId && row.configured)) {
        fail('COPILOT_ACCOUNTS_SELECTED_MISSING')
      }
      if (!rows.some(row => row.id === accountId) && rows.length >= COPILOT_ACCOUNTS_MAX) fail('COPILOT_ACCOUNTS_LIMIT')
      const authorization = this.ctx.get('authorization')
      if (!authorization || typeof authorization.registerFlow !== 'function') fail('COPILOT_ACCOUNTS_AUTH_UNAVAILABLE')
      const binding = this.capture(accountId)
      const existing = rows.find(row => row.id === accountId)
      const signal = AbortSignal.any([attemptSignal, AbortSignal.timeout(TIMEOUT)])
      const previous = existing?.configured ? await this.identity(binding, signal) : undefined
      const previousKey = this.identities.get(accountId)?.key
      const otherIdentities: { accountId: string; identity: CopilotAccountIdentity; key: string | undefined }[] = []
      for (const row of rows) {
        if (row.configured && row.id !== accountId) {
          const identity = await this.identity(this.capture(row.id), signal)
          otherIdentities.push({ accountId: row.id, identity, key: this.identities.get(row.id)?.key })
        }
      }
      this.operation = 'authorizing'; this.attemptKey = binding.key; this.notices = []; this.lastFailure = undefined
      let authorizationFailure: CopilotAccountsDiagnostic | undefined
      removeFlow = authorization.registerFlow({
        key: recordKey(accountId), label: 'GitHub Copilot account', methods: [{ id: 'oauth', label: 'Sign in with GitHub' }],
        run: async session => {
          const credentials = createGitHubCopilotCredentialStore(this.ctx, GITHUB_COPILOT_PROVIDER_ID, binding)
          const models = createModels({ credentials: {
            ...credentials,
            modify: (provider, mutate) => credentials.modify(provider, async current => {
              try {
                session.signal.throwIfAborted()
                assertRevision()
                if (previousKey === undefined ? current !== undefined
                  : current === undefined || copilotAccountKey(normalizeGitHubCopilotOAuthCredential(current)) !== previousKey) {
                  fail('COPILOT_ACCOUNTS_CHANGED')
                }
                const next = await mutate(current)
                session.signal.throwIfAborted()
                if (next !== undefined) {
                  const candidate = await this.fetchIdentity(normalizeGitHubCopilotOAuthCredential(next), session.signal)
                  if (previous && previous.userId !== candidate.userId) fail('COPILOT_ACCOUNTS_IDENTITY_CHANGED')
                  for (const other of otherIdentities) {
                    await this.assertIdentityCurrent(this.capture(other.accountId), other.key)
                    if (other.identity.userId === candidate.userId) fail('COPILOT_ACCOUNTS_DUPLICATE')
                  }
                }
                session.signal.throwIfAborted()
                assertRevision()
                return next
              } catch (error) {
                if (error instanceof AccountsFailure) authorizationFailure = error.diagnostic
                throw error
              }
            }),
          } })
          const provider = githubCopilotProvider()
          if (!provider.auth.oauth) fail('COPILOT_ACCOUNTS_AUTH_UNAVAILABLE')
          models.setProvider({ ...provider, auth: { oauth: provider.auth.oauth } })
          await models.login(GITHUB_COPILOT_PROVIDER_ID, 'oauth', {
            signal: session.signal,
            notify: event => {
              if (event.type === 'device_code') {
                if (event.verificationUri !== 'https://github.com/login/device'
                  || !/^[A-Z0-9-]{1,32}$/u.test(event.userCode)) fail('COPILOT_ACCOUNTS_AUTH_FAILED')
                session.notify({ message: 'Complete GitHub device authorization.', url: event.verificationUri, code: event.userCode })
              }
            },
            prompt: prompt => {
              if (prompt.type === 'text' && /GitHub Enterprise URL\/domain/iu.test(prompt.message)) return Promise.resolve('')
              return Promise.reject(new AccountsFailure('COPILOT_ACCOUNTS_ENTERPRISE_UNSUPPORTED'))
            },
          })
        },
      })
      const cleanup = removeFlow
      void authorization.begin({ key: recordKey(accountId), method: 'oauth',
        signal: attemptSignal, interaction: {
        notify: notice => { this.notices = [...this.notices.slice(-7), { message: notice.message, ...notice.url ? { url: notice.url } : {},
          ...notice.code ? { code: notice.code } : {} }] },
        prompt: async () => { fail('COPILOT_ACCOUNTS_AUTH_UNAVAILABLE') },
      } }).then(async result => {
        if (result.status !== 'authorized') return
        const binding = this.capture(accountId)
        const signal = AbortSignal.any([attemptSignal, AbortSignal.timeout(60_000)])
        const identity = await this.identity(binding, signal)
        if (previous && identity.userId !== previous.userId) fail('COPILOT_ACCOUNTS_IDENTITY_CHANGED')
        await this.validateModels(binding, signal)
      }).catch(error => { this.lastFailure = authorizationFailure ?? diagnostic(error, 'COPILOT_ACCOUNTS_AUTH_FAILED') })
        .finally(() => { cleanup(); this.operation = undefined; this.attemptKey = undefined; this.notices = []; this.authorizationAbort = undefined })
      removeFlow = undefined
    } catch (error) {
      removeFlow?.()
      this.lastFailure = diagnostic(error, 'COPILOT_ACCOUNTS_AUTH_FAILED')
      if (fenced) { this.operation = undefined; this.attemptKey = undefined; this.authorizationAbort = undefined }
    }
    return this.get()
  }
  async cancel(): Promise<CopilotAccountsView> {
    this.authorizationAbort?.abort()
    if (this.attemptKey) this.ctx.get('authorization')?.cancel(recordKey(this.attemptKey.slice('github-copilot/account-'.length)))
    return this.get()
  }
  async remove(accountId: string, expectedRevision: number): Promise<CopilotAccountsView> {
    let fenced = false
    try {
      id(accountId)
      const before = this.selection()
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== before.revision) fail('COPILOT_ACCOUNTS_CONFLICT')
      if (accountId === 'canonical' || accountId === before.accountId) fail('COPILOT_ACCOUNTS_ACTIVE_REMOVE_BLOCKED')
      if (this.busy()) fail('COPILOT_ACCOUNTS_BUSY')
      this.operation = 'switching'; fenced = true
      const binding = this.capture(accountId)
      if (!(await this.membership()).some(row => row.id === accountId)) fail('COPILOT_ACCOUNTS_SELECTED_MISSING')
      binding.assertCurrent()
      if (this.selection().revision !== expectedRevision) fail('COPILOT_ACCOUNTS_CONFLICT')
      await createGitHubCopilotCredentialStore(this.ctx, GITHUB_COPILOT_PROVIDER_ID, binding).delete(GITHUB_COPILOT_PROVIDER_ID)
      if ((await this.membership()).some(row => row.id === accountId)) fail('COPILOT_ACCOUNTS_REMOVE_FAILED')
      this.identities.delete(accountId)
      this.unavailableIdentities.delete(accountId)
      this.lastFailure = undefined
    } catch (error) { this.lastFailure = diagnostic(error, 'COPILOT_ACCOUNTS_REMOVE_FAILED') }
    finally { if (fenced) this.operation = undefined }
    return this.get()
  }
  async signOutActive(): Promise<void> {
    if (this.busy()) fail('COPILOT_ACCOUNTS_BUSY')
    const binding = this.capture()
    if (binding.accountId === 'canonical') fail('COPILOT_ACCOUNTS_ACTIVE_REMOVE_BLOCKED')
    this.operation = 'switching'
    try {
      await createGitHubCopilotCredentialStore(this.ctx, GITHUB_COPILOT_PROVIDER_ID, binding).delete(GITHUB_COPILOT_PROVIDER_ID)
      this.identities.delete(binding.accountId)
      this.unavailableIdentities.delete(binding.accountId)
    } finally { this.operation = undefined }
  }
  dispose(): void {
    if (this.disposed) return
    if (this.attemptKey) this.ctx.get('authorization')?.cancel(recordKey(this.attemptKey.slice('github-copilot/account-'.length)))
    this.disposed = true
    this.authorizationAbort?.abort()
    this.abort.abort()
    this.revoke()
    for (const release of this.leases) release()
    this.listeners.clear()
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context { githubCopilotAccounts: GitHubCopilotAccountsController }
}
export function activeCopilotBinding(ctx: Context): CopilotAccountBinding | undefined {
  return captureActiveGitHubCopilotBinding(ctx)
}
export function isActiveCopilotRecord(ctx: Context, key: string): boolean {
  if (!isCopilotAccountRecord(key)) return false
  try { return key === (activeCopilotBinding(ctx)?.key ?? GITHUB_COPILOT_CREDENTIAL_KEY) }
  catch { return true }
}
export default class GitHubCopilotAccountsController extends TypertRemoteService {
  readonly host: CopilotAccountsHost
  constructor(ctx: Context) {
    super(ctx, 'githubCopilotAccounts')
    this.host = new CopilotAccountsHost(ctx)
    ctx.on('credentials/record-updated', key => this.host.credentialChanged(key))
    onSettingsNamespaceUpdated(ctx, namespace => { if (namespace === 'github-copilot') this.host.selectionChanged() })
    ctx.effect(() => () => this.host.dispose())
  }
  @Remote
  get(): Promise<CopilotAccountsView> { return this.host.get() }
  @Remote
  refreshIdentity(): Promise<CopilotAccountsView> { return this.host.refreshIdentity() }
  @Remote
  add(): Promise<CopilotAccountsView> { return this.host.add() }
  @Remote
  cancel(): Promise<CopilotAccountsView> { return this.host.cancel() }
  @Remote
  reauthorize(accountId: string, expectedRevision: number): Promise<CopilotAccountsView> { return this.host.reauthorize(accountId, expectedRevision) }
  @Remote
  switchAccount(accountId: string, expectedRevision: number): Promise<CopilotAccountsView> { return this.host.switchAccount(accountId, expectedRevision) }
  @Remote
  removeAccount(accountId: string, expectedRevision: number): Promise<CopilotAccountsView> { return this.host.remove(accountId, expectedRevision) }
}
