import { z } from 'zod'
import {
  DIAGNOSTICS_OPERATIONS, DIAGNOSTICS_REASONS,
  DiagnosticsPendingSchema, DiagnosticsSnapshotSchema, DiagnosticsViewSchema,
} from './diagnostics-types.ts'
import type { DiagnosticsRow, DiagnosticsSnapshot, DiagnosticsView } from './diagnostics-types.ts'

const HOUR_MS = 3_600_000
const RETENTION_MS = 14 * 24 * HOUR_MS
const terminals = ['success', 'no-op', 'cancelled', 'policy-rejected', 'revoked',
  'environment-fault', 'failed', 'unknown', 'interrupted'] as const
const gaps = [
  'persisted-only', 'live-enabled-state-unknown', 'live-pending-state-unknown',
  'unflushed-tail-unknown', 'stored-pending-is-not-live', 'no-retained-operation-observations',
  'account-switch-not-observed', 'compaction-not-observed', 'stale-snapshot',
  'expired-in-stored-snapshot', 'host-dropped', 'client-dropped', 'client-unconfirmed',
  'retention-or-capacity-eviction', 'collector-saturated', 'interrupted-observations',
  'clock-discontinuity', 'recorded-pause', 'unpersisted-observations', 'collection-paused',
  'storage-not-ready', 'analysis-count-overflow', 'no-cross-layer-correlation',
  'no-unique-impact', 'hour-boundary-censoring', 'no-collection-coverage-clock',
  'no-calibrated-alert-thresholds', 'no-baseline-trend', 'no-root-cause-proof',
] as const
const intervals = [
  { lowerMs: 0, upperExclusiveMs: 100 }, { lowerMs: 100, upperExclusiveMs: 500 },
  { lowerMs: 500, upperExclusiveMs: 1_000 }, { lowerMs: 1_000, upperExclusiveMs: 5_000 },
  { lowerMs: 5_000, upperExclusiveMs: 15_000 }, { lowerMs: 15_000, upperExclusiveMs: 60_000 },
  { lowerMs: 60_000, upperExclusiveMs: 300_000 }, { lowerMs: 300_000, upperExclusiveMs: null },
] as const
type Count = { value: number | null; overflow: boolean }

const CountSchema = z.object({
  value: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
  overflow: z.boolean(),
}).strict().refine(value => value.overflow === (value.value === null))
const outcomeSchema = z.object({
  success: CountSchema, 'no-op': CountSchema, cancelled: CountSchema,
  'policy-rejected': CountSchema, revoked: CountSchema, 'environment-fault': CountSchema,
  failed: CountSchema, unknown: CountSchema, interrupted: CountSchema,
}).strict()
const intervalSchema = z.object({
  lowerMs: z.number().int().nonnegative(), upperExclusiveMs: z.number().int().positive().nullable(),
  count: CountSchema,
}).strict().refine(value => value.upperExclusiveMs === null || value.lowerMs < value.upperExclusiveMs)
const populationSchema = z.object({
  version: z.string().max(64).regex(/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/),
  layer: z.enum(['client', 'host']),
  operation: z.enum(DIAGNOSTICS_OPERATIONS),
  successMeaning: z.enum([
    'owner-terminal-observation-only',
    'matching-checkpoint-and-end-observed',
    'summary-call-fulfilled-not-checkpoint-commit',
  ]),
  firstHour: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  lastHour: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  started: CountSchema,
  terminalObservations: CountSchema,
  outcomes: outcomeSchema,
  terminalLatency: z.array(intervalSchema).length(8),
  stageAgeObservations: z.array(intervalSchema).length(8),
  pendingSamples: CountSchema,
  pendingSampleAges: z.array(intervalSchema).length(8),
  stageObservations: CountSchema,
  startsMinusTerminals: z.null(),
  exactOperationFailureRate: z.null(),
}).strict().refine(value => value.firstHour <= value.lastHour)
  .refine(value => value.successMeaning === (value.operation === 'compaction'
    ? 'matching-checkpoint-and-end-observed'
    : value.operation === 'compaction-summary'
      ? 'summary-call-fulfilled-not-checkpoint-commit'
      : 'owner-terminal-observation-only'))
