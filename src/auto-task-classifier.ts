import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { AccountModelDescriptor } from './account-model-catalog.ts'
import { GITHUB_COPILOT_PREVIEW_PROVIDER_ID } from './copilot-identity.ts'
import { TASK_ASSESSMENT_INSTRUCTION } from './auto-task-assessment.ts'
import type { AssessmentInput } from './auto-task-assessment.ts'
import { calculateRequestBudget } from './request-budget.ts'

export function taskClassifierModel(models: readonly AccountModelDescriptor[]): AccountModelDescriptor | undefined {
  return models.filter(model => model.category === 'lightweight' && model.input.includes('text'))
    .toSorted((left, right) => left.id.localeCompare(right.id, 'en'))
    .find(model => {
      const budget = calculateRequestBudget(model, 512)
      return budget.ok && budget.budget.hardInputLimit >= 12_000
    })
}

/** One auxiliary concrete-model call; no Auto recursion, tools, history writes or retry loop. */
export async function classifyTaskWithAdapter(
  model: AccountModelDescriptor, input: AssessmentInput, signal: AbortSignal,
  stream: (request: GenerateOptions) => AsyncIterable<StreamChunk>,
): Promise<string> {
  let output = ''
  let finished = false
  for await (const chunk of stream({
    provider: GITHUB_COPILOT_PREVIEW_PROVIDER_ID, model: model.id, signal,
    system: TASK_ASSESSMENT_INSTRUCTION,
    messages: [createUserMessage({ source: { kind: 'user' }, content: [{
      type: 'text', text: JSON.stringify({ omittedContext: input.omitted, conversationData: input.text }),
    }] })],
    maxTokens: 512,
  })) {
    if (signal.aborted) throw signal.reason
    if (chunk.type === 'text-delta') {
      output += chunk.text
      if (output.length > 2048) throw new Error('INVALID_RESULT')
    }
    if (chunk.type === 'finish') {
      if (chunk.reason.kind !== 'stop') throw new Error('CLASSIFIER_UNSUCCESSFUL')
      finished = true
    }
  }
  if (signal.aborted) throw signal.reason
  if (!finished) throw new Error('CLASSIFIER_INCOMPLETE')
  return output
}
