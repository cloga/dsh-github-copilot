import {
  DIAGNOSTICS_MAX_LIVE, DIAGNOSTICS_MAX_ROWS, DIAGNOSTICS_RETENTION_MS,
  DiagnosticsSnapshotSchema, diagnosticsBucket,
} from './diagnostics-types.ts'
import type { DiagnosticsOperation, DiagnosticsStage, DiagnosticsOutcome, DiagnosticsReason,
  DiagnosticsRow, DiagnosticsSnapshot } from './diagnostics-types.ts'
import { AutoAllocationDiagnosticsCollector, emptyAutoAllocationDiagnostics } from './auto-allocation-diagnostics.ts'
import type { AutoSelectionExplanation } from './auto-model-routing.ts'
import { REQUEST_DIAGNOSTICS_MAX_ROWS, REQUEST_DIAGNOSTICS_RETENTION_MS, RequestDiagnosticSchema } from './request-diagnostics.ts'
import type { RequestDiagnostic, RequestDiagnosticHandle, RequestDiagnosticStart } from './request-diagnostics.ts'

export interface DiagnosticsHandle {
  stage(stage: DiagnosticsStage): void
  finish(outcome: DiagnosticsOutcome, reason?: DiagnosticsReason): void
}
const noop: DiagnosticsHandle = { stage() {}, finish() {} }
export function emptyDiagnostics(): DiagnosticsSnapshot {
  return { schemaVersion: 1, coverageVersion: 1, epoch: 0, updatedAt: 0, rows: [], pending: [],
    autoAllocation: emptyAutoAllocationDiagnostics(),
    dropped: 0, clientDropped: 0, clientUnconfirmed: 0, saturated: 0, evicted: 0, interrupted: 0 }
}
interface Live { operation: DiagnosticsOperation; stage: DiagnosticsStage; start: number; epoch: number }
/** Only fixed dimensions cross this boundary; live handles never leave the owner. */
export class DiagnosticsCollector {
  private data = emptyDiagnostics()
  private readonly live = new Set<Live>()
  private enabled = false
  private autoAllocationEnabled = false
  private requestEnabled = false
  private readonly requestHandles = new Set<RequestDiagnosticHandle>()
  private lastWall = 0
  private readonly autoAllocation: AutoAllocationDiagnosticsCollector
  constructor(readonly version: string, readonly layer: 'client' | 'host',
    private readonly changed: () => void = () => {},
    private readonly wall: () => number = Date.now,
    private readonly mono: () => number = () => performance.now()) {
    this.autoAllocation = new AutoAllocationDiagnosticsCollector(version, changed, wall)
  }

