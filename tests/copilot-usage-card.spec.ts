// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CopilotUsageCard } from '../src/copilot-usage-card.ts'
import type { CopilotUsageRemote, CopilotUsageCardProps } from '../src/copilot-usage-card.ts'
import type { CopilotUsageView } from '../src/copilot-usage-types.ts'
import type { CopilotAccountsRemote } from '../src/copilot-accounts-card.ts'
import type { CopilotAccountsView } from '../src/copilot-accounts-types.ts'
import { accountPresentationChanges } from '../src/copilot-account-presentation.ts'
import type { SessionAccountView } from '../src/session-accounts-remote.ts'

const cleanups: Array<() => void> = []
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }) })
afterEach(async () => {
  await act(async () => { cleanups.splice(0).forEach(dispose => dispose()) })
  vi.useRealTimers()
  vi.restoreAllMocks()
  document.body.replaceChildren()
})
const view = (extra: Partial<CopilotUsageView> = {}): CopilotUsageView => ({
  state: 'ready', billing: 'credits', budget: 'individual', used: 42.25, remaining: 57.75,
  limit: 100, percentUsed: 42.25, observedAt: 1_800_000_000_000, ...extra,
})
const ok = (value: CopilotUsageView) => ({ ok: true as const, value })
function remote(value = view()) {
  return { get: vi.fn(async () => ok(value)), refresh: vi.fn(async () => ok(value)) }
}
async function mount(props: CopilotUsageCardProps = { remote: remote(), contextKey: 'a' }) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  let mounted = true
  const render = async (next = props) => { props = next; await act(async () => { root.render(createElement(CopilotUsageCard, props)) }) }
  const unmount = () => { if (mounted) { root.unmount(); mounted = false } }
  cleanups.push(unmount)
  await render()
  return { render, unmount, container }
}
function trigger() { return document.querySelector<HTMLButtonElement>('[data-copilot-usage-trigger]')! }
function follow() { return document.querySelector<HTMLInputElement>('[data-copilot-follow-global]')! }
function button(text: string) {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(node => node.textContent === text)!
}
async function click(element: HTMLElement) { await act(async () => { element.click() }) }
function text() { return document.body.textContent ?? '' }
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

