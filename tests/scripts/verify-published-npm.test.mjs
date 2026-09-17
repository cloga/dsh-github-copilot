import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createReadOnlyClient, distributionTag, parseCliArgs, RECEIPT_NAME, runCli,
  verifyPublishedNpm } from '../../scripts/verify-published-npm.mjs'

const NAME = 'dsh-github-copilot'
const VERSION = '0.4.0-alpha.25'
const SHA = 'a'.repeat(40)
const TAG_SHA = 'b'.repeat(40)
const API = `https://api.github.com/repos/cloga/${NAME}`
const REGISTRY = 'https://registry.npmjs.org'
const digest = (bytes, algorithm = 'sha256', encoding = 'hex') => createHash(algorithm).update(bytes).digest(encoding)

function fixture(version = VERSION) {
  // Arbitrary original bytes, not executable/extracted/repacked content. This gate checks byte identity.
  const archive = Buffer.from('original immutable release archive bytes')
  const archiveName = `${NAME}-${version}.tgz`
  const checksum = Buffer.from(`${digest(archive)}  ${archiveName}\n`)
  const release = { id: 10, tag_name: `v${version}`, target_commitish: SHA, draft: false,
    immutable: true, prerelease: version.includes('-') }
  const ref = { ref: `refs/tags/v${version}`, object: { type: 'tag', sha: TAG_SHA } }
  const tagObject = { sha: TAG_SHA, tag: `v${version}`, object: { type: 'commit', sha: SHA } }
  const assets = [archive, checksum].map((bytes, index) => ({ id: 20 + index,
    name: index ? 'SHA256SUMS' : archiveName, state: 'uploaded', size: bytes.length,
    digest: `sha256:${digest(bytes)}` }))
  const remote = { name: NAME, version, dist: { integrity: `sha512-${digest(archive, 'sha512', 'base64')}`,
    shasum: digest(archive, 'sha1') } }
  const tags = { [distributionTag(version)]: version }
  const data = { archive, checksum, release, ref, tagObject, assets, remote, tags }
  const reads = {
    readRelease: async () => data.release, readRef: async () => data.ref,
    readTag: async () => data.tagObject, readAssets: async () => data.assets,
    readAsset: async id => id === 20 ? data.archive : data.checksum,
    readVersion: async () => data.remote, readTags: async () => data.tags,
  }
  const calls = []
  const fetch = async (url, options) => {
    calls.push({ url, options })
    assert.equal(options.method, 'GET')
    assert.equal(options.redirect, 'manual')
    const routes = new Map([
      [`${API}/releases/tags/v${version}`, data.release],
      [`${API}/git/ref/tags/v${version}`, data.ref],
      [`${API}/git/tags/${TAG_SHA}`, data.tagObject],
      [`${API}/releases/10/assets?per_page=100&page=1`, data.assets],
      [`${REGISTRY}/${NAME}/${version}`, data.remote],
      [`${REGISTRY}/-/package/${NAME}/dist-tags`, data.tags],
    ])
    if (url === `${API}/releases/assets/20`) return new Response(data.archive)
    if (url === `${API}/releases/assets/21`) return new Response(data.checksum)
    assert.ok(routes.has(url), `Unexpected URL: ${url}`)
    if (routes.get(url) === null) return new Response('not observable', { status: 404 })
    return Response.json(routes.get(url))
  }
  return { data, reads, calls, fetch }
}
const verify = reads => verifyPublishedNpm({ version: VERSION, expectedSha: SHA, reads })

for (const version of [VERSION, '0.5.0-beta.1', '0.5.0-rc.1', '1.0.0']) {
  test(`verifies exact original bytes and public metadata for ${version}`, async () => {
    const f = fixture(version)
    const result = await verifyPublishedNpm({ version, expectedSha: SHA, reads: f.reads })
    assert.equal(result.state, 'success')
    assert.equal(result.release.immutable, true)
    assert.equal(result.tagObject.commit, SHA)
    assert.equal(result.archive.sha256, digest(f.data.archive))
    assert.equal(result.archive.integrity, f.data.remote.dist.integrity)
    assert.deepEqual(result.registry, { name: NAME, version, integrity: f.data.remote.dist.integrity,
      shasum: f.data.remote.dist.shasum, distTag: { name: distributionTag(version), version } })
    assert.equal(result.sources.registry, `${REGISTRY}/${NAME}/${version}`)
    assert.equal(result.assets.length, 2)
  })
}

