import { access, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

async function read(path) {
  assert(typeof path === 'string' && path.length > 0 && !path.startsWith('/')
    && !path.includes('\\') && !path.includes(':') && !path.split('/').includes('..'), 'unsafe evidence path')
  return readFile(resolve(root, path), 'utf8')
}

async function readJson(path) {
  return JSON.parse(await read(path))
}

function assert(condition, message) {
  if (!condition) throw new Error(`deployment baseline verification failed: ${message}`)
}

const parsedSources = new Map()
async function syntax(path) {
  if (!parsedSources.has(path)) {
    const source = ts.createSourceFile(path, await read(path), ts.ScriptTarget.Latest, true,
      path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
    assert(source.parseDiagnostics.length === 0, `invalid TypeScript evidence syntax: ${path}`)
    parsedSources.set(path, source)
  }
  return parsedSources.get(path)
}

// Required test evidence must be an actual enabled call, not a comment that
// happens to contain it('...'). Parameterized templates retain their exact name.
function testFactory(node) {
  if (ts.isIdentifier(node)) return node.text === 'it' || node.text === 'test'
  const factory = ts.isCallExpression(node) ? node.expression : ts.isTaggedTemplateExpression(node) ? node.tag : undefined
  return factory !== undefined && ts.isPropertyAccessExpression(factory)
    && (factory.name.text === 'each' || factory.name.text === 'for')
    && testFactory(factory.expression)
}
async function testNames(path) {
  const names = new Set()
  const visit = node => {
    if (ts.isCallExpression(node) && testFactory(node.expression)) {
      const name = node.arguments[0]
      const body = node.arguments[1]
      let disabled = false
      for (let parent = node.parent; parent; parent = parent.parent) {
        if (ts.isCallExpression(parent) && ts.isPropertyAccessExpression(parent.expression)
          && ts.isIdentifier(parent.expression.expression) && parent.expression.expression.text === 'describe'
          && ['skip', 'todo', 'only'].includes(parent.expression.name.text)) disabled = true
      }
      if (!disabled && body && (ts.isArrowFunction(body) || ts.isFunctionExpression(body))
        && name && (ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name))) names.add(name.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(await syntax(path))
  return names
}

function modelLabel(node) {
  if (ts.isIdentifier(node)) return ['id', 'modelId', 'modelName', 'candidateId'].includes(node.text)
  return ts.isPropertyAccessExpression(node) && ['id', 'name'].includes(node.name.text)
    && ts.isIdentifier(node.expression) && /model|descriptor|candidate|entry|item/i.test(node.expression.text)
}
async function verifyGenericSource(path) {
  const source = await syntax(path)
  const comparison = new Set([ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.EqualsEqualsEqualsToken,
    ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken])
  const visit = node => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const imported = node.moduleSpecifier.text
      assert(!/^@deepseek-ai\/dsh-[^/]+\/(?:src|lib)(?:\/|$)/u.test(imported), `${path} imports unpublished Core internals`)
      assert(!/(?:^|\/)temporary-models(?:\.ts|\.js)?$/u.test(imported), `${path} imports the legacy static model table into generic routing`)
    }
    if (ts.isIdentifier(node)) assert(node.text !== 'GITHUB_COPILOT_PREVIEW_MODEL_ID', `${path} retains an exact-model routing constant`)
    if (ts.isStringLiteral(node)) assert(node.text !== 'llmPiAiModelProtocol', `${path} depends on an unshipped Core service`)
    if (ts.isBinaryExpression(node) && comparison.has(node.operatorToken.kind)) {
      const literal = modelLabel(node.left) ? node.right : modelLabel(node.right) ? node.left : undefined
      if (literal && ts.isStringLiteral(literal)) assert(literal.text === '', `${path} compares a model identifier/name to a fixed literal`)
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && modelLabel(node.expression.expression) && ['startsWith', 'endsWith', 'includes', 'match', 'search'].includes(node.expression.name.text)) {
      const pattern = node.arguments[0]
      if (pattern && ts.isStringLiteral(pattern)) assert(!/[a-z0-9]/iu.test(pattern.text), `${path} routes by a model-name pattern`)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
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
assert(manifest.evidence?.kind === 'source-and-synthetic-test-inventory', 'evidence scope must distinguish local inventory from live proof')
assert(manifest.evidence.peerRangeMeaning === 'package-admission-not-runtime-validation', 'peer admission must not claim every Core runtime is validated')
for (const limit of ['live-discovery', 'live-model-transport', 'all-admitted-core-versions', 'published-release', 'local-upgrade']) {
  assert(manifest.evidence.doesNotProve?.includes(limit), `evidence limit is missing: ${limit}`)
}
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
  peerRange === '0.1.1-rc.2 || 0.1.2-rc.1 || 0.1.3-alpha.1 || 0.1.5-alpha.1',
  'DSH peer range must retain the previous three baselines and append 0.1.5-alpha.1',
)
const dshBaselines = manifest.supportedBaselines?.dsh?.baselines ?? []
assert(dshBaselines.length === 4, 'exactly four DSH baselines must be declared')
const currentDsh = manifest.supportedBaselines.dsh
assert(currentDsh.release === '0.1.5-alpha.1'
  && currentDsh.tag === 'dsh-v0.1.5-alpha.1'
  && currentDsh.commit === '5dda764ed3aa172535a7967b06ff95d9cbfe536a', 'current Core target must be the exact official 0.1.5-alpha.1 tag')
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
const officialCore = dshBaselines.find(entry => entry.release === '0.1.5-alpha.1')
assert(officialCore?.tag === 'dsh-v0.1.5-alpha.1'
  && officialCore.commit === '5dda764ed3aa172535a7967b06ff95d9cbfe536a'
  && officialCore.source === 'https://github.com/deepseek-ai/deepseek-harness'
  && officialCore.modelsUi === 'provider-card'
  && officialCore.providerHeaders === 'fetch-validated-discovery'
  && officialCore.strictModeCompat === 'route-switch'
  && officialCore.fileContentHelper === 'contentHasFile', 'official DSH 0.1.5-alpha.1 baseline is missing')
assert(officialCore.evidenceScope === 'unchanged-tagged-source-target'
  && officialCore.standaloneNpmArtifacts === 'not-tested'
  && officialCore.managedProviderValidation === 'synthetic-tagged-source-runtime', '0.1.5-alpha.1 must retain bounded tagged-source evidence, not artifact or live proof')
assert(JSON.stringify(officialCore.runtimeTests) === JSON.stringify([
  'tests/preview-route.spec.ts', 'tests/published-core.spec.ts', 'tests/single-route.spec.ts',
  'tests/fixtures/session-context-core.fixture.ts', 'tests/fixtures/remote-core.fixture.ts',
]), 'target tagged-runtime evidence inventory differs')
for (const path of officialCore.runtimeTests) await access(resolve(root, path))
for (const dependency of manifest.supportedBaselines?.dsh?.packages ?? []) {
  assert(packageJson.peerDependencies?.[dependency] === peerRange, `${dependency} peer range differs`)
  assert(
    packageJson.devDependencies?.[dependency] === manifest.supportedBaselines.dsh.developmentRelease,
    `${dependency} development dependency must use the exact published baseline`,
  )
}

assert(manifest.supportedBaselines.dsh.developmentRelease === '0.1.2-rc.1', 'development must use the published rc.1 API baseline')
const declaredPackages = [...manifest.supportedBaselines.dsh.packages].sort()
const actualDshPeers = Object.keys(packageJson.peerDependencies).filter(name => name.startsWith('@deepseek-ai/dsh-')).sort()
assert(JSON.stringify(declaredPackages) === JSON.stringify(actualDshPeers), 'Core peer package inventory differs')
for (const [name, version] of Object.entries(packageJson.devDependencies)) {
  if (name.startsWith('@deepseek-ai/dsh-')) assert(version === manifest.supportedBaselines.dsh.developmentRelease, `${name} must use the exact development Core version`)
}
assert(packageJson.dependencies['@deepseek-ai/dsh-authorization'] === '0.1.2-rc.1', 'authorization runtime must use published rc.1')
assert(manifest.supportedBaselines.piAi === '0.85.1', 'managed provider evidence targets exact pi-ai 0.85.1')
const oldCore = dshBaselines.find(entry => entry.release === '0.1.1-rc.2')
assert(oldCore.evidenceScope === 'historical-regression-only' && oldCore.managedProviderValidation === 'not-verified', 'historical rc.2 must not claim new managed-provider validation')
const devCore = dshBaselines.find(entry => entry.release === '0.1.2-rc.1')
assert(devCore.evidenceScope === 'published-api-target' && devCore.managedProviderValidation === 'synthetic-published-adapter', 'rc.1 evidence must stay scoped to synthetic published-adapter tests')
assert(JSON.stringify(devCore.managedProviderTests) === JSON.stringify(['tests/preview-provider.spec.ts', 'tests/preview-route.spec.ts', 'tests/pi-provider-bridge.spec.ts']), 'published adapter evidence inventory differs')
const alphaCore = dshBaselines.find(entry => entry.release === '0.1.3-alpha.1')
assert(alphaCore.evidenceScope === 'unchanged-tagged-source-target'
  && alphaCore.standaloneNpmArtifacts === 'not-published'
  && alphaCore.managedProviderValidation === 'not-verified', 'alpha.1 source evidence must not pretend unavailable npm artifacts were tested')
const metadata = manifest.capabilities?.find(capability => capability.id === 'account-driven-provider-metadata')
assert(metadata?.activation === 'validated-account-endpoints-and-capabilities', 'managed models must follow account endpoint and capability evidence')
const publicAdapter = manifest.capabilities?.find(capability => capability.id === 'public-adapter-account-model-route')
assert(publicAdapter?.activation === 'published-adapter-and-native-sdk', 'managed route must reuse the public adapter and native SDK')
assert(!manifest.capabilities.some(capability => capability.id === 'capability-gated-mixed-copilot-protocols'), 'unshipped Core capability requirement must be retired')
const genericSources = ['src/account-model-catalog.ts', 'src/account-model-source.ts', 'src/account-model-auth.ts', 'src/preview-provider.ts', 'src/preview-route.ts', 'src/pi-provider-bridge.ts']
for (const path of genericSources) await verifyGenericSource(path)
assert(!(await read('src/model-protocol.ts')).includes('llmPiAiModelProtocol'), 'local catalog facts must not depend on an unshipped Core service')
const legacyRestore = manifest.capabilities.find(capability => capability.id === 'legacy-global-override-restoration')
assert(legacyRestore?.activation === 'legacy-restoration-only' && legacyRestore.newGlobalProtocolOverrides === false, 'legacy restoration must not acquire a new global protocol override')
assert(manifest.capabilities?.some(capability => capability.id === 'responses-public-reasoning-and-safe-replay-delegation'), 'Responses reasoning and Core replay delegation evidence is missing')

const reasoningPresentation = manifest.capabilities?.find(capability => capability.id === 'replay-safe-copilot-reasoning-presentation')
assert(reasoningPresentation?.activation === 'optional-guarded-client-seam', 'reasoning presentation must remain optional and guarded')
assert((await read('src/client.ts')).includes("export const inject = ['remote', 'slots']"), 'optional Chat services must not become authorization prerequisites')

const compatibility = await read('src/compatibility.ts')
assert(compatibility.includes(`peerRange: '${peerRange}'`), 'runtime compatibility range differs')
assert(compatibility.includes(`release: '${currentDsh.release}'`), 'runtime current Core target differs')
assert(compatibility.includes(`supportedReleases: [${dshBaselines.map(entry => `'${entry.release}'`).join(', ')}]`), 'runtime supported Core release inventory differs')
assert(
  compatibility.includes(`developmentRelease: '${manifest.supportedBaselines.dsh.developmentRelease}'`),
  'runtime development release differs',
)

assert(Array.isArray(manifest.capabilities) && manifest.capabilities.length > 0, 'capability inventory is missing')
const capabilityIds = new Set(manifest.capabilities.map(capability => capability.id))
assert(capabilityIds.size === manifest.capabilities.length, 'capability IDs must be unique')
for (const required of ['account-driven-provider-metadata', 'account-scoped-discovery-snapshot',
  'public-adapter-account-model-route', 'managed-model-generation-and-lifetime', 'account-discovery-native-oauth',
  'canonical-owner-preservation', 'single-managed-route-native-oauth', 'legacy-route-conflict-protection', 'legacy-global-override-restoration',
  'read-only-status-and-explicit-discovery', 'shared-copilot-credential-refresh', 'compact-account-row-and-auth-disclosure']) {
  assert(capabilityIds.has(required), `required plugin-only capability is missing: ${required}`)
}
for (const capability of manifest.capabilities) {
  assert(capability.required === true, `${capability.id} must be required`)
  assert(capability.sourceMarkers?.length > 0, `${capability.id} has no source evidence`)
  assert(capability.tests?.length > 0, `${capability.id} has no test evidence`)
  for (const evidence of capability.sourceMarkers) {
    assert((await read(evidence.file)).includes(evidence.marker), `${capability.id} marker missing from ${evidence.file}`)
  }
  for (const test of capability.tests) {
    assert((await testNames(test.file)).has(test.name), `${capability.id} enabled test missing: ${test.name} (${test.file})`)
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

// A validated account metadata snapshot is allowed; an external proxy,
// ambient token dependency, or private Core import is not.
const guardedSources = [
  ...genericSources,
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
  assert(!source.includes('dsh-web-search-provider'), `${path} retains an external search integration dependency`)
  assert(!/@deepseek-ai\/dsh-[^/'"\s]+\/(?:src|lib)\//u.test(source), `${path} imports private Core artifacts`)
}
for (const path of genericSources) {
  assert(!/\b(?:process|Bun|Deno)\s*\.\s*env\b/u.test(await read(path)), `${path} reads ambient environment credentials`)
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
  '5dda764ed3aa172535a7967b06ff95d9cbfe536a',
  'pnpm install --frozen-lockfile',
  "pnpm install --frozen-lockfile --filter '@deepseek-ai/dsh-llm-pi-ai...'",
  "if: matrix.dsh.release == '0.1.3-alpha.1' || matrix.dsh.release == '0.1.5-alpha.1'",
  'node scripts/verify-tagged-core.mjs prepare',
  'node node_modules/vitest/vitest.mjs run --config',
  'pnpm verify:upstream -- dsh-upstream',
  'pnpm verify:controlled-core -- dsh-upstream',
  'pnpm verify',
  'pnpm pack --pack-destination artifacts',
]) {
  assert(workflow.includes(command), `CI is missing ${command}`)
}
for (const marker of [
  'workflow_call:',
  'group: dsh-github-copilot-release',
  "github.event_name == 'push' && github.ref == 'refs/heads/main'",
  'fetch-depth: 0',
  'scripts/release-policy.mjs --plan',
  'd347e703908d0406b7a7ef80e3a0e594d86b2215',
  'pnpm verify:upstream -- dsh-upstream',
  'pnpm verify:controlled-core -- dsh-upstream',
  'scripts/publish-release.mjs',
]) {
  assert(releaseWorkflow.includes(marker), `Release workflow is missing ${marker}`)
}
for (const marker of [
  'release-ready:',
  'Require all compatibility and package checks',
  'scripts/release-policy.mjs --base',
  'uses: ./.github/workflows/release.yml',
]) assert(workflow.includes(marker), `CI release gate is missing ${marker}`)
const orderedReleaseSteps = [
  '- run: pnpm install --frozen-lockfile',
  '- name: Install alpha.1 Core pi-ai closure',
  '- run: pnpm verify:upstream -- dsh-upstream',
  '- run: pnpm verify:controlled-core -- dsh-upstream',
  '- name: Verify plugin package',
  '- run: pnpm pack --pack-destination artifacts',
  '- name: Verify packed archive',
  'pnpm verify:tarball --',
  '- name: Write and verify SHA-256 manifest',
  'sha256sum -- *.tgz > SHA256SUMS',
  'sha256sum --check SHA256SUMS',
  '- name: Publish exact annotated tag and immutable GitHub Release',
  'scripts/publish-release.mjs',
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
