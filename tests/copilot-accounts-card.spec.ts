// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { accountsViewFrom, CopilotAccountAdd, CopilotAccountsPanel } from '../src/copilot-accounts-card.ts'
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

it('settles a stalled metadata read and ignores its late response after an explicit retry', async () => {
  vi.useFakeTimers()
  const api = remote()
  let finish!: (value: ReturnType<typeof ok>) => void
  vi.mocked(api.get).mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
  await mount(api)
  await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
  expect(text()).toContain('Could not read account information. Retry before changing accounts.')
  expect(button('Retry').disabled).toBe(false)
  expect(api.get).toHaveBeenCalledOnce()
  await click('Retry')
  expect(text()).toContain('@demo-a')
  await act(async () => { finish(ok(view({ activeAccountId: view().accounts[1]!.id }))) })
  expect(document.querySelector('[data-copilot-current-account]')?.textContent).toBe('@demo-a')
})

it.each(['ensureIdentity', 'refreshIdentity'] as const)('bounds a stalled %s without retrying or leaving Checking', async method => {
  vi.useFakeTimers()
  const api = remote()
  vi.mocked(api[method]).mockReturnValue(new Promise(() => {}))
  await mount(api)
  if (method === 'refreshIdentity') await click('Refresh account information')
  await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
  expect(text()).not.toContain('Checking')
  expect(api[method]).toHaveBeenCalledOnce()
  expect(api.switchAccount).not.toHaveBeenCalled()
  expect(api.removeAccount).not.toHaveBeenCalled()
  expect(button('Refresh account information').disabled).toBe(false)
})

it('does not turn an unresolved account mutation into a timed-out read or unlock a second mutation', async () => {
  vi.useFakeTimers()
  const api = remote()
  vi.mocked(api.switchAccount).mockReturnValue(new Promise(() => {}))
  await mount(api)
  await click('Switch'); await click('@demo-b'); await click('Confirm switch')
  await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
  expect(button('Switch').disabled).toBe(true)
  expect(api.switchAccount).toHaveBeenCalledOnce()
  expect(text()).not.toContain('Retry before changing accounts.')
})

it('clears read deadlines on disposal and ignores a late identity result', async () => {
  vi.useFakeTimers()
  const api = remote()
  let finish!: (value: ReturnType<typeof ok>) => void
  vi.mocked(api.ensureIdentity).mockReturnValue(new Promise(resolve => { finish = resolve }))
  await mount(api)
  await act(async () => { cleanups.splice(0).forEach(dispose => dispose()) })
  expect(vi.getTimerCount()).toBe(0)
  await act(async () => { finish(ok(view())) })
  expect(text()).toBe('')
  expect(api.ensureIdentity).toHaveBeenCalledOnce()
})

