// @vitest-environment jsdom
import { act, createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { ContinuationDefaultCard, SessionContinuationCard, useSessionContinuationSwitch } from '../src/session-continuation-ui.ts'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
function fixture() {
  const node = document.createElement('div'); document.body.append(node)
  const root = createRoot(node)
  let view = { enabled: false, revision: 1, source: 'session', nextTurnAuthorized: false }
  const remote = {
    get: vi.fn(async () => ({ ok: true, value: view })),
    set: vi.fn(async (_id: string, revision: number, enabled: boolean | null) => {
      expect(revision).toBe(view.revision)
      view = { ...view, enabled: enabled ?? true, source: enabled === null ? 'default' : 'session', revision: revision + 1 }
      return { ok: true, value: view }
    }),
    authorizeNext: vi.fn(async (_id: string, revision: number, enabled: boolean) => {
      expect(revision).toBe(view.revision)
      view = { ...view, nextTurnAuthorized: enabled }
      return { ok: true, value: view }
    }),
    defaults: vi.fn(async () => ({ ok: true, value: { enabled: true, revision: 1 } })),
    setDefault: vi.fn(async (_revision: number, enabled: boolean) => ({ ok: true, value: { enabled, revision: 2 } })),
  }
  return { node, root, remote,
    click: async (label: string) => {
      const button = Array.from(node.querySelectorAll('button')).find(item => item.textContent === label)
      expect(button?.type).toBe('button')
      await act(async () => button!.click())
    },
    dispose: async () => { await act(async () => root.unmount()); node.remove() } }
}
it('discloses loss beside inline controls, saves persistent and one-turn consent without sending', async () => {
  const f = fixture()
  try {
    await act(async () => f.root.render(h(SessionContinuationCard, { sessionId: 's', remote: f.remote })))
    expect(f.node.querySelector('details')!.open).toBe(false)
    expect(f.node.textContent).toContain('including on the same account')
    expect(f.node.textContent).toContain('No automatic sending or retries')
    expect(f.remote.set).not.toHaveBeenCalled()
    await f.click('Next turn only')
    expect(f.remote.authorizeNext).toHaveBeenCalledWith('s', 1, true)
    await f.click('Revoke next-turn consent')
    expect(f.remote.authorizeNext).toHaveBeenLastCalledWith('s', 1, false)
    await f.click('Enable for this Session')
    expect(f.remote.set).toHaveBeenCalledExactlyOnceWith('s', 1, true)
    const select = f.node.querySelector('select')!
    await act(async () => { select.value = 'off'; select.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(f.remote.set).toHaveBeenLastCalledWith('s', 2, false)
    expect(select.style.colorScheme).toBe('inherit')
    expect(select.querySelector('option')!.style.background).toBe('canvas')
  } finally { await f.dispose() }
})
it('shows default on and saves only the reviewed global revision', async () => {
  const f = fixture()
  const saved = vi.fn()
  try {
    await act(async () => f.root.render(h(ContinuationDefaultCard, { remote: f.remote, onSaved: saved })))
    expect(saved).not.toHaveBeenCalled()
    const checkbox = f.node.querySelector('input')!
    expect(checkbox.checked).toBe(true)
    await act(async () => checkbox.click())
    expect(f.remote.setDefault).toHaveBeenCalledExactlyOnceWith(1, false)
    expect(checkbox.checked).toBe(false)
    expect(saved).toHaveBeenCalledOnce()
  } finally { await f.dispose() }
})
it('aborting the switch during its pre-read cannot create a hidden confirmation', async () => {
  const f = fixture()
  let finish: (changed: boolean) => void
  const changesAccount = () => new Promise<boolean>(resolve => { finish = resolve })
  let begin: (signal: AbortSignal) => Promise<boolean>
  function Surface() {
    const guard = useSessionContinuationSwitch({ sessionId: 's', remote: f.remote, changesAccount })
    begin = signal => guard.beforeAccountChange('other', signal)
    return guard.content
  }
  try {
    await act(async () => f.root.render(h(Surface)))
    const controller = new AbortController()
    const decision = begin!(controller.signal)
    controller.abort()
    await act(async () => finish!(true))
    expect(await decision).toBe(false)
    expect(f.node.textContent).not.toContain('Before switching accounts')
    expect(f.remote.get).toHaveBeenCalledTimes(1)
    expect(f.remote.set).not.toHaveBeenCalled()
  } finally { await f.dispose() }
})
it.each([
  ['Cancel', false, undefined],
  ['Keep off and switch', true, undefined],
  ['Enable for Session and switch', true, 'session'],
  ['Next turn only and switch', true, 'next'],
] as const)('requires off-switch choice: %s', async (label, approved, authorization) => {
  const f = fixture()
  let begin: (id: string) => Promise<boolean>
  function Surface() {
    const guard = useSessionContinuationSwitch({ sessionId: 's', remote: f.remote, changesAccount: async () => true })
    begin = guard.beforeAccountChange
    return guard.content
  }
  try {
    await act(async () => f.root.render(h(Surface)))
    let decision: Promise<boolean>
    await act(async () => { decision = begin!('other'); await Promise.resolve(); await Promise.resolve() })
    expect(f.node.textContent).toContain('failure is not certain')
    expect(f.remote.set).not.toHaveBeenCalled()
    await f.click(label)
    expect(await decision!).toBe(approved)
    expect(f.remote.set).toHaveBeenCalledTimes(authorization === 'session' ? 1 : 0)
    expect(f.remote.authorizeNext).toHaveBeenCalledTimes(authorization === 'next' ? 1 : 0)
  } finally { await f.dispose() }
})
it('closing an outstanding confirmation cancels its account change', async () => {
  const f = fixture()
  let begin: () => Promise<boolean>
  function Surface() {
    const guard = useSessionContinuationSwitch({ sessionId: 's', remote: f.remote, changesAccount: async () => true })
    begin = () => guard.beforeAccountChange('other')
    return guard.content
  }
  await act(async () => f.root.render(h(Surface)))
  let decision: Promise<boolean>
  await act(async () => { decision = begin!(); await Promise.resolve(); await Promise.resolve() })
  await f.dispose()
  expect(await decision!).toBe(false)
  expect(f.remote.set).not.toHaveBeenCalled()
})
