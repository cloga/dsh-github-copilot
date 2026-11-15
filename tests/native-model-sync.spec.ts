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
      contextWindowSource: 'max_context_window_tokens', visionSupportKnown: true, reasoningEffortsKnown: true,
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
      nativeCatalog: [{ id: 'messages-model', api: 'anthropic-messages' }],
    })
    expect(result.models.map(model => model.id)).toEqual(['responses-model'])
    expect(result.skipped).toEqual([
      { id: 'messages-model', code: 'NATIVE_API_MISMATCH' },
      { id: 'unknown-route-model', code: 'NATIVE_API_MISMATCH' },
    ])
  })

  it('does not repoint a known native model when its inherited catalog protocol differs', () => {
    const result = planNativeModelSync({
      accountModels: [accountModel('known', 'openai-responses'), accountModel('new', 'openai-responses')],
      excludedModelIds: new Set(),
      currentModels: [],
      currentModelsUseCatalog: false,
      routeApi: 'openai-responses',
      nativeCatalog: [{ id: 'known', api: 'anthropic-messages' }],
    })

    expect(result.models.map(model => model.id)).toEqual(['new'])
    expect(result.skipped).toEqual([{ id: 'known', code: 'NATIVE_INHERITED_API_MISMATCH' }])
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

  it('does not report schema-injected empty compatibility fields as model updates', () => {
    const result = planNativeModelSync({
      accountModels: [accountModel('unchanged')],
      excludedModelIds: new Set(),
      currentModels: [{
        id: 'unchanged', name: 'Account unchanged', contextWindow: 131_072, maxTokens: 8_192,
        input: ['text'], reasoningEfforts: { low: 'low', high: 'high' },
        compat: { chatTemplateArgs: {}, chatTemplateKwargs: {} },
      }],
      currentModelsUseCatalog: false,
      routeApi: 'openai-responses',
      nativeCatalog: [],
    })

    expect(result.updatedIds).toEqual([])
  })

  it('requires installed native protocol evidence for unknown account model IDs', () => {
    const result = planNativeModelSync({
      accountModels: [accountModel('known', 'openai-responses'), accountModel('future', 'openai-responses')],
      excludedModelIds: new Set(),
      currentModels: [],
      currentModelsUseCatalog: true,
      nativeCatalog: [{ id: 'known', api: 'openai-responses' }, { id: 'other-api', api: 'anthropic-messages' }],
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
        { id: 'known-a', api: 'openai-responses' },
        { id: 'known-b', api: 'openai-responses' },
      ],
    })

    expect(result.models.map(model => model.id)).toEqual(['future'])
    expect(result.skipped).toEqual([])
  })

  it('skips new non-Responses models without a native compatibility baseline', () => {
    for (const api of ['openai-completions', 'anthropic-messages'] as const) {
      const result = planNativeModelSync({
        accountModels: [
          accountModel('known', api, { advertisedEfforts: [] }),
          accountModel('new', api, { advertisedEfforts: [] }),
        ],
        excludedModelIds: new Set(),
        currentModels: [],
        currentModelsUseCatalog: false,
        routeApi: api,
        nativeCatalog: [{ id: 'known', api }],
      })

      expect(result.models.map(model => model.id)).toEqual(['known'])
      expect(result.skipped).toEqual([{ id: 'new', code: 'NATIVE_COMPATIBILITY_UNPROVEN' }])
    }
  })

  it('reports a catalog-backed model as updated when sync adds an output request default', () => {
    const model = accountModel('same')
    const result = planNativeModelSync({
      accountModels: [model],
      excludedModelIds: new Set(),
      currentModels: [],
      currentModelsUseCatalog: true,
      nativeCatalog: [{ id: model.id, api: model.api }],
    })

    expect(result.updatedIds).toEqual(['same'])
    expect(result.outputTokenDefaults).toEqual([{ id: 'same', maxTokens: 8_192 }])
  })

  it('rejects reasoning controls that the native profile cannot represent', () => {
    const result = planNativeModelSync({
      accountModels: [
        accountModel('unmapped', 'openai-responses', { unmappedEfforts: ['future-effort'] }),
        accountModel('adaptive', 'anthropic-messages', { adaptiveThinking: true }),
        accountModel('messages-thinking', 'anthropic-messages'),
        accountModel('off-only', 'openai-responses', { advertisedEfforts: ['off'] }),
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
      { id: 'off-only', code: 'NATIVE_REASONING_UNSUPPORTED' },
    ])
  })

  it('does not expose an off control that the managed account model does not expose', () => {
    const model = accountModel('with-off', 'openai-responses', { advertisedEfforts: ['off', 'low', 'high'] })
    const base = {
      accountModels: [model], excludedModelIds: new Set<string>(), currentModels: [],
      currentModelsUseCatalog: false, routeApi: 'openai-responses', nativeCatalog: [],
    }

    expect(planNativeModelSync(base).models[0]?.reasoningEfforts).toEqual({ low: 'low', high: 'high' })
    expect(planNativeModelSync({ ...base, routeReasoning: 'off' }).skipped).toEqual([
      { id: 'with-off', code: 'NATIVE_REASONING_UNSUPPORTED' },
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

  it('skips models that cannot satisfy the existing native route default reasoning effort', () => {
    const result = planNativeModelSync({
      accountModels: [
        accountModel('supports-high'),
        accountModel('low-only', 'openai-responses', { advertisedEfforts: ['low'] }),
        accountModel('no-reasoning', 'openai-responses', { advertisedEfforts: [] }),
      ],
      excludedModelIds: new Set(),
      currentModels: [],
      currentModelsUseCatalog: false,
      routeApi: 'openai-responses',
      routeReasoning: 'high',
      nativeCatalog: [],
    })

    expect(result.models.map(model => model.id)).toEqual(['supports-high'])
    expect(result.skipped).toEqual([
      { id: 'low-only', code: 'NATIVE_REASONING_UNSUPPORTED' },
      { id: 'no-reasoning', code: 'NATIVE_REASONING_UNSUPPORTED' },
    ])
  })

  it('skips narrower or unknown server input caps that cannot be represented natively', () => {
    const result = planNativeModelSync({
      accountModels: [
        { ...accountModel('bounded-input'), maxInputTokens: 64_000 },
        { ...accountModel('unknown-input'), maxInputTokens: undefined },
        { ...accountModel('unknown-context'), evidence: {
          ...accountModel('unknown-context').evidence, contextWindowSource: 'max_prompt_tokens',
        } },
        accountModel('full-input'),
      ],
      excludedModelIds: new Set(),
      currentModels: [],
      currentModelsUseCatalog: false,
      routeApi: 'openai-responses',
      nativeCatalog: [],
    })

    expect(result.models.map(model => model.id)).toEqual(['full-input'])
    expect(result.skipped).toEqual([
      { id: 'bounded-input', code: 'NATIVE_INPUT_LIMIT_UNSUPPORTED' },
      { id: 'unknown-input', code: 'NATIVE_INPUT_LIMIT_UNKNOWN' },
      { id: 'unknown-context', code: 'NATIVE_CONTEXT_LIMIT_UNKNOWN' },
    ])
  })

  it('skips missing vision or reasoning evidence rather than treating it as disabled', () => {
    const missingVision = accountModel('unknown-vision-support')
    const missingReasoning = accountModel('unknown-reasoning', 'openai-responses', { advertisedEfforts: [] })
    const result = planNativeModelSync({
      accountModels: [
        { ...missingVision, evidence: { ...missingVision.evidence, visionSupportKnown: undefined } },
        { ...missingReasoning, evidence: { ...missingReasoning.evidence, reasoningEffortsKnown: undefined } },
        accountModel('known'),
      ],
      excludedModelIds: new Set(),
      currentModels: [],
      currentModelsUseCatalog: false,
      routeApi: 'openai-responses',
      nativeCatalog: [],
    })

    expect(result.models.map(model => model.id)).toEqual(['known'])
    expect(result.skipped).toEqual([
      { id: 'unknown-vision-support', code: 'NATIVE_VISION_SUPPORT_UNKNOWN' },
      { id: 'unknown-reasoning', code: 'NATIVE_REASONING_UNKNOWN' },
    ])
  })

  it('syncs vision only when account metadata covers every native request image format', () => {
    const model = accountModel('restricted-vision')
    const result = planNativeModelSync({
      accountModels: [{
        ...model,
        input: ['text', 'image'],
        evidence: { ...model.evidence, visionMediaTypes: ['image/png', 'image/jpeg', 'image/webp'] },
      }, { ...accountModel('unknown-vision'), input: ['text', 'image'] }, {
        ...accountModel('full-vision'),
        input: ['text', 'image'],
        evidence: { ...model.evidence, visionMediaTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] },
      }],
      excludedModelIds: new Set(),
      currentModels: [],
      currentModelsUseCatalog: false,
      routeApi: 'openai-responses',
      nativeCatalog: [],
    })

    expect(result.models.map(value => value.id)).toEqual(['full-vision'])
    expect(result.models[0]?.input).toEqual(['text', 'image'])
    expect(result.skipped).toEqual([
      { id: 'restricted-vision', code: 'NATIVE_VISION_MEDIA_TYPES_UNSUPPORTED' },
      { id: 'unknown-vision', code: 'NATIVE_VISION_MEDIA_TYPES_UNKNOWN' },
    ])
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
