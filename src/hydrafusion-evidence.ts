export type HydraFusionLifecycle = 'unavailable' | 'routing' | 'running' | 'stopping' | 'idle'
export type HydraFusionOutcome = 'unavailable' | 'failed' | 'cancelled' | 'completed' | 'completed-with-fallback'
export type HydraFusionPhaseKind = 'primary' | 'judge' | 'repair' | 'draft' | 'critic' | 'revision' | 'follow_up'
export type HydraFusionPhaseStatus = 'active' | 'succeeded' | 'failed' | 'cancelled'
export type HydraFusionActivity = 'model_output' | 'tool_started' | 'tool_completed'
export type HydraFusionPattern = 'single' | 'cascade' | 'critique'

export interface HydraFusionPhaseEvidence {
  readonly phaseId: string
  readonly phaseKind: HydraFusionPhaseKind
  readonly model: string
  readonly role: string
  readonly status: HydraFusionPhaseStatus
  readonly activity?: HydraFusionActivity
  readonly durationMs?: number
}

export interface HydraFusionUsageEvidence {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cachedTokens: number
  readonly cacheWriteTokens?: number
  readonly requestCount: number
  readonly phaseCount: number
  readonly totalNanoAiu: number
}

export interface HydraFusionEvidenceSnapshot {
  readonly lifecycle: HydraFusionLifecycle
  readonly outcome?: HydraFusionOutcome
  readonly pattern?: HydraFusionPattern
  readonly phases: readonly HydraFusionPhaseEvidence[]
  readonly phasesTruncated: boolean
  readonly usage?: HydraFusionUsageEvidence
  readonly stopRequested: boolean
}

type Event = { type?: unknown; data?: unknown; ephemeral?: unknown; agentId?: unknown }
type RecordValue = Record<string, unknown>

const phaseKinds = new Set<HydraFusionPhaseKind>(['primary', 'judge', 'repair', 'draft', 'critic', 'revision', 'follow_up'])
const activities = new Set<HydraFusionActivity>(['model_output', 'tool_started', 'tool_completed'])
const patterns = new Set<HydraFusionPattern>(['single', 'cascade', 'critique'])
const terminalStatuses = new Set<HydraFusionPhaseStatus>(['succeeded', 'failed', 'cancelled'])
const MAX_PHASES = 32

function record(value: unknown): RecordValue | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : undefined
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 512
}

function finiteCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function oneOf<T extends string>(value: unknown, values: ReadonlySet<T>): value is T {
  return typeof value === 'string' && values.has(value as T)
}

function usageEvidence(value: unknown): HydraFusionUsageEvidence | undefined {
  const usage = record(value)
  if (!usage
    || !finiteCount(usage.inputTokens)
    || !finiteCount(usage.outputTokens)
    || !finiteCount(usage.cachedTokens)
    || !finiteCount(usage.requestCount)
    || !finiteCount(usage.phaseCount)
    || !finiteCount(usage.totalNanoAiu)
    || (usage.cacheWriteTokens !== undefined && !finiteCount(usage.cacheWriteTokens))) return undefined

  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cachedTokens: usage.cachedTokens,
    ...(usage.cacheWriteTokens === undefined ? {} : { cacheWriteTokens: usage.cacheWriteTokens }),
    requestCount: usage.requestCount,
    phaseCount: usage.phaseCount,
    totalNanoAiu: usage.totalNanoAiu,
  }
}

/**
 * Projects only bounded, content-free evidence from the published SDK Fusion
 * event stream. The caller must supply the selected opaque identity; this class
 * does not discover or authorize it, own a DSH turn, or claim runtime availability.
 */
export class HydraFusionEvidenceCollector {
  private readonly selectionId: string
  private lifecycle: HydraFusionLifecycle = 'unavailable'
  private outcome: HydraFusionOutcome | undefined
  private pattern: HydraFusionPattern | undefined
  private usage: HydraFusionUsageEvidence | undefined
  private readonly phases = new Map<string, HydraFusionPhaseEvidence>()
  private phasesTruncated = false
  private attemptId: string | undefined
  private fusionId: string | undefined
  private completionObserved = false
  private stopRequested = false
  private failureObserved = false
  private fallbackObserved = false
  private degradedReason: string | null | undefined
  private awaitingBackgroundWork: boolean | undefined

  constructor(selectionId: string) {
    if (!nonEmpty(selectionId)) throw new TypeError('A Fusion selection identity is required')
    this.selectionId = selectionId
  }

  requestStop(): HydraFusionEvidenceSnapshot {
    if (this.lifecycle !== 'idle' && this.lifecycle !== 'unavailable' && this.outcome === undefined) {
      this.stopRequested = true
      this.lifecycle = 'stopping'
    }
    return this.snapshot()
  }

