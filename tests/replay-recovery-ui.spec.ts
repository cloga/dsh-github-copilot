// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { ReplayRecoveryCard } from '../src/replay-recovery-ui.ts'
import type { ReplayRecoveryDuration } from '../src/replay-recovery-types.ts'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); vi.useRealTimers() })
const available = { state: 'available', revision: '12345678-1234-4234-8234-123456789012', itemCount: 12, model: 'synthetic-model' }
function fixture(value: unknown = available) {
  const remote = {
    get: vi.fn(async (): Promise<{ ok: boolean; value?: unknown }> => ({ ok: true, value })),
    setEnabled: vi.fn(async () => ({ ok: true, value: available })),
    authorize: vi.fn(async (_id: string, _revision: string, duration: ReplayRecoveryDuration) =>
      ({ ok: true, value: { ...available, state: 'enabled', duration } })),
  }
  const node = document.createElement('div'); document.body.append(node)
  const root = createRoot(node)
  const render = (props: { running?: boolean; refreshKey?: string; sessionId?: string } = {}) =>
    act(async () => root.render(createElement(ReplayRecoveryCard, { key: props.sessionId ?? 'viewed',
      remote, sessionId: 'viewed', ...props })))
  const click = async (text: string) => {
    const button = Array.from(node.querySelectorAll('button')).find(value => value.textContent === text)!
    expect(button.type).toBe('button')
    await act(async () => button.click())
  }
  return { remote, node, render, click, close: () => act(async () => root.unmount()) }
}
it.each(['next-turn', 'session'] as const)('automatically shows evidence but requires explicit %s consent, without sending', async duration => {
  const f = fixture()
  try {
    await f.render()
    expect(f.remote.get).toHaveBeenCalledExactlyOnceWith('viewed')
    expect(f.node.textContent).toContain('Old reasoning replay was rejected')
    await f.click('Review recovery options')
    expect(f.node.textContent).toContain('including their hidden reasoning state and item summaries')
    expect(f.remote.authorize).not.toHaveBeenCalled()
    expect(f.node.querySelector<HTMLInputElement>('input[value=next-turn]')!.checked).toBe(true)
    await f.click('Cancel')
    await f.click('Review recovery options')
    if (duration === 'session') await act(async () => f.node.querySelector<HTMLInputElement>('input[value=session]')!.click())
    await f.click('Accept loss and authorize')
    expect(f.remote.authorize).toHaveBeenCalledExactlyOnceWith('viewed', available.revision, duration)
    expect(f.remote.setEnabled).not.toHaveBeenCalled()
    expect(f.node.textContent).toContain('No message has been sent.')
    await f.click('Disable recovery')
    expect(f.remote.setEnabled).toHaveBeenCalledExactlyOnceWith('viewed', available.revision, false)
  } finally { await f.close() }
})
it('is absent normally, reads on settled turns without polling and resets dismissal only for new evidence', async () => {
  const f = fixture({ state: 'unavailable' })
  try {
    await f.render()
    expect(f.node.textContent).toBe('')
    await f.render()
    expect(f.remote.get).toHaveBeenCalledTimes(1)
    await f.render({ running: true })
    expect(f.remote.get).toHaveBeenCalledTimes(1)
    f.remote.get.mockResolvedValue({ ok: true, value: available })
    await f.render({ running: false })
    expect(f.node.textContent).toContain('Old reasoning replay was rejected')
    await f.click('Not now')
    expect(f.node.textContent).toBe('Replay recovery · Review')
    await f.render({ refreshKey: 'native failure changed' })
    expect(f.node.textContent).toBe('Replay recovery · Review')
    await f.click('Replay recovery · Review')
    await f.click('Not now')
    f.remote.get.mockResolvedValue({ ok: true, value: { ...available, revision: '22345678-1234-4234-8234-123456789012' } })
    await f.render({ refreshKey: 'new failure' })
    expect(f.node.textContent).toContain('Old reasoning replay was rejected')
    expect(f.remote.authorize).not.toHaveBeenCalled()
  } finally { await f.close() }
})
it('coalesces reads and ignores a departed session result', async () => {
  const f = fixture()
  let settle: (result: { ok: boolean; value: unknown }) => void = () => { throw new Error('not started') }
  f.remote.get.mockImplementationOnce(() => new Promise(resolve => { settle = resolve }))
  try {
    await f.render({ sessionId: 'old' })
    await f.render({ sessionId: 'old', refreshKey: 'changed' })
    expect(f.remote.get).toHaveBeenCalledExactlyOnceWith('old')
    f.remote.get.mockResolvedValue({ ok: true, value: { state: 'unavailable' } })
    await f.render({ sessionId: 'new' })
    await act(async () => settle({ ok: true, value: { ...available, model: 'old-model' } }))
    expect(f.node.textContent).toBe('')
    expect(f.remote.get).toHaveBeenCalledTimes(2)
    expect(f.remote.authorize).not.toHaveBeenCalled()
  } finally { await f.close() }
})
it('shows failed reads separately and disables writes while the native turn runs', async () => {
  const f = fixture()
  f.remote.get.mockResolvedValueOnce({ ok: false })
  try {
    await f.render()
    expect(f.node.querySelector('[role=alert]')).not.toBeNull()
    expect(f.node.textContent).not.toContain('no current failure evidence')
    await f.click('Read status again')
    await f.click('Review recovery options')
    await f.render({ running: true })
    expect(f.node.textContent).not.toContain('Accept loss and authorize')
    expect(Array.from(f.node.querySelectorAll('button')).every(button => button.disabled)).toBe(true)
    expect(f.remote.authorize).not.toHaveBeenCalled()
  } finally { await f.close() }
})
it('reads once at evidence expiry and drops expired activation', async () => {
  vi.useFakeTimers()
  const f = fixture({ ...available, state: 'enabled', duration: 'session', expiresAt: Date.now() + 500 })
  try {
    await f.render()
    f.remote.get.mockResolvedValue({ ok: true, value: { state: 'unavailable' } })
    await act(async () => vi.advanceTimersByTimeAsync(500))
    expect(f.remote.get).toHaveBeenCalledTimes(2)
    expect(f.node.textContent).toContain('Authorization or failure evidence expired')
    expect(f.node.textContent).not.toContain('Disable recovery')
    await act(async () => vi.advanceTimersByTimeAsync(60_000))
    expect(f.remote.get).toHaveBeenCalledTimes(2)
  } finally { await f.close() }
})
