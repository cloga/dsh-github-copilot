import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { preparePublishedCoreFixture, inspectPublishedCoreFixture } from '../../scripts/verify-published-core.mjs'

const release = '0.1.3-alpha.1'
async function sourceFixture() {
  const base = await mkdtemp(join(tmpdir(), 'copilot-published-core-'))
  const root = join(base, 'source')
  await mkdir(join(root, 'src'), { recursive: true })
  await mkdir(join(root, 'tests'), { recursive: true })
  const manifest = { name: 'dsh-github-copilot', version: '0.3.1-alpha.2', type: 'module', private: true,
    scripts: { prepare: 'must-not-execute', preinstall: 'must-not-execute', test: 'must-not-execute' },
    dependencies: { '@earendil-works/pi-ai': '0.85.1', '@deepseek-ai/dsh-authorization': '0.1.2-rc.1', zod: '^4.4.3' },
    devDependencies: { '@deepseek-ai/dsh-llm': '0.1.2-rc.1', '@deepseek-ai/dsh-llm-pi-ai': '0.1.2-rc.1', '@deepseek-ai/cordis': '^4.0.2', vitest: '^3.2.0' },
    peerDependencies: { '@deepseek-ai/dsh-llm': '0.1.2-rc.1 || 0.1.3-alpha.1', react: '^18.2.0' },
    optionalDependencies: { '@deepseek-ai/dsh-fs': '0.1.2-rc.1' },
    pnpm: { overrides: { '@earendil-works/pi-ai': 'must-not-inherit' } }, overrides: { anything: 'must-not-inherit' } }
  await writeFile(join(root, 'package.json'), JSON.stringify(manifest))
  await writeFile(join(root, 'src/index.ts'), 'export const fixture = true\n')
  await writeFile(join(root, 'tests/example.spec.ts'), 'export {}\n')
  await writeFile(join(root, 'tsconfig.json'), '{"include":["src"]}\n')
  await writeFile(join(root, 'README.md'), 'fixture documentation\n')
  for (const name of ['.env', '.env.local', '.npmrc', 'pnpm-lock.yaml']) await writeFile(join(root, name), 'DO-NOT-COPY')
  for (const name of ['node_modules', 'lib', 'artifacts', '.git']) {
    await mkdir(join(root, name))
    await writeFile(join(root, name, 'sentinel.ts'), 'DO-NOT-COPY')
  }
  await writeFile(join(root, 'src/.env'), 'PRIVATE')
  await writeFile(join(root, 'src/credentials.json'), '{"secret":"PRIVATE"}')
  await writeFile(join(root, 'src/private.pem'), 'PRIVATE')
  return { base, root, target: join(base, 'fixture'), manifest }
}
async function withSource(run) {
  const fixture = await sourceFixture()
  try { await run(fixture) } finally { await rm(fixture.base, { recursive: true, force: true }) }
}

test('prepares only plugin inputs and exact Core requirements without executing or copying secrets', async () => withSource(async ({ root, target, manifest }) => {
  const original = await readFile(join(root, 'package.json'), 'utf8')
  const report = await preparePublishedCoreFixture({ root, target, release })
  const output = JSON.parse(await readFile(join(target, 'package.json'), 'utf8'))
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const [name, version] of Object.entries(manifest[section])) {
      assert.equal(output[section][name], name.startsWith('@deepseek-ai/dsh-') ? release : version)
    }
  }
  assert.equal(output.dependencies['@earendil-works/pi-ai'], '0.85.1')
  assert.deepEqual(output.scripts, {})
  assert.equal(output.pnpm, undefined)
  assert.equal(output.overrides, undefined)
  assert.deepEqual((await readdir(target)).sort(), ['README.md', 'package.json', 'published-core-fixture.json', 'src', 'tests', 'tsconfig.json'])
  assert.deepEqual(await readdir(join(target, 'src')), ['index.ts'])
  assert.equal(await readFile(join(root, 'package.json'), 'utf8'), original)
  assert.equal(await readFile(join(root, '.env'), 'utf8'), 'DO-NOT-COPY')
  assert.deepEqual(report.executed, { install: false, build: false, tests: false })
}))

test('refuses an unknown release before creating any target', async () => withSource(async ({ root, target, base }) => {
  await assert.rejects(preparePublishedCoreFixture({ root, target, release: 'latest' }), /unsupported published Core/)
  assert.deepEqual(await readdir(base), ['source'])
}))

test('refuses an existing target and preserves its sentinel', async () => withSource(async ({ root, target }) => {
  await mkdir(target)
  await writeFile(join(target, 'sentinel'), 'preserve')
  await assert.rejects(preparePublishedCoreFixture({ root, target, release }), /already exists/)
  assert.equal(await readFile(join(target, 'sentinel'), 'utf8'), 'preserve')
}))