function accountSelectorFixture(extra: Partial<SessionAccountView> = {}) {
  let selection: SessionAccountView = {
    source: 'global', accountId: 'canonical', globalAccountId: 'canonical',
    accounts: {
      state: 'ready', activeAccountId: 'canonical', revision: 7, writable: true, switchable: true, notices: [],
      accounts: Array.from({ length: 24 }, (_, index) => ({
        id: index === 0 ? 'canonical' : `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        configured: true, identityState: 'ready',
        identity: { login: `demo-account-${String(index + 1).padStart(2, '0')}`, userId: index + 1 },
      })),
    },
    ...extra,
  }
  const get = vi.fn<NonNullable<CopilotUsageCardProps['sessionAccount']>['get']>(
    async () => ({ ok: true as const, value: selection }))
  const set = vi.fn(async (accountId: string | null, revision: number) => {
    expect(revision).toBe(selection.accounts.revision)
    selection = { ...selection, source: accountId === null ? 'global' : 'session',
      accountId: accountId ?? selection.globalAccountId,
      accounts: { ...selection.accounts, activeAccountId: accountId ?? selection.globalAccountId, revision: revision + 1 } }
    return { ok: true as const, value: selection }
  })
  const quota = vi.fn(async () => ok(view({ accountId: selection.accountId })))
  const identity = vi.fn(async () => ({ ok: true as const, value: selection.accounts }))
  const props: CopilotUsageCardProps = {
    contextKey: 'selector', remote: { get: quota, refresh: quota }, sessionAccount: { get, set },
    accountsRemote: { get: identity, ensureIdentity: identity, refreshIdentity: identity },
  }
  return { props, get, set, quota, selection: () => selection }
}

describe('Copilot account usage chip', () => {
  it('rereads the shared revision after consent writes before saving the captured account target', async () => {
    const fixture = accountSelectorFixture()
    const target = fixture.selection().accounts.accounts[23]!.id
    const beforeAccountChange = vi.fn(async () => {
      Object.assign(fixture.selection().accounts, { revision: 8 })
      return true
    })
    await mount({ ...fixture.props, beforeAccountChange })
    await click(trigger())
    await click(button('Switch account'))
    await click(button('@demo-account-24'))
    expect(beforeAccountChange).toHaveBeenCalledExactlyOnceWith(target, expect.any(AbortSignal))
    expect(fixture.set).toHaveBeenCalledExactlyOnceWith(target, 8)
    expect(fixture.get).toHaveBeenCalledTimes(3)
    expect(fixture.get.mock.invocationCallOrder[1]).toBeLessThan(fixture.set.mock.invocationCallOrder[0]!)
  })

  it.each(['error', 'invalid', 'missing-revision', 'throw'] as const)('does not save when the post-consent reread returns %s', async failure => {
    const fixture = accountSelectorFixture()
    const beforeAccountChange = vi.fn(async () => {
      if (failure === 'throw') fixture.get.mockRejectedValueOnce(new Error('PRIVATE_READ_ERROR'))
      else if (failure === 'error') fixture.get.mockResolvedValueOnce({ ok: false, error: 'PRIVATE_REMOTE_ERROR' })
      else fixture.get.mockResolvedValueOnce({ ok: true, value: {
        ...fixture.selection(),
        ...(failure === 'invalid' ? { accountId: 'invalid-account' } : {}),
        accounts: { ...fixture.selection().accounts,
          ...(failure === 'missing-revision' ? { revision: undefined } : {}) },
      } })
      return true
    })
    await mount({ ...fixture.props, beforeAccountChange })
    await click(trigger())
    await click(button('Switch account'))
    await click(button('@demo-account-24'))
    expect(fixture.set).not.toHaveBeenCalled()
    expect(fixture.get).toHaveBeenCalledTimes(2)
    expect(text()).toContain('Could not save the Session account')
    expect(text()).not.toContain('PRIVATE_')
    expect(trigger().textContent).not.toContain('42.25')
  })

  it('revokes a pending post-consent revision reread when the dialog closes', async () => {
    const fixture = accountSelectorFixture()
    const read = deferred<{ ok: true; value: SessionAccountView }>()
    const beforeAccountChange = vi.fn(async () => {
      fixture.get.mockImplementationOnce(() => read.promise)
      return true
    })
    await mount({ ...fixture.props, beforeAccountChange })
    await click(trigger())
    await click(button('Switch account'))
    await click(button('@demo-account-24'))
    expect(fixture.get).toHaveBeenCalledTimes(2)
    expect(fixture.set).not.toHaveBeenCalled()
    await click(document.querySelector<HTMLButtonElement>('[aria-label="Close usage details"]')!)
    await act(async () => { read.resolve({ ok: true, value: fixture.selection() }) })
    expect(fixture.set).not.toHaveBeenCalled()
  })

  it.each(['account', 'global'] as const)('waits for parent approval before the exact %s account CAS', async target => {
    const fixture = accountSelectorFixture({ source: 'session' })
    const approval = deferred<boolean>()
    const beforeAccountChange = vi.fn(() => approval.promise)
    await mount({ ...fixture.props, beforeAccountChange })
    await click(trigger())
    await click(button('Switch account'))
    await click(target === 'global' ? follow() : button('@demo-account-24'))
    const accountId = target === 'global' ? null : fixture.selection().accounts.accounts[23]!.id
    expect(beforeAccountChange).toHaveBeenCalledExactlyOnceWith(accountId, expect.any(AbortSignal))
    expect(fixture.set).not.toHaveBeenCalled()
    expect(button('Switch account').disabled).toBe(true)
    expect(text()).toContain('Reviewing account switch')
    expect(text()).not.toContain('Saving account')
    expect(document.querySelector('[data-copilot-credits-account]')?.textContent).toBe('@demo-account-01')
    await act(async () => { approval.resolve(true) })
    expect(fixture.set).toHaveBeenCalledExactlyOnceWith(accountId, 7)
    expect(document.querySelector('[data-copilot-account-options]')).toBeNull()
  })

  it('keeps the account and dropdown unchanged when parent confirmation is cancelled', async () => {
    const fixture = accountSelectorFixture()
    const beforeAccountChange = vi.fn(async () => false)
    await mount({ ...fixture.props, beforeAccountChange })
    await click(trigger())
    await click(button('Switch account'))
    await click(button('@demo-account-24'))
    expect(fixture.set).not.toHaveBeenCalled()
    expect(fixture.quota).toHaveBeenCalledOnce()
    expect(document.querySelector('[data-copilot-credits-account]')?.textContent).toBe('@demo-account-01')
    expect(document.querySelectorAll('[data-copilot-account-options] button')).toHaveLength(24)
    expect(button('@demo-account-24').disabled).toBe(false)
    expect(document.querySelector('[role="alert"]')).toBeNull()
    beforeAccountChange.mockResolvedValueOnce(true)
    await click(button('@demo-account-24'))
    expect(fixture.set).toHaveBeenCalledExactlyOnceWith(fixture.selection().accounts.accounts[23]!.id, 7)
  })

  it.each(['close', 'session', 'invalidation', 'unmount'] as const)('ignores late parent approval after %s', async action => {
    const fixture = accountSelectorFixture()
    const approval = deferred<boolean>()
    const beforeAccountChange = vi.fn((_accountId: string | null, _signal: AbortSignal) => approval.promise)
    const props = { ...fixture.props, beforeAccountChange }
    const card = await mount(props)
    await click(trigger())
    await click(button('Switch account'))
    await click(button('@demo-account-24'))
    const signal = beforeAccountChange.mock.calls[0]![1]
    expect(signal).toBeInstanceOf(AbortSignal)
    expect(signal.aborted).toBe(false)
    const aborted = vi.fn()
    signal.addEventListener('abort', aborted)
    if (action === 'close') {
      await click(document.querySelector<HTMLButtonElement>('[aria-label="Close usage details"]')!)
      await click(trigger())
    } else if (action === 'session') {
      await card.render({ ...props, contextKey: 'next-session' })
    } else if (action === 'invalidation') {
      await act(async () => { const finish = accountPresentationChanges.begin(); finish() })
    } else await act(async () => { card.unmount() })
    expect(signal.aborted).toBe(true)
    expect(aborted).toHaveBeenCalledOnce()
    await act(async () => { approval.resolve(true) })
    expect(fixture.set).not.toHaveBeenCalled()
    expect(fixture.selection().accountId).toBe('canonical')
  })

  it('aborts parent pre-read on close without creating hidden consent or revoking a new request', async () => {
    const fixture = accountSelectorFixture()
    const preRead = deferred<void>()
    const approval = deferred<boolean>()
    const showConsent = vi.fn()
    const beforeAccountChange = vi.fn(async (_accountId: string | null, signal: AbortSignal) => {
      await preRead.promise
      if (signal.aborted) return false
      showConsent()
      return approval.promise
    })
    await mount({ ...fixture.props, beforeAccountChange })
    await click(trigger())
    await click(button('Switch account'))
    await click(button('@demo-account-24'))
    const oldSignal = beforeAccountChange.mock.calls[0]![1]
    await click(document.querySelector<HTMLButtonElement>('[aria-label="Close usage details"]')!)
    expect(oldSignal.aborted).toBe(true)
    await click(trigger())
    await click(button('Switch account'))
    await click(button('@demo-account-23'))
    const newSignal = beforeAccountChange.mock.calls[1]![1]
    expect(newSignal).not.toBe(oldSignal)
    expect(newSignal.aborted).toBe(false)
    await act(async () => { preRead.resolve() })
    expect(showConsent).toHaveBeenCalledOnce()
    expect(newSignal.aborted).toBe(false)
    expect(fixture.set).not.toHaveBeenCalled()
    await act(async () => { approval.resolve(true) })
    expect(fixture.set).toHaveBeenCalledExactlyOnceWith(fixture.selection().accounts.accounts[22]!.id, 7)
    expect(document.querySelector('[role="alert"]')).toBeNull()
  })

  it('surfaces parent confirmation rejection without saving or leaking its error', async () => {
    const fixture = accountSelectorFixture()
    const beforeAccountChange = vi.fn(async () => { throw new Error('PRIVATE_CONFIRMATION_ERROR') })
    await mount({ ...fixture.props, beforeAccountChange })
    await click(trigger())
    await click(button('Switch account'))
    await click(button('@demo-account-24'))
    expect(fixture.set).not.toHaveBeenCalled()
    expect(text()).toContain('Could not save the Session account')
    expect(text()).not.toContain('PRIVATE_CONFIRMATION_ERROR')
    expect(document.querySelector('[role="alert"]')).not.toBeNull()
  })

  it.each(['light', 'dark'])('themes owned and slotted form controls without replacing native %s dropdowns', async scheme => {
    const fixture = accountSelectorFixture()
    fixture.set.mockRejectedValueOnce(new Error('private error'))
    const card = await mount({ ...fixture.props, continuation: createElement('select', { 'aria-label': 'Continuation' },
      createElement('option', null, 'Follow default'), createElement('option', { disabled: true }, 'Unavailable')) })
    card.container.style.colorScheme = scheme
    await click(trigger())
    const dialog = document.querySelector<HTMLElement>('[data-copilot-usage-panel]')!
    expect(dialog.style.colorScheme).toBe('light dark')
    const styles = dialog.querySelector('style')?.textContent ?? ''
    expect(styles).toContain('color-scheme: inherit')
    expect(styles).toContain('background: Canvas; color: CanvasText')
    expect(styles).toContain(':focus-visible')
    expect(styles).toContain(':disabled')
    expect(document.querySelector('select')?.querySelectorAll('option')).toHaveLength(2)
    await click(button('Switch account'))
    expect(document.querySelector('input[type="search"]')).toBeNull()
    expect(document.querySelector<HTMLElement>('[data-copilot-account-selector]')?.style.colorScheme).toBe('inherit')
    expect(document.activeElement).toBe(button('@demo-account-01'))
    await click(button('@demo-account-24'))
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Could not save')
    expect(button('Switch account').disabled).toBe(true)
    expect(document.querySelector('option:disabled')?.textContent).toBe('Unavailable')
  })

  it('mounts a bounded 24-account dropdown without search and closes with Escape', async () => {
    const fixture = accountSelectorFixture()
    await mount(fixture.props)
    await click(trigger())
    expect(document.querySelector('[data-copilot-credits-account]')?.textContent).toBe('@demo-account-01')
    expect(text()).not.toContain('demo-account-24')
    expect(button('Add account')).toBeUndefined()
    await click(button('Switch account'))
    const list = document.querySelector<HTMLElement>('[data-copilot-account-options]')!
    expect(list.querySelectorAll('button')).toHaveLength(24)
    expect(list.style.maxHeight).toBe('220px')
    expect(list.style.overflowY).toBe('auto')
    expect(list.style.overscrollBehavior).toBe('contain')
    expect(document.activeElement).toBe(button('@demo-account-01'))
    expect(button('Add account')).toBeUndefined()
    expect(follow().checked).toBe(true)
    expect(list.querySelector('input')).toBeNull()
    expect(button('@demo-account-24')).toBeDefined()
    expect(document.querySelector('input[type=search]')).toBeNull()
    await act(async () => { document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(document.querySelector('input[type="search"]')).toBeNull()
    expect(button('Add account')).toBeUndefined()
    expect(document.activeElement).toBe(button('Switch account'))
    await click(button('Switch account'))
    expect(document.querySelector('input[type=search]')).toBeNull()
    expect(document.querySelectorAll('[data-copilot-account-options] button')).toHaveLength(24)
    await click(trigger())
    await click(trigger())
    expect(document.querySelector('[data-copilot-account-options]')).toBeNull()
    expect(fixture.quota).toHaveBeenCalledOnce()
    expect(fixture.set).not.toHaveBeenCalled()
  })

  it('preserves the selector error after a failed save and rereads before retrying exact CAS', async () => {
    const fixture = accountSelectorFixture()
    const success = fixture.set.getMockImplementation()!
    fixture.set.mockRejectedValueOnce(new Error('PRIVATE_ACCOUNT_SECRET'))
    await mount(fixture.props)
    await click(trigger())
    await click(button('Switch account'))
    await click(button('@demo-account-24'))
    expect(text()).toContain('Could not save the Session account')
    expect(text()).not.toContain('PRIVATE_ACCOUNT_SECRET')
    expect(text()).not.toContain('Session override')
    expect(trigger().textContent).not.toContain('42.25')
    expect(fixture.quota).toHaveBeenCalledOnce()
    expect(fixture.set).toHaveBeenCalledExactlyOnceWith(fixture.selection().accounts.accounts[23]!.id, 7)
    fixture.set.mockImplementation(success)
    await click(button('Refresh'))
    expect(document.querySelectorAll('[data-copilot-account-options] button')).toHaveLength(24)
    await click(button('@demo-account-24'))
    expect(fixture.set).toHaveBeenLastCalledWith(fixture.selection().accountId, 7)
    expect(text()).not.toContain('Could not save')
    expect(document.querySelector('[data-copilot-account-options]')).toBeNull()
    expect(document.querySelector('[data-copilot-credits-account]')?.textContent).toBe('@demo-account-24')
  })

  it('keeps a pending save on its old account and rejects late completion after a Session change', async () => {
    const fixture = accountSelectorFixture()
    const pending = deferred<{ ok: true; value: SessionAccountView }>()
    fixture.set.mockImplementationOnce(() => pending.promise)
    const card = await mount(fixture.props)
    await click(trigger())
    await click(button('Switch account'))
    await click(button('@demo-account-24'))
    expect(button('Switch account').disabled).toBe(true)
    expect(button('@demo-account-24').disabled).toBe(true)
    expect(document.querySelector('[data-copilot-credits-account]')?.textContent).toBe('@demo-account-01')
    await card.render({ ...fixture.props, contextKey: 'different-session' })
    await click(trigger())
    const nextId = fixture.selection().accounts.accounts[23]!.id
    await act(async () => { pending.resolve({ ok: true, value: { ...fixture.selection(), source: 'session', accountId: nextId,
      accounts: { ...fixture.selection().accounts, activeAccountId: nextId } } }) })
    expect(document.querySelector('[data-copilot-credits-account]')?.textContent).toBe('@demo-account-01')
    expect(text()).not.toContain('Session override')
    expect(document.querySelector('[data-copilot-account-options]')).toBeNull()
  })

  it('labels running and next ownership only after a pending account save succeeds', async () => {
    const fixture = accountSelectorFixture({ runningAccountId: 'canonical' })
    const saved = fixture.set.getMockImplementation()!
    const pending = deferred<void>()
    fixture.set.mockImplementationOnce(async (accountId, revision) => {
      await pending.promise
      return saved(accountId, revision)
    })
    await mount(fixture.props)
    await click(trigger())
    await click(button('Switch account'))
    await click(button('@demo-account-24'))
    expect(text()).toContain('Running turn remains on: @demo-account-01 · Next turn: @demo-account-01')
    expect(text()).toContain('Saving account')
    expect(fixture.quota).toHaveBeenCalledOnce()
    await click(document.querySelector<HTMLButtonElement>('[aria-label="Close usage details"]')!)
    await act(async () => { pending.resolve() })
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    await click(trigger())
    expect(text()).toContain('Running turn remains on: @demo-account-01 · Next turn: @demo-account-24')
    expect(document.querySelector('[data-copilot-account-options]')).toBeNull()
    expect(fixture.set).toHaveBeenCalledExactlyOnceWith(fixture.selection().accountId, 7)
    expect(fixture.quota).toHaveBeenCalledTimes(2)
  })

  it('offers only configured records while keeping an explicit default-equal choice explicit', async () => {
    const fixture = accountSelectorFixture()
    const selection = fixture.selection()
    const snapshot = { ...selection, accounts: { ...selection.accounts, accounts: [
      ...selection.accounts.accounts,
      { id: '00000000-0000-4000-8000-000000000099', configured: false, identityState: 'unknown' as const },
    ] } }
    fixture.get.mockResolvedValueOnce({ ok: true, value: snapshot })
    await mount(fixture.props)
    await click(trigger())
    await click(button('Switch account'))
    expect(document.querySelectorAll('[data-copilot-account-options] button')).toHaveLength(24)
    expect(follow().checked).toBe(true)
    await click(button('@demo-account-01'))
    expect(fixture.set).toHaveBeenCalledExactlyOnceWith('canonical', 7)
    expect(text()).toContain('Session override')
    await click(button('Switch account'))
    expect(button('@demo-account-01').getAttribute('aria-pressed')).toBe('true')
    expect(follow().checked).toBe(false)
  })

  it('freezes the effective account when following is unchecked and restores following through the same CAS', async () => {
    const fixture = accountSelectorFixture()
    const beforeAccountChange = vi.fn(async () => true)
    await mount({ ...fixture.props, beforeAccountChange })
    await click(trigger())
    expect(follow().checked).toBe(true)
    await click(follow())
    expect(beforeAccountChange).toHaveBeenLastCalledWith('canonical', expect.any(AbortSignal))
    expect(fixture.set).toHaveBeenLastCalledWith('canonical', 7)
    expect(follow().checked).toBe(false)
    expect(document.activeElement).toBe(follow())
    await click(follow())
    expect(beforeAccountChange).toHaveBeenLastCalledWith(null, expect.any(AbortSignal))
    expect(fixture.set).toHaveBeenLastCalledWith(null, 8)
    expect(follow().checked).toBe(true)
    expect(document.activeElement).toBe(follow())
  })

  it('retains confirmed following when consent is cancelled and disables it during confirmation', async () => {
    const fixture = accountSelectorFixture()
    const approval = deferred<boolean>()
    await mount({ ...fixture.props, beforeAccountChange: () => approval.promise })
    await click(trigger())
    await click(follow())
    expect(follow().disabled).toBe(true)
    expect(follow().checked).toBe(true)
    await act(async () => { approval.resolve(false) })
    expect(fixture.set).not.toHaveBeenCalled()
    expect(follow().checked).toBe(true)
    expect(follow().disabled).toBe(false)
  })

  it('disables following when the Session selection cannot be read instead of treating it as a fixed account', async () => {
    const fixture = accountSelectorFixture()
    fixture.get.mockResolvedValue({ ok: false, error: 'unavailable' })
    await mount(fixture.props)
    await click(trigger())
    expect(follow().disabled).toBe(true)
    expect(text()).toContain('Account selection unavailable')
    expect(fixture.set).not.toHaveBeenCalled()
  })

  it.each([
    ['en-US', 'Manage accounts and models', 'Follow global default'],
    ['zh-CN', '管理账号与模型', '跟随全局默认'],
  ])('exposes parent slots and localized management without implementing navigation (%s)', async (locale, manage, follow) => {
    const fixture = accountSelectorFixture()
    const onManage = vi.fn()
    const props = { ...fixture.props, locale, continuation: createElement('p', null, 'Continuation controls') }
    const card = await mount(props)
    await click(trigger())
    expect(text()).toContain('Continuation controls')
    expect(button(manage)).toBeUndefined()
    expect(text()).not.toContain('COPILOT_ACCOUNT_MANAGEMENT_NAVIGATION_UNAVAILABLE')
    expect(text()).not.toContain('navigation is unavailable')
    await card.render({ ...props, onManage })
    expect(text()).not.toContain('COPILOT_ACCOUNT_MANAGEMENT_NAVIGATION_UNAVAILABLE')
    await click(button(locale === 'zh-CN' ? '切换账号' : 'Switch account'))
    expect(document.querySelector('input[type=search]')).toBeNull()
    expect(document.querySelector('[data-copilot-follow-global]')?.parentElement?.textContent).toBe(follow)
    expect(button('Add account')).toBeUndefined()
    const controls = Array.from(document.querySelectorAll('button'))
    expect(controls.some(control => /delete|remove/i.test(control.textContent ?? ''))).toBe(false)
    expect(controls.at(-1)).toBe(button(manage))
    await click(button(manage))
    expect(onManage).toHaveBeenCalledOnce()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('settles quota before a slow identity renewal and uses nonforcing ensure on visible refresh cadence', async () => {
    const snapshot: CopilotAccountsView = {
      state: 'ready', activeAccountId: 'canonical', revision: 1, writable: true, switchable: true,
      accounts: [{ id: 'canonical', configured: true, identityState: 'unknown' }], notices: [],
    }
    const identity = deferred<{ ok: true; value: CopilotAccountsView }>()
    const accountsRemote = {
      get: vi.fn(async () => ({ ok: true as const, value: snapshot })),
      ensureIdentity: vi.fn(() => identity.promise),
      refreshIdentity: vi.fn(async () => ({ ok: true as const, value: snapshot })),
    }
    await mount({ remote: remote(view({ accountId: 'canonical' })), accountsRemote, contextKey: 'slow-identity' })
    expect(trigger().textContent).toContain('42.25')
    await click(trigger())
    expect(text()).not.toContain('Refreshing')
    expect(accountsRemote.ensureIdentity).toHaveBeenCalledOnce()
    expect(accountsRemote.refreshIdentity).not.toHaveBeenCalled()
    await act(async () => { identity.resolve({ ok: true, value: {
      ...snapshot, accounts: [{ id: 'canonical', configured: true, identityState: 'ready', identity: { login: 'renewed-user', userId: 1 } }],
    } }) })
    expect(text()).toContain('@renewed-user')
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(accountsRemote.ensureIdentity).toHaveBeenCalledTimes(2)
    expect(accountsRemote.refreshIdentity).not.toHaveBeenCalled()
  })
  it('switches only subsequent Session turns inside Credits and can restore inheritance', async () => {
    const B = '11111111-1111-4111-8111-111111111111'
    let explicit: string | undefined, revision = 1
    const snapshot = (): SessionAccountView => ({
      source: explicit === undefined ? 'global' : 'session', accountId: explicit ?? 'canonical',
      globalAccountId: 'canonical', runningAccountId: 'canonical',
      accounts: { state: 'ready', activeAccountId: explicit ?? 'canonical', revision, writable: true, switchable: true, notices: [],
        accounts: [{ id: 'canonical', configured: true, identityState: 'ready', identity: { login: 'synthetic-a', userId: 1 } },
          { id: B, configured: true, identityState: 'ready', identity: { login: 'synthetic-b', userId: 2 } }] },
    })
    const get = async () => ({ ok: true as const, value: snapshot() })
    const set = vi.fn(async (accountId: string | null, expected: number) => {
      expect(expected).toBe(revision)
      explicit = accountId ?? undefined; revision++
      return get()
    })
    const quota = async () => ok(view({ accountId: explicit ?? 'canonical', used: explicit === B ? 12 : 42.25,
      remaining: explicit === B ? 88 : 57.75, percentUsed: explicit === B ? 12 : 42.25 }))
    await mount({ contextKey: 'session', remote: { get: quota, refresh: quota },
      sessionAccount: { get, set }, accountsRemote: {
        get: async () => ({ ok: true as const, value: snapshot().accounts }),
        refreshIdentity: async () => ({ ok: true as const, value: snapshot().accounts }),
        ensureIdentity: async () => ({ ok: true as const, value: snapshot().accounts }),
      } })
    expect(button('Switch account')).toBeUndefined()
    await click(trigger())
    expect(text()).toContain('Follow global default')
    await click(button('Switch account'))
    await click(button('@synthetic-b'))
    expect(set).toHaveBeenCalledExactlyOnceWith(B, 1)
    expect(text()).toContain('Session override')
    expect(text()).toContain('Running turn remains on: @synthetic-a')
    expect(text()).toContain('Next turn: @synthetic-b')
    expect(document.querySelector('[data-copilot-credits-account]')?.textContent).toBe('@synthetic-b')
    expect(document.querySelector('[data-copilot-account-options]')).toBeNull()
    expect(trigger().textContent).toContain('12 used')
    await click(button('Switch account'))
    await click(follow())
    expect(set).toHaveBeenLastCalledWith(null, 2)
    expect(text()).not.toContain('Session override')
    expect(trigger().textContent).toContain('42.25 used')
  })
  it('rejects quota from a previous account even if the Session metadata read succeeds', async () => {
    const B = '11111111-1111-4111-8111-111111111111'
    const selection: SessionAccountView = { source: 'session', accountId: B, globalAccountId: 'canonical',
      accounts: { state: 'ready', activeAccountId: B, revision: 1, writable: true, switchable: true,
        accounts: [{ id: B, configured: true, identityState: 'unknown' }], notices: [] } }
    await mount({ contextKey: 'changed-session', remote: remote(view({ accountId: 'canonical' })),
      sessionAccount: { get: async () => ({ ok: true, value: selection }), set: vi.fn() } })
    expect(trigger().textContent).not.toContain('42.25')
    await click(trigger())
    expect(text()).toContain('Could not refresh usage')
    expect(text()).not.toContain('Could not save')
  })
  it('shows current identity only in details without a Chat switching control', async () => {
    const accountsRemote: Pick<CopilotAccountsRemote, 'get' | 'refreshIdentity' | 'ensureIdentity'> = {
      get: vi.fn(async () => ({ ok: true as const, value: {
        state: 'ready' as const, activeAccountId: 'canonical', revision: 2, writable: true, switchable: true,
        accounts: [{ id: 'canonical', configured: true, identityState: 'ready' as const, identity: { login: 'demo-user', userId: 1 } }],
        notices: [],
      } })),
      refreshIdentity: vi.fn(async function () { return accountsRemote.get() }),
      ensureIdentity: vi.fn(async function () { return accountsRemote.get() }),
    }
    await mount({ remote: remote(view({ accountId: 'canonical' })), accountsRemote, contextKey: 'identity' })
    expect(trigger().textContent).not.toContain('demo-user')
    await click(trigger())
    expect(document.querySelector('[data-copilot-credits-account]')?.textContent).toBe('@demo-user')
    expect(text()).not.toContain('across Copilot apps')
    expect(Array.from(document.querySelectorAll('button')).some(node => /switch|add.*account|remove/i.test(node.textContent ?? ''))).toBe(false)
  })
  it('refuses to combine account B identity with account A quota', async () => {
    const snapshot = { state: 'ready' as const, activeAccountId: 'canonical', revision: 2, writable: true, switchable: true,
      accounts: [{ id: 'canonical', configured: true, identityState: 'ready' as const, identity: { login: 'demo-b', userId: 2 } }],
      notices: [] }
    const accountsRemote = { get: vi.fn(async () => ({ ok: true as const, value: snapshot })),
      ensureIdentity: vi.fn(async () => ({ ok: true as const, value: snapshot })),
      refreshIdentity: vi.fn(async () => ({ ok: true as const, value: snapshot })) }
    await mount({ remote: remote(view({ accountId: '00000000-0000-4000-8000-000000000001' })), accountsRemote, contextKey: 'changed-account' })
    expect(trigger().textContent).not.toContain('42.25')
    await click(trigger())
    expect(text()).toContain('Could not refresh usage')
    expect(document.querySelector('[role="progressbar"]')).toBeNull()
  })
  it('retains account-bound quota when the separate identity lookup is unavailable', async () => {
    const snapshot: CopilotAccountsView = {
      state: 'ready', activeAccountId: 'canonical', revision: 2, writable: true, switchable: true,
      accounts: [{ id: 'canonical', configured: true, identityState: 'unavailable' }], notices: [],
    }
    const accountsRemote = {
      get: vi.fn(async () => ({ ok: true as const, value: snapshot })),
      ensureIdentity: vi.fn(async () => ({ ok: true as const, value: snapshot })),
      refreshIdentity: vi.fn(async () => ({ ok: true as const, value: snapshot })),
    }
    await mount({ remote: remote(view({ accountId: 'canonical' })), accountsRemote, contextKey: 'identity-unavailable' })
    expect(trigger().textContent).toContain('42.25')
    await click(trigger())
    expect(document.querySelector('[data-copilot-credits-account]')?.textContent).toContain('identity unavailable')
    expect(document.querySelector('[role="alert"]')).toBeNull()
  })
  it.each([
    ['en-US', 'Original authorization · Identity unavailable', 'Saved authorization 1 · Identity unavailable'],
    ['zh-CN', '原始授权 · 身份暂不可用', '已保存授权 1 · 身份暂不可用'],
  ])('labels unknown Credits accounts without showing opaque IDs (%s)', async (locale, original, saved) => {
    const first = '00000000-0000-4000-8000-000000000001'
    const second = '00000000-0000-4000-8000-000000000002'
    const accounts: CopilotAccountsView = {
      state: 'ready', activeAccountId: 'canonical', revision: 2, writable: true, switchable: true,
      accounts: [
        { id: 'canonical', configured: true, identityState: 'unknown' },
        { id: first, configured: true, identityState: 'unknown' },
        { id: second, configured: true, identityState: 'unavailable' },
      ],
      notices: [],
    }
    const session: SessionAccountView = {
      source: 'global', accountId: 'canonical', globalAccountId: 'canonical', runningAccountId: 'canonical',
      accounts,
    }
    const set = vi.fn(async () => ({ ok: true as const, value: session }))
    const accountsRemote = {
      get: vi.fn(async () => ({ ok: true as const, value: accounts })),
      ensureIdentity: vi.fn(async () => ({ ok: true as const, value: accounts })),
      refreshIdentity: vi.fn(async () => ({ ok: true as const, value: accounts })),
    }
    await mount({ remote: remote(view({ accountId: 'canonical' })), accountsRemote,
      sessionAccount: { get: async () => ({ ok: true as const, value: session }), set },
      contextKey: `unknown-identities-${locale}`, locale })
    await click(trigger())
    await click(button(locale === 'zh-CN' ? '切换账号' : 'Switch account'))
    expect(text()).toContain(original)
    expect(text()).toContain(saved)
    expect(text()).toContain(locale === 'zh-CN' ? '已保存授权 2 · 身份暂不可用' : 'Saved authorization 2 · Identity unavailable')
    expect(text()).not.toContain(first)
    expect(text()).not.toContain(second)
    expect(text()).not.toContain('Canonical')
    expect(set).not.toHaveBeenCalled()
  })
  it('immediately revokes mounted presentation on a Models mutation and rejects late previous-account results', async () => {
    let activeAccountId = 'canonical'
    const nextId = '00000000-0000-4000-8000-000000000001'
    const snapshot = (): CopilotAccountsView => ({
      state: 'ready', activeAccountId, revision: 2, writable: true, switchable: true, notices: [],
      accounts: [
        { id: 'canonical', configured: true, identityState: 'ready', identity: { login: 'demo-a', userId: 1 } },
        { id: nextId, configured: true, identityState: 'ready', identity: { login: 'demo-b', userId: 2 } },
      ],
    })
    const accountsRemote = {
      get: vi.fn(async () => ({ ok: true as const, value: snapshot() })),
      ensureIdentity: vi.fn(async () => ({ ok: true as const, value: snapshot() })),
      refreshIdentity: vi.fn(async () => ({ ok: true as const, value: snapshot() })),
    }
    const late = deferred<ReturnType<typeof ok>>()
    const api = {
      get: vi.fn(async () => ok(view({ accountId: activeAccountId, used: activeAccountId === 'canonical' ? 42.25 : 12,
        remaining: activeAccountId === 'canonical' ? 57.75 : 88, percentUsed: activeAccountId === 'canonical' ? 42.25 : 12 }))),
      refresh: vi.fn(() => late.promise),
    }
    await mount({ remote: api, accountsRemote, contextKey: 'mutation' })
    await click(trigger())
    expect(text()).toContain('@demo-a')
    await click(button('Refresh'))
    let finish = () => {}
    await act(async () => { finish = accountPresentationChanges.begin() })
    cleanups.push(finish)
    expect(text()).not.toContain('@demo-a')
    expect(trigger().textContent).not.toContain('42.25')
    await act(async () => { activeAccountId = nextId; finish() })
    expect(text()).toContain('@demo-b')
    expect(trigger().textContent).toContain('12 used')
    await act(async () => { late.resolve(ok(view({ accountId: 'canonical' }))) })
    expect(text()).not.toContain('@demo-a')
    expect(trigger().textContent).toContain('12 used')
  })
  it('uses native secondary type tokens and a bounded single-line trigger', async () => {
    await mount()
    const control = trigger()
    expect(control.style.fontSize).toBe('var(--dsh-content-font-size-secondary, 13px)')
    expect(control.style.lineHeight).toBe('calc(20px + var(--dsh-content-font-delta-secondary, 0px))')
    expect(control.style.padding).toBe('1px 8px')
    expect(control.style.maxWidth).toBe('100%')
    expect(control.style.whiteSpace).toBe('nowrap')
    expect(control.style.overflow).toBe('hidden')
    expect(control.style.textOverflow).toBe('ellipsis')
    expect(control.title).toBe(control.textContent)
  })

  it.each(['en-US', 'zh-CN'])('retains the full long reading and exact details in %s', async locale => {
    const api = remote(view({ used: 772540, remaining: 1227460, limit: 2000000, percentUsed: 38.627 }))
    await mount({ remote: api, contextKey: 'long-reading', locale })
    expect(trigger().title).toBe(trigger().textContent)
    expect(trigger().title.length).toBeGreaterThan(0)
    await click(trigger())
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    expect(text()).toContain(new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(772540))
    expect(api.get).toHaveBeenCalledTimes(1)
    expect(api.refresh).not.toHaveBeenCalled()
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(document.activeElement).toBe(trigger())
  })

  it('keeps loading and unavailable full-label tooltips in sync without extra reads', async () => {
    const pending = deferred<ReturnType<typeof ok>>()
    const api = { get: vi.fn(() => pending.promise), refresh: vi.fn() }
    await mount({ remote: api, contextKey: 'pending-reading' })
    expect(trigger().title).toContain('Loading')
    expect(trigger().title).toBe(trigger().textContent)
    await act(async () => { pending.resolve(ok({ state: 'unavailable', billing: 'unknown', budget: 'unknown',
      diagnostic: 'COPILOT_USAGE_SNAPSHOT_MISSING' })) })
    expect(trigger().title).toContain('Not available')
    expect(trigger().title).toBe(trigger().textContent)
    await click(trigger())
    expect(document.querySelector('[role="alert"]')).toBeNull()
    expect(api.get).toHaveBeenCalledTimes(1)
    expect(api.refresh).not.toHaveBeenCalled()
  })

  it('shows supplied account amounts without an unsupported Session credits section', async () => {
    const api = remote()
    await mount({ remote: api, contextKey: 'a' })
    expect(trigger().textContent).toContain('42.25 used')
    expect(trigger().textContent).toContain('57.75 left')
    expect(api.get).toHaveBeenCalledTimes(1)
    await click(trigger())
    expect(text()).toContain('Account-wide')
    expect(text()).not.toContain('This session')
    expect(text()).not.toContain('Not available')
    expect(text()).not.toContain('does not expose per-session billing usage')
    expect(text()).not.toContain('673')
    expect(document.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('42.25')
  })

  it.each([undefined, 0, 1, 1_799_999_999_999, 1_800_000_000_000])(
    'hides missing, epoch or elapsed reset %s while preserving amounts and freshness', async resetAt => {
      await mount({ remote: remote(view({ resetAt })), contextKey: 'unknown-reset' })
      await click(trigger())
      expect(text()).not.toContain('Resets:')
      expect(text()).not.toContain('1970')
      expect(text()).not.toContain('This session')
      expect(text()).toContain('42.25')
      expect(text()).toContain('57.75')
      expect(text()).toContain('Last updated:')
    },
  )

  it.each(['en-US', 'zh-CN'])('shows an explicitly reported future reset in %s', async locale => {
    const resetAt = 1_900_000_000_000
    await mount({ remote: remote(view({ resetAt })), contextKey: 'known-reset', locale })
    await click(trigger())
    expect(text()).toContain(new Date(resetAt).toLocaleString(locale))
    expect(text()).toContain(locale === 'zh-CN' ? '重置时间:' : 'Resets:')
  })

  it('rejects a purported ready snapshot without observation instead of presenting its amounts or reset', async () => {
    await mount({ remote: remote(view({ resetAt: 1_900_000_000_000, observedAt: undefined })), contextKey: 'no-observation' })
    await click(trigger())
    expect(text()).not.toContain('Resets:')
    expect(text()).not.toContain('Last updated:')
    expect(text()).not.toContain('42.25')
    expect(document.querySelector('[role="alert"]')).not.toBeNull()
  })

  it('never derives remaining from a percentage and does not turn unknown into zero', async () => {
    await mount({ remote: remote(view({ remaining: undefined, used: undefined, percentUsed: 25 })), contextKey: 'a' })
    expect(trigger().textContent).not.toContain('75')
    await click(trigger())
    expect(text()).toContain('Not available')
    expect(text()).not.toMatch(/\b0 used\b/)
  })
  it('shows a readable unavailable state without empty oversized statistics or a translucent panel', async () => {
    await mount({ remote: remote({ state: 'unavailable', billing: 'unknown', budget: 'unknown',
      diagnostic: 'COPILOT_USAGE_TLS' }), contextKey: 'tls' })
    await click(trigger())
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
    expect(dialog.textContent).toContain('Could not verify the connection to GitHub')
    expect(dialog.textContent).not.toContain('Budget unavailable')
    expect(dialog.querySelectorAll('strong')).toHaveLength(1)
    expect(dialog.style.background).toBe(
      'linear-gradient(var(--dsw-specific-menu, Canvas), var(--dsw-specific-menu, Canvas)), Canvas')
    expect(dialog.style.boxShadow).toBe('0 8px 32px rgb(0 0 0 / 24%)')
  })

  it('does not round a positive sub-cent credit amount to zero in the compact control', async () => {
    await mount({ remote: remote(view({ used: 0.001, remaining: 0.999, limit: 1, percentUsed: 0.1 })), contextKey: 'a' })
    expect(trigger().textContent).toContain('<0.01 used')
    await click(trigger())
    expect(text()).toContain('Amounts rounded for display')
  })

  it('uses premium-request units without relabeling them credits', async () => {
    await mount({ remote: remote(view({ billing: 'requests' })), contextKey: 'a' })
    await click(trigger())
    expect(text()).toContain('Premium requests')
    expect(text().toLowerCase()).not.toContain('credits')
  })

  it('has no personal denominator, balance or progress for pooled budgets', async () => {
    await mount({ remote: remote(view({ budget: 'pooled', remaining: undefined, limit: undefined, percentUsed: undefined })), contextKey: 'a' })
    await click(trigger())
    expect(text()).toContain('Shared budget')
    expect(document.querySelector('[role="progressbar"]')).toBeNull()
    expect(text()).not.toContain('100')
    expect(trigger().textContent).toContain('42.25 used')
  })

  it.each(['unavailable', 'signed-out'] as const)('does not display numeric data in %s state', async state => {
    await mount({ remote: remote(view({ state })), contextKey: 'a' })
    await click(trigger())
    expect(text()).not.toContain('42.25')
    expect(text()).not.toContain('57.75')
  })

  it('labels stale data last-known both compactly and in details', async () => {
    await mount({ remote: remote(view({ state: 'stale', diagnostic: 'COPILOT_USAGE_NETWORK' })), contextKey: 'a' })
    expect(trigger().textContent).toContain('Last known')
    await click(trigger())
    expect(text()).toContain('Last known')
  })

  it('localizes all primary content in Chinese', async () => {
    await mount({ remote: remote(), contextKey: 'a', locale: 'zh-CN' })
    expect(trigger().textContent).toContain('已用')
    await click(trigger())
    expect(text()).not.toContain('本会话')
    expect(text()).toContain('GitHub 账号信息暂不可用')
    expect(text()).toContain('42.25')
    expect(text()).toContain('57.75')
    expect(text()).toContain('账号范围')
    expect(button('刷新')).toBeDefined()
  })

  it('names a missing Remote without disclosing private diagnostics', async () => {
    await mount({ contextKey: 'a' })
    await click(trigger())
    expect(text()).toContain('COPILOT_USAGE_REMOTE_UNAVAILABLE')
    const api = remote(view({ state: 'unavailable', diagnostic: 'PRIVATE_ACCOUNT_SECRET' }))
    const card = await mount({ contextKey: 'b', remote: api })
    expect(card.container.textContent).not.toContain('PRIVATE_ACCOUNT_SECRET')
  })

  it('reports refresh failures without rendering arbitrary error messages', async () => {
    const api: CopilotUsageRemote = {
      get: async () => ok(view()),
      refresh: async () => ({ ok: false, error: { message: 'PRIVATE_ACCOUNT_SECRET' } }),
    }
    await mount({ remote: api, contextKey: 'a' })
    await click(trigger())
    await click(button('Refresh'))
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Could not refresh')
    expect(text()).not.toContain('PRIVATE_ACCOUNT_SECRET')
    expect(text()).not.toContain('57.75')
  })

  it('explains scoped trust failures without requiring a global environment flag', async () => {
    const tlsView: CopilotUsageView = { state: 'unavailable', billing: 'unknown', budget: 'unknown', diagnostic: 'COPILOT_USAGE_TLS' }
    const enCard = await mount({ remote: remote(tlsView), contextKey: 'a' })
    await click(trigger())
    expect(text()).toContain('system CA trust')
    expect(text()).toContain('TLS verification remains enabled')
    await act(async () => { enCard.unmount() })

    const zhCard = await mount({ remote: remote(tlsView), contextKey: 'b', locale: 'zh-CN' })
    await click(trigger())
    expect(zhCard.container.textContent).toContain('系统证书信任')
    await act(async () => { zhCard.unmount() })
    const trustView: CopilotUsageView = { ...tlsView, diagnostic: 'COPILOT_USAGE_TRUST_UNAVAILABLE' }
    await mount({ remote: remote(trustView), contextKey: 'c' })
    await click(trigger())
    expect(text()).toContain('Could not load system CA trust')
  })

  it('rejects extra Remote fields and inconsistent balances before rendering them', async () => {
    for (const value of [view({ used: 999 }), { ...view(), credential: 'PRIVATE_ACCOUNT_SECRET' }]) {
      const card = await mount({ remote: remote(value), contextKey: 'a' })
      await click(trigger())
      expect(document.querySelector('[role="alert"]')).not.toBeNull()
      expect(text()).not.toContain('57.75')
      expect(text()).not.toContain('PRIVATE_ACCOUNT_SECRET')
      await act(async () => { card.unmount() })
    }
  })

  it('shows a low-budget warning and opens the plan through the supported browser target', async () => {
    await mount({ remote: remote(view({ used: 94, remaining: 6, percentUsed: 94 })), contextKey: 'a' })
    await click(trigger())
    expect(text()).toContain('Low remaining budget')
    const link = document.querySelector<HTMLAnchorElement>('a')!
    expect(link.href).toBe('https://github.com/settings/copilot')
    expect(link.target).toBe('_blank')
    expect(link.rel).toBe('noreferrer')
    expect(document.querySelector('code')?.textContent).toBe('https://github.com/settings/copilot')
  })

  it('polls only while visible, bounds in-flight requests, and disposes its timer', async () => {
    vi.useFakeTimers()
    const api = remote()
    const card = await mount({ remote: api, contextKey: 'a' })
    await act(async () => { vi.advanceTimersByTime(60_000) })
    expect(api.get).toHaveBeenCalledTimes(2)
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    await act(async () => { vi.advanceTimersByTime(120_000) })
    expect(api.get).toHaveBeenCalledTimes(2)
    await act(async () => { card.unmount() })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('drops late results after session changes and unmount', async () => {
    const first = deferred<ReturnType<typeof ok>>()
    const api = { get: vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(ok(view({ used: 9, remaining: 91, percentUsed: 9 }))), refresh: vi.fn() }
    const card = await mount({ remote: api, contextKey: 'a' })
    await card.render({ remote: api, contextKey: 'b' })
    expect(trigger().textContent).toContain('9 used')
    await act(async () => { first.resolve(ok(view({ used: 888 }))) })
    expect(trigger().textContent).not.toContain('888')
    await act(async () => { card.unmount() })
    expect(document.querySelector('[data-copilot-usage-trigger]')).toBeNull()
  })

  it('provides dialog focus, Escape, outside dismissal and responsive bounds', async () => {
    await mount()
    trigger().focus()
    await click(trigger())
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
    expect(dialog.getAttribute('aria-labelledby')).toBeTruthy()
    expect(dialog.style.maxWidth).toBe('calc(100vw - 24px)')
    expect(dialog.contains(document.activeElement)).toBe(true)
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(trigger())
    await click(trigger())
    await act(async () => { document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })) })
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })
})
