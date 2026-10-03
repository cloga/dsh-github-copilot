import type { AccountModelCategory, AccountModelDescriptor } from './account-model-catalog.ts'
import { assessTaskLocally } from './auto-task-assessment.ts'
import type { TaskAssessment } from './auto-task-assessment.ts'
import { autoModelPreference } from './copilot-identity.ts'
import type { AutoModelPreference } from './copilot-identity.ts'
import { calculateRequestBudget, DEFAULT_REQUEST_BUDGET_POLICY } from './request-budget.ts'
import type { RequestBudgetPolicy } from './request-budget.ts'

export type AutoModelClass = 'fast' | 'balanced' | 'strong'

export interface AutoModelFeatures {
  readonly taskClass: AutoModelClass
  readonly textLength: number
  readonly codeFenceCount: number
  readonly requiresImage: boolean
}

export type AutoModelInputFitDiagnostic =
  | 'fitting-candidate-selected'
  | 'compaction-eligible'
  | 'compaction-unavailable'
  | 'attempted-but-still-oversized'
  | 'fixed-content-cannot-fit'

export interface AutoModelDecision {
  readonly model: AccountModelDescriptor
  readonly preference: AutoModelPreference
  readonly taskClass: AutoModelClass
  readonly reason: 'short-text-turn' | 'standard-turn' | 'large-structured-turn' | 'image-capability'
  readonly candidateCount: number
  readonly fittingCandidateCount: number
  readonly estimatedInputTokens: number
  readonly selectedInputBudget: number
  readonly inputFitDiagnostic: AutoModelInputFitDiagnostic
  readonly explanation: AutoSelectionExplanation
}

export interface AutoSelectionExplanation {
  readonly assessment: TaskAssessment
  readonly targetCategory: AccountModelCategory
  readonly selectedCategory: AccountModelCategory | 'unknown'
  readonly categoryCandidateCount: number
  readonly method: 'continuity' | 'equal-distribution' | 'only-candidate' | 'no-fit'
  readonly fallback: boolean
}

export interface AutoModelRoutingContext {
  readonly estimateMessage?: (message: unknown) => number
  readonly inputTokenFloor?: number
  readonly sessionId?: string
  readonly turn?: number
  readonly requestedMaxTokens?: number
  readonly requestBudgetPolicy?: Readonly<RequestBudgetPolicy>
  readonly seed?: string | number
  readonly compactionAvailable?: boolean
  readonly hasCompactionSummary?: boolean
  readonly assessment?: TaskAssessment
  readonly previousModelId?: string
}

export class AutoModelRoutingError extends Error {
  constructor(readonly code: 'COPILOT_AUTO_NO_ELIGIBLE_MODEL'
    | 'COPILOT_AUTO_TOKEN_METER_UNAVAILABLE' | 'COPILOT_AUTO_TOKEN_ESTIMATE_INVALID') {
    super(code)
    this.name = 'AutoModelRoutingError'
  }
}


function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function userMessage(value: unknown): value is Record<string, unknown> {
  if (!record(value)) return false
  if (record(value.source) && value.source.kind === 'model-selection') return false
  if (value.role === 'user') return true
  return record(value.source) && value.source.kind === 'user'
}

function latestUserContent(messages: readonly unknown[]): readonly unknown[] {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (userMessage(message) && Array.isArray(message.content)) return message.content
  }
  return []
}

