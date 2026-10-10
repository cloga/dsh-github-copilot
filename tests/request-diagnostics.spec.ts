import { describe, expect, it } from 'vitest'
import { DiagnosticsCollector, emptyDiagnostics } from '../src/diagnostics-collector.ts'
import { RequestDiagnosticSchema, CredentialChangeSchema, REQUEST_DIAGNOSTICS_RETENTION_MS } from '../src/request-diagnostics.ts'
import { DiagnosticsSnapshotSchema } from '../src/diagnostics-types.ts'
import type { RequestDiagnosticStart } from '../src/request-diagnostics.ts'

const start: RequestDiagnosticStart = {
  streamId: '12345678-1234-4234-8234-123456789abc', dispatchIndex: 1,
  model: 'fixture-model', protocol: 'openai-responses',
  composition: { state: 'size-limit', totalBytes: 21355789 }, encoding: 'identity', wireBytes: 21355789,
}
describe('content-free physical request observations', () => {
  it('rejects credential identities, values, raw causes and invalid numeric populations', () => {
    const row = { changeId: start.streamId, observedAt: 1, version: '0.4.2-alpha.7',
      phase: 'notification', reason: 'unknown-source', preparing: 0, dispatched: 1,
      alreadyAborted: 0, preserved: 0, revoked: 1 }
    expect(CredentialChangeSchema.safeParse(row).success).toBe(true)
    for (const field of ['accountId', 'key', 'token', 'fingerprint', 'endpoint', 'rawError', 'sessionId', 'body']) {
      expect(CredentialChangeSchema.safeParse({ ...row, [field]: 'synthetic-sensitive-sentinel' }).success).toBe(false)
    }
    expect(CredentialChangeSchema.safeParse({ ...row, reason: 'synthetic-sensitive-sentinel' }).success).toBe(false)
    expect(CredentialChangeSchema.safeParse({ ...row, revoked: Infinity }).success).toBe(false)
    const collector = new DiagnosticsCollector('0.4.2-alpha.7', 'client')
    collector.setRequestEnabled(true)
    expect(collector.beginCredentialChange()).toBeUndefined()
  })
  it('bounds pending credential handles and reports lost commits without fabricated rows', () => {
    let now = 1000
    const collector = new DiagnosticsCollector('0.4.2-alpha.7', 'host', undefined, () => now)
    collector.setRequestEnabled(true)
    const handles = Array.from({ length: 128 }, () => collector.beginCredentialChange()!)
    expect(collector.beginCredentialChange()).toBeUndefined()
    handles[0]!.cancel()
    collector.beginCredentialChange()!.record({ phase: 'notification', reason: 'qualified',
      preparing: 0, dispatched: 1, alreadyAborted: 0, preserved: 1, revoked: 0 })
    const saved = collector.snapshot()
    expect(saved.requests?.credentialChanges).toMatchObject({ pending: 128, dropped: 1 })
    const reopened = new DiagnosticsCollector('0.4.2-alpha.7', 'host', undefined, () => now)
    reopened.restore(saved)
    expect(reopened.snapshot().requests?.credentialChanges).toMatchObject({
      pending: 0, interruptedOnReopen: 128, rows: [{ phase: 'notification' }],
    })
    now += REQUEST_DIAGNOSTICS_RETENTION_MS + 1
    expect(collector.beginCredentialChange()).toBeDefined()
  })
  it('bounds credential evidence under request consent and fences late commit updates', () => {
    let now = 1000
    const collector = new DiagnosticsCollector('0.4.2-alpha.7', 'host', undefined, () => now)
    const evidence = { phase: 'notification' as const, reason: 'unknown-source' as const,
      preparing: 1, dispatched: 2, alreadyAborted: 0, preserved: 0, revoked: 3 }
    collector.setEnabled(true)
    expect(collector.beginCredentialChange()).toBeUndefined()
    collector.setRequestEnabled(true)
    const handle = collector.beginCredentialChange()!
    handle.record(evidence)
    handle.record({ ...evidence, phase: 'commit', reason: 'commit-mismatch' })
    const saved = collector.snapshot()
    expect(saved.requests?.credentialChanges?.rows).toHaveLength(2)
    expect(new Set(saved.requests?.credentialChanges?.rows.map(row => row.changeId)).size).toBe(1)
    const reopened = new DiagnosticsCollector('0.4.2-alpha.7', 'host', undefined, () => now)
    reopened.restore(saved)
    expect(reopened.snapshot().requests?.credentialChanges?.rows).toHaveLength(2)
    collector.setRequestEnabled(false)
    collector.setRequestEnabled(true)
    handle.record(evidence)
    expect(collector.snapshot().requests?.credentialChanges?.rows).toHaveLength(2)
    const cleared = collector.beginCredentialChange()!
    collector.clear()
    cleared.record(evidence)
    expect(collector.snapshot().requests).toBeUndefined()
    for (let index = 0; index < 129; index++) collector.beginCredentialChange()!.record(evidence)
    expect(collector.snapshot().requests?.credentialChanges).toMatchObject({ evicted: 1 })
    expect(collector.snapshot().requests?.credentialChanges?.rows).toHaveLength(128)
    now += REQUEST_DIAGNOSTICS_RETENTION_MS + 1
    expect(collector.snapshot().requests?.credentialChanges).toMatchObject({ rows: [], evicted: 129 })
  })
  it('updates only its own retained record after native settlement, never across clear/pause/eviction', () => {
    const collector = new DiagnosticsCollector('0.4.2-alpha.4', 'host')
    collector.setRequestEnabled(true)
    const first = collector.beginRequest(start)!
    const second = collector.beginRequest({ ...start, dispatchIndex: 2 })!
    first.finish('stream-done')
    second.finish('stream-error', 'unknown')
    first.composition!({ state: 'complete', totalBytes: 12, conversationBytes: 2, toolSchemaBytes: 0,
      systemBytes: 0, otherBytes: 10, imageBlockBytes: 0, opaqueReplayBytes: 0, remainingConversationBytes: 2 })
    expect(collector.snapshot().requests!.rows.map(row => row.composition.state)).toEqual(['complete', 'size-limit'])
    collector.setRequestEnabled(false)
    collector.setRequestEnabled(true)
    expect(second.isCurrent!()).toBe(false)
    second.composition!({ state: 'time-limit', totalBytes: 21355789 })
    expect(collector.snapshot().requests!.rows[1]!.composition.state).toBe('size-limit')
    const cleared = collector.beginRequest(start)!
    cleared.finish('stream-done')
    collector.clear()
    cleared.composition!({ state: 'time-limit' })
    expect(cleared.isCurrent!()).toBe(false)
    expect(collector.snapshot().requests).toBeUndefined()
    const evicted = collector.beginRequest(start)!
    evicted.finish('stream-done')
    for (let i = 0; i < 128; i++) collector.beginRequest({ ...start, dispatchIndex: i + 2 })!.finish('stream-done')
    expect(evicted.isCurrent!()).toBe(false)
    evicted.composition!({ state: 'time-limit' })
    expect(collector.snapshot().requests!.rows.every(row => row.composition.state === 'size-limit')).toBe(true)
  })
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
