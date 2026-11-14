import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all'
import { describe, expect, it } from 'vitest'
import { nativeCopilotModels } from '../src/native-copilot-access.ts'

describe('native Copilot protocol qualification', () => {
  const model = getBuiltinModels('github-copilot').find(model => model.api === 'openai-responses')!

  it('uses the published catalog only within the native configured model set', () => {
    expect(nativeCopilotModels({ models: [{ id: model.id }] })?.get(model.id)?.api).toBe('openai-responses')
    expect(nativeCopilotModels({ models: [{ id: 'unknown-native-model' }] })?.size).toBe(0)
    expect(nativeCopilotModels({ models: [] })?.has(model.id)).toBe(true)
  })

  it('honors the native provider protocol override without guessing custom models', () => {
    expect(nativeCopilotModels({ api: 'openai-completions' })?.get(model.id)?.api).toBe('openai-completions')
    expect(nativeCopilotModels({ api: 'openai-responses', models: [{ id: 'unknown-native-model' }] })?.size).toBe(0)
  })

  it.each([
    { apiKeyEnv: 'CUSTOM_KEY' },
    { baseURL: 'https://example.invalid' },
    { headers: { authorization: 'custom' } },
    { compat: { thinkingFormat: 'custom' } },
    { models: [{ id: model.id, headers: { authorization: 'custom' } }] },
  ])('leaves custom authentication or transport outside the enhancement', profile => {
    expect(nativeCopilotModels(profile)).toBeUndefined()
  })
})
