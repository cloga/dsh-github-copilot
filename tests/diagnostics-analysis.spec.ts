import { describe, expect, it } from 'vitest'
import {
  DiagnosticsAnalysisReportSchema, analyzeReviewedView, analyzeSnapshot, diagnosticsUnitName,
  parsePersistedUnit, parseReviewedView,
} from '../src/diagnostics-analysis.ts'
import { DiagnosticsSnapshotSchema } from '../src/diagnostics-types.ts'

const observedAt = 1_800_000_000_000
const hour = Math.floor(observedAt / 3_600_000) * 3_600_000
const emptySnapshot = () => ({
  schemaVersion: 1, coverageVersion: 1, epoch: 2, updatedAt: observedAt,
  rows: [], pending: [], dropped: 0, clientDropped: 0, clientUnconfirmed: 0,
  saturated: 0, evicted: 0, interrupted: 0,
})
const row = (extra: Record<string, unknown> = {}) => ({
  hour, version: '0.4.0-alpha.128', layer: 'host', operation: 'identity-read',
  stage: 'admitted', metric: 'started', reason: 'none', bucket: 0, count: 1, ...extra,
})
const persistedOptions = { source: 'persisted-snapshot' as const, observedAt }
const unitName = diagnosticsUnitName('desktop')

describe('diagnostics analysis', () => {
  it('explicitly excludes request observations from account/compaction aggregate interpretation', () => {
    const report = analyzeSnapshot({ ...emptySnapshot(), requests: {
      rows: [], dropped: 1, evicted: 0, pending: 0,
    } }, persistedOptions)
    expect(report.gaps).toContain('request-observations-not-analyzed')
    expect(report.populations).toEqual([])
    expect(report.investigationCandidates).toEqual([])
  })
  it('keeps no observations uncertain and does not claim current collection state', () => {
    const report = analyzeSnapshot(emptySnapshot(), persistedOptions)
    expect(report.populations).toEqual([])
    expect(report.collection).toEqual({ enabled: null, state: null, diagnostic: null, dirty: null, persistedAt: null })
    expect(report.gaps).toEqual(expect.arrayContaining([
      'no-retained-operation-observations', 'account-switch-not-observed', 'compaction-not-observed',
      'live-enabled-state-unknown', 'persisted-only', 'unflushed-tail-unknown',
    ]))
    expect(report.coverageComplete).toBe(false)
    expect(report.effectivenessVerified).toBe(false)
  })

  it('separates version, layer, logical and physical populations', () => {
    const report = analyzeSnapshot({ ...emptySnapshot(), rows: [
      row(), row({ layer: 'client' }), row({ version: '0.4.0-alpha.123' }),
      row({ operation: 'identity-flight' }), row({ operation: 'collection' }),
    ] }, persistedOptions)
    expect(report.populations).toHaveLength(4)
    expect(report.populations.every(population => population.started.value === 1)).toBe(true)
    expect(report.populations.map(({ version, layer, operation }) => `${version}/${layer}/${operation}`))
      .toEqual([
        '0.4.0-alpha.123/host/identity-read',
        '0.4.0-alpha.128/client/identity-read',
        '0.4.0-alpha.128/host/identity-flight',
        '0.4.0-alpha.128/host/identity-read',
      ])
  })

  it('keeps starts, stage ages, terminal durations and pending samples distinct', () => {
    const report = analyzeSnapshot({ ...emptySnapshot(), rows: [
      row(),
      row({ metric: 'stage', bucket: 7, count: 10 }),
      row({ metric: 'pending-sample', bucket: 7, count: 20 }),
      row({ metric: 'success', bucket: 1 }),
    ] }, persistedOptions)
    const population = report.populations[0]!
    expect(population.started.value).toBe(1)
    expect(population.terminalObservations.value).toBe(1)
    expect(population.terminalLatency[7]?.count.value).toBe(0)
    expect(population.terminalLatency[1]).toEqual({
      lowerMs: 100, upperExclusiveMs: 500, count: { value: 1, overflow: false },
    })
    expect(population.stageObservations.value).toBe(10)
    expect(population.stageAgeObservations[7]?.count.value).toBe(10)
    expect(population.pendingSamples.value).toBe(20)
    expect(population.pendingSampleAges[7]?.count.value).toBe(20)
    expect(population.exactOperationFailureRate).toBeNull()
    expect(population.startsMinusTerminals).toBeNull()
  })

  it('preserves each terminal outcome and labels account-switch and compaction coverage gaps', () => {
    const report = analyzeSnapshot({ ...emptySnapshot(), rows: [
      row({ metric: 'success' }),
      row({ metric: 'no-op' }),
      row({ metric: 'cancelled' }),
      row({ metric: 'policy-rejected' }),
      row({ metric: 'revoked' }),
      row({ metric: 'environment-fault' }),
      row({ metric: 'failed' }),
      row({ metric: 'unknown' }),
      row({ metric: 'interrupted', layer: 'client' }),
      row({ metric: 'success', operation: 'account-session-select' }),
      row({ metric: 'unknown', operation: 'compaction' }),
    ] }, persistedOptions)
    const identity = report.populations.find(population =>
      population.layer === 'host' && population.operation === 'identity-read')!
    expect(identity.outcomes).toMatchObject({
      success: { value: 1 }, 'no-op': { value: 1 }, cancelled: { value: 1 },
      'policy-rejected': { value: 1 }, revoked: { value: 1 }, 'environment-fault': { value: 1 },
      failed: { value: 1 }, unknown: { value: 1 }, interrupted: { value: 0 },
    })
    expect(report.populations.find(population => population.layer === 'client')?.outcomes.interrupted.value).toBe(1)
    expect(report.gaps).not.toContain('account-switch-not-observed')
    expect(report.gaps).not.toContain('compaction-not-observed')
    expect(report.gaps).toContain('interrupted-observations')
    expect(report.counters.interrupted).toBe(0)
    expect(report.populations.find(population => population.operation === 'compaction')?.successMeaning)
      .toBe('matching-checkpoint-and-end-observed')
  })

  it('does not pair hourly starts and terminals or treat stored pending as live', () => {
    const report = analyzeSnapshot({
      ...emptySnapshot(),
      rows: [row({ metric: 'success', count: 5 })],
      pending: [{ version: '0.4.0-alpha.123', operation: 'compaction', stage: 'cas', bucket: 7, count: 1 }],
    }, persistedOptions)
    expect(report.populations[0]?.started.value).toBe(0)
    expect(report.populations[0]?.outcomes.success.value).toBe(5)
    expect(report.populations[0]?.startsMinusTerminals).toBeNull()
    expect(report.pendingAtSnapshot[0]?.version).toBe('0.4.0-alpha.123')
    expect(report.gaps).toContain('stored-pending-is-not-live')
  })

  it('uses fixed semantic candidates without regression, persistence, or root-cause claims', () => {
    const report = analyzeSnapshot({ ...emptySnapshot(), rows: [
      row({ metric: 'failed', reason: 'unknown' }),
      row({ metric: 'failed', reason: 'unknown', version: '0.4.0-alpha.123' }),
      row({ metric: 'unknown', operation: 'compaction', reason: 'unknown' }),
      row({ metric: 'policy-rejected', reason: 'COPILOT_ACCOUNTS_BUSY' }),
    ] }, persistedOptions)
    expect(report.investigationCandidates).toHaveLength(2)
    expect(report.investigationCandidates[0]).toMatchObject({
      fingerprint: 'coverage-1|host|identity-read|failed|unknown',
      observations: { value: 2 }, regressionProven: false,
      persistentFaultProven: false, rootCause: 'unknown',
    })
    expect(JSON.stringify(report)).not.toMatch(/p95|percentile|accountId|sessionId|hash/i)
  })

  it('returns null rather than rounded sums on safe-integer overflow', () => {
    const report = analyzeSnapshot({ ...emptySnapshot(), rows: [
      row({ count: Number.MAX_SAFE_INTEGER }),
      row({ hour: hour - 3_600_000, count: 1 }),
    ] }, persistedOptions)
    expect(report.populations[0]?.started).toEqual({ value: null, overflow: true })
    expect(report.gaps).toContain('analysis-count-overflow')
    const candidate = analyzeSnapshot({ ...emptySnapshot(), rows: [
      row({ metric: 'failed', reason: 'unknown', count: Number.MAX_SAFE_INTEGER }),
      row({ hour: hour - 3_600_000, metric: 'failed', reason: 'unknown', count: 1 }),
    ] }, persistedOptions)
    expect(candidate.investigationCandidates[0]?.observations).toEqual({ value: null, overflow: true })
    expect(candidate.gaps).toContain('analysis-count-overflow')
  })

  it('rejects duplicate aggregate tuples and private snapshot fields', () => {
    expect(() => analyzeSnapshot({ ...emptySnapshot(), rows: [row(), row()] }, persistedOptions))
      .toThrow('COPILOT_DIAGNOSTICS_ANALYSIS_DUPLICATE_AGGREGATE')
    expect(() => analyzeSnapshot({ ...emptySnapshot(), accountId: 'private' }, persistedOptions))
      .toThrow('COPILOT_DIAGNOSTICS_ANALYSIS_INVALID_SNAPSHOT')
  })

  it('rejects invalid options and oversized or malformed JSON with fixed errors', () => {
    expect(() => analyzeSnapshot(emptySnapshot(), { ...persistedOptions, observedAt: Number.NaN }))
      .toThrow('COPILOT_DIAGNOSTICS_ANALYSIS_INVALID_OPTIONS')
    expect(() => parseReviewedView('private not-json'))
      .toThrow('COPILOT_DIAGNOSTICS_ANALYSIS_INVALID_JSON')
    expect(() => parseReviewedView(' '.repeat(8 * 1024 * 1024 + 1)))
      .toThrow('COPILOT_DIAGNOSTICS_ANALYSIS_INPUT_LIMIT')
  })

  it('requires exact persisted-unit shape and the explicitly qualified profile name', () => {
    expect(unitName).toBe('github_copilot_diagnostics_6465736b746f70')
    const text = JSON.stringify({ unit: { name: unitName, version: 1 },
      global: emptySnapshot(), tables: {} })
    expect(parsePersistedUnit(text, unitName)).toEqual(DiagnosticsSnapshotSchema.parse(emptySnapshot()))
    expect(() => parsePersistedUnit(JSON.stringify({
      unit: { name: 'foreign', version: 1 }, global: emptySnapshot(), tables: {},
    }), unitName)).toThrow('COPILOT_DIAGNOSTICS_ANALYSIS_INVALID_UNIT')
    expect(() => parsePersistedUnit(JSON.stringify({
      unit: { name: unitName, version: 1 }, global: emptySnapshot(), tables: { private: {} },
    }), unitName)).toThrow('COPILOT_DIAGNOSTICS_ANALYSIS_INVALID_UNIT')
    expect(() => diagnosticsUnitName('../desktop'))
      .toThrow('COPILOT_DIAGNOSTICS_ANALYSIS_INVALID_PROFILE')
    expect(JSON.stringify(analyzeSnapshot(parsePersistedUnit(text, unitName), persistedOptions)))
      .not.toContain(unitName)
  })

  it('validates reviewed views and preserves only their current bounded state', () => {
    const view = parseReviewedView(JSON.stringify({
      enabled: false, autoAllocationEnabled: false, state: 'ready', diagnostic: 'none', dirty: true,
      snapshot: emptySnapshot(),
    }))
    const report = analyzeReviewedView(view, observedAt)
    expect(report.source).toBe('reviewed-view')
    expect(report.collection).toMatchObject({ enabled: false, state: 'ready', dirty: true })
    expect(report.gaps).toContain('unpersisted-observations')
    expect(report.gaps).toContain('collection-paused')
    expect(report.gaps).not.toContain('persisted-only')
    expect(() => parseReviewedView(JSON.stringify({ enabled: true, accountId: 'private' })))
      .toThrow('COPILOT_DIAGNOSTICS_ANALYSIS_INVALID_VIEW')
    expect(() => analyzeSnapshot(view.snapshot, { ...persistedOptions, source: 'reviewed-view' }))
      .toThrow('COPILOT_DIAGNOSTICS_ANALYSIS_INVALID_OPTIONS')
  })

  it('reports stale, expired, clock, drop, saturation and persistence gaps explicitly', () => {
    const staleAt = observedAt - 15 * 24 * 3_600_000
    const report = analyzeSnapshot({
      ...emptySnapshot(), updatedAt: staleAt, dropped: 1, clientDropped: 2,
      clientUnconfirmed: 3, evicted: 4, saturated: 1, interrupted: 1,
      rows: [
        row({ hour: staleAt, metric: 'clock-discontinuity', operation: 'collection', reason: 'unknown' }),
        row({ hour: staleAt }),
      ],
    }, persistedOptions)
    expect(report.ageMs).toBe(15 * 24 * 3_600_000)
    expect(report.gaps).toEqual(expect.arrayContaining([
      'stale-snapshot', 'expired-in-stored-snapshot', 'host-dropped', 'client-dropped',
      'client-unconfirmed', 'retention-or-capacity-eviction', 'collector-saturated',
      'interrupted-observations', 'clock-discontinuity',
    ]))
    const future = analyzeSnapshot({ ...emptySnapshot(), updatedAt: observedAt + 1 }, persistedOptions)
    expect(future.ageMs).toBeNull()
    expect(future.gaps).toContain('clock-discontinuity')
  })

  it('strictly validates the report shape before it can be serialized', () => {
    const report = analyzeSnapshot(emptySnapshot(), persistedOptions)
    expect(DiagnosticsAnalysisReportSchema.safeParse(report).success).toBe(true)
    expect(DiagnosticsAnalysisReportSchema.safeParse({ ...report, private: 'value' }).success).toBe(false)
  })
})
