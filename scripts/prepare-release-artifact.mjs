import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseVersion, isPrereleaseVersion } from './release-policy.mjs'

const REPOSITORY = 'cloga/dsh-github-copilot'
const check = (ok, message) => { if (!ok) throw new Error(message) }
const hash = bytes => createHash('sha256').update(bytes).digest('hex')

export async function recoverArtifact({ version, sha, release, annotation, assets, readAsset }) {
  parseVersion(version)
  check(/^[a-f0-9]{40}$/.test(sha), 'Exact release commit required')
  if (release === null) return null
  check(release.tag_name === `v${version}` && release.target_commitish === sha
    && typeof release.draft === 'boolean' && release.prerelease === isPrereleaseVersion(version),
  'Release metadata differs from planned version/commit')
  check(annotation?.tag === `v${version}` && annotation.object?.type === 'commit' && annotation.object.sha === sha,
    'Annotated tag does not match release commit')
  check(release.draft || release.immutable === true, 'Existing published Release must be immutable')
  const tarName = `dsh-github-copilot-${version}.tgz`
  const find = name => {
    const matches = assets.filter(a => a.name === name)
    check(matches.length <= 1, 'Duplicate release asset')
    return matches[0]
  }
  const tar = find(tarName)
  const sums = find('SHA256SUMS')
  if (!tar) {
    check(release.draft && !sums, 'Release artifact incomplete; refusing to repack existing partial bytes')
    return null
  }
  check(release.draft || sums, 'Published release checksum asset missing')
  const download = async asset => {
    check(Number.isSafeInteger(asset.id) && asset.id > 0 && asset.state === 'uploaded'
      && Number.isSafeInteger(asset.size) && asset.size > 0 && asset.size <= 32 * 1024 * 1024,
    'Invalid release asset metadata')
    const data = Buffer.from(await readAsset(asset.id))
    check(data.length === asset.size && `sha256:${hash(data)}` === asset.digest, 'Downloaded release asset digest differs')
    return data
  }
  const data = await download(tar)
  const expected = Buffer.from(`${hash(data)}  ${tarName}\n`)
  if (sums) check((await download(sums)).equals(expected), 'Release SHA256SUMS differs from original tarball')
  return [{ name: tarName, data }, { name: 'SHA256SUMS', data: expected }]
}

async function main() {
  check(process.argv.length === 2, 'Usage: node scripts/prepare-release-artifact.mjs')
  const root = fileURLToPath(new URL('..', import.meta.url))
  const { version } = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
  parseVersion(version)
  const sha = process.env.RELEASE_SHA
  check(process.env.GITHUB_REPOSITORY === REPOSITORY && /^[a-f0-9]{40}$/.test(sha ?? ''), 'Canonical release context required')
  check(execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() === sha, 'Checkout differs from planned release')
  const gh = args => {
    const result = spawnSync('gh', args, { encoding: 'buffer', shell: false, timeout: 60_000, maxBuffer: 32 * 1024 * 1024 })
    check(result.status === 0, 'GitHub artifact read failed; stopped without packing or publishing')
    return result.stdout
  }
  const json = path => JSON.parse(gh(['api', `repos/${REPOSITORY}${path}`]).toString('utf8'))
  const list = path => {
    const entries = []
    for (let page = 1; page <= 100; page++) {
      const batch = json(`${path}?per_page=100&page=${page}`)
      check(Array.isArray(batch), 'Invalid GitHub list')
      entries.push(...batch)
      if (batch.length < 100) return entries
    }
    throw new Error('GitHub list incomplete; refusing ambiguous recovery')
  }
  const releases = list('/releases').filter(r => r.tag_name === `v${version}`)
  check(releases.length <= 1, 'Duplicate release for planned version')
  const release = releases[0] ?? null
  let annotation
  let assets = []
  if (release) {
    check(Number.isSafeInteger(release.id) && release.id > 0, 'Invalid release id')
    const ref = json(`/git/ref/tags/v${version}`)
    check(ref.object?.type === 'tag' && /^[a-f0-9]{40}$/.test(ref.object.sha), 'Release tag must be annotated')
    annotation = json(`/git/tags/${ref.object.sha}`)
    assets = list(`/releases/${release.id}/assets`)
  }
  const recovered = await recoverArtifact({
    version, sha, release, annotation, assets,
    readAsset: id => gh(['api', `repos/${REPOSITORY}/releases/assets/${id}`, '-H', 'Accept: application/octet-stream']),
  })
  await mkdir(resolve(root, 'artifacts'), { recursive: true })
  if (recovered) {
    for (const file of recovered) await writeFile(resolve(root, 'artifacts', file.name), file.data, { flag: 'wx' })
    console.log('Recovered original release archive; no repack')
  } else {
    const packed = spawnSync('pnpm', ['--config.ignore-scripts=true', 'pack', '--pack-destination', 'artifacts'],
      { cwd: root, shell: false, stdio: 'inherit' })
    check(packed.status === 0, 'Release pack failed')
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main() } catch (error) {
    console.error(error instanceof Error ? error.message : 'Release artifact preparation failed')
    process.exitCode = 1
  }
}
