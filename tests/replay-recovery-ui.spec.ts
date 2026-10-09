// @vitest-environment jsdom
import { act, createElement } from 'react'
import type { ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, expect, it, vi } from 'vitest'
import { ReplayRecoveryCard, registerReplayRecoveryUi } from '../src/replay-recovery-ui.ts'
import type { ReplayRecoveryDuration } from '../src/replay-recovery-types.ts'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); vi.useRealTimers() })
const available = { state: 'available', revision: '12345678-1234-4234-8234-123456789012', itemCount: 12, model: 'synthetic-model' }
it('registers recovery only in the public full-width Session input dock', () => {
  const dispose = vi.fn()
  const slots = {
    spec: vi.fn(() => ({ kind: 'list', scope: 'session' })),
    inject: vi.fn((_name: string, activate: () => () => void) => activate()),
    register: vi.fn(() => dispose),
  }
  const ctx = { get: (name: string) => name === 'slots' ? slots : undefined,
    remote: { githubCopilotReplayRecovery: {} }, logger: { warn: vi.fn() } }
  const cleanup = registerReplayRecoveryUi(ctx as unknown as Context)
  expect(slots.inject).toHaveBeenCalledWith('conversation.input.dock', expect.any(Function))
  expect(slots.register).toHaveBeenCalledWith(
    { name: 'conversation.input.dock', id: 'github-copilot-replay-recovery', order: 30 }, expect.any(Function))
  cleanup()
  expect(dispose).toHaveBeenCalledOnce()
})
it('keeps replay recovery separate from independently registered compaction feedback', async () => {
  let surface!: (props: Record<string, unknown>) => ReactElement | null
  const slots = {
    spec: () => ({ kind: 'list', scope: 'session' }),
    inject: (_name: string, activate: () => () => void) => activate(),
    register: (_options: unknown, component: typeof surface) => { surface = component; return vi.fn() },
  }
  const continuation = { get: vi.fn(async () => ({ ok: true, value: {
    enabled: true, revision: 1, compaction: { id: 'compaction', state: 'completed' },
  } })), set: vi.fn() }
  const ctx = { get: (name: string) => name === 'slots' ? slots : undefined, logger: { warn: vi.fn() },
    remote: { githubCopilotReplayRecovery: { get: async () => ({ ok: true, value: { state: 'unavailable' } }) },
      githubCopilotSessionContinuation: continuation } }
  const cleanup = registerReplayRecoveryUi(ctx as unknown as Context)
  const node = document.createElement('div'); document.body.append(node)
  const root = createRoot(node)
  const runtime = {
    sessionId: 'viewed',
    useSession: (selector: (snapshot: unknown) => unknown) => selector({
      sessionId: 'viewed', removed: false, openState: 'open', running: false,
    }),
    useProjection: (key: string) => key === 'modelSelection'
      ? { next: { provider: 'github-copilot-preview', model: 'synthetic' } }
      : { id: 'compaction', running: false },
  }
  try {
    await act(async () => root.render(surface(runtime)))
    expect(node.textContent).toBe('')
    expect(continuation.get).not.toHaveBeenCalled()
    expect(continuation.set).not.toHaveBeenCalled()
  } finally { await act(async () => root.unmount()); cleanup(); node.remove() }
})
function fixture(value: unknown = available) {
  let policy = { enabled: false, source: 'session', revision: 1, nextTurnAuthorized: false }
  const continuation = {
    get: vi.fn(async () => ({ ok: true, value: policy })),
    set: vi.fn(async (_id: string, revision: number, enabled: boolean | null) => {
      expect(revision).toBe(policy.revision)
      policy = { ...policy, enabled: enabled === true, revision: revision + 1 }
      return { ok: true, value: policy }
    }),
  }
  const remote = {
    get: vi.fn(async (): Promise<{ ok: boolean; value?: unknown }> => ({ ok: true, value })),
    setEnabled: vi.fn(async () => ({ ok: true, value: available })),
    authorize: vi.fn(async (_id: string, _revision: string, duration: ReplayRecoveryDuration) =>
      ({ ok: true, value: { ...available, state: 'enabled', duration } })),
  }
  const node = document.createElement('div'); document.body.append(node)
  const root = createRoot(node)
  const render = (props: { running?: boolean; refreshKey?: string; sessionId?: string;
    continuation?: typeof continuation } = {}) =>
    act(async () => root.render(createElement(ReplayRecoveryCard, { key: props.sessionId ?? 'viewed',
      remote, continuation, sessionId: 'viewed', ...props })))
  const click = async (text: string) => {
    const button = Array.from(node.querySelectorAll('button')).find(value => value.textContent === text)!
    expect(button.type).toBe('button')
    await act(async () => button.click())
  }
  return { remote, continuation, node, render, click, close: () => act(async () => root.unmount()) }
}
it('uses native auxiliary typography for the entire notice and inherited controls in an independent dock row', async () => {
  const f = fixture()
  try {
    await f.render()
    const notice = f.node.querySelector('section')!
    expect(notice.style.fontSize).toBe('var(--dsh-content-font-size-secondary, 13px)')
    expect(notice.style.lineHeight).toBe('calc(20px + var(--dsh-content-font-delta-secondary, 0px))')
    expect(notice.style.width).toBe('100%')
    expect(notice.style.maxWidth).toBe('var(--dsh-composer-card-max-width, 100%)')
    expect(notice.style.marginInline).toBe('auto')
    const details = notice.querySelector('details')!
    expect(details.open).toBe(false)
    expect(details.textContent).toContain('synthetic-model')
    expect(details.textContent).toContain('not a count of proven invalid items')
    expect(details.querySelector('button')!.textContent).toBe('Read status again')
    expect(notice.querySelectorAll(':scope > button')).toHaveLength(0)
    expect(notice.style.minWidth).toBe('0')
    for (const paragraph of Array.from(f.node.querySelectorAll('p'))) {
      expect(paragraph.style.marginBlock).toBe('8px')
      expect(paragraph.style.maxWidth).toBe('38rem')
    }
    for (const button of Array.from(f.node.querySelectorAll('button'))) {
      expect(button.style.fontSize).toBe('inherit')
      expect(button.style.fontFamily).toBe('inherit')
    }
    expect(f.remote.authorize).not.toHaveBeenCalled()
  } finally { await f.close() }
})
it('enables only persistent Session continuation after loss disclosure, without legacy authorization or sending', async () => {
  const f = fixture()
  try {
    await f.render()
    expect(f.remote.get).toHaveBeenCalledExactlyOnceWith('viewed')
    expect(f.node.textContent).toContain('Old reasoning replay was rejected')
    expect(f.node.textContent).toContain('implicit details may be lost')
    expect(f.node.querySelector('input[type=radio]')).toBeNull()
    expect(f.node.textContent).not.toContain('one hour')
    expect(f.remote.authorize).not.toHaveBeenCalled()
    await f.click('Cancel')
    expect(f.continuation.set).not.toHaveBeenCalled()
    await f.click('Replay recovery · Review')
    await f.click('Enable visible-history continuation')
    expect(f.continuation.set).toHaveBeenCalledExactlyOnceWith('viewed', 1, true)
    expect(f.remote.authorize).not.toHaveBeenCalled()
    expect(f.remote.setEnabled).not.toHaveBeenCalled()
    expect(f.node.textContent).toContain('Continuation is already on')
    expect(f.node.textContent).not.toContain('Enable visible-history continuation')
  } finally { await f.close() }
})
it('does not reauthorize an already enabled policy or change it when failure evidence expires', async () => {
  const f = fixture()
  f.continuation.get.mockResolvedValue({ ok: true, value: { enabled: true, source: 'session', revision: 4, nextTurnAuthorized: false } })
  try {
    await f.render()
    expect(f.node.textContent).toContain('Continuation is already on')
    expect(f.node.textContent).not.toContain('Enable visible-history continuation')
    f.remote.get.mockResolvedValue({ ok: true, value: { state: 'unavailable' } })
    await f.render({ refreshKey: 'evidence expired' })
    expect(f.node.textContent).toContain('does not change the Session continuation policy')
    expect(f.continuation.set).not.toHaveBeenCalled()
    expect(f.remote.authorize).not.toHaveBeenCalled()
    expect(f.remote.setEnabled).not.toHaveBeenCalled()
  } finally { await f.close() }
})
it('fails explicitly without a continuation Remote rather than using temporary recovery', async () => {
  const f = fixture()
  try {
    await f.render({ continuation: undefined })
    expect(f.node.textContent).toContain('COPILOT_CONTINUATION_STATUS_UNAVAILABLE')
    expect(f.node.textContent).not.toContain('Enable visible-history continuation')
    expect(f.remote.authorize).not.toHaveBeenCalled()
    expect(f.remote.setEnabled).not.toHaveBeenCalled()
  } finally { await f.close() }
})
it('does not claim enablement after a failed CAS or an unchanged off readback', async () => {
  const f = fixture()
  f.continuation.set.mockResolvedValue({ ok: true, value: { enabled: false, source: 'session', revision: 2, nextTurnAuthorized: false } })
  try {
    await f.render()
    await f.click('Enable visible-history continuation')
    expect(f.node.textContent).toContain('COPILOT_CONTINUATION_STATUS_UNAVAILABLE')
    expect(f.node.textContent).not.toContain('Continuation is already on')
    expect(f.remote.authorize).not.toHaveBeenCalled()
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
    await f.click('Cancel')
    expect(f.node.textContent).toBe('Replay recovery · Review')
    const compact = f.node.querySelector('button')!
    expect(compact.style.fontSize).toBe('var(--dsh-content-font-size-secondary, 13px)')
    expect(compact.style.lineHeight).toBe('calc(20px + var(--dsh-content-font-delta-secondary, 0px))')
    await f.render({ refreshKey: 'native failure changed' })
    expect(f.node.textContent).toBe('Replay recovery · Review')
    await f.click('Replay recovery · Review')
    await f.click('Cancel')
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
    await f.render({ running: true })
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
    expect(f.node.textContent).toContain('Failure evidence expired')
    expect(f.node.textContent).toContain('does not change the Session continuation policy')
    expect(f.node.textContent).not.toContain('Disable recovery')
    await act(async () => vi.advanceTimersByTimeAsync(60_000))
    expect(f.remote.get).toHaveBeenCalledTimes(2)
  } finally { await f.close() }
})