test('refuses source overlap and a Core checkout used as plugin input', async () => withSource(async ({ root, target }) => {
  await assert.rejects(preparePublishedCoreFixture({ root, target: join(root, 'fixture'), release }), /separate/)
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', dependencies: { '@earendil-works/pi-ai': '0.85.1' } }))
  await assert.rejects(preparePublishedCoreFixture({ root, target, release }), /requires this plugin/)
}))

test('refuses a linked destination parent without writing to its referent', async () => withSource(async ({ root, base }) => {
  const actual = join(base, 'actual')
  const link = join(base, 'linked')
  await mkdir(actual)
  await symlink(actual, link, process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(preparePublishedCoreFixture({ root, target: join(link, 'fixture'), release }), /symlink|nonphysical/)
  assert.deepEqual(await readdir(actual), [])
}))

test('refuses linked source trees before target creation', async () => withSource(async ({ root, base, target }) => {
  const outside = join(base, 'outside')
  await mkdir(outside)
  await writeFile(join(outside, 'secret.ts'), 'PRIVATE')
  await symlink(outside, join(root, 'src/linked'), process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(preparePublishedCoreFixture({ root, target, release }), /linked source/)
  await assert.rejects(readFile(join(target, 'package.json')), { code: 'ENOENT' })
  assert.equal(await readFile(join(outside, 'secret.ts'), 'utf8'), 'PRIVATE')
}))

async function mockPackage(root, name, version, source = 'export {}', directory = 'node_modules') {
  const dir = join(root, directory, name)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name, version, type: 'module', exports: { '.': { import: './index.js', default: './index.js' } } }))
  await writeFile(join(dir, 'index.js'), source)
  return dir
}
async function installedFixture(root) {
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  const names = new Set(['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']
    .flatMap(section => Object.keys(pkg[section] ?? {}).filter(name => name.startsWith('@deepseek-ai/dsh-'))))
  for (const name of names) await mockPackage(root, name, release)
  await mockPackage(root, '@deepseek-ai/cordis', '4.0.2', 'export class Context {}')
  await mockPackage(root, '@deepseek-ai/dsh-llm', release, 'export class LlmAdapter {}; export default class LlmRuntime {}')
  await mockPackage(root, '@deepseek-ai/dsh-llm-pi-ai', release,
    'import {LlmAdapter} from "@deepseek-ai/dsh-llm"; export class PiAiAdapter extends LlmAdapter {prepareCall(){}}; export function Config(){}')
  await mockPackage(root, '@earendil-works/pi-ai', '0.85.1')
}

test('inspects real public class identity and paths without claiming route execution', async () => withSource(async ({ root, target }) => {
  await preparePublishedCoreFixture({ root, target, release })
  await installedFixture(target)
  const report = await inspectPublishedCoreFixture({ root: target, release })
  assert.equal(report.classIdentity, true)
  assert.equal(report.release, release)
  assert.equal(report.ownPi.version, '0.85.1')
  assert.ok(report.packages.every(entry => entry.entry.startsWith(target)))
  assert.deepEqual(report.executed, { apply: false, modelRequests: false, compatibilityTests: false })
}))

test('rejects another Cordis copy even when its version matches', async () => withSource(async ({ root, target }) => {
  await preparePublishedCoreFixture({ root, target, release })
  await installedFixture(target)
  await mockPackage(join(target, 'node_modules/@deepseek-ai/dsh-llm-pi-ai'), '@deepseek-ai/cordis', '4.0.2', 'export class Context {}')
  await assert.rejects(inspectPublishedCoreFixture({ root: target, release }), /multiple Cordis/)
}))

test('rejects an installed artifact with a different release before importing classes', async () => withSource(async ({ root, target }) => {
  await preparePublishedCoreFixture({ root, target, release })
  await installedFixture(target)
  await mockPackage(target, '@deepseek-ai/dsh-llm', '0.1.2-rc.1', 'throw new Error("must not import wrong version")')
  await assert.rejects(inspectPublishedCoreFixture({ root: target, release }), /artifact version differs/)
}))

test('rejects a package symlink escaping the isolated dependency closure', async () => withSource(async ({ root, target, base }) => {
  await preparePublishedCoreFixture({ root, target, release })
  await installedFixture(target)
  const outside = join(base, 'outside-dependencies')
  const packagePath = await mockPackage(outside, '@deepseek-ai/dsh-fs', release)
  const installed = join(target, 'node_modules/@deepseek-ai/dsh-fs')
  await rm(installed, { recursive: true })
  await symlink(packagePath, installed, process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(inspectPublishedCoreFixture({ root: target, release }), /outside its isolated closure/)
}))

test('rejects a public adapter whose class is not the selected LlmAdapter', async () => withSource(async ({ root, target }) => {
  await preparePublishedCoreFixture({ root, target, release })
  await installedFixture(target)
  await writeFile(join(target, 'node_modules/@deepseek-ai/dsh-llm-pi-ai/index.js'), 'export class PiAiAdapter {prepareCall(){}}; export function Config(){}')
  await assert.rejects(inspectPublishedCoreFixture({ root: target, release }), /public class identity/)
}))
