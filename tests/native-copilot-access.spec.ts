import { Context } from '@deepseek-ai/cordis'
import * as NativeAdapter from '@deepseek-ai/dsh-llm-pi-ai'
import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { captureNativeCopilot, nativeCopilotModels } from '../src/native-copilot-access.ts'

const contexts: Context[] = []
const directories: string[] = []

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
  const state = { revision: 1 }
  ctx.provide('llm', {
    listConfigurableProviders: () => [{ provider: 'github-copilot', declared: false,
      settingsPath: ['providers', 'github-copilot'], settingsNs: 'llm-pi-ai', nativeAuth: { oauth: true } }],
    listProviders: () => [{ id: 'github-copilot' }],
  })
  ctx.provide('settings', {
    describe: () => [{ ns: 'llm-pi-ai', revision: state.revision, value: { providers: { 'github-copilot': {} } } }],
  })
  ctx.provide('loader', { entries: () => [entry] })
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

  it('uses the adapter-owned catalog when native and plugin pi-ai copies have different paths', async () => {
    const fixture = await independentCatalogFixture()
    const reasons: string[] = []
    const route = await captureNativeCopilot(fixture.ctx, code => reasons.push(code))
    expect(reasons).toEqual([])
    expect(route?.models.get(fixture.model.id)?.api).toBe('openai-completions')
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
})
