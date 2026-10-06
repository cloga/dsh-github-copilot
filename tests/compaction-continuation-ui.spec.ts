// @vitest-environment jsdom
import { act, createElement as h } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { CompactionContinuationNotice } from '../src/compaction-continuation-ui.ts'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
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
