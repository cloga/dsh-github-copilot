import { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { getCACertificates } from 'node:tls'
import { Agent } from 'undici'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from './copilot-usage-remote.ts'
import { copilotAccountKey } from './account-model-auth.ts'
import { createGitHubCopilotCredentialStore } from './copilot-auth.ts'
import { normalizeGitHubCopilotOAuthCredential } from './copilot-grant.ts'
import type { GitHubCopilotOAuthCredential } from './copilot-grant.ts'
import { GITHUB_COPILOT_PROVIDER_ID } from './copilot-identity.ts'
import { normalizeCopilotUsage, unavailableCopilotUsage } from './copilot-usage-normalize.ts'
import type { CopilotUsageView, CopilotUsageDiagnostic } from './copilot-usage-types.ts'
import { onSettingsNamespaceUpdated } from './settings-reader.ts'
import { activeCopilotBinding, isActiveCopilotRecord } from './copilot-accounts-host.ts'
import type { CopilotAccountBinding } from './copilot-accounts-types.ts'

export const COPILOT_USAGE_ENDPOINT = 'https://api.github.com/copilot_internal/user'
const TTL_MS = 60_000
const REFRESH_INTERVAL_MS = 10_000
const FAILURE_COOLDOWN_MS = 30_000
const TIMEOUT_MS = 10_000
const MAX_BODY_BYTES = 262_144
const CERTIFICATE_FAILURES = new Set([
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'SELF_SIGNED_CERT_IN_CHAIN', 'DEPTH_ZERO_SELF_SIGNED_CERT',
  'CERT_HAS_EXPIRED', 'ERR_TLS_CERT_ALTNAME_INVALID',
])

interface Dependencies {
  readonly accountId?: string
  readCredential(): Promise<unknown>
  fetch?: typeof globalThis.fetch
  now?: () => number
  getCACertificates?: (type: 'default' | 'system') => string[]
  createDispatcher?: (options: Agent.Options) => Agent
}
interface Auth { readonly grant: GitHubCopilotOAuthCredential; readonly key: string }
class UsageFailure extends Error {
  constructor(readonly diagnostic: CopilotUsageDiagnostic) { super(diagnostic) }
}
function failure(diagnostic: CopilotUsageDiagnostic): never { throw new UsageFailure(diagnostic) }
function certificateFailure(error: unknown): boolean {
  if (!(error instanceof TypeError) || !('cause' in error)) return false
  const cause = error.cause
  return typeof cause === 'object' && cause !== null && 'code' in cause
    && typeof cause.code === 'string' && CERTIFICATE_FAILURES.has(cause.code)
}

async function readBody(response: Response, signal: AbortSignal): Promise<unknown> {
  const length = response.headers.get('content-length')
  if (length !== null && (!/^\d+$/u.test(length) || Number(length) > MAX_BODY_BYTES)) {
    void response.body?.cancel().catch(() => undefined)
    failure('COPILOT_USAGE_BODY_TOO_LARGE')
  }
  if (!response.body) failure('COPILOT_USAGE_INVALID_RESPONSE')
  const reader = response.body.getReader(), chunks: Uint8Array[] = []
  const cancel = () => { void reader.cancel().catch(() => undefined) }
  signal.addEventListener('abort', cancel, { once: true })
  if (signal.aborted) cancel()
  let size = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      size += next.value.byteLength
      if (size > MAX_BODY_BYTES) {
        void reader.cancel().catch(() => undefined)
        failure('COPILOT_USAGE_BODY_TOO_LARGE')
      }
      chunks.push(next.value)
    }
  } finally { signal.removeEventListener('abort', cancel); reader.releaseLock() }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) }
  catch { failure('COPILOT_USAGE_INVALID_RESPONSE') }
}

/** One Host-owned, memory-only account cache. No auth renewal, persistence or model transport. */
export class CopilotUsageSource {
  private readonly fetcher: typeof globalThis.fetch
  private readonly now: () => number
  private dispatcher: Agent | undefined
  private generation = 0
  private disposed = false
  private key: string | undefined
  private cached: CopilotUsageView | undefined
  private last: CopilotUsageView | undefined
  private nextRefreshAt = 0
  private failureUntil = 0
  private flight: { generation: number; promise: Promise<CopilotUsageView>; abort: AbortController } | undefined

