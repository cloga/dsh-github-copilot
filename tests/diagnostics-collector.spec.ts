import { describe, expect, it } from 'vitest'
import { DiagnosticsCollector, emptyDiagnostics } from '../src/diagnostics-collector.ts'
import { diagnosticsReason, DiagnosticsSnapshotSchema, DIAGNOSTICS_MAX_BYTES, DIAGNOSTICS_RETENTION_MS } from '../src/diagnostics-types.ts'

describe('local diagnostics collector', () => {
  it('is disabled until enabled, records success denominators and settles once', () => {
    let now = 1000
    const collector = new DiagnosticsCollector('0.4.0-alpha.123', 'host', undefined, () => now, () => now)
    collector.begin('identity-read').finish('success')
    expect(collector.snapshot().rows).toEqual([])
    collector.setEnabled(true)
    const operation = collector.begin('identity-read')
    operation.stage('identity-validation')
    now += 60001
    expect(collector.snapshot().pending[0]?.bucket).toBe(6)
    operation.finish('success')
    operation.finish('failed')
    expect(collector.snapshot().rows.filter(row => row.metric === 'success')).toHaveLength(1)
    expect(collector.snapshot().rows.some(row => row.metric === 'failed')).toBe(false)
  })
  it('prevents pre-clear settlement from resurrecting cleared evidence', () => {
    const collector = new DiagnosticsCollector('0.4.0-alpha.123', 'host')
    collector.setEnabled(true)
    const operation = collector.begin('account-global-switch')
    collector.clear()
    operation.finish('success')
    expect(collector.snapshot().rows).toEqual([])
    expect(collector.snapshot().epoch).toBe(2)
  })
  it('bounds live work and exposes interrupted restarts without identities', () => {
    const collector = new DiagnosticsCollector('0.4.0-alpha.123', 'host')
    collector.setEnabled(true)
    for (let index = 0; index < 129; index++) collector.begin('compaction')
    const saved = collector.snapshot()
    expect(saved.dropped).toBe(1)
    expect(saved.pending.reduce((sum, row) => sum + row.count, 0)).toBe(128)
    const restarted = new DiagnosticsCollector('0.4.0-alpha.123', 'host')
    restarted.restore(saved)
    expect(restarted.snapshot().pending).toEqual([])
    expect(restarted.snapshot().interrupted).toBe(128)
  })
  it('rejects unknown payload fields and extracts only exact bounded codes', () => {
    expect(DiagnosticsSnapshotSchema.safeParse({ ...emptyDiagnostics(), token: 'secret' }).success).toBe(false)
    expect(diagnosticsReason(new Error('private URL and secret token'))).toBe('unknown')
    expect(diagnosticsReason(new Error('private', { cause: new Error('COPILOT_ACCOUNTS_BUSY') }))).toBe('COPILOT_ACCOUNTS_BUSY')
    expect(diagnosticsReason(new Error('COPILOT_ACCOUNTS_BUSY_SUFFIX'))).toBe('unknown')
    expect(diagnosticsReason(new Error('COPILOT_ACCOUNTS_BUSY1'))).toBe('unknown')
    expect(diagnosticsReason(new Error('x'.repeat(4096) + ' COPILOT_ACCOUNTS_BUSY'))).toBe('unknown')
    expect(diagnosticsReason(Object.assign(new Error('native capacity'), { code: 'CONTEXT_WINDOW_EXCEEDED' }))).toBe('CONTEXT_WINDOW_EXCEEDED')
  })
  it('fences pause and re-enable while retaining the starting build for interrupted work', () => {
    const collector = new DiagnosticsCollector('0.4.0-alpha.122', 'host')
    collector.setEnabled(true)
    const operation = collector.begin('compaction')
    const saved = collector.snapshot()
    const reopened = new DiagnosticsCollector('0.4.0-alpha.123', 'host')
    reopened.restore(saved)
    expect(reopened.snapshot().rows.find(row => row.metric === 'interrupted')?.version).toBe('0.4.0-alpha.122')
    collector.setEnabled(false)
    collector.setEnabled(true)
    operation.finish('success')
    expect(collector.snapshot().rows.some(row => row.metric === 'success')).toBe(false)
    expect(collector.snapshot().epoch).toBe(3)
  })
  it('retains observed rows on wall-clock rollback and expires the 14-day window explicitly', () => {
    let now = 100 * 3_600_000
    const collector = new DiagnosticsCollector('0.4.0-alpha.123', 'host', undefined, () => now)
    collector.setEnabled(true)
    collector.begin('identity-read').finish('success')
    now -= 3_600_000
    collector.begin('identity-read').finish('cancelled')
    expect(collector.snapshot().rows.some(row => row.metric === 'clock-discontinuity')).toBe(true)
    expect(collector.snapshot().rows.some(row => row.metric === 'success')).toBe(true)
    now += DIAGNOSTICS_RETENTION_MS + 3_600_001
    expect(collector.snapshot().rows).toEqual([])
    expect(collector.snapshot().evicted).toBeGreaterThan(0)
  })
  it('keeps Client loss and uncertain acknowledgement counters separate from business failures', () => {
    const collector = new DiagnosticsCollector('0.4.0-alpha.123', 'host')
    collector.setEnabled(true)
    collector.noteClientGaps(2, 3)
    expect(collector.snapshot()).toMatchObject({ clientDropped: 2, clientUnconfirmed: 3 })
    expect(collector.snapshot().rows).toEqual([])
  })
  it('bounds the exact UTF-8 bytes of the maximum legal fixed-dimension snapshot', () => {
    const row = { hour: 0, version: `1.2.3-alpha.${'x'.repeat(52)}`, layer: 'client' as const,
      operation: 'account-session-inherit' as const, stage: 'checkpoint-committed' as const,
      metric: 'environment-fault' as const, reason: 'COPILOT_SESSION_ACCOUNTS_COMMIT_UNCERTAIN' as const,
      bucket: 7, count: Number.MAX_SAFE_INTEGER }
    const snapshot = { ...emptyDiagnostics(), rows: Array.from({ length: 4096 }, () => ({ ...row })),
      pending: Array.from({ length: 128 }, () => ({ version: row.version, operation: row.operation,
        stage: row.stage, bucket: 7, count: 1 })) }
    expect(DiagnosticsSnapshotSchema.safeParse(snapshot).success).toBe(true)
    expect(new TextEncoder().encode(JSON.stringify(snapshot)).length).toBeLessThanOrEqual(DIAGNOSTICS_MAX_BYTES)
    expect(DiagnosticsSnapshotSchema.safeParse({ ...snapshot, rows: [...snapshot.rows, row] }).success).toBe(false)
  })
  it('never evicts newer evidence to admit an older delayed Client report', () => {
    const now = 100 * 3_600_000
    const collector = new DiagnosticsCollector('0.4.0-alpha.123', 'host', undefined, () => now)
    collector.setEnabled(true)
    const rows = Array.from({ length: 4096 }, (_, index) => ({
      hour: now, version: `1.0.0-alpha.${index}`, layer: 'client' as const,
      operation: 'identity-read' as const, stage: 'rpc-invoked' as const, metric: 'started' as const,
      reason: 'none' as const, bucket: 0, count: 1,
    }))
    collector.mergeClient(rows)
    collector.mergeClient([{ ...rows[0]!, hour: now - 3_600_000, version: '1.0.0-alpha.delayed' }])
    expect(collector.snapshot().rows).toHaveLength(4096)
    expect(collector.snapshot().rows.every(row => row.hour === now)).toBe(true)
    expect(collector.snapshot().evicted).toBe(1)
  })
})