  observe(eventValue: unknown): HydraFusionEvidenceSnapshot {
    const event = record(eventValue) as Event | undefined
    const data = record(event?.data)
    if (!event || !data || typeof event.type !== 'string' || this.lifecycle === 'idle') return this.snapshot()

    switch (event.type) {
      case 'session.fusion_route_started':
        if (event.agentId === undefined && event.ephemeral === true
          && nonEmpty(data.attemptId) && data.syntheticModel === this.selectionId) {
          this.attemptId = data.attemptId
          this.lifecycle = this.stopRequested ? 'stopping' : 'routing'
        }
        break
      case 'session.fusion_route_failed':
        if (event.agentId === undefined && this.attemptId !== undefined && data.attemptId === this.attemptId
          && data.syntheticModel === this.selectionId && nonEmpty(data.fallbackModel)) {
          this.fallbackObserved = true
          this.lifecycle = this.stopRequested ? 'stopping' : 'running'
        }
        break
      case 'session.fusion_resolved':
        if (event.agentId === undefined && data.syntheticModel === this.selectionId
          && nonEmpty(data.fusionId) && oneOf(data.pattern, patterns)) {
          this.fusionId = data.fusionId
          this.pattern = data.pattern
          this.lifecycle = this.stopRequested ? 'stopping' : 'running'
        }
        break
      case 'assistant.fusion_phase_started':
        if (this.matchesFusion(data.fusionId) && nonEmpty(data.phaseId) && oneOf(data.phaseKind, phaseKinds)
          && nonEmpty(data.model) && nonEmpty(data.role)) {
          this.setPhase({ phaseId: data.phaseId, phaseKind: data.phaseKind, model: data.model, role: data.role, status: 'active' })
          this.lifecycle = this.stopRequested ? 'stopping' : 'running'
        }
        break
      case 'assistant.fusion_phase_activity':
        if (this.matchesFusion(data.fusionId) && nonEmpty(data.phaseId) && oneOf(data.activity, activities)) {
          const previous = this.phases.get(data.phaseId)
          if (previous) this.setPhase({ ...previous, activity: data.activity })
        }
        break
      case 'assistant.fusion_phase_completed':
      case 'assistant.fusion_phase_failed':
        if (this.matchesFusion(data.fusionId) && nonEmpty(data.phaseId) && oneOf(data.phaseKind, phaseKinds)
          && nonEmpty(data.model) && nonEmpty(data.role) && oneOf(data.status, terminalStatuses)) {
          const durationMs = finiteCount(data.durationMs) ? data.durationMs : undefined
          this.setPhase({
            phaseId: data.phaseId,
            phaseKind: data.phaseKind,
            model: data.model,
            role: data.role,
            status: data.status,
            ...(durationMs === undefined ? {} : { durationMs }),
          })
          if (event.type === 'assistant.fusion_phase_failed' && nonEmpty(data.degradedToPhaseId)) {
            this.fallbackObserved = true
          }
          this.lifecycle = this.stopRequested ? 'stopping' : 'running'
        }
        break
      case 'session.fusion_completed':
        if (event.agentId === undefined && this.matchesFusion(data.fusionId)
          && data.syntheticModel === this.selectionId
          && nonEmpty(data.commitId) && nonEmpty(data.finalSourceModel)
          && (data.degradedReason === null || nonEmpty(data.degradedReason))) {
          this.completionObserved = true
          this.degradedReason = data.degradedReason
          this.usage = usageEvidence(data)
          this.awaitingBackgroundWork = typeof data.awaitingBackgroundWork === 'boolean'
            ? data.awaitingBackgroundWork : undefined
          this.lifecycle = this.stopRequested ? 'stopping' : 'running'
        }
        break
      case 'session.error':
        if (event.agentId === undefined && (this.attemptId !== undefined || this.fusionId !== undefined)) {
          this.failureObserved = true
          this.lifecycle = 'stopping'
        }
        break
      case 'session.autopilot_stopped':
      case 'assistant.idle':
        if (event.agentId === undefined && (this.attemptId !== undefined || this.fusionId !== undefined)) this.lifecycle = 'stopping'
        break
      case 'session.idle':
        if (event.agentId === undefined && event.ephemeral === true
          && (this.attemptId !== undefined || this.fusionId !== undefined)) this.finish(data)
        break
    }

    return this.snapshot()
  }

  snapshot(): HydraFusionEvidenceSnapshot {
    return {
      lifecycle: this.lifecycle,
      ...(this.outcome === undefined ? {} : { outcome: this.outcome }),
      ...(this.pattern === undefined ? {} : { pattern: this.pattern }),
      phases: [...this.phases.values()],
      phasesTruncated: this.phasesTruncated,
      ...(this.usage === undefined ? {} : { usage: this.usage }),
      stopRequested: this.stopRequested,
    }
  }

  private matchesFusion(value: unknown): boolean {
    return this.fusionId !== undefined && value === this.fusionId
  }

  private setPhase(phase: HydraFusionPhaseEvidence): void {
    if (!this.phases.has(phase.phaseId) && this.phases.size >= MAX_PHASES) {
      this.phasesTruncated = true
      return
    }
    this.phases.set(phase.phaseId, phase)
  }

  private finish(data: RecordValue): void {
    // Root idle does not discharge reported or unknown background work.
    // Keep consuming evidence instead of freezing an unproven terminal state.
    if (this.completionObserved && this.awaitingBackgroundWork !== false) {
      this.lifecycle = 'stopping'
      return
    }
    this.lifecycle = 'idle'
    if (this.completionObserved && this.awaitingBackgroundWork === false) {
      this.outcome = this.fallbackObserved || this.degradedReason !== null ? 'completed-with-fallback' : 'completed'
    } else if (data.aborted === true) {
      this.outcome = 'cancelled'
    } else if (this.failureObserved) {
      this.outcome = 'failed'
    } else {
      this.outcome = 'unavailable'
    }
  }
}
