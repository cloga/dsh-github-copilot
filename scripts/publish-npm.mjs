import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, appendFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compareVersions, parseVersion } from './release-policy.mjs'
import { readTarball } from './verify-tarball.mjs'

const NAME = 'dsh-github-copilot'
const REGISTRY = 'https://registry.npmjs.org/'
const REPOSITORY = `cloga/${NAME}`
const check = (ok, message) => { if (!ok) throw new Error(message) }
const integrity = bytes => `sha512-${createHash('sha512').update(bytes).digest('base64')}`

export function distributionTag(version) {
  const parsed = parseVersion(version)
  check(parsed.build.length === 0, 'npm versions must not contain build metadata')
  const tag = parsed.prerelease[0] ?? 'latest'
  check(['alpha', 'beta', 'rc', 'latest'].includes(tag), 'Unsupported distribution channel')
  check(tag !== 'latest' || parsed.prerelease.length === 0, 'latest is stable-only')
  return tag
}

export function validatePublicPackage(pkg) {
  check(pkg?.name === NAME && pkg.private === undefined && pkg.type === 'module' && pkg.license === 'MIT',
    'Public package identity, private flag, module type or license differs')
  check(pkg.repository?.url === `git+https://github.com/${REPOSITORY}.git`, 'Public package repository differs')
  check(pkg.publishConfig?.registry === REGISTRY && pkg.publishConfig?.access === 'public'
    && pkg.publishConfig?.tag === distributionTag(pkg.version), 'Public package publishConfig differs')
  for (const hook of ['preinstall', 'install', 'postinstall']) {
    check(!Object.hasOwn(pkg.scripts ?? {}, hook), `Public package must not have ${hook}`)
  }
}

/** Network and process operations are injected; no writes are retried after an uncertain result. */
export async function publishNpm({ manifest, bytes, archive, readPackage, readVersion, publish }) {
  validatePublicPackage(manifest)
  check(bytes instanceof Uint8Array && bytes.length > 0, 'Verified archive bytes are required')
  const expected = integrity(bytes)
  const version = manifest.version
  const tag = distributionTag(version)
  const pkg = await readPackage()
  check(pkg?.name === NAME, 'npm package bootstrap is missing; package ownership and first publication require an authorized maintainer')
  const current = pkg['dist-tags']?.[tag]
  if (current !== undefined) {
    parseVersion(current)
    check(distributionTag(current) === tag, 'Registry dist-tag points to another channel')
  }
  const existing = await readVersion()
  const verify = remote => check(remote?.name === NAME && remote.version === version && remote.dist?.integrity === expected,
    'npm version integrity differs or is not yet observable; no overwrite or automatic retry')
  if (existing !== null) {
    verify(existing)
    check(current !== undefined && compareVersions(current, version) >= 0,
      'npm version exists but dist-tag is stranded; maintainer must review before repairing the tag')
    return { state: 'published', version, tag, integrity: expected, reconciled: true }
  }
  check(current === undefined || compareVersions(current, version) < 0,
    'Refusing to lower or overwrite a newer registry dist-tag')
  await publish(['publish', archive, '--tag', tag, '--access', 'public', '--registry', REGISTRY, '--ignore-scripts'])
  verify(await readVersion())
  const after = await readPackage()
  const afterTag = after?.['dist-tags']?.[tag]
  check(after?.name === NAME && typeof afterTag === 'string' && distributionTag(afterTag) === tag
    && compareVersions(afterTag, version) >= 0, 'npm dist-tag was not verified after publication')
  return { state: 'published', version, tag, integrity: expected, reconciled: false }
}

export function npmJson(args, { run = spawnSync } = {}) {
  const result = run('npm', [...args, '--json', '--registry', REGISTRY, '--fetch-retries=0', '--fetch-timeout=30000'], {
    encoding: 'utf8', shell: false, timeout: 60_000, maxBuffer: 4 * 1024 * 1024,
  })
  let data
  try { data = JSON.parse(result.stdout) } catch {
    throw new Error('npm read failed or returned invalid JSON; authentication/network errors are not absence')
  }
  if (result.status !== 0) {
    if (result.status !== null && data?.error?.code === 'E404') return null
    throw new Error('npm registry read failed; stopped without publishing')
  }
  check(data !== null && typeof data === 'object' && !Array.isArray(data) && !data.error, 'Invalid npm registry metadata')
  return data
}

