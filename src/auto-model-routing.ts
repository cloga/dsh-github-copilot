import type { AccountModelDescriptor } from './account-model-catalog.ts'
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
}

export class AutoModelRoutingError extends Error {
  constructor(readonly code: 'COPILOT_AUTO_NO_ELIGIBLE_MODEL'
    | 'COPILOT_AUTO_TOKEN_METER_UNAVAILABLE' | 'COPILOT_AUTO_TOKEN_ESTIMATE_INVALID') {
    super(code)
    this.name = 'AutoModelRoutingError'
  }
}

const effortOrder = new Map([
  ['off', 0], ['minimal', 1], ['low', 2], ['medium', 3], ['high', 4], ['xhigh', 5], ['max', 6],
])

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function userMessage(value: unknown): value is Record<string, unknown> {
  if (!record(value)) return false
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

function maximumEffort(model: AccountModelDescriptor): number {
  let rank = -1
  for (const effort of model.reasoning.advertisedEfforts) rank = Math.max(rank, effortOrder.get(effort) ?? -1)
  return rank
}

function compareCapacity(left: AccountModelDescriptor, right: AccountModelDescriptor): number {
  return maximumEffort(left) - maximumEffort(right)
    || left.contextWindow - right.contextWindow
    || left.maxTokens - right.maxTokens
    || left.id.localeCompare(right.id, 'en')
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

function pickBandIndex(
  n: number,
  taskClass: AutoModelClass,
  preference: AutoModelPreference,
  seed: number,
): number {
  if (n <= 1) return 0
  const middle = Math.floor((n - 1) / 2)
  if (n === 2) {
    if (taskClass === 'fast') return preference === 'intelligence' ? 1 : 0
    if (taskClass === 'strong') return 1
    return preference === 'efficiency' ? 0 : 1
  }

  let start: number
  let end: number
  let bias: 'low' | 'center' | 'high'

  if (taskClass === 'fast') {
    if (preference === 'intelligence') {
      start = Math.max(0, middle - 1)
      end = Math.min(n - 1, Math.max(1, middle))
      bias = 'high'
    } else {
      start = 0
      end = 0
      bias = 'low'
    }
  } else if (taskClass === 'strong') {
    if (preference === 'efficiency') {
      start = Math.min(n - 1, Math.max(1, middle))
      end = start
      bias = 'center'
    } else if (preference === 'balance') {
      start = Math.min(n - 1, Math.max(1, middle))
      end = n - 1
      bias = 'high'
    } else {
      const upperCount = Math.max(2, Math.min(3, Math.ceil(n / 2)))
      start = Math.max(1, n - upperCount)
      end = n - 1
      bias = 'high'
    }
  } else {
    if (preference === 'efficiency') {
      const lowerCount = Math.max(1, Math.min(2, Math.floor(n / 3)))
      start = 0
      end = lowerCount - 1
      bias = 'low'
    } else if (preference === 'intelligence') {
      const upperCount = Math.max(2, Math.min(3, Math.ceil(n / 2)))
      start = Math.max(1, n - upperCount)
      end = n - 1
      bias = 'high'
    } else {
      const spread = n >= 5 ? 1 : 0
      start = Math.max(0, middle - spread)
      end = Math.min(n - 1, middle + spread)
      bias = 'center'
    }
  }

  const bandSize = end - start + 1
  if (bandSize <= 1) return start

  const weights: number[] = []
  for (let i = 0; i < bandSize; i++) {
    if (bias === 'high') {
      weights.push(i + 1)
    } else if (bias === 'low') {
      weights.push(bandSize - i)
    } else {
      const dist = Math.abs(i - Math.floor((bandSize - 1) / 2))
      weights.push(bandSize - dist)
    }
  }
  const totalWeight = weights.reduce((sum, w) => sum + w, 0)
  const offset = seed % totalWeight
  let accumulated = 0
  for (let i = 0; i < bandSize; i++) {
    accumulated += weights[i]!
    if (offset < accumulated) return start + i
  }
  return end
}

/**
 * Filter by hard capabilities and input headroom before soft preference.
 * Soft preferences distribute across capacity bands using in-memory deterministic seeds.
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
    .toSorted(compareCapacity)
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

  let selectedModel: AccountModelDescriptor
  let inputFitDiagnostic: AutoModelInputFitDiagnostic
  let selectedInputBudget: number

  if (fitting.length > 0) {
    const index = pickBandIndex(fitting.length, features.taskClass, preference, seed)
    selectedModel = fitting[index]!
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
  })
}

export function autoModelInputModalities(models: readonly AccountModelDescriptor[]): readonly ('text' | 'image')[] {
  const eligible = models.filter(model => autoModelPreference(model.id) === undefined && model.input.includes('text'))
  return eligible.some(model => model.input.includes('image')) ? ['text', 'image'] : ['text']
}
