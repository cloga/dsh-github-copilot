import { describe, expect, it } from 'vitest'
import type { Api, Model } from '@earendil-works/pi-ai'
import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all'
import { projectModelFacts } from '../src/model-protocol.ts'

function installedGpt6(overrides: Partial<Model<Api>> = {}) {
  const model: Model<Api> = {
    ...getBuiltinModels('github-copilot')[0]!,
    id: 'gpt-6-astra', api: 'openai-responses', reasoning: true,
    input: ['text', 'image'], contextWindow: 1_050_000, maxTokens: 128_000,
    thinkingLevelMap: { off: null, minimal: null, low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' },
    ...overrides,
  }
  return new Map([[model.id, projectModelFacts(model)]])
}
import {
  temporaryGitHubCopilotModel,
  temporaryGitHubCopilotModelProfile,
} from '../src/temporary-models.ts'

describe('temporary GitHub Copilot model overlays', () => {
  it('supplies verified GPT-6 Astra Responses metadata while pi-ai lacks it', () => {
    const model = temporaryGitHubCopilotModel('gpt-6-astra', new Map())

    expect(model).toMatchObject({
      id: 'gpt-6-astra',
      api: 'openai-responses',
      contextWindow: 1_050_000,
      maxTokens: 128_000,
      input: ['text', 'image'],
      headers: {
        'Copilot-Integration-Id': 'vscode-chat',
      },
    })
    expect(temporaryGitHubCopilotModelProfile(model!)).toEqual({
      id: 'gpt-6-astra',
      name: 'GPT-6 Astra',
      api: 'openai-responses',
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
    })
  })

  it('retires only after the native entry preserves the protocol and reasoning capabilities', () => {
    expect(temporaryGitHubCopilotModel('gpt-6-astra', installedGpt6())).toBeUndefined()
  })

  it.each([
    { api: 'openai-completions' as const },
    { reasoning: false },
    { thinkingLevelMap: { max: null } },
    { input: ['text'] as ('text' | 'image')[] },
    { contextWindow: 0 },
    { maxTokens: Number.NaN },
  ])('retains the narrow correction for incomplete native metadata: %j', (overrides) => {
    expect(temporaryGitHubCopilotModel('gpt-6-astra', installedGpt6(overrides)))
      .toMatchObject({ id: 'gpt-6-astra', api: 'openai-responses' })
  })

  it('does not retire from a newer companion catalog without mounted Core provenance', () => {
    expect(temporaryGitHubCopilotModel('gpt-6-astra', installedGpt6(), false))
      .toMatchObject({ id: 'gpt-6-astra', api: 'openai-responses' })
  })

  it('does not synthesize arbitrary unknown account models', () => {
    expect(temporaryGitHubCopilotModel('future-unknown-model', new Map())).toBeUndefined()
  })
})
