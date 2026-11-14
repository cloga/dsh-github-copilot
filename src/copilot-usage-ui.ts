import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { createElement, useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import type { ReactElement } from 'react'
import { CopilotUsageCard } from './copilot-usage-card.ts'
import type { CopilotUsageRemote } from './copilot-usage-card.ts'
import { SessionAccountViewSchema } from './session-accounts-remote.ts'
import type { SessionAccountView } from './session-accounts-remote.ts'
import { isSessionContinuationRemote, useSessionContinuationSwitch } from './session-continuation-ui.ts'
import type { SessionContinuationRemote } from './session-continuation-ui.ts'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { CopilotUsageView } from './copilot-usage-types.ts'

interface SessionAccountRemote {
  get(id: string): Promise<RemoteResult<SessionAccountView>>
  set(id: string, account: string | null, revision: number): Promise<RemoteResult<SessionAccountView>>
  refreshIdentity(id: string): Promise<RemoteResult<SessionAccountView>>
  ensureIdentity(id: string): Promise<RemoteResult<SessionAccountView>>
  usage(id: string): Promise<RemoteResult<CopilotUsageView>>
  refreshUsage(id: string): Promise<RemoteResult<CopilotUsageView>>
}

const slot = 'conversation.composer.dock'
const noop = () => {}
const emptySubscribe = () => noop
interface LocaleReader { getLocale(): { active: string }; subscribe(listener: () => void): () => void }
interface Slots {
  spec(name: string): { kind: string; scope: string } | undefined
  inject(name: string, callback: () => () => void): () => void
  register(options: { name: string; id: string; order: number }, component: (props: Record<string, unknown>) => ReactElement | null): () => void
}
interface RuntimeProps {
  sessionId: string
  // Public SnapshotSelectorHook requires a selector; it is not a snapshot getter.
  useSession<T>(selector: (snapshot: unknown) => T): T
  useProjection(key: 'modelSelection'): unknown
}
interface ManagedRemotes {
  readonly session: SessionAccountRemote | undefined
  readonly continuation: SessionContinuationRemote | undefined
}
interface ManagedRemoteSource {
  getSnapshot(): ManagedRemotes
  subscribe(listener: () => void): () => void
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
function isSlots(value: unknown): value is Slots {
  return record(value) && typeof value.spec === 'function'
    && typeof value.inject === 'function' && typeof value.register === 'function'
}
function isNativeRemote(value: unknown): value is {
  getNative: CopilotUsageRemote['get']; refreshNative: CopilotUsageRemote['refresh']
} {
  return record(value) && typeof value.getNative === 'function' && typeof value.refreshNative === 'function'
}
function isSessionRemote(value: unknown): value is SessionAccountRemote {
  return record(value) && typeof value.get === 'function' && typeof value.set === 'function'
    && typeof value.refreshIdentity === 'function' && typeof value.ensureIdentity === 'function'
    && typeof value.usage === 'function' && typeof value.refreshUsage === 'function'
}
function isLocale(value: unknown): value is LocaleReader {
  return record(value) && typeof value.getLocale === 'function' && typeof value.subscribe === 'function'
}
function isRuntime(value: unknown): value is RuntimeProps {
  return record(value) && typeof value.sessionId === 'string' && value.sessionId !== ''
    && typeof value.useSession === 'function' && typeof value.useProjection === 'function'
}
function selection(value: unknown): value is { provider: string; model: string } {
  return record(value) && typeof value.provider === 'string' && value.provider.trim() !== ''
    && typeof value.model === 'string' && value.model.trim() !== ''
}

/**
 * Verified alpha.2 wire projection: next = pending ?? lastUsed; lastUsed is
 * request/header.config. Never consult the future global default or the model
 * catalog. A blank Session without explicit selection waits for that evidence.
 */
function effectiveCopilot(projection: unknown): { provider: string; model: string } | undefined {
  if (!record(projection) || !(projection.lastUsed === null || selection(projection.lastUsed))
    || !(projection.next === null || selection(projection.next))) return undefined
  const next = projection.next
  if (!selection(next)) return undefined
  return next.provider === 'github-copilot' || next.provider === 'github-copilot-preview' ? next : undefined
}

function Surface({ runtime, nativeRemote, managedRemotes, locale, diagnostic }: {
  runtime: RuntimeProps
  nativeRemote: CopilotUsageRemote | undefined
  managedRemotes: ManagedRemoteSource
  locale: LocaleReader | undefined
  diagnostic: (code: string) => void
}): ReactElement | null {
  const { session: sessionRemote, continuation: continuationRemote } = useSyncExternalStore(
    managedRemotes.subscribe, managedRemotes.getSnapshot, managedRemotes.getSnapshot,
  )
  const valid = runtime.useSession(session => record(session) && session.sessionId === runtime.sessionId
    && session.removed === false && session.openState === 'open')
  const projection = runtime.useProjection('modelSelection')
  const running = runtime.useSession(value => !record(value) || value.running !== false)
  const language = useSyncExternalStore(
    locale === undefined ? emptySubscribe : listener => locale.subscribe(listener),
    () => locale?.getLocale().active ?? 'en',
    () => 'en',
  )
  const current = effectiveCopilot(projection)
  const changesAccount = useCallback(async (accountId: string | null) => {
    const result = await sessionRemote?.get(runtime.sessionId)
    const parsed = result?.ok ? SessionAccountViewSchema.safeParse(result.value) : undefined
    if (!parsed?.success) throw new Error('COPILOT_SESSION_ACCOUNTS_REMOTE_UNAVAILABLE')
    return (accountId ?? parsed.data.globalAccountId) !== parsed.data.accountId
  }, [sessionRemote, runtime.sessionId])
  const continuation = useSessionContinuationSwitch({ sessionId: runtime.sessionId,
    remote: continuationRemote, locale: language, changesAccount, running })
  const bound = useMemo(() => {
    if (sessionRemote === undefined) return undefined
    const id = runtime.sessionId
    return {
      usage: { get: () => sessionRemote.usage(id), refresh: () => sessionRemote.refreshUsage(id) },
      identity: {
        get: async () => {
          const result = await sessionRemote.get(id)
          return result.ok ? { ok: true as const, value: result.value.accounts } : result
        },
        refreshIdentity: async () => {
          const result = await sessionRemote.refreshIdentity(id)
          return result.ok ? { ok: true as const, value: result.value.accounts } : result
        },
        ensureIdentity: async () => {
          const result = await sessionRemote.ensureIdentity(id)
          return result.ok ? { ok: true as const, value: result.value.accounts } : result
        },
      },
      account: { get: () => sessionRemote.get(id),
        set: (account: string | null, revision: number) => sessionRemote.set(id, account, revision) },
    }
  }, [sessionRemote, runtime.sessionId])
  useEffect(() => {
    if (projection === undefined) diagnostic('COPILOT_USAGE_MODEL_PROJECTION_UNAVAILABLE')
  }, [projection, diagnostic])
  if (!valid || current === undefined) return null
  const contextKey = JSON.stringify([runtime.sessionId, current.provider, current.model])
  return createElement(CopilotUsageCard, { key: contextKey, contextKey,
    remote: current.provider === 'github-copilot-preview' ? bound?.usage : nativeRemote,
    accountsRemote: current.provider === 'github-copilot-preview' ? bound?.identity : undefined,
    sessionAccount: current.provider === 'github-copilot-preview' ? bound?.account : undefined, locale: language,
    continuation: current.provider === 'github-copilot-preview' ? continuation.content : undefined,
    beforeAccountChange: current.provider === 'github-copilot-preview' ? continuation.beforeAccountChange : undefined,
  })
}

/** Public additive dock only; native composer, ContextMeter and other features stay owned by Core. */
export function registerCopilotUsageUi(ctx: Context): () => void {
  const diagnosed = new Set<string>()
  const diagnostic = (code: string) => {
    if (!diagnosed.has(code)) { diagnosed.add(code); ctx.logger.warn(`[github-copilot] ${code}`) }
  }
  const candidate: unknown = ctx.slots
  if (!isSlots(candidate)) {
    diagnostic('COPILOT_USAGE_SLOT_UNAVAILABLE')
    return noop
  }
  const slots = candidate
  // Resolve a traced Remote once, not on each render or Session-model update.
  let nativeRemote: CopilotUsageRemote | undefined
  let sessionRemote: SessionAccountRemote | undefined
  let continuationRemote: SessionContinuationRemote | undefined
  try {
    const namespaces: unknown = ctx.remote
    const face = record(namespaces) ? namespaces.githubCopilotUsage : undefined
    if (isNativeRemote(face)) nativeRemote = { get: () => face.getNative(), refresh: () => face.refreshNative() }
    else diagnostic('COPILOT_USAGE_NATIVE_REMOTE_UNAVAILABLE')
  } catch { diagnostic('COPILOT_USAGE_REMOTE_UNAVAILABLE') }
  const listeners = new Set<() => void>()
  let managedSnapshot: ManagedRemotes = { session: undefined, continuation: undefined }
  const publishManaged = () => {
    if (managedSnapshot.session === sessionRemote && managedSnapshot.continuation === continuationRemote) return
    managedSnapshot = { session: sessionRemote, continuation: continuationRemote }
    for (const listener of listeners) listener()
  }
  const managedRemotes: ManagedRemoteSource = {
    getSnapshot: () => managedSnapshot,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
  const sessionInjection = ctx.inject(['remote.githubCopilotSessionAccount'], scope => {
    const candidate: unknown = scope.remote.githubCopilotSessionAccount
    sessionRemote = isSessionRemote(candidate) ? candidate : undefined
    if (sessionRemote === undefined) diagnostic('COPILOT_SESSION_ACCOUNTS_REMOTE_UNAVAILABLE')
    publishManaged()
    return () => { sessionRemote = undefined; publishManaged() }
  })
  const continuationInjection = ctx.inject(['remote.githubCopilotSessionContinuation'], scope => {
    const candidate: unknown = scope.remote.githubCopilotSessionContinuation
    continuationRemote = isSessionContinuationRemote(candidate) ? candidate : undefined
    if (continuationRemote === undefined) diagnostic('COPILOT_CONTINUATION_REMOTE_UNAVAILABLE')
    publishManaged()
    return () => { continuationRemote = undefined; publishManaged() }
  })
  const localeCandidate: unknown = ctx.get('locale')
  const locale = isLocale(localeCandidate) ? localeCandidate : undefined
  let active = true
  let remove: (() => void) | undefined
  let injection = noop
  try {
    if (slots.spec(slot) === undefined) diagnostic('COPILOT_USAGE_SLOT_UNAVAILABLE')
    injection = slots.inject(slot, () => {
      if (!active) return noop
      const spec = slots.spec(slot)
      if (spec?.kind !== 'list' || spec.scope !== 'session') {
        diagnostic('COPILOT_USAGE_SLOT_UNAVAILABLE')
        return noop
      }
      try {
        const dispose = slots.register({ name: slot, id: 'github-copilot-usage', order: 20 }, props => {
          if (!isRuntime(props)) {
            diagnostic('COPILOT_USAGE_SESSION_RUNTIME_UNAVAILABLE')
            return null
          }
          return createElement(Surface, {
            runtime: props, nativeRemote, managedRemotes, locale, diagnostic,
          })
        })
        let removed = false
        const cleanup = () => { if (!removed) { removed = true; dispose() } }
        remove = cleanup
        return cleanup
      } catch { diagnostic('COPILOT_USAGE_SLOT_UNAVAILABLE'); return noop }
    })
  } catch { diagnostic('COPILOT_USAGE_SLOT_UNAVAILABLE') }
  return () => {
    if (!active) return
    active = false
    injection()
    remove?.()
    void sessionInjection.dispose()
    void continuationInjection.dispose()
    listeners.clear()
  }
}
