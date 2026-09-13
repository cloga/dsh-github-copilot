import type { GitHubCopilotAuthorizationView as View } from './authorization-controller.ts'

export interface CompactAccountRemote {
  status(): Promise<unknown>
  start(): Promise<unknown>
  cancel(): Promise<unknown>
  signOut(): Promise<unknown>
  discoverModels(): Promise<unknown>
  ensureModels(): Promise<unknown>
  reconcile(): Promise<unknown>
}
type Operation = 'start' | 'cancel' | 'signOut' | 'discoverModels' | 'reconcile'
export const AUTHORIZATION_POLL_INITIAL_MS = 500
export const AUTHORIZATION_POLL_MAX_MS = 2_000
export interface CompactAccountSnapshot {
  readonly view: View | undefined
  readonly checking: boolean
  readonly operation: Operation | undefined
  readonly error: string | undefined
  readonly copyState: 'idle' | 'copying' | 'copied' | 'failed'
}
const initial = (): CompactAccountSnapshot => ({ view: undefined, checking: true, operation: undefined, error: undefined, copyState: 'idle' })
const failures = {
  status: 'COPILOT_AUTHORIZATION_STATUS_FAILED', start: 'COPILOT_AUTHORIZATION_START_FAILED',
  cancel: 'COPILOT_AUTHORIZATION_CANCEL_FAILED', signOut: 'COPILOT_SIGN_OUT_FAILED',
  discoverModels: 'COPILOT_MODEL_DISCOVERY_FAILED', reconcile: 'COPILOT_CONFIGURATION_REPAIR_FAILED',
} as const

/** One mounted account's snapshot, bounded freshness check and explicit actions.
 * Initial signed-in status ensures missing/idle/stale/error metadata once or
 * joins loading metadata; the Host owns single flight and failure cooldown.
 * A confirmed user Start earns one forced discovery after sign-in completes.
 * No Remote call occurs during construction. Every await is fenced by lifetime
 * and request generation; UI disclosure changes never reconstruct this owner.
 */
