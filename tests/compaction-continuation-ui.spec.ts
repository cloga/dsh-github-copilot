// @vitest-environment jsdom
import { act, createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { CompactionContinuationNotice, CompactionNoticePresentation } from '../src/compaction-continuation-ui.ts'
import type { CompactionContinuationStatus } from '../src/session-continuation-types.ts'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })
it.each(['running', 'completed', 'failed', 'cancelled', 'blocked'] as const)(
  'shows truthful native summary state %s without sending or retrying', async state => {
    const node = document.createElement('div')
    document.body.append(node)
    const root = createRoot(node)
    const remote = { get: vi.fn(async () => ({ ok: true, value: {
      enabled: state !== 'blocked', revision: 1, compaction: { id: 'fixture', state },
    } })), set: vi.fn(async () => ({ ok: false })) }
    try {
      await act(async () => root.render(h(CompactionContinuationNotice, {
        sessionId: 'fixture-session', remote, lifecycle: { id: 'fixture', running: false },
      })))
      const expected = { running: 'Compacting with visible history', completed: 'compaction committed',
        failed: 'compaction failed', cancelled: 'compaction cancelled', blocked: 'compaction did not commit' }
      expect(node.textContent).toContain(expected[state])
      expect(remote.set).not.toHaveBeenCalled()
      if (state === 'blocked') expect(node.textContent).toContain('Enable visible-history continuation')
    } finally { await act(async () => root.unmount()); node.remove() }
  })

function fixture(state: CompactionContinuationStatus['state'] = 'completed') {
  vi.useFakeTimers()
  const presentation = new CompactionNoticePresentation()
  let value: unknown = { enabled: state !== 'blocked', revision: 1, compaction: { id: 'first', state } }
  const remote = { get: vi.fn(async (): Promise<{ ok: boolean; value?: unknown }> => ({ ok: true, value })),
    set: vi.fn(async () => ({ ok: false })) }
  const node = document.createElement('div')
  document.body.append(node)
  const root = createRoot(node)
  const render = (sessionId = 'session', id = 'first', running = false, locale = 'en') =>
    act(async () => root.render(h(CompactionContinuationNotice, {
      presentation, sessionId, remote, lifecycle: { id, running }, locale,
    })))
  const click = (text = 'Close') => act(async () => {
    const button = Array.from(node.querySelectorAll('button')).find(button => button.textContent === text)
    expect(button).toBeDefined()
    button!.click()
  })
  return { presentation, node, remote, render, click,
    set: (next: unknown) => { value = next },
    advance: (ms: number) => act(async () => vi.advanceTimersByTimeAsync(ms)),
    hide: () => act(async () => root.render(null)),
    close: async () => { await act(async () => root.unmount()); presentation.dispose(); node.remove() } }
}

it('expires eight seconds after first confirmed completion, not rerender, reread or remount', async () => {
  const f = fixture()
  try {
    await f.render()
    await f.advance(4000)
    await f.render()
    await f.hide()
    expect(vi.getTimerCount()).toBe(0)
    await f.advance(3000)
    await f.render()
    expect(f.node.textContent).toContain('compaction committed')
    await f.advance(999)
    expect(f.node.textContent).toContain('compaction committed')
    await f.advance(1)
    expect(f.node.textContent).toBe('')
    await f.hide()
    await f.render()
    expect(f.node.textContent).toBe('')
    expect(f.remote.set).not.toHaveBeenCalled()
  } finally { await f.close() }
})

it.each(['completed', 'failed', 'cancelled', 'blocked'] as const)(
  'dismisses %s only for its Session, operation and state without policy writes', async state => {
    const f = fixture(state)
    try {
      await f.render()
      await f.click()
      expect(f.node.textContent).toBe('')
      await f.hide()
      await f.render()
      expect(f.node.textContent).toBe('')
      await f.render('other-session')
      expect(f.node.textContent).not.toBe('')
      await f.render()
      expect(f.node.textContent).toBe('')
      f.set({ enabled: true, revision: 1, compaction: { id: 'second', state } })
      await f.render('session', 'second')
      expect(f.node.textContent).not.toBe('')
      f.set({ enabled: true, revision: 1, compaction: { id: 'first', state: 'running' } })
      await f.render('session', 'first', true)
      expect(f.node.textContent).toContain('Compacting with visible history')
      expect(f.node.querySelector('button')).toBeNull()
      f.set({ enabled: true, revision: 1, compaction: { id: 'first', state: state === 'failed' ? 'cancelled' : 'failed' } })
      await f.render()
      expect(f.node.textContent).not.toBe('')
      expect(f.remote.set).not.toHaveBeenCalled()
    } finally { await f.close() }
  })

it.each(['failed', 'cancelled', 'blocked'] as const)('never automatically expires actionable %s', async state => {
  const f = fixture(state)
  try {
    await f.render()
    await f.advance(60_000)
    expect(f.node.textContent).not.toBe('')
    if (state === 'blocked') {
      await f.click('Cancel')
      expect(f.node.textContent).toBe('')
    }
    expect(f.remote.set).not.toHaveBeenCalled()
  } finally { await f.close() }
})

