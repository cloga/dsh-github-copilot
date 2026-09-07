import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { prepareTaggedCoreFixture, TAGGED_CORE_RELEASES } from '../../scripts/verify-tagged-core.mjs'

const release = '0.1.3-alpha.1'
async function fixture() {
  const base = await realpath(await mkdtemp(join(await realpath(tmpdir()), 'copilot-tagged-test-')))
  const root = join(base, 'plugin')
  const core = join(base, 'core')
  const target = join(base, 'scratch')
  await mkdir(join(root, 'tests'), { recursive: true })
  await mkdir(core)
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'dsh-github-copilot', dependencies: { '@earendil-works/pi-ai': '0.85.1' } }))
  await writeFile(join(root, 'tests/preview-route.spec.ts'), 'export {}')
  await writeFile(join(root, 'tests/published-core.spec.ts'), 'export {}')
  await writeFile(join(root, 'tests/single-route.spec.ts'), 'export {}')
  const runner = join(root, 'fake-vitest.mjs')
  await writeFile(runner, 'throw new Error("must not execute during prepare")')
  const tracked = []
  async function source(path, text) {
    await mkdir(join(core, path, '..'), { recursive: true })
    await writeFile(join(core, path), text)
    tracked.push(path)
  }
  await source('vitest.shared.ts', 'export function standardDecoratorPlugin() { return { name: "fixture-decorators" } }\nexport const vitestExecArgv = []\n')
  for (const [dir, name, version] of [
    ['packages/llm/llm', '@deepseek-ai/dsh-llm', release],
    ['packages/llm/llm-pi-ai', '@deepseek-ai/dsh-llm-pi-ai', release],
    ['packages/attachment/attachment', '@deepseek-ai/dsh-attachment', release],
    ['vendor/cordis', '@deepseek-ai/cordis', '4.0.2'],
    ['vendor/cosmokit', '@deepseek-ai/cosmokit', '1.8.3'],
  ]) {
    await source(`${dir}/package.json`, JSON.stringify({ name, version, type: 'module', exports: {
      '.': { types: './lib/types/index.d.ts', default: './lib/index.js' },
      './package.json': './package.json', './src/*': './src/*',
    } }))
    await source(`${dir}/src/index.ts`, 'export const untouched = true\n')
  }
  const commands = []
  const git = (_cwd, args) => {
    commands.push(args)
    if (args[0] === 'rev-parse') return `${TAGGED_CORE_RELEASES[release]}\n`
    if (args[0] === 'status') return ''
    if (args[0] === 'ls-files') return `${tracked.join('\0')}\0`
    throw new Error('unexpected git write')
  }
  return { base, root, core, target, release, runner, git, tracked, commands }
}
async function withFixture(run) {
  const value = await fixture()
  try { await run(value) } finally { await rm(value.base, { recursive: true, force: true }) }
}

test('prepares isolated tagged runtime config with exact source identities and no install or build', async () => withFixture(async value => {
  const before = await Promise.all(value.tracked.map(path => readFile(join(value.core, path), 'utf8')))
  const report = await prepareTaggedCoreFixture(value, value)
  assert.equal(report.kind, 'tagged-source-runtime')
  assert.equal(report.coreRoot, value.core)
  assert.equal(report.release, release)
  assert.equal(report.commit, TAGGED_CORE_RELEASES[release])
  assert.ok(Array.isArray(report.packages))
  assert.ok(report.packages.every(item => typeof item.name === 'string' && item.entry.startsWith(value.core) && item.manifestPath.startsWith(value.core)))
  assert.deepEqual((await readdir(value.target)).sort(), ['identity.ts', 'tagged-core-fixture.json', 'vitest.config.mts'])
  assert.deepEqual(report.executed, { install: false, build: false, tests: false })
  assert.deepEqual(report.runner.args, [value.runner, 'run', '--config', report.configPath])
  assert.ok(value.commands.every(args => ['rev-parse', 'status', 'ls-files'].includes(args[0])))
  assert.deepEqual(await Promise.all(value.tracked.map(path => readFile(join(value.core, path), 'utf8'))), before)
  const identity = await readFile(report.identityModule, 'utf8')
  assert.match(identity, /export \{ Context, LlmRuntime, PiAiAdapter \}/)
  assert.match(identity, /TAGGED_CORE_CLASS_IDENTITY_MISMATCH/)
  assert.match(identity, /export const attachmentEntry/)
  assert.ok(identity.includes(value.core.replaceAll('\\', '/')))
}))

