import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { distributionTag, npmJson, npmPackageTags, publishNpm, validatePublicPackage } from '../../scripts/publish-npm.mjs'
import { recoverArtifact } from '../../scripts/prepare-release-artifact.mjs'

const version = '0.4.0-alpha.18'
const name = 'dsh-github-copilot'
const bytes = Buffer.from('synthetic verified archive')
const sri = `sha512-${createHash('sha512').update(bytes).digest('base64')}`
const sha256 = createHash('sha256').update(bytes).digest('hex')
const sha = '1'.repeat(40)
const manifest = () => ({
  name, version, type: 'module', license: 'MIT',
  repository: { type: 'git', url: `git+https://github.com/cloga/${name}.git` },
  publishConfig: { access: 'public', registry: 'https://registry.npmjs.org/', tag: 'alpha' },
})
const published = () => ({ name, version, dist: { integrity: sri } })
function registry({ existing = null, tag = '0.4.0-alpha.9', missing = false, fail = false } = {}) {
  const calls = []
  let current = existing
  return {
    calls,
    readPackage: async () => missing ? null : { name, 'dist-tags': { alpha: tag } },
    readVersion: async () => current,
    publish: async args => {
      calls.push(args)
      if (fail) throw new Error('synthetic uncertain write')
      current = published()
      tag = version
    },
  }
}
const options = api => ({ manifest: manifest(), bytes, archive: 'artifacts/test.tgz', ...api })

test('public manifest validation rejects wrong identity, lifecycle hooks and accidental latest', () => {
  validatePublicPackage(manifest())
  for (const changed of [
    { private: true }, { name: '@unexpected/package' }, { license: 'UNLICENSED' },
    { publishConfig: { access: 'public', tag: 'latest', registry: 'https://registry.npmjs.org/' } },
    { scripts: { postinstall: 'unexpected' } }, { repository: { url: 'https://example.com' } },
  ]) assert.throws(() => validatePublicPackage({ ...manifest(), ...changed }))
})

test('distribution channels are explicit and never inferred from lexical version ordering', () => {
  for (const [v, tag] of [['1.0.0-alpha.10', 'alpha'], ['1.0.0-beta.2', 'beta'], ['1.0.0-rc.1', 'rc'], ['1.0.0', 'latest']]) {
    assert.equal(distributionTag(v), tag)
  }
  for (const v of ['1.0.0-preview.1', 'v1.0.0', '1.0.0+build']) assert.throws(() => distributionTag(v))
})

test('npm metadata reads distinguish E404 from auth, TLS, timeout and malformed responses', () => {
  const run = (status, stdout) => () => ({ status, stdout })
  assert.deepEqual(npmJson(['view', `${name}@${version}`], { run: run(0, JSON.stringify(published())) }), published())
  assert.equal(npmJson(['view', name], { run: run(1, '{"error":{"code":"E404"}}') }), null)
  for (const [status, text] of [[1, '{"error":{"code":"ENEEDAUTH"}}'], [1, 'TLS error'],
    [null, '{"error":{"code":"E404"}}'], [0, '[]'], [0, ''], [0, '{"error":{"code":"E404"}}']]) {
    assert.throws(() => npmJson(['view', name], { run: run(status, text) }))
  }
})

test('alpha-only package discovery uses dist-tag ls without relying on latest', () => {
  const result = npmPackageTags({ run: (cmd, args) => {
    assert.equal(cmd, 'npm')
    assert.deepEqual(args.slice(0, 3), ['dist-tag', 'ls', name])
    return { status: 0, stdout: `alpha: ${version}\n` }
  } })
  assert.equal(result['dist-tags'].alpha, version)
  assert.equal(result['dist-tags'].latest, undefined)
  assert.equal(npmPackageTags({ run: () => ({ status: 1, stdout: '{"error":{"code":"E404"}}' }) }), null)
  for (const stdout of ['', 'alpha: 1.0.0\nalpha: 2.0.0', '{"error":{"code":"E404"}}']) {
    assert.throws(() => npmPackageTags({ run: () => ({ status: 0, stdout }) }))
  }
})

test('new direct publication uses original tgz and verifies registry SRI after one write', async () => {
  const api = registry()
  const result = await publishNpm(options(api))
  assert.equal(result.state, 'published')
  assert.equal(result.integrity, sri)
  assert.deepEqual(api.calls, [['publish', 'artifacts/test.tgz', '--tag', 'alpha', '--access', 'public',
    '--registry', 'https://registry.npmjs.org/', '--ignore-scripts']])
})

