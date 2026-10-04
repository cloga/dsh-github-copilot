import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const doc = path => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('installation guidance distinguishes qualified Desktop CLI capability from profile safety', async () => {
  const text = await doc('docs/npm-distribution.md')
  assert.match(text, /Generic\/global CLI entry points must not be assumed to manage the reserved/)
  assert.match(text, /manageDesktopProfile: true/)
  assert.match(text, /@deepseek-ai\/dsh-desktop-host@0\.2\.0-rc\.2/)
  assert.match(text, /CLI support does \*\*not\*\* override composition safety/)
  assert.match(text, /no add, root rewrite or[\s\S]*restart followed/)
  assert.match(text, /## Controlled offline CLI maintenance for standalone profiles/)
  assert.match(text, /Do not use this path[\s\S]*Desktop-managed\/reserved profile/)
  assert.match(text, /composeProfile\(\)[\s\S]*writes the empty `cordis\.yml` root/)
  assert.match(text, /NONEMPTY_DISPOSABLE_PROFILE_ROOT/)
  assert.match(text, /dsh plugin --profile web add \/absolute\/path\/to\/verified-release\.tgz --offline --ignore-scripts/)
  assert.match(text, /cache is incomplete[\s\S]*stop/i)
})

test('both user guides link the distinct Desktop entry and standalone procedure', async () => {
  for (const path of ['README.md', 'README.zh.md']) {
    const text = await doc(path)
    assert.ok(text.includes('./docs/npm-distribution.md#controlled-offline-cli-maintenance-for-standalone-profiles'), path)
    assert.ok(text.includes('./docs/npm-distribution.md#desktop-bundled-cli-on-official-rc2'), path)
    assert.match(text, /Desktop.{0,80}(native package manager|原生包管理器)/i)
  }
  const all = (await Promise.all(['README.md', 'README.zh.md', 'docs/npm-distribution.md'].map(doc))).join('\n')
  assert.doesNotMatch(all, /Controlled CLI maintenance is also supported for Desktop-managed profiles/)
  assert.doesNotMatch(all, /Desktop-managed profiles may instead use the controlled offline CLI procedure/i)
})

test('offline maintenance retains approval, verification and no-bypass boundaries', async () => {
  const text = await doc('docs/npm-distribution.md')
  for (const marker of ['explicit installation approval', 'independently trusted SHA-256',
    'scripts/check-search-composition.mjs', 'supported: true', 'one writer', 'private backup',
    'Do not copy credential stores', 'node_modules', 'dsh.profile.bundles',
    'Keep TLS verification enabled', 'restart approval', 'Installed-on-disk']) assert.ok(text.includes(marker), marker)
  assert.match(text, /A blocked corporate registry is not authorization to use a VPN, proxy, mirror,/)
  assert.match(text, /not permission to bypass organizational registry restrictions/)
})

test('current user guides retain task-oriented entry points and honest screenshot evidence', async () => {
  const pkg = JSON.parse(await doc('package.json'))
  for (const path of ['README.md', 'README.zh.md']) {
    const text = await doc(path)
    assert.ok(text.includes(pkg.version), path)
    for (const image of ['copilot-model-preferences.png', 'copilot-search-routing.png']) {
      assert.ok(text.includes(`./docs/images/${image}`), `${path}: ${image}`)
      const bytes = await readFile(new URL(`../../docs/images/${image}`, import.meta.url))
      assert.deepEqual(bytes.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    }
    assert.ok(text.includes('./CHANGELOG.md'), path)
    assert.ok(text.includes('./docs/model-compatibility-acceptance.md#authentication-replay-and-request-diagnostics'), path)
  }
  const provenance = JSON.parse(await doc('docs/images/current-client-provenance.json'))
  assert.ok(pkg.files.includes('docs/images/current-client-provenance.json'))
  assert.equal(provenance.synthetic, true)
  assert.equal(provenance.capture.externalRequests, false)
  assert.deepEqual(provenance.capture.pageErrors, [])
  assert.match(provenance.limits, /No live OAuth/)
  const migration = await doc('docs/single-route-migration.md')
  assert.doesNotMatch(migration, /planned `0\.4\.0-alpha\.9`/)
  assert.match(migration, /live-agents-only/)
  assert.match(migration, /does not attest its publication or execution/)
})
