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
    let view: DiagnosticsView = { enabled: false, autoAllocationEnabled: false, state: 'ready', diagnostic: 'none',
      dirty: false, snapshot: emptyDiagnostics() }
    const remote: DiagnosticsRemote = {
      get: vi.fn(async () => ({ ok: true as const, value: view })),
      setEnabled: vi.fn(async enabled => ({ ok: true as const, value: view = { ...view, enabled } })),
      setAutoAllocationEnabled: vi.fn(async autoAllocationEnabled => ({
        ok: true as const, value: view = { ...view, autoAllocationEnabled },
      })),
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
      await click('Enable Auto allocation observation')
      expect(remote.setAutoAllocationEnabled).toHaveBeenCalledWith(true)
      expect(remote.setEnabled).not.toHaveBeenCalled()
      expect(element.textContent).toContain('Collection paused')
      await click('Enable local collection')
      expect(remote.setEnabled).toHaveBeenCalledWith(true)
      expect(element.textContent).toContain('Collection enabled')
      expect(element.textContent).toContain('Auto allocation aggregates')
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
      get: async () => ({ ok: true, value: { enabled: false, autoAllocationEnabled: false, state: 'unavailable',
        diagnostic: 'storage-unavailable', dirty: false, snapshot: emptyDiagnostics() } }),
      setEnabled: vi.fn(), setAutoAllocationEnabled: vi.fn(), clear: vi.fn(), recordClient: vi.fn(),
    }
    const element = document.createElement('div')
    const root = createRoot(element)
    try {
      await act(async () => { root.render(createElement(DiagnosticsCard, { remote })) })
      expect(element.textContent).toContain('storage-unavailable')
      expect(Array.from(element.querySelectorAll('button')).find(node => node.textContent === 'Enable local collection')?.disabled).toBe(true)
    } finally { await act(async () => root.unmount()) }
  })
  it('identifies retained Auto aggregate scope and explicit coverage gaps', async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    const snapshot = emptyDiagnostics()
    const observedDay = Math.floor(1_800_000_000_000 / (24 * 60 * 60 * 1000)) * (24 * 60 * 60 * 1000)
    snapshot.autoAllocation = {
      status: 'observed', rows: [{
        day: observedDay, version: '0.4.0-alpha.126', policyVersion: 'high-cost-v1',
        modelId: 'fixture-model', targetCategory: 'powerful', category: 'powerful',
        demand: 'complex', assessmentSource: 'semantic', method: 'weighted-distribution', fallback: false,
        highCost: true, previous: false, weight: 0.2, opportunities: 4,
        expectedSelections: 0.8, selections: 1,
      }], noFitRows: [], observationStart: observedDay, observationEnd: observedDay,
      completeHistory: false, rowsTruncated: false, dropped: 0, expired: 0, saturated: 0, restarts: 1,
    }
    const remote: DiagnosticsRemote = {
      get: async () => ({ ok: true, value: { enabled: true, autoAllocationEnabled: false, state: 'ready',
        diagnostic: 'none', dirty: false, snapshot } }),
      setEnabled: vi.fn(), setAutoAllocationEnabled: vi.fn(), clear: vi.fn(), recordClient: vi.fn(),
    }
    const element = document.createElement('div')
    const root = createRoot(element)
    try {
      await act(async () => { root.render(createElement(DiagnosticsCard, { remote })) })
      expect(element.textContent).toContain('Auto allocation aggregates')
      expect(element.textContent).toContain('4 candidate opportunities')
      expect(element.textContent).toContain('Complete history: no')
      expect(element.textContent).toContain('no Session/turn IDs')
    } finally { await act(async () => root.unmount()) }
  })
  it('allows pausing a configured-on collector even when storage is unavailable', async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    let view: DiagnosticsView = { enabled: true, autoAllocationEnabled: false, state: 'unavailable',
      diagnostic: 'storage-unavailable', dirty: false, snapshot: emptyDiagnostics() }
    const remote: DiagnosticsRemote = {
      get: async () => ({ ok: true, value: view }),
      setEnabled: vi.fn(async enabled => ({ ok: true as const, value: view = { ...view, enabled } })),
      setAutoAllocationEnabled: vi.fn(),
      clear: vi.fn(), recordClient: vi.fn(),
    }
    const element = document.createElement('div')
    const root = createRoot(element)
    try {
      await act(async () => { root.render(createElement(DiagnosticsCard, { remote })) })
      const pause = Array.from(element.querySelectorAll('button')).find(node => node.textContent === 'Pause collection')
      expect(pause?.disabled).toBe(false)
      await act(async () => { pause?.click() })
      expect(remote.setEnabled).toHaveBeenCalledWith(false)
      expect(element.textContent).toContain('Collection paused')
      expect(Array.from(element.querySelectorAll('button')).find(node => node.textContent === 'Enable local collection')?.disabled).toBe(true)
    } finally { await act(async () => root.unmount()) }
  })
})
