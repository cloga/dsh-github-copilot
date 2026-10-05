// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { accountsViewFrom, CopilotAccountsPanel } from '../src/copilot-accounts-card.ts'
import type { CopilotAccountsRemote } from '../src/copilot-accounts-card.ts'
import type { CopilotAccountsView } from '../src/copilot-accounts-types.ts'
import { CopilotAccountsViewSchema } from '../src/copilot-accounts-remote.ts'

const cleanups: Array<() => void> = []
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }) })
afterEach(async () => {
  await act(async () => { cleanups.splice(0).forEach(dispose => dispose()) })
  vi.useRealTimers()
  vi.unstubAllGlobals()
  document.body.replaceChildren()
})
const view = (extra: Partial<CopilotAccountsView> = {}): CopilotAccountsView => ({
  state: 'ready', activeAccountId: 'canonical', revision: 2, writable: true, switchable: true,
  accounts: [
    { id: 'canonical', configured: true, identityState: 'ready', identity: { userId: 1, login: 'demo-a' } },
    { id: '00000000-0000-4000-8000-000000000001', configured: true, identityState: 'ready', identity: { userId: 2, login: 'demo-b' } },
  ], notices: [], ...extra,
})
const ok = (value: CopilotAccountsView) => ({ ok: true as const, value })
function remote(value = view()): CopilotAccountsRemote {
  const decoded = CopilotAccountsViewSchema.safeParse(value)
  expect(decoded.success, JSON.stringify(decoded)).toBe(true)
  return {
    get: vi.fn(async () => ok(value)), refreshIdentity: vi.fn(async () => ok(value)),
    ensureIdentity: vi.fn(async () => ok(value)),
    add: vi.fn(async () => ok(value)), cancel: vi.fn(async () => ok(value)),
    switchAccount: vi.fn(async () => ok(value)), removeAccount: vi.fn(async () => ok(value)),
    reauthorize: vi.fn(async () => ok(value)),
  }
}
async function mount(api: CopilotAccountsRemote, expanded = true, locale = 'en-US') {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  cleanups.push(() => root.unmount())
  await act(async () => { root.render(createElement(CopilotAccountsPanel, { remote: api, expanded, locale })) })
}
const text = () => document.body.textContent ?? ''
const button = (label: string) => Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(node => node.textContent === label)!
const click = async (label: string) => { await act(async () => { button(label).click() }) }