export function npmPackageTags({ run = spawnSync } = {}) {
  // npm view without a version defaults to latest, which need not exist for an alpha-only package.
  const result = run('npm', ['dist-tag', 'ls', NAME, '--json', '--registry', REGISTRY,
    '--fetch-retries=0', '--fetch-timeout=30000'], {
    encoding: 'utf8', shell: false, timeout: 60_000, maxBuffer: 1024 * 1024,
  })
  if (result.status !== 0) {
    let data
    try { data = JSON.parse(result.stdout) } catch {
      throw new Error('npm tag read failed; authentication/network errors are not absence')
    }
    if (result.status !== null && data?.error?.code === 'E404') return null
    throw new Error('npm tag read failed; stopped without publishing')
  }
  // npm 11.5.1 dist-tag ls emits lines even with --json; pin and test that exact CLI contract.
  const tags = Object.create(null)
  for (const line of result.stdout.trim().split(/\r?\n/)) {
    const match = /^([A-Za-z][A-Za-z0-9._-]*): (\S+)$/.exec(line)
    check(match && !Object.hasOwn(tags, match[1]), 'Invalid or duplicate npm dist-tag response')
    tags[match[1]] = match[2]
  }
  return { name: NAME, 'dist-tags': tags }
}

async function main() {
  check(process.argv.length === 3, 'Usage: node scripts/publish-npm.mjs <version>')
  const version = process.argv[2]
  distributionTag(version)
  check(process.env.GITHUB_ACTIONS === 'true' && process.env.GITHUB_REPOSITORY === REPOSITORY
    && process.env.GITHUB_REF === 'refs/heads/main', 'Automatic npm publishing requires the canonical main CI context')
  check(process.env.ACTIONS_ID_TOKEN_REQUEST_URL && process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
    'Missing npm OIDC capability; configure the caller and child id-token permissions')
  check(!process.env.NODE_AUTH_TOKEN && !process.env.NPM_TOKEN, 'Automatic npm publishing must use OIDC, not persistent npm tokens')
  const root = fileURLToPath(new URL('..', import.meta.url))
  const archive = resolve(root, 'artifacts', `${NAME}-${version}.tgz`)
  const bytes = await readFile(archive)
  const files = readTarball(bytes)
  const manifest = JSON.parse(files.get('package/package.json')?.toString('utf8') ?? 'null')
  check(manifest?.version === version, 'Archive version differs from planned release')
  // GitHub verification immediately before this step establishes the exact tag/commit and asset digests.
  const sums = await readFile(resolve(root, 'artifacts', 'SHA256SUMS'), 'utf8')
  check(sums.trim() === `${createHash('sha256').update(bytes).digest('hex')}  ${NAME}-${version}.tgz`,
    'Archive SHA256SUMS differs')
  const result = await publishNpm({
    manifest, bytes, archive,
    readPackage: () => npmPackageTags(),
    readVersion: () => npmJson(['view', `${NAME}@${version}`]),
    publish: args => {
      const published = spawnSync('npm', args, { encoding: 'utf8', shell: false, timeout: 180_000,
        maxBuffer: 4 * 1024 * 1024, env: { ...process.env, NPM_CONFIG_FETCH_RETRIES: '0' } })
      check(published.status === 0, 'npm publish failed or has an uncertain outcome; no automatic retry. Rerun to reconcile integrity')
    },
  })
  console.log(JSON.stringify(result))
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY,
      `\nVerified npm ${NAME}@${version} (${result.tag})\n\nIntegrity: \`${result.integrity}\`\n`)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main() } catch (error) {
    console.error(error instanceof Error ? error.message : 'npm publication failed')
    process.exitCode = 1
  }
}
