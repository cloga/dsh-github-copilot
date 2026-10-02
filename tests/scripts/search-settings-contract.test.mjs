import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import vm from 'node:vm'
import { test } from 'node:test'
import * as cordis from '@deepseek-ai/cordis'
import { Context } from '@deepseek-ai/cordis'
import * as dshSettings from '@deepseek-ai/dsh-settings'
import { SettingsForms } from '@deepseek-ai/dsh-settings'
import { boot, initProfile, readProfilePatches } from '@deepseek-ai/dsh-app-boot'
import ConfigEditor from '@deepseek-ai/dsh-config-editor'
import { TypertRegistry } from '@deepseek-ai/dsh-typert-registry'
import { Config } from '../../lib/types/config.js'
import copilotRemote from '../../lib/remote.js'

const ROUTING = 'github-copilot-search-routing'
const COPILOT = 'github-copilot'
const ops = [
  { op: 'set', path: ['searchRouting', 'searchProvider'], value: 'auto' },
  { op: 'set', path: ['searchRouting', 'defaultSearchProvider'], value: 'github-copilot-hosted' },
]

test('published SettingsForms exposes descriptor/mutation APIs without installSection, and module lacks installSettingsSection', () => {
  for (const method of ['describe', 'update', 'mutate']) {
    assert.equal(typeof SettingsForms.prototype[method], 'function', method)
  }
  assert.equal(typeof SettingsForms.prototype.installSection, 'undefined', 'SettingsForms has no public installSection')
  assert.equal(typeof SettingsForms.prototype.register, 'undefined', 'forms are projected from Loader Config, not manually registered')
  assert.equal('installSettingsSection' in dshSettings, false, 'dsh-settings has no installSettingsSection export')
})

async function fixture(t) {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'copilot-settings-')))
  const contexts = []
  t.after(async () => {
    try { for (const ctx of contexts.reverse()) await ctx.fiber.dispose() }
    finally { await rm(home, { recursive: true, force: true }) }
  })
  const dir = join(home, 'profiles', 'test')
  initProfile(dir, ['test-bundle'])
  const bundle = join(dir, 'node_modules', 'test-bundle')
  await mkdir(bundle, { recursive: true })
  await writeFile(join(home, 'package.json'), '{"name":"copilot-settings-test"}\n')
  await writeFile(join(bundle, 'package.json'), JSON.stringify({
    name: 'test-bundle', version: '1.0.0', dsh: { bundle: { patch: 'cordis.patch.yml' } },
  }))
  await writeFile(join(bundle, 'cordis.patch.yml'), JSON.stringify([{ insert: [
    { id: 'config-editor', name: 'cordis:editor' },
    { id: 'settings', name: 'cordis:settings' },
    { id: COPILOT, name: 'cordis:copilot', config: { searchModel: '', searchRouting: {}, probe: false } },
  ] }]))
  await writeFile(join(dir, 'cordis.yml'), '[]\n')
  const profile = {
    name: 'test', startedBundles: ['test-bundle'], dir, patchPath: join(dir, 'cordis.patch.yml'),
    installAnchor: join(home, 'package.json'), cwd: home, home, overlays: [], telemetryDisabledEnv: undefined,
  }
  const start = async () => {
    const ctx = await boot('test', join(dir, 'cordis.yml'), readProfilePatches('test', profile), ctx => {
      ctx.provide('profileContext', profile)
      ctx.provide('appReady', { onReady: listener => { listener(); return () => {} } })
      Object.assign(ctx.loader.builtins, {
        editor: ConfigEditor, settings: SettingsForms, copilot: { Config, apply() {} },
      })
    })
    contexts.push(ctx)
    return ctx
  }
  const ctx = await start()
  const settings = ctx.settings
  const view = ns => settings.describe({ redactSecrets: true }).find(entry => entry.ns === ns)
  const fiber = [...ctx.loader.entries()].find(entry => entry.options.id === COPILOT).fiber
  return { ctx, settings, view, fiber, start, profile }
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
  await ctx.remote.$mount(copilotRemote)
  const oldRenderProps = () => ({ settings: ctx.remote.settings })
  assert.notEqual(oldRenderProps().settings, oldRenderProps().settings)
  const settings = ctx.remote.settings
  const stableRenderProps = () => ({ settings })
  assert.equal(stableRenderProps().settings, stableRenderProps().settings)
  const oldAccountProps = () => ({ remote: ctx.remote.githubCopilot })
  assert.notEqual(oldAccountProps().remote, oldAccountProps().remote)
  const remote = ctx.remote.githubCopilot
  const stableAccountProps = () => ({ remote })
  assert.equal(stableAccountProps().remote, stableAccountProps().remote)
})

