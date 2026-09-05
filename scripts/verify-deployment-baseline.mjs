import { access, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

async function read(path) {
  return readFile(resolve(root, path), 'utf8')
}

async function readJson(path) {
  return JSON.parse(await read(path))
}

function assert(condition, message) {
  if (!condition) throw new Error(`deployment baseline verification failed: ${message}`)
}

const packageJson = await readJson('package.json')
const manifest = await readJson('deployment-baseline.json')
const readme = await read('README.md')
const readmeZh = await read('README.zh.md')
const releaseWorkflow = (await read('.github/workflows/release.yml')).replaceAll('\r\n', '\n')
const releaseTag = `v${packageJson.version}`
const releaseAsset = `dsh-github-copilot-${packageJson.version}.tgz`
const releaseBaseUrl = `https://github.com/cloga/dsh-github-copilot/releases/download/${releaseTag}`
const releaseUrl = `${releaseBaseUrl}/${releaseAsset}`
const releaseChecksumUrl = `${releaseBaseUrl}/SHA256SUMS`

assert(manifest.schemaVersion === 1, 'schemaVersion must be 1')
assert(manifest.baseline?.kind === 'standalone-dsh-plugin', 'standalone ownership marker is missing')
assert(manifest.baseline?.source === 'https://github.com/cloga/dsh-github-copilot', 'canonical source changed')
assert(manifest.package?.name === packageJson.name, 'package name differs')
assert(manifest.package?.version === packageJson.version, 'package version differs')
assert(packageJson.private === true, 'package must remain private for GitHub Release-only distribution')
for (const [path, content] of [['README.md', readme], ['README.zh.md', readmeZh]]) {
  const urls = content.match(/https:\/\/github\.com\/cloga\/dsh-github-copilot\/releases\/download\/v[^\s/)]+\/[^\s)]+/g) ?? []
  assert(urls.filter(url => url === releaseUrl).length === 2, `${path} must use the current tarball URL for install and verification`)
  assert(urls.filter(url => url === releaseChecksumUrl).length === 1, `${path} checksum URL differs from package version`)
  assert(urls.every(url => url === releaseUrl || url === releaseChecksumUrl), `${path} contains a stale release URL`)
  assert(content.includes(`dsh plugin --profile web add ${releaseUrl}`), `${path} install command must name the target profile and current asset`)
  assert(content.includes('sha256sum --check SHA256SUMS'), `${path} must document release checksum verification`)
}
assert(readme.includes('[简体中文](./README.zh.md)'), 'README.md must link the Chinese guide')
assert(readmeZh.includes('[English](./README.md)'), 'README.zh.md must link the English guide')
assert(manifest.supportedBaselines?.node === packageJson.engines?.node, 'Node baseline differs')
assert(packageJson.engines.node === '>=22.19.0', 'Node floor must cover the pi-ai runtime dependency')
assert(
  packageJson.dependencies?.['@earendil-works/pi-ai'] === manifest.supportedBaselines?.piAi,
  'pi-ai runtime range differs',
)
for (const [dependency, range] of Object.entries(manifest.supportedBaselines?.runtimeDependencies ?? {})) {
  assert(packageJson.dependencies?.[dependency] === range, `${dependency} runtime range differs`)
}
assert(
  manifest.capabilities?.some(capability => capability.id === 'strict-remote-result-codecs'),
  'strict Remote result codec capability is missing',
)
assert(
  manifest.capabilities?.some(capability => capability.id === 'strict-json-oauth-grant-normalization'),
  'strict JSON OAuth grant normalization capability is missing',
)

