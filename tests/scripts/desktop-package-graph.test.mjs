import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import {
  readDesktopSharedPackageContracts,
  verifyDesktopPackageGraph,
} from '../../scripts/verify-desktop-package-graph.mjs'

const manifest = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'))
const contracts = await readDesktopSharedPackageContracts()

test('retains old Desktop shared graphs as ownership evidence, not current compatibility claims', () => {
  const evidence = verifyDesktopPackageGraph(manifest, contracts)
  assert.deepEqual(evidence.map(item => item.packageCount), [241, 246])
  assert.ok(evidence.every(item => item.compatibilityChecked === false))
})

test('shared graph gate rejects bundled, optional, incompatible, or unaudited host ownership', () => {
  assert.throws(() => verifyDesktopPackageGraph({
    ...manifest,
    dependencies: { ...manifest.dependencies, '@deepseek-ai/dsh-authorization': '0.1.2-rc.1' },
  }, contracts), /must declare .* as a peer dependency/)
  assert.throws(() => verifyDesktopPackageGraph({
    ...manifest,
    peerDependenciesMeta: {
      ...manifest.peerDependenciesMeta,
      '@deepseek-ai/dsh-authorization': { optional: true },
    },
  }, contracts), /must not be optional/)
  assert.throws(() => verifyDesktopPackageGraph({
    ...manifest,
    peerDependencies: { ...manifest.peerDependencies, '@deepseek-ai/dsh-agent': '0.1.5-rc.2' },
  }, [currentContract()]), /does not admit host 0\.2\.0-rc\.1/)
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
  }, contracts), /changed without a shared-package audit/)
})

function currentContract(overrides = {}) {
  const contract = structuredClone(contracts[0])
  contract.id = 'synthetic-current-desktop-contract'
  contract.runtimeVersion = '0.2.0-rc.1'
  contract.auditedPackages = Object.fromEntries(Object.entries(contract.auditedPackages).map(([name, value]) => [
    name,
    overrides[name] ?? (name.startsWith('@deepseek-ai/dsh-') ? '0.2.0-rc.1' : value),
  ]))
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