test('search routing saves both leaves in github-copilot namespace using nested paths', async t => {
  const { settings, view, fiber } = await fixture(t)
  assert.ok(view(COPILOT), 'native SettingsForms must discover the plugin Config without register()')
  const revision = view(COPILOT).revision
  await settings.mutate(COPILOT, ops, revision)
  assert.equal(view(COPILOT).revision, revision + 1)
  assert.equal(view(COPILOT).value.searchRouting.searchProvider, 'auto')
  assert.equal(view(COPILOT).value.searchRouting.defaultSearchProvider, 'github-copilot-hosted')
  assert.equal(fiber.config.searchRouting.get().defaultSearchProvider, 'github-copilot-hosted')
  assert.equal(fiber.config.probe, false)
})

test('stale routing revisions fail CAS and preserve the last successful settings', async t => {
  const { settings, view } = await fixture(t)
  const held = view(COPILOT).revision
  await settings.mutate(COPILOT, ops, held)
  const saved = view(COPILOT)
  await assert.rejects(settings.mutate(COPILOT, [
    { op: 'set', path: ['searchRouting', 'defaultSearchProvider'], value: 'none' },
  ], held), { code: 'SETTINGS_CONFLICT', expected: held, actual: saved.revision })
  assert.deepEqual(view(COPILOT).value, saved.value)
  assert.deepEqual(view(COPILOT).user, saved.user)
  assert.equal(view(COPILOT).revision, saved.revision)
})

test('hidden legacy searchModel and searchRouting share namespace revision and coordinate CAS', async t => {
  const { settings, view } = await fixture(t)
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
  const { settings, view } = await fixture(t)
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

test('native routing edits preserve ordinary config, reject invalid paths and persist across restart', async t => {
  const { ctx, settings, view, fiber, start, profile } = await fixture(t)
  const initial = view(COPILOT)
  assert.ok(initial)
  assert.equal(initial.value.probe, undefined, 'ordinary safety fields are not live form fields')
  await assert.rejects(settings.mutate(COPILOT, [
    { op: 'set', path: ['probe'], value: true },
  ], initial.revision), /not volatile/)
  await assert.rejects(settings.mutate(COPILOT, [
    { op: 'set', path: ['searchRouting', 'searchProvider'], value: 123 },
  ], initial.revision))
  assert.deepEqual(view(COPILOT).value, initial.value)
  assert.deepEqual(view(COPILOT).user, initial.user)
  assert.equal(view(COPILOT).revision, initial.revision)
  await settings.mutate(COPILOT, ops, initial.revision)
  assert.equal([...ctx.loader.entries()].find(entry => entry.options.id === COPILOT).fiber, fiber)
  const saved = await readFile(profile.patchPath, 'utf8')
  assert.match(saved, /github-copilot-hosted/)
  await ctx.fiber.dispose()
  const restarted = await start()
  const restored = restarted.settings.describe().find(entry => entry.ns === COPILOT)
  assert.equal(restored.value.searchRouting.defaultSearchProvider, 'github-copilot-hosted')
  const restoredFiber = [...restarted.loader.entries()].find(entry => entry.options.id === COPILOT).fiber
  assert.equal(restoredFiber.config.probe, false)
})

test('native hidden model exclusions are live, revision checked and persistent without replacing the plugin fiber', async t => {
  const { ctx, settings, view, fiber, start } = await fixture(t)
  const initial = view(COPILOT)
  assert.deepEqual(initial.value.excludedModelIds, [])
  const serialized = initial.schema
  assert.equal(serialized.refs[serialized.refs[serialized.uid].dict.excludedModelIds].meta.hidden, true)
  await settings.mutate(COPILOT, [
    { op: 'set', path: ['excludedModelIds'], value: ['synthetic-model', 'absent-model'] },
  ], initial.revision)
  assert.deepEqual(view(COPILOT).value.excludedModelIds, ['synthetic-model', 'absent-model'])
  assert.equal([...ctx.loader.entries()].find(entry => entry.options.id === COPILOT).fiber, fiber)
  assert.deepEqual(fiber.config.excludedModelIds.get(), ['synthetic-model', 'absent-model'])
  await assert.rejects(settings.mutate(COPILOT, [
    { op: 'set', path: ['excludedModelIds'], value: [] },
  ], initial.revision), { code: 'SETTINGS_CONFLICT' })
  await ctx.fiber.dispose()
  const restarted = await start()
  const restored = restarted.settings.describe().find(entry => entry.ns === COPILOT)
  assert.deepEqual(restored.value.excludedModelIds, ['synthetic-model', 'absent-model'])
  await restarted.settings.mutate(COPILOT, [
    { op: 'set', path: ['excludedModelIds'], value: [] },
  ], restored.revision)
  assert.deepEqual(restarted.settings.describe().find(entry => entry.ns === COPILOT).value.excludedModelIds, [])
})
