import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { test } from 'node:test'
import * as cordis from '@deepseek-ai/cordis'
import { Context } from '@deepseek-ai/cordis'
import { SettingsProvider } from '@deepseek-ai/dsh-settings'
import { TypertRegistry } from '@deepseek-ai/dsh-typert-registry'
import { Config } from '../../lib/types/config.js'
import { WebSearchRoutingConfigSchema } from '../../lib/types/web-search-routing-config.js'

const ROUTING = 'github-copilot-search-routing'
const COPILOT = 'github-copilot'
const ops = [
  { op: 'set', path: ['searchProvider'], value: 'auto' },
  { op: 'set', path: ['defaultSearchProvider'], value: 'github-copilot-hosted' },
]

// Real pinned Settings validation/CAS, with only isolated in-memory persistence.
// No Host SettingsController write through Gateway, browser, live profile, OAuth,
// or search is exercised. Client Gateway mounting below checks identity only.
class MemorySettings extends SettingsProvider {
  writes = []
  get writable() { return true }
  async load() { return {} }
  async persist(ns, value) { this.writes.push({ ns, value }) }
}
function fixture(t) {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  const settings = new MemorySettings(ctx)
  settings.register(ROUTING, WebSearchRoutingConfigSchema, { base: {} })
  const view = ns => settings.describe({ redactSecrets: true }).find(entry => entry.ns === ns)
  return { settings, view }
}

// Execute the unchanged generated Client bundle in an isolated ModuleLoader stub
// to obtain its actual strict descriptors, rather than inventing Remote codecs.
async function clientPlugin(packageName) {
  const bundle = new URL('./client.js', import.meta.resolve(packageName))
  let plugin
  vm.runInNewContext(await readFile(bundle, 'utf8'), {
    AbortController, AbortSignal, crypto, TextEncoder, TextDecoder, URL, setTimeout, clearTimeout,
    window: { __ModuleLoader__: { load(entry) {
      plugin = entry.factory(name => {
        assert.equal(name, '@deepseek-ai/cordis', 'only the real pinned Cordis external is permitted')
        return cordis
      })
    } } },
  }, { filename: `${packageName}/client.js` })
  return plugin
}
async function settingsContribution() {
  const plugin = await clientPlugin('@deepseek-ai/dsh-api-remotes')
  const contributions = []
  const dispose = await plugin.apply({ remote: { async $mount(contribution) {
    contributions.push(contribution)
    return () => {}
  } } })
  await dispose()
  const contribution = contributions.find(entry => entry.package === '@deepseek-ai/dsh-api-settings-controller')
  assert.ok(contribution, 'official generated Settings Remote contribution')
  return contribution
}
async function settingsMutateDescriptor() {
  const contribution = await settingsContribution()
  const descriptor = contribution.descriptors.find(entry => entry.namespace === 'settings' && entry.method === 'mutate')
  assert.ok(descriptor, 'official generated settings/mutate descriptor')
  return descriptor
}

test('real pinned Client namespace lookups require stable capture across render calls', async t => {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  new TypertRegistry(ctx)
  ctx.provide('connection', {
    rpc: {
      open() { assert.fail('Remote identity inspection must not open a stream') },
      call() { assert.fail('Remote identity inspection must not make an RPC') },
    },
    registerGenerationSource() { return () => {} },
    start() { return { stop() {} } },
  })
  const gateway = await clientPlugin('@deepseek-ai/dsh-api-gateway')
  gateway.apply(ctx)
  await ctx.remote.$mount(await settingsContribution())
  const oldRenderProps = () => ({ settings: ctx.remote.settings })
  assert.notEqual(oldRenderProps().settings, oldRenderProps().settings)
  const settings = ctx.remote.settings
  const stableRenderProps = () => ({ settings })
  assert.equal(stableRenderProps().settings, stableRenderProps().settings)
})

test('provider-only search routing saves both leaves once without a Copilot namespace or model', async t => {
  const { settings, view } = fixture(t)
  const revision = view(ROUTING).revision
  assert.equal(view(COPILOT), undefined)
  await settings.mutate(ROUTING, ops, revision)
  assert.equal(settings.writes.length, 1)
  assert.equal(view(ROUTING).revision, revision + 1)
  assert.equal(view(ROUTING).value.searchProvider, 'auto')
  assert.equal(view(ROUTING).value.defaultSearchProvider, 'github-copilot-hosted')
  assert.equal(view(COPILOT), undefined)
})

test('stale routing revisions fail CAS and preserve the last successful settings', async t => {
  const { settings, view } = fixture(t)
  const held = view(ROUTING).revision
  await settings.mutate(ROUTING, ops, held)
  const saved = view(ROUTING)
  await assert.rejects(settings.mutate(ROUTING, [
    { op: 'set', path: ['defaultSearchProvider'], value: 'none' },
  ], held), { code: 'SETTINGS_CONFLICT', expected: held, actual: saved.revision })
  assert.deepEqual(view(ROUTING), saved)
  assert.equal(settings.writes.length, 1)
})

test('hidden legacy searchModel is writable and accepts an explicit empty reset', async t => {
  const { settings, view } = fixture(t)
  settings.register(COPILOT, Config, { base: {} })
  const serialized = view(COPILOT).schema
  const modelSchema = serialized.refs[serialized.refs[serialized.uid].dict.searchModel]
  assert.equal(modelSchema.meta.hidden, true)
  await settings.mutate(COPILOT, [{ op: 'set', path: ['searchModel'], value: 'synthetic-responses-model' }], 0)
  const set = view(COPILOT)
  assert.equal(set.value.searchModel, 'synthetic-responses-model')
  await settings.mutate(COPILOT, [{ op: 'set', path: ['searchModel'], value: '' }], set.revision)
  assert.equal(view(COPILOT).value.searchModel, '')
  assert.equal(view(COPILOT).revision, set.revision + 1)
})

test('pinned generated Client mutate codecs accept routing ops and a flat namespace revision', async t => {
  const { settings, view } = fixture(t)
  const descriptor = await settingsMutateDescriptor()
  for (const parameter of descriptor.parameters) {
    const value = { ns: ROUTING, ops, expectedRevision: view(ROUTING).revision }[parameter.name]
    assert.equal(parameter.codec.mode, 'strict')
    assert.equal(parameter.codec.schema.safeParse(value).success, true, parameter.name)
  }
  await settings.mutate(ROUTING, ops, view(ROUTING).revision)
  const result = descriptor.result.schema.safeParse(view(ROUTING))
  assert.equal(result.success, true)
  assert.equal(result.data.revision, 1)
  assert.equal(result.data.value.defaultSearchProvider, 'github-copilot-hosted')
  assert.equal(descriptor.result.schema.safeParse({ namespaces: [view(ROUTING)] }).success, false)
})