async function chooseEnterprise(host = 'tenant.ghe.com') {
  const select = document.querySelector<HTMLSelectElement>('[data-copilot-login-environment] select')!
  await act(async () => {
    select.value = 'enterprise'
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
  const input = document.querySelector<HTMLInputElement>('[data-copilot-login-environment] input')!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, host)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

it('chooses a validated GHE environment without selecting an account or changing GitHub.com login', async () => {
  const api = remote()
  api.addForEnvironment = vi.fn(async () => ok(view()))
  await mount(api)
  await chooseEnterprise('https://TENANT.ghe.com/')
  expect(button('Reauthorize').disabled).toBe(true)
  await click('Switch'); await click('Add GitHub account')
  expect(api.addForEnvironment).toHaveBeenCalledExactlyOnceWith('tenant.ghe.com')
  expect(api.add).not.toHaveBeenCalled()
  expect(api.switchAccount).not.toHaveBeenCalled()
  expect(text()).toContain('GitHub Enterprise Server is not supported.')
})

it.each(['evil.example', 'https://tenant.ghe.com:443', 'https://tenant.ghe.com/path'])(
  'keeps invalid environment drafts local: %s', async host => {
    const api = remote()
    api.addForEnvironment = vi.fn(async () => ok(view()))
    await mount(api)
    await chooseEnterprise(host)
    expect(document.querySelector('input')?.getAttribute('aria-invalid')).toBe('true')
    await click('Switch')
    expect(button('Add GitHub account').disabled).toBe(true)
    expect(api.addForEnvironment).not.toHaveBeenCalled()
    expect(api.add).not.toHaveBeenCalled()
  })

it('reauthorizes a saved GHE account independently of Add with explicit host and revision', async () => {
  const api = remote()
  api.reauthorizeForEnvironment = vi.fn(async () => ok(view()))
  await mount(api)
  await chooseEnterprise()
  await click('Switch')
  expect(button('Add GitHub account').disabled).toBe(true)
  await click('Reauthorize')
  expect(api.reauthorizeForEnvironment).toHaveBeenCalledExactlyOnceWith(view().accounts[1]!.id, 2, 'tenant.ghe.com')
  expect(api.reauthorize).not.toHaveBeenCalled()
  expect(api.add).not.toHaveBeenCalled()
})

it('shows the verified tenant in account labels and preserves it through Client field projection', async () => {
  const value = view()
  const tenantView = { ...value, accounts: value.accounts.map(account => ({
    ...account, identity: { login: 'same-user', userId: 1, ...account.id === 'canonical' ? {} : { host: 'tenant.ghe.com' } },
  })) }
  expect(accountsViewFrom(tenantView)).toEqual(tenantView)
  await mount(remote(tenantView))
  await click('Switch')
  expect(button('@same-user · tenant.ghe.com')).toBeDefined()
  expect(button('@same-user')).toBeDefined()
})

it('keeps GHE login disabled with an explicit diagnostic on older Host contracts', async () => {
  const api = remote()
  await mount(api)
  await chooseEnterprise()
  expect(text()).toContain('This deployment does not support every GHE.com authorization action.')
  await click('Switch')
  expect(button('Add GitHub account').disabled).toBe(true)
  expect(api.add).not.toHaveBeenCalled()
})

it('renders metadata and permits a confirmed switch while unrelated identity names remain pending', async () => {
  const api = remote()
  let finish!: (value: { ok: true; value: CopilotAccountsView }) => void
  vi.mocked(api.ensureIdentity).mockReturnValue(new Promise(resolve => { finish = resolve }))
  const selected = view({ activeAccountId: view().accounts[1]!.id, revision: 3 })
  vi.mocked(api.switchAccount).mockResolvedValue(ok(selected))
  await mount(api)
  expect(api.get).toHaveBeenCalledOnce()
  expect(button('Switch').disabled).toBe(false)
  expect(text()).toContain('@demo-a')
  await click('Switch')
  await click('@demo-b')
  await click('Confirm switch')
  expect(document.querySelector('[data-copilot-current-account]')?.textContent).toBe('@demo-b')
  expect(button('Switch').disabled).toBe(false)
  await act(async () => { finish(ok(view())) })
  expect(document.querySelector('[data-copilot-current-account]')?.textContent).toBe('@demo-b')
  expect(api.switchAccount).toHaveBeenCalledOnce()
})

it('uses the latest parent callback without resetting a pending switch or repeating initial reads', async () => {
  const api = remote()
  let finish!: (value: { ok: true; value: CopilotAccountsView }) => void
  vi.mocked(api.switchAccount).mockReturnValue(new Promise(resolve => { finish = resolve }))
  const first = vi.fn(), latest = vi.fn()
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container); cleanups.push(() => root.unmount())
  const render = async (onChanged: () => void) => {
    await act(async () => { root.render(createElement(CopilotAccountsPanel, { remote: api, expanded: true, onChanged })) })
  }
  await render(first)
  await click('Switch'); await click('@demo-b'); await click('Confirm switch')
  await render(latest)
  expect(button('Switch').disabled).toBe(true)
  expect(api.ensureIdentity).toHaveBeenCalledOnce()
  await act(async () => { finish(ok(view({ activeAccountId: view().accounts[1]!.id, revision: 3 }))) })
  expect(latest).toHaveBeenCalledOnce()
  expect(first).not.toHaveBeenCalled()
  expect(document.querySelector('[data-copilot-current-account]')?.textContent).toBe('@demo-b')
})

it('distinguishes failed identity display hydration from unread account metadata', async () => {
  const api = remote()
  vi.mocked(api.ensureIdentity).mockRejectedValue(new Error('Synthetic identity read failure'))
  await mount(api)
  expect(text()).toContain('Could not verify the GitHub account identity. Try again.')
  expect(text()).not.toContain('Retry before changing accounts.')
  expect(button('Switch').disabled).toBe(false)
  expect(text()).toContain('@demo-a')
})

it('does not hydrate identity or enable switching after the initial metadata read fails', async () => {
  const api = remote()
  vi.mocked(api.get).mockRejectedValue(new Error('Synthetic metadata read failure'))
  await mount(api)
  expect(api.ensureIdentity).not.toHaveBeenCalled()
  expect(text()).toContain('Could not read account information. Retry before changing accounts.')
  expect(button('Switch').disabled).toBe(true)
})

it('ignores identity hydration after the account Remote lifetime is replaced', async () => {
  const api = remote(), replacement = remote(view({ accounts: [], state: 'error', switchable: false,
    diagnostic: 'COPILOT_ACCOUNTS_SELECTED_MISSING' }))
  let finish!: (value: { ok: true; value: CopilotAccountsView }) => void
  vi.mocked(api.ensureIdentity).mockReturnValue(new Promise(resolve => { finish = resolve }))
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container); cleanups.push(() => root.unmount())
  await act(async () => { root.render(createElement(CopilotAccountsPanel, { remote: api, expanded: true })) })
  await act(async () => { root.render(createElement(CopilotAccountsPanel, { remote: replacement, expanded: true })) })
  await act(async () => { finish(ok(view())) })
  expect(text()).not.toContain('@demo-a')
  expect(button('Switch').disabled).toBe(true)
})

