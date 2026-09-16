import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const doc = path => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')

test('installation guidance permits controlled offline CLI maintenance for Desktop profiles', async () => {
  const text = await doc('docs/npm-distribution.md')
  assert.match(text, /Controlled CLI maintenance is also supported for Desktop-managed profiles/)
  assert.match(text, /## Controlled offline CLI maintenance/)
  assert.match(text, /dsh plugin --profile web add \/absolute\/path\/to\/verified-release\.tgz --offline --ignore-scripts/)
  assert.match(text, /cache is incomplete[\s\S]*stop/i)
})

test('both user guides link the offline procedure without a blanket Desktop CLI prohibition', async () => {
  for (const path of ['README.md', 'README.zh.md']) {
    const text = await doc(path)
    assert.ok(text.includes('./docs/npm-distribution.md#controlled-offline-cli-maintenance'), path)
    assert.ok(text.includes('--offline --ignore-scripts'), path)
  }
  const all = (await Promise.all(['README.md', 'README.zh.md', 'docs/npm-distribution.md'].map(doc))).join('\n')
  for (const forbidden of [/do not use the CLI to modify a Desktop-managed profile/i,
    /不要使用 CLI 修改 Desktop 管理的 profile/, /For separately managed CLI profiles only/i,
    /Never use the CLI to write a reserved Desktop-managed\s+profile/i]) assert.doesNotMatch(all, forbidden)
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
