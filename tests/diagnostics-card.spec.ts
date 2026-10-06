// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { DiagnosticsCard } from '../src/diagnostics-card.ts'
import { emptyDiagnostics } from '../src/diagnostics-collector.ts'
import type { DiagnosticsRemote } from '../src/diagnostics-card.ts'
import type { DiagnosticsView } from '../src/diagnostics-types.ts'

describe('local diagnostics control', () => {
  it('requires a confirmed durable enable and a separate destructive clear confirmation', async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    let view: DiagnosticsView = { enabled: false, state: 'ready', diagnostic: 'none',
      dirty: false, snapshot: emptyDiagnostics() }
    const remote: DiagnosticsRemote = {
      get: vi.fn(async () => ({ ok: true as const, value: view })),
      setEnabled: vi.fn(async enabled => ({ ok: true as const, value: view = { ...view, enabled } })),
      clear: vi.fn(async () => ({ ok: true as const, value: view = { ...view, snapshot: { ...emptyDiagnostics(), epoch: 1 } } })),
      recordClient: vi.fn(async () => ({ ok: true as const, value: view })),
    }
    const element = document.createElement('div')
    const root = createRoot(element)
    document.body.append(element)
    const click = async (text: string) => {
      const button = Array.from(element.querySelectorAll('button')).find(node => node.textContent === text)
      if (!button) throw new Error(`Missing control ${text}`)
      await act(async () => { button.click() })
    }
    try {
      await act(async () => { root.render(createElement(DiagnosticsCard, { remote })) })
      expect(element.textContent).toContain('Collection paused')
      await click('Enable local collection')
      expect(remote.setEnabled).toHaveBeenCalledWith(true)
      expect(element.textContent).toContain('Collection enabled')
      await click('Clear local aggregates')
      expect(remote.clear).not.toHaveBeenCalled()
      await click('Cancel')
      await click('Clear local aggregates')
      await click('Confirm clear')
      expect(remote.clear).toHaveBeenCalledTimes(1)
      await click('Prepare current JSON')
      expect(element.querySelector('textarea')?.value).toContain('"coverageVersion": 1')
    } finally { await act(async () => root.unmount()); element.remove() }
  })
  it('never presents unavailable storage as ready empty telemetry', async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    const remote: DiagnosticsRemote = {
      get: async () => ({ ok: true, value: { enabled: false, state: 'unavailable',
        diagnostic: 'storage-unavailable', dirty: false, snapshot: emptyDiagnostics() } }),
      setEnabled: vi.fn(), clear: vi.fn(), recordClient: vi.fn(),
    }
    const element = document.createElement('div')
    const root = createRoot(element)
    try {
      await act(async () => { root.render(createElement(DiagnosticsCard, { remote })) })
      expect(element.textContent).toContain('storage-unavailable')
      expect(Array.from(element.querySelectorAll('button')).find(node => node.textContent === 'Enable local collection')?.disabled).toBe(true)
    } finally { await act(async () => root.unmount()) }
  })
})