const peerRange = manifest.supportedBaselines?.dsh?.peerRange
assert(
  peerRange === '0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.3-alpha.1',
  'DSH peer range must target alpha.1, rc.2, and rc.1',
)
const dshBaselines = manifest.supportedBaselines?.dsh?.baselines ?? []
assert(dshBaselines.length === 3, 'exactly three DSH baselines must be declared')
assert(
  dshBaselines.some(entry => entry.release === '0.1.1-rc.2'
    && entry.commit === 'a772dbbde82780bff2b9394427e9f0a24cafa1d5'
    && entry.basedOnCommit === 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e'
    && entry.source === 'https://github.com/cloga/deepseek-harness'
    && entry.branch === 'cloga-pi-ai-model-api'
    && entry.modelsUi === 'settings-section-fallback'
    && entry.perModelApi === 'model-entry'),
  'controlled DSH Desktop rc.2 baseline is missing',
)
assert(
  dshBaselines.some(entry => entry.release === '0.1.2-rc.1'
    && entry.commit === 'a66e4702047846cdaa10c66c9d3df3951f5ea70d'
    && entry.modelsUi === 'provider-card'
    && entry.providerHeaders === 'fetch-validated-discovery'),
  'DSH rc.1 baseline is missing',
)
assert(
  dshBaselines.some(entry => entry.release === '0.1.3-alpha.1'
    && entry.tag === 'dsh-v0.1.3-alpha.1'
    && entry.commit === 'd347e703908d0406b7a7ef80e3a0e594d86b2215'
    && entry.modelsUi === 'provider-card'
    && entry.providerHeaders === 'fetch-validated-discovery'
    && entry.fileContentHelper === 'contentHasFile'),
  'DSH alpha.1 baseline is missing',
)
for (const dependency of manifest.supportedBaselines?.dsh?.packages ?? []) {
  assert(packageJson.peerDependencies?.[dependency] === peerRange, `${dependency} peer range differs`)
  assert(
    packageJson.devDependencies?.[dependency] === `^${manifest.supportedBaselines.dsh.developmentRelease}`,
    `${dependency} development dependency range differs`,
  )
}

const compatibility = await read('src/compatibility.ts')
assert(compatibility.includes(`peerRange: '${peerRange}'`), 'runtime compatibility range differs')
assert(
  compatibility.includes(`developmentRelease: '${manifest.supportedBaselines.dsh.developmentRelease}'`),
  'runtime development release differs',
)

for (const capability of manifest.capabilities ?? []) {
  assert(capability.required === true, `${capability.id} must be required`)
  assert(capability.sourceMarkers?.length > 0, `${capability.id} has no source evidence`)
  assert(capability.tests?.length > 0, `${capability.id} has no test evidence`)
  for (const evidence of capability.sourceMarkers) {
    assert((await read(evidence.file)).includes(evidence.marker), `${capability.id} marker missing from ${evidence.file}`)
  }
  for (const test of capability.tests) {
    assert((await read(test.file)).includes(`it('${test.name}'`), `${capability.id} test missing: ${test.name}`)
  }
}

const index = await read('src/index.ts')
for (const symbol of manifest.requiredExports?.['.'] ?? []) {
  assert(index.includes(symbol), `root export ${symbol} is missing`)
}
const expectedExportSubpaths = ['.', './client', './remote', './deployment-baseline.json', './package.json']
const declaredExportSubpaths = Object.keys(manifest.requiredExports ?? {}).sort()
const packageExportSubpaths = Object.keys(packageJson.exports ?? {}).sort()
assert(JSON.stringify(declaredExportSubpaths) === JSON.stringify([...expectedExportSubpaths].sort()), 'required export inventory differs')
assert(JSON.stringify(packageExportSubpaths) === JSON.stringify([...expectedExportSubpaths].sort()), 'package export set differs')

