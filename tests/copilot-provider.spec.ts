/**
 * Tests for installer-ready GitHub Copilot route composition.
 */

import { describe, expect, it } from 'vitest'
import {
  composeGitHubCopilotProviderRoutes,
  GITHUB_COPILOT_API_KEY_ENV,
} from '../src/copilot-provider.ts'
import type { CatalogModel } from '../src/model-catalog.ts'

const models: readonly CatalogModel[] = [
  {
    id: 'responses-only',
    name: 'Responses',
    api: 'openai-responses',
    input: ['text', 'image'],
    reasoning: true,
    reasoningEfforts: { off: null, high: 'high' },
  },
  {
    id: 'both',
    name: 'Both',
    api: 'openai-responses',
    apis: ['openai-responses', 'openai-completions'],
    input: ['text'],
  },
]

describe('composeGitHubCopilotProviderRoutes', () => {
  it('composes Responses and Chat routes with catalog metadata intact', () => {
    const result = composeGitHubCopilotProviderRoutes({
      baseURL: 'https://gateway.example/v1/',
      models,
    })
    expect(result.providers['github-copilot']).toEqual({
      api: 'openai-responses',
      baseURL: 'https://gateway.example/v1',
      apiKeyEnv: GITHUB_COPILOT_API_KEY_ENV,
      models,
    })
    expect(result.providers['github-copilot-chat']).toEqual({
      api: 'openai-completions',
      baseURL: 'https://gateway.example/v1',
      apiKeyEnv: GITHUB_COPILOT_API_KEY_ENV,
      models: [models[1]],
    })
  })

  it('fails closed for invalid route input', () => {
    expect(() => composeGitHubCopilotProviderRoutes({
      baseURL: 'file:///gateway',
      models,
    })).toThrow('must use http or https')
    expect(() => composeGitHubCopilotProviderRoutes({
      baseURL: 'https://gateway.example/v1',
      models: [],
    })).toThrow('at least one model')
  })
})
