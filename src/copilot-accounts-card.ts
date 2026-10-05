import { createElement as h, useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import { CopilotAccountsViewSchema } from './copilot-accounts-remote.ts'
import type { CopilotAccountsView } from './copilot-accounts-types.ts'
import { externalLinkTarget } from './external-link.ts'
import { accountPresentationChanges } from './copilot-account-presentation.ts'
import { copyAuthorizationCode } from './authorization-code-clipboard.ts'
import { AccountDropdown } from './account-dropdown.ts'

type AccountResult = { ok: true; value: CopilotAccountsView } | { ok: false; error: unknown }
export interface CopilotAccountsRemote {
  get(): Promise<AccountResult>
  refreshIdentity(): Promise<AccountResult>
  ensureIdentity(): Promise<AccountResult>
  add(): Promise<AccountResult>
  cancel(): Promise<AccountResult>
  switchAccount(accountId: string, expectedRevision: number): Promise<AccountResult>
  reauthorize(accountId: string, expectedRevision: number): Promise<AccountResult>
  removeAccount(accountId: string, expectedRevision: number): Promise<AccountResult>
}

export type CopilotAccountAddRemote = Pick<CopilotAccountsRemote, 'get' | 'add' | 'cancel'>

export function CopilotAccountAdd(props: {
  remote?: CopilotAccountAddRemote
  onChanged?: () => void
  locale?: string
}): ReactElement {
  return h(CopilotAccountControls, { ...props, addOnly: true, expanded: true })
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
  padding: '6px 10px', minHeight: 32, cursor: 'pointer', colorScheme: 'inherit',
}
const muted: CSSProperties = { color: secondary, fontSize: 13, lineHeight: 1.5, margin: '6px 0' }

const accountCopy = {
  en: {
    identityChecking: 'Checking GitHub identity…', identityUnavailable: 'GitHub account identity unavailable',
    accounts: 'Account management',
    savedAccounts: 'Manage saved authorizations',
    scope: 'Global default for new inherited turns. Credits can override this Session’s subsequent turns. Running turns, explicit Session accounts, models and conversation history stay unchanged.',
    remoteUnavailable: 'Account management is unavailable in this deployment.',
    readFailed: 'Could not read account information. Retry before changing accounts.',
    switchUnavailable: 'Account switching is temporarily unavailable. Refresh account information and try again. No running work will be cancelled.',
    routeBlocked: 'Account switching is unavailable while a native Copilot route remains configured or selected.',
    evidenceIncomplete: 'Account switching is unavailable because route or activity evidence is incomplete.',
    authorizationBusy: 'Account switching is paused while GitHub authorization is in progress.',
    verifyingBusy: 'Account switching is paused while the authorized account is being verified.',
    switchingBusy: 'An account change is already in progress.',
    technicalDetails: 'Technical details',
    currentDefault: 'Current default',
    savedAuthorization: 'Saved authorization',
    authorizationUnavailable: 'Authorization unavailable',
    identityUnavailableLabel: 'Identity unavailable',
    switch: 'Switch', reauthorize: 'Reauthorize', remove: 'Remove',
    confirmRemoveTitle: 'Confirm account removal', confirmSwitchTitle: 'Confirm account switch',
    removePrompt: (account: string) => `Remove the saved authorization for ${account}? This does not revoke access at GitHub or delete conversations.`,
    switchPrompt: (account: string) => `Use ${account} for subsequent Copilot work? Existing selected models may be unavailable, and encrypted reasoning from another account may not replay. History will not be modified.`,
    confirmRemove: 'Confirm removal', confirmSwitch: 'Confirm switch', cancel: 'Cancel',
    switchFailed: 'Could not confirm the account change. Refresh account information before retrying.',
    authorizationFailed: 'GitHub authorization did not complete. Try adding the account again.',
    authorizationUnavailableError: 'GitHub authorization is unavailable in this deployment.',
    modelsFailed: 'Could not verify the account’s available models. Try again.',
    identityFailed: 'Could not verify the GitHub account identity. Try again.',
    accountFailed: 'Could not update GitHub account information. Refresh and try again.',
    addingStarting: 'Adding account…',
    addingWaiting: 'Adding account — waiting for GitHub authorization',
    reauthorizingStarting: 'Reauthorizing account…',
    reauthorizingWaiting: 'Reauthorizing account — waiting for GitHub authorization',
    authorizationStarting: 'GitHub authorization is starting…',
    authorizationWaiting: 'Waiting for GitHub authorization…',
    verifyingAdding: 'GitHub authorization complete — verifying account identity and available models',
    verifyingReauthorizing: 'GitHub authorization complete — verifying the saved account identity and available models',
    verifying: 'GitHub authorization complete — verifying account identity and available models',
    pendingDefault: 'Your current default account will not change.',
    verificationLink: 'Open GitHub verification',
    manualUrl: 'If the browser does not open, copy this address:',
    codeLabel: 'One-time authorization code',
    copyCode: 'Copy authorization code', copyingCode: 'Copying…', copiedCodeButton: 'Code copied',
    copiedCode: 'Authorization code copied to clipboard.',
    copyFailed: 'Could not copy the code. Select it above and copy it manually.',
    cancelAdd: 'Cancel adding account', cancelReauthorize: 'Cancel reauthorization',
    cancelling: 'Cancelling…', add: 'Add GitHub account',
    refresh: 'Refresh account information', refreshing: 'Checking…', retry: 'Retry',
  },
  zh: {
    identityChecking: '正在检查 GitHub 身份…', identityUnavailable: 'GitHub 账号身份暂不可用',
    accounts: '账号管理',
    savedAccounts: '管理已保存授权',
    scope: '全局默认账号用于后续继承默认值的新 turn。Credits 可为本 Session 后续 turn 指定账号。正在运行的 turn、Session 已指定账号、模型和对话历史保持不变。',
    remoteUnavailable: '当前部署无法管理账号。',
    readFailed: '无法读取账号信息。更改账号前请重试。',
    switchUnavailable: '暂时无法切换账号。请刷新账号信息后重试；不会取消正在运行的工作。',
    routeBlocked: '原生 Copilot 路由仍在配置或被选用，因此无法切换账号。',
    evidenceIncomplete: '路由或活动证据不完整，因此无法切换账号。',
    authorizationBusy: 'GitHub 授权进行期间无法切换账号。',
    verifyingBusy: '正在验证已授权账号，暂时无法切换。',
    switchingBusy: '账号更改正在进行中。',
    technicalDetails: '诊断详情',
    currentDefault: '当前默认账号',
    savedAuthorization: '已保存授权',
    authorizationUnavailable: '授权暂不可用',
    identityUnavailableLabel: '身份暂不可用',
    switch: '切换', reauthorize: '重新授权', remove: '移除',
    confirmRemoveTitle: '确认移除账号', confirmSwitchTitle: '确认切换账号',
    removePrompt: (account: string) => `移除 ${account} 的已保存授权？这不会撤销 GitHub 端的访问权限，也不会删除对话。`,
    switchPrompt: (account: string) => `后续 Copilot 工作使用 ${account}？该账号可能没有当前已选模型，加密推理内容也可能绑定其他账号。不会修改历史记录。`,
    confirmRemove: '确认移除', confirmSwitch: '确认切换', cancel: '取消',
    switchFailed: '无法确认账号更改结果。请刷新账号信息后再试。',
    authorizationFailed: 'GitHub 授权未完成。请重新添加账号。',
    authorizationUnavailableError: '当前部署无法使用 GitHub 授权。',
    modelsFailed: '无法验证该账号可用的模型，请重试。',
    identityFailed: '无法验证 GitHub 账号身份，请重试。',
    accountFailed: '无法更新 GitHub 账号信息。请刷新后重试。',
    addingStarting: '正在添加账号…',
    addingWaiting: '正在添加账号，等待 GitHub 授权',
    reauthorizingStarting: '正在重新授权账号…',
    reauthorizingWaiting: '正在重新授权账号，等待 GitHub 授权',
    authorizationStarting: '正在启动 GitHub 授权…',
    authorizationWaiting: '等待 GitHub 授权…',
    verifyingAdding: 'GitHub 授权已完成，正在验证账号身份和可用模型',
    verifyingReauthorizing: 'GitHub 授权已完成，正在验证已保存账号的身份和可用模型',
    verifying: 'GitHub 授权已完成，正在验证账号身份和可用模型',
    pendingDefault: '当前默认账号不会更改。',
    verificationLink: '打开 GitHub 验证页',
    manualUrl: '如果浏览器未打开，请复制此网址：',
    codeLabel: '一次性授权码',
    copyCode: '复制授权码', copyingCode: '正在复制…', copiedCodeButton: '已复制授权码',
    copiedCode: '授权码已复制到剪贴板。',
    copyFailed: '无法复制授权码。请选中上方代码并手动复制。',
    cancelAdd: '取消添加账号', cancelReauthorize: '取消重新授权',
    cancelling: '正在取消…', add: '添加 GitHub 账号',
    refresh: '刷新账号信息', refreshing: '正在检查…', retry: '重试',
  },
} as const

function accountProblemMessage(code: CopilotAccountsView['diagnostic'],
  text: typeof accountCopy.en | typeof accountCopy.zh): string {
  switch (code) {
    case 'COPILOT_ACCOUNTS_ROUTE_BLOCKED': return text.routeBlocked
    case 'COPILOT_ACCOUNTS_EVIDENCE_INCOMPLETE': return text.evidenceIncomplete
    case 'COPILOT_ACCOUNTS_BUSY': return text.switchUnavailable
    case 'COPILOT_ACCOUNTS_AUTH_FAILED': return text.authorizationFailed
    case 'COPILOT_ACCOUNTS_AUTH_UNAVAILABLE': return text.authorizationUnavailableError
    case 'COPILOT_ACCOUNTS_MODELS_FAILED': return text.modelsFailed
    case 'COPILOT_ACCOUNTS_IDENTITY_UNAVAILABLE':
    case 'COPILOT_ACCOUNTS_IDENTITY_INVALID':
    case 'COPILOT_ACCOUNTS_IDENTITY_TIMEOUT':
    case 'COPILOT_ACCOUNTS_IDENTITY_TLS':
    case 'COPILOT_ACCOUNTS_IDENTITY_NETWORK':
    case 'COPILOT_ACCOUNTS_IDENTITY_AUTH_REJECTED':
    case 'COPILOT_ACCOUNTS_IDENTITY_RATE_LIMITED':
    case 'COPILOT_ACCOUNTS_IDENTITY_HTTP_ERROR':
    case 'COPILOT_ACCOUNTS_IDENTITY_CHANGED': return text.identityFailed
    case 'COPILOT_ACCOUNTS_CONFLICT':
    case 'COPILOT_ACCOUNTS_COMMIT_UNCERTAIN': return text.switchFailed
    default: return text.accountFailed
  }
}

interface AccountControlsProps {
  expanded: boolean
  refreshKey?: number
  onChanged?: () => void
  authorizationBusy?: boolean
  configured?: boolean
  accountSettings?: ReactElement
  continuationSettings?: ReactElement
  locale?: string
}

export function CopilotAccountsPanel(props: AccountControlsProps & { remote?: CopilotAccountsRemote }): ReactElement {
  return h(CopilotAccountControls, props)
}

function CopilotAccountControls(props: AccountControlsProps & (
  { addOnly: true; remote?: CopilotAccountAddRemote } | { addOnly?: false; remote?: CopilotAccountsRemote }
)): ReactElement {
  const managementRemote = props.addOnly ? undefined : props.remote
  const [view, setView] = useState<CopilotAccountsView>()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [copyState, setCopyState] = useState<'idle' | 'copying' | 'copied' | 'failed'>('idle')
  const [cancelRequested, setCancelRequested] = useState(false)
  const [authorizationIntent, setAuthorizationIntent] = useState<'add' | 'reauthorize'>()
  const [confirmation, setConfirmation] = useState<{ id: string; revision: number; remove: boolean }>()
  const [accountsOpen, setAccountsOpen] = useState(false)
  const lifetime = useRef({ active: false, generation: 0, busy: false, copyGeneration: 0 })
  const refreshed = useRef(props.refreshKey)
  const text = props.locale?.toLowerCase().startsWith('zh') ? accountCopy.zh : accountCopy.en
  useEffect(() => {
    if (!props.expanded) {
      setAccountsOpen(false)
      setConfirmation(undefined)
    }
  }, [props.expanded])
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
      if (next?.operation === undefined) {
        setAuthorizationIntent(undefined)
        setCancelRequested(false)
      }
      if (next !== undefined && changed && next.operation === undefined) props.onChanged?.()
    } catch {
      if (current()) {
        setView(undefined); setFailed(true); setAuthorizationIntent(undefined); setCancelRequested(false)
      }
    } finally {
      if (current()) { owner.busy = false; setBusy(false) }
      finishChange?.()
    }
  }, [props.onChanged])
  useEffect(() => {
    const owner = lifetime.current
    owner.active = true
    setView(undefined); setConfirmation(undefined); setBusy(false); setFailed(false)
    setCopyState('idle'); setCancelRequested(false); setAuthorizationIntent(undefined)
    if (props.remote !== undefined && !props.authorizationBusy) {
      const remote = props.remote
      void run(() => managementRemote !== undefined ? managementRemote.ensureIdentity() : remote.get())
    }
    return () => { owner.active = false; owner.generation++; owner.busy = false }
  }, [props.remote, managementRemote, run, props.authorizationBusy, props.configured])
  useEffect(() => {
    if (refreshed.current === props.refreshKey || managementRemote === undefined || busy || props.authorizationBusy) return
    refreshed.current = props.refreshKey
    setConfirmation(undefined)
    void run(() => managementRemote.get())
  }, [props.refreshKey, managementRemote, busy, props.authorizationBusy, run])
  useEffect(() => {
    if (managementRemote === undefined || props.authorizationBusy || view?.operation !== undefined) return
    const ensure = () => {
      if (document.visibilityState !== 'hidden') void run(() => managementRemote.ensureIdentity())
    }
    const timer = window.setInterval(ensure, 60_000)
    document.addEventListener('visibilitychange', ensure)
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', ensure) }
  }, [managementRemote, props.authorizationBusy, view?.operation, run])
  useEffect(() => {
    if ((view?.operation !== 'authorizing' && view?.operation !== 'verifying') || props.remote === undefined) return
    const timer = window.setTimeout(() => { void run(() => props.remote!.get(), true, false) }, 1500)
    return () => window.clearTimeout(timer)
  }, [view, props.remote, run])
  const activeNotice = view?.operation === 'authorizing' && !cancelRequested ? view.notices.at(-1) : undefined
  const noticeCode = activeNotice?.code
  useEffect(() => {
    lifetime.current.copyGeneration++
    setCopyState('idle')
  }, [noticeCode, view?.operation, cancelRequested])
  useEffect(() => () => { lifetime.current.copyGeneration++ }, [])
  const copyCode = () => {
    const code = noticeCode
    const owner = lifetime.current
    if (!owner.active || code === undefined || copyState === 'copying' || cancelRequested) return
    const generation = ++owner.copyGeneration
    setCopyState('copying')
    void copyAuthorizationCode(code).then(() => {
      if (owner.active && owner.copyGeneration === generation) setCopyState('copied')
    }, () => {
      if (owner.active && owner.copyGeneration === generation) setCopyState('failed')
    })
  }
  const cancelAuthorization = () => {
    if (props.remote === undefined || busy) return
    lifetime.current.copyGeneration++
    setCopyState('idle')
    setCancelRequested(true)
    void run(() => props.remote!.cancel(), true)
  }
  const startAdd = () => {
    setAuthorizationIntent('add')
    setCancelRequested(false)
    void run(() => props.remote!.add(), true)
  }
  const startReauthorization = (accountId: string, revision: number) => {
    if (managementRemote === undefined) return
    setAuthorizationIntent('reauthorize')
    setCancelRequested(false)
    void run(() => managementRemote.reauthorize(accountId, revision), true)
  }
  const identity = accountIdentityLabel(view)
  const activeAccount = view?.accounts.find(account => account.id === view.activeAccountId)
  const selected = confirmation === undefined ? undefined : view?.accounts.find(item => item.id === confirmation.id)
  const selectedLabel = selected?.identityState === 'ready' && selected.identity !== undefined
    ? `@${selected.identity.login}` : text.savedAuthorization
  const savedAccounts = view?.accounts ?? []
  const pending = busy || props.authorizationBusy === true || view?.operation !== undefined
  const authorizationOperation = view?.operation === 'authorizing' || view?.operation === 'verifying'
  const authorizationStatus = cancelRequested ? text.cancelling
    : view?.operation === 'authorizing'
      ? authorizationIntent === 'add' ? noticeCode === undefined ? text.addingStarting : text.addingWaiting
        : authorizationIntent === 'reauthorize' ? noticeCode === undefined ? text.reauthorizingStarting : text.reauthorizingWaiting
          : noticeCode === undefined ? text.authorizationStarting : text.authorizationWaiting
      : view?.operation === 'verifying'
        ? authorizationIntent === 'add' ? text.verifyingAdding
          : authorizationIntent === 'reauthorize' ? text.verifyingReauthorizing : text.verifying
        : view?.operation === 'switching' ? text.switchingBusy : undefined
  const switchBlocker = view !== undefined && view.switchable === false
    ? view.operation === 'authorizing' ? text.authorizationBusy
      : view.operation === 'verifying' ? text.verifyingBusy
        : view.operation === 'switching' ? text.switchingBusy
          : view.diagnostic === 'COPILOT_ACCOUNTS_ROUTE_BLOCKED' ? text.routeBlocked
            : view.diagnostic === 'COPILOT_ACCOUNTS_EVIDENCE_INCOMPLETE' ? text.evidenceIncomplete
              : view.state === 'error' ? undefined : text.switchUnavailable
    : undefined
  const control = (label: string, onClick: () => void, disabled = false) =>
    h('button', { type: 'button', style: { ...button, cursor: disabled ? 'not-allowed' : 'pointer',
      color: disabled ? 'var(--dsw-alias-label-secondary, GrayText)' : 'inherit' },
      onClick, disabled }, label)
  const savedAccountItems = savedAccounts.map(account => {
    const accountName = account.identityState === 'ready' && account.identity !== undefined
      ? `@${account.identity.login}` : text.savedAuthorization
    return h('li', { key: account.id,
      style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8,
        paddingBlock: 10, borderBottom: border } },
    h('div', { style: { minWidth: 0, flex: '1 1 140px' } },
      h('strong', null, account.identityState === 'ready' && account.identity !== undefined ? accountName
        : account.configured ? text.identityUnavailableLabel : text.authorizationUnavailable),
      h('p', { style: muted }, account.id === view?.activeAccountId ? text.currentDefault
        : account.configured ? text.savedAuthorization : text.authorizationUnavailable)),
    account.id === 'canonical' || account.id === view?.activeAccountId ? null : control(text.reauthorize, () => {
      if (props.remote !== undefined && view?.revision !== undefined) startReauthorization(account.id, view.revision)
    }, pending || view?.writable !== true || view?.switchable !== true || view?.revision === undefined),
    account.id === 'canonical' || account.id === view?.activeAccountId ? null : control(text.remove, () => {
      if (view?.revision !== undefined) setConfirmation({ id: account.id, revision: view.revision, remove: true })
    }, pending || view?.writable !== true || view?.revision === undefined))
  })
  return h('div', { 'data-copilot-accounts': '', 'aria-busy': pending, style: { minWidth: 0, overflowWrap: 'anywhere' } },
    !props.expanded ? h('p', { style: muted, role: 'status', 'aria-live': 'polite', 'data-copilot-current-account': '' },
      identity ?? (busy ? text.identityChecking : text.identityUnavailable)) : null,
    !props.expanded ? null : h('section', {
      'data-copilot-account-management': props.addOnly ? undefined : true,
      'data-copilot-account-add': props.addOnly ? true : undefined,
      'aria-label': props.addOnly ? text.add : text.accounts, style: { display: 'grid', gap: 10, marginBlock: 12 } },
      props.addOnly ? null : h('h3', { style: { margin: 0, fontSize: 16 } }, text.accounts),
      props.addOnly ? null : h('p', { style: muted }, text.scope),
      props.remote === undefined ? h('p', { role: 'status', style: muted }, text.remoteUnavailable) : null,
      failed ? h('p', { role: 'alert', style: muted }, text.readFailed) : null,
      view?.state === 'error' && view.operation === undefined && view.diagnostic !== undefined
        ? h('p', { role: 'alert', style: muted }, accountProblemMessage(view.diagnostic, text)) : null,
      switchBlocker === undefined ? null : h('p', { role: 'status', 'aria-live': 'polite', style: muted }, switchBlocker),
      authorizationStatus === undefined ? null : h('div', { role: 'status', 'aria-live': 'polite',
        'data-copilot-account-authorization': '', style: { display: 'grid', gap: 8 } },
      h('strong', null, authorizationStatus),
      authorizationOperation ? h('p', { style: muted }, text.pendingDefault) : null,
      activeNotice?.url === undefined ? null : h('a', { href: activeNotice.url, target: externalLinkTarget(), rel: 'noreferrer',
        style: { color: 'inherit', width: 'fit-content' } }, text.verificationLink),
      activeNotice?.url === undefined ? null : h('p', { style: { ...muted, overflowWrap: 'anywhere', userSelect: 'all' } },
        text.manualUrl, ' ', activeNotice.url),
      activeNotice?.code === undefined ? null : h('div', { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 } },
        h('span', { style: { color: secondary, fontSize: 13 } }, text.codeLabel),
        h('code', { 'data-copilot-account-device-code': '', style: {
          userSelect: 'all', overflowWrap: 'anywhere', fontSize: 17, fontWeight: 700, letterSpacing: '0.08em',
        } }, activeNotice.code),
        control(copyState === 'copying' ? text.copyingCode
          : copyState === 'copied' ? text.copiedCodeButton : text.copyCode,
        copyCode, copyState === 'copying' || cancelRequested)),
      copyState === 'copied' ? h('p', { role: 'status', 'aria-live': 'polite', style: muted }, text.copiedCode) : null,
      copyState === 'failed' ? h('p', { role: 'alert', 'aria-live': 'polite', style: muted }, text.copyFailed) : null,
      view?.operation === 'authorizing' ? h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8 } },
        control(cancelRequested ? text.cancelling
          : authorizationIntent === 'reauthorize' ? text.cancelReauthorize : text.cancelAdd,
        cancelAuthorization, busy || cancelRequested)) : null),
      view?.diagnostic === undefined ? null : h('details', { 'data-copilot-account-diagnostic': '', style: { color: secondary, fontSize: 13 } },
        h('summary', { style: { cursor: 'pointer' } }, text.technicalDetails),
        h('code', { style: { overflowWrap: 'anywhere' } }, view.diagnostic)),
      props.addOnly && !authorizationOperation ? control(text.add, () => {
        if (props.remote !== undefined) startAdd()
      }, pending || view?.writable !== true || view?.switchable !== true) : null,
      props.addOnly && (failed || !pending && view?.switchable === false) ? control(text.retry, () => {
        if (props.remote !== undefined) void run(() => props.remote!.get())
      }, pending || props.remote === undefined) : null,
      props.addOnly ? null : h('div', { 'data-copilot-current-account-row': true,
        style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, paddingBlock: 8, borderBottom: border } },
      h('div', { style: { minWidth: 0, flex: '1 1 180px' } },
        h('strong', { 'data-copilot-current-account': '', role: 'status', 'aria-live': 'polite' },
          identity ?? text.identityUnavailableLabel),
        h('p', { style: muted }, text.currentDefault)),
      h(AccountDropdown, { label: text.switch, open: accountsOpen, triggerStyle: button,
        disabled: pending || view?.switchable !== true || view?.revision === undefined, busy: pending,
        onOpenChange: (open: boolean) => { setAccountsOpen(open); setConfirmation(undefined) },
        options: savedAccounts.map(account => ({
          id: account.id, label: account.identityState === 'ready' && account.identity
            ? `@${account.identity.login}` : `${text.savedAuthorization}${account.id === 'canonical' ? '' : ` ${savedAccounts.indexOf(account) + 1}`} · ${text.identityUnavailableLabel}`,
          selected: account.id === view?.activeAccountId, disabled: !account.configured,
        })),
        onSelect: (id: string) => {
          setAccountsOpen(false)
          if (id !== view?.activeAccountId && view?.revision !== undefined) setConfirmation({ id, revision: view.revision, remove: false })
        },
        listAttribute: 'data-copilot-saved-accounts',
        footer: authorizationOperation ? null : control(text.add, () => {
          setAccountsOpen(false)
          if (props.remote !== undefined) startAdd()
        }, pending || view?.writable !== true || view?.switchable !== true),
      })),
      props.addOnly || confirmation === undefined ? null : h('div', { role: 'group',
        'aria-label': confirmation.remove ? text.confirmRemoveTitle : text.confirmSwitchTitle,
        style: { border, borderRadius: 8, padding: 12 } },
        h('p', { style: { ...muted, color: 'inherit', marginTop: 0 } }, confirmation.remove
          ? text.removePrompt(selectedLabel) : text.switchPrompt(selectedLabel)),
        h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8 } },
          control(confirmation.remove ? text.confirmRemove : text.confirmSwitch, () => {
            const target = confirmation
            setConfirmation(undefined)
            if (managementRemote !== undefined) void run(() => target.remove
              ? managementRemote.removeAccount(target.id, target.revision) : managementRemote.switchAccount(target.id, target.revision), true)
          }, pending),
          control(text.cancel, () => setConfirmation(undefined), pending))),
      props.addOnly ? null : h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8 } },
        control(busy ? text.refreshing : text.refresh, () => {
          if (managementRemote !== undefined) void run(() => managementRemote.refreshIdentity())
        }, pending || props.remote === undefined),
        activeAccount === undefined || activeAccount.id === 'canonical' ? null : control(text.reauthorize, () => {
          if (props.remote !== undefined && view?.revision !== undefined) startReauthorization(activeAccount.id, view.revision)
        }, pending || view?.writable !== true || view?.switchable !== true || view?.revision === undefined)),
      props.addOnly || savedAccounts.every(account => account.id === 'canonical' || account.id === view?.activeAccountId) ? null
        : h('details', null, h('summary', { style: { cursor: 'pointer' } }, text.savedAccounts),
          h('ul', { style: { listStyle: 'none', padding: 0, maxHeight: 240, overflowY: 'auto' } }, ...savedAccountItems)),
      props.accountSettings ?? null,
      props.continuationSettings ?? null))
}
