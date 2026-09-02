import { describe, expect, it } from 'vitest'
import { Config, resolveProfiles } from '../src/config.ts'

describe('controlled Core per-model API integration', () => {
  it('accepts both mixed-protocol model entries through the real Core config', () => {
    const parsed = Config({
      providers: {
        'github-copilot': {
          models: [
            { id: 'gemini-3.6-flash', api: 'openai-completions' },
            { id: 'gpt-5.6-sol', api: 'openai-responses' },
          ],
        },
      },
    })
    const resolved = resolveProfiles(parsed.providers).get('github-copilot')

    expect(resolved?.piProvider.getModels().map(({ id, api, baseUrl }) => ({ id, api, baseUrl }))).toEqual([
      {
        id: 'gemini-3.6-flash',
        api: 'openai-completions',
        baseUrl: 'https://api.individual.githubcopilot.com',
      },
      {
        id: 'gpt-5.6-sol',
        api: 'openai-responses',
        baseUrl: 'https://api.individual.githubcopilot.com',
      },
    ])
  })
})
