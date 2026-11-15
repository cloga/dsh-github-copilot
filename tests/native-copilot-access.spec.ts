import { Context } from '@deepseek-ai/cordis'
import * as NativeAdapter from '@deepseek-ai/dsh-llm-pi-ai'
import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { captureNativeCopilot, captureNativeCopilotCatalog, nativeCopilotModels } from '../src/native-copilot-access.ts'

const contexts: Context[] = []
const directories: string[] = []

function normalizedProfile(profile: Record<string, unknown>) {
  return NativeAdapter.Config({ providers: { 'github-copilot': profile } }).providers.get()['github-copilot']!
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child)
    Object.freeze(value)
  }
  return value
}

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

async function independentCatalogFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'copilot-native-catalog-'))
  directories.push(directory)
  const ctx = new Context()
  contexts.push(ctx)
  const model = getBuiltinModels('github-copilot').find(value => value.api === 'openai-responses')!
  const nativeManifest = join(directory, 'native', 'package.json')
  const catalogPath = join(directory, 'native', 'dist', 'providers', 'all.js')
  await mkdir(dirname(catalogPath), { recursive: true })
  await writeFile(nativeManifest, '{"type":"module"}')
  await writeFile(catalogPath, `export function getBuiltinModels() {
    return ${JSON.stringify([{ ...model, api: 'openai-completions' }])}
  }`)
  const adapter = { name: '@deepseek-ai/dsh-llm-pi-ai', version: '0.2.2-rc.3',
    manifestPath: join(directory, 'adapter', 'package.json') }
  const nativePi = { name: '@earendil-works/pi-ai', version: '1.3.0', manifestPath: nativeManifest,
    manifest: { exports: { './providers/*': { import: './dist/providers/*.js' } } } }
  const localPi = { ...nativePi, manifestPath: join(directory, 'plugin', 'package.json') }
  const fiber: { uid: number | null; runtime: { callback: typeof NativeAdapter.apply } } = {
    uid: 1, runtime: { callback: NativeAdapter.apply },
  }
  const entry = {
    options: { id: 'llm-pi-ai', name: adapter.name }, fiber: { ctx: { fiber } },
    parent: { tree: { ctx: { baseUrl: import.meta.url } } },
  }
  const state: { revision: number; profile: unknown; entryActive: boolean } = {
    revision: 1, profile: normalizedProfile({}), entryActive: true,
  }
  ctx.provide('llm', {
    listConfigurableProviders: () => [{ provider: 'github-copilot', declared: false,
      settingsPath: ['providers', 'github-copilot'], settingsNs: 'llm-pi-ai', nativeAuth: { oauth: true } }],
    listProviders: () => [{ id: 'github-copilot' }],
  })
  ctx.provide('settings', {
    describe: () => [{ ns: 'llm-pi-ai', revision: state.revision, value: { providers: { 'github-copilot': state.profile } } }],
  })
  ctx.provide('loader', { entries: () => state.entryActive ? [entry] : [] })
  ctx.provide('pluginPackages', {
    packageOf: (name: string, importer: string) => name === adapter.name ? adapter
      : name === nativePi.name ? importer === pathToFileURL(adapter.manifestPath).href ? nativePi : localPi
        : undefined,
  })
  return { ctx, model, nativePi, localPi, fiber, state, catalogPath }
}

