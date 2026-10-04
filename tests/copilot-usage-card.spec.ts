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

describe('Copilot account usage chip', () => {
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
    expect(trigger().textContent).toContain('12 used')
    await click(button('Switch account'))
    await click(button('Follow global default'))
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
