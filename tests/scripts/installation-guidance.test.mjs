import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const doc = path => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('installation guidance reserves Desktop profiles for the native package manager', async () => {
  const text = await doc('docs/npm-distribution.md')
  assert.match(text, /Desktop profiles must be managed through Desktop's native package manager/)
  assert.match(text, /reserved `desktop` profile is not supported by DSH CLI plugin commands/)
  assert.match(text, /## Controlled offline CLI maintenance for standalone profiles/)
  assert.match(text, /Do not use this path[\s\S]*Desktop-managed\/reserved profile/)
  assert.match(text, /composeProfile\(\)[\s\S]*writes the empty `cordis\.yml` root/)
  assert.match(text, /NONEMPTY_DISPOSABLE_PROFILE_ROOT/)
  assert.match(text, /dsh plugin --profile web add \/absolute\/path\/to\/verified-release\.tgz --offline --ignore-scripts/)
  assert.match(text, /cache is incomplete[\s\S]*stop/i)
})

test('both user guides limit offline CLI procedures to standalone profiles', async () => {
  for (const path of ['README.md', 'README.zh.md']) {
    const text = await doc(path)
    assert.ok(text.includes('./docs/npm-distribution.md#controlled-offline-cli-maintenance-for-standalone-profiles'), path)
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
