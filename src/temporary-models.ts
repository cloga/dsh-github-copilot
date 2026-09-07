import type { Api } from '@earendil-works/pi-ai'
import type { CopilotModelFacts } from './model-protocol.ts'

/**
 * Narrow compatibility metadata for account models that GitHub releases before
 * the published pi-ai Copilot catalog catches up. Correct native protocol and
 * capability metadata retire the correction; a matching ID alone does not.
 */
export interface TemporaryGitHubCopilotModel {
  readonly id: string
  readonly name: string
  readonly api: Api
  readonly baseUrl: string
  readonly contextWindow: number
  readonly maxTokens: number
  readonly input: readonly ('text' | 'image')[]
  readonly reasoningEfforts: Readonly<Record<string, string | null>>
  readonly headers: Readonly<Record<string, string>>
}

const COPILOT_HEADERS = {
  'User-Agent': 'GitHubCopilotChat/0.35.0',
  'Editor-Version': 'vscode/1.107.0',
  'Editor-Plugin-Version': 'copilot-chat/0.35.0',
  'Copilot-Integration-Id': 'vscode-chat',
} as const

const GPT_6_ASTRA: TemporaryGitHubCopilotModel = {
  id: 'gpt-6-astra',
  name: 'GPT-6 Astra',
  api: 'openai-responses',
  baseUrl: 'https://api.individual.githubcopilot.com',
  contextWindow: 1_050_000,
  maxTokens: 128_000,
  input: ['text', 'image'],
  reasoningEfforts: {
    off: null,
    low: 'low',
    medium: 'medium',
    high: 'high',
    xhigh: 'xhigh',
    max: 'max',
  },
  headers: COPILOT_HEADERS,
}

const TEMPORARY_MODELS = new Map<string, TemporaryGitHubCopilotModel>([
  [GPT_6_ASTRA.id, GPT_6_ASTRA],
])


/** Return a narrow correction until the native entry supplies the verified capabilities. */
export function temporaryGitHubCopilotModel(
  modelId: string,
  installedModels: ReadonlyMap<string, CopilotModelFacts>,
  nativeAuthoritative = true,
): TemporaryGitHubCopilotModel | undefined {
  const correction = TEMPORARY_MODELS.get(modelId)
  if (correction === undefined) return undefined
  const native = installedModels.get(modelId)
  if (!nativeAuthoritative || native === undefined || native.provider !== 'github-copilot'
    || native.api !== correction.api || !native.reasoning
    || !Number.isSafeInteger(native.contextWindow) || native.contextWindow <= 0
    || !Number.isSafeInteger(native.maxTokens) || native.maxTokens <= 0
    || correction.input.some(modality => !native.input.includes(modality))) return correction
  const expected = Object.keys(correction.reasoningEfforts).filter(level => level !== 'off')
  return expected.every(level => typeof native.reasoningEfforts[level] === 'string'
    && native.reasoningEfforts[level]!.length > 0) ? undefined : correction
}

/** Minimal llm-pi-ai settings entry for one temporary model. */
export function temporaryGitHubCopilotModelProfile(model: TemporaryGitHubCopilotModel): Record<string, unknown> {
  return {
    id: model.id,
    name: model.name,
    api: model.api,
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    input: [...model.input],
    reasoningEfforts: { ...model.reasoningEfforts },
  }
}

/** Recognize metadata written by this overlay without matching user-owned extras. */
export function temporaryGitHubCopilotModelFromProfile(
  value: Readonly<Record<string, unknown>>,
): TemporaryGitHubCopilotModel | undefined {
  const model = typeof value.id === 'string' ? TEMPORARY_MODELS.get(value.id) : undefined
  if (model === undefined) return undefined
  const expected = temporaryGitHubCopilotModelProfile(model)
  return Object.entries(expected).every(([field, expectedValue]) =>
    field === 'api' && value.api === undefined
      ? true
      : JSON.stringify(value[field]) === JSON.stringify(expectedValue))
    ? model
    : undefined
}