for (const obsolete of ['src/model-catalog.ts', 'src/copilot-provider.ts']) {
  try {
    await access(resolve(root, obsolete))
    assert(false, `obsolete gateway owner ${obsolete} still exists`)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
}

const guardedSources = [
  'src/index.ts',
  'src/plan.ts',
  'src/copilot-auth.ts',
  'src/copilot-grant.ts',
  'package.json',
  'cordis.patch.yml',
]
for (const path of guardedSources) {
  const source = await read(path)
  assert(!source.includes('copilot2api'), `${path} retains an external proxy dependency`)
  assert(!source.includes('COPILOT_GITHUB_TOKEN'), `${path} retains a placeholder token dependency`)
}

const agents = await read('AGENTS.md')
for (const heading of [
  '## Product and architecture',
  '## File map',
  '## Non-negotiable invariants',
  '## Supported DSH seams',
  '## Distribution and release invariants',
  '## Mechanical verification',
  '## Issue, branch, and PR workflow',
]) {
  assert(agents.includes(heading), `AGENTS.md is missing ${heading}`)
}
assert((await read('CLAUDE.md')).includes('[AGENTS.md](./AGENTS.md)'), 'CLAUDE.md must link AGENTS.md')
assert((await read('CONTRIBUTING.md')).includes('GitHub Releases are the only distribution channel'), 'CONTRIBUTING.md release contract is missing')
assert((await read('SECURITY.md')).includes('/security/advisories/new'), 'SECURITY.md private reporting path is missing')
assert((await read('.github/PULL_REQUEST_TEMPLATE.md')).includes('## Contract checklist'), 'pull request contract checklist is missing')
assert((await read('.github/ISSUE_TEMPLATE/bug.yml')).includes('DSH baseline'), 'bug issue form is missing the DSH baseline')

for (const path of [
  'AGENTS.md',
  'CONTRIBUTING.md',
  'README.md',
  'README.zh.md',
  '.github/ISSUE_TEMPLATE/bug.yml',
  '.github/PULL_REQUEST_TEMPLATE.md',
]) {
  const source = await read(path)
  assert(!source.includes('0.1.2-alpha.5'), `${path} retains the superseded alpha.5 release`)
  assert(!source.includes('db6bdc3576c2d4e7c965e8e3ed0c2a731eed87f5'), `${path} retains the superseded alpha.5 commit`)
}

const workflow = await read('.github/workflows/ci.yml')
for (const command of [
  'a772dbbde82780bff2b9394427e9f0a24cafa1d5',
  'repository: cloga/deepseek-harness',
  'a66e4702047846cdaa10c66c9d3df3951f5ea70d',
  'd347e703908d0406b7a7ef80e3a0e594d86b2215',
  'pnpm install --frozen-lockfile',
  "pnpm install --frozen-lockfile --filter '@deepseek-ai/dsh-llm-pi-ai...'",
  'pnpm verify:upstream -- dsh-upstream',
  'pnpm verify:controlled-core -- dsh-upstream',
  'pnpm verify',
  'pnpm pack --pack-destination artifacts',
]) {
  assert(workflow.includes(command), `CI is missing ${command}`)
}
for (const marker of [
  "tags:\n      - 'v*'",
  'permissions:\n  contents: write',
  'runs-on: ubuntu-latest',
  'if [[ "$GITHUB_REF_NAME" != "v$version" ]]',
  'git cat-file -t "refs/tags/$GITHUB_REF_NAME"',
  'if [[ "$tag_type" != "tag" ]]',
  'if [[ "$version" =~ -(alpha|beta|rc)\\. ]]',
  'release_flags+=(--prerelease)',
  'd347e703908d0406b7a7ef80e3a0e594d86b2215',
  'pnpm verify:upstream -- dsh-upstream',
  'pnpm verify:controlled-core -- dsh-upstream',
]) {
  assert(releaseWorkflow.includes(marker), `Release workflow is missing ${marker}`)
}
const orderedReleaseSteps = [
  '- name: Verify tag matches package version',
  '- run: pnpm install --frozen-lockfile',
  '- name: Install alpha.1 Core pi-ai closure',
  '- run: pnpm verify:upstream -- dsh-upstream',
  '- run: pnpm verify:controlled-core -- dsh-upstream',
  '- name: Verify plugin package',
  '- run: pnpm pack --pack-destination artifacts',
  '- name: Verify packed archive',
  'pnpm verify:tarball --',
  '- name: Write SHA-256 manifest',
  'sha256sum -- *.tgz > SHA256SUMS',
  'sha256sum --check SHA256SUMS',
  '- name: Create GitHub Release',
  'gh release create "$GITHUB_REF_NAME" artifacts/*.tgz artifacts/SHA256SUMS',
]
let priorReleaseStep = -1
for (const step of orderedReleaseSteps) {
  const index = releaseWorkflow.indexOf(step)
  assert(index > priorReleaseStep, `Release workflow step is missing or out of order: ${step}`)
  priorReleaseStep = index
}
try {
  await access(resolve(root, '.github/workflows/publish.yml'))
  assert(false, 'obsolete npm Publish workflow still exists')
} catch (error) {
  if (error?.code !== 'ENOENT') throw error
}

const patch = await read('cordis.patch.yml')
assert(!/^\s*(?:-\s*)?searchProvider\s*:/mu.test(patch), 'bundle must not override the profile-wide search provider')
assert((patch.match(/^- insert:/gmu) ?? []).length === 1, 'bundle patch must have one insert')
assert((patch.match(/^\s+- id: github-copilot$/gmu) ?? []).length === 1, 'bundle patch must have one integration entry')

console.log(`Verified ${manifest.baseline.id} ${manifest.package.version} (${manifest.capabilities.length} capabilities).`)
