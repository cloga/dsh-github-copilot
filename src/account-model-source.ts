import { ACCOUNT_MODEL_CATALOG_LIMITS, normalizeAccountModelCatalog } from './account-model-catalog.ts'
import type { AccountModelCatalog } from './account-model-catalog.ts'

/** Transient native OAuth result. Only accountKey is permitted in a published snapshot. */
export interface AccountModelAuth {
  readonly apiKey: string
  /** Already trust-validated by the native credential owner; this source additionally requires an HTTPS root. */
  readonly baseURL: string
  readonly accountKey: string
  readonly availableModelIds?: readonly string[] | ReadonlySet<string>
}

export interface AccountModelSourceDependencies {
  resolveAuth(signal: AbortSignal): Promise<AccountModelAuth>
  /** Must reject if the account/token is no longer current. This callback must not perform OAuth refresh. */
  assertAuthCurrent(auth: AccountModelAuth, signal: AbortSignal): void | Promise<void>
  fetch?: typeof globalThis.fetch
  /** Public static request headers only; credential/routing/framing headers are refused. */
  headers?: Readonly<Record<string, string>>
  nativeApis?: ReadonlyMap<string, string>
  now?: () => number
  ttlMs?: number | (() => number)
  /** Failure backoff for non-force discovery only; never a background retry timer. */
  failureCooldownMs?: number | (() => number)
  timeoutMs?: number
}

export interface AccountModelSnapshot extends AccountModelCatalog {
  readonly accountKey: string
  readonly fetchedAt: number
  readonly generation: number
}
export interface AccountModelSourceView {
  readonly state: 'idle' | 'loading' | 'ready' | 'stale' | 'error' | 'disposed'
  readonly generation: number
  readonly modelCount: number
  readonly rejectedCount: number
  readonly fetchedAt?: number
  readonly error?: AccountModelSourceErrorCode
}
export interface AccountModelLoadOptions { readonly force?: boolean; readonly signal?: AbortSignal }

const codes = [
  'COPILOT_MODEL_SOURCE_INVALID_CONFIG', 'COPILOT_MODEL_SOURCE_INVALID_AUTH',
  'COPILOT_MODEL_SOURCE_AUTH_FAILED', 'COPILOT_MODEL_SOURCE_AUTH_CHANGED',
  'COPILOT_MODEL_SOURCE_FETCH_FAILED', 'COPILOT_MODEL_SOURCE_HTTP_ERROR',
  'COPILOT_MODEL_SOURCE_REDIRECTED_RESPONSE', 'COPILOT_MODEL_SOURCE_BODY_FAILED',
  'COPILOT_MODEL_SOURCE_RESPONSE_TOO_LARGE', 'COPILOT_MODEL_SOURCE_INVALID_RESPONSE',
  'COPILOT_MODEL_SOURCE_INVALID_CATALOG', 'COPILOT_MODEL_SOURCE_INVALIDATED',
  'COPILOT_MODEL_SOURCE_ABORTED', 'COPILOT_MODEL_SOURCE_TIMEOUT', 'COPILOT_MODEL_SOURCE_DISPOSED',
] as const
export type AccountModelSourceErrorCode = typeof codes[number]
export class AccountModelSourceError extends Error {
  constructor(readonly code: AccountModelSourceErrorCode) { super(code); this.name = 'AccountModelSourceError' }
}
const error = (code: AccountModelSourceErrorCode): AccountModelSourceError => new AccountModelSourceError(code)
const MAX_TIMER = 2_147_483_647
const forbiddenHeaders = ['authorization', 'proxy-authorization', 'host', 'content-length', 'cookie', 'cookie2',
  'connection', 'transfer-encoding', 'origin', 'referer', 'upgrade', 'trailer', 'te', 'expect']
const fatalCatalogCodes = new Set(['INVALID_JSON', 'INVALID_CATALOG', 'CATALOG_TOO_LARGE', 'TOO_MANY_MODELS'])
type Phase = 'auth' | 'checking' | 'http' | 'body'
interface Flight {
  readonly controller: AbortController
  promise: Promise<AccountModelSnapshot>
  phase: Phase
  epoch: number
  waiters: number
  settled: boolean
  readonly deadline: number
}

