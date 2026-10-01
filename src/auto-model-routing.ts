import type { AccountModelDescriptor } from './account-model-catalog.ts'
import { autoModelPreference } from './copilot-identity.ts'
import type { AutoModelPreference } from './copilot-identity.ts'

export type AutoModelClass = 'fast' | 'balanced' | 'strong'

export interface AutoModelFeatures {
  readonly taskClass: AutoModelClass
  readonly textLength: number
  readonly codeFenceCount: number
  readonly requiresImage: boolean
}

export interface AutoModelDecision {
  readonly model: AccountModelDescriptor
  readonly preference: AutoModelPreference
  readonly taskClass: AutoModelClass
  readonly reason: 'short-text-turn' | 'standard-turn' | 'large-structured-turn' | 'image-capability'
  readonly candidateCount: number
}

export class AutoModelRoutingError extends Error {
  constructor(readonly code: 'COPILOT_AUTO_NO_ELIGIBLE_MODEL') {
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
  let requiresImage = false
  for (const block of latestUserContent(messages)) {
    if (!record(block)) continue
    if (block.type === 'text' && typeof block.text === 'string') text += `${block.text}\n`
    if (block.type === 'image') requiresImage = true
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

/**
 * MVP policy: filter only by account-verified hard capabilities, then choose a
 * deterministic capacity tier. Capacity is not a quality, latency or price claim.
 */
export function selectAutoModel(
  models: readonly AccountModelDescriptor[],
  messages: readonly unknown[],
  preference: AutoModelPreference = 'balance',
): AutoModelDecision {
  const features = classifyAutoModelTurn(messages)
  const eligible = models.filter(model => autoModelPreference(model.id) === undefined
    && model.input.includes('text') && (!features.requiresImage || model.input.includes('image')))
    .toSorted(compareCapacity)
  if (eligible.length === 0) throw new AutoModelRoutingError('COPILOT_AUTO_NO_ELIGIBLE_MODEL')
  const middle = Math.floor((eligible.length - 1) / 2)
  const index = features.taskClass === 'fast'
    ? preference === 'intelligence' ? middle : 0
    : features.taskClass === 'strong'
      ? preference === 'efficiency' ? Math.min(eligible.length - 1, Math.max(1, middle)) : eligible.length - 1
      : preference === 'efficiency' ? 0 : preference === 'intelligence' ? eligible.length - 1 : middle
  return Object.freeze({
    model: eligible[index]!,
    preference,
    taskClass: features.taskClass,
    reason: reasonFor(features),
    candidateCount: eligible.length,
  })
}

export function autoModelInputModalities(models: readonly AccountModelDescriptor[]): readonly ('text' | 'image')[] {
  const eligible = models.filter(model => autoModelPreference(model.id) === undefined && model.input.includes('text'))
  return eligible.some(model => model.input.includes('image')) ? ['text', 'image'] : ['text']
}
