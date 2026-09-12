import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { composeEntries, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { checkSearchComposition, inspectProfileSearchComposition } from '../../scripts/check-search-composition.mjs'

const stock = () => ({ id: 'web', name: '@deepseek-ai/dsh-web', config: { searchProvider: 'existing', fetchProvider: 'http' } })

test('admits a stock top-level official service without mutating or exposing its config', () => {
  const entries = [stock(), { id: 'tool-web', name: '@deepseek-ai/dsh-tool-web', disabled: true }, { id: 'private-config', config: { secretSentinel: 'never-print-me' } }]
  const before = JSON.stringify(entries)
  const report = checkSearchComposition(entries)
  assert.equal(report.supported, true)
  assert.deepEqual(report.reasons, [])
  assert.equal(JSON.stringify(entries), before)
  assert.ok(!JSON.stringify(report).includes('never-print-me'))
})

for (const [label, entries, code] of [
  ['missing', [], 'WEB_ROW_MISSING'],
  ['duplicate', [stock(), stock()], 'MULTIPLE_WEB_ROWS'],
  ['custom service', [{ ...stock(), name: 'custom-web' }], 'CUSTOM_WEB_SERVICE'],
  ['disabled', [{ ...stock(), disabled: true }], 'WEB_DISABLED_OR_DYNAMIC'],
  ['dynamic disabled', [{ ...stock(), disabled: { __js: 'never execute this' } }], 'WEB_DISABLED_OR_DYNAMIC'],
  ['dynamic web config', [{ ...stock(), config: { __js: 'never execute this' } }], 'WEB_CONFIG_REQUIRES_REVIEW'],
  ['dynamic selection', [{ ...stock(), config: { searchProvider: { __js: 'never execute' } } }], 'WEB_CONFIG_REQUIRES_REVIEW'],
  ['named realm', [{ ...stock(), isolate: { web: 'existing' } }], 'PREEXISTING_WEB_ISOLATION'],
  ['private realm', [{ ...stock(), isolate: { web: true } }], 'PREEXISTING_WEB_ISOLATION'],
  ['unrelated isolate key', [{ ...stock(), isolate: { credentials: 'private' } }], 'PREEXISTING_WEB_ISOLATION'],
  ['nested stock row', [{ id: 'group', group: true, config: [stock()] }], 'WEB_NOT_TOP_LEVEL'],
  ['additional official service', [stock(), { id: 'second-web', name: '@deepseek-ai/dsh-web' }], 'ADDITIONAL_OFFICIAL_WEB_SERVICE'],
  ['reserved entry', [stock(), { id: 'github-copilot-routed-web', name: 'anything' }], 'ROUTING_ENTRY_CONFLICT'],
  ['reserved realm', [stock(), { id: 'consumer', isolate: { web: 'github-copilot-original-web' } }], 'ROUTING_REALM_CONFLICT'],
  ['dynamic realm', [stock(), { id: 'consumer', isolate: { web: { __js: 'never execute' } } }], 'UNKNOWN_ISOLATION'],
  ['dynamic group', [stock(), { id: 'container', group: { __js: 'never execute' }, config: [] }], 'UNKNOWN_GROUP'],
  ['web marked as group', [{ ...stock(), group: true }], 'WEB_ENTRY_REQUIRES_REVIEW'],
  ['web extra dependency', [{ ...stock(), inject: ['never-provided'] }], 'WEB_ENTRY_REQUIRES_REVIEW'],
  ['web intercept', [{ ...stock(), intercept: { web: 'custom' } }], 'WEB_ENTRY_REQUIRES_REVIEW'],
]) {
  test(`rejects ${label} before routing overlay installation`, () => {
    const before = JSON.stringify(entries)
    const report = checkSearchComposition(entries)
    assert.equal(report.supported, false)
    assert.ok(report.reasons.includes(code))
    assert.equal(JSON.stringify(entries), before)
  })
}

const candidatePath = fileURLToPath(new URL('../../cordis.patch.yml', import.meta.url))
const candidate = () => loadOverlayPatches('test', candidatePath)

function nativeReaders({ user = [], home = [], extra = [], own = true, root = [], base = [stock()], bundles } = {}) {
  const calls = []
  const api = {
    readProfileManifest(_bin, directory) {
      calls.push(['manifest', directory])
      if (directory === '/profile') return { dsh: { profile: { bundles: bundles ?? (own ? ['base', 'dsh-github-copilot'] : ['base']) } } }
      if (directory === '/bundles/base') return { name: 'base', dsh: { bundle: { patch: 'base.yml' } } }
      if (directory === '/bundles/dsh-github-copilot') return { name: 'dsh-github-copilot', dsh: { bundle: { patch: 'owned.yml' } } }
      throw new Error('unexpected manifest read')
    },
    resolveBundleDir(_bin, name) { return `/bundles/${name}` },
    loadOptionalPatches(_bin, file) {
      const normalized = file.replaceAll('\\', '/')
      if (normalized.endsWith('/profile/cordis.yml')) return root
      if (normalized.endsWith('/profile/cordis.patch.yml')) return user
      if (normalized.endsWith('/home/cordis.patch.yml')) return home
      throw new Error('unexpected optional read')
    },
    loadOverlayPatches(_bin, file) {
      const normalized = file.replaceAll('\\', '/')
      if (file === candidatePath) return candidate()
      if (normalized.endsWith('/bundles/base/base.yml')) return [{ insert: base }]
      if (normalized.endsWith('/extra.yml')) return extra
      throw new Error('must not read owned routing overlay or arbitrary input')
    },
    composeEntries,
  }
  return { api, calls }
}
const options = { profileDir: '/profile', home: '/home', installAnchor: '/installation/package.json' }

test('uses public read-only readers and replaces the existing owned layer with the candidate for an update', async () => {
  const { api } = nativeReaders({ user: [{ id: 'github-copilot', config: { searchFallback: 'none' } }] })
  const result = await inspectProfileSearchComposition(options, api)
  assert.equal(result.supported, true)
  assert.deepEqual(result.reasons, [])
})

test('includes home and launcher layers instead of ignoring a late web override', async () => {
  const { api } = nativeReaders({ home: [{ id: 'web', isolate: { credentials: 'custom' } }] })
  assert.ok((await inspectProfileSearchComposition(options, api)).reasons.includes('PREEXISTING_WEB_ISOLATION'))
  const withExtra = nativeReaders({ extra: [{ id: 'web', disabled: true }] })
  assert.ok((await inspectProfileSearchComposition({ ...options, patches: ['/extra.yml'] }, withExtra.api)).reasons.includes('WEB_DISABLED_OR_DYNAMIC'))
})

test('unapplied patches require review rather than a false supported claim', async () => {
  const { api } = nativeReaders({ user: [{ id: 'missing-row', config: { secret: 'never-print-me' } }] })
  const result = await inspectProfileSearchComposition(options, api)
  assert.equal(result.supported, false)
  assert.ok(result.reasons.includes('UNAPPLIED_PATCH_REQUIRES_REVIEW'))
  assert.ok(!JSON.stringify(result).includes('never-print-me'))
})

test('supports first install without requiring the Copilot package to be present already', async () => {
  const { api } = nativeReaders({ own: false })
  assert.equal((await inspectProfileSearchComposition(options, api)).supported, true)
})

for (const layer of ['user', 'home', 'extra']) {
  test(`rejects ${layer} resetting the candidate web realm to an empty map`, async () => {
    const reset = [{ id: 'web', isolate: {} }]
    const actual = composeEntries([[{ insert: [stock()] }], candidate(), reset])
    assert.deepEqual(actual.find(row => row.id === 'web').isolate, {})
    const { api } = nativeReaders({ [layer]: reset })
    const result = await inspectProfileSearchComposition({ ...options, patches: ['/extra.yml'] }, api)
    assert.equal(result.supported, false)
    assert.ok(result.reasons.includes('CANDIDATE_ROUTING_NOT_VIABLE'))
  })

  test(`rejects web first inserted by the late ${layer} layer`, async () => {
    const { api } = nativeReaders({ base: [], [layer]: [{ insert: [stock()] }] })
    assert.equal((await inspectProfileSearchComposition({ ...options, patches: ['/extra.yml'] }, api)).supported, false)
  })
}

test('rejects a web bundle ordered after the Copilot guard', async () => {
  const { api } = nativeReaders({ bundles: ['dsh-github-copilot', 'base'] })
  assert.equal((await inspectProfileSearchComposition(options, api)).supported, false)
})

test('rejects duplicate Copilot layers and ambiguous account entries', async () => {
  for (const fixture of [
    { bundles: ['base', 'dsh-github-copilot', 'dsh-github-copilot'] },
    { base: [stock(), { id: 'github-copilot', name: 'custom-account' }] },
    { base: [stock(), { id: 'alias-account', name: 'dsh-github-copilot' }] },
    { base: [stock(), { id: 'group', group: true, config: [{ id: 'github-copilot', name: 'dsh-github-copilot' }] }] },
  ]) {
    const { api } = nativeReaders(fixture)
    const result = await inspectProfileSearchComposition(options, api)
    assert.equal(result.supported, false)
    assert.ok(result.reasons.includes('DUPLICATE_COPILOT_ACCOUNT_ENTRY'))
  }
})

test('rejects late changes that disable or isolate the candidate bridge, facade or account', async () => {
  const invalid = ['github-copilot-web-delegate', 'github-copilot-routed-web', 'github-copilot'].flatMap(id => [
    { id, disabled: true },
    { id, isolate: { githubCopilotOriginalWeb: 'private' } },
    { id, group: true, config: [] },
    { id, inject: ['never-provided'] },
  ])
  invalid.push({ id: 'github-copilot-web-delegate', isolate: {} })
  invalid.push({ id: 'github-copilot', config: { __jsExpr: 'never execute' } })
  for (const patch of invalid) {
    const { api } = nativeReaders({ user: [patch] })
    assert.equal((await inspectProfileSearchComposition(options, api)).supported, false)
  }
})

test('preserves supported stock provider overrides and does not mutate parsed inputs', async () => {
  const user = [{ id: 'web', config: { searchProvider: 'my-search', fetchProvider: 'my-fetch' } },
    { id: 'github-copilot', config: { searchFallback: 'none' } }]
  const before = JSON.stringify(user)
  const { api } = nativeReaders({ user })
  const result = await inspectProfileSearchComposition(options, api)
  assert.equal(result.supported, true)
  assert.equal(JSON.stringify(user), before)
  const actual = composeEntries([[{ insert: [stock()] }], candidate(), user])
  assert.deepEqual(actual.find(row => row.id === 'web').config, user[0].config)
  assert.deepEqual(actual.find(row => row.id === 'web').isolate, { web: 'github-copilot-original-web' })
})

test('real public parsers validate candidate layers and preserve every input file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'copilot-preflight-layers-'))
  try {
    const profileDir = join(root, 'profiles/test')
    const baseDir = join(profileDir, 'node_modules/preflight-stock')
    await mkdir(baseDir, { recursive: true })
    const files = new Map([
      [join(profileDir, 'package.json'), JSON.stringify({ name: 'test-profile', dsh: { profile: { bundles: ['preflight-stock'] } } })],
      [join(baseDir, 'package.json'), JSON.stringify({ name: 'preflight-stock', dsh: { bundle: { patch: 'cordis.patch.yml' } } })],
      [join(baseDir, 'cordis.patch.yml'), JSON.stringify([{ insert: [stock()] }])],
      [join(profileDir, 'cordis.yml'), '[]\n'],
      [join(profileDir, 'cordis.patch.yml'), '[]\n'],
      [join(root, 'cordis.patch.yml'), '[]\n'],
      [join(root, 'launcher.yml'), '[]\n'],
    ])
    for (const [file, content] of files) await writeFile(file, content)
    const input = { profileDir, home: root, installAnchor: fileURLToPath(new URL('../../package.json', import.meta.url)), patches: [join(root, 'launcher.yml')] }
    assert.equal((await inspectProfileSearchComposition(input)).supported, true)
    for (const file of [join(profileDir, 'cordis.patch.yml'), join(root, 'cordis.patch.yml'), join(root, 'launcher.yml')]) {
      const content = '- id: web\n  isolate: {}\n'
      await writeFile(file, content)
      assert.equal((await inspectProfileSearchComposition(input)).supported, false)
      assert.equal(await readFile(file, 'utf8'), content)
      await writeFile(file, files.get(file))
    }
    for (const [file, content] of files) assert.equal(await readFile(file, 'utf8'), content)
    assert.deepEqual((await readdir(profileDir)).sort(), ['cordis.patch.yml', 'cordis.yml', 'node_modules', 'package.json'])
    await rm(join(profileDir, 'cordis.yml'))
    assert.equal((await inspectProfileSearchComposition(input)).supported, true)
    assert.deepEqual((await readdir(profileDir)).sort(), ['cordis.patch.yml', 'node_modules', 'package.json'])
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('CLI rejects disposable root-only web without initialization, normalization or secret output', async () => {
  const root = await mkdtemp(join(tmpdir(), 'copilot-preflight-readonly-'))
  try {
    const profileDir = join(root, 'profiles/web')
    await mkdir(profileDir, { recursive: true })
    const manifest = JSON.stringify({ name: 'synthetic-profile', dsh: { profile: { bundles: [] } } })
    const config = JSON.stringify([stock(), { id: 'private-config', config: { secretSentinel: 'never-print-me' } }])
    await writeFile(join(profileDir, 'package.json'), manifest)
    await writeFile(join(profileDir, 'cordis.yml'), config)
    const before = (await readdir(profileDir)).sort()
    let stdout
    let status = 0
    try { stdout = execFileSync(process.execPath, [
      fileURLToPath(new URL('../../scripts/check-search-composition.mjs', import.meta.url)),
      '--profile-dir', profileDir, '--home', root,
      '--install-anchor', fileURLToPath(new URL('../../package.json', import.meta.url)),
    ], { encoding: 'utf8', timeout: 15000 }) } catch (error) {
      stdout = error.stdout
      status = error.status
    }
    assert.equal(status, 1)
    assert.equal(JSON.parse(stdout).supported, false)
    assert.ok(!stdout.includes('never-print-me'))
    assert.deepEqual((await readdir(profileDir)).sort(), before)
    assert.equal(await readFile(join(profileDir, 'package.json'), 'utf8'), manifest)
    assert.equal(await readFile(join(profileDir, 'cordis.yml'), 'utf8'), config)
  } finally { await rm(root, { recursive: true, force: true }) }
})