export function createCompactAccount(
  remote: CompactAccountRemote,
  decode: (value: unknown) => View | undefined,
  copy: (code: string) => Promise<void>,
) {
  let state = initial()
  let active = false, lifetime = 0, generation = 0, copyGeneration = 0
  let suppressNotice = false
  let awaitingSignIn = false
  let initialStatus = true, invalidation = 0
  let statusTicket: number | undefined
  let pendingStart: Promise<boolean> | undefined
  let pendingStatus: { readonly ticket: number; readonly promise: Promise<void> } | undefined
  let pollDelayMs = AUTHORIZATION_POLL_INITIAL_MS
  let timer: ReturnType<typeof setTimeout> | undefined
  const listeners = new Set<() => void>()
  const publish = (patch: Partial<CompactAccountSnapshot>) => {
    state = { ...state, ...patch }
    for (const listener of listeners) listener()
  }
  const stopTimer = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined }
  const noticeCode = () => state.view?.inFlight ? state.view.notices.at(-1)?.code : undefined
  const current = (ticket: number) => active && generation === ticket
  const clearPrivateView = () => {
    copyGeneration++
    if (state.view === undefined) { publish({ copyState: 'idle' }); return }
    const { accountModels: _models, notices: _notices, ...view } = state.view
    publish({ view: { ...view, notices: [] }, copyState: 'idle' })
  }
  const resultView = (result: unknown) => {
    if (typeof result !== 'object' || result === null || !('ok' in result) || result.ok !== true || !('value' in result)) {
      throw new Error('Remote request failed')
    }
    const view = decode(result.value)
    if (view === undefined) throw new Error('Invalid Remote view')
    return view
  }
  const accept = (decoded: View, operation: Operation | 'status') => {
    const previousCode = noticeCode()
    const { accountModels, notices, error, ...rest } = decoded
    // Error text may originate in an older Host or undecoded transport: never
    // render it verbatim. Discovery diagnostics use the existing field-safe codec.
    const failure = error !== undefined || decoded.phase === 'error' ? 'COPILOT_AUTHORIZATION_FAILED' : undefined
    const view: View = { ...rest, notices: decoded.inFlight && !suppressNotice ? notices : [],
      ...decoded.configured && !decoded.inFlight && accountModels !== undefined ? { accountModels } : {},
      ...failure === undefined ? {} : { error: failure },
    }
    let actionError = failure
    if (view.accountModels?.state === 'error' || (operation === 'discoverModels'
      && (view.accountModels === undefined || ['unavailable', 'disposed'].includes(view.accountModels.state)))) {
      actionError = failures.discoverModels
    }
    publish({ view, error: actionError })
    if (previousCode !== noticeCode() || !decoded.inFlight) {
      copyGeneration++
      publish({ copyState: 'idle' })
    }
  }
  const completedSignIn = (view: View): boolean => {
    if (!awaitingSignIn) return false
    if (view.error !== undefined || view.phase === 'error') {
      awaitingSignIn = false
      return false
    }
    if (view.inFlight) return false
    // Consume before publishing completion: subscribers may cancel, detach or
    // start another mutation. Neither status repeats nor discovery errors rearm it.
    awaitingSignIn = false
    return view.configured
  }
  const schedulePoll = () => {
    stopTimer()
    if (!active || state.operation !== undefined || !state.view?.inFlight) return
    timer = setTimeout(() => { timer = undefined; void readStatus(false) }, pollDelayMs)
    pollDelayMs = Math.min(pollDelayMs * 2, AUTHORIZATION_POLL_MAX_MS)
  }
  const readStatus = (checking: boolean): Promise<void> => {
    if (!active || state.operation !== undefined) return Promise.resolve()
    if (pendingStatus !== undefined) {
      if (current(pendingStatus.ticket)) {
        if (checking && !state.checking) publish({ checking: true })
        return pendingStatus.promise
      }
      // Remote has no cancellation contract. Drain obsolete reads without
      // accepting their data or multiplying requests across lifetimes.
      const owner = lifetime
      return pendingStatus.promise.then(() => {
        if (active && lifetime === owner) return readStatus(checking)
      })
    }
    const ticket = ++generation, revision = invalidation
    statusTicket = ticket
    stopTimer()
    let resolve!: () => void, reject!: (error: unknown) => void
    const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail })
    const request = { ticket, promise }
    pendingStatus = request
    if (checking) {
      pollDelayMs = AUTHORIZATION_POLL_INITIAL_MS
      publish({ checking: true, error: undefined })
    }
    const execute = async () => {
      let success = false, discover = false, ensure = false
      try {
        if (!current(ticket)) return
        const result = await remote.status()
        if (!current(ticket) || revision !== invalidation) return
        const decoded = resultView(result)
        discover = completedSignIn(decoded)
        // Consume before publishing; retries, event-driven reads and surface
        // transfers cannot turn this into an automatic discovery loop.
        ensure = initialStatus && decoded.phase === 'signed-in' && decoded.configured
          && !decoded.inFlight && decoded.error === undefined
          && (decoded.accountModels === undefined || ['idle', 'stale', 'error', 'loading'].includes(decoded.accountModels.state))
        initialStatus = false
        accept(decoded, 'status')
        success = true
      } catch {
        if (current(ticket) && revision === invalidation) publish({ error: failures.status })
      } finally {
        if (pendingStatus === request) pendingStatus = undefined
        if (current(ticket)) {
          statusTicket = undefined
          if (revision !== invalidation) { await readStatus(true); return }
          publish({ checking: false })
          if (success && current(ticket)) {
            if (discover || ensure) await run('discoverModels', !discover)
            else schedulePoll()
          }
        }
      }
    }
    void execute().then(resolve, reject)
    return promise
  }
  const run = async (operation: Operation, ensure = false): Promise<void> => {
    if (!active) return
    const view = state.view
    if (operation === 'cancel') {
      if (state.operation !== 'start' && (state.operation !== undefined || !view?.inFlight)) return
    } else {
      if (state.checking || state.operation !== undefined || view?.inFlight || view === undefined) return
      if (operation === 'start' ? view.configured || !view.writable : !view.configured) return
      if (operation === 'signOut' && !view.writable) return
      if (operation === 'reconcile' && view.route?.state !== 'needs-repair') return
    }
    const ticket = ++generation, revision = invalidation
    statusTicket = undefined
    initialStatus = false
    const owner = lifetime
    const waitForStart = operation === 'cancel' ? pendingStart : undefined
    let settleStart: ((confirmed: boolean) => void) | undefined
    // Set the barrier before publishing Start: even a synchronous subscriber's
    // Cancel intent must wait for the Host to finish start's preflight.
    const thisStart = operation === 'start' ? new Promise<boolean>(resolve => { settleStart = resolve }) : undefined
    if (thisStart !== undefined) pendingStart = thisStart
    awaitingSignIn = operation === 'start'
    stopTimer()
    pollDelayMs = AUTHORIZATION_POLL_INITIAL_MS
    if (operation === 'start') suppressNotice = false
    if (operation === 'cancel') suppressNotice = true
    if (['start', 'cancel', 'signOut'].includes(operation)) clearPrivateView()
    publish({ operation, checking: false, error: undefined })
    let success = false, discover = false
    try {
      if (waitForStart !== undefined) {
        const confirmed = await waitForStart
        if (!current(ticket)) return
        // A rejected/invalid start reply cannot prove Host ordering. Do not send
        // an early Cancel and pretend that a later-created flow was cancelled.
        if (!confirmed) throw new Error('Start outcome is unconfirmed')
      }
      if (!active || lifetime !== owner) return
      const result = await remote[ensure ? 'ensureModels' : operation]()
      if (!active || lifetime !== owner || (operation !== 'start' && !current(ticket))) return
      const decoded = resultView(result)
      settleStart?.(true)
      if (!current(ticket) || revision !== invalidation) return
      if (operation === 'start') discover = completedSignIn(decoded)
      accept(decoded, operation)
      success = true
    } catch {
      settleStart?.(false)
      if (current(ticket)) {
        awaitingSignIn = false
        publish({ error: failures[operation] })
      }
    } finally {
      settleStart?.(false)
      if (thisStart !== undefined && pendingStart === thisStart) pendingStart = undefined
      if (current(ticket)) {
        publish({ operation: undefined })
        if (current(ticket) && revision !== invalidation) { await readStatus(true); return }
        // Release the Start barrier before discovery, then fence again because
        // completion subscribers can supersede this generation synchronously.
        if (success && current(ticket)) {
          if (discover) await run('discoverModels')
          else schedulePoll()
        }
      }
    }
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    attach() {
      const owner = ++lifetime
      active = true; generation++; copyGeneration++; suppressNotice = false; pendingStart = undefined; awaitingSignIn = false
      initialStatus = true; invalidation++; statusTicket = undefined
      pollDelayMs = AUTHORIZATION_POLL_INITIAL_MS
      stopTimer(); state = initial()
      void readStatus(true)
      return () => {
        if (lifetime !== owner) return
        active = false; generation++; copyGeneration++; awaitingSignIn = false; stopTimer()
      }
    },
    // Public credential/reset notifications carry no account identity. Clear
    // all presentation immediately; never infer entitlement or force discovery.
    invalidate() {
      if (!active) return
      invalidation++; copyGeneration++; initialStatus = false; stopTimer()
      publish({ view: undefined, checking: true, error: undefined, copyState: 'idle' })
      if (state.operation === undefined && statusTicket === undefined) void readStatus(true)
    },
    retryStatus: () => readStatus(true),
    start: () => run('start'), cancel: () => run('cancel'), signOut: () => run('signOut'),
    refreshModels: () => run('discoverModels'), reconcile: () => run('reconcile'),
    async copyCode(): Promise<void> {
      const code = noticeCode()
      if (!active || code === undefined || state.copyState === 'copying' || state.operation === 'cancel') return
      const ticket = ++copyGeneration
      publish({ copyState: 'copying' })
      try {
        await copy(code)
        if (active && ticket === copyGeneration && noticeCode() === code) publish({ copyState: 'copied' })
      } catch {
        if (active && ticket === copyGeneration && noticeCode() === code) publish({ copyState: 'failed' })
      }
    },
  }
}
