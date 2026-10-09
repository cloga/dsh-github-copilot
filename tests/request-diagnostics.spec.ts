import { describe, expect, it } from 'vitest'
import { DiagnosticsCollector, emptyDiagnostics } from '../src/diagnostics-collector.ts'
import { RequestDiagnosticSchema, REQUEST_DIAGNOSTICS_RETENTION_MS } from '../src/request-diagnostics.ts'
import { DiagnosticsSnapshotSchema } from '../src/diagnostics-types.ts'
import type { RequestDiagnosticStart } from '../src/request-diagnostics.ts'

const start: RequestDiagnosticStart = {
  streamId: '12345678-1234-4234-8234-123456789abc', dispatchIndex: 1,
  model: 'fixture-model', protocol: 'openai-responses',
  composition: { state: 'size-limit', totalBytes: 21355789 }, encoding: 'identity', wireBytes: 21355789,
}
describe('content-free physical request observations', () => {
  it('requires independent consent, captures status/timing and never infers upload or retry count', () => {
    let now = 1000
    const collector = new DiagnosticsCollector('0.4.2-alpha.3', 'host', undefined, () => now, () => now)
    collector.setEnabled(true)
    expect(collector.beginRequest(start)).toBeUndefined()
    collector.setRequestEnabled(true)
    const request = collector.beginRequest(start)!
    request.headers(408, 61375, { state: 'observed', bodyWrite: 'observed', bodyWriteCompleteMs: 937,
      nativeResponseHeadersMs: 61374, nodeWritableBufferBytes: 0, alpn: 'http/1.1' })
    now += 61375
    request.finish('http-error', 'request-body-timeout')
    request.finish('stream-done')
    const rows = collector.snapshot().requests!.rows
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ httpStatus: 408, elapsedMs: 61375, responseHeadersMs: 61375,
      reason: 'request-body-timeout', composition: { state: 'size-limit' } })
    expect(rows[0]).not.toHaveProperty('uploadDuration')
    expect(rows[0]).not.toHaveProperty('retryCount')
    expect(rows[0]).not.toHaveProperty('sessionId')
  })
  it('bounds work, retained rows and 24-hour retention with explicit loss', () => {
    let now = 1000
    const collector = new DiagnosticsCollector('0.4.2-alpha.3', 'host', undefined, () => now)
    collector.setRequestEnabled(true)
    const handles = Array.from({ length: 128 }, () => collector.beginRequest(start)!)
    expect(collector.beginRequest(start)).toBeUndefined()
    for (const handle of handles) handle.finish('stream-error', 'unknown')
    collector.beginRequest({ ...start, dispatchIndex: 2 })!.finish('stream-done')
    expect(collector.snapshot().requests).toMatchObject({ dropped: 1, evicted: 1 })
    expect(collector.snapshot().requests!.rows).toHaveLength(128)
    now += REQUEST_DIAGNOSTICS_RETENTION_MS + 1
    expect(collector.snapshot().requests).toMatchObject({ rows: [], dropped: 1, evicted: 129, pending: 0 })
  })
  it('clear and pause fence late callbacks; close stops independent requests', () => {
    const collector = new DiagnosticsCollector('0.4.2-alpha.3', 'host')
    collector.setRequestEnabled(true)
    const old = collector.beginRequest(start)!
    collector.clear()
    old.headers(200, 1); old.finish('stream-done')
    expect(collector.snapshot().requests).toBeUndefined()
    const paused = collector.beginRequest(start)!
    collector.setRequestEnabled(false)
    paused.finish('stream-done')
    expect(collector.snapshot().requests!.rows.map(row => row.outcome)).toEqual(['interrupted'])
    collector.setRequestEnabled(true)
    collector.close()
    expect(collector.beginRequest(start)).toBeUndefined()
  })
  it('accepts old snapshots and rejects bodies, raw errors, headers or credentials', () => {
    expect(DiagnosticsSnapshotSchema.parse(emptyDiagnostics())).not.toHaveProperty('requests')
    const row = { ...start, startedAt: 1, elapsedMs: 1, version: '0.4.2-alpha.3', outcome: 'http-error', reason: 'unknown' }
    expect(RequestDiagnosticSchema.parse(row)).toEqual(row)
    for (const field of ['body', 'url', 'headers', 'credential', 'errorMessage', 'sessionId', 'turn']) {
      expect(RequestDiagnosticSchema.safeParse({ ...row, [field]: 'synthetic-sensitive-sentinel' }).success).toBe(false)
    }
  })
  it('reports saved pending counts as interrupted after reopen without fabricating request rows', () => {
    const collector = new DiagnosticsCollector('0.4.2-alpha.3', 'host')
    collector.setRequestEnabled(true)
    collector.beginRequest(start)
    const saved = collector.snapshot()
    expect(saved.requests).toMatchObject({ pending: 1, rows: [] })
    const reopened = new DiagnosticsCollector('0.4.2-alpha.4', 'host')
    reopened.restore(saved)
    expect(reopened.snapshot().requests).toMatchObject({ pending: 0, interruptedOnReopen: 1, rows: [] })
    expect(reopened.beginRequest(start)).toBeUndefined()
  })
  it('keeps newer request evidence when an older concurrent request settles after capacity is reached', () => {
    let now = 1000
    const collector = new DiagnosticsCollector('0.4.2-alpha.3', 'host', undefined, () => now)
    collector.setRequestEnabled(true)
    const slow = collector.beginRequest({ ...start, model: 'old-slow-model' })!
    now++
    for (let i = 0; i < 128; i++) collector.beginRequest({ ...start, dispatchIndex: i + 2 })!.finish('stream-done')
    slow.finish('stream-error', 'unknown')
    expect(collector.snapshot().requests!.rows).toHaveLength(128)
    expect(collector.snapshot().requests!.rows.some(row => row.model === 'old-slow-model')).toBe(false)
    expect(collector.snapshot().requests!.evicted).toBe(1)
  })
})