test('accepts a newer same-channel tag using numeric SemVer precedence, without changing it', async () => {
  const f = fixture()
  f.data.tags.alpha = '0.4.0-alpha.100'
  const result = await verify(f.reads)
  assert.equal(result.state, 'success')
  assert.equal(result.registry.distTag.version, '0.4.0-alpha.100')
})

for (const version of ['', 'v1.0.0', '01.0.0', '1.0', '1.0.0+build', '1.0.0-alpha.01', '1.0.0-latest',
  '1.0.0-owner.1', '1.0.0\n', '../secret', 'https://evil.example', null]) {
  test(`rejects malformed or unsupported version ${JSON.stringify(version)} before any read`, async () => {
    let called = false
    const result = await verifyPublishedNpm({ version, expectedSha: SHA,
      reads: new Proxy({}, { get() { called = true; throw new Error('must not read') } }) })
    assert.equal(result.state, 'invalid-input')
    assert.equal(called, false)
    assert.equal(result.version, undefined)
  })
}

for (const expectedSha of ['', 'abc', 'A'.repeat(40), 'a'.repeat(64), `${SHA}\n`, null]) {
  test(`rejects malformed source SHA ${JSON.stringify(expectedSha)}`, async () => {
    const result = await verifyPublishedNpm({ version: VERSION, expectedSha, reads: {} })
    assert.equal(result.state, 'invalid-input')
    assert.equal(result.reason, 'invalid-expected-sha')
  })
}

const failures = [
  ['draft release', f => { f.data.release.draft = true }, 'release-mismatch'],
  ['mutable release', f => { f.data.release.immutable = false }, 'release-mismatch'],
  ['wrong release tag', f => { f.data.release.tag_name = 'v1.0.0' }, 'release-mismatch'],
  ['wrong prerelease flag', f => { f.data.release.prerelease = false }, 'release-mismatch'],
  ['wrong release commit', f => { f.data.release.target_commitish = 'main' }, 'release-mismatch'],
  ['lightweight tag', f => { f.data.ref.object.type = 'commit' }, 'tag-mismatch'],
  ['wrong ref', f => { f.data.ref.ref = 'refs/tags/v1.0.0' }, 'tag-mismatch'],
  ['wrong tag target', f => { f.data.tagObject.object.sha = 'c'.repeat(40) }, 'tag-mismatch'],
  ['wrong annotated tag name', f => { f.data.tagObject.tag = 'v1.0.0' }, 'tag-mismatch'],
  ['wrong annotated object SHA', f => { f.data.tagObject.sha = 'c'.repeat(40) }, 'tag-mismatch'],
  ['nested tag target', f => { f.data.tagObject.object.type = 'tag' }, 'tag-mismatch'],
  ['extra asset', f => { f.data.assets.push({ ...f.data.assets[0], id: 23 }) }, 'asset-mismatch'],
  ['missing asset', f => { f.data.assets.pop() }, 'asset-mismatch'],
  ['duplicate asset name', f => { f.data.assets[1].name = f.data.assets[0].name }, 'asset-mismatch'],
  ['duplicate asset id', f => { f.data.assets[1].id = f.data.assets[0].id }, 'asset-mismatch'],
  ['unuploaded asset', f => { f.data.assets[0].state = 'new' }, 'asset-mismatch'],
  ['wrong uploaded size', f => { f.data.assets[0].size++ }, 'asset-mismatch'],
  ['wrong checksum asset size', f => { f.data.assets[1].size++ }, 'asset-mismatch'],
  ['missing asset digest', f => { delete f.data.assets[0].digest }, 'asset-mismatch'],
  ['wrong original hash', f => { f.data.assets[0].digest = `sha256:${'c'.repeat(64)}` }, 'asset-mismatch'],
  ['wrong checksum asset hash', f => { f.data.assets[1].digest = `sha256:${'c'.repeat(64)}` }, 'asset-mismatch'],
  ['absent registry version', f => { f.data.remote = null }, 'missing-version'],
  ['wrong registry name', f => { f.data.remote.name = 'other-package' }, 'integrity-mismatch'],
  ['wrong registry version', f => { f.data.remote.version = '0.4.0-alpha.24' }, 'integrity-mismatch'],
  ['wrong registry integrity', f => { f.data.remote.dist.integrity = `sha512-${digest('other', 'sha512', 'base64')}` }, 'integrity-mismatch'],
  ['missing registry integrity', f => { delete f.data.remote.dist.integrity }, 'integrity-mismatch'],
  ['wrong optional shasum', f => { f.data.remote.dist.shasum = 'c'.repeat(40) }, 'integrity-mismatch'],
  ['older dist-tag', f => { f.data.tags.alpha = '0.4.0-alpha.9' }, 'tag-stranded'],
  ['missing dist-tag', f => { delete f.data.tags.alpha }, 'tag-stranded'],
  ['wrong channel tag', f => { f.data.tags.alpha = '0.4.0' }, 'tag-stranded'],
  ['invalid dist-tag', f => { f.data.tags.alpha = 'latest' }, 'tag-stranded'],
  ['build metadata in tag', f => { f.data.tags.alpha = `${VERSION}+build` }, 'tag-stranded'],
]
for (const [label, mutate, state] of failures) {
  test(`fails closed: ${label}`, async () => {
    const f = fixture()
    mutate(f)
    const result = await verify(f.reads)
    assert.equal(result.state, state)
    assert.ok(result.reason)
    assert.ok(result.stage)
  })
}

