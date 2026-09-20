// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CopilotUsageCard } from '../src/copilot-usage-card.ts'
import type { CopilotUsageRemote, CopilotUsageCardProps } from '../src/copilot-usage-card.ts'
import type { CopilotUsageView } from '../src/copilot-usage-types.ts'

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
  it('shows exact supplied units, account scope and honest session unavailability', async () => {
    const api = remote()
    await mount({ remote: api, contextKey: 'a' })
    expect(trigger().textContent).toContain('42.25 used')
    expect(trigger().textContent).toContain('57.75 left')
    expect(api.get).toHaveBeenCalledTimes(1)
    await click(trigger())
    expect(text()).toContain('Account-wide')
    expect(text()).toContain('This session')
    expect(text()).toContain('Not available')
    expect(text()).toContain('does not expose per-session billing usage')
    expect(text()).not.toContain('673')
    expect(document.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('42.25')
  })

  it('never derives remaining from a percentage and does not turn unknown into zero', async () => {
    await mount({ remote: remote(view({ remaining: undefined, used: undefined, percentUsed: 25 })), contextKey: 'a' })
    expect(trigger().textContent).not.toContain('75')
    await click(trigger())
    expect(text()).toContain('Not available')
    expect(text()).not.toMatch(/\b0 used\b/)
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
    expect(text()).toContain('本会话')
    expect(text()).toContain('暂不可用')
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
