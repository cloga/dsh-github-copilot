import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compareVersions, parseVersion } from './release-policy.mjs'

const NAME = 'dsh-github-copilot'
const REPOSITORY = `cloga/${NAME}`
const API = `https://api.github.com/repos/${REPOSITORY}`
const REGISTRY = 'https://registry.npmjs.org'
export const RECEIPT_NAME = 'npm-publication-receipt.json'
const sha40 = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value)
const idValid = value => Number.isSafeInteger(value) && value > 0
const hash = (bytes, algorithm, encoding = 'hex') => createHash(algorithm).update(bytes).digest(encoding)
const sriValid = value => typeof value === 'string' && /^sha512-[A-Za-z0-9+/]{86}==$/.test(value)

class VerificationError extends Error {
  constructor(state, reason, httpStatus) {
    super(reason)
    this.state = state
    this.reason = reason
    if (Number.isInteger(httpStatus)) this.httpStatus = httpStatus
  }
}
const check = (ok, state, reason) => { if (!ok) throw new VerificationError(state, reason) }

export function distributionTag(version) {
  let parsed
  try { parsed = parseVersion(version) } catch { throw new VerificationError('invalid-input', 'invalid-version') }
  check(parsed.build.length === 0, 'invalid-input', 'build-metadata-forbidden')
  const channel = parsed.prerelease[0] ?? 'latest'
  check(['alpha', 'beta', 'rc', 'latest'].includes(channel)
    && (channel !== 'latest' || parsed.prerelease.length === 0), 'invalid-input', 'unsupported-channel')
  return channel
}

function validateInputs(version, expectedSha) {
  const channel = distributionTag(version)
  check(sha40(expectedSha), 'invalid-input', 'invalid-expected-sha')
  return channel
}

/** Fixed GET-only transport. No npm configuration, credential discovery, shell, TLS overrides or retries. */
export function createReadOnlyClient({ fetch: fetchImpl = globalThis.fetch, token = '' } = {}) {
  check(typeof fetchImpl === 'function', 'invalid-input', 'fetch-unavailable')
  check(typeof token === 'string' && !/\s/.test(token), 'invalid-input', 'invalid-github-token')

  async function request(url, { github = false, asset = false, redirectedAsset = false } = {}) {
    let response
    try {
      response = await fetchImpl(url, {
        method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(60_000),
        headers: github ? {
          Accept: asset ? 'application/octet-stream' : 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        } : { Accept: redirectedAsset ? 'application/octet-stream' : 'application/json' },
      })
    } catch { throw new VerificationError('read-failure', 'transport-failed') }
    check(response && !response.redirected && (!response.url || response.url === url),
      'read-failure', 'unexpected-redirect')
    return response
  }

  async function json(url, github = false, absentVersion = false) {
    const response = await request(url, { github })
    if (response.status === 404 && absentVersion) return null
    if (response.status !== 200) throw new VerificationError('read-failure', 'http-status', response.status)
    let data
    try { data = await response.json() } catch { throw new VerificationError('read-failure', 'invalid-json') }
    check(data !== null && typeof data === 'object' && !Array.isArray(data) && !Object.hasOwn(data, 'error'),
      'read-failure', 'invalid-metadata')
    return data
  }

  const versionPath = version => { distributionTag(version); return version }
  const numericId = id => { check(idValid(id), 'invalid-input', 'invalid-asset-id'); return id }
  return {
    readRelease: version => json(`${API}/releases/tags/v${versionPath(version)}`, true),
    readRef: version => json(`${API}/git/ref/tags/v${versionPath(version)}`, true),
    readTag: sha => {
      check(sha40(sha), 'invalid-input', 'invalid-tag-sha')
      return json(`${API}/git/tags/${sha}`, true)
    },
    // An independent fixed assets endpoint avoids an incomplete embedded release asset list.
    async readAssets(id) {
      const response = await request(`${API}/releases/${numericId(id)}/assets?per_page=100&page=1`, { github: true })
      if (response.status !== 200) throw new VerificationError('read-failure', 'http-status', response.status)
      let data
      try { data = await response.json() } catch { throw new VerificationError('read-failure', 'invalid-json') }
      check(Array.isArray(data), 'read-failure', 'invalid-assets-list')
      // Exactly two assets are required; 100 results can never pass, so no pagination is necessary.
      return data
    },
    async readAsset(id) {
      let response = await request(`${API}/releases/assets/${numericId(id)}`, { github: true, asset: true })
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        let location
        try { location = new URL(response.headers.get('location')) } catch {
          throw new VerificationError('read-failure', 'untrusted-asset-redirect')
        }
        check(location.origin === 'https://release-assets.githubusercontent.com'
          && !location.username && !location.password && !location.hash
          && /^\/github-production-release-asset(?:-[A-Za-z0-9]+)?\//.test(location.pathname)
          && Boolean(location.searchParams.get('sig')),
        'read-failure', 'untrusted-asset-redirect')
        // Never forward the GitHub token (or any other authentication) across origins.
        response = await request(location.href, { redirectedAsset: true })
      }
      if (response.status !== 200) throw new VerificationError('read-failure', 'asset-http-status', response.status)
      try { return new Uint8Array(await response.arrayBuffer()) } catch {
        throw new VerificationError('read-failure', 'asset-body-failed')
      }
    },
    readVersion: version => json(`${REGISTRY}/${NAME}/${versionPath(version)}`, false, true),
    readTags: () => json(`${REGISTRY}/-/package/${NAME}/dist-tags`),
  }
}

