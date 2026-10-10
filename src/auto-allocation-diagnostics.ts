import { z } from 'zod'
import { AUTO_ALLOCATION_POLICY, AutoAllocationSchema } from './auto-allocation.ts'
import type { AutoSelectionExplanation } from './auto-model-routing.ts'

export const AUTO_ALLOCATION_DIAGNOSTIC_MAX_ROWS = 1024
export const AUTO_ALLOCATION_DIAGNOSTIC_RETENTION_MS = 14 * 24 * 60 * 60 * 1000
const dayMs = 24 * 60 * 60 * 1000
const integer = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const version = z.string().max(64).regex(/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/)
const assessmentOutcome = z.enum([
  'local-known', 'local-unknown', 'semantic-known', 'semantic-unknown',
  'disabled', 'unavailable', 'invalid-result', 'timeout', 'failed', 'context-omitted',
])
const allocationRow = z.object({
  day: integer.multipleOf(dayMs),
  version,
  policyVersion: z.string().min(1).max(64),
  modelId: z.string().min(1).max(512),
  targetCategory: z.enum(['powerful', 'versatile', 'lightweight']),
  category: z.enum(['powerful', 'versatile', 'lightweight', 'unknown']),
  demand: z.enum(['simple', 'routine', 'complex', 'unknown']),
  assessmentSource: z.enum(['local', 'semantic']),
  assessmentOutcome: assessmentOutcome.optional(),
  method: z.enum(['weighted-distribution', 'only-candidate']),
  fallback: z.boolean(),
  highCost: z.boolean(),
  previous: z.boolean(),
  weight: z.number().positive().max(1.5),
  opportunities: integer.min(1),
  expectedSelections: z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER),
  selections: integer,
}).strict()
const noFitRow = z.object({
  day: integer.multipleOf(dayMs), version, policyVersion: z.string().min(1).max(64),
  targetCategory: z.enum(['powerful', 'versatile', 'lightweight']),
  category: z.enum(['powerful', 'versatile', 'lightweight', 'unknown']),
  demand: z.enum(['simple', 'routine', 'complex', 'unknown']),
  assessmentSource: z.enum(['local', 'semantic']),
  assessmentOutcome: assessmentOutcome.optional(),
  decisions: integer.min(1),
}).strict()

export const AutoAllocationDiagnosticsSchema = z.object({
  status: z.enum(['observed', 'not-collected']),
  rows: z.array(allocationRow).max(AUTO_ALLOCATION_DIAGNOSTIC_MAX_ROWS),
  noFitRows: z.array(noFitRow).max(AUTO_ALLOCATION_DIAGNOSTIC_MAX_ROWS),
  observationStart: integer.nullable(),
  observationEnd: integer.nullable(),
  completeHistory: z.literal(false),
  rowsTruncated: z.boolean(),
  dropped: integer,
  expired: integer,
  saturated: integer,
  restarts: integer,
}).strict().refine(value => JSON.stringify(value).length <= 1_500_000, 'Auto allocation diagnostic capacity exceeded')
  .refine(value => value.rows.length + value.noFitRows.length <= AUTO_ALLOCATION_DIAGNOSTIC_MAX_ROWS,
    'Auto allocation row capacity exceeded')
  .refine(({ observationStart, observationEnd }) => observationStart === null
    ? observationEnd === null : observationEnd !== null && observationEnd >= observationStart,
  'Auto allocation observation window is inconsistent')
export type AutoAllocationDiagnostics = z.infer<typeof AutoAllocationDiagnosticsSchema>

export function emptyAutoAllocationDiagnostics(): AutoAllocationDiagnostics {
  return {
    status: 'not-collected', rows: [], noFitRows: [], observationStart: null, observationEnd: null,
    completeHistory: false, rowsTruncated: false, dropped: 0, expired: 0, saturated: 0, restarts: 0,
  }
}

/** Profile-local rolling aggregates; no per-turn, Session, prompt, or execution-outcome records. */
export class AutoAllocationDiagnosticsCollector {
  private data = emptyAutoAllocationDiagnostics()
  private enabled = false

  constructor(private readonly version: string, private readonly changed: () => void = () => {},
    private readonly wall: () => number = Date.now) {}

  restore(value: unknown, countRestart = true): void {
    this.data = AutoAllocationDiagnosticsSchema.parse(value)
    if (countRestart && this.data.status === 'observed') {
      this.data.restarts = this.add(this.data.restarts, 1)
      this.expire()
      this.changed()
    }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
  }

  clear(): void {
    this.data = emptyAutoAllocationDiagnostics()
    this.changed()
  }