  constructor(private readonly dependencies: Dependencies) {
    this.fetcher = dependencies.fetch ?? globalThis.fetch
    this.now = dependencies.now ?? Date.now
  }
  invalidate(): void {
    this.generation++
    this.flight?.abort.abort()
    this.flight = undefined
    this.key = undefined
    this.cached = undefined
    this.last = undefined
    this.nextRefreshAt = 0
    this.failureUntil = 0
  }
  dispose(): Promise<void> {
    this.disposed = true
    this.invalidate()
    const dispatcher = this.dispatcher
    this.dispatcher = undefined
    return dispatcher?.destroy() ?? Promise.resolve()
  }
  get(): Promise<CopilotUsageView> { return this.load(false) }
  refresh(): Promise<CopilotUsageView> { return this.load(true) }

  private active(generation: number): void {
    if (this.disposed) failure('COPILOT_USAGE_DISPOSED')
    if (generation !== this.generation) failure('COPILOT_USAGE_ACCOUNT_CHANGED')
  }
  private async readAuth(generation: number): Promise<Auth> {
    this.active(generation)
    let stored: unknown
    try { stored = await this.dependencies.readCredential() }
    catch { this.active(generation); failure('COPILOT_USAGE_CREDENTIALS_UNAVAILABLE') }
    this.active(generation)
    if (stored === undefined) failure('COPILOT_USAGE_SIGNED_OUT')
    let grant: GitHubCopilotOAuthCredential
    try { grant = normalizeGitHubCopilotOAuthCredential(stored) }
    catch { failure('COPILOT_USAGE_INVALID_GRANT') }
    if (grant.enterpriseUrl !== undefined) failure('COPILOT_USAGE_ENTERPRISE_UNSUPPORTED')
    return { grant, key: copilotAccountKey(grant) }
  }
  private async assertCurrent(key: string, generation: number): Promise<void> {
    const current = await this.readAuth(generation)
    if (current.key !== key) failure('COPILOT_USAGE_ACCOUNT_CHANGED')
  }
  private diagnostic(error: unknown): CopilotUsageDiagnostic {
    return error instanceof UsageFailure ? error.diagnostic : 'COPILOT_USAGE_NETWORK'
  }
  private quotaDispatcher(): Agent {
    if (this.dispatcher) return this.dispatcher
    try {
      const certificates = this.dependencies.getCACertificates ?? getCACertificates
      const defaults = certificates('default')
      const system = certificates('system')
      if (!Array.isArray(defaults) || !Array.isArray(system) || system.length === 0
        || [...defaults, ...system].some(ca => typeof ca !== 'string' || ca.length === 0)) {
        failure('COPILOT_USAGE_TRUST_UNAVAILABLE')
      }
      const ca = [...new Set([...defaults, ...system])]
      this.dispatcher = (this.dependencies.createDispatcher ?? (options => new Agent(options)))({
        connect: { ca, rejectUnauthorized: true },
      })
      if (!this.dispatcher) failure('COPILOT_USAGE_TRUST_UNAVAILABLE')
      return this.dispatcher
    } catch {
      failure('COPILOT_USAGE_TRUST_UNAVAILABLE')
    }
  }
  private async load(force: boolean): Promise<CopilotUsageView> {
    let generation = this.generation
    let auth: Auth
    try { auth = await this.readAuth(generation); this.active(generation) }
    catch (error) {
      if (generation === this.generation) this.invalidate()
      return unavailableCopilotUsage(this.diagnostic(error))
    }
    if (this.key !== undefined && this.key !== auth.key) {
      this.invalidate()
      generation = this.generation
    }
    this.key = auth.key
    if (this.flight) {
      const result = await this.flight.promise
      if (this.disposed) return unavailableCopilotUsage('COPILOT_USAGE_DISPOSED')
      if (generation !== this.generation) return unavailableCopilotUsage('COPILOT_USAGE_ACCOUNT_CHANGED')
      return { ...result }
    }
    const now = this.now()
    if (this.last && now < this.failureUntil) return { ...this.last }
    if (this.cached && ((!force && now - this.cached.observedAt! < TTL_MS) || now < this.nextRefreshAt)) {
      return { ...this.cached }
    }
    const abort = new AbortController()
    const promise = this.request(auth, generation, abort)
    this.flight = { generation, promise, abort }
    try { return { ...await promise } }
    finally { if (this.flight?.promise === promise) this.flight = undefined }
  }
  private async fetchQuota(auth: Auth, abort: AbortController): Promise<unknown> {
    // The refresh field is the existing GitHub session token. The Copilot access
    // token and its expiry are unrelated to this GitHub-owned endpoint.
    let response: Response
    try {
      response = await this.fetcher(COPILOT_USAGE_ENDPOINT, {
        method: 'GET', redirect: 'error', signal: abort.signal, cache: 'no-store',
        headers: { Authorization: `token ${auth.grant.refresh}`, Accept: 'application/json',
          'X-GitHub-Api-Version': '2025-04-01' },
        ...(!this.dependencies.fetch && { dispatcher: this.quotaDispatcher() }),
      })
    } catch (error) {
      if (certificateFailure(error)) failure('COPILOT_USAGE_TLS')
      throw error
    }
    if (response.redirected || (response.status >= 300 && response.status < 400)) {
      void response.body?.cancel().catch(() => undefined)
      failure('COPILOT_USAGE_REDIRECT')
    }
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined)
      if (response.status === 401 || response.status === 403) failure('COPILOT_USAGE_AUTH_REJECTED')
      if (response.status === 429) failure('COPILOT_USAGE_RATE_LIMITED')
      failure('COPILOT_USAGE_HTTP_ERROR')
    }
    return readBody(response, abort.signal)
  }
  private async request(auth: Auth, generation: number, abort: AbortController): Promise<CopilotUsageView> {
    let timer: ReturnType<typeof setTimeout> | undefined
    let removeAbort: (() => void) | undefined
    let value: CopilotUsageView | undefined
    let error: unknown
    try {
      await this.assertCurrent(auth.key, generation)
      this.active(generation)
      this.nextRefreshAt = this.now() + REFRESH_INTERVAL_MS
      const cancellation = new Promise<never>((_resolve, reject) => {
        const cancel = () => reject(new UsageFailure(this.disposed ? 'COPILOT_USAGE_DISPOSED' : 'COPILOT_USAGE_ACCOUNT_CHANGED'))
        abort.signal.addEventListener('abort', cancel, { once: true })
        removeAbort = () => abort.signal.removeEventListener('abort', cancel)
        timer = setTimeout(() => {
          reject(new UsageFailure('COPILOT_USAGE_TIMEOUT'))
          abort.abort()
        }, TIMEOUT_MS)
      })
      const raw = await Promise.race([this.fetchQuota(auth, abort), cancellation])
      value = normalizeCopilotUsage(raw, this.now())
      if (value.state === 'ready' && this.dependencies.accountId !== undefined) {
        value = { ...value, accountId: this.dependencies.accountId }
      }
    } catch (caught) { error = caught }
    finally {
      if (timer !== undefined) clearTimeout(timer)
      removeAbort?.()
    }
    // Authentication evidence is checked on success AND failure, before any
    // cache update. An old request cannot erase a newer generation's state.
    try { await this.assertCurrent(auth.key, generation); this.active(generation) }
    catch (caught) {
      if (generation === this.generation) this.invalidate()
      return unavailableCopilotUsage(this.diagnostic(caught))
    }
    if (error !== undefined) {
      const diagnostic = this.diagnostic(error)
      if (diagnostic === 'COPILOT_USAGE_ACCOUNT_CHANGED' || diagnostic === 'COPILOT_USAGE_SIGNED_OUT'
        || diagnostic === 'COPILOT_USAGE_INVALID_GRANT' || diagnostic === 'COPILOT_USAGE_ENTERPRISE_UNSUPPORTED'
        || diagnostic === 'COPILOT_USAGE_CREDENTIALS_UNAVAILABLE') {
        this.invalidate()
        return unavailableCopilotUsage(diagnostic)
      }
      const staleAllowed = ['COPILOT_USAGE_NETWORK', 'COPILOT_USAGE_TLS', 'COPILOT_USAGE_TIMEOUT',
        'COPILOT_USAGE_HTTP_ERROR', 'COPILOT_USAGE_RATE_LIMITED'].includes(diagnostic)
      if (!staleAllowed) this.cached = undefined
      value = staleAllowed && this.cached
        ? { ...this.cached, state: 'stale', diagnostic }
        : unavailableCopilotUsage(diagnostic)
    }
    if (value === undefined) return unavailableCopilotUsage('COPILOT_USAGE_INVALID_RESPONSE')
    this.last = value
    if (value.state === 'ready') {
      this.cached = value
      this.failureUntil = 0
    } else {
      if (value.state !== 'stale') this.cached = undefined
      this.failureUntil = this.now() + FAILURE_COOLDOWN_MS
    }
    return value
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context { githubCopilotUsage: GitHubCopilotUsageController }
}

