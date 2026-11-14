import { describe, expect, it } from 'vitest'
import type { AccountModelDescriptor } from '../src/account-model-catalog.ts'
import { planNativeModelSync } from '../src/native-model-sync.ts'

function accountModel(
  id: string,
  api: AccountModelDescriptor['api'] = 'openai-responses',
  reasoning: Partial<AccountModelDescriptor['reasoning']> = {},
): AccountModelDescriptor {
  return {
    id, name: `Account ${id}`, api, contextWindow: 131_072, maxInputTokens: 131_072, maxTokens: 8_192,
    input: ['text'], reasoning: { advertisedEfforts: ['low', 'high'], unmappedEfforts: [], ...reasoning },
    evidence: {
      endpoints: ['/responses'], unsupportedEndpointCount: 0, selectedEndpoint: '/responses',
      apiSource: 'advertised-native', policySource: 'server-enabled',
      contextWindowSource: 'max_context_window_tokens',
    },
  }
}

describe('planNativeModelSync', () => {
  it('copies only enabled account models and reports additions, removals, and changed model definitions', () => {
    const result = planNativeModelSync({
      accountModels: [accountModel('existing'), accountModel('new-model'), accountModel('excluded-model')],
      excludedModelIds: new Set(['excluded-model']),
      currentModels: [{
        id: 'existing', name: 'Old name', contextWindow: 64_000, maxTokens: 4_096,
        input: ['text'], reasoningEfforts: { low: 'low' },
      }, { id: 'removed-model' }],
      currentModelsUseCatalog: false,
      routeApi: 'openai-responses',
      nativeCatalog: [],
    })

    expect(result).toMatchObject({
      enabledCount: 2,
      syncableCount: 2,
      addedIds: ['new-model'],
      removedIds: ['removed-model'],
      updatedIds: ['existing'],
      skipped: [],
    })
    expect(result.models).toEqual([
      {
        id: 'existing', name: 'Account existing', contextWindow: 131_072, maxTokens: 8_192,
        input: ['text'], reasoningEfforts: { low: 'low', high: 'high' },
      },
      {
        id: 'new-model', name: 'Account new-model', contextWindow: 131_072, maxTokens: 8_192,
        input: ['text'], reasoningEfforts: { low: 'low', high: 'high' },
      },
    ])
    expect(result.outputTokenDefaults).toEqual([
      { id: 'existing', maxTokens: 8_192 },
      { id: 'new-model', maxTokens: 8_192 },
    ])
    expect(JSON.stringify(result.models)).not.toContain('api')
  })

  it('uses the native route API when configured and skips models that route cannot express', () => {
    const result = planNativeModelSync({
      accountModels: [
        accountModel('responses-model'),
        accountModel('messages-model', 'anthropic-messages'),
        accountModel('unknown-route-model', 'openai-completions'),
      ],
      excludedModelIds: new Set(),
      currentModels: [],
      currentModelsUseCatalog: true,
      routeApi: 'openai-responses',
      nativeCatalog: [{
        id: 'messages-model', name: 'Messages', api: 'anthropic-messages',
        contextWindow: 131_072, maxTokens: 8_192, input: ['text'],
      }],
    })
    expect(result.models.map(model => model.id)).toEqual(['responses-model'])
    expect(result.skipped).toEqual([
      { id: 'messages-model', code: 'NATIVE_API_MISMATCH' },
      { id: 'unknown-route-model', code: 'NATIVE_API_MISMATCH' },
    ])
  })

  it('reports extra native profile fields as updates because sync will replace that entry', () => {
    const result = planNativeModelSync({
      accountModels: [accountModel('customized')],
      excludedModelIds: new Set(),
      currentModels: [{
        id: 'customized', name: 'Account customized', contextWindow: 131_072, maxTokens: 8_192,
        input: ['text'], reasoningEfforts: { low: 'low', high: 'high' }, customField: 'kept only until sync',
      }],
      currentModelsUseCatalog: false,
      routeApi: 'openai-responses',
      nativeCatalog: [],
    })

    expect(result.updatedIds).toEqual(['customized'])
  })

  it('requires installed native protocol evidence for unknown account model IDs', () => {
    const result = planNativeModelSync({
      accountModels: [accountModel('known', 'openai-responses'), accountModel('future', 'openai-responses')],
      excludedModelIds: new Set(),
      currentModels: [],
      currentModelsUseCatalog: true,
      nativeCatalog: [{
        id: 'known', name: 'Known', api: 'openai-responses', contextWindow: 131_072, maxTokens: 8_192, input: ['text'],
      }, {
        id: 'other-api', name: 'Other API', api: 'anthropic-messages',
        contextWindow: 131_072, maxTokens: 8_192, input: ['text'],
      }],
    })

    expect(result.models.map(model => model.id)).toEqual(['known'])
    expect(result.skipped).toEqual([{ id: 'future', code: 'NATIVE_API_UNAVAILABLE' }])
  })

  it('uses the catalog API for unknown IDs only when the entire catalog agrees', () => {
    const result = planNativeModelSync({
      accountModels: [accountModel('future', 'openai-responses')],
      excludedModelIds: new Set(),
      currentModels: [],
      currentModelsUseCatalog: false,
      nativeCatalog: [
        { id: 'known-a', name: 'Known A', api: 'openai-responses', contextWindow: 131_072, maxTokens: 8_192, input: ['text'] },
        { id: 'known-b', name: 'Known B', api: 'openai-responses', contextWindow: 131_072, maxTokens: 8_192, input: ['text'] },
      ],
    })

    expect(result.models.map(model => model.id)).toEqual(['future'])
    expect(result.skipped).toEqual([])
  })

  it('rejects reasoning controls that the native profile cannot represent', () => {
    const result = planNativeModelSync({
      accountModels: [
        accountModel('unmapped', 'openai-responses', { unmappedEfforts: ['future-effort'] }),
        accountModel('adaptive', 'anthropic-messages', { adaptiveThinking: true }),
        accountModel('messages-thinking', 'anthropic-messages'),
        accountModel('without-reasoning', 'openai-responses', { advertisedEfforts: [] }),
      ],
      excludedModelIds: new Set(),
      currentModels: [],
      currentModelsUseCatalog: false,
      routeApi: 'openai-responses',
      nativeCatalog: [],
    })
    expect(result.models.map(model => model.id)).toEqual(['without-reasoning'])
    expect(result.models[0]?.reasoningEfforts).toBe(false)
    expect(result.skipped).toEqual([
      { id: 'unmapped', code: 'NATIVE_REASONING_UNSUPPORTED' },
      { id: 'adaptive', code: 'NATIVE_API_MISMATCH' },
      { id: 'messages-thinking', code: 'NATIVE_API_MISMATCH' },
    ])
  })

  it('does not map non-Responses reasoning labels to native effort values', () => {
    const model = accountModel('messages-thinking', 'anthropic-messages')
    const result = planNativeModelSync({
      accountModels: [model],
      excludedModelIds: new Set(),
      currentModels: [],
      currentModelsUseCatalog: false,
      routeApi: 'anthropic-messages',
      nativeCatalog: [],
    })

    expect(result.models).toEqual([])
    expect(result.skipped).toEqual([{
      id: 'messages-thinking', code: 'NATIVE_REASONING_UNSUPPORTED',
    }])
  })

  it('skips models whose server input cap cannot be represented natively', () => {
    const result = planNativeModelSync({
      accountModels: [{ ...accountModel('bounded-input'), maxInputTokens: 64_000 }],
      excludedModelIds: new Set(),
      currentModels: [],
      currentModelsUseCatalog: false,
      routeApi: 'openai-responses',
      nativeCatalog: [],
    })

    expect(result.models).toEqual([])
    expect(result.skipped).toEqual([{ id: 'bounded-input', code: 'NATIVE_INPUT_LIMIT_UNSUPPORTED' }])
  })

  it('skips image models with account-specific MIME restrictions', () => {
    const model = accountModel('restricted-vision')
    const result = planNativeModelSync({
      accountModels: [{
        ...model,
        input: ['text', 'image'],
        evidence: { ...model.evidence, visionMediaTypes: ['image/png'] },
      }],
      excludedModelIds: new Set(),
      currentModels: [],
      currentModelsUseCatalog: false,
      routeApi: 'openai-responses',
      nativeCatalog: [],
    })

    expect(result.models).toEqual([])
    expect(result.skipped).toEqual([{
      id: 'restricted-vision', code: 'NATIVE_VISION_MEDIA_TYPES_UNSUPPORTED',
    }])
  })

  it('does not produce a target when every enabled model is incompatible', () => {
    const result = planNativeModelSync({
      accountModels: [accountModel('messages-model', 'anthropic-messages')],
      excludedModelIds: new Set(),
      currentModels: [],
      currentModelsUseCatalog: true,
      routeApi: 'openai-responses',
      nativeCatalog: [],
    })

    expect(result.enabledCount).toBe(1)
    expect(result.syncableCount).toBe(0)
    expect(result.models).toEqual([])
  })
})
