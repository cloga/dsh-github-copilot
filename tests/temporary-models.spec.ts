import { describe, expect, it } from 'vitest'
import {
  temporaryGitHubCopilotModel,
  temporaryGitHubCopilotModelProfile,
} from '../src/temporary-models.ts'

describe('temporary GitHub Copilot model overlays', () => {
  it('supplies verified GPT-6 Astra Responses metadata while pi-ai lacks it', () => {
    const model = temporaryGitHubCopilotModel('gpt-6-astra', new Set())

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

  it('retires the overlay automatically when the installed catalog owns GPT-6 Astra', () => {
    expect(temporaryGitHubCopilotModel('gpt-6-astra', new Set(['gpt-6-astra']))).toBeUndefined()
  })

  it('does not synthesize arbitrary unknown account models', () => {
    expect(temporaryGitHubCopilotModel('future-unknown-model', new Set())).toBeUndefined()
  })
})