const candidateSchema = z.object({
  fingerprint: z.string().max(256).regex(/^coverage-1\|(?:client|host)\|[a-z-]+\|(?:failed|environment-fault|unknown)\|[A-Za-z0-9_-]+$/),
  category: z.enum(['recorded-failure', 'unknown-outcome']),
  layer: z.enum(['client', 'host']),
  operation: z.enum(DIAGNOSTICS_OPERATIONS),
  metric: z.enum(['failed', 'environment-fault', 'unknown']),
  reason: z.enum(DIAGNOSTICS_REASONS),
  versions: z.array(z.string().max(64).regex(/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/)).max(4_096),
  firstHour: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  lastHour: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  observations: CountSchema,
  regressionProven: z.literal(false),
  persistentFaultProven: z.literal(false),
  rootCause: z.literal('unknown'),
}).strict().refine(value => value.firstHour <= value.lastHour)
  .refine(value => value.fingerprint
    === `coverage-1|${value.layer}|${value.operation}|${value.metric}|${value.reason}`)
  .refine(value => value.category
    === (value.metric === 'unknown' ? 'unknown-outcome' : 'recorded-failure'))
const collectionSchema = z.object({
  enabled: z.boolean().nullable(),
  state: z.enum(['loading', 'ready', 'unavailable', 'error']).nullable(),
  diagnostic: z.enum(['none', 'storage-unavailable', 'storage-invalid', 'storage-write-failed',
    'profile-unavailable', 'settings-unavailable', 'settings-conflict', 'client-report-failed',
    'client-report-revoked', 'closed']).nullable(),
  dirty: z.boolean().nullable(),
  persistedAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
}).strict()

export const DiagnosticsAnalysisReportSchema = z.object({
  reportVersion: z.literal(1),
  coverageVersion: z.literal(1),
  interpretation: z.literal('descriptive-observations-only'),
  source: z.enum(['reviewed-view', 'persisted-snapshot']),
  observedAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  snapshotAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  ageMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
  epoch: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  coverageComplete: z.literal(false),
  effectivenessVerified: z.literal(false),
  gaps: z.array(z.enum(gaps)).max(gaps.length),
  collection: collectionSchema,
  counters: z.object({
    dropped: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    clientDropped: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    clientUnconfirmed: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    evicted: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    saturated: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    interrupted: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  }).strict(),
  populations: z.array(populationSchema).max(4_096),
  pendingAtSnapshot: z.array(DiagnosticsPendingSchema).max(128),
  investigationCandidates: z.array(candidateSchema).max(4_096),
}).strict().refine(value => new Set(value.gaps).size === value.gaps.length)
export type DiagnosticsAnalysisReport = z.infer<typeof DiagnosticsAnalysisReportSchema>
export type DiagnosticsAnalysisSource = 'reviewed-view' | 'persisted-snapshot'

function sum(values: readonly number[]): Count {
  const total = values.reduce((value, next) => value + BigInt(next), 0n)
  return total > BigInt(Number.MAX_SAFE_INTEGER)
    ? { value: null, overflow: true } : { value: Number(total), overflow: false }
}

function parseSnapshot(input: unknown): DiagnosticsSnapshot {
  const parsed = DiagnosticsSnapshotSchema.safeParse(input)
  if (!parsed.success) throw new Error('COPILOT_DIAGNOSTICS_ANALYSIS_INVALID_SNAPSHOT')
  const tuples = new Set<string>()
  for (const row of parsed.data.rows) {
    const tuple = [row.hour, row.version, row.layer, row.operation, row.stage,
      row.metric, row.reason, row.bucket].join('|')
    if (tuples.has(tuple)) throw new Error('COPILOT_DIAGNOSTICS_ANALYSIS_DUPLICATE_AGGREGATE')
    tuples.add(tuple)
  }
  return parsed.data
}