/** Race an uncooperative dependency without leaking its eventual rejection or caller abort reason. */
function abortable<T>(promise: Promise<T>, signal: AbortSignal, reason: () => AccountModelSourceError): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const finish = (operation: () => void): void => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', abort)
      operation()
    }
    const abort = (): void => finish(() => reject(reason()))
    signal.addEventListener('abort', abort, { once: true })
    promise.then(value => finish(() => resolve(value)), cause => finish(() => reject(cause)))
    if (signal.aborted) abort()
  })
}
function abortReason(signal: AbortSignal): AccountModelSourceError {
  const reason: unknown = signal.reason
  return reason instanceof AccountModelSourceError && codes.includes(reason.code)
    ? error(reason.code) : error('COPILOT_MODEL_SOURCE_ABORTED')
}
function checkSignal(signal: AbortSignal): void { if (signal.aborted) throw abortReason(signal) }
function discardBody(response: Response): void {
  try { void response.body?.cancel().catch(() => undefined) } catch { /* Cleanup must not replace a bounded failure. */ }
}
function validateAuth(value: AccountModelAuth): AccountModelAuth {
  try {
    if (typeof value?.apiKey !== 'string' || value.apiKey.trim().length === 0 || value.apiKey.length > 65_536 || /[\r\n]/u.test(value.apiKey)
      || typeof value.accountKey !== 'string' || value.accountKey.length === 0 || value.accountKey.length > 512
      || /[\p{Cc}\p{Cf}]/u.test(value.accountKey) || value.accountKey === value.apiKey
      || typeof value.baseURL !== 'string' || value.baseURL.length > 2048
      || value.baseURL !== value.baseURL.trim() || /[?#\\\r\n]/u.test(value.baseURL)) throw error('COPILOT_MODEL_SOURCE_INVALID_AUTH')
    const url = new URL(value.baseURL)
    if (url.protocol !== 'https:' || url.username !== '' || url.password !== ''
      || url.search !== '' || url.hash !== '' || url.pathname !== '/') throw error('COPILOT_MODEL_SOURCE_INVALID_AUTH')
    const available = value.availableModelIds === undefined ? undefined : [] as string[]
    if (available !== undefined) {
      for (const id of value.availableModelIds!) {
        if (available.length >= ACCOUNT_MODEL_CATALOG_LIMITS.maxModels || typeof id !== 'string'
          || id.length === 0 || id.length > ACCOUNT_MODEL_CATALOG_LIMITS.maxIdLength) throw error('COPILOT_MODEL_SOURCE_INVALID_AUTH')
        available.push(id)
      }
    }
    // A small frozen transient copy prevents externally mutated auth fields from
    // changing the HTTP request. Preserve the caller's endpoint spelling for its checks.
    return Object.freeze({ apiKey: value.apiKey, baseURL: value.baseURL, accountKey: value.accountKey,
      ...available === undefined ? {} : { availableModelIds: Object.freeze(available) } })
  } catch { throw error('COPILOT_MODEL_SOURCE_INVALID_AUTH') }
}

async function readBoundedText(response: Response, signal: AbortSignal, assertCurrent: () => void): Promise<string> {
  const limit = ACCOUNT_MODEL_CATALOG_LIMITS.maxBytes
  const length = response.headers.get('content-length')
  if (length !== null) {
    if (!/^\d{1,20}$/u.test(length)) { discardBody(response); throw error('COPILOT_MODEL_SOURCE_INVALID_RESPONSE') }
    if (Number(length) > limit) { discardBody(response); throw error('COPILOT_MODEL_SOURCE_RESPONSE_TOO_LARGE') }
  }
  if (response.body === null) throw error('COPILOT_MODEL_SOURCE_INVALID_RESPONSE')
  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const fragments: string[] = []
  let bytes = 0
  let complete = false
  try {
    while (true) {
      assertCurrent()
      const part = await abortable(reader.read(), signal, () => abortReason(signal))
      assertCurrent()
      if (part.done) break
      if (!(part.value instanceof Uint8Array)) throw error('COPILOT_MODEL_SOURCE_INVALID_RESPONSE')
      bytes += part.value.byteLength
      if (bytes > limit) throw error('COPILOT_MODEL_SOURCE_RESPONSE_TOO_LARGE')
      try { fragments.push(decoder.decode(part.value, { stream: true })) }
      catch { throw error('COPILOT_MODEL_SOURCE_INVALID_RESPONSE') }
    }
    try { fragments.push(decoder.decode()) } catch { throw error('COPILOT_MODEL_SOURCE_INVALID_RESPONSE') }
    complete = true
    return fragments.join('')
  } finally {
    if (!complete) { try { void reader.cancel().catch(() => undefined) } catch { /* Bounded cleanup. */ } }
    try { reader.releaseLock() } catch { /* A nonconforming injected reader must not strand the timeout. */ }
  }
}

/**
 * Lazy account metadata, not model-call authorization. The owner must invalidate
 * on credential/account changes and validate the account again before model wire.
 * Cache reads do not refresh OAuth or claim authority over a separate Core catalog.
 */
export class AccountModelSource {
  private readonly timeoutMs: number
  private readonly now: () => number
  private readonly fetch: typeof globalThis.fetch
  private readonly headers: Headers
  private readonly nativeApis: ReadonlyMap<string, string> | undefined
  private generation = 0
  private disposed = false
  private cache: AccountModelSnapshot | undefined
  private flight: Flight | undefined
  private failure: AccountModelSourceErrorCode | undefined
  private failedAt = 0
  private readonly operations = new Set<Flight>()

  constructor(private readonly dependencies: AccountModelSourceDependencies) {
    this.cacheDuration('ttlMs')
    this.cacheDuration('failureCooldownMs')
    this.timeoutMs = dependencies.timeoutMs ?? 10_000
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > MAX_TIMER
      || typeof dependencies.resolveAuth !== 'function' || typeof dependencies.assertAuthCurrent !== 'function') {
      throw error('COPILOT_MODEL_SOURCE_INVALID_CONFIG')
    }
    this.now = dependencies.now ?? Date.now
    this.fetch = dependencies.fetch ?? ((input, options) => globalThis.fetch(input, options))
    this.nativeApis = dependencies.nativeApis === undefined ? undefined : new Map(dependencies.nativeApis)
    try {
      this.headers = new Headers(dependencies.headers)
      if (forbiddenHeaders.some(name => this.headers.has(name))) throw error('COPILOT_MODEL_SOURCE_INVALID_CONFIG')
      let headerBytes = 0
      let headerCount = 0
      this.headers.forEach((value, name) => {
        headerBytes += name.length + value.length
        if (++headerCount > 32 || headerBytes > 16_384 || name.startsWith('proxy-') || name.startsWith('sec-')) {
          throw error('COPILOT_MODEL_SOURCE_INVALID_CONFIG')
        }
      })
      this.headers.set('Accept', 'application/json')
    } catch { throw error('COPILOT_MODEL_SOURCE_INVALID_CONFIG') }
  }

  private cacheDuration(kind: 'ttlMs' | 'failureCooldownMs'): number {
    const configured = this.dependencies[kind]
    const value = (typeof configured === 'function' ? configured() : configured) ?? (kind === 'ttlMs' ? 86_400_000 : 300_000)
    if (!Number.isSafeInteger(value) || value < 0 || value > MAX_TIMER) throw error('COPILOT_MODEL_SOURCE_INVALID_CONFIG')
    return value
  }

  /** Display only: TTL expiry is allowed, but invalidation and clock guards still apply.
   * The owner must additionally validate its account/token/entitlement proof before display. */
  readDisplaySnapshot(): AccountModelSnapshot | undefined {
    if (this.disposed || this.cache === undefined || this.cache.generation !== this.generation) return undefined
    const age = this.now() - this.cache.fetchedAt
    return Number.isFinite(age) && age >= 0 ? this.cache : undefined
  }

  readSnapshot(): AccountModelSnapshot | undefined {
    const snapshot = this.readDisplaySnapshot()
    if (snapshot === undefined || this.flight !== undefined || this.failure !== undefined) return undefined
    const age = this.now() - snapshot.fetchedAt
    return Number.isFinite(age) && age >= 0 && age < this.cacheDuration('ttlMs') ? snapshot : undefined
  }

  getView(): AccountModelSourceView {
    const snapshot = this.readDisplaySnapshot()
    const state = this.disposed ? 'disposed' : this.flight !== undefined ? 'loading'
      : this.failure !== undefined ? 'error' : this.readSnapshot() !== undefined ? 'ready' : snapshot !== undefined ? 'stale' : 'idle'
    return Object.freeze({ state, generation: this.generation,
      modelCount: snapshot?.models.length ?? 0, rejectedCount: snapshot?.rejected.length ?? 0,
      ...snapshot === undefined ? {} : { fetchedAt: snapshot.fetchedAt },
      ...this.failure === undefined || this.disposed ? {} : { error: this.failure } })
  }

  load(options: AccountModelLoadOptions = {}): Promise<AccountModelSnapshot> {
    if (this.disposed) return Promise.reject(error('COPILOT_MODEL_SOURCE_DISPOSED'))
    if (options.signal?.aborted) return Promise.reject(error('COPILOT_MODEL_SOURCE_ABORTED'))
    const cached = this.readSnapshot()
    if (this.flight === undefined && !options.force && cached !== undefined) {
      return options.signal === undefined ? Promise.resolve(cached)
        : abortable(Promise.resolve(cached), options.signal, () => error('COPILOT_MODEL_SOURCE_ABORTED'))
    }
    if (this.flight === undefined && !options.force && this.failure !== undefined) {
      const age = this.now() - this.failedAt
      const configured = this.cacheDuration('failureCooldownMs')
      const cooldown = this.failure === 'COPILOT_MODEL_SOURCE_INVALIDATED' ? Math.max(1000, configured) : configured
      if (!Number.isFinite(age) || age < 0 || age < cooldown) return Promise.reject(error(this.failure))
    }
    const flight = this.flight ?? this.start()
    flight.waiters++
    const waiting = options.signal === undefined ? flight.promise
      : abortable(flight.promise, options.signal, () => error('COPILOT_MODEL_SOURCE_ABORTED'))
    let released = false
    const release = (): void => {
      if (released) return
      released = true
      options.signal?.removeEventListener('abort', release)
      flight.waiters--
      if (flight.waiters === 0 && !flight.settled) {
        if (this.flight === flight) { this.flight = undefined; this.generation++; this.failure = undefined }
        flight.controller.abort(error('COPILOT_MODEL_SOURCE_ABORTED'))
      }
    }
    options.signal?.addEventListener('abort', release, { once: true })
    if (options.signal?.aborted) release()
    return waiting.then(value => { release(); return value }, cause => { release(); throw cause })
  }

  /** Revoke definitively rejected metadata and back off passive reuse/recovery. */
  rejectSnapshot(snapshot: AccountModelSnapshot): boolean {
    if (this.readDisplaySnapshot() !== snapshot) return false
    this.invalidate()
    this.failure = 'COPILOT_MODEL_SOURCE_INVALIDATED'
    this.failedAt = this.now()
    return true
  }

  invalidate(): void {
    if (this.disposed) return
    this.generation++
    this.cache = undefined
    this.failure = undefined
    // Native OAuth refresh may itself publish a credential notification. Rebase
    // after resolveAuth and validate that result instead of cancelling it forever.
    if (this.flight !== undefined && this.flight.phase !== 'auth') {
      const flight = this.flight
      this.flight = undefined
      flight.controller.abort(error('COPILOT_MODEL_SOURCE_INVALIDATED'))
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.generation++
    this.cache = undefined
    this.failure = undefined
    this.flight = undefined
    for (const flight of this.operations) flight.controller.abort(error('COPILOT_MODEL_SOURCE_DISPOSED'))
  }

  private start(): Flight {
    // Keep the current generation for display until replacement succeeds. Fresh
    // reads are blocked throughout this attempt, including after a failed force load.
    this.failure = undefined
    const flight: Flight = { controller: new AbortController(), phase: 'auth', epoch: this.generation,
      waiters: 0, settled: false, promise: undefined!, deadline: performance.now() + this.timeoutMs }
    this.flight = flight
    this.operations.add(flight)
    const timer = setTimeout(() => flight.controller.abort(error('COPILOT_MODEL_SOURCE_TIMEOUT')), this.timeoutMs)
    flight.promise = this.perform(flight).catch((cause: unknown) => {
      const code: AccountModelSourceErrorCode = flight.controller.signal.aborted ? abortReason(flight.controller.signal).code
        : cause instanceof AccountModelSourceError && codes.includes(cause.code) ? cause.code
          : flight.phase === 'auth' ? 'COPILOT_MODEL_SOURCE_AUTH_FAILED'
            : flight.phase === 'checking' ? 'COPILOT_MODEL_SOURCE_AUTH_CHANGED'
              : flight.phase === 'body' ? 'COPILOT_MODEL_SOURCE_BODY_FAILED' : 'COPILOT_MODEL_SOURCE_FETCH_FAILED'
      if (this.flight === flight && !this.disposed) {
        this.failure = code
        this.failedAt = this.now()
        if (flight.phase === 'auth' || flight.phase === 'checking') this.cache = undefined
      }
      throw error(code)
    }).finally(() => {
      clearTimeout(timer)
      flight.settled = true
      this.operations.delete(flight)
      if (this.flight === flight) this.flight = undefined
    })
    return flight
  }

  private current(flight: Flight): void {
    if (!flight.controller.signal.aborted && performance.now() >= flight.deadline) {
      flight.controller.abort(error('COPILOT_MODEL_SOURCE_TIMEOUT'))
    }
    checkSignal(flight.controller.signal)
    if (this.disposed) throw error('COPILOT_MODEL_SOURCE_DISPOSED')
    if (this.flight !== flight || flight.epoch !== this.generation) throw error('COPILOT_MODEL_SOURCE_INVALIDATED')
  }

  private async validateCurrent(auth: AccountModelAuth, flight: Flight): Promise<void> {
    flight.phase = 'checking'
    this.current(flight)
    await abortable(Promise.resolve().then(() => {
      this.current(flight)
      return this.dependencies.assertAuthCurrent(auth, flight.controller.signal)
    }),
      flight.controller.signal, () => abortReason(flight.controller.signal))
    this.current(flight)
  }

  private async perform(flight: Flight): Promise<AccountModelSnapshot> {
    const signal = flight.controller.signal
    const auth = validateAuth(await abortable(Promise.resolve().then(() => {
      checkSignal(signal)
      return this.dependencies.resolveAuth(signal)
    }), signal, () => abortReason(signal)))
    checkSignal(signal)
    flight.epoch = this.generation
    if (this.cache?.accountKey !== auth.accountKey) this.cache = undefined
    await this.validateCurrent(auth, flight)
    const headers = new Headers(this.headers)
    headers.set('Authorization', `Bearer ${auth.apiKey}`)
    flight.phase = 'http'
    const pending = Promise.resolve().then(() => {
      this.current(flight)
      return this.fetch(`${new URL(auth.baseURL).origin}/models`, { method: 'GET', headers, redirect: 'error', credentials: 'omit', cache: 'no-store', signal })
    }).then(response => { if (signal.aborted) discardBody(response); return response })
    const response = await abortable(pending, signal, () => abortReason(signal))
    let bodyHandled = false
    try {
      this.current(flight)
      if (response.redirected) throw error('COPILOT_MODEL_SOURCE_REDIRECTED_RESPONSE')
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) this.cache = undefined
        throw error('COPILOT_MODEL_SOURCE_HTTP_ERROR')
      }
      await this.validateCurrent(auth, flight)
      flight.phase = 'body'
      bodyHandled = true
      const text = await readBoundedText(response, signal, () => this.current(flight))
      this.current(flight)
      const catalog = normalizeAccountModelCatalog(text, {
        ...this.nativeApis === undefined ? {} : { nativeApis: this.nativeApis },
        ...auth.availableModelIds === undefined ? {} : { availableModelIds: new Set(auth.availableModelIds) },
      })
      if (catalog.rejected.some(item => item.id === undefined && fatalCatalogCodes.has(item.code))) throw error('COPILOT_MODEL_SOURCE_INVALID_CATALOG')
      await this.validateCurrent(auth, flight)
      const fetchedAt = this.now()
      if (!Number.isSafeInteger(fetchedAt) || fetchedAt < 0) throw error('COPILOT_MODEL_SOURCE_INVALID_CONFIG')
      this.current(flight)
      flight.epoch = ++this.generation
      const snapshot: AccountModelSnapshot = Object.freeze({ ...catalog, accountKey: auth.accountKey, fetchedAt, generation: flight.epoch })
      this.cache = snapshot
      return snapshot
    } finally { if (!bodyHandled) discardBody(response) }
  }
}

export function createAccountModelSource(dependencies: AccountModelSourceDependencies): AccountModelSource {
  return new AccountModelSource(dependencies)
}
