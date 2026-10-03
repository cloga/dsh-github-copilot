import { createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { AccountModelDescriptor } from './account-model-catalog.ts'
import { GITHUB_COPILOT_PREVIEW_PROVIDER_ID } from './copilot-identity.ts'
import { TASK_ASSESSMENT_INSTRUCTION } from './auto-task-assessment.ts'
import type { AssessmentInput } from './auto-task-assessment.ts'
import { calculateRequestBudget } from './request-budget.ts'
import type { TaskClassifierObserver } from './auto-assessment-evidence.ts'

export const TASK_CLASSIFIER_MAX_TOKENS = 128

export function taskClassifierModel(models: readonly AccountModelDescriptor[]): AccountModelDescriptor | undefined {
  return models.filter(model => model.category === 'lightweight' && model.input.includes('text'))
    .toSorted((left, right) => left.id.localeCompare(right.id, 'en'))
    .find(model => {
      const budget = calculateRequestBudget(model, TASK_CLASSIFIER_MAX_TOKENS)
      return budget.ok && budget.budget.hardInputLimit >= 12_000
    })
}

/** One auxiliary concrete-model call; no Auto recursion, tools, history writes or retry loop. */
export async function classifyTaskWithAdapter(
  model: AccountModelDescriptor, input: AssessmentInput, signal: AbortSignal,
  stream: (request: GenerateOptions) => AsyncIterable<StreamChunk>,
  observe?: TaskClassifierObserver,
  reasoningOffSupported = false,
): Promise<string> {
  if (signal.aborted) throw signal.reason
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
    ...reasoningOffSupported && model.reasoning.advertisedEfforts.includes('off')
      ? { reasoningEffort: ReasoningEffortId('off') } : {},
  })) {
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
