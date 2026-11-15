import { describe, expect, it } from 'vitest'
import type { AccountModelDescriptor } from '../src/account-model-catalog.ts'
import { matchesNativeModelProfile, planNativeModelSync } from '../src/native-model-sync.ts'

function accountModel(id: string): AccountModelDescriptor {
  return {
    id, name: `Account ${id}`, api: 'openai-responses', contextWindow: 131_072,
    maxInputTokens: 64_000, maxTokens: 8_192, input: ['text', 'image'],
    reasoning: { advertisedEfforts: ['high'], unmappedEfforts: [] },
    evidence: {
      endpoints: ['/responses'], unsupportedEndpointCount: 0, selectedEndpoint: '/responses',
      apiSource: 'advertised-native', policySource: 'server-enabled',
      contextWindowSource: 'max_context_window_tokens', visionSupportKnown: true,
      reasoningEffortsKnown: true, visionMediaTypes: ['image/png'],
    },
  }
}

describe('planNativeModelSync', () => {
  it('submits all enabled account IDs without copying or qualifying capabilities', () => {
    const result = planNativeModelSync({
      accountModels: [accountModel('existing'), accountModel('new'), accountModel('excluded')],
      excludedModelIds: new Set(['excluded']),
      currentModels: [{ id: 'existing', maxTokens: 4_096 }, { id: 'removed' }],
      currentModelsUseCatalog: false,
      nativeCatalog: ['existing', 'new', 'excluded'].map(id => ({ id, api: 'openai-responses' })),
    })

    expect(result).toEqual({
      enabledCount: 2, syncableCount: 2,
      models: [{ id: 'existing' }, { id: 'new' }],
      outputTokenDefaults: [],
      addedIds: ['new'], removedIds: ['removed'], updatedIds: ['existing'], skipped: [], nativeCatalogMissingIds: [],
    })
  })

  it('does not reject native entries for narrower input, image formats or unavailable account reasoning controls', () => {
    const models = [
      accountModel('bounded-input'),
      { ...accountModel('unknown-input'), maxInputTokens: undefined },
      { ...accountModel('unknown-reasoning'), reasoning: { advertisedEfforts: [], unmappedEfforts: [] },
        evidence: { ...accountModel('unknown-reasoning').evidence, reasoningEffortsKnown: undefined } },
      { ...accountModel('native-thinking'), reasoning: {
        advertisedEfforts: ['future'], unmappedEfforts: ['future'], adaptiveThinking: true,
      } },
    ]
    const result = planNativeModelSync({
      accountModels: models, excludedModelIds: new Set(),
      currentModels: [], currentModelsUseCatalog: false,
      nativeCatalog: models.map(({ id }) => ({ id, api: 'openai-responses' })),
    })

    expect(result.models).toEqual(models.map(({ id }) => ({ id })))
    expect(result.skipped).toEqual([])
    expect(result.outputTokenDefaults).toEqual([])
  })

  it('leaves mixed-protocol model definitions with the native catalog instead of rewriting them', () => {
    const result = planNativeModelSync({
      accountModels: [accountModel('responses'), accountModel('messages')],
      excludedModelIds: new Set(), currentModels: [], currentModelsUseCatalog: true,
      nativeCatalog: [
        { id: 'responses', api: 'openai-responses' },
        { id: 'messages', api: 'anthropic-messages' },
      ],
    })

    expect(result.models).toEqual([{ id: 'responses' }, { id: 'messages' }])
    expect(result.updatedIds).toEqual([])
    expect(result.skipped).toEqual([])
  })

  it('includes unknown native IDs with an advisory instead of filtering them or inventing defaults', () => {
    const result = planNativeModelSync({
      accountModels: [accountModel('known'), accountModel('not-in-native-catalog')],
      excludedModelIds: new Set(), currentModels: [], currentModelsUseCatalog: true,
      nativeCatalog: [{ id: 'known', api: 'openai-responses' }],
    })

    expect(result.models).toEqual([{ id: 'known' }, { id: 'not-in-native-catalog' }])
    expect(result.nativeCatalogMissingIds).toEqual(['not-in-native-catalog'])
    expect(result.skipped).toEqual([])
  })

  it('submits every enabled ID even when none is in the native catalog', () => {
    const result = planNativeModelSync({
      accountModels: [accountModel('future')], excludedModelIds: new Set(),
      currentModels: [], currentModelsUseCatalog: true, nativeCatalog: [],
    })
    expect(result).toMatchObject({
      enabledCount: 1, syncableCount: 1, models: [{ id: 'future' }],
      skipped: [], nativeCatalogMissingIds: ['future'],
    })
  })

  it('treats native schema-injected empty fields as unchanged but discloses removal of custom definitions', () => {
    const ids = ['same', 'customized']
    const result = planNativeModelSync({
      accountModels: ids.map(accountModel), excludedModelIds: new Set(),
      currentModels: [
        { id: 'same', input: [], compat: { chatTemplateArgs: {}, chatTemplateKwargs: {} } },
        { id: 'customized', name: 'Custom', contextWindow: 64_000, maxTokens: 4_096 },
      ],
      currentModelsUseCatalog: false,
      nativeCatalog: ids.map(id => ({ id, api: 'openai-responses' })),
    })
    expect(result.updatedIds).toEqual(['customized'])
    expect(matchesNativeModelProfile({ id: 'same', input: ['text'] }, { id: 'same' })).toBe(false)
    expect(matchesNativeModelProfile({ id: 'same', compat: { supportsStrictMode: false } }, { id: 'same' })).toBe(false)
  })

  it('rejects duplicate catalog or stored model IDs instead of producing an ambiguous plan', () => {
    const base = {
      accountModels: [accountModel('known')], excludedModelIds: new Set<string>(),
      currentModels: [], currentModelsUseCatalog: false,
      nativeCatalog: [{ id: 'known', api: 'openai-responses' }],
    }
    expect(() => planNativeModelSync({
      ...base, nativeCatalog: [...base.nativeCatalog, ...base.nativeCatalog],
    })).toThrow('NATIVE_MODEL_SYNC_SETTINGS_INVALID')
    expect(() => planNativeModelSync({
      ...base, currentModels: [{ id: 'known' }, { id: 'known' }],
    })).toThrow('NATIVE_MODEL_SYNC_SETTINGS_INVALID')
  })
})