function parseJsonText(text: string): unknown {
  if (Buffer.byteLength(text, 'utf8') > 8 * 1024 * 1024)
    throw new Error('COPILOT_DIAGNOSTICS_ANALYSIS_INPUT_LIMIT')
  try { return JSON.parse(text) } catch {
    throw new Error('COPILOT_DIAGNOSTICS_ANALYSIS_INVALID_JSON')
  }
}

function order(left: string | number, right: string | number): number {
  return left < right ? -1 : left > right ? 1 : 0
}

export function diagnosticsUnitName(profileName: string): string {
  if (!/^[a-zA-Z0-9_-]{1,48}$/.test(profileName))
    throw new Error('COPILOT_DIAGNOSTICS_ANALYSIS_INVALID_PROFILE')
  return `github_copilot_diagnostics_${Buffer.from(profileName, 'ascii').toString('hex')}`
}

export function parseReviewedView(text: string): DiagnosticsView {
  const parsed = DiagnosticsViewSchema.safeParse(parseJsonText(text))
  if (!parsed.success) throw new Error('COPILOT_DIAGNOSTICS_ANALYSIS_INVALID_VIEW')
  return parsed.data
}

export function parsePersistedUnit(text: string, expectedUnit: string): DiagnosticsSnapshot {
  if (!/^github_copilot_diagnostics_(?:[a-f0-9]{2}){1,48}$/.test(expectedUnit))
    throw new Error('COPILOT_DIAGNOSTICS_ANALYSIS_INVALID_UNIT')
  const input = parseJsonText(text)
  if (typeof input !== 'object' || input === null || Array.isArray(input)
    || Object.keys(input).sort().join(',') !== 'global,tables,unit'
    || !('unit' in input) || typeof input.unit !== 'object' || input.unit === null
    || Array.isArray(input.unit) || Object.keys(input.unit).sort().join(',') !== 'name,version'
    || !('name' in input.unit) || input.unit.name !== expectedUnit
    || !('version' in input.unit) || input.unit.version !== 1
    || !('tables' in input) || typeof input.tables !== 'object' || input.tables === null
    || Array.isArray(input.tables) || Object.keys(input.tables).length !== 0
    || !('global' in input)) throw new Error('COPILOT_DIAGNOSTICS_ANALYSIS_INVALID_UNIT')
  return parseSnapshot(input.global)
}