test('same version is read-only only when its integrity matches and tag is not stranded', async () => {
  const api = registry({ existing: published(), tag: version })
  assert.equal((await publishNpm(options(api))).state, 'published')
  assert.equal(api.calls.length, 0)
  await assert.rejects(publishNpm(options(registry({ existing: { ...published(), dist: { integrity: 'sha512-wrong' } } }))), /integrity/)
  await assert.rejects(publishNpm(options(registry({ existing: published() }))), /dist-tag/)
})

test('missing bootstrap, newer tag, malformed tag and unknown registry outcomes fail before writes', async () => {
  for (const config of [{ missing: true }, { tag: '0.4.0-alpha.19' }, { tag: 'not-semver' }]) {
    const api = registry(config)
    await assert.rejects(publishNpm(options(api)))
    assert.equal(api.calls.length, 0)
  }
  const api = registry()
  await assert.rejects(publishNpm({ ...options(api), readPackage: async () => { throw new Error('registry unavailable') } }), /unavailable/)
  assert.equal(api.calls.length, 0)
})

test('uncertain writes and mismatched post-publish integrity never retry or claim success', async () => {
  const api = registry({ fail: true })
  await assert.rejects(publishNpm(options(api)), /uncertain/)
  assert.equal(api.calls.length, 1)
  let reads = 0
  const second = registry()
  await assert.rejects(publishNpm({ ...options(second), readVersion: async () => ++reads === 1 ? null : { ...published(), dist: { integrity: 'wrong' } } }), /integrity/)
  assert.equal(second.calls.length, 1)
})

test('older verified versions do not lower a newer dist-tag on reconciliation', async () => {
  const api = registry({ existing: published(), tag: '0.4.0-alpha.20' })
  assert.equal((await publishNpm(options(api))).state, 'published')
  assert.equal(api.calls.length, 0)
})

test('artifact recovery uses remote original bytes and rejects commit, digest and state drift', async () => {
  const tarName = `${name}-${version}.tgz`
  const sums = Buffer.from(`${sha256}  ${tarName}\n`)
  const files = [{ name: tarName, data: bytes }, { name: 'SHA256SUMS', data: sums }]
  const assets = files.map((f, i) => ({ id: i + 1, name: f.name, state: 'uploaded', size: f.data.length, digest: `sha256:${createHash('sha256').update(f.data).digest('hex')}` }))
  const release = { tag_name: `v${version}`, target_commitish: sha, draft: false, immutable: true, prerelease: true }
  const annotation = { tag: `v${version}`, object: { type: 'commit', sha } }
  const input = { version, sha, release, annotation, assets, readAsset: async id => files[id - 1].data }
  assert.deepEqual(await recoverArtifact(input), files)
  assert.equal(await recoverArtifact({ ...input, release: null, assets: [] }), null)
  for (const change of [
    { release: { ...release, immutable: false } },
    { annotation: { ...annotation, object: { type: 'commit', sha: '2'.repeat(40) } } },
    { assets: assets.slice(0, 1) },
    { assets: [...assets, assets[0]] },
    { readAsset: async () => Buffer.from('changed') },
  ]) await assert.rejects(recoverArtifact({ ...input, ...change }))
  const draft = await recoverArtifact({ ...input, release: { ...release, draft: true, immutable: false }, assets: assets.slice(0, 1) })
  assert.deepEqual(draft, files)
})

test('normal release requires npm and OIDC without a silent opt-out', async () => {
  const release = await readFile(new URL('../../.github/workflows/release.yml', import.meta.url), 'utf8')
  const ci = await readFile(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8')
  const prepare = await readFile(new URL('../../scripts/prepare-release-artifact.mjs', import.meta.url), 'utf8')
  assert.match(release, /scripts\/publish-npm\.mjs/)
  assert.doesNotMatch(release, /NPM_PUBLISH_ENABLED|continue-on-error|secrets\.NPM_TOKEN/)
  assert.match(ci, /id-token: write/)
  assert.match(release, /id-token: write/)
  assert.match(release, /scripts\/prepare-release-artifact\.mjs/)
  assert.match(prepare, /'--config.ignore-scripts=true', 'pack'/)
})
