import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import {
  readDesktopSharedPackageContracts,
  verifyDesktopPackageGraph,
} from '../../scripts/verify-desktop-package-graph.mjs'

const manifest = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'))
const contracts = await readDesktopSharedPackageContracts()
const rc2 = contracts.find(contract => contract.runtimeVersion === '0.2.0-rc.2')
assert.ok(rc2, 'retain the independently audited signed rc.2 graph')
const historicalContracts = contracts.filter(contract => contract.runtimeVersion !== manifest.engines.dsh)
const { '@deepseek-ai/dsh-tool-executor-native': _nativeExecutor, ...historicalPeers } = manifest.peerDependencies
// Synthetic subject for historical validator regressions, not current Desktop evidence.
const historicalManifest = { ...manifest, engines: { ...manifest.engines, dsh: rc2.runtimeVersion },
  peerDependencies: Object.fromEntries(Object.entries(historicalPeers).map(([name, range]) =>
    [name, rc2.auditedPackages[name] ?? range])) }

test('audits the current installed graph while retaining historical projections', () => {
  const evidence = verifyDesktopPackageGraph(manifest, contracts)
  assert.deepEqual(evidence.map(item => item.packageCount), [241, 336, 246, 287])
  assert.deepEqual(evidence.map(item => item.compatibilityChecked), [false, true, false, false])
  assert.deepEqual(verifyDesktopPackageGraph(historicalManifest, historicalContracts).map(item => item.compatibilityChecked),
    [false, false, true])
  assert.throws(() => verifyDesktopPackageGraph(manifest, historicalContracts), /Exactly one current Desktop/)
  assert.throws(() => verifyDesktopPackageGraph({
    ...historicalManifest,
    peerDependencies: { ...historicalManifest.peerDependencies,
      '@deepseek-ai/dsh-tool-executor-native': manifest.peerDependencies['@deepseek-ai/dsh-tool-executor-native'] },
  }, historicalContracts), /changed without a shared-package audit/)
})

test('shared graph gate rejects bundled, optional, incompatible, or unaudited host ownership', () => {
  const manifest = historicalManifest
  assert.doesNotThrow(() => verifyDesktopPackageGraph(manifest, [currentContract()]))
  assert.throws(() => verifyDesktopPackageGraph(manifest, [
    currentContract({ '@deepseek-ai/cordis': '4.0.2' }),
  ]), /does not admit host 4\.0\.2/)
  assert.throws(() => verifyDesktopPackageGraph({
    ...manifest,
    dependencies: { ...manifest.dependencies, '@deepseek-ai/dsh-authorization': '0.1.2-rc.1' },
  }, historicalContracts), /must declare .* as a peer dependency/)
  assert.throws(() => verifyDesktopPackageGraph({
    ...manifest,
    peerDependenciesMeta: {
      ...manifest.peerDependenciesMeta,
      '@deepseek-ai/dsh-authorization': { optional: true },
    },
  }, historicalContracts), /must not be optional/)
  assert.throws(() => verifyDesktopPackageGraph({
    ...manifest,
    peerDependencies: { ...manifest.peerDependencies, '@deepseek-ai/dsh-agent': '0.1.5-rc.2' },
  }, [currentContract()]), /does not admit host 0\.2\.0-rc\.2/)
  assert.throws(() => verifyDesktopPackageGraph({
    ...manifest,
    peerDependencies: { ...manifest.peerDependencies, '@deepseek-ai/schemastery': '^4.0.0' },
  }, [currentContract({ '@deepseek-ai/schemastery': '3.18.2' })]), /does not admit host 3\.18\.2/)
  assert.throws(() => verifyDesktopPackageGraph({
    ...manifest,
    dependencies: { ...manifest.dependencies, '@deepseek-ai/dsh-authorization': '0.2.0-rc.1' },
  }, [currentContract()]), /must declare .* as a peer dependency/)
  assert.throws(() => verifyDesktopPackageGraph({
    ...manifest,
    dependencies: { ...manifest.dependencies, 'new-runtime-package': '1.0.0' },
  }, historicalContracts), /changed without a shared-package audit/)
})

function currentContract(overrides = {}) {
  const contract = structuredClone(rc2)
  contract.id = 'synthetic-historical-desktop-contract'
  contract.auditedPackages = { ...contract.auditedPackages, ...overrides }
  return contract
}

test('client externals stay outside the strict Node peer graph', () => {
  assert.throws(() => verifyDesktopPackageGraph({
    ...manifest,
    dsh: { ...manifest.dsh, client: { ...manifest.dsh.client, external: undefined } },
    peerDependencies: { ...manifest.peerDependencies, react: '^18.2.0' },
  }, contracts), /requires missing non-host peer react/)
  assert.throws(() => verifyDesktopPackageGraph({
    ...manifest,
    peerDependencies: { ...manifest.peerDependencies, react: '^18.2.0' },
    peerDependenciesMeta: { ...manifest.peerDependenciesMeta, react: { optional: true } },
  }, contracts), /Client external react must not be a Node dependency or peer/)
  const { react: _react, ...withoutReact } = manifest.devDependencies
  assert.throws(() => verifyDesktopPackageGraph({
    ...manifest,
    devDependencies: withoutReact,
  }, contracts), /retain Client external react as a dev dependency/)
})
