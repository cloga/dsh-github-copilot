import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compareVersions } from './release-policy.mjs'
import { recoverArtifact } from './prepare-release-artifact.mjs'
import { npmJson, npmPackageTags, validatePublicPackage } from './publish-npm.mjs'
import { readTarball } from './verify-tarball.mjs'

export const BOOTSTRAP = Object.freeze({
  repository: 'cloga/dsh-github-copilot',
  name: 'dsh-github-copilot',
  version: '0.4.0-alpha.18',
  tag: 'v0.4.0-alpha.18',
  sha: '08bfccc3b5930b93ef2fe31d9cf9e509f34a8704',
  tarName: 'dsh-github-copilot-0.4.0-alpha.18.tgz',
  tarSize: 538911,
  tarSha256: '2ca4f604e89eda3000cf2a51d79871cee3cb721fa6f4324fc9a1197926c359a8',
  tarIntegrity: 'sha512-FZdWZbb/K8jmE64Gwb9ZU+UADAqakAfqLXrru/qpLFSS4qC4LMO0uIcU1Kbsw1Cg55xf0q+ZSbn0y3cdyDzLXw==',
  sumsSize: 104,
  sumsSha256: 'caf7a63a46764b499df15acd6eca020b449ca34bd868f7064712c29df53a5293',
})

const REGISTRY = 'https://registry.npmjs.org/'
const root = fileURLToPath(new URL('..', import.meta.url))
const artifacts = resolve(root, 'artifacts', 'npm-bootstrap')
const check = (ok, message) => { if (!ok) throw new Error(message) }
const digest = (algorithm, bytes) => createHash(algorithm).update(bytes).digest(algorithm === 'sha512' ? 'base64' : 'hex')

export function validateBootstrapContext(env, mode) {
  check(env.GITHUB_ACTIONS === 'true' && env.GITHUB_EVENT_NAME === 'workflow_dispatch',
    'Bootstrap is restricted to a manual GitHub Actions dispatch')
  check(env.GITHUB_REPOSITORY === BOOTSTRAP.repository && env.GITHUB_REF === 'refs/heads/main',
    'Bootstrap must run from the canonical main branch')
  check(env.BOOTSTRAP_VERSION === BOOTSTRAP.version, 'Only the fixed bootstrap version is allowed')
  if (mode === 'prepare') {
    check(env.GH_TOKEN && !env.NODE_AUTH_TOKEN && !env.NPM_TOKEN,
      'Release preparation requires only the GitHub Actions token')
  } else {
    check(env.NODE_AUTH_TOKEN && !env.NPM_TOKEN && !env.GH_TOKEN && !env.GITHUB_TOKEN,
      'The npm token must be exposed only as NODE_AUTH_TOKEN in the publish step')
  }
}

export function verifyBootstrapArchive(bytes, expected = BOOTSTRAP) {
  check(bytes instanceof Uint8Array && bytes.length === expected.tarSize, 'Release tarball size differs')
  check(digest('sha256', bytes) === expected.tarSha256, 'Release tarball SHA-256 differs')
  check(`sha512-${digest('sha512', bytes)}` === expected.tarIntegrity, 'Release tarball SRI differs')
  const files = readTarball(bytes)
  const parse = name => {
    const content = files.get(`package/${name}`)
    check(content, `Release tarball is missing ${name}`)
    return JSON.parse(content.toString('utf8'))
  }
  const manifest = parse('package.json')
  const baseline = parse('deployment-baseline.json')
  validatePublicPackage(manifest)
  check(manifest.version === expected.version && baseline.package?.version === expected.version,
    'Release tarball manifest or deployment baseline version differs')
  for (const name of ['LICENSE', 'README.md', 'README.zh.md']) {
    check(files.has(`package/${name}`), `Release tarball is missing ${name}`)
  }
  for (const target of Object.values(manifest.exports ?? {})) {
    for (const path of typeof target === 'string' ? [target] : Object.values(target)) {
      check(typeof path === 'string' && files.has(`package/${path.replace(/^\.\//u, '')}`),
        'Release tarball is missing a public export')
    }
  }
  return manifest
}

export async function verifyBootstrapRelease({ release, annotation, assets: remoteAssets, readAsset, expected = BOOTSTRAP }) {
  check(release?.tag_name === expected.tag && release.target_commitish === expected.sha
    && release.name === `${expected.name} ${expected.version}` && release.body === `Release ${expected.tag}.`
    && release.draft === false && release.prerelease === true && release.immutable === true,
  'Immutable Release metadata differs from the fixed bootstrap release')
  check(annotation?.tag === expected.tag && annotation.message === `Release ${expected.tag}`
    && annotation.object?.type === 'commit' && annotation.object.sha === expected.sha,
  'Annotated release tag differs from the fixed bootstrap commit')
  const expectedAssets = [
    { name: expected.tarName, size: expected.tarSize, digest: `sha256:${expected.tarSha256}` },
    { name: 'SHA256SUMS', size: expected.sumsSize, digest: `sha256:${expected.sumsSha256}` },
  ]
  check(Array.isArray(remoteAssets) && remoteAssets.length === expectedAssets.length,
    'Release must contain exactly the tarball and SHA256SUMS assets')
  for (const asset of expectedAssets) {
    const matches = remoteAssets.filter(item => item?.name === asset.name)
    check(matches.length === 1 && matches[0].state === 'uploaded' && matches[0].size === asset.size
      && matches[0].digest === asset.digest, `Release asset metadata differs for ${asset.name}`)
  }
  const recovered = await recoverArtifact({
    version: expected.version,
    sha: expected.sha,
    release,
    annotation,
    assets: remoteAssets,
    readAsset,
  })
  check(recovered?.length === 2, 'Immutable Release assets were not recovered')
  const tar = recovered.find(file => file.name === expected.tarName)
  const sums = recovered.find(file => file.name === 'SHA256SUMS')
  check(tar && sums && sums.data.toString('utf8') === `${expected.tarSha256}  ${expected.tarName}\n`,
    'Release checksum manifest differs from the fixed bootstrap checksum')
  verifyBootstrapArchive(tar.data, expected)
  return recovered
}