function initialReceipt() {
  return { schemaVersion: 1, state: 'invalid-input', reason: 'invalid-arguments', readOnly: true }
}

/** Verification has no disk/process effects; all remote reads are injected and no write capability exists. */
export async function verifyPublishedNpm({ version, expectedSha, reads }) {
  const receipt = initialReceipt()
  let stage = 'input'
  try {
    const channel = validateInputs(version, expectedSha)
    const tag = `v${version}`
    const archiveName = `${NAME}-${version}.tgz`
    Object.assign(receipt, {
      version, expectedSha, tag, channel,
      sources: {
        release: `${API}/releases/tags/${tag}`,
        releasePage: `https://github.com/${REPOSITORY}/releases/tag/${tag}`,
        ref: `${API}/git/ref/tags/${tag}`,
        registry: `${REGISTRY}/${NAME}/${version}`,
        distTags: `${REGISTRY}/-/package/${NAME}/dist-tags`,
      },
    })
    stage = 'release'
    const release = await reads.readRelease(version)
    check(idValid(release?.id) && release.tag_name === tag && release.target_commitish === expectedSha
      && release.draft === false && release.immutable === true && release.prerelease === (channel !== 'latest'),
    'release-mismatch', 'release-metadata-mismatch')
    receipt.release = { id: release.id, tag: release.tag_name, targetCommit: release.target_commitish,
      draft: false, immutable: true, prerelease: release.prerelease }

    stage = 'tag'
    const ref = await reads.readRef(version)
    check(ref?.ref === `refs/tags/${tag}` && ref.object?.type === 'tag' && sha40(ref.object.sha),
      'tag-mismatch', 'annotated-tag-required')
    const tagObject = await reads.readTag(ref.object.sha)
    check(tagObject?.sha === ref.object.sha && tagObject.tag === tag
      && tagObject.object?.type === 'commit' && tagObject.object.sha === expectedSha,
    'tag-mismatch', 'tag-target-mismatch')
    receipt.sources.tagObject = `${API}/git/tags/${ref.object.sha}`
    receipt.tagObject = { sha: ref.object.sha, commit: tagObject.object.sha, type: 'tag' }

    stage = 'assets'
    const assets = await reads.readAssets(release.id)
    check(Array.isArray(assets) && assets.length === 2, 'asset-mismatch', 'exact-two-assets-required')
    const expectedNames = [archiveName, 'SHA256SUMS']
    const selected = expectedNames.map(name => {
      const matches = assets.filter(asset => asset?.name === name)
      check(matches.length === 1, 'asset-mismatch', 'asset-name-mismatch')
      const asset = matches[0]
      check(idValid(asset.id) && asset.state === 'uploaded' && idValid(asset.size)
        && typeof asset.digest === 'string' && /^sha256:[a-f0-9]{64}$/.test(asset.digest),
      'asset-mismatch', 'asset-metadata-mismatch')
      return asset
    })
    check(selected[0].id !== selected[1].id, 'asset-mismatch', 'duplicate-asset-id')
    const contents = []
    receipt.assets = []
    for (const asset of selected) {
      const bytes = await reads.readAsset(asset.id)
      check(bytes instanceof Uint8Array && bytes.length === asset.size,
        'asset-mismatch', 'asset-size-mismatch')
      const sha256 = hash(bytes, 'sha256')
      check(asset.digest === `sha256:${sha256}`, 'asset-mismatch', 'asset-digest-mismatch')
      contents.push(bytes)
      receipt.assets.push({ name: asset.name, id: asset.id, size: asset.size, sha256,
        source: `${API}/releases/assets/${asset.id}` })
    }
    const archive = contents[0]
    const sha256 = hash(archive, 'sha256')
    const checksum = Buffer.from(contents[1]).toString('utf8')
    const lines = checksum.split(/\r?\n/)
    if (lines.at(-1) === '') lines.pop()
    const entry = lines.length === 1 ? /^([a-fA-F0-9]{64}) [ *](\S+)$/.exec(lines[0]) : null
    check(entry && entry[2] === archiveName && entry[1].toLowerCase() === sha256,
      'asset-mismatch', 'checksum-mismatch')
    const integrity = `sha512-${hash(archive, 'sha512', 'base64')}`
    const shasum = hash(archive, 'sha1')
    receipt.archive = { name: archiveName, size: archive.length, sha256, integrity, shasum }

    stage = 'registry-version'
    const remote = await reads.readVersion(version)
    check(remote !== null, 'missing-version', 'registry-version-404')
    check(remote?.name === NAME && remote.version === version, 'integrity-mismatch', 'registry-identity-mismatch')
    // Only bounded, syntactically checked public leaves enter the receipt; never copy a metadata body.
    receipt.registry = { name: remote.name, version: remote.version,
      integrity: sriValid(remote.dist?.integrity) ? remote.dist.integrity : null }
    if (sha40(remote.dist?.shasum)) receipt.registry.shasum = remote.dist.shasum
    check(remote.dist?.integrity === integrity, 'integrity-mismatch', 'registry-integrity-mismatch')
    check(remote.dist.shasum === undefined || remote.dist.shasum === shasum,
      'integrity-mismatch', 'registry-shasum-mismatch')

    stage = 'registry-tags'
    const tags = await reads.readTags()
    const current = tags?.[channel]
    receipt.registry.distTag = { name: channel, version: null }
    let currentChannel
    try { currentChannel = distributionTag(current) } catch {
      throw new VerificationError('tag-stranded', current === undefined ? 'dist-tag-missing' : 'dist-tag-invalid')
    }
    receipt.registry.distTag.version = current
    check(currentChannel === channel, 'tag-stranded', 'dist-tag-channel-mismatch')
    check(compareVersions(current, version) >= 0, 'tag-stranded', 'dist-tag-older')
    receipt.state = 'success'
    receipt.reason = 'publication-verified'
  } catch (error) {
    receipt.state = error instanceof VerificationError ? error.state : 'read-failure'
    receipt.reason = error instanceof VerificationError ? error.reason : 'read-failed'
    if (error instanceof VerificationError && error.httpStatus !== undefined) receipt.httpStatus = error.httpStatus
    receipt.stage = stage
  }
  return receipt
}