for (const line of [
  hash => `${hash}  ../dsh-github-copilot-${VERSION}.tgz\n`,
  hash => `${hash}  other.tgz\n`,
  hash => `${hash}  dsh-github-copilot-${VERSION}.tgz\n\n`,
  hash => `${hash}  dsh-github-copilot-${VERSION}.tgz\n${hash}  another.tgz\n`,
  () => `${'c'.repeat(64)}  dsh-github-copilot-${VERSION}.tgz\n`,
]) {
  test('rejects invalid checksum contents even when the checksum asset digest matches', async () => {
    const f = fixture()
    f.data.checksum = Buffer.from(line(digest(f.data.archive)))
    f.data.assets[1].size = f.data.checksum.length
    f.data.assets[1].digest = `sha256:${digest(f.data.checksum)}`
    const result = await verify(f.reads)
    assert.equal(result.reason, 'checksum-mismatch')
  })
}

test('omits absent optional shasum and does not copy remote metadata or provenance wholesale', async () => {
  const f = fixture()
  delete f.data.remote.dist.shasum
  f.data.remote.secret = 'remote-private-content'
  f.data.remote.dist.attestations = { arbitrary: 'remote-private-content' }
  f.data.release.body = 'remote-private-content'
  f.data.assets[0].browser_download_url = 'https://evil.example/remote-private-content'
  const result = await verify(f.reads)
  assert.equal(result.state, 'success')
  assert.equal(result.registry.shasum, undefined)
  assert.ok(!JSON.stringify(result).includes('remote-private-content'))
})

test('uses fixed canonical GET endpoints and never sends GitHub auth to the public registry', async () => {
  const f = fixture()
  const reads = createReadOnlyClient({ fetch: f.fetch, token: 'synthetic-token' })
  const result = await verify(reads)
  assert.equal(result.state, 'success')
  assert.equal(f.calls.length, 8)
  for (const { url, options } of f.calls) {
    assert.equal(options.method, 'GET')
    assert.equal(options.redirect, 'manual')
    assert.ok(options.signal instanceof AbortSignal)
    assert.equal(options.body, undefined)
    assert.equal(options.dispatcher, undefined)
    assert.equal(options.headers.Authorization, url.startsWith(API) ? 'Bearer synthetic-token' : undefined)
  }
})

for (const assetPath of ['github-production-release-asset-2e65be', 'github-production-release-asset']) {
test(`allows one signed ${assetPath} redirect without forwarding authentication`, async () => {
  const calls = []
  const location = `https://release-assets.githubusercontent.com/${assetPath}/1/fixture?sig=synthetic`
  const reads = createReadOnlyClient({ token: 'synthetic-token', fetch: async (url, options) => {
    calls.push({ url, options })
    if (calls.length === 1) return new Response(null, { status: 302, headers: { location } })
    return new Response('original')
  } })
  assert.equal(Buffer.from(await reads.readAsset(20)).toString(), 'original')
  assert.equal(calls.length, 2)
  assert.equal(calls[0].url, `${API}/releases/assets/20`)
  assert.equal(calls[0].options.headers.Authorization, 'Bearer synthetic-token')
  assert.equal(calls[1].url, location)
  assert.deepEqual(calls[1].options.headers, { Accept: 'application/octet-stream' })
  assert.equal(calls[1].options.redirect, 'manual')
})
}