  restore(snapshot: DiagnosticsSnapshot): void {
    this.data = DiagnosticsSnapshotSchema.parse(snapshot)
    this.autoAllocation.restore(this.data.autoAllocation ?? emptyAutoAllocationDiagnostics())
    this.data.autoAllocation = this.autoAllocation.snapshot()
    this.lastWall = this.data.updatedAt
    for (const pending of this.data.pending) {
      this.add(pending.operation, pending.stage, 'interrupted', 'unknown', pending.bucket, pending.count, pending.version)
      this.increment('interrupted', pending.count)
    }
    this.data.pending = []
    if (this.data.requests) {
      const requests = this.data.requests
      requests.interruptedOnReopen = Math.min(Number.MAX_SAFE_INTEGER,
        (requests.interruptedOnReopen ?? 0) + (requests.pending ?? 0))
      requests.pending = 0
      this.changed()
    }
    this.expire()
  }
  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return
    if (enabled) this.assertCanEnable()
    if (this.enabled && !enabled) {
      for (const live of this.live) this.settle(live, 'interrupted', 'unknown')
      this.add('collection', 'admitted', 'paused', 'none', 0)
    }
    if (this.data.epoch >= Number.MAX_SAFE_INTEGER) {
      this.enabled = false
      this.increment('saturated')
      this.changed()
      return
    }
    this.data.epoch++
    this.enabled = enabled
    this.changed()
  }
  assertCanEnable(): void {
    if (!this.enabled && this.data.epoch >= Number.MAX_SAFE_INTEGER)
      throw new Error('COPILOT_DIAGNOSTICS_EPOCH_LIMIT')
  }
  clear(): void {
    const epoch = this.data.epoch + 1
    if (!Number.isSafeInteger(epoch)) throw new Error('COPILOT_DIAGNOSTICS_EPOCH_LIMIT')
    this.live.clear()
    this.requestHandles.clear()
    this.autoAllocation.clear()
    this.data = { ...emptyDiagnostics(), epoch }
    this.changed()
  }
  begin(operation: DiagnosticsOperation): DiagnosticsHandle {
    if (!this.enabled) return noop
    if (this.live.size >= DIAGNOSTICS_MAX_LIVE) {
      this.increment('dropped')
      this.changed()
      return noop
    }
    const live: Live = { operation, stage: 'admitted', start: this.mono(), epoch: this.data.epoch }
    this.live.add(live)
    this.add(operation, live.stage, 'started', 'none', 0)
    return {
      stage: stage => {
        if (!this.live.has(live) || live.epoch !== this.data.epoch) return
        live.stage = stage
        this.add(operation, stage, 'stage', 'none', this.age(live))
      },
      finish: (outcome, reason = 'none') => this.settle(live, outcome, reason),
    }
  }
  private settle(live: Live, outcome: DiagnosticsOutcome, reason: DiagnosticsReason): void {
    if (!this.live.delete(live) || live.epoch !== this.data.epoch) return
    this.add(live.operation, live.stage, outcome, reason, this.age(live))
    if (outcome === 'interrupted') this.increment('interrupted')
  }
  private age(live: Live): number { return diagnosticsBucket(Math.max(0, this.mono() - live.start)) }
  private increment(field: 'dropped' | 'clientDropped' | 'clientUnconfirmed' | 'saturated' | 'evicted' | 'interrupted', amount = 1): void {
    if (field !== 'saturated' && this.data[field] > Number.MAX_SAFE_INTEGER - amount)
      this.data.saturated = Math.min(Number.MAX_SAFE_INTEGER, this.data.saturated + 1)
    this.data[field] = Math.min(Number.MAX_SAFE_INTEGER, this.data[field] + amount)
  }
  private expire(): void {
    const now = this.wall()
    const oldest = Math.floor((now - DIAGNOSTICS_RETENTION_MS) / 3_600_000) * 3_600_000
    const kept = this.data.rows.filter(row => row.hour > oldest)
    this.increment('evicted', this.data.rows.length - kept.length)
    if (kept.length !== this.data.rows.length) this.changed()
    this.data.rows = kept
    const requests = this.data.requests
    if (requests) {
      const retained = requests.rows.filter(row => row.startedAt > now - REQUEST_DIAGNOSTICS_RETENTION_MS)
      requests.evicted = Math.min(Number.MAX_SAFE_INTEGER, requests.evicted + requests.rows.length - retained.length)
      if (retained.length !== requests.rows.length) this.changed()
      requests.rows = retained
    }
  }
  private add(operation: DiagnosticsOperation, stage: DiagnosticsStage, metric: DiagnosticsRow['metric'],
    reason: DiagnosticsReason, bucket: number, count = 1, version = this.version): void {
    this.expire()
    const now = this.wall()
    const discontinuity = now < this.lastWall
    this.lastWall = now
    const row: DiagnosticsRow = { hour: Math.floor(now / 3_600_000) * 3_600_000, version,
      layer: this.layer, operation, stage, metric, reason, bucket, count }
    const existing = this.data.rows.find(item => item.hour === row.hour && item.version === row.version
      && item.layer === row.layer && item.operation === operation && item.stage === stage && item.metric === metric
      && item.reason === reason && item.bucket === bucket)
    if (existing) {
      if (existing.count > Number.MAX_SAFE_INTEGER - count) this.increment('saturated')
      existing.count = Math.min(Number.MAX_SAFE_INTEGER, existing.count + count)
    } else {
      if (this.data.rows.length >= DIAGNOSTICS_MAX_ROWS) {
        const index = this.oldestIndex()
        this.increment('evicted')
        if (row.hour < this.data.rows[index]!.hour) { this.changed(); return }
        this.data.rows.splice(index, 1)
      }
      this.data.rows.push(row)
    }
    this.changed()
    if (discontinuity) this.add('collection', 'admitted', 'clock-discontinuity', 'unknown', 0)
  }
  private oldestIndex(): number {
    let index = 0
    for (let candidate = 1; candidate < this.data.rows.length; candidate++)
      if (this.data.rows[candidate]!.hour < this.data.rows[index]!.hour) index = candidate
    return index
  }
  snapshot(): DiagnosticsSnapshot {
    this.expire()
    const pending: DiagnosticsSnapshot['pending'] = []
    for (const live of this.live) {
      const bucket = this.age(live)
      const existing = pending.find(row => row.operation === live.operation && row.stage === live.stage && row.bucket === bucket)
      if (existing) existing.count++
      else pending.push({ version: this.version, operation: live.operation, stage: live.stage, bucket, count: 1 })
    }
    return DiagnosticsSnapshotSchema.parse({ ...this.data,
      ...(this.data.requests ? { requests: { ...this.data.requests, pending: this.requestHandles.size } } : {}),
      autoAllocation: this.autoAllocation.snapshot(),
      updatedAt: this.wall(), pending })
  }
  close(): void { this.setEnabled(false); this.setAutoAllocationEnabled(false); this.setRequestEnabled(false) }
  setRequestEnabled(enabled: boolean): void {
    if (this.requestEnabled && !enabled) {
      for (const handle of this.requestHandles) handle.finish('interrupted', 'unknown')
    }
    this.requestEnabled = enabled
  }
  beginRequest(start: RequestDiagnosticStart): RequestDiagnosticHandle | undefined {
    if (!this.requestEnabled) return undefined
    const requests = this.data.requests ??= { rows: [], dropped: 0, evicted: 0 }
    if (this.requestHandles.size >= DIAGNOSTICS_MAX_LIVE) {
      requests.dropped = Math.min(Number.MAX_SAFE_INTEGER, requests.dropped + 1)
      this.changed()
      return undefined
    }
    const startedAt = this.wall(), startedMono = this.mono()
    const base = {
      ...start, version: this.version, startedAt,
      model: /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(start.model) ? start.model : 'unknown',
    }
    let headers: { httpStatus?: number; responseHeadersMs?: number; upload?: RequestDiagnostic['upload'] } = {}
    const handle: RequestDiagnosticHandle = {
      headers: (httpStatus, ms, upload) => {
        if (!this.requestHandles.has(handle)) return
        headers = { ...(httpStatus === undefined ? {} : { httpStatus }),
          ...(ms === undefined ? {} : { responseHeadersMs: Math.round(ms) }), ...(upload ? { upload } : {}) }
      },
      finish: (outcome, reason = 'none') => {
        if (!this.requestHandles.delete(handle)) return
        this.expire()
        const current = this.data.requests
        if (!current) return
        const parsed = RequestDiagnosticSchema.safeParse({
          ...base, ...headers, elapsedMs: Math.max(0, Math.round(this.mono() - startedMono)), outcome, reason,
        })
        if (!parsed.success) {
          current.dropped = Math.min(Number.MAX_SAFE_INTEGER, current.dropped + 1)
          this.changed()
          return
        }
        const rows = [...current.rows, parsed.data]
        const evicted = rows.length > REQUEST_DIAGNOSTICS_MAX_ROWS ? 1 : 0
        if (evicted) {
          let oldest = 0
          for (let index = 1; index < rows.length; index++)
            if (rows[index]!.startedAt < rows[oldest]!.startedAt) oldest = index
          rows.splice(oldest, 1)
        }
        const candidate = { ...this.data, requests: { ...current, rows,
          evicted: Math.min(Number.MAX_SAFE_INTEGER, current.evicted + evicted) } }
        if (DiagnosticsSnapshotSchema.safeParse(candidate).success) this.data = candidate
        else current.dropped = Math.min(Number.MAX_SAFE_INTEGER, current.dropped + 1)
        this.changed()
      },
    }
    this.requestHandles.add(handle)
    this.changed()
    return handle
  }
  isRequestEnabled(): boolean { return this.requestEnabled }
  noteDropped(): void { if (this.enabled) { this.increment('dropped'); this.changed() } }
  noteClientGaps(dropped: number, unconfirmed: number): void {
    if (!this.enabled) return
    this.increment('clientDropped', dropped)
    this.increment('clientUnconfirmed', unconfirmed)
    if (dropped || unconfirmed) this.changed()
  }
  recordAutoAllocation(explanation: AutoSelectionExplanation): void {
    if (!this.autoAllocationEnabled) return
    if (explanation.method !== 'no-fit' && explanation.method !== 'weighted-distribution'
      && explanation.method !== 'only-candidate') return
    if (explanation.method !== 'no-fit' && explanation.allocation === undefined) return
    const before = this.autoAllocation.snapshot()
    this.autoAllocation.record(explanation)
    const next = this.autoAllocation.snapshot()
    const candidate = { ...this.data, autoAllocation: next }
    if (!DiagnosticsSnapshotSchema.safeParse(candidate).success) {
      this.autoAllocation.restore(before, false)
      this.autoAllocation.setEnabled(this.enabled)
      this.data.saturated = Math.min(Number.MAX_SAFE_INTEGER, this.data.saturated + 1)
      this.changed()
      return
    }
    this.data.autoAllocation = next
  }
  setAutoAllocationEnabled(enabled: boolean): void {
    this.autoAllocationEnabled = enabled
    this.autoAllocation.setEnabled(enabled)
  }
  mergeClient(rows: readonly DiagnosticsRow[]): void {
    if (!this.enabled) return
    const now = this.wall()
    for (const row of rows) {
      if (row.layer !== 'client' || row.hour > now || row.hour <= now - DIAGNOSTICS_RETENTION_MS) {
        this.noteDropped()
        continue
      }
      const existing = this.data.rows.find(item => Object.keys(row).every(key =>
        key === 'count' || Reflect.get(item, key) === Reflect.get(row, key)))
      if (existing) {
        if (existing.count > Number.MAX_SAFE_INTEGER - row.count) this.increment('saturated')
        existing.count = Math.min(Number.MAX_SAFE_INTEGER, existing.count + row.count)
      } else {
        if (this.data.rows.length >= DIAGNOSTICS_MAX_ROWS) {
          const index = this.oldestIndex()
          this.increment('evicted')
          if (row.hour < this.data.rows[index]!.hour) { this.changed(); continue }
          this.data.rows.splice(index, 1)
        }
        this.data.rows.push({ ...row })
      }
      this.changed()
    }
  }
}