  record(explanation: AutoSelectionExplanation): void {
    if (!this.enabled) return
    const now = this.wall()
    this.expire(now)
    const day = Math.floor(now / dayMs) * dayMs
    const assessment = explanation.assessment
    const outcome = assessment.diagnostic ?? (assessment.source === 'local'
      ? assessment.demand === 'unknown' ? 'local-unknown' : 'local-known'
      : assessment.demand === 'unknown' ? 'semantic-unknown' : 'semantic-known')
    this.data.observationStart = this.data.observationStart === null
      ? day : Math.min(this.data.observationStart, day)
    this.data.observationEnd = this.data.observationEnd === null
      ? day : Math.max(this.data.observationEnd, day)
    if (explanation.method === 'no-fit') {
      const row = this.data.noFitRows.find(item => item.day === day && item.version === this.version
        && item.policyVersion === AUTO_ALLOCATION_POLICY && item.targetCategory === explanation.targetCategory
        && item.category === explanation.selectedCategory && item.demand === explanation.assessment.demand
        && item.assessmentSource === explanation.assessment.source && item.assessmentOutcome === outcome)
      if (row) row.decisions = this.add(row.decisions, 1)
      else if (this.data.rows.length + this.data.noFitRows.length < AUTO_ALLOCATION_DIAGNOSTIC_MAX_ROWS) {
        this.data.noFitRows.push({ day, version: this.version, policyVersion: AUTO_ALLOCATION_POLICY,
          targetCategory: explanation.targetCategory, category: explanation.selectedCategory,
          demand: explanation.assessment.demand, assessmentSource: explanation.assessment.source,
          assessmentOutcome: outcome, decisions: 1 })
      } else {
        this.data.rowsTruncated = true
        this.data.dropped = this.add(this.data.dropped, 1)
      }
      this.data.status = 'observed'
      this.changed()
      return
    }
    if (explanation.method !== 'weighted-distribution' && explanation.method !== 'only-candidate') return
    const parsed = AutoAllocationSchema.safeParse(explanation.allocation)
    if (!parsed.success || parsed.data.policyVersion !== AUTO_ALLOCATION_POLICY) {
      this.data.dropped = this.add(this.data.dropped, 1)
      this.changed()
      return
    }
    const allocation = parsed.data
    for (const candidate of allocation.candidates) {
      const row = this.data.rows.find(item => item.day === day && item.version === this.version
        && item.policyVersion === allocation.policyVersion && item.modelId === candidate.modelId
        && item.targetCategory === explanation.targetCategory && item.category === explanation.selectedCategory
        && item.demand === explanation.assessment.demand && item.assessmentSource === explanation.assessment.source
        && item.assessmentOutcome === outcome
        && item.method === explanation.method && item.fallback === explanation.fallback
        && item.highCost === candidate.highCost && item.previous === candidate.previous && item.weight === candidate.weight)
      if (row) {
        row.opportunities = this.add(row.opportunities, 1)
        row.expectedSelections = Math.min(Number.MAX_SAFE_INTEGER, row.expectedSelections + candidate.expectedShare)
        if (allocation.selectedModelId === candidate.modelId) row.selections = this.add(row.selections, 1)
      } else if (this.data.rows.length + this.data.noFitRows.length < AUTO_ALLOCATION_DIAGNOSTIC_MAX_ROWS) {
        this.data.rows.push({
          day, version: this.version, policyVersion: allocation.policyVersion,
          modelId: candidate.modelId, targetCategory: explanation.targetCategory,
          category: explanation.selectedCategory, demand: explanation.assessment.demand,
          assessmentSource: explanation.assessment.source, method: explanation.method, fallback: explanation.fallback,
          assessmentOutcome: outcome,
          highCost: candidate.highCost, previous: candidate.previous, weight: candidate.weight,
          opportunities: 1, expectedSelections: candidate.expectedShare,
          selections: allocation.selectedModelId === candidate.modelId ? 1 : 0,
        })
      } else {
        this.data.rowsTruncated = true
        this.data.dropped = this.add(this.data.dropped, 1)
      }
    }
    this.data.status = 'observed'
    this.changed()
  }

  snapshot(): AutoAllocationDiagnostics {
    this.expire()
    return AutoAllocationDiagnosticsSchema.parse({
      ...this.data, rows: this.data.rows.map(row => ({ ...row })),
      noFitRows: this.data.noFitRows.map(row => ({ ...row })),
    })
  }

  private expire(now = this.wall()): void {
    const oldest = Math.floor((now - AUTO_ALLOCATION_DIAGNOSTIC_RETENTION_MS) / dayMs) * dayMs
    const rows = this.data.rows.filter(row => row.day > oldest)
    const noFitRows = this.data.noFitRows.filter(row => row.day > oldest)
    const removed = this.data.rows.length + this.data.noFitRows.length - rows.length - noFitRows.length
    if (removed > 0) {
      this.data.rows = rows
      this.data.noFitRows = noFitRows
      this.data.expired = this.add(this.data.expired, removed)
      const retainedDays = [...rows, ...noFitRows].map(row => row.day)
      this.data.observationStart = retainedDays.length ? Math.min(...retainedDays) : null
      this.data.observationEnd = retainedDays.length ? Math.max(...retainedDays) : null
      this.changed()
    }
  }

  private add(value: number, amount: number): number {
    if (value > Number.MAX_SAFE_INTEGER - amount) {
      this.data.saturated = Math.min(Number.MAX_SAFE_INTEGER, this.data.saturated + 1)
      return Number.MAX_SAFE_INTEGER
    }
    return value + amount
  }
}