for (const location of ['https://evil.example/file?sig=x', 'http://release-assets.githubusercontent.com/github-production-release-asset-x/a?sig=x',
  'https://release-assets.githubusercontent.com.evil.example/github-production-release-asset-x/a?sig=x',
  'https://token@release-assets.githubusercontent.com/github-production-release-asset-x/a?sig=x',
  'https://release-assets.githubusercontent.com:444/github-production-release-asset-x/a?sig=x',
  'https://release-assets.githubusercontent.com/github-production-release-asset-x/a',
  'https://release-assets.githubusercontent.com/github-production-release-asset-x/a?unsigned=x',
  'https://release-assets.githubusercontent.com/github-production-release-asset-x/a?sig=',
  'https://release-assets.githubusercontent.com/other/a?sig=x',
  'https://api.github.com/repos/cloga/other/releases/assets/1', '/relative', 'not a url']) {
  test(`rejects untrusted asset redirect ${location}`, async () => {
    let calls = 0
    const reads = createReadOnlyClient({ token: 'synthetic-token', fetch: async () => {
      calls++
      return new Response(null, { status: 302, headers: { location } })
    } })
    await assert.rejects(reads.readAsset(20), /untrusted-asset-redirect/)
    assert.equal(calls, 1)
  })
}

test('refuses a second redirect rather than automatically following or retrying', async () => {
  let calls = 0
  const reads = createReadOnlyClient({ fetch: async () => {
    calls++
    return new Response(null, { status: 302, headers: {
      location: 'https://release-assets.githubusercontent.com/github-production-release-asset-x/a?sig=x',
    } })
  } })
  await assert.rejects(reads.readAsset(20), /asset-http-status/)
  assert.equal(calls, 2)
})

for (const status of [401, 403, 429, 500, 502]) {
  test(`registry HTTP ${status} is read failure, not absent version, with no retry`, async () => {
    const f = fixture()
    let versionReads = 0
    const reads = createReadOnlyClient({ fetch: async (url, options) => {
      if (url === `${REGISTRY}/${NAME}/${VERSION}`) {
        versionReads++
        return new Response('sensitive raw remote body', { status })
      }
      return f.fetch(url, options)
    } })
    const result = await verify(reads)
    assert.equal(result.state, 'read-failure')
    assert.equal(result.httpStatus, status)
    assert.equal(versionReads, 1)
    assert.ok(!JSON.stringify(result).includes('sensitive'))
  })
}

test('only an exact registry version 404 means missing-version', async () => {
  const f = fixture()
  f.data.remote = null
  assert.equal((await verify(createReadOnlyClient({ fetch: f.fetch }))).state, 'missing-version')
  const github404 = await verify(createReadOnlyClient({ fetch: async () => new Response('private', { status: 404 }) }))
  assert.equal(github404.state, 'read-failure')
  assert.equal(github404.stage, 'release')
})

test('TLS/auth exceptions and JSON parse errors stay sanitized read failures', async () => {
  for (const fail of [async () => { throw new Error('TLS certificate synthetic-secret') },
    async () => new Response('invalid JSON synthetic-secret'),
    async () => Response.json({ error: 'synthetic-secret' })]) {
    const f = fixture()
    const reads = createReadOnlyClient({ fetch: async (url, options) => url.startsWith(REGISTRY) ? fail() : f.fetch(url, options) })
    const result = await verify(reads)
    assert.equal(result.state, 'read-failure')
    assert.ok(!JSON.stringify(result).includes('synthetic-secret'))
  }
})

test('tag read failure is not misclassified as a missing or stranded tag', async () => {
  const f = fixture()
  const reads = createReadOnlyClient({ fetch: async (url, options) => url.endsWith('/dist-tags')
    ? new Response('sensitive', { status: 403 }) : f.fetch(url, options) })
  const result = await verify(reads)
  assert.equal(result.state, 'read-failure')
  assert.equal(result.stage, 'registry-tags')
})

test('rejects metadata redirects and unexpectedly auto-followed responses', async () => {
  for (const response of [new Response(null, { status: 302, headers: { location: 'https://evil.example' } }),
    { status: 200, redirected: true, url: 'https://evil.example', json: async () => ({}) }]) {
    let calls = 0
    const result = await verify(createReadOnlyClient({ fetch: async () => { calls++; return response } }))
    assert.equal(result.state, 'read-failure')
    assert.equal(calls, 1)
  }
})

test('client has no arbitrary URL, command, publication or repair interface', async () => {
  let calls = 0
  const client = createReadOnlyClient({ fetch: async () => { calls++; throw new Error('must not read') } })
  assert.deepEqual(Object.keys(client).sort(), ['readAsset', 'readAssets', 'readRef', 'readRelease', 'readTag', 'readTags', 'readVersion'])
  assert.throws(() => client.readRelease('https://evil.example'), /invalid-version/)
  assert.throws(() => client.readTag('../secret'), /invalid-tag-sha/)
  await assert.rejects(client.readAsset('../secret'), /invalid-asset-id/)
  assert.equal(calls, 0)
})

