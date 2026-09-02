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

assert(manifest.schemaVersion === 1, 'schemaVersion must be 1')
assert(manifest.baseline?.kind === 'standalone-dsh-plugin', 'standalone ownership marker is missing')
assert(manifest.baseline?.source === 'https://github.com/cloga/dsh-github-copilot', 'canonical source changed')
assert(manifest.package?.name === packageJson.name, 'package name differs')
assert(manifest.package?.version === packageJson.version, 'package version differs')
assert(manifest.supportedBaselines?.node === packageJson.engines?.node, 'Node baseline differs')
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
assert(peerRange === '^0.1.1-rc.2 || ^0.1.2-alpha.4', 'DSH peer range must target rc.2 and alpha.4')
const dshBaselines = manifest.supportedBaselines?.dsh?.baselines ?? []
assert(dshBaselines.length === 2, 'exactly two DSH baselines must be declared')
assert(
  dshBaselines.some(entry => entry.release === '0.1.1-rc.2'
    && entry.commit === 'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e'
    && entry.modelsUi === 'settings-section-fallback'),
  'DSH Desktop rc.2 baseline is missing',
)
assert(
  dshBaselines.some(entry => entry.release === '0.1.2-alpha.4'
    && entry.commit === '4e84901e6471b79ec0338099867ebb4606d12bb5'
    && entry.modelsUi === 'provider-card'
    && entry.providerHeaders === 'fetch-validated-discovery'),
  'DSH alpha.4 baseline is missing',
)
for (const dependency of manifest.supportedBaselines?.dsh?.packages ?? []) {
  assert(packageJson.peerDependencies?.[dependency] === peerRange, `${dependency} peer range differs`)
  assert(
    packageJson.devDependencies?.[dependency] === `^${manifest.supportedBaselines.dsh.developmentRelease}`,
    `${dependency} development range differs`,
  )
}

const compatibility = await read('src/compatibility.ts')
assert(compatibility.includes(`peerRange: '${peerRange}'`), 'runtime compatibility range differs')

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
for (const subpath of Object.keys(manifest.requiredExports ?? {})) {
  assert(packageJson.exports?.[subpath] !== undefined, `package export ${subpath} is missing`)
}

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
  '## Mechanical verification',
  '## Issue, branch, and PR workflow',
]) {
  assert(agents.includes(heading), `AGENTS.md is missing ${heading}`)
}
assert((await read('CLAUDE.md')).includes('[AGENTS.md](./AGENTS.md)'), 'CLAUDE.md must link AGENTS.md')

const workflow = await read('.github/workflows/ci.yml')
for (const command of [
  'b150a551b8d465e31e418e1b2eaf5e79bbb7d28e',
  '4e84901e6471b79ec0338099867ebb4606d12bb5',
  'pnpm install --frozen-lockfile',
  'pnpm verify:upstream -- dsh-upstream',
  'pnpm verify',
  'pnpm pack --pack-destination artifacts',
]) {
  assert(workflow.includes(command), `CI is missing ${command}`)
}

const patch = await read('cordis.patch.yml')
assert((patch.match(/^- insert:/gmu) ?? []).length === 1, 'bundle patch must have one insert')
assert((patch.match(/^\s+- id: github-copilot$/gmu) ?? []).length === 1, 'bundle patch must have one integration entry')

console.log(`Verified ${manifest.baseline.id} ${manifest.package.version} (${manifest.capabilities.length} capabilities).`)
