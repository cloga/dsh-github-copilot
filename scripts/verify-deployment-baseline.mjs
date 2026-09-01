import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const requiredCapabilityIds = [
  'responses-replay-item-id-normalization',
  'grounded-sandbox-escalation',
  'official-vision-route-bypass',
  'github-copilot-model-catalog',
  'github-copilot-route-composition',
  'dsh-runtime-compatibility-guard',
  'orphaned-replay-item-filtering',
  'traditional-search-compatibility-bridge',
  'nonempty-reasoning-blocks',
  'settings-provider-instance-api',
]
const requiredRootExports = [
  'githubCopilotModelCatalogURL',
  'modelCatalogURL',
  'modelsFromGitHubCopilotListing',
  'modelsFromOpenAICompatibleListing',
  'synchronizeGitHubCopilotModelCatalog',
  'synchronizeOpenAICompatibleModelCatalog',
  'composeGitHubCopilotProviderRoutes',
  'GITHUB_COPILOT_PROVIDER_ID',
  'GITHUB_COPILOT_CHAT_PROVIDER_ID',
  'GITHUB_COPILOT_API_KEY_ENV',
  'DSH_COMPATIBILITY',
  'assertDshCompatibility',
  'GITHUB_COPILOT_HOSTED_SEARCH_PROVIDER_ID',
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
assert(manifest.baseline?.id === 'cloga.dsh-github-copilot', 'baseline id changed')
assert(manifest.baseline?.kind === 'fork-deployment-baseline', 'fork ownership marker is missing')
assert(manifest.package?.name === packageJson.name, 'package name does not match package.json')
assert(manifest.package?.version === packageJson.version, 'package version does not match package.json')
assert(/-cloga\.\d+$/u.test(packageJson.version), 'package version is not an unambiguous cloga prerelease')
assert(packageJson.files?.includes('deployment-baseline.json'), 'tarball files omit deployment-baseline.json')
assert(packageJson.exports?.['./deployment-baseline.json'] === './deployment-baseline.json', 'metadata subpath export is missing')
assert(manifest.supportedBaselines?.node === packageJson.engines?.node, 'Node baseline does not match package.json')
assert(manifest.supportedBaselines?.platforms?.includes('windows'), 'Windows baseline marker is missing')
assert(manifest.supportedBaselines?.copilot?.apis?.includes('openai-responses'), 'Responses API baseline is missing')
assert(manifest.supportedBaselines?.copilot?.apis?.includes('openai-completions'), 'Chat Completions API baseline is missing')
assert(manifest.supportedBaselines?.copilot?.mainAgent === true, 'main-agent integration marker is missing')
assert(manifest.supportedBaselines?.copilot?.acpSubagents === false, 'ACP/subagent exclusion marker is missing')

const dshRelease = manifest.supportedBaselines?.dsh?.release
const dshDevelopmentRelease = manifest.supportedBaselines?.dsh?.developmentRelease
const dshPeerRange = manifest.supportedBaselines?.dsh?.peerRange
assert(typeof dshRelease === 'string' && dshRelease.length > 0, 'DSH release baseline is missing')
assert(
  typeof dshDevelopmentRelease === 'string' && dshDevelopmentRelease.length > 0,
  'DSH development release baseline is missing',
)
assert(typeof dshPeerRange === 'string' && dshPeerRange.length > 0, 'DSH peer range is missing')
const compatibilitySource = await readFile(resolve(root, 'src/compatibility.ts'), 'utf8')
assert(compatibilitySource.includes(`peerRange: '${dshPeerRange}'`), 'runtime compatibility range differs from baseline')
for (const dependency of manifest.supportedBaselines?.dsh?.packages ?? []) {
  assert(
    packageJson.peerDependencies?.[dependency] === dshPeerRange,
    `${dependency} does not match the DSH peer range`,
  )
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

const patchSource = await readFile(resolve(root, 'cordis.patch.yml'), 'utf8')
assert((patchSource.match(/^- insert:/gmu) ?? []).length === 1, 'bundle patch must contain exactly one insert')
assert((patchSource.match(/^\s+- id: github-copilot$/gmu) ?? []).length === 1, 'bundle patch must install exactly one integration entry')
assert(patchSource.includes('name: dsh-github-copilot'), 'bundle patch package identity is incorrect')

console.log(`Verified ${manifest.baseline.id} ${manifest.package.version} (${requiredCapabilityIds.length} required capabilities).`)