test('CLI accepts exact flags and positional inputs, rejecting duplicate/unknown options and unsafe directories', () => {
  assert.deepEqual(parseCliArgs(['--version', VERSION, '--expected-sha', SHA, '--artifact-dir', 'local-artifacts']),
    { version: VERSION, expectedSha: SHA, artifactDir: 'local-artifacts' })
  assert.deepEqual(parseCliArgs([VERSION, SHA]), { version: VERSION, expectedSha: SHA, artifactDir: 'artifacts' })
  for (const args of [[], ['--version', VERSION], [VERSION, SHA, 'extra'],
    ['--version', VERSION, '--version', VERSION, '--expected-sha', SHA],
    [VERSION, SHA, '--registry', 'https://evil.example'], [VERSION, SHA, '--command', 'npm publish'],
    [VERSION, SHA, '--artifact-dir', 'https://evil.example'], [VERSION, SHA, '--artifact-dir', '\\\\server\\share'],
    [VERSION, SHA, '--artifact-dir', ''], [VERSION, SHA, '--artifact-dir', 'bad\npath']]) {
    assert.throws(() => parseCliArgs(args))
  }
})

test('CLI saves a minimal actual JSON receipt on success and all verification failure classes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'verify-published-npm-'))
  try {
    for (const mutate of [() => {}, ...failures.map(([, change]) => change)]) {
      const f = fixture()
      mutate(f)
      const result = await runCli(['--version', VERSION, '--expected-sha', SHA, '--artifact-dir', directory],
        { env: {}, fetch: f.fetch, log: () => {} })
      const saved = JSON.parse(await readFile(join(directory, RECEIPT_NAME), 'utf8'))
      assert.deepEqual(saved, result)
      assert.ok(saved.state)
    }
    let called = false
    const result = await runCli(['--version', 'malformed-secret', '--artifact-dir', directory],
      { env: {}, fetch: async () => { called = true }, log: () => {} })
    assert.equal(result.state, 'invalid-input')
    assert.equal(called, false)
    assert.deepEqual(JSON.parse(await readFile(join(directory, RECEIPT_NAME), 'utf8')), result)
    assert.ok(!JSON.stringify(result).includes('malformed-secret'))
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test('CLI attempts a failure receipt for transport errors and invalid token without disclosing details', async () => {
  for (const env of [{}, { GITHUB_TOKEN: 'synthetic secret' }]) {
    let saved
    const logs = []
    const result = await runCli([VERSION, SHA], { env,
      fetch: async () => { throw new Error('synthetic secret transport') },
      saveReceipt: async (_directory, receipt) => { saved = receipt }, log: text => logs.push(text) })
    assert.deepEqual(saved, result)
    assert.notEqual(result.state, 'success')
    assert.ok(!JSON.stringify([saved, logs]).includes('synthetic secret'))
  }
})

test('unwritable receipt destination is a failure, without exposing filesystem errors', async () => {
  const f = fixture()
  const logs = []
  const result = await runCli([VERSION, SHA], { env: {}, fetch: f.fetch,
    saveReceipt: async () => { throw new Error('private path') }, log: text => logs.push(text) })
  assert.equal(result.state, 'receipt-write-failed')
  assert.ok(!JSON.stringify([result, logs]).includes('private path'))
})

test('readback workflow is non-draft gated, read-only, dependency-free, and always preserves the receipt', async () => {
  const workflow = await readFile(new URL('../../.github/workflows/verify-published-npm.yml', import.meta.url), 'utf8')
  assert.match(workflow, /types: \[opened, synchronize, reopened, ready_for_review\]/)
  assert.match(workflow, /github\.event\.pull_request\.draft == false/)
  assert.match(workflow, /permissions:\s*\n\s+contents: read/)
  assert.doesNotMatch(workflow, /id-token:|packages:|contents: write|pull_request_target|secrets\.|NPM_TOKEN|NODE_AUTH_TOKEN/)
  assert.match(workflow, /persist-credentials: false/)
  assert.match(workflow, /package-manager-cache: false/)
  assert.doesNotMatch(workflow, /(?:npm|pnpm) (?:install|ci|publish|pack)|publish-npm\.mjs|download-artifact|npmrc/)
  assert.match(workflow, /run: node --test tests\/scripts\/verify-published-npm\.test\.mjs/)
  assert.match(workflow, /run: node scripts\/verify-published-npm\.mjs --version "\$VERIFY_VERSION" --expected-sha "\$VERIFY_SOURCE_SHA"/)
  assert.match(workflow, /if: always\(\)/)
  assert.match(workflow, /npm-publication-receipt\.json/)
})
