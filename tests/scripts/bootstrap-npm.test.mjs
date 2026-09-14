import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import test from 'node:test'
import {
  BOOTSTRAP,
  bootstrapNpm,
  validateBootstrapContext,
  verifyBootstrapArchive,
  verifyBootstrapRelease,
} from '../../scripts/bootstrap-npm.mjs'

function entry(name, content) {
  const data = Buffer.from(content)
  const header = Buffer.alloc(512)
  header.write(name)
  header.write('0000644\0', 100)
  header.write('0000000\0', 108)
  header.write('0000000\0', 116)
  header.write(`${data.length.toString(8).padStart(11, '0')}\0`, 124)
  header.write('00000000000\0', 136)
  header.fill(32, 148, 156)
  header.write('0', 156)
  header.write('ustar\0', 257)
  header.write('00', 263)
  let sum = 0
  for (const byte of header) sum += byte
  header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148)
  return Buffer.concat([header, data, Buffer.alloc((512 - data.length % 512) % 512)])
}

function syntheticArchive() {
  const manifest = {
    name: BOOTSTRAP.name,
    version: BOOTSTRAP.version,
    type: 'module',
    license: 'MIT',
    repository: { url: `git+https://github.com/${BOOTSTRAP.repository}.git` },
    publishConfig: { registry: 'https://registry.npmjs.org/', access: 'public', tag: 'alpha' },
    exports: { '.': './lib/index.js' },
  }
  return gzipSync(Buffer.concat([
    entry('package/package.json', JSON.stringify(manifest)),
    entry('package/deployment-baseline.json', JSON.stringify({ package: { version: BOOTSTRAP.version } })),
    entry('package/LICENSE', 'MIT'),
    entry('package/README.md', 'readme'),
    entry('package/README.zh.md', 'readme'),
    entry('package/lib/index.js', 'export {}'),
    Buffer.alloc(1024),
  ]))
}

function syntheticExpected(bytes) {
  return {
    ...BOOTSTRAP,
    tarSize: bytes.length,
    tarSha256: createHash('sha256').update(bytes).digest('hex'),
    tarIntegrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
  }
}

test('bootstrap context permits only exact manual main invocations and isolates credentials', () => {
  const base = {
    GITHUB_ACTIONS: 'true',
    GITHUB_EVENT_NAME: 'workflow_dispatch',
    GITHUB_REPOSITORY: BOOTSTRAP.repository,
    GITHUB_REF: 'refs/heads/main',
    BOOTSTRAP_VERSION: BOOTSTRAP.version,
  }
  validateBootstrapContext({ ...base, GH_TOKEN: 'github-token' }, 'prepare')
  validateBootstrapContext({ ...base, NODE_AUTH_TOKEN: 'npm-token' }, 'publish')
  for (const changed of [
    { GITHUB_EVENT_NAME: 'push', GH_TOKEN: 'github-token' },
    { GITHUB_REF: 'refs/heads/feature', GH_TOKEN: 'github-token' },
    { BOOTSTRAP_VERSION: '0.4.0-alpha.19', GH_TOKEN: 'github-token' },
    { NODE_AUTH_TOKEN: 'npm-token', GH_TOKEN: 'github-token' },
    { NODE_AUTH_TOKEN: 'npm-token', NPM_TOKEN: 'duplicate' },
  ]) assert.throws(() => validateBootstrapContext({ ...base, ...changed }, changed.NODE_AUTH_TOKEN ? 'publish' : 'prepare'))
})

test('archive verification checks exact bytes, public manifest, baseline and exports', async () => {
  const bytes = syntheticArchive()
  const expected = syntheticExpected(bytes)
  assert.equal(verifyBootstrapArchive(bytes, expected).version, BOOTSTRAP.version)
  assert.throws(() => verifyBootstrapArchive(Buffer.concat([bytes, Buffer.from('changed')]), expected))
})

test('immutable release verification checks exact metadata, assets, checksum and archive', async () => {
  const bytes = syntheticArchive()
  const expected = syntheticExpected(bytes)
  const sums = Buffer.from(`${expected.tarSha256}  ${expected.tarName}\n`)
  Object.assign(expected, {
    sumsSize: sums.length,
    sumsSha256: createHash('sha256').update(sums).digest('hex'),
  })
  const files = [bytes, sums]
  const assets = [
    { id: 1, name: expected.tarName, size: bytes.length, state: 'uploaded', digest: `sha256:${expected.tarSha256}` },
    { id: 2, name: 'SHA256SUMS', size: sums.length, state: 'uploaded', digest: `sha256:${expected.sumsSha256}` },
  ]
  const release = {
    tag_name: BOOTSTRAP.tag,
    target_commitish: BOOTSTRAP.sha,
    name: `${BOOTSTRAP.name} ${BOOTSTRAP.version}`,
    body: `Release ${BOOTSTRAP.tag}.`,
    draft: false,
    prerelease: true,
    immutable: true,
  }
  const annotation = {
    tag: BOOTSTRAP.tag,
    message: `Release ${BOOTSTRAP.tag}`,
    object: { type: 'commit', sha: BOOTSTRAP.sha },
  }
  await verifyBootstrapRelease({ release, annotation, assets, readAsset: async id => files[id - 1], expected })
  for (const changed of [
    { release: { ...release, immutable: false } },
    { release: { ...release, target_commitish: '1'.repeat(40) } },
    { annotation: { ...annotation, object: { type: 'commit', sha: '2'.repeat(40) } } },
    { assets: assets.slice(0, 1) },
    { assets: [{ ...assets[0], size: bytes.length + 1 }, assets[1]] },
  ]) {
    await assert.rejects(verifyBootstrapRelease({
      release,
      annotation,
      assets,
      readAsset: async id => files[id - 1],
      expected,
      ...changed,
    }))
  }
})