it('keeps unavailable distinct and dismissible without hiding a later failure', async () => {
  const f = fixture()
  f.remote.get.mockResolvedValue({ ok: false })
  try {
    await f.render()
    await f.advance(60_000)
    expect(f.node.textContent).toContain('status is unavailable')
    await f.click()
    await f.hide()
    await f.render()
    expect(f.node.textContent).toBe('')
    f.remote.get.mockResolvedValue({ ok: true, value: { enabled: true, revision: 1,
      compaction: { id: 'first', state: 'failed' } } })
    await f.hide()
    await f.render()
    expect(f.node.textContent).toContain('compaction failed')
    expect(f.remote.set).not.toHaveBeenCalled()
  } finally { await f.close() }
})

it('does not offer dismissal for unavailable reads while the native bracket is running', async () => {
  const f = fixture()
  f.remote.get.mockRejectedValue(new Error('synthetic unavailable'))
  try {
    await f.render('session', 'first', true)
    expect(f.node.textContent).toContain('status is unavailable')
    expect(f.node.querySelector('button')).toBeNull()
    await f.render()
    await f.click()
    expect(f.node.textContent).toBe('')
    expect(f.remote.set).not.toHaveBeenCalled()
  } finally { await f.close() }
})

it('does not reuse a settled notice when current Host evidence belongs to another operation', async () => {
  const f = fixture()
  try {
    await f.render()
    await f.render('session', 'new-operation')
    expect(f.node.textContent).toBe('')
    expect(vi.getTimerCount()).toBe(0)
  } finally { await f.close() }
})

it('polls running status without a close control and starts expiry only on completion', async () => {
  const f = fixture('running')
  try {
    await f.render('session', 'first', true)
    await f.advance(9000)
    expect(f.node.textContent).toContain('Compacting with visible history')
    expect(f.node.querySelector('button')).toBeNull()
    f.set({ enabled: true, revision: 1, compaction: { id: 'first', state: 'completed' } })
    await f.render()
    await f.advance(7999)
    expect(f.node.textContent).toContain('compaction committed')
    await f.advance(1)
    expect(f.node.textContent).toBe('')
    expect(vi.getTimerCount()).toBe(0)
  } finally { await f.close() }
})

it('ignores late responses after Session/operation changes and unmount, including expiry observation', async () => {
  const f = fixture()
  let settle!: (value: { ok: boolean; value: unknown }) => void
  f.remote.get.mockImplementationOnce(() => new Promise(resolve => { settle = resolve }))
  try {
    await f.render('old-session')
    f.set({ enabled: true, revision: 1, compaction: { id: 'second', state: 'failed' } })
    await f.render('session', 'second')
    await act(async () => settle({ ok: true, value: { enabled: true, revision: 1,
      compaction: { id: 'first', state: 'completed' } } }))
    expect(f.node.textContent).toContain('compaction failed')
    f.remote.get.mockImplementationOnce(() => new Promise(resolve => { settle = resolve }))
    await f.render('old-session')
    await f.hide()
    await act(async () => settle({ ok: true, value: { enabled: true, revision: 1,
      compaction: { id: 'first', state: 'completed' } } }))
    await f.advance(9000)
    f.set({ enabled: true, revision: 1, compaction: { id: 'first', state: 'completed' } })
    await f.render('old-session')
    expect(f.node.textContent).toContain('compaction committed')
    await f.advance(8000)
    expect(f.node.textContent).toBe('')
  } finally { await f.close() }
})

it('localizes Close and preserves native full-width auxiliary typography', async () => {
  const f = fixture('failed')
  try {
    await f.render('session', 'first', false, 'zh-CN')
    const section = f.node.querySelector('section')!
    expect(section.style.width).toBe('100%')
    expect(section.style.fontSize).toBe('var(--dsh-content-font-size-secondary, 13px)')
    const button = f.node.querySelector('button')!
    expect(button.type).toBe('button')
    expect(button.textContent).toBe('关闭')
    expect(button.getAttribute('aria-label')).toBe('关闭压缩提示')
    expect(button.style.fontSize).toBe('inherit')
    await f.click('关闭')
    expect(f.node.textContent).toBe('')
  } finally { await f.close() }
})

it('bounds presentation records and clears them on registration disposal', () => {
  const presentation = new CompactionNoticePresentation()
  presentation.dismiss('old', 'first', 'failed')
  for (let index = 0; index < 128; index++) presentation.dismiss(`session-${index}`, 'first', 'failed')
  expect(presentation.visible('old', 'first', 'failed')).toBe(true)
  expect(presentation.visible('session-127', 'first', 'failed')).toBe(false)
  presentation.dispose()
  expect(presentation.visible('session-127', 'first', 'failed')).toBe(true)
})
