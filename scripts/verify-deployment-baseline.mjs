import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const requiredCapabilityIds = [
  'responses-replay-item-id-normalization',
  'grounded-sandbox-escalation',
  'image-attachment-bypass',
  'failure-safe-copilot-model-catalog',
  'orphaned-replay-item-filtering',
]
const requiredRootExports = [
  'modelCatalogURL',
  'modelsFromOpenAICompatibleListing',
  'synchronizeOpenAICompatibleModelCatalog',
]

async function readJson(path) {
  return JSON.parse(await readFile(resolve(root, path), 'utf8'))
}

function assert(condition, message) {
  if (!condition) throw new Error(`deployment baseline verification failed: ${message}`)
}

const packageJson = await readJson('package.json')
const manifest = await readJson('deployment-baseline.json')

assert(manifest.schemaVersion === 1, 'schemaVersion must be 1')
assert(manifest.baseline?.id === 'cloga.dsh-windows-copilot.web-search', 'baseline id changed')
assert(manifest.baseline?.kind === 'fork-deployment-baseline', 'fork ownership marker is missing')
assert(manifest.package?.name === packageJson.name, 'package name does not match package.json')
assert(manifest.package?.version === packageJson.version, 'package version does not match package.json')
assert(/-cloga\.\d+$/u.test(packageJson.version), 'package version is not an unambiguous cloga prerelease')
assert(packageJson.files?.includes('deployment-baseline.json'), 'tarball files omit deployment-baseline.json')
assert(packageJson.exports?.['./deployment-baseline.json'] === './deployment-baseline.json', 'metadata subpath export is missing')
assert(manifest.supportedBaselines?.node === packageJson.engines?.node, 'Node baseline does not match package.json')
assert(manifest.supportedBaselines?.platforms?.includes('windows'), 'Windows baseline marker is missing')

const dshRelease = manifest.supportedBaselines?.dsh?.release
for (const dependency of manifest.supportedBaselines?.dsh?.packages ?? []) {
  assert(packageJson.peerDependencies?.[dependency] === `^${dshRelease}`, `${dependency} does not match the DSH baseline`)
}

const capabilities = new Map((manifest.capabilities ?? []).map(capability => [capability.id, capability]))
for (const id of requiredCapabilityIds) {
  const capability = capabilities.get(id)
  assert(capability?.required === true, `required capability ${id} is missing`)
  assert(capability.sourceMarkers?.length > 0, `${id} has no source markers`)
  assert(capability.tests?.length > 0, `${id} has no named tests`)

  for (const evidence of capability.sourceMarkers ?? []) {
    const source = await readFile(resolve(root, evidence.file), 'utf8')
    assert(source.includes(evidence.marker), `${id} source marker is missing from ${evidence.file}`)
  }

  for (const test of capability.tests ?? []) {
    const source = await readFile(resolve(root, test.file), 'utf8')
    assert(source.includes(`it('${test.name}'`), `${id} test "${test.name}" is missing from ${test.file}`)
  }
}

const indexSource = await readFile(resolve(root, 'src/index.ts'), 'utf8')
for (const symbol of requiredRootExports) {
  assert(manifest.requiredExports?.['.']?.includes(symbol), `manifest root export ${symbol} is missing`)
  assert(indexSource.includes(symbol), `root export ${symbol} is missing from src/index.ts`)
}

console.log(`Verified ${manifest.baseline.id} ${manifest.package.version} (${requiredCapabilityIds.length} required capabilities).`)