function localDirectory(value) {
  return typeof value === 'string' && value.length > 0 && !value.startsWith('-')
    && !/[\0\r\n]/.test(value) && !/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value)
    && !/^(?:\\\\|\/\/)/.test(value)
}

export function parseCliArgs(args) {
  const options = { artifactDir: 'artifacts' }
  const positional = []
  const seen = new Set()
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (['--version', '--expected-sha', '--artifact-dir'].includes(arg)) {
      check(!seen.has(arg) && typeof args[index + 1] === 'string' && !args[index + 1].startsWith('--'),
        'invalid-input', 'invalid-arguments')
      seen.add(arg)
      options[{ '--version': 'version', '--expected-sha': 'expectedSha', '--artifact-dir': 'artifactDir' }[arg]] = args[++index]
    } else {
      check(typeof arg === 'string' && !arg.startsWith('-'), 'invalid-input', 'invalid-arguments')
      positional.push(arg)
    }
  }
  if (positional.length) {
    check(positional.length === 2 && options.version === undefined && options.expectedSha === undefined,
      'invalid-input', 'invalid-arguments')
    ;[options.version, options.expectedSha] = positional
  }
  validateInputs(options.version, options.expectedSha)
  check(localDirectory(options.artifactDir), 'invalid-input', 'invalid-artifact-directory')
  return options
}

/** Always attempt a receipt, including malformed input. An unwritable directory is reported without OS details. */
export async function runCli(args, {
  cwd = process.cwd(), env = process.env, fetch: fetchImpl = globalThis.fetch,
  saveReceipt = async (directory, receipt) => {
    await mkdir(directory, { recursive: true })
    await writeFile(resolve(directory, RECEIPT_NAME), `${JSON.stringify(receipt, null, 2)}\n`, 'utf8')
  },
  log = text => console.log(text),
} = {}) {
  let receipt = initialReceipt()
  let artifactDir = 'artifacts'
  // Retain a single safe explicit destination even when another CLI argument is invalid.
  const destinations = args.flatMap((arg, index) => arg === '--artifact-dir' ? [args[index + 1]] : [])
  if (destinations.length === 1 && localDirectory(destinations[0])) artifactDir = destinations[0]
  try {
    const options = parseCliArgs(args)
    artifactDir = options.artifactDir
    const reads = createReadOnlyClient({ fetch: fetchImpl, token: env.GITHUB_TOKEN ?? '' })
    receipt = await verifyPublishedNpm({ ...options, reads })
  } catch (error) {
    receipt.reason = error instanceof VerificationError ? error.reason : 'invalid-arguments'
  }
  try { await saveReceipt(resolve(cwd, artifactDir), receipt) } catch {
    log('npm verification: receipt-write-failed; no publication attempted')
    return { ...receipt, state: 'receipt-write-failed', reason: 'receipt-write-failed' }
  }
  log(`npm verification: ${receipt.state} (${receipt.reason}); no publication attempted`)
  return receipt
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const receipt = await runCli(process.argv.slice(2))
  process.exitCode = receipt.state === 'success' ? 0 : 1
}
