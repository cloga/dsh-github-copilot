import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { createElement, useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import type { ReactElement } from 'react'
import { CopilotUsageCard } from './copilot-usage-card.ts'
import type { CopilotUsageRemote } from './copilot-usage-card.ts'
import type { CopilotAccountsRemote } from './copilot-accounts-card.ts'
import { CopilotAccountAdd } from './copilot-accounts-card.ts'
import type { CopilotAccountAddRemote } from './copilot-accounts-card.ts'
import { accountPresentationChanges } from './copilot-account-presentation.ts'
import { SessionAccountViewSchema } from './session-accounts-remote.ts'
import type { SessionAccountView } from './session-accounts-remote.ts'
import { useSessionContinuationSwitch } from './session-continuation-ui.ts'
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
function isContinuationRemote(value: unknown): value is SessionContinuationRemote {
  return record(value) && typeof value.get === 'function' && typeof value.set === 'function'
    && (value.authorizeNext === undefined || typeof value.authorizeNext === 'function')
    && (value.defaults === undefined || typeof value.defaults === 'function')
    && (value.setDefault === undefined || typeof value.setDefault === 'function')
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

function Surface({ runtime, remote, accountsRemote, addRemote, sessionRemote, continuationRemote, locale, diagnostic }: {
  runtime: RuntimeProps
  remote: CopilotUsageRemote | undefined
  accountsRemote: Pick<CopilotAccountsRemote, 'get' | 'refreshIdentity' | 'ensureIdentity'> | undefined
  addRemote: CopilotAccountAddRemote | undefined
  sessionRemote: SessionAccountRemote | undefined
  continuationRemote: SessionContinuationRemote | undefined
  locale: LocaleReader | undefined
  diagnostic: (code: string) => void
}): ReactElement | null {
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
  const added = useCallback(() => { const finish = accountPresentationChanges.begin(); finish() }, [])
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
    sessionAccount: current.provider === 'github-copilot-preview' ? bound?.account : undefined, locale: language,
    continuation: current.provider === 'github-copilot-preview' ? continuation.content : undefined,
    beforeAccountChange: current.provider === 'github-copilot-preview' ? continuation.beforeAccountChange : undefined,
    accountActions: current.provider === 'github-copilot-preview'
      ? createElement(CopilotAccountAdd, { remote: addRemote, locale: language, onChanged: added }) : undefined,
    navigationDiagnostic: language.startsWith('zh')
      ? '当前 Core 未提供公开的 Models 直达导航。请打开设置 → 模型 → GitHub Copilot → 管理；返回后草稿与本 Session 设置不变。'
      : 'This Core has no public Models deep link. Open Settings → Models → GitHub Copilot → Manage; your draft and Session settings remain unchanged.' })
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
  let continuationRemote: SessionContinuationRemote | undefined
  let addRemote: CopilotAccountAddRemote | undefined
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
    if (record(accounts) && typeof accounts.get === 'function' && typeof accounts.add === 'function' && typeof accounts.cancel === 'function') {
      addRemote = accounts as CopilotAccountAddRemote
    } else diagnostic('COPILOT_ACCOUNT_ADD_REMOTE_UNAVAILABLE')
    const session = record(namespaces) ? namespaces.githubCopilotSessionAccount : undefined
    if (isSessionRemote(session)) sessionRemote = session
    else diagnostic('COPILOT_SESSION_ACCOUNTS_REMOTE_UNAVAILABLE')
    const continuation = record(namespaces) ? namespaces.githubCopilotSessionContinuation : undefined
    if (isContinuationRemote(continuation)) {
      continuationRemote = continuation
    } else diagnostic('COPILOT_CONTINUATION_REMOTE_UNAVAILABLE')
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
            runtime: props, remote, accountsRemote, addRemote, sessionRemote, continuationRemote, locale, diagnostic,
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