describe('native Copilot protocol qualification', () => {
  const catalog = getBuiltinModels('github-copilot')
  const model = catalog.find(model => model.api === 'openai-responses')!

  it('uses the published catalog only within the native configured model set', () => {
    expect(nativeCopilotModels({ models: [{ id: model.id }] }, catalog)?.get(model.id)?.api).toBe('openai-responses')
    expect(nativeCopilotModels({ models: [{ id: 'unknown-native-model' }] }, catalog)?.size).toBe(0)
    expect(nativeCopilotModels({ models: [] }, catalog)?.has(model.id)).toBe(true)
  })

  it('honors the native provider protocol override without guessing custom models', () => {
    expect(nativeCopilotModels({ api: 'openai-completions' }, catalog)?.get(model.id)?.api).toBe('openai-completions')
    expect(nativeCopilotModels({ api: 'openai-responses', models: [{ id: 'unknown-native-model' }] }, catalog)?.size).toBe(0)
  })

  it.each([
    { apiKeyEnv: 'CUSTOM_KEY' },
    { baseURL: 'https://example.invalid' },
    { headers: { authorization: 'custom' } },
    { compat: { thinkingFormat: 'custom' } },
    { models: [{ id: model.id, headers: { authorization: 'custom' } }] },
  ])('leaves custom authentication or transport outside the enhancement', profile => {
    expect(nativeCopilotModels(profile, catalog)).toBeUndefined()
  })

  const layers = ['provider', 'model', 'override'] as const
  function atLayer(layer: typeof layers[number], compat: unknown): Record<string, unknown> {
    if (layer === 'model') return { models: [{ id: model.id, compat }] }
    if (layer === 'override') return { modelOverrides: { [model.id]: { compat } } }
    return { compat }
  }

  it.each(layers)('accepts only verified native default compat and strict-tool booleans at %s scope without mutation', layer => {
    for (const compat of [
      {}, { chatTemplateKwargs: {} }, { chatTemplateArgs: {} },
      { chatTemplateKwargs: {}, chatTemplateArgs: {} },
      { supportsStrictMode: false }, { supportsStrictMode: true },
      { chatTemplateKwargs: {}, chatTemplateArgs: {}, supportsStrictMode: false },
      { chatTemplateKwargs: {}, chatTemplateArgs: {}, supportsStrictMode: true },
      { chatTemplateKwargs: Object.create(null) as Record<string, never> },
    ]) {
      const profile = freeze(atLayer(layer, compat))
      const before = structuredClone(profile)
      expect(nativeCopilotModels(profile, catalog)?.get(model.id)?.api).toBe('openai-responses')
      expect(profile).toEqual(before)
    }
  })

  it.each(layers)('rejects unknown, malformed or nonempty native compat at %s scope', layer => {
    for (const compat of [
      null, false, 0, '', [], new Date(0),
      { chatTemplateKwargs: null }, { chatTemplateKwargs: [] }, { chatTemplateKwargs: undefined },
      { chatTemplateKwargs: { enable_thinking: false } }, { chatTemplateKwargs: { empty: undefined } },
      { chatTemplateKwargs: Object.create({ inherited: true }) as object },
      { chatTemplateKwargs: new Date(0) },
      { chatTemplateArgs: null }, { chatTemplateArgs: [] }, { chatTemplateArgs: '' },
      { chatTemplateArgs: { enable_thinking: false } },
      { supportsStrictMode: 'false' }, { supportsStrictMode: 0 },
      { supportsStrictMode: null }, { supportsStrictMode: undefined },
      { supportsStrictMode: {} },
      { unknown: {} }, { unknown: undefined }, { unknown: null },
      { supportsTemperature: false },
      { chatTemplateKwargs: {}, chatTemplateArgs: {}, supportsStrictMode: false, unknown: {} },
    ]) expect(nativeCopilotModels(atLayer(layer, compat), catalog)).toBeUndefined()
  })

  it.each(layers)('keeps credential, endpoint and header exclusions with allowed compat at %s scope', layer => {
    for (const transport of [
      { apiKeyEnv: 'CUSTOM_KEY' }, { baseURL: 'https://example.invalid' },
      { headers: { authorization: 'custom' } },
    ]) {
      const value = { compat: { chatTemplateKwargs: {}, chatTemplateArgs: {}, supportsStrictMode: false }, ...transport }
      const profile = layer === 'model' ? { models: [{ id: model.id, ...value }] }
        : layer === 'override' ? { modelOverrides: { [model.id]: value } } : value
      expect(nativeCopilotModels(profile, catalog)).toBeUndefined()
    }
  })

  it.each([undefined, false, true])('qualifies real native Config defaults in separate models/overrides profiles (strict=%s)', strict => {
    const compat = strict === undefined ? undefined : { supportsStrictMode: strict }
    for (const layer of ['model', 'override'] as const) {
      const fields = compat === undefined ? {} : { compat }
      // Core forbids modelOverrides beside a nonempty replacement models list.
      const input = { ...fields, ...layer === 'model'
        ? { models: [{ id: model.id, ...fields }] }
        : { modelOverrides: { [model.id]: fields } } }
      const profile = freeze(normalizedProfile(input))
      const before = structuredClone(profile)
      const expected = { chatTemplateKwargs: {}, chatTemplateArgs: {}, ...compat }
      expect(profile.compat).toEqual(expected)
      if (layer === 'model') {
        expect(profile.models?.[0]?.compat).toEqual(expected)
        expect(profile.modelOverrides).toEqual({})
      } else {
        expect(profile.models).toEqual([])
        expect(profile.modelOverrides?.[model.id]?.compat).toEqual(expected)
      }
      expect(nativeCopilotModels(profile, catalog)?.get(model.id)?.api).toBe('openai-responses')
      expect(profile).toEqual(before)
    }
  })

  it('uses the adapter-owned catalog when native and plugin pi-ai copies have different paths', async () => {
    const fixture = await independentCatalogFixture()
    const reasons: string[] = []
    const route = await captureNativeCopilot(fixture.ctx, code => reasons.push(code))
    expect(reasons).toEqual([])
    expect(route?.models.get(fixture.model.id)?.api).toBe('openai-completions')
  })

  it('exposes the proven unfiltered adapter catalog independently of the configured model list', async () => {
    const fixture = await independentCatalogFixture()
    fixture.state.profile = { models: [{ id: 'existing-custom-model' }] }
    const snapshot = await captureNativeCopilotCatalog(fixture.ctx)
    expect(snapshot?.catalog.get(fixture.model.id)?.api).toBe('openai-completions')
    expect(snapshot?.configuredModels?.size).toBe(0)
    fixture.state.revision += 1
    expect(() => snapshot?.assertCurrent()).toThrow('COPILOT_NATIVE_ROUTE_CHANGED')
  })

  it.each([
    { id: 'configured-native-model' },
    { id: 'configured-native-model', name: 'Existing configured model',
      contextWindow: 64_000, maxTokens: 8_192, input: ['text'], reasoningEfforts: false },
  ])('qualifies the explicitly configured model ID only for account attribution', async configured => {
    const fixture = await independentCatalogFixture()
    fixture.state.profile = normalizedProfile({ api: 'openai-responses', models: [configured] })
    const route = await captureNativeCopilot(fixture.ctx)
    expect(route?.models.has(configured.id)).toBe(false)
    expect(route?.accountModelIds?.has(configured.id)).toBe(true)
    expect(route?.accountModelIds?.has('unconfigured-model')).toBe(false)
    fixture.state.revision += 1
    expect(() => route?.assertCurrent()).toThrow('COPILOT_NATIVE_ROUTE_CHANGED')
  })

  it('uses the proven catalog for account attribution when no model list is configured', async () => {
    const fixture = await independentCatalogFixture()
    const route = await captureNativeCopilot(fixture.ctx)
    expect(route?.accountModelIds?.has(fixture.model.id)).toBe(true)
    expect(route?.accountModelIds?.has('unconfigured-model')).toBe(false)
  })

  it.each([
    { models: [{ id: '' }] },
    { models: [{ id: ' invalid' }] },
    { models: [{ id: 'invalid\nmodel' }] },
    { models: [{ id: 'duplicate' }, { id: 'duplicate' }] },
  ])('does not qualify malformed configured model IDs for account attribution', async ({ models }) => {
    const fixture = await independentCatalogFixture()
    fixture.state.profile = { models }
    const route = await captureNativeCopilot(fixture.ctx)
    expect(route?.accountModelIds).toBeUndefined()
  })

  it('does not qualify malformed native model overrides for account attribution', async () => {
    const fixture = await independentCatalogFixture()
    fixture.state.profile = { models: [{ id: 'configured-native-model' }], modelOverrides: [] }
    const route = await captureNativeCopilot(fixture.ctx)
    expect(route?.accountModelIds).toBeUndefined()
  })

  it.each([
    { apiKeyEnv: 'CUSTOM_KEY' },
    { baseURL: 'https://example.invalid' },
    { headers: { authorization: 'custom' } },
    { models: [{ id: 'configured-native-model', baseURL: 'https://example.invalid' }] },
    { modelOverrides: { 'configured-native-model': { headers: { authorization: 'custom' } } } },
  ])('does not qualify account evidence for custom native transport', async transport => {
    const fixture = await independentCatalogFixture()
    fixture.state.profile = { api: 'openai-responses', models: [{ id: 'configured-native-model' }], ...transport }
    expect(await captureNativeCopilot(fixture.ctx)).toBeUndefined()
  })

  it('rejects unknown pi-ai versions and unresolvable public catalog exports', async () => {
    const fixture = await independentCatalogFixture()
    const reasons: string[] = []
    fixture.nativePi.version = '1.2.0'
    expect(await captureNativeCopilot(fixture.ctx, code => reasons.push(code))).toBeUndefined()
    expect(reasons).toContain('COPILOT_NATIVE_PI_UNPROVEN')
    fixture.nativePi.version = '1.3.0'
    fixture.localPi.version = '1.2.0'
    reasons.length = 0
    expect(await captureNativeCopilot(fixture.ctx, code => reasons.push(code))).toBeUndefined()
    expect(reasons).toContain('COPILOT_NATIVE_PI_UNPROVEN')
    fixture.localPi.version = '1.3.0'
    fixture.nativePi.manifest.exports['./providers/*'].import = '../../outside/*.js'
    reasons.length = 0
    expect(await captureNativeCopilot(fixture.ctx, code => reasons.push(code))).toBeUndefined()
    expect(reasons).toContain('COPILOT_NATIVE_CATALOG_UNAVAILABLE')
  })

  it.each(['condition', 'competing-pattern'] as const)(
    'rejects an ambiguous native catalog export (%s)', async kind => {
      const fixture = await independentCatalogFixture()
      if (kind === 'condition') {
        Object.assign(fixture.nativePi.manifest.exports['./providers/*'], { node: './other/*.js' })
      } else {
        Object.assign(fixture.nativePi.manifest.exports, { './providers/a*': { import: './other/*.js' } })
      }
      const reasons: string[] = []
      expect(await captureNativeCopilot(fixture.ctx, code => reasons.push(code))).toBeUndefined()
      expect(reasons).toContain('COPILOT_NATIVE_CATALOG_UNAVAILABLE')
    })

  it('rejects incomplete native protocol metadata without borrowing the plugin catalog', async () => {
    const fixture = await independentCatalogFixture()
    await writeFile(fixture.catalogPath, `export function getBuiltinModels() { return [{ id: ${JSON.stringify(fixture.model.id)} }] }`)
    const reasons: string[] = []
    expect(await captureNativeCopilot(fixture.ctx, code => reasons.push(code))).toBeUndefined()
    expect(reasons).toContain('COPILOT_NATIVE_MODELS_UNPROVEN')
  })

  it('revokes an independently resolved catalog when configuration or ownership changes', async () => {
    const fixture = await independentCatalogFixture()
    const route = await captureNativeCopilot(fixture.ctx)
    expect(route).toBeDefined()
    fixture.state.revision += 1
    expect(() => route?.assertCurrent()).toThrow('COPILOT_NATIVE_ROUTE_CHANGED')
    fixture.state.revision -= 1
    fixture.nativePi.manifestPath += '.replaced'
    expect(() => route?.assertCurrent()).toThrow('COPILOT_NATIVE_ROUTE_CHANGED')
    fixture.nativePi.manifestPath = fixture.nativePi.manifestPath.slice(0, -'.replaced'.length)
    fixture.fiber.uid = null
    expect(() => route?.assertCurrent()).toThrow('COPILOT_NATIVE_ROUTE_CHANGED')
  })

  it('revokes a catalog snapshot when its native Loader entry is removed', async () => {
    const fixture = await independentCatalogFixture()
    const route = await captureNativeCopilotCatalog(fixture.ctx)
    expect(route).toBeDefined()
    fixture.state.entryActive = false
    expect(() => route?.assertCurrent()).toThrow('COPILOT_NATIVE_ROUTE_CHANGED')
  })
})
