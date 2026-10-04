// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { ReplayRecoveryCard } from '../src/replay-recovery-ui.ts'

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks() })
it('requires an explicit loss confirmation, never submits a message and sends the read revision', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const available = { state: 'available', revision: '12345678-1234-4234-8234-123456789012', itemCount: 12, model: 'synthetic-model' }
  const remote = { get: vi.fn(async () => ({ ok: true, value: available })),
    setEnabled: vi.fn(async () => ({ ok: true, value: { ...available, state: 'enabled' } })) }
  const node = document.createElement('div'); document.body.append(node)
  const root = createRoot(node)
  const click = async (text: string) => {
    const button = [...node.querySelectorAll('button')].find(value => value.textContent === text)!
    expect(button.type).toBe('button')
    await act(async () => button.click())
  }
  try {
    await act(async () => root.render(createElement(ReplayRecoveryCard, { remote, sessionId: 'viewed-session' })))
    expect(remote.get).not.toHaveBeenCalled()
    await click('Read status again')
    expect(node.textContent).toContain('losing their hidden reasoning state')
    await click('Review activation')
    expect(remote.setEnabled).not.toHaveBeenCalled()
    await click('Cancel')
    expect(remote.setEnabled).not.toHaveBeenCalled()
    await click('Review activation')
    await click('Accept loss and enable')
    expect(remote.setEnabled).toHaveBeenCalledExactlyOnceWith('viewed-session', available.revision, true)
    expect(node.textContent).toContain('Recovery enabled.')
  } finally { await act(async () => root.unmount()) }
})
it('distinguishes failed reads from unavailable evidence and removes stale activation', async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const remote = { get: vi.fn(async () => ({ ok: false })), setEnabled: vi.fn() }
  const node = document.createElement('div'); document.body.append(node)
  const root = createRoot(node)
  try {
    await act(async () => root.render(createElement(ReplayRecoveryCard, { remote, sessionId: 'session' })))
    await act(async () => node.querySelector('button')!.click())
    expect(node.querySelector('[role=alert]')).not.toBeNull()
    expect(node.textContent).not.toContain('No current failure evidence.')
    expect(node.textContent).not.toContain('Review activation')
    expect(remote.setEnabled).not.toHaveBeenCalled()
  } finally { await act(async () => root.unmount()) }
})
