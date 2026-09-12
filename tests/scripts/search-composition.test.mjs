import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { composeEntries } from '@deepseek-ai/dsh-app-boot'
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
]) {
  test(`rejects ${label} before routing overlay installation`, () => {
    const before = JSON.stringify(entries)
    const report = checkSearchComposition(entries)
    assert.equal(report.supported, false)
    assert.ok(report.reasons.includes(code))
    assert.equal(JSON.stringify(entries), before)
  })
}

function nativeReaders({ user = [], home = [], extra = [], own = true } = {}) {
  const calls = []
  const api = {
    readProfileManifest(_bin, directory) {
      calls.push(['manifest', directory])
      if (directory === '/profile') return { dsh: { profile: { bundles: own ? ['base', 'dsh-github-copilot'] : ['base'] } } }
      if (directory === '/bundles/base') return { name: 'base', dsh: { bundle: { patch: 'base.yml' } } }
      if (directory === '/bundles/dsh-github-copilot') return { name: 'dsh-github-copilot', dsh: { bundle: { patch: 'owned.yml' } } }
      throw new Error('unexpected manifest read')
    },
    resolveBundleDir(_bin, name) { return `/bundles/${name}` },
    loadOptionalPatches(_bin, file) {
      const normalized = file.replaceAll('\\', '/')
      if (normalized.endsWith('/profile/cordis.yml')) return []
      if (normalized.endsWith('/profile/cordis.patch.yml')) return user
      if (normalized.endsWith('/home/cordis.patch.yml')) return home
      throw new Error('unexpected optional read')
    },
    loadOverlayPatches(_bin, file) {
      const normalized = file.replaceAll('\\', '/')
      if (normalized.endsWith('/bundles/base/base.yml')) return [{ insert: [stock()] }]
      if (normalized.endsWith('/extra.yml')) return extra
      throw new Error('must not read owned routing overlay or arbitrary input')
    },
    composeEntries,
  }
  return { api, calls }
}
const options = { profileDir: '/profile', home: '/home', installAnchor: '/installation/package.json' }

test('uses public read-only readers and excludes the existing owned routing layer before an update', async () => {
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

test('CLI uses real public parsers without profile initialization, normalization or secret output', async () => {
  const root = await mkdtemp(join(tmpdir(), 'copilot-preflight-readonly-'))
  try {
    const profileDir = join(root, 'profiles/web')
    await mkdir(profileDir, { recursive: true })
    const manifest = JSON.stringify({ name: 'synthetic-profile', dsh: { profile: { bundles: [] } } })
    const config = JSON.stringify([stock(), { id: 'private-config', config: { secretSentinel: 'never-print-me' } }])
    await writeFile(join(profileDir, 'package.json'), manifest)
    await writeFile(join(profileDir, 'cordis.yml'), config)
    const before = (await readdir(profileDir)).sort()
    const stdout = execFileSync(process.execPath, [
      fileURLToPath(new URL('../../scripts/check-search-composition.mjs', import.meta.url)),
      '--profile-dir', profileDir, '--home', root,
      '--install-anchor', fileURLToPath(new URL('../../package.json', import.meta.url)),
    ], { encoding: 'utf8', timeout: 15000 })
    assert.equal(JSON.parse(stdout).supported, true)
    assert.ok(!stdout.includes('never-print-me'))
    assert.deepEqual((await readdir(profileDir)).sort(), before)
    assert.equal(await readFile(join(profileDir, 'package.json'), 'utf8'), manifest)
    assert.equal(await readFile(join(profileDir, 'cordis.yml'), 'utf8'), config)
  } finally { await rm(root, { recursive: true, force: true }) }
})