export async function bootstrapNpm({ bytes, archive, readPackage, readVersion, publish, expected = BOOTSTRAP }) {
  verifyBootstrapArchive(bytes, expected)
  const pkg = await readPackage()
  const existing = await readVersion()
  const verifyVersion = value => check(value?.name === expected.name && value.version === expected.version
    && value.dist?.integrity === expected.tarIntegrity, 'npm version integrity differs from the immutable Release')
  const verifyTag = value => {
    const alpha = value?.['dist-tags']?.alpha
    check(value?.name === expected.name && typeof alpha === 'string'
      && compareVersions(alpha, expected.version) >= 0, 'npm alpha tag is missing or older than the bootstrap version')
  }
  if (pkg !== null) {
    check(existing !== null,
      'npm package exists but the fixed version is absent; maintainer review and explicit ownership approval are required')
    verifyVersion(existing)
    verifyTag(pkg)
    return { state: 'verified', version: expected.version, tag: 'alpha', integrity: expected.tarIntegrity }
  }
  check(existing === null, 'npm registry returned inconsistent package absence')
  await publish(['publish', archive, '--tag', 'alpha', '--access', 'public', '--ignore-scripts', `--registry=${REGISTRY}`])
  verifyVersion(await readVersion())
  verifyTag(await readPackage())
  return { state: 'published', version: expected.version, tag: 'alpha', integrity: expected.tarIntegrity }
}

function gh(args) {
  const result = spawnSync('gh', args, {
    encoding: 'buffer',
    shell: false,
    timeout: 60_000,
    maxBuffer: 32 * 1024 * 1024,
    env: process.env,
  })
  check(result.status === 0, 'GitHub release read failed; stopped without npm access')
  return result.stdout
}

function ghJson(path) {
  try { return JSON.parse(gh(['api', `repos/${BOOTSTRAP.repository}${path}`]).toString('utf8')) } catch {
    throw new Error('GitHub release metadata was invalid; stopped without npm access')
  }
}

async function prepare() {
  validateBootstrapContext(process.env, 'prepare')
  const release = ghJson(`/releases/tags/${BOOTSTRAP.tag}`)
  check(Number.isSafeInteger(release.id) && release.id > 0, 'Invalid immutable Release id')
  const ref = ghJson(`/git/ref/tags/${BOOTSTRAP.tag}`)
  check(ref.object?.type === 'tag' && /^[a-f0-9]{40}$/u.test(ref.object.sha), 'Release tag must be annotated')
  const annotation = ghJson(`/git/tags/${ref.object.sha}`)
  const remoteAssets = ghJson(`/releases/${release.id}/assets?per_page=100`)
  const recovered = await verifyBootstrapRelease({
    release,
    annotation,
    assets: remoteAssets,
    readAsset: id => gh(['api', `repos/${BOOTSTRAP.repository}/releases/assets/${id}`,
      '-H', 'Accept: application/octet-stream']),
  })
  await mkdir(artifacts, { recursive: true })
  for (const file of recovered) await writeFile(resolve(artifacts, file.name), file.data, { flag: 'wx' })
  console.log(`Verified immutable Release ${BOOTSTRAP.tag} at ${BOOTSTRAP.sha}`)
}

async function publish() {
  validateBootstrapContext(process.env, 'publish')
  const archive = resolve(artifacts, BOOTSTRAP.tarName)
  const bytes = await readFile(archive)
  const result = await bootstrapNpm({
    bytes,
    archive,
    readPackage: () => npmPackageTags(),
    readVersion: () => npmJson(['view', `${BOOTSTRAP.name}@${BOOTSTRAP.version}`]),
    publish: args => {
      const written = spawnSync('npm', args, {
        encoding: 'utf8',
        shell: false,
        timeout: 180_000,
        maxBuffer: 4 * 1024 * 1024,
        env: {
          ...process.env,
          NPM_CONFIG_FETCH_RETRIES: '0',
          NPM_CONFIG_IGNORE_SCRIPTS: 'true',
          NPM_CONFIG_LOGLEVEL: 'silent',
          NPM_CONFIG_LOGS_MAX: '0',
        },
      })
      check(written.status === 0,
        'npm publish failed or requires OTP/2FA; outcome was not retried or reported as success')
    },
  })
  console.log(`npm ${result.state}: ${BOOTSTRAP.name}@${result.version} (${result.tag}) ${result.integrity}`)
}

async function main() {
  check(process.argv.length === 3 && ['prepare', 'publish'].includes(process.argv[2]),
    'Usage: node scripts/bootstrap-npm.mjs <prepare|publish>')
  await (process.argv[2] === 'prepare' ? prepare() : publish())
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main() } catch (error) {
    console.error(error instanceof Error ? error.message : 'npm bootstrap failed')
    process.exitCode = 1
  }
}