export default class GitHubCopilotUsageController extends TypertRemoteService {
  private readonly accountSources = new Map<string, CopilotUsageSource>()
  private source: CopilotUsageSource
  private accountSignature: string | undefined
  private sourceInitialized = false
  constructor(ctx: Context) {
    super(ctx, 'githubCopilotUsage')
    this.source = new CopilotUsageSource({ readCredential: async () => { throw new Error('COPILOT_USAGE_CREDENTIALS_UNAVAILABLE') } })
    ctx.on('credentials/record-updated', key => {
      if (isActiveCopilotRecord(ctx, key)) this.source.invalidate()
      this.accountSources.get(key)?.invalidate()
    })
    onSettingsNamespaceUpdated(ctx, namespace => {
      if (namespace === 'github-copilot' || namespace === 'llm-pi-ai') this.source.invalidate()
    })
    ctx.effect(() => async () => {
      await this.source.dispose()
      await Promise.all([...this.accountSources.values()].map(source => source.dispose()))
      this.accountSources.clear()
    })
  }
  forAccount(binding: CopilotAccountBinding, force = false): Promise<CopilotUsageView> {
    binding.assertCurrent()
    let source = this.accountSources.get(binding.key)
    if (!source) {
      if (this.accountSources.size >= 32) throw new Error('COPILOT_SESSION_ACCOUNTS_LIMIT')
      const credentials = createGitHubCopilotCredentialStore(this.ctx, GITHUB_COPILOT_PROVIDER_ID, binding)
      source = new CopilotUsageSource({ accountId: binding.accountId,
        readCredential: () => credentials.read(GITHUB_COPILOT_PROVIDER_ID) })
      this.accountSources.set(binding.key, source)
    }
    return force ? source.refresh() : source.get()
  }
  private createSource(): CopilotUsageSource {
    // The store for every read in this cache generation is immutable. A late
    // response can never change its credential address after a selector change.
    const binding = activeCopilotBinding(this.ctx)
    this.accountSignature = binding === undefined ? undefined : `${binding.generation}:${binding.accountId}`
    const credentials = createGitHubCopilotCredentialStore(this.ctx, GITHUB_COPILOT_PROVIDER_ID, binding)
    return new CopilotUsageSource({ accountId: binding?.accountId ?? 'canonical',
      readCredential: () => credentials.read(GITHUB_COPILOT_PROVIDER_ID) })
  }
  private async current(): Promise<CopilotUsageSource> {
    const binding = activeCopilotBinding(this.ctx)
    const signature = binding === undefined ? undefined : `${binding.generation}:${binding.accountId}`
    if (signature !== this.accountSignature || !this.sourceInitialized) {
      const previous = this.source
      this.source = this.createSource()
      this.sourceInitialized = true
      await previous.dispose()
    }
    return this.source
  }
  @Remote
  async get(): Promise<CopilotUsageView> {
    try { return await (await this.current()).get() }
    catch { return unavailableCopilotUsage('COPILOT_USAGE_CREDENTIALS_UNAVAILABLE') }
  }
  @Remote
  async refresh(): Promise<CopilotUsageView> {
    try { return await (await this.current()).refresh() }
    catch { return unavailableCopilotUsage('COPILOT_USAGE_CREDENTIALS_UNAVAILABLE') }
  }
}