test('true package absence performs one exact publish and verifies version and alpha tag', async () => {
  const bytes = syntheticArchive()
  const expected = syntheticExpected(bytes)
  let existing = null
  let pkg = null
  const calls = []
  const result = await bootstrapNpm({
    bytes,
    archive: 'verified-release.tgz',
    readPackage: async () => pkg,
    readVersion: async () => existing,
    expected,
    publish: async args => {
      calls.push(args)
      existing = { name: BOOTSTRAP.name, version: BOOTSTRAP.version, dist: { integrity: expected.tarIntegrity } }
      pkg = { name: BOOTSTRAP.name, 'dist-tags': { alpha: BOOTSTRAP.version } }
    },
  })
  assert.equal(result.state, 'published')
  assert.deepEqual(calls, [[
    'publish',
    'verified-release.tgz',
    '--tag',
    'alpha',
    '--access',
    'public',
    '--ignore-scripts',
    '--registry=https://registry.npmjs.org/',
  ]])
})

test('existing package is read-only only for matching version integrity and alpha tag', async () => {
  const bytes = syntheticArchive()
  const expected = syntheticExpected(bytes)
  const existing = { name: BOOTSTRAP.name, version: BOOTSTRAP.version, dist: { integrity: expected.tarIntegrity } }
  const pkg = { name: BOOTSTRAP.name, 'dist-tags': { alpha: BOOTSTRAP.version } }
  let writes = 0
  const options = {
    bytes,
    archive: 'verified-release.tgz',
    readPackage: async () => pkg,
    readVersion: async () => existing,
    publish: async () => { writes++ },
    expected,
  }
  assert.equal((await bootstrapNpm(options)).state, 'verified')
  assert.equal(writes, 0)
  await assert.rejects(bootstrapNpm({ ...options, readVersion: async () => null }), /maintainer review/)
  await assert.rejects(bootstrapNpm({
    ...options,
    readVersion: async () => ({ ...existing, dist: { integrity: 'sha512-wrong' } }),
  }), /integrity/)
  await assert.rejects(bootstrapNpm({
    ...options,
    readPackage: async () => ({ name: BOOTSTRAP.name, 'dist-tags': { alpha: '0.4.0-alpha.17' } }),
  }), /alpha tag/)
  assert.equal(writes, 0)
})

test('failed or unverifiable publication is never retried or reported as success', async () => {
  const bytes = syntheticArchive()
  const expected = syntheticExpected(bytes)
  let writes = 0
  await assert.rejects(bootstrapNpm({
    bytes,
    archive: 'verified-release.tgz',
    readPackage: async () => null,
    readVersion: async () => null,
    expected,
    publish: async () => {
      writes++
      throw new Error('OTP required')
    },
  }), /OTP/)
  assert.equal(writes, 1)
})

test('one-time workflow has only manual trigger, minimal permissions and isolated npm secret', async () => {
  const workflow = await import('node:fs/promises').then(fs =>
    fs.readFile(new URL('../../.github/workflows/bootstrap-npm.yml', import.meta.url), 'utf8'))
  assert.match(workflow, /workflow_dispatch:/)
  assert.doesNotMatch(workflow, /^\s+(push|pull_request):/mu)
  assert.match(workflow, /permissions:\s*\n\s+contents: read/u)
  assert.doesNotMatch(workflow, /id-token: write|^\s+cache:/mu)
  assert.equal((workflow.match(/secrets\.NPM_TOKEN/gu) ?? []).length, 1)
  assert.match(workflow, /NODE_AUTH_TOKEN: \$\{\{ secrets\.NPM_TOKEN \}\}/u)
  assert.match(workflow, /NPM_CONFIG_LOGS_MAX: '0'/u)
  assert.match(workflow, /npm@11\.5\.1/u)
  assert.match(workflow, /node scripts\/bootstrap-npm\.mjs prepare[\s\S]+node scripts\/bootstrap-npm\.mjs publish/u)
  assert.equal((workflow.match(/actions\/setup-node@v6/gu) ?? []).length, 2)
  assert.ok(workflow.indexOf('node scripts/bootstrap-npm.mjs prepare') < workflow.indexOf('registry-url: https://registry.npmjs.org'))
})
