import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { createElement, useEffect, useMemo, useSyncExternalStore } from 'react'
import type { ReactElement } from 'react'
import { CopilotUsageCard } from './copilot-usage-card.ts'
import type { CopilotUsageRemote } from './copilot-usage-card.ts'
import type { CopilotAccountsRemote } from './copilot-accounts-card.ts'
import type { SessionAccountView } from './session-accounts-remote.ts'
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
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
function isSlots(value: unknown): value is Slots {
  return record(value) && typeof value.spec === 'function'
    && typeof value.inject === 'function' && typeof value.register === 'function'
}
function isRemote(value: unknown): value is CopilotUsageRemote {
  return record(value) && typeof value.get === 'function' && typeof value.refresh === 'function'
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

function Surface({ runtime, remote, accountsRemote, sessionRemote, locale, diagnostic }: {
  runtime: RuntimeProps
  remote: CopilotUsageRemote | undefined
  accountsRemote: Pick<CopilotAccountsRemote, 'get' | 'refreshIdentity' | 'ensureIdentity'> | undefined
  sessionRemote: SessionAccountRemote | undefined
  locale: LocaleReader | undefined
  diagnostic: (code: string) => void
}): ReactElement | null {
  const valid = runtime.useSession(session => record(session) && session.sessionId === runtime.sessionId
    && session.removed === false && session.openState === 'open')
  const projection = runtime.useProjection('modelSelection')
  const language = useSyncExternalStore(
    locale === undefined ? emptySubscribe : listener => locale.subscribe(listener),
    () => locale?.getLocale().active ?? 'en',
    () => 'en',
  )
  const current = effectiveCopilot(projection)
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
    remote: current.provider === 'github-copilot-preview' ? bound?.usage : remote,
    accountsRemote: current.provider === 'github-copilot-preview' ? bound?.identity : accountsRemote,
    sessionAccount: current.provider === 'github-copilot-preview' ? bound?.account : undefined, locale: language })
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
  let remote: CopilotUsageRemote | undefined
  let accountsRemote: Pick<CopilotAccountsRemote, 'get' | 'refreshIdentity' | 'ensureIdentity'> | undefined
  let sessionRemote: SessionAccountRemote | undefined
  try {
    const namespaces: unknown = ctx.remote
    const face = record(namespaces) ? namespaces.githubCopilotUsage : undefined
    if (isRemote(face)) {
      remote = face
    } else diagnostic('COPILOT_USAGE_REMOTE_UNAVAILABLE')
    const accounts = record(namespaces) ? namespaces.githubCopilotAccounts : undefined
    if (record(accounts) && typeof accounts.get === 'function' && typeof accounts.refreshIdentity === 'function'
      && typeof accounts.ensureIdentity === 'function') {
      accountsRemote = accounts as Pick<CopilotAccountsRemote, 'get' | 'refreshIdentity' | 'ensureIdentity'>
    } else diagnostic('COPILOT_ACCOUNTS_REMOTE_UNAVAILABLE')
    const session = record(namespaces) ? namespaces.githubCopilotSessionAccount : undefined
    if (isSessionRemote(session)) sessionRemote = session
    else diagnostic('COPILOT_SESSION_ACCOUNTS_REMOTE_UNAVAILABLE')
  } catch { diagnostic('COPILOT_USAGE_REMOTE_UNAVAILABLE') }
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
            runtime: props, remote, accountsRemote, sessionRemote, locale, diagnostic,
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
  }
}