it('refreshes the shared settings revision after a continuation-default save without rediscovery', async () => {
  const api = remote()
  vi.mocked(api.get).mockResolvedValue(ok(view({ revision: 3 })))
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container)
  cleanups.push(() => root.unmount())
  const render = (refreshKey: number) => root.render(createElement(CopilotAccountsPanel, { remote: api, expanded: true, refreshKey }))
  await act(async () => render(0))
  expect(api.ensureIdentity).toHaveBeenCalledOnce()
  expect(api.get).toHaveBeenCalledOnce()
  await act(async () => render(1))
  expect(api.get).toHaveBeenCalledTimes(2)
  expect(api.ensureIdentity).toHaveBeenCalledOnce()
  await click('Switch')
  await click('@demo-b')
  await click('Confirm switch')
  expect(api.switchAccount).toHaveBeenCalledWith('00000000-0000-4000-8000-000000000001', 3)
})

describe('Chat Add-only account authorization', () => {
  async function mountAdd(api: CopilotAccountsRemote, onChanged = vi.fn()) {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    cleanups.push(() => root.unmount())
    await act(async () => { root.render(createElement(CopilotAccountAdd, {
      remote: { get: api.get, add: api.add, cancel: api.cancel }, onChanged,
    })) })
    return root
  }
  it('uses only the narrow Remote and never exposes management or identity controls', async () => {
    const api = remote()
    await mountAdd(api)
    expect(api.get).toHaveBeenCalledOnce()
    expect(api.ensureIdentity).not.toHaveBeenCalled()
    expect(Array.from(document.querySelectorAll('button')).map(node => node.textContent)).toEqual(['Add GitHub account'])
    expect(text()).not.toContain('demo-a')
    expect(document.querySelector('[data-copilot-account-management]')).toBeNull()
    await click('Add GitHub account')
    expect(api.add).toHaveBeenCalledOnce()
    expect(api.switchAccount).not.toHaveBeenCalled()
    expect(api.removeAccount).not.toHaveBeenCalled()
    expect(api.reauthorize).not.toHaveBeenCalled()
  })
  it('retains code copy, manual verification, cancellation and bounded polling', async () => {
    vi.useFakeTimers()
    const api = remote()
    const pending = view({ operation: 'authorizing', switchable: false, notices: [{
      message: 'Authorize on GitHub', url: 'https://github.com/login/device', code: 'SYNTHETIC',
    }] })
    vi.mocked(api.add).mockResolvedValueOnce(ok(pending))
    vi.mocked(api.get).mockResolvedValueOnce(ok(view())).mockResolvedValue(ok(pending))
    const writeText = vi.fn(async () => undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const root = await mountAdd(api)
    await click('Add GitHub account')
    expect(text()).toContain('Your current default account will not change.')
    expect(text()).toContain('https://github.com/login/device')
    await click('Copy authorization code')
    expect(writeText).toHaveBeenCalledExactlyOnceWith('SYNTHETIC')
    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
    expect(api.get).toHaveBeenCalledTimes(2)
    await click('Cancel adding account')
    expect(api.cancel).toHaveBeenCalledOnce()
    expect(document.querySelector('[data-copilot-account-device-code]')).toBeNull()
    await act(async () => { root.render(null); await vi.advanceTimersByTimeAsync(60_000) })
    expect(api.get).toHaveBeenCalledTimes(2)
  })
  it('notifies completion after verification and stops polling', async () => {
    vi.useFakeTimers()
    const api = remote()
    const onChanged = vi.fn()
    vi.mocked(api.add).mockResolvedValueOnce(ok(view({ operation: 'verifying', switchable: false })))
    await mountAdd(api, onChanged)
    await click('Add GitHub account')
    expect(onChanged).not.toHaveBeenCalled()
    expect(button('Cancel adding account')).toBeUndefined()
    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
    expect(onChanged).toHaveBeenCalledOnce()
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(api.get).toHaveBeenCalledTimes(2)
  })
  it('fails closed with a status-only Retry on rejected reads', async () => {
    const api = remote()
    vi.mocked(api.get).mockRejectedValueOnce(new Error('private failure'))
    await mountAdd(api)
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Could not read account information')
    expect(text()).not.toContain('private failure')
    expect(button('Add GitHub account').disabled).toBe(true)
    await click('Retry')
    expect(api.get).toHaveBeenCalledTimes(2)
    expect(api.add).not.toHaveBeenCalled()
    expect(button('Add GitHub account').disabled).toBe(false)
  })
  it('preserves Host admission restrictions and retries status without starting authorization', async () => {
    const api = remote(view({ state: 'error', switchable: false, diagnostic: 'COPILOT_ACCOUNTS_AUTH_FAILED' }))
    await mountAdd(api)
    expect(button('Add GitHub account').disabled).toBe(true)
    expect(text()).toContain('GitHub authorization did not complete')
    vi.mocked(api.get).mockResolvedValueOnce(ok(view()))
    await click('Retry')
    expect(api.add).not.toHaveBeenCalled()
    expect(button('Add GitHub account').disabled).toBe(false)
  })
  it('drops late OAuth results and notifies no completion after unmount', async () => {
    vi.useFakeTimers()
    const api = remote(view({ operation: 'authorizing', switchable: false }))
    const onChanged = vi.fn()
    const root = await mountAdd(api, onChanged)
    let finish!: (result: ReturnType<typeof ok>) => void
    vi.mocked(api.get).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
    await act(async () => { root.render(null) })
    await act(async () => { finish(ok(view())); await vi.advanceTimersByTimeAsync(60_000) })
    expect(api.get).toHaveBeenCalledTimes(2)
    expect(api.cancel).not.toHaveBeenCalled()
    expect(onChanged).not.toHaveBeenCalled()
  })
})

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
    expect(text()).toContain('@demo-b')
    await click('@demo-b')
    expect(api.switchAccount).not.toHaveBeenCalled()
    expect(text()).toContain('encrypted reasoning')
    await click('Confirm switch')
    expect(api.switchAccount).toHaveBeenCalledExactlyOnceWith(view().accounts[1]!.id, 2)
  })
  it('requires removal confirmation without offering removal of the active compatibility account', async () => {
    const api = remote()
    await mount(api)
    await click('Switch')
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
    await click('Switch')
    await click('Reauthorize')
    expect(api.reauthorize).toHaveBeenCalledExactlyOnceWith(view().accounts[1]!.id, 2)
    expect(api.add).not.toHaveBeenCalled()
    expect(api.switchAccount).not.toHaveBeenCalled()
  })
  it('reauthorizes the current additional account without opening the saved list or offering removal', async () => {
    const accountId = view().accounts[1]!.id
    const api = remote(view({ activeAccountId: accountId }))
    await mount(api)
    expect(document.querySelector('[data-copilot-account-selector]')).toBeNull()
    await click('Reauthorize')
    expect(api.reauthorize).toHaveBeenCalledExactlyOnceWith(accountId, 2)
    expect(button('Remove')).toBeUndefined()
    expect(api.switchAccount).not.toHaveBeenCalled()
  })
  it('closes the selector and discards pending confirmation when Manage closes without restarting identity', async () => {
    const api = remote()
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    cleanups.push(() => root.unmount())
    const render = async (expanded: boolean) => {
      await act(async () => { root.render(createElement(CopilotAccountsPanel, { remote: api, expanded })) })
    }
    await render(true)
    await click('Switch')
    await click('@demo-b')
    await render(false)
    await render(true)
    expect(document.querySelector('[data-copilot-account-selector]')).toBeNull()
    expect(button('Confirm switch')).toBeUndefined()
    expect(api.ensureIdentity).toHaveBeenCalledOnce()
    expect(api.switchAccount).not.toHaveBeenCalled()
  })
  it('opens a bounded dropdown without search and marks the current account', async () => {
    const api = remote()
    await mount(api)
    expect(text()).toContain('@demo-a')
    expect(document.querySelector('[data-copilot-account-selector]')).toBeNull()
    expect(button('Switch')).toBeDefined()
    await click('Switch')
    expect(button('Add GitHub account')).toBeDefined()
    const list = document.querySelector<HTMLElement>('[data-copilot-saved-accounts]')
    expect(list?.style.maxHeight).toBe('240px')
    expect(list?.style.overflowY).toBe('auto')
    expect(document.querySelector('input[type=search]')).toBeNull()
    expect(text()).toContain('@demo-b')
    expect(button('@demo-a').getAttribute('aria-pressed')).toBe('true')
    expect(document.querySelector('[data-copilot-current-account]')?.textContent).toBe('@demo-a')
    expect(Array.from(document.querySelectorAll('[data-copilot-saved-account]'))).toHaveLength(2)
  })
  it('renders optional continuation settings only inside the expanded account management section', async () => {
    const api = remote()
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    cleanups.push(() => root.unmount())
    const continuation = createElement('div', { 'data-continuation-settings': true }, 'Continuation settings')
    await act(async () => { root.render(createElement(CopilotAccountsPanel, {
      remote: api, expanded: false, continuationSettings: continuation,
    })) })
    expect(document.querySelector('[data-continuation-settings]')).toBeNull()
    await act(async () => { root.render(createElement(CopilotAccountsPanel, {
      remote: api, expanded: true, continuationSettings: continuation,
    })) })
    expect(document.querySelector('[data-continuation-settings]')?.textContent).toBe('Continuation settings')
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
    await click('Switch')
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
    expect(document.querySelector('[data-copilot-account-selector]')).toBeNull()
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
    await click('Switch')
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
    await click('Switch')
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
    await click('Switch')
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
    await click('Switch')
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
    await click('切换')
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
    await click('Switch')
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
    expect(api.get).toHaveBeenCalledTimes(2)
    await click('Cancel adding account')
    expect(api.cancel).toHaveBeenCalledOnce()
  })
})
