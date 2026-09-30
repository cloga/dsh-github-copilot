import { describe, expect, it } from 'vitest'
import { Config, resolveProfiles } from '../src/config.ts'

// Explicit fixture metadata: catalog retirement must not change this config seam check.
describe('controlled Core per-model API integration', () => {
  it.each([
    ['openai-completions', false],
    ['openai-responses', false],
  ] as const)('applies route strict-mode compatibility only to supported model protocols', (api, supportsStrictMode) => {
    const parsed = Config({
      providers: {
        'github-copilot': {
          api,
          compat: { supportsStrictMode: false },
          models: [{ id: 'synthetic-config-model' }],
        },
      },
    }).providers.get()
    const resolved = resolveProfiles(parsed).get('github-copilot')
    expect(resolved?.piProvider.getModels().map(({ id, api, baseUrl, compat }) => ({
      id, api, baseUrl, supportsStrictMode: compat?.supportsStrictMode,
    }))).toEqual([{
      id: 'synthetic-config-model', api,
      baseUrl: 'https://api.individual.githubcopilot.com', supportsStrictMode,
    }])
  })

  it('rejects strict-mode configuration when no model protocol supports it', () => {
    const unsupported = Config({ providers: { 'github-copilot': {
      api: 'anthropic-messages', compat: { supportsStrictMode: false },
      models: [{ id: 'synthetic-config-model' }],
    } } }).providers.get()
    expect(() => resolveProfiles(unsupported)).toThrow(/supportsStrictMode/)
    const supported = Config({ providers: { 'github-copilot': {
      api: 'anthropic-messages', models: [{ id: 'synthetic-config-model' }],
    } } }).providers.get()
    const models = resolveProfiles(supported).get('github-copilot')?.piProvider.getModels()
    expect(models?.[0]?.api).toBe('anthropic-messages')
    expect(models?.[0]?.compat?.supportsStrictMode).toBeUndefined()
  })
})