describe('Models account management', () => {
  it('projects owned Client fields without retaining credentials or unrelated identity fields', () => {
    const decoded = CopilotAccountsViewSchema.safeParse(view())
    expect(decoded.success, JSON.stringify(decoded)).toBe(true)
    const projected = accountsViewFrom({ ...view(), grant: 'never-retain', accounts: view().accounts.map(account => ({
      ...account, access: 'never-retain', identity: { ...account.identity, email: 'never-retain' },
    })) })
    expect(projected).toEqual(view())
    expect(JSON.stringify(projected)).not.toContain('never-retain')
  })
  it('shows readonly current identity before Manage opens', async () => {
    const api = remote()
    await mount(api, false)
    expect(text()).toBe('@demo-a')
    expect(document.querySelector('button')).toBeNull()
    expect(api.ensureIdentity).toHaveBeenCalledOnce()
    expect(api.refreshIdentity).not.toHaveBeenCalled()
    expect(api.add).not.toHaveBeenCalled()
  })
  it('requires a separate confirmation and uses the captured selector revision', async () => {
    const api = remote()
    await mount(api)
    await click('Switch')
    expect(api.switchAccount).not.toHaveBeenCalled()
    expect(text()).toContain('encrypted reasoning')
    await click('Confirm switch')
    expect(api.switchAccount).toHaveBeenCalledExactlyOnceWith(view().accounts[1]!.id, 2)
  })
  it('requires removal confirmation without offering removal of the active compatibility account', async () => {
    const api = remote()
    await mount(api)
    expect(Array.from(document.querySelectorAll('button')).filter(node => node.textContent === 'Remove')).toHaveLength(1)
    await click('Remove')
    expect(api.removeAccount).not.toHaveBeenCalled()
    await click('Cancel')
    expect(api.removeAccount).not.toHaveBeenCalled()
    await click('Remove')
    await click('Confirm removal')
    expect(api.removeAccount).toHaveBeenCalledExactlyOnceWith(view().accounts[1]!.id, 2)
  })
  it('reauthorizes the existing slot without requesting a new account or switching', async () => {
    const api = remote()
    await mount(api)
    await click('Reauthorize')
    expect(api.reauthorize).toHaveBeenCalledExactlyOnceWith(view().accounts[1]!.id, 2)
    expect(api.add).not.toHaveBeenCalled()
    expect(api.switchAccount).not.toHaveBeenCalled()
  })
  it('rejects malformed identity and unknown account identifiers', () => {
    expect(accountsViewFrom({ ...view(), activeAccountId: 'unrecognized-account' })).toBeUndefined()
    expect(accountsViewFrom({ ...view(), accounts: [{
      id: 'canonical', configured: true, identityState: 'ready', identity: { login: 'private@example.invalid', userId: 1 },
    }] })).toBeUndefined()
  })
  it('clears the current identity while the existing authorization controller changes credentials', async () => {
    const api = remote()
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    cleanups.push(() => root.unmount())
    await act(async () => { root.render(createElement(CopilotAccountsPanel, { remote: api, expanded: true, configured: true })) })
    expect(text()).toContain('@demo-a')
    await act(async () => { root.render(createElement(CopilotAccountsPanel, {
      remote: api, expanded: true, authorizationBusy: true, configured: true,
    })) })
    expect(text()).not.toContain('@demo-a')
    expect(button('Add GitHub account').disabled).toBe(true)
    expect(api.ensureIdentity).toHaveBeenCalledOnce()
    await act(async () => { root.render(createElement(CopilotAccountsPanel, {
      remote: api, expanded: true, authorizationBusy: false, configured: false,
    })) })
    expect(api.ensureIdentity).toHaveBeenCalledTimes(2)
  })
  it('disables switching and adding for unproven route/activity eligibility', async () => {
    const api = remote(view({ state: 'error', switchable: false, diagnostic: 'COPILOT_ACCOUNTS_BUSY' }))
    await mount(api)
    expect(button('Switch').disabled).toBe(true)
    expect(button('Add GitHub account').disabled).toBe(true)
    expect(text()).toContain('No running work will be cancelled')
  })
  it('presents in-flight authorization as progress and orders verification, copy and cancel actions', async () => {
    const pending = view({ state: 'error', switchable: false, diagnostic: 'COPILOT_ACCOUNTS_BUSY',
      operation: 'authorizing', notices: [{
        message: 'Complete GitHub device authorization.', url: 'https://github.com/login/device', code: 'SYNTHETIC',
      }] })
    const api = remote()
    vi.mocked(api.add).mockResolvedValueOnce(ok(pending))
    await mount(api)
    await click('Add GitHub account')
    expect(text()).toContain('Adding account — waiting for GitHub authorization')
    expect(text()).toContain('Your current default account will not change.')
    expect(document.querySelector('[role="alert"]')).toBeNull()
    const details = document.querySelector<HTMLDetailsElement>('[data-copilot-account-diagnostic]')!
    expect(details.open).toBe(false)
    const authorization = document.querySelector('[data-copilot-account-authorization]')!
    expect(Array.from(authorization.querySelectorAll('a,button')).map(node => node.textContent)).toEqual([
      'Open GitHub verification', 'Copy authorization code', 'Cancel adding account',
    ])
    expect(document.querySelector('[data-copilot-current-account]')?.textContent).toBe('@demo-a')
  })
  it('copies only the displayed authorization code and announces clipboard failure with manual recovery', async () => {
    const pending = view({ state: 'error', switchable: false, diagnostic: 'COPILOT_ACCOUNTS_BUSY',
      operation: 'authorizing', notices: [{
        message: 'Complete GitHub device authorization.', url: 'https://github.com/login/device', code: 'SYNTHETIC',
      }] })
    const api = remote()
    vi.mocked(api.add).mockResolvedValueOnce(ok(pending))
    const writeText = vi.fn(async () => undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    await mount(api)
    await click('Add GitHub account')
    await click('Copy authorization code')
    await act(async () => { await Promise.resolve() })
    expect(writeText).toHaveBeenCalledExactlyOnceWith('SYNTHETIC')
    expect(text()).toContain('Authorization code copied to clipboard.')
    writeText.mockRejectedValueOnce(new Error('clipboard failure'))
    await click('Code copied')
    await act(async () => { await Promise.resolve() })
    expect(document.querySelector('[role="alert"]')?.textContent)
      .toBe('Could not copy the code. Select it above and copy it manually.')
    expect(document.querySelector('[data-copilot-account-device-code]')?.textContent).toBe('SYNTHETIC')
  })
  it('clears copied code feedback on cancel and ignores a late clipboard result', async () => {
    const pending = view({ state: 'error', switchable: false, diagnostic: 'COPILOT_ACCOUNTS_BUSY',
      operation: 'authorizing', notices: [{
        message: 'Complete GitHub device authorization.', url: 'https://github.com/login/device', code: 'SYNTHETIC',
      }] })
    const api = remote()
    vi.mocked(api.add).mockResolvedValueOnce(ok(pending))
    let finish!: () => void
    const writeText = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    vi.mocked(api.cancel).mockResolvedValueOnce(ok(view()))
    await mount(api)
    await click('Add GitHub account')
    await click('Copy authorization code')
    expect(button('Copying…').disabled).toBe(true)
    await click('Cancel adding account')
    expect(document.querySelector('[data-copilot-account-device-code]')).toBeNull()
    finish()
    await act(async () => { await Promise.resolve() })
    expect(text()).not.toContain('Authorization code copied to clipboard.')
    expect(document.querySelector('[data-copilot-current-account]')?.textContent).toBe('@demo-a')
  })
  it('shows a real authorization failure as an actionable error, not a busy status', async () => {
    await mount(remote(view({ state: 'error', switchable: false, diagnostic: 'COPILOT_ACCOUNTS_AUTH_FAILED' })))
    expect(document.querySelector('[role="alert"]')?.textContent)
      .toBe('GitHub authorization did not complete. Try adding the account again.')
    expect(text()).not.toContain('or unbound preparation')
  })
  it('shows verification as a distinct completed-OAuth phase without implying cancellation or switching', async () => {
    const verifying = view({ state: 'error', switchable: false, diagnostic: 'COPILOT_ACCOUNTS_BUSY',
      operation: 'verifying', notices: [] })
    const api = remote()
    vi.mocked(api.add).mockResolvedValueOnce(ok(verifying))
    await mount(api)
    await click('Add GitHub account')
    expect(text()).toContain('GitHub authorization complete — verifying account identity and available models')
    expect(text()).toContain('Your current default account will not change.')
    expect(button('Cancel adding account')).toBeUndefined()
    expect(button('Add GitHub account')).toBeUndefined()
    expect(api.switchAccount).not.toHaveBeenCalled()
  })
  it('localizes authorization progress and controls in Chinese', async () => {
    const pending = view({ state: 'error', switchable: false, diagnostic: 'COPILOT_ACCOUNTS_BUSY',
      operation: 'authorizing', notices: [{
        message: 'Complete GitHub device authorization.', url: 'https://github.com/login/device', code: 'SYNTHETIC',
      }] })
    const api = remote()
    vi.mocked(api.add).mockResolvedValueOnce(ok(pending))
    await mount(api, true, 'zh-CN')
    await click('添加 GitHub 账号')
    expect(text()).toContain('正在添加账号，等待 GitHub 授权')
    expect(button('复制授权码')).not.toBeNull()
    expect(button('取消添加账号')).not.toBeNull()
    expect(text()).not.toContain('COPILOT_ACCOUNTS_BUSY ·')
  })
  it('offers explicit recovery from a missing selected slot without automatic switching', async () => {
    const api = remote(view({
      state: 'error', activeAccountId: '00000000-0000-4000-8000-000000000002',
      switchable: true, diagnostic: 'COPILOT_ACCOUNTS_SELECTED_MISSING',
    }))
    await mount(api)
    expect(button('Switch').disabled).toBe(false)
    expect(button('Add GitHub account').disabled).toBe(false)
    expect(text()).toContain('COPILOT_ACCOUNTS_SELECTED_MISSING')
    expect(api.switchAccount).not.toHaveBeenCalled()
    expect(api.add).not.toHaveBeenCalled()
  })
  it('clears identity on failed reads instead of showing stale identity as current', async () => {
    const api = remote()
    await mount(api)
    vi.mocked(api.refreshIdentity).mockResolvedValueOnce({ ok: false, error: 'synthetic failure' })
    await click('Refresh account information')
    expect(text()).not.toContain('@demo-a')
    expect(text()).toContain('Could not read account information')
    expect(document.querySelector('[role="alert"]')).not.toBeNull()
  })
  it('polls only an active authorization and exposes cancellation', async () => {
    vi.useFakeTimers()
    const api = remote(view({ operation: 'authorizing', switchable: false, notices: [{
      message: 'Authorize on GitHub', url: 'https://github.com/login/device', code: 'SYNTHETIC',
    }] }))
    await mount(api)
    expect(text()).toContain('SYNTHETIC')
    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
    expect(api.get).toHaveBeenCalledOnce()
    await click('Cancel adding account')
    expect(api.cancel).toHaveBeenCalledOnce()
  })
})
