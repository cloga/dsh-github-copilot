import type { Api } from '@earendil-works/pi-ai'

/**
 * Narrow compatibility metadata for account models that GitHub releases before
 * the published pi-ai Copilot catalog catches up. Entries must be removed as
 * soon as the installed catalog owns the same id.
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

/** Return a temporary model only while the installed pi-ai catalog lacks it. */
export function temporaryGitHubCopilotModel(
  modelId: string,
  installedModelIds: ReadonlySet<string>,
): TemporaryGitHubCopilotModel | undefined {
  if (installedModelIds.has(modelId)) return undefined
  return TEMPORARY_MODELS.get(modelId)
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
    JSON.stringify(value[field]) === JSON.stringify(expectedValue))
    ? model
    : undefined
}
