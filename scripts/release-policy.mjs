import { spawnSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPOSITORY = 'cloga/dsh-github-copilot'
const PACKAGE_NAME = 'dsh-github-copilot'
const importantPaths = new Set([
  'agent-contract.json', 'cordis.patch.yml', 'deployment-baseline.json',
  'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml',
  'tsconfig.json', 'tsconfig.tests.json', 'tsdown.config.ts', 'vitest.config.ts',
])
const importantPrefixes = ['src/', 'lib/', 'scripts/', '.github/workflows/']
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/

export function isImportantFile(file) {
  if (typeof file !== 'string') throw new Error('Changed file paths must be strings')
  const path = file.replaceAll('\\', '/').replace(/^(\.\/)+/, '')
  return importantPaths.has(path) || importantPrefixes.some(prefix => path.startsWith(prefix))
}

export function parseVersion(version) {
  if (typeof version !== 'string') throw new Error(`Invalid version ${JSON.stringify(version)}: expected canonical SemVer`)
  const match = semverPattern.exec(version)
  if (!match) throw new Error(`Invalid version ${JSON.stringify(version)}: expected canonical SemVer`)
  return {
    major: BigInt(match[1]), minor: BigInt(match[2]), patch: BigInt(match[3]),
    prerelease: match[4] === undefined ? [] : match[4].split('.'),
    build: match[5] === undefined ? [] : match[5].split('.'),
  }
}

export function compareVersions(left, right) {
  const a = parseVersion(left)
  const b = parseVersion(right)
  for (const key of ['major', 'minor', 'patch']) {
    if (a[key] !== b[key]) return a[key] > b[key] ? 1 : -1
  }
  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    if (a.prerelease.length === b.prerelease.length) return 0
    return a.prerelease.length === 0 ? 1 : -1
  }
  const length = Math.max(a.prerelease.length, b.prerelease.length)
  for (let index = 0; index < length; index++) {
    const leftId = a.prerelease[index]
    const rightId = b.prerelease[index]
    if (leftId === undefined || rightId === undefined) return leftId === undefined ? -1 : 1
    if (leftId === rightId) continue
    const leftNumeric = /^\d+$/.test(leftId)
    const rightNumeric = /^\d+$/.test(rightId)
    if (leftNumeric && rightNumeric) return BigInt(leftId) > BigInt(rightId) ? 1 : -1
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1
    return leftId > rightId ? 1 : -1
  }
  return 0
}

export function isPrereleaseVersion(version) {
  return parseVersion(version).prerelease.length > 0
}

function exactInstallUrl(version) {
  return `https://github.com/${REPOSITORY}/releases/download/v${version}/${PACKAGE_NAME}-${version}.tgz`
}

function assertReadmeMetadata(readme, label, version) {
  const url = exactInstallUrl(version)
  if (typeof readme !== 'string' || !readme.includes(url)) {
    throw new Error(`${label} must include the exact release install URL ${url}`)
  }
}

export function assertReleaseMetadata({ version, readme, readmeZh, baseline }) {
  parseVersion(version)
  assertReadmeMetadata(readme, 'README.md', version)
  assertReadmeMetadata(readmeZh, 'README.zh.md', version)
  if (!baseline || baseline.package?.name !== PACKAGE_NAME || baseline.package?.version !== version) {
    throw new Error(`deployment-baseline.json package must identify ${PACKAGE_NAME} at version ${version}`)
  }
  if (baseline.baseline?.source !== `https://github.com/${REPOSITORY}`) {
    throw new Error(`deployment-baseline.json baseline.source must be https://github.com/${REPOSITORY}`)
  }
}

export function assessChange({ baseManifest, manifest, files, readme, readmeZh, baseline }) {
  if (manifest?.name !== PACKAGE_NAME || baseManifest?.name !== PACKAGE_NAME) {
    throw new Error(`Both package manifests must identify ${PACKAGE_NAME}`)
  }
  const version = manifest.version
  const comparison = compareVersions(version, baseManifest.version)
  if (!Array.isArray(files)) throw new Error('Changed files must be an array')
  const important = files.some(isImportantFile)
  if (comparison < 0) throw new Error(`Version downgrade is forbidden: ${baseManifest.version} -> ${version}`)
  if (important && comparison <= 0) {
    throw new Error(`Important changes require a strictly newer SemVer than ${baseManifest.version}; update package.json, both READMEs, and deployment-baseline.json`)
  }
  const bumped = comparison > 0
  if (bumped) assertReleaseMetadata({ version, readme, readmeZh, baseline })
  return { important, bumped, version }
}

function assertSha(sha, label) {
  if (typeof sha !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(sha)) {
    throw new Error(`${label} must resolve to a full Git commit SHA`)
  }
}

