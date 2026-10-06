import {
  DIAGNOSTICS_MAX_LIVE, DIAGNOSTICS_MAX_ROWS, DIAGNOSTICS_RETENTION_MS,
  DiagnosticsSnapshotSchema, diagnosticsBucket,
} from './diagnostics-types.ts'
import type { DiagnosticsOperation, DiagnosticsStage, DiagnosticsOutcome, DiagnosticsReason,
  DiagnosticsRow, DiagnosticsSnapshot } from './diagnostics-types.ts'

export interface DiagnosticsHandle {
  stage(stage: DiagnosticsStage): void
  finish(outcome: DiagnosticsOutcome, reason?: DiagnosticsReason): void
}
const noop: DiagnosticsHandle = { stage() {}, finish() {} }
export function emptyDiagnostics(): DiagnosticsSnapshot {
  return { schemaVersion: 1, coverageVersion: 1, epoch: 0, updatedAt: 0, rows: [], pending: [],
    dropped: 0, clientDropped: 0, clientUnconfirmed: 0, saturated: 0, evicted: 0, interrupted: 0 }
}
interface Live { operation: DiagnosticsOperation; stage: DiagnosticsStage; start: number; epoch: number }
/** Only fixed dimensions cross this boundary; live handles never leave the owner. */
export class DiagnosticsCollector {
  private data = emptyDiagnostics()
  private readonly live = new Set<Live>()
  private enabled = false
  private lastWall = 0
  constructor(readonly version: string, readonly layer: 'client' | 'host',
    private readonly changed: () => void = () => {},
    private readonly wall: () => number = Date.now,
    private readonly mono: () => number = () => performance.now()) {}

  restore(snapshot: DiagnosticsSnapshot): void {
    this.data = DiagnosticsSnapshotSchema.parse(snapshot)
    this.lastWall = this.data.updatedAt
    for (const pending of this.data.pending) {
      this.add(pending.operation, pending.stage, 'interrupted', 'unknown', pending.bucket, pending.count, pending.version)
      this.increment('interrupted', pending.count)
    }
    this.data.pending = []
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
    return DiagnosticsSnapshotSchema.parse({ ...this.data, updatedAt: this.wall(), pending })
  }
  close(): void { this.setEnabled(false) }
  noteDropped(): void { if (this.enabled) { this.increment('dropped'); this.changed() } }
  noteClientGaps(dropped: number, unconfirmed: number): void {
    if (!this.enabled) return
    this.increment('clientDropped', dropped)
    this.increment('clientUnconfirmed', unconfirmed)
    if (dropped || unconfirmed) this.changed()
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