test('generated config selects actual tests and scopes vendor aliases to Core source only', async () => withFixture(async value => {
  const report = await prepareTaggedCoreFixture(value, value)
  const config = (await import(pathToFileURL(report.configPath).href)).default
  assert.equal(config.root, value.root)
  assert.equal(config.envDir, value.target)
  assert.ok(config.cacheDir.startsWith(value.target))
  assert.deepEqual(config.test.include, ['tests/preview-route.spec.ts', 'tests/published-core.spec.ts', 'tests/single-route.spec.ts'])
  assert.equal(config.test.env.DSH_CORE_EVIDENCE, 'tagged-source-runtime')
  assert.equal(config.test.env.DSH_TAGGED_CORE_MANIFEST, report.manifestPath)
  assert.equal(config.test.env.DSH_PUBLISHED_CORE_RELEASE, release)
  const llm = config.resolve.alias.find(alias => alias.find.test('@deepseek-ai/dsh-llm'))
  assert.equal(llm.replacement, join(value.core, 'packages/llm/llm/src/index.ts'))
  assert.equal(llm.find.test('@deepseek-ai/dsh-llm-pi-ai'), false)
  assert.equal(config.resolve.alias.some(alias => alias.find.test('@earendil-works/pi-ai')), false)
  assert.equal(config.resolve.alias.some(alias => alias.find.test('@deepseek-ai/cosmokit')), false)
  const guard = config.plugins.find(plugin => plugin.name === 'tagged-core-public-import-guard')
  const vendor = '@deepseek-ai/cosmokit'
  assert.equal(guard.resolveId(vendor, join(value.core, 'vendor/cordis/src/index.ts')), join(value.core, 'vendor/cosmokit/src/index.ts'))
  assert.equal(guard.resolveId(vendor, join(value.root, 'src/index.ts')), null)
  assert.equal(guard.resolveId(vendor, join(value.core, 'node_modules/pi-ai/index.js')), null)
  assert.equal(guard.resolveId('@earendil-works/pi-ai', join(value.core, 'packages/llm/llm-pi-ai/src/index.ts')), null)
  assert.throws(() => guard.resolveId('@deepseek-ai/dsh-unmapped', join(value.root, 'src/index.ts')), /PUBLIC_EXPORT_UNMAPPED/)
}))

test('maps import-condition mjs vendor exports without aliasing the plugin vendor copy', async () => withFixture(async value => {
  const dir = join(value.core, 'vendor/schemastery')
  await mkdir(join(dir, 'src'), { recursive: true })
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: '@deepseek-ai/schemastery', version: '3.18.2', type: 'module', exports: {
    '.': { types: './lib/types/index.d.ts', import: './lib/index.mjs', require: './lib/index.cjs' },
  } }))
  await writeFile(join(dir, 'src/index.ts'), 'export const schema = true\n')
  value.tracked.push('vendor/schemastery/package.json', 'vendor/schemastery/src/index.ts')
  const report = await prepareTaggedCoreFixture(value, value)
  assert.ok(report.vendors.some(item => item.name === '@deepseek-ai/schemastery' && item.entry === join(dir, 'src/index.ts')))
  const config = (await import(pathToFileURL(report.configPath).href)).default
  const resolver = config.plugins.find(item => item.name === 'tagged-core-public-import-guard')
  assert.equal(resolver.resolveId('@deepseek-ai/schemastery', join(value.core, 'packages/llm/llm/src/retry-policy.ts')), join(dir, 'src/index.ts'))
  assert.equal(resolver.resolveId('@deepseek-ai/schemastery', join(value.root, 'src/config.ts')), null)
}))

test('rejects unknown or mismatched release pins before creating scratch', async () => withFixture(async value => {
  await assert.rejects(prepareTaggedCoreFixture({ ...value, release: 'latest' }, value), /unsupported/)
  const git = (_core, args) => args[0] === 'rev-parse' ? 'bad-sha' : ''
  await assert.rejects(prepareTaggedCoreFixture(value, { ...value, git }), /exact release pin/)
  assert.deepEqual((await readdir(value.base)).sort(), ['core', 'plugin'])
}))

test('rejects dirty tracked Core without changing or cleaning it', async () => withFixture(async value => {
  const git = (core, args) => args[0] === 'status' ? ' M packages/llm/llm/src/index.ts' : value.git(core, args)
  await assert.rejects(prepareTaggedCoreFixture(value, { ...value, git }), /must be clean/)
  assert.deepEqual((await readdir(value.base)).sort(), ['core', 'plugin'])
}))

test('refuses existing targets and overlap with either input tree', async () => withFixture(async value => {
  await mkdir(value.target)
  await writeFile(join(value.target, 'sentinel'), 'preserve')
  await assert.rejects(prepareTaggedCoreFixture(value, value), /already exists/)
  assert.equal(await readFile(join(value.target, 'sentinel'), 'utf8'), 'preserve')
  for (const target of [join(value.core, 'tmp'), join(value.root, 'tmp'), value.base]) {
    await assert.rejects(prepareTaggedCoreFixture({ ...value, target }, value), /outside both/)
  }
}))

test('refuses linked scratch parents without writing through them', async () => withFixture(async value => {
  const real = join(value.base, 'real')
  const link = join(value.base, 'link')
  await mkdir(real)
  await symlink(real, link, process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(prepareTaggedCoreFixture({ ...value, target: join(link, 'scratch') }, value), /linked|nonphysical/)
  assert.deepEqual(await readdir(real), [])
}))

test('does not use untracked source entries or manifests as release evidence', async () => withFixture(async value => {
  const missing = 'packages/llm/llm-pi-ai/src/index.ts'
  const git = (core, args) => args[0] === 'ls-files' ? value.tracked.filter(path => path !== missing).join('\0') : value.git(core, args)
  await assert.rejects(prepareTaggedCoreFixture(value, { ...value, git }), /lacks required public entry/)
  assert.equal(await readFile(join(value.core, missing), 'utf8'), 'export const untouched = true\n')
}))