export function assessPlan({ manifest, head, tagInfo = null, files = [], githubRef = '' }) {
  if (manifest?.name !== PACKAGE_NAME) throw new Error(`package.json must identify ${PACKAGE_NAME}`)
  const version = manifest.version
  parseVersion(version)
  assertSha(head, 'HEAD')
  const tag = `v${version}`
  const recovery = githubRef.startsWith('refs/tags/')
  if (recovery && githubRef !== `refs/tags/${tag}`) {
    throw new Error(`Tag recovery requires GITHUB_REF refs/tags/${tag}; received ${githubRef}`)
  }
  if (tagInfo === null) {
    if (recovery) throw new Error(`Tag recovery requires existing annotated tag ${tag} pointing to HEAD; fetch tags first`)
    return { release: true, tag, sha: head, prerelease: isPrereleaseVersion(version) }
  }
  if (tagInfo.type !== 'tag') throw new Error(`${tag} must be an annotated tag; lightweight tags are not accepted`)
  assertSha(tagInfo.sha, tag)
  if (tagInfo.manifest?.name !== PACKAGE_NAME) throw new Error(`${tag} package.json must identify ${PACKAGE_NAME}`)
  parseVersion(tagInfo.manifest.version)
  if (tagInfo.manifest.version !== version) throw new Error(`${tag} package.json version ${tagInfo.manifest.version} does not match ${version}`)
  if (tagInfo.sha === head) return { release: true, tag, sha: head, prerelease: isPrereleaseVersion(version) }
  if (recovery) throw new Error(`Tag recovery requires ${tag} to point to HEAD (${head})`)
  if (!Array.isArray(files)) throw new Error('Changed files must be an array')
  if (files.some(isImportantFile)) {
    throw new Error(`merged important changes lack a new version: ${tag} does not point to HEAD; bump package.json, both READMEs, and deployment-baseline.json`)
  }
  if (tagInfo.isAncestor !== true) throw new Error(`${tag} is not an ancestor of HEAD; fetch complete history and investigate the release tag`)
  // Re-run publication against the exact tagged commit even when only docs/tests
  // followed it. This reconciles a missing release, stranded draft, incomplete
  // assets, or an uncertain prior write instead of silently treating a tag as
  // proof that publication completed. An already immutable release is read-only.
  return { release: true, tag, sha: tagInfo.sha, prerelease: isPrereleaseVersion(version) }
}

export function parseChangedFiles(output) {
  if (output === '') return []
  if (typeof output !== 'string' || !output.endsWith('\0')) throw new Error('Expected NUL-terminated git diff --name-only -z output')
  return output.slice(0, -1).split('\0')
}

function parseJson(text, label) {
  try { return JSON.parse(text) } catch (error) { throw new Error(`Cannot parse ${label}: ${error.message}`) }
}

export function runCli(args, {
  cwd = process.cwd(), env = process.env,
  git = argv => spawnSync('git', argv, { cwd, encoding: 'utf8', shell: false }),
  appendOutput = (path, text) => appendFileSync(path, text, 'utf8'),
  log = text => console.log(text),
} = {}) {
  const planning = args.length === 1 && args[0] === '--plan'
  const checking = args.length === 2 && args[0] === '--base'
  if (!planning && !checking) throw new Error('Usage: node scripts/release-policy.mjs --base REF | --plan')
  const base = checking ? args[1] : null
  if (checking && (typeof base !== 'string' || !base || /^-/.test(base) || /[\0\r\n]/.test(base))) {
    throw new Error('--base requires a non-option Git ref without NUL or line breaks')
  }
  const invokeGit = (argv, allowMissing = false) => {
    const result = git(argv)
    if (result.status === 0) return result.stdout ?? ''
    if (allowMissing && result.status === 1) return null
    const detail = result.error?.message || result.stderr?.trim() || `exit ${result.status}`
    throw new Error(`git ${argv[0]} failed: ${detail}. Ensure the base ref, tags and complete history are fetched`)
  }
  const readHead = name => invokeGit(['show', `HEAD:${name}`])
  const changedSince = ref => parseChangedFiles(invokeGit(['diff', '--name-only', '-z', '--no-renames', ref, 'HEAD', '--']))
  const manifest = parseJson(readHead('package.json'), 'package.json')
  let decision
  if (checking) {
    decision = assessChange({
      baseManifest: parseJson(invokeGit(['show', `${base}:package.json`]), `${base}:package.json`),
      manifest, files: changedSince(base), readme: readHead('README.md'), readmeZh: readHead('README.zh.md'),
      baseline: parseJson(readHead('deployment-baseline.json'), 'deployment-baseline.json'),
    })
  } else {
    const head = invokeGit(['rev-parse', '--verify', 'HEAD^{commit}']).trim()
    const ref = `refs/tags/v${manifest.version}`
    const exists = invokeGit(['show-ref', '--verify', '--quiet', ref], true) !== null
    let tagInfo = null
    let files = []
    if (exists) {
      const type = invokeGit(['cat-file', '-t', ref]).trim()
      if (type !== 'tag') throw new Error(`${ref} must be an annotated tag; lightweight tags are not accepted`)
      const sha = invokeGit(['rev-parse', '--verify', `${ref}^{commit}`]).trim()
      tagInfo = {
        type, sha, manifest: parseJson(invokeGit(['show', `${ref}:package.json`]), `${ref}:package.json`),
        isAncestor: sha === head || invokeGit(['merge-base', '--is-ancestor', sha, head], true) !== null,
      }
      if (sha !== head) files = changedSince(sha)
    }
    decision = assessPlan({ manifest, head, tagInfo, files, githubRef: env.GITHUB_REF ?? '' })
    if (env.GITHUB_OUTPUT) appendOutput(env.GITHUB_OUTPUT, `release=${decision.release}\ntag=${decision.tag}\nsha=${decision.sha}\nprerelease=${decision.prerelease}\n`)
  }
  log(JSON.stringify(decision))
  return decision
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { runCli(process.argv.slice(2)) } catch (error) {
    console.error(`Release policy: ${error.message}`)
    process.exitCode = 1
  }
}
