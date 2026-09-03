import { describe, expect, it } from 'vitest'
import { Config, resolveProfiles } from '../src/config.ts'

describe('controlled Core per-model API integration', () => {
  it('applies route strict-mode compatibility only to supported model protocols', () => {
    const parsed = Config({
      providers: {
        'github-copilot': {
          compat: { supportsStrictMode: false },
          models: [
            { id: 'claude-sonnet-4.5', api: 'anthropic-messages' },
            { id: 'gemini-3.6-flash', api: 'openai-completions' },
            { id: 'gpt-5.6-sol', api: 'openai-responses' },
          ],
        },
      },
    })
    const resolved = resolveProfiles(parsed.providers).get('github-copilot')

    expect(resolved?.piProvider.getModels().map(({ id, api, baseUrl, compat }) => ({
      id,
      api,
      baseUrl,
      supportsStrictMode: compat?.supportsStrictMode,
    }))).toEqual([
      {
        id: 'claude-sonnet-4.5',
        api: 'anthropic-messages',
        baseUrl: 'https://api.individual.githubcopilot.com',
        supportsStrictMode: undefined,
      },
      {
        id: 'gemini-3.6-flash',
        api: 'openai-completions',
        baseUrl: 'https://api.individual.githubcopilot.com',
        supportsStrictMode: false,
      },
      {
        id: 'gpt-5.6-sol',
        api: 'openai-responses',
        baseUrl: 'https://api.individual.githubcopilot.com',
        supportsStrictMode: false,
      },
    ])
  })
})
