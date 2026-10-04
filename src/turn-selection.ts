import type { AutoModelPreference } from './copilot-identity.ts'
import { z } from 'zod'
import { TaskAssessmentSchema } from './auto-task-assessment.ts'
import type { AutoSelectionExplanation } from './auto-model-routing.ts'
import { SemanticAssessmentEvidenceSchema } from './auto-assessment-evidence.ts'

const ExplanationSchema = z.object({
  assessment: TaskAssessmentSchema.extend({
    source: z.enum(['local', 'semantic']),
    diagnostic: z.enum(['disabled', 'unavailable', 'invalid-result', 'timeout', 'failed', 'context-omitted']).optional(),
    semantic: SemanticAssessmentEvidenceSchema.optional(),
  }).strict(),
  targetCategory: z.enum(['powerful', 'versatile', 'lightweight']),
  selectedCategory: z.enum(['powerful', 'versatile', 'lightweight', 'unknown']),
  categoryCandidateCount: z.number().int().min(0).max(512),
  method: z.enum(['continuity', 'equal-distribution', 'only-candidate', 'no-fit']),
  fallback: z.boolean(),
}).strict()

export const TurnSelectionSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('unknown') }).strict(),
  z.object({ mode: z.literal('manual') }).strict(),
  z.object({
    mode: z.literal('auto'), preference: z.enum(['efficiency', 'balance', 'intelligence']),
    reason: z.enum(['short-text-turn', 'standard-turn', 'large-structured-turn', 'image-capability']),
    candidateCount: z.number().int().positive(),
    fittingCandidateCount: z.number().int().nonnegative().optional(),
    explanation: ExplanationSchema.optional(),
  }).strict(),
])

export type TurnSelection = { readonly mode: 'unknown' } | { readonly mode: 'manual' } | {
  readonly mode: 'auto'
  readonly preference: AutoModelPreference
  readonly reason: 'short-text-turn' | 'standard-turn' | 'large-structured-turn' | 'image-capability'
  readonly candidateCount: number
  readonly fittingCandidateCount?: number
  readonly explanation?: AutoSelectionExplanation
}

/** Ephemeral decision evidence only; never session content, model usage or credentials. */
export class TurnSelectionStore {
  private readonly agents = new Map<object, Map<number, TurnSelection>>()
  record(agent: object, turn: number, selection: TurnSelection): void {
    if (!Number.isSafeInteger(turn) || turn < 0) throw new Error('COPILOT_TURN_SELECTION_INVALID_TURN')
    let turns = this.agents.get(agent)
    if (!turns) {
      turns = new Map()
      this.agents.set(agent, turns)
      if (this.agents.size > 64) this.agents.delete(this.agents.keys().next().value!)
    }
    // Retries/steps cannot rewrite the decision shown for an earlier dispatch.
    if (!turns.has(turn)) {
      const explanation = selection.mode === 'auto' ? selection.explanation : undefined
      turns.set(turn, Object.freeze({ ...selection, ...explanation === undefined ? {} : {
        explanation: Object.freeze({ ...explanation, assessment: Object.freeze({
          ...explanation.assessment, signals: Object.freeze([...explanation.assessment.signals]),
          ...explanation.assessment.semantic === undefined ? {} : {
            semantic: Object.freeze({ ...explanation.assessment.semantic }),
          },
        }) }),
      } }))
    }
    if (turns.size > 128) turns.delete(turns.keys().next().value!)
  }
  get(agent: object, turn: number): TurnSelection {
    if (!Number.isSafeInteger(turn) || turn < 0) throw new Error('COPILOT_TURN_SELECTION_INVALID_TURN')
    return this.agents.get(agent)?.get(turn) ?? { mode: 'unknown' }
  }
  remove(agent: object): void { this.agents.delete(agent) }
  clear(): void { this.agents.clear() }
}