export function classifyAutoModelTurn(messages: readonly unknown[]): AutoModelFeatures {
  let text = ''
  // Capability requirements cover the entered history; text complexity remains
  // a property of the latest user turn. Do not inspect tool arguments as content.
  const requiresImage = messages.some(message => record(message) && Array.isArray(message.content)
    && message.content.some((block: unknown) => record(block) && block.type === 'image' && block.offloaded !== true))
  for (const block of latestUserContent(messages)) {
    if (!record(block)) continue
    if (block.type === 'text' && typeof block.text === 'string') text += `${block.text}\n`
  }
  const codeFenceCount = text.match(/```/gu)?.length ?? 0
  const textLength = text.trim().length
  const taskClass: AutoModelClass = requiresImage ? 'balanced'
    : textLength <= 600 && codeFenceCount <= 2 ? 'fast'
      : textLength > 4_000 || codeFenceCount >= 4 ? 'strong' : 'balanced'
  return Object.freeze({ taskClass, textLength, codeFenceCount, requiresImage })
}

function reasonFor(features: AutoModelFeatures): AutoModelDecision['reason'] {
  if (features.requiresImage) return 'image-capability'
  if (features.taskClass === 'fast') return 'short-text-turn'
  if (features.taskClass === 'strong') return 'large-structured-turn'
  return 'standard-turn'
}

function validTokenEstimate(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new AutoModelRoutingError('COPILOT_AUTO_TOKEN_ESTIMATE_INVALID')
  }
  return value
}

export function estimateTurnInputTokens(
  messages: readonly unknown[],
  estimateMessage?: (message: unknown) => number,
): number {
  if (estimateMessage === undefined) throw new AutoModelRoutingError('COPILOT_AUTO_TOKEN_METER_UNAVAILABLE')
  return messages.reduce<number>((sum, message) =>
    validTokenEstimate(sum + validTokenEstimate(estimateMessage(message))), 0)
}

function latestUserTurnTokens(messages: readonly unknown[], estimateMessage: (message: unknown) => number): number {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (userMessage(message)) return validTokenEstimate(estimateMessage(message))
  }
  return 0
}

function candidateInputLimit(
  model: AccountModelDescriptor,
  requestedMaxTokens?: number,
  policy: Readonly<RequestBudgetPolicy> = DEFAULT_REQUEST_BUDGET_POLICY,
): number {
  const result = calculateRequestBudget(model, requestedMaxTokens, policy)
  return result.ok ? result.budget.hardInputLimit : 0
}

function fnv1a(str: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

function resolveSeed(messages: readonly unknown[], context?: AutoModelRoutingContext): number {
  if (typeof context?.seed === 'number' && Number.isSafeInteger(context.seed)) {
    return Math.abs(context.seed)
  }
  if (typeof context?.seed === 'string' && context.seed.length > 0) {
    return fnv1a(context.seed)
  }
  if (context?.sessionId !== undefined) {
    return fnv1a(`${context.sessionId}:${context.turn ?? 1}`)
  }
  let text = ''
  for (const block of latestUserContent(messages)) {
    if (record(block) && typeof block.text === 'string') text += block.text
  }
  return fnv1a(text || 'default-auto-seed')
}

function targetCategory(assessment: TaskAssessment, preference: AutoModelPreference): AccountModelCategory {
  if (assessment.demand === 'simple') return 'lightweight'
  if (assessment.demand === 'complex' || preference === 'intelligence') return 'powerful'
  if (assessment.demand === 'routine' && preference === 'efficiency') return 'lightweight'
  return 'versatile'
}

/**
 * Filter input headroom before task-aware supplier categories.
 * Preserve suitable continuity; distribute only equally classified candidates.
 * Preserves Core compaction ownership if no candidate currently fits.
 */
export function selectAutoModel(
  models: readonly AccountModelDescriptor[],
  messages: readonly unknown[],
  preference: AutoModelPreference = 'balance',
  context?: AutoModelRoutingContext,
): AutoModelDecision {
  const features = classifyAutoModelTurn(messages)
  const eligible = models.filter(model => autoModelPreference(model.id) === undefined
    && model.input.includes('text') && (!features.requiresImage || model.input.includes('image')))
    .toSorted((left, right) => left.id.localeCompare(right.id, 'en'))
  if (eligible.length === 0) throw new AutoModelRoutingError('COPILOT_AUTO_NO_ELIGIBLE_MODEL')

  const estimateMessage = context?.estimateMessage
  if (estimateMessage === undefined) throw new AutoModelRoutingError('COPILOT_AUTO_TOKEN_METER_UNAVAILABLE')
  const estimatedInputTokens = Math.max(
    estimateTurnInputTokens(messages, estimateMessage), validTokenEstimate(context?.inputTokenFloor ?? 0),
  )
  const requestedMaxTokens = context?.requestedMaxTokens
  const policy = context?.requestBudgetPolicy ?? DEFAULT_REQUEST_BUDGET_POLICY

  const fitting = eligible.filter(model => {
    const limit = candidateInputLimit(model, requestedMaxTokens, policy)
    return limit > 0 && estimatedInputTokens <= limit
  })

  const seed = resolveSeed(messages, context)
  const assessment = context?.assessment ?? assessTaskLocally(messages)
  const target = targetCategory(assessment, preference)
  const order: readonly (AccountModelCategory | 'unknown')[] = target === 'powerful'
    ? ['powerful', 'versatile', 'lightweight', 'unknown']
    : target === 'lightweight' ? ['lightweight', 'versatile', 'powerful', 'unknown']
      : ['versatile', 'powerful', 'lightweight', 'unknown']

  let selectedModel: AccountModelDescriptor
  let inputFitDiagnostic: AutoModelInputFitDiagnostic
  let selectedInputBudget: number
  let explanation: AutoSelectionExplanation

  if (fitting.length > 0) {
    const selectedCategory = order.find(category => fitting.some(model => (model.category ?? 'unknown') === category))!
    const pool = fitting.filter(model => (model.category ?? 'unknown') === selectedCategory)
    const previous = pool.find(model => model.id === context?.previousModelId)
    selectedModel = previous ?? pool[seed % pool.length]!
    explanation = {
      assessment, targetCategory: target, selectedCategory, categoryCandidateCount: pool.length,
      method: previous ? 'continuity' : pool.length === 1 ? 'only-candidate' : 'equal-distribution',
      fallback: selectedCategory !== target,
    }
    selectedInputBudget = candidateInputLimit(selectedModel, requestedMaxTokens, policy)
    inputFitDiagnostic = 'fitting-candidate-selected'
  } else {
    let maxModel = eligible[0]!
    let maxLimit = candidateInputLimit(maxModel, requestedMaxTokens, policy)
    for (let i = 1; i < eligible.length; i++) {
      const limit = candidateInputLimit(eligible[i]!, requestedMaxTokens, policy)
      if (limit > maxLimit) {
        maxLimit = limit
        maxModel = eligible[i]!
      }
    }
    selectedModel = maxModel
    selectedInputBudget = maxLimit
    explanation = { assessment, targetCategory: target, selectedCategory: selectedModel.category ?? 'unknown',
      categoryCandidateCount: 0, method: 'no-fit', fallback: true }

    const latestUserTokens = latestUserTurnTokens(messages, estimateMessage)
    if (latestUserTokens > maxLimit) {
      inputFitDiagnostic = 'fixed-content-cannot-fit'
    } else if (context?.compactionAvailable === false) {
      inputFitDiagnostic = 'compaction-unavailable'
    } else if (context?.hasCompactionSummary === true) {
      inputFitDiagnostic = 'attempted-but-still-oversized'
    } else {
      inputFitDiagnostic = 'compaction-eligible'
    }
  }

  return Object.freeze({
    model: selectedModel,
    preference,
    taskClass: features.taskClass,
    reason: reasonFor(features),
    candidateCount: eligible.length,
    fittingCandidateCount: fitting.length,
    estimatedInputTokens,
    selectedInputBudget,
    inputFitDiagnostic,
    explanation: Object.freeze({ ...explanation, assessment: Object.freeze({
      ...explanation.assessment, signals: Object.freeze([...explanation.assessment.signals]),
      ...explanation.assessment.semantic === undefined ? {} : {
        semantic: Object.freeze({ ...explanation.assessment.semantic }),
      },
    }) }),
  })
}

export function autoModelInputModalities(models: readonly AccountModelDescriptor[]): readonly ('text' | 'image')[] {
  const eligible = models.filter(model => autoModelPreference(model.id) === undefined && model.input.includes('text'))
  return eligible.some(model => model.input.includes('image')) ? ['text', 'image'] : ['text']
}
