import { z } from 'zod'

const milliseconds = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
export const SemanticAssessmentEvidenceSchema = z.object({
  modelId: z.string().min(1).max(200).regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u).optional(),
  budgetMs: milliseconds.refine(value => value > 0),
  elapsedMs: milliseconds,
  stage: z.enum(['preparing', 'model-selected', 'adapter-started', 'text-received', 'finished']),
  adapterStartedMs: milliseconds.optional(),
  firstTextMs: milliseconds.optional(),
  nativeFinish: z.enum(['stop', 'non-stop']).optional(),
  outputCharacters: z.number().int().min(0).max(2049),
  validation: z.enum(['not-validated', 'valid', 'invalid', 'context-omitted']),
}).strict().superRefine((value, ctx) => {
  if (value.adapterStartedMs !== undefined && value.adapterStartedMs > value.elapsedMs
    || value.firstTextMs !== undefined && (value.adapterStartedMs === undefined
      || value.firstTextMs < value.adapterStartedMs || value.firstTextMs > value.elapsedMs)) {
    ctx.addIssue({ code: 'custom', message: 'Inconsistent assessment timing' })
  }
  if (value.stage === 'model-selected' && value.modelId === undefined
    || ['adapter-started', 'text-received', 'finished'].includes(value.stage) && value.adapterStartedMs === undefined
    || value.stage === 'text-received' && value.firstTextMs === undefined
    || value.stage === 'finished' && value.nativeFinish === undefined
    || value.nativeFinish !== undefined && value.stage !== 'finished'
    || value.outputCharacters > 0 && value.firstTextMs === undefined
    || value.firstTextMs !== undefined && value.outputCharacters === 0) {
    ctx.addIssue({ code: 'custom', message: 'Inconsistent assessment phase' })
  }
})
export type SemanticAssessmentEvidence = Readonly<z.infer<typeof SemanticAssessmentEvidenceSchema>>
export type TaskClassifierObservation =
  | { readonly stage: 'model-selected'; readonly modelId: string }
  | { readonly stage: 'adapter-started' }
  | { readonly stage: 'text'; readonly characters: number }
  | { readonly stage: 'finished'; readonly stopped: boolean }
export type TaskClassifierObserver = (observation: TaskClassifierObservation) => void

/** Request-local milestones, not wire/upload timings, model health or token accounting. */
export function assessmentEvidence(budgetMs: number): {
  observe: TaskClassifierObserver
  finish(validation: SemanticAssessmentEvidence['validation']): SemanticAssessmentEvidence
} {
  const started = performance.now()
  let closed = false
  let evidence: Omit<SemanticAssessmentEvidence, 'elapsedMs' | 'validation'> = {
    budgetMs, stage: 'preparing', outputCharacters: 0,
  }
  const elapsed = () => Math.max(0, Math.round(performance.now() - started))
  return {
    observe(observation) {
      if (closed) return
      if (observation.stage === 'model-selected') {
        evidence = { ...evidence, modelId: observation.modelId, stage: 'model-selected' }
      } else if (observation.stage === 'adapter-started') {
        evidence = { ...evidence, adapterStartedMs: elapsed(), stage: 'adapter-started' }
      } else if (observation.stage === 'text' && observation.characters > 0) {
        evidence = { ...evidence, firstTextMs: evidence.firstTextMs ?? elapsed(),
          outputCharacters: Math.min(2049, observation.characters), stage: 'text-received' }
      } else if (observation.stage === 'finished') {
        evidence = { ...evidence, nativeFinish: observation.stopped ? 'stop' : 'non-stop', stage: 'finished' }
      }
    },
    finish(validation) {
      closed = true
      return Object.freeze(SemanticAssessmentEvidenceSchema.parse({ ...evidence, elapsedMs: elapsed(), validation }))
    },
  }
}
