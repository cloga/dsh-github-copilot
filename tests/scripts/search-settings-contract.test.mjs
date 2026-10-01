import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { test } from 'node:test'
import * as cordis from '@deepseek-ai/cordis'
import { Context } from '@deepseek-ai/cordis'
import * as dshSettings from '@deepseek-ai/dsh-settings'
import { SettingsConflictError, SettingsForms } from '@deepseek-ai/dsh-settings'
import { TypertRegistry } from '@deepseek-ai/dsh-typert-registry'
import { Config } from '../../lib/types/config.js'
import { WebSearchRoutingConfigSchema } from '../../lib/types/web-search-routing-config.js'

const ROUTING = 'github-copilot-search-routing'
const COPILOT = 'github-copilot'
const ops = [
  { op: 'set', path: ['searchRouting', 'searchProvider'], value: 'auto' },
  { op: 'set', path: ['searchRouting', 'defaultSearchProvider'], value: 'github-copilot-hosted' },
]

// The current Core exposes SettingsForms, not the removed SettingsProvider.
// This isolated state fixture covers routing behavior without a live profile.
class MemorySettings {
  entries = new Map()
  writes = []

  register(ns, schema, { base }) {
    this.entries.set(ns, { schema, value: { ...base }, revision: 0 })
  }

  describe() {
    return [...this.entries].map(([ns, entry]) => ({
      autoGenerate: true,
      ns,
      schema: entry.schema.toJSON(),
      revision: entry.revision,
      applies: 'live',
      value: entry.value,
      secrets: [],
    }))
  }

  async mutate(ns, ops, expectedRevision) {
    const entry = this.entries.get(ns)
    if (entry.revision !== expectedRevision) throw new SettingsConflictError(ns, expectedRevision, entry.revision)
    const value = structuredClone(entry.value)
    for (const { op, path, value: nextValue } of ops) {
      assert.equal(op, 'set')
      let target = value
      for (const key of path.slice(0, -1)) target = target[key] ??= {}
      target[path.at(-1)] = nextValue
    }
    entry.value = value
    entry.revision += 1
    this.writes.push({ ns, value })
  }
}

test('published SettingsForms exposes descriptor/mutation APIs without installSection, and module lacks installSettingsSection', () => {
  for (const method of ['describe', 'update', 'mutate']) {
    assert.equal(typeof SettingsForms.prototype[method], 'function', method)
  }
  assert.equal(typeof SettingsForms.prototype.installSection, 'undefined', 'SettingsForms has no public installSection')
  assert.equal('installSettingsSection' in dshSettings, false, 'dsh-settings has no installSettingsSection export')
})

function fixture(t) {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  const settings = new MemorySettings(ctx)
  settings.register(COPILOT, Config, { base: { searchModel: '', searchRouting: {} } })
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
function codecSchema(codec) {
  return typeof codec.create === 'function' ? codec.create() : codec.schema
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

test('search routing saves both leaves in github-copilot namespace using nested paths', async t => {
  const { settings, view } = fixture(t)
  const revision = view(COPILOT).revision
  await settings.mutate(COPILOT, ops, revision)
  assert.equal(settings.writes.length, 1)
  assert.equal(view(COPILOT).revision, revision + 1)
  assert.equal(view(COPILOT).value.searchRouting.searchProvider, 'auto')
  assert.equal(view(COPILOT).value.searchRouting.defaultSearchProvider, 'github-copilot-hosted')
})

test('stale routing revisions fail CAS and preserve the last successful settings', async t => {
  const { settings, view } = fixture(t)
  const held = view(COPILOT).revision
  await settings.mutate(COPILOT, ops, held)
  const saved = view(COPILOT)
  await assert.rejects(settings.mutate(COPILOT, [
    { op: 'set', path: ['searchRouting', 'defaultSearchProvider'], value: 'none' },
  ], held), { code: 'SETTINGS_CONFLICT', expected: held, actual: saved.revision })
  assert.deepEqual(view(COPILOT), saved)
  assert.equal(settings.writes.length, 1)
})

test('hidden legacy searchModel and searchRouting share namespace revision and coordinate CAS', async t => {
  const { settings, view } = fixture(t)
  const serialized = view(COPILOT).schema
  const modelSchema = serialized.refs[serialized.refs[serialized.uid].dict.searchModel]
  assert.equal(modelSchema.meta.hidden, true)
  
  // Set legacy searchModel
  await settings.mutate(COPILOT, [{ op: 'set', path: ['searchModel'], value: 'synthetic-responses-model' }], 0)
  const set = view(COPILOT)
  assert.equal(set.value.searchModel, 'synthetic-responses-model')
  assert.equal(set.revision, 1)

  // Mutating routing uses updated revision (1 -> 2)
  await settings.mutate(COPILOT, ops, set.revision)
  const routed = view(COPILOT)
  assert.equal(routed.revision, 2)
  assert.equal(routed.value.searchRouting.searchProvider, 'auto')
  assert.equal(routed.value.searchModel, 'synthetic-responses-model')

  // Resetting searchModel uses the coordinated revision (2 -> 3)
  await settings.mutate(COPILOT, [{ op: 'set', path: ['searchModel'], value: '' }], routed.revision)
  assert.equal(view(COPILOT).value.searchModel, '')
  assert.equal(view(COPILOT).revision, 3)
})

test('pinned generated Client mutate codecs accept routing ops and a flat namespace revision', async t => {
  const { settings, view } = fixture(t)
  const descriptor = await settingsMutateDescriptor()
  for (const parameter of descriptor.parameters) {
    const value = { ns: COPILOT, ops, expectedRevision: view(COPILOT).revision }[parameter.name]
    assert.equal(parameter.codec.mode, 'strict')
    assert.equal(codecSchema(parameter.codec).safeParse(value).success, true, parameter.name)
  }
  await settings.mutate(COPILOT, ops, view(COPILOT).revision)
  const schema = codecSchema(descriptor.result)
  const result = schema.safeParse(view(COPILOT))
  assert.equal(result.success, true, JSON.stringify(result.error?.issues))
  assert.equal(result.data.revision, 1)
  assert.equal(result.data.value.searchRouting.defaultSearchProvider, 'github-copilot-hosted')
  assert.equal(schema.safeParse({ namespaces: [view(COPILOT)] }).success, false)
})
