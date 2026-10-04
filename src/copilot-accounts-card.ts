import { createElement as h, useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import { CopilotAccountsViewSchema } from './copilot-accounts-remote.ts'
import type { CopilotAccountsView } from './copilot-accounts-types.ts'
import { externalLinkTarget } from './external-link.ts'
import { accountPresentationChanges } from './copilot-account-presentation.ts'

type AccountResult = { ok: true; value: CopilotAccountsView } | { ok: false; error: unknown }
export interface CopilotAccountsRemote {
  get(): Promise<AccountResult>
  refreshIdentity(): Promise<AccountResult>
  add(): Promise<AccountResult>
  cancel(): Promise<AccountResult>
  switchAccount(accountId: string, expectedRevision: number): Promise<AccountResult>
  reauthorize(accountId: string, expectedRevision: number): Promise<AccountResult>
  removeAccount(accountId: string, expectedRevision: number): Promise<AccountResult>
}

/** Copy owned presentation fields before decoding traced Client values. */
export function accountsViewFrom(value: unknown): CopilotAccountsView | undefined {
  const record = (input: unknown): Record<string, unknown> => {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new Error('Invalid account view')
    return input as Record<string, unknown>
  }
  const fields = (input: unknown, names: readonly string[]) => {
    const source = record(input), owned: Record<string, unknown> = {}
    for (const name of names) if (source[name] !== undefined) owned[name] = source[name]
    return owned
  }
  try {
    const source = record(value)
    if (!Array.isArray(source.accounts) || !Array.isArray(source.notices)) return undefined
    const owned = fields(source, ['state', 'activeAccountId', 'revision', 'writable', 'switchable', 'operation', 'diagnostic'])
    owned.accounts = source.accounts.map(item => {
      const account = fields(item, ['id', 'configured', 'identityState'])
      const identity = record(item).identity
      if (identity !== undefined) account.identity = fields(identity, ['login', 'userId'])
      return account
    })
    owned.notices = source.notices.map(item => fields(item, ['message', 'url', 'code']))
    const parsed = CopilotAccountsViewSchema.safeParse(owned)
    return parsed.success ? parsed.data : undefined
  } catch { return undefined }
}

export function accountIdentityLabel(view: CopilotAccountsView | undefined): string | undefined {
  const account = view?.accounts.find(item => item.id === view.activeAccountId)
  return account?.configured === true && account.identityState === 'ready' && account.identity !== undefined
    ? `@${account.identity.login}` : undefined
}

const secondary = 'var(--dsw-alias-label-secondary, GrayText)'
const border = '1px solid var(--dsw-alias-border-main, color-mix(in srgb, currentColor 20%, transparent))'
const button: CSSProperties = {
  font: 'inherit', color: 'inherit', background: 'transparent', border, borderRadius: 8,
  padding: '6px 10px', minHeight: 32, cursor: 'pointer',
}
const muted: CSSProperties = { color: secondary, fontSize: 13, lineHeight: 1.5, margin: '6px 0' }

export function CopilotAccountsPanel(props: {
  remote?: CopilotAccountsRemote
  expanded: boolean
  onChanged?: () => void
  authorizationBusy?: boolean
  configured?: boolean
}): ReactElement {
  const [view, setView] = useState<CopilotAccountsView>()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [confirmation, setConfirmation] = useState<{ id: string; revision: number; remove: boolean }>()
  const lifetime = useRef({ active: false, generation: 0, busy: false })
  const run = useCallback(async (operation: () => Promise<AccountResult>, changed = false, invalidate = changed) => {
    const owner = lifetime.current
    if (!owner.active || owner.busy) return
    owner.busy = true
    const generation = ++owner.generation
    const current = () => owner.active && owner.generation === generation
    setBusy(true); setFailed(false)
    const finishChange = invalidate ? accountPresentationChanges.begin() : undefined
    try {
      const result = await operation()
      if (!current()) return
      const next = result.ok ? accountsViewFrom(result.value) : undefined
      setView(next)
      setFailed(next === undefined)
      if (next !== undefined && changed && next.operation === undefined) props.onChanged?.()
    } catch {
      if (current()) { setView(undefined); setFailed(true) }
    } finally {
      if (current()) { owner.busy = false; setBusy(false) }
      finishChange?.()
    }
  }, [props.onChanged])
  useEffect(() => {
    const owner = lifetime.current
    owner.active = true
    setView(undefined); setConfirmation(undefined); setBusy(false); setFailed(false)
    if (props.remote !== undefined && !props.authorizationBusy) void run(() => props.remote!.refreshIdentity())
    return () => { owner.active = false; owner.generation++; owner.busy = false }
  }, [props.remote, run, props.authorizationBusy, props.configured])
  useEffect(() => {
    if (view?.operation !== 'authorizing' || props.remote === undefined) return
    const timer = window.setTimeout(() => { void run(() => props.remote!.get(), true, false) }, 1500)
    return () => window.clearTimeout(timer)
  }, [view, props.remote, run])
  const identity = accountIdentityLabel(view)
  const selected = confirmation === undefined ? undefined : view?.accounts.find(item => item.id === confirmation.id)
  const selectedLabel = selected?.identityState === 'ready' && selected.identity !== undefined
    ? `@${selected.identity.login}` : 'this account'
  const pending = busy || props.authorizationBusy === true || view?.operation !== undefined
  const control = (label: string, onClick: () => void, disabled = false) =>
    h('button', { type: 'button', style: { ...button, cursor: disabled ? 'default' : 'pointer' },
      onClick, disabled }, label)
  return h('div', { 'data-copilot-accounts': '', 'aria-busy': busy, style: { minWidth: 0, overflowWrap: 'anywhere' } },
    h('p', { style: muted, role: 'status', 'aria-live': 'polite', 'data-copilot-current-account': '' },
      identity ?? (busy ? 'Checking GitHub identity…' : 'GitHub account identity unavailable')),
    !props.expanded ? null : h('div', { style: { display: 'grid', gap: 10, marginBlock: 12 } },
      h('strong', null, 'GitHub accounts'),
      h('p', { style: muted }, 'One active account for this profile. Switching affects subsequent managed Copilot requests, not saved models or conversation history.'),
      props.remote === undefined ? h('p', { role: 'status', style: muted }, 'COPILOT_ACCOUNTS_REMOTE_UNAVAILABLE · Account management is unavailable in this deployment.') : null,
      failed ? h('p', { role: 'alert', style: muted }, 'Could not read account information. Retry before changing accounts.') : null,
      view?.diagnostic === undefined ? null : h('p', { role: 'status', style: muted }, view.diagnostic),
      view?.switchable === false ? h('p', { style: muted }, 'Switching is unavailable while Copilot work is active, native Copilot routes remain configured, or route evidence is incomplete. No running work will be cancelled.') : null,
      h('ul', { style: { padding: 0, margin: 0, listStyle: 'none' } }, ...(view?.accounts ?? []).map(account =>
        h('li', { key: account.id, style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8,
          paddingBlock: 10, borderBottom: border } },
        h('div', { style: { minWidth: 0, flex: '1 1 180px' } },
          h('strong', null, account.identityState === 'ready' && account.identity !== undefined ? `@${account.identity.login}` : 'Identity unavailable'),
          h('p', { style: muted }, account.id === view?.activeAccountId ? 'Active account'
            : account.configured ? 'Saved authorization' : 'Authorization unavailable')),
        account.id === view?.activeAccountId ? null : control('Switch', () => {
          if (view?.revision !== undefined) setConfirmation({ id: account.id, revision: view.revision, remove: false })
        }, pending || view?.switchable !== true || view?.revision === undefined || !account.configured),
        account.id === 'canonical' ? null : control('Reauthorize', () => {
          if (props.remote !== undefined && view?.revision !== undefined) {
            const revision = view.revision
            void run(() => props.remote!.reauthorize(account.id, revision), true)
          }
        }, pending || view?.writable !== true || view?.switchable !== true || view?.revision === undefined),
        account.id === 'canonical' || account.id === view?.activeAccountId ? null : control('Remove', () => {
          if (view?.revision !== undefined) setConfirmation({ id: account.id, revision: view.revision, remove: true })
        }, pending || view?.writable !== true || view?.revision === undefined)))),
      confirmation === undefined ? null : h('div', { role: 'group', 'aria-label': confirmation.remove ? 'Confirm account removal' : 'Confirm account switch',
        style: { border, borderRadius: 8, padding: 12 } },
        h('p', { style: { ...muted, color: 'inherit', marginTop: 0 } }, confirmation.remove
          ? `Remove the saved authorization for ${selectedLabel}? This does not revoke access at GitHub or delete conversations.`
          : `Use ${selectedLabel} for subsequent Copilot work? Existing selected models may be unavailable, and encrypted reasoning from another account may not replay. History will not be modified.`),
        h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8 } },
          control(confirmation.remove ? 'Confirm removal' : 'Confirm switch', () => {
            const target = confirmation
            setConfirmation(undefined)
            if (props.remote !== undefined) void run(() => target.remove
              ? props.remote!.removeAccount(target.id, target.revision) : props.remote!.switchAccount(target.id, target.revision), true)
          }, pending),
          control('Cancel', () => setConfirmation(undefined), pending))),
      ...(view?.notices ?? []).map((notice, index) => h('div', { key: index, style: muted },
        h('p', null, notice.message),
        notice.url === undefined ? null : h('a', { href: notice.url, target: externalLinkTarget(), rel: 'noreferrer',
          style: { color: 'inherit' } }, 'Open GitHub verification'),
        notice.code === undefined ? null : h('p', null, h('code', { style: { userSelect: 'all' } }, notice.code)),
        notice.url === undefined ? null : h('p', { style: { userSelect: 'all' } }, notice.url))),
      h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8 } },
        view?.operation === 'authorizing' ? control('Cancel account sign-in', () => {
          if (props.remote !== undefined) void run(() => props.remote!.cancel(), true)
        }, busy) : control('Add GitHub account', () => {
          if (props.remote !== undefined) void run(() => props.remote!.add(), true)
        }, pending || view?.writable !== true || view?.switchable !== true),
        control(busy ? 'Checking…' : 'Refresh account information', () => {
          if (props.remote !== undefined) void run(() => props.remote!.refreshIdentity())
        }, pending || props.remote === undefined))))
}
