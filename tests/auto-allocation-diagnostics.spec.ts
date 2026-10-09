import { describe, expect, it } from 'vitest'
import { allocateAutoModel } from '../src/auto-allocation.ts'
import { AutoAllocationDiagnosticsCollector, AutoAllocationDiagnosticsSchema } from '../src/auto-allocation-diagnostics.ts'
import type { AutoSelectionExplanation } from '../src/auto-model-routing.ts'
import { DiagnosticsCollector, emptyDiagnostics } from '../src/diagnostics-collector.ts'
import { DiagnosticsSnapshotSchema } from '../src/diagnostics-types.ts'

const day = 24 * 60 * 60 * 1000
function explanation(): AutoSelectionExplanation {
  const allocation = allocateAutoModel([{ id: 'ordinary' }, { id: 'costly' }], ['costly'], 'ordinary', 1)
  return {
    assessment: { demand: 'unknown', source: 'local', signals: ['insufficient-evidence'] },
    targetCategory: 'versatile', selectedCategory: 'versatile', categoryCandidateCount: 2,
    method: 'weighted-distribution', fallback: false, allocation,
  }
}

describe('persistent Auto allocation diagnostics', () => {
  it('separates assessment outcomes without changing model opportunities or exposing errors', () => {
    const collector = new AutoAllocationDiagnosticsCollector('0.4.2-alpha.6', undefined, () => day)
    collector.setEnabled(true)
    for (const diagnostic of ['disabled', 'unavailable', 'timeout', 'failed', 'invalid-result', 'context-omitted'] as const) {
      const value = explanation()
      collector.record({ ...value, assessment: { ...value.assessment, diagnostic } })
    }
    collector.record(explanation())
    const semantic = explanation()
    collector.record({ ...semantic, assessment: { demand: 'unknown', source: 'semantic', signals: ['insufficient-evidence'] } })
    const rows = collector.snapshot().rows
    expect(rows).toHaveLength(16)
    expect(new Set(rows.map(row => row.assessmentOutcome))).toEqual(new Set([
      'disabled', 'unavailable', 'timeout', 'failed', 'invalid-result', 'context-omitted',
      'local-unknown', 'semantic-unknown',
    ]))
    expect(rows.reduce((sum, row) => sum + row.selections, 0)).toBe(8)
    expect(rows.reduce((sum, row) => sum + row.opportunities, 0)).toBe(16)
    expect(AutoAllocationDiagnosticsSchema.safeParse({
      ...collector.snapshot(), rows: [{ ...rows[0], assessmentOutcome: 'raw error body' }],
    }).success).toBe(false)
  })

  it('keeps legacy reasons unrecorded and captures no-fit and successful assessment outcomes', () => {
    const collector = new AutoAllocationDiagnosticsCollector('0.4.2-alpha.6', undefined, () => day)
    collector.setEnabled(true)
    collector.record(explanation())
    const snapshot = collector.snapshot()
    const legacyRows = snapshot.rows.map(({ assessmentOutcome: _outcome, ...row }) => row)
    collector.restore({ ...snapshot, rows: legacyRows }, false)
    collector.record(explanation())
    expect(collector.snapshot().rows).toHaveLength(4)
    expect(collector.snapshot().rows.filter(row => row.assessmentOutcome === undefined)).toHaveLength(2)
    for (const source of ['local', 'semantic'] as const) {
      collector.record({ ...explanation(), method: 'no-fit',
        assessment: { demand: 'routine', source, signals: ['bounded-transformation'] } })
    }
    expect(collector.snapshot().noFitRows.map(row => row.assessmentOutcome)).toEqual(['local-known', 'semantic-known'])
  })

  it('keeps allocation opportunities and conditional expected/actual counts in separate strata', () => {
    let now = 10 * day + 1234
    const collector = new AutoAllocationDiagnosticsCollector('0.4.0-alpha.126', undefined, () => now)
    collector.record(explanation())
    expect(collector.snapshot().rows).toEqual([])
    collector.setEnabled(true)
    const first = explanation()
    const second = explanation()
    collector.record(first)
    now++
    collector.record(second)
    const snapshot = collector.snapshot()
    expect(snapshot).toMatchObject({
      status: 'observed', completeHistory: false, observationStart: 10 * day, observationEnd: 10 * day,
    })
    expect(snapshot.rows).toHaveLength(2)
    expect(snapshot.rows.reduce((sum, row) => sum + row.opportunities, 0)).toBe(4)
    expect(snapshot.rows.reduce((sum, row) => sum + row.expectedSelections, 0)).toBeCloseTo(2)
    expect(snapshot.rows.reduce((sum, row) => sum + row.selections, 0)).toBe(2)
    expect(snapshot.rows.every(row => row.assessmentSource === 'local' && row.demand === 'unknown'
      && row.targetCategory === 'versatile' && row.method === 'weighted-distribution')).toBe(true)
    expect(JSON.stringify(snapshot)).not.toMatch(/session|turnId|prompt|content/i)
  })

  it('aggregates no-fit decisions without inventing a fitting-pool distribution', () => {
    let now = day
    const collector = new AutoAllocationDiagnosticsCollector('0.4.0-alpha.126', undefined, () => now)
    collector.setEnabled(true)
    const noFit: AutoSelectionExplanation = {
      assessment: { demand: 'complex', source: 'semantic', signals: ['reasoning'] },
      targetCategory: 'powerful', selectedCategory: 'unknown', categoryCandidateCount: 0,
      method: 'no-fit', fallback: true,
    }
    collector.record(noFit)
    now += day
    collector.record(noFit)
    expect(collector.snapshot()).toMatchObject({
      status: 'observed', rows: [], noFitRows: [
        { day, decisions: 1, demand: 'complex', assessmentSource: 'semantic' },
        { day: day * 2, decisions: 1, demand: 'complex', assessmentSource: 'semantic' },
      ], observationStart: day, observationEnd: day * 2,
    })
  })

  it('expires old buckets, counts observed restarts, and clear resets only this evidence', () => {
    let now = 2 * day
    const collector = new AutoAllocationDiagnosticsCollector('0.4.0-alpha.126', undefined, () => now)
    collector.setEnabled(true)
    collector.record(explanation())
    const persisted = collector.snapshot()
    now += 15 * day
    const reopened = new AutoAllocationDiagnosticsCollector('0.4.0-alpha.126', undefined, () => now)
    reopened.restore(persisted)
    expect(reopened.snapshot()).toMatchObject({
      status: 'observed', rows: [], expired: 2, restarts: 1, observationStart: null, observationEnd: null,
    })
    reopened.clear()
    expect(reopened.snapshot()).toMatchObject({
      status: 'not-collected', rows: [], expired: 0, restarts: 0, dropped: 0,
    })
  })

  it('persists only while local diagnostics are enabled and upgrades legacy snapshots safely', () => {
    let now = 3 * day
    const collector = new DiagnosticsCollector('0.4.0-alpha.126', 'host', undefined, () => now)
    const legacy = { ...emptyDiagnostics() }
    delete (legacy as Partial<typeof legacy>).autoAllocation
    expect(DiagnosticsSnapshotSchema.safeParse(legacy).success).toBe(true)
    collector.restore(legacy)
    expect(collector.snapshot().autoAllocation?.status).toBe('not-collected')
    collector.recordAutoAllocation(explanation())
    expect(collector.snapshot().autoAllocation?.rows).toEqual([])
    collector.setAutoAllocationEnabled(true)
    collector.recordAutoAllocation(explanation())
    expect(collector.snapshot().autoAllocation?.rows).toHaveLength(2)
    collector.setAutoAllocationEnabled(false)
    now += day
    collector.recordAutoAllocation(explanation())
    expect(collector.snapshot().autoAllocation?.rows).toHaveLength(2)
    collector.setEnabled(true)
    collector.recordAutoAllocation(explanation())
    expect(collector.snapshot().autoAllocation?.rows).toHaveLength(2)
    collector.clear()
    expect(collector.snapshot().autoAllocation).toMatchObject({ status: 'not-collected', rows: [] })
  })
})
