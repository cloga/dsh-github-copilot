import { createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { AccountModelDescriptor } from './account-model-catalog.ts'
import { GITHUB_COPILOT_PREVIEW_PROVIDER_ID } from './copilot-identity.ts'
import { TASK_ASSESSMENT_INSTRUCTION } from './auto-task-assessment.ts'
import type { AssessmentInput } from './auto-task-assessment.ts'
import { calculateRequestBudget } from './request-budget.ts'
import type { ClassifierRejection, TaskClassifierObserver } from './auto-assessment-evidence.ts'
import { normalizeHighCostModelIds } from './auto-allocation.ts'

export const TASK_CLASSIFIER_MAX_TOKENS = 128

export function classifierReasoningOffSupported(model: AccountModelDescriptor): boolean {
  const efforts = model.reasoning.advertisedEfforts
  return efforts.includes('off') || efforts.includes(model.api === 'anthropic-messages' ? 'disabled' : 'none')
}

export function taskClassifierModel(
  models: readonly AccountModelDescriptor[], highCostModelIds?: readonly string[], modelId = '',
  observe?: TaskClassifierObserver, excluded: ReadonlySet<string> = new Set(),
): AccountModelDescriptor | undefined {
  const highCost = new Set(normalizeHighCostModelIds(highCostModelIds))
  const rejected: Partial<Record<ClassifierRejection, number>> = {}
  const candidates = models.filter(model => {
    let reason: ClassifierRejection | undefined
    if (excluded.has(model.id)) reason = 'excluded'
    else if (modelId !== '' && model.id !== modelId) reason = 'configured-id'
    else if (modelId === '' && model.category !== 'lightweight') reason = 'category'
    else if (!model.input.includes('text')) reason = 'input'
    else if (!classifierReasoningOffSupported(model)) reason = 'reasoning-disable-unproven'
    else {
      const budget = calculateRequestBudget(model, TASK_CLASSIFIER_MAX_TOKENS)
      if (!budget.ok || budget.budget.hardInputLimit < 12_000) reason = 'budget'
    }
    if (reason === undefined) return true
    rejected[reason] = (rejected[reason] ?? 0) + 1
    return false
  })
  observe?.({ stage: 'candidate-scan', candidates: models.length, eligible: candidates.length, rejected })
  return candidates
    .toSorted((left, right) => Number(highCost.has(left.id)) - Number(highCost.has(right.id))
      || left.id.localeCompare(right.id, 'en'))[0]
}

/** One auxiliary concrete-model call; no Auto recursion, tools, history writes or retry loop. */
export async function classifyTaskWithAdapter(
  model: AccountModelDescriptor, input: AssessmentInput, signal: AbortSignal,
  stream: (request: GenerateOptions) => AsyncIterable<StreamChunk>,
  observe?: TaskClassifierObserver,
  reasoningOffSupported = false,
  checkpoint?: () => void,
): Promise<string> {
  checkpoint?.()
  if (signal.aborted) throw signal.reason
  if (!classifierReasoningOffSupported(model) || !reasoningOffSupported) {
    observe?.({ stage: 'preparation-failed', reason: 'native-off-unavailable' })
    throw new Error('COPILOT_AUTO_CLASSIFIER_UNAVAILABLE')
  }
  let output = ''
  let finished = false
  observe?.({ stage: 'adapter-started' })
  for await (const chunk of stream({
    provider: GITHUB_COPILOT_PREVIEW_PROVIDER_ID, model: model.id, signal,
    system: TASK_ASSESSMENT_INSTRUCTION,
    messages: [createUserMessage({ source: { kind: 'user' }, content: [{
      type: 'text', text: JSON.stringify({ omittedContext: input.omitted, conversationData: input.text }),
    }] })],
    maxTokens: TASK_CLASSIFIER_MAX_TOKENS,
    reasoningEffort: ReasoningEffortId('off'),
  })) {
    checkpoint?.()
    checkpoint?.()
    if (signal.aborted) throw signal.reason
    if (chunk.type === 'text-delta') {
      output += chunk.text
      observe?.({ stage: 'text', characters: output.length })
      if (output.length > 2048) throw new Error('INVALID_RESULT')
    }
    if (chunk.type === 'finish') {
      observe?.({ stage: 'finished', stopped: chunk.reason.kind === 'stop' })
      if (chunk.reason.kind !== 'stop') throw new Error('CLASSIFIER_UNSUCCESSFUL')
      finished = true
    }
  }
  if (signal.aborted) throw signal.reason
  if (!finished) throw new Error('CLASSIFIER_INCOMPLETE')
  return output
}
