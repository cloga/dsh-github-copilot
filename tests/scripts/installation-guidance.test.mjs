import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
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
    for (const image of ['copilot-model-preferences.png', 'copilot-search-routing.png',
      'copilot-accounts.png', 'copilot-accounts-credits.png', 'copilot-session-continuation.png']) {
      assert.ok(text.includes(`./docs/images/${image}`), `${path}: ${image}`)
      const bytes = await readFile(new URL(`../../docs/images/${image}`, import.meta.url))
      assert.deepEqual(bytes.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    }
    for (const marker of ['Follow parent model', 'Web search', 'Local diagnostics',
      'Model preferences', 'Follow global default', 'New Session continuation default',
      'copilot-session-continuation.png']) assert.ok(text.includes(marker), `${path}: ${marker}`)
    assert.ok(text.includes('./CHANGELOG.md'), path)
    assert.ok(text.includes('./docs/model-compatibility-acceptance.md#authentication-replay-and-request-diagnostics'), path)
  }
  const provenance = JSON.parse(await doc('docs/images/copilot-current-provenance.json'))
  assert.equal(provenance.synthetic, true)
  assert.equal(provenance.capture.externalRequests, false)
  assert.deepEqual(provenance.capture.pageErrors, [])
  assert.match(provenance.limits, /No live OAuth/)
  const migration = await doc('docs/single-route-migration.md')
  assert.doesNotMatch(migration, /planned `0\.4\.0-alpha\.9`/)
  assert.match(migration, /live-agents-only/)
  assert.match(migration, /does not attest its publication or execution/)
})

test('current screenshot provenance covers every packaged README capture', async () => {
  const pkg = JSON.parse(await doc('package.json'))
  const provenance = JSON.parse(await doc('docs/images/copilot-current-provenance.json'))
  assert.match(provenance.clientVersion, /^\d+\.\d+\.\d+$/)
  assert.match(provenance.sourceCommit, /^[a-f0-9]{40}$/)
  assert.match(provenance.builtClientSha256, /^[a-f0-9]{64}$/)
  assert.match(provenance.continuationComponentBundleSha256, /^[a-f0-9]{64}$/)
  assert.match(provenance.source, /Local pnpm build/)
  assert.match(provenance.source, /release-candidate commit/)
  assert.doesNotMatch(provenance.source, /Actual published archive/)
  assert.ok(pkg.files.includes('docs/images/'))
  assert.deepEqual(provenance.capture.viewports, [920, 375])
  assert.deepEqual(provenance.capture.themes, ['dark', 'light'])
  assert.equal(provenance.capture.horizontalOverflow, false)
  assert.equal(Object.keys(provenance.components).length, 5)
  for (const image of Object.keys(provenance.components)) {
    const bytes = await readFile(new URL(`../../docs/images/${image}`, import.meta.url))
    assert.equal(createHash('sha256').update(bytes).digest('hex'), provenance.imageSha256[image], image)
    assert.ok(bytes.readUInt32BE(20) > 400, `${image}: meaningful capture, not a clipped popup`)
  }
  const fixture = await doc(provenance.fixture)
  assert.ok(fixture.includes("version:'__CLIENT_VERSION__'"))
  assert.match(fixture, /connect-src 'none'/)
  assert.match(fixture, /src="\/client\.js"/)
  assert.match(fixture, /UI\.GitHubCopilotCompactAccount/)
  assert.match(fixture, /UI\.CopilotUsageCard/)
  assert.match(fixture, /UI\.CopilotPluginSettingsPage/)
  assert.match(fixture, /CopilotContinuation\.SessionContinuationCard/)
  const continuation = await doc('src/session-continuation-ui.ts')
  assert.match(continuation, /Session policy/)
  const server = await doc('tests/browser/serve-search-routing.mjs')
  assert.match(server, /replaceAll\('__CLIENT_VERSION__', version\)/)
  assert.match(server, /readme-capture\/continuation\.js/)
  const bundleConfig = await doc('tests/browser/capture-continuation.config.ts')
  assert.match(bundleConfig, /continuation-capture-entry\.ts/)
  const captureEntry = await doc('tests/browser/continuation-capture-entry.ts')
  assert.match(captureEntry, /src\/session-continuation-ui\.ts/)
})

test('README contracts stay bilingual, current and separate native summary routes', async () => {
  const texts = await Promise.all(['README.md', 'README.zh.md'].map(doc))
  for (const text of texts) {
    for (const marker of ['0.2.0-rc.2', '0.2', '1.5×', 'Switch account',
      'High cost', 'autoSemanticAssessment: false', 'automaticRecovery: false',
      'auto: false', '--mode persisted-unit', '--mode reviewed-view', '--profile-name',
      './docs/dual-model.md', './docs/session-continuation.md',
      './docs/images/copilot-current-provenance.json']) assert.ok(text.includes(marker), marker)
    assert.doesNotMatch(text, /prepared.*0\.4\.0-alpha\.130|0\.4\.0-alpha\.88/i)
  }
  assert.match(texts[0], /finite continuity bonus/)
  assert.match(texts[0], /independently resolved native summary route/)
  assert.match(texts[0], /additional accounts are independently authorized/)
  assert.match(texts[1], /独立解析的原生摘要路由/)
  assert.match(texts[1], /独立授权/)
})

test('README local Markdown links and target anchors exist', async () => {
  for (const path of ['README.md', 'README.zh.md']) {
    const text = await doc(path)
    for (const match of text.matchAll(/!?\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const target = match[1]
      if (/^[a-z]+:/i.test(target)) continue
      const [file, anchor] = target.split('#')
      const content = await doc(file || path)
      if (!anchor) continue
      const counts = new Map()
      const anchors = new Set([...content.matchAll(/^#{1,6}\s+(.+)$/gm)].map(heading => {
        const slug = heading[1].toLowerCase().replace(/[`*_]/g, '')
          .replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-')
        const count = counts.get(slug) || 0
        counts.set(slug, count + 1)
        return count ? `${slug}-${count}` : slug
      }))
      assert.ok(anchors.has(decodeURIComponent(anchor)), `${path}: ${target}`)
    }
  }
})