export function analyzeSnapshot(input: unknown, options: {
  source: DiagnosticsAnalysisSource
  observedAt: number
  view?: DiagnosticsView
}): DiagnosticsAnalysisReport {
  if (!Number.isSafeInteger(options.observedAt) || options.observedAt < 0
    || !['reviewed-view', 'persisted-snapshot'].includes(options.source)
    || (options.source === 'reviewed-view') !== (options.view !== undefined))
    throw new Error('COPILOT_DIAGNOSTICS_ANALYSIS_INVALID_OPTIONS')
  const snapshot = parseSnapshot(input)
  const rows = [...snapshot.rows].sort((a, b) =>
    order(a.version, b.version) || order(a.layer, b.layer) || order(a.operation, b.operation)
    || a.hour - b.hour || order(a.stage, b.stage) || order(a.metric, b.metric)
    || order(a.reason, b.reason) || a.bucket - b.bucket)
  const groups = new Map<string, DiagnosticsRow[]>()
  for (const row of rows) {
    if (row.operation === 'collection') continue
    const key = `${row.version}|${row.layer}|${row.operation}`
    const population = groups.get(key) ?? []
    population.push(row)
    groups.set(key, population)
  }
  const populations = [...groups.values()].map(population => {
    const first = population[0]!
    const terminalRows = population.filter(row => terminals.some(metric => metric === row.metric))
    const outcomes = Object.fromEntries(terminals.map(metric => [
      metric, sum(population.filter(row => row.metric === metric).map(row => row.count)),
    ]))
    return {
      version: first.version, layer: first.layer, operation: first.operation,
      successMeaning: first.operation === 'compaction'
        ? 'matching-checkpoint-and-end-observed'
        : first.operation === 'compaction-summary'
          ? 'summary-call-fulfilled-not-checkpoint-commit'
          : 'owner-terminal-observation-only',
      firstHour: Math.min(...population.map(row => row.hour)),
      lastHour: Math.max(...population.map(row => row.hour)),
      started: sum(population.filter(row => row.metric === 'started').map(row => row.count)),
      terminalObservations: sum(terminalRows.map(row => row.count)),
      outcomes,
      terminalLatency: intervals.map((interval, bucket) => ({
        ...interval,
        count: sum(terminalRows.filter(row => row.bucket === bucket).map(row => row.count)),
      })),
      stageAgeObservations: intervals.map((interval, bucket) => ({
        ...interval,
        count: sum(population.filter(row => row.metric === 'stage' && row.bucket === bucket).map(row => row.count)),
      })),
      pendingSamples: sum(population.filter(row => row.metric === 'pending-sample').map(row => row.count)),
      pendingSampleAges: intervals.map((interval, bucket) => ({
        ...interval,
        count: sum(population.filter(row => row.metric === 'pending-sample' && row.bucket === bucket)
          .map(row => row.count)),
      })),
      stageObservations: sum(population.filter(row => row.metric === 'stage').map(row => row.count)),
      startsMinusTerminals: null,
      exactOperationFailureRate: null,
    }
  })
  const candidates = new Map<string, {
    fingerprint: string
    category: 'recorded-failure' | 'unknown-outcome'
    layer: DiagnosticsRow['layer']
    operation: DiagnosticsRow['operation']
    metric: 'failed' | 'environment-fault' | 'unknown'
    reason: DiagnosticsRow['reason']
    versions: string[]
    hours: number[]
    counts: number[]
  }>()
  for (const row of rows) {
    if ((row.metric !== 'failed' && row.metric !== 'environment-fault' && row.metric !== 'unknown')
      || row.operation === 'collection') continue
    const metric = row.metric
    const fingerprint = `coverage-1|${row.layer}|${row.operation}|${metric}|${row.reason}`
    const candidate = candidates.get(fingerprint) ?? {
      fingerprint,
      category: metric === 'unknown' ? 'unknown-outcome' as const : 'recorded-failure' as const,
      layer: row.layer, operation: row.operation, metric, reason: row.reason,
      versions: [], hours: [], counts: [],
    }
    candidate.versions.push(row.version)
    candidate.hours.push(row.hour)
    candidate.counts.push(row.count)
    candidates.set(fingerprint, candidate)
  }
  const gapSet = new Set<string>([
    'no-cross-layer-correlation', 'no-unique-impact', 'hour-boundary-censoring',
    'no-collection-coverage-clock', 'no-calibrated-alert-thresholds', 'no-baseline-trend',
    'no-root-cause-proof',
  ])
  const view = options.view
  if (options.source === 'persisted-snapshot') {
    gapSet.add('persisted-only')
    gapSet.add('live-enabled-state-unknown')
    gapSet.add('live-pending-state-unknown')
    gapSet.add('unflushed-tail-unknown')
    if (snapshot.pending.length) gapSet.add('stored-pending-is-not-live')
  }
  if (!populations.length) gapSet.add('no-retained-operation-observations')
  if (!populations.some(row => ['account-global-switch', 'account-session-select', 'account-session-inherit'].includes(row.operation)))
    gapSet.add('account-switch-not-observed')
  if (!populations.some(row => row.operation === 'compaction' || row.operation === 'compaction-summary'))
    gapSet.add('compaction-not-observed')
  if (snapshot.updatedAt <= options.observedAt - RETENTION_MS) gapSet.add('stale-snapshot')
  if (snapshot.rows.some(row => row.hour <= options.observedAt - RETENTION_MS))
    gapSet.add('expired-in-stored-snapshot')
  if (snapshot.dropped) gapSet.add('host-dropped')
  if (snapshot.clientDropped) gapSet.add('client-dropped')
  if (snapshot.clientUnconfirmed) gapSet.add('client-unconfirmed')
  if (snapshot.evicted) gapSet.add('retention-or-capacity-eviction')
  if (snapshot.saturated) gapSet.add('collector-saturated')
  if (snapshot.interrupted || snapshot.rows.some(row => row.metric === 'interrupted'))
    gapSet.add('interrupted-observations')
  if (snapshot.rows.some(row => row.metric === 'clock-discontinuity') || snapshot.updatedAt > options.observedAt
    || snapshot.rows.some(row => row.hour > options.observedAt)) gapSet.add('clock-discontinuity')
  if (snapshot.rows.some(row => row.metric === 'paused')) gapSet.add('recorded-pause')
  if (view?.dirty) gapSet.add('unpersisted-observations')
  if (view && !view.enabled) gapSet.add('collection-paused')
  if (view && view.state !== 'ready') gapSet.add('storage-not-ready')

  const report = {
    reportVersion: 1 as const,
    coverageVersion: 1 as const,
    interpretation: 'descriptive-observations-only' as const,
    source: options.source,
    observedAt: options.observedAt,
    snapshotAt: snapshot.updatedAt,
    ageMs: snapshot.updatedAt <= options.observedAt ? options.observedAt - snapshot.updatedAt : null,
    epoch: snapshot.epoch,
    coverageComplete: false as const,
    effectivenessVerified: false as const,
    gaps: [...gapSet],
    collection: {
      enabled: view?.enabled ?? null,
      state: view?.state ?? null,
      diagnostic: view?.diagnostic ?? null,
      dirty: view?.dirty ?? null,
      persistedAt: view?.persistedAt ?? null,
    },
    counters: {
      dropped: snapshot.dropped, clientDropped: snapshot.clientDropped,
      clientUnconfirmed: snapshot.clientUnconfirmed, evicted: snapshot.evicted,
      saturated: snapshot.saturated, interrupted: snapshot.interrupted,
    },
    populations,
    pendingAtSnapshot: snapshot.pending,
    investigationCandidates: [...candidates.values()].map(candidate => ({
      fingerprint: candidate.fingerprint,
      category: candidate.category,
      layer: candidate.layer,
      operation: candidate.operation,
      metric: candidate.metric,
      reason: candidate.reason,
      versions: [...new Set(candidate.versions)].sort(order),
      firstHour: Math.min(...candidate.hours),
      lastHour: Math.max(...candidate.hours),
      observations: sum(candidate.counts),
      regressionProven: false as const,
      persistentFaultProven: false as const,
      rootCause: 'unknown' as const,
    })),
  }
  const parsed = DiagnosticsAnalysisReportSchema.safeParse(report)
  if (!parsed.success) throw new Error('COPILOT_DIAGNOSTICS_ANALYSIS_INVALID_REPORT')
  if (populations.some(population => [
    population.started, population.terminalObservations, population.stageObservations,
    population.pendingSamples, ...Object.values(population.outcomes),
    ...population.terminalLatency.map(bin => bin.count),
    ...population.stageAgeObservations.map(bin => bin.count),
    ...population.pendingSampleAges.map(bin => bin.count),
  ].some(count => count.overflow))
    || report.investigationCandidates.some(candidate => candidate.observations.overflow))
    gapSet.add('analysis-count-overflow')
  if (gapSet.has('analysis-count-overflow')) {
    const corrected = DiagnosticsAnalysisReportSchema.safeParse({ ...parsed.data, gaps: [...gapSet] })
    if (!corrected.success) throw new Error('COPILOT_DIAGNOSTICS_ANALYSIS_INVALID_REPORT')
    return corrected.data
  }
  return parsed.data
}

export function analyzeReviewedView(view: DiagnosticsView, observedAt: number): DiagnosticsAnalysisReport {
  const parsed = DiagnosticsViewSchema.safeParse(view)
  if (!parsed.success) throw new Error('COPILOT_DIAGNOSTICS_ANALYSIS_INVALID_VIEW')
  return analyzeSnapshot(parsed.data.snapshot, { source: 'reviewed-view', observedAt, view: parsed.data })
}
