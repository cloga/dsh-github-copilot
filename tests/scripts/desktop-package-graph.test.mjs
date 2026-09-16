import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import {
  readDesktopSharedPackageContracts,
  verifyDesktopPackageGraph,
} from '../../scripts/verify-desktop-package-graph.mjs'

const manifest = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'))
const contracts = await readDesktopSharedPackageContracts()

test('packed manifest composes with the actual 0.1.5 and generated 0.1.6 Desktop shared graphs', () => {
  const evidence = verifyDesktopPackageGraph(manifest, contracts)
  assert.deepEqual(evidence.map(item => item.packageCount), [241, 246])
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
    peerDependencies: { ...manifest.peerDependencies, '@deepseek-ai/schemastery': '^4.0.0' },
  }, contracts), /does not admit host 3\.18\.2/)
  assert.throws(() => verifyDesktopPackageGraph({
    ...manifest,
    dependencies: { ...manifest.dependencies, 'new-runtime-package': '1.0.0' },
  }, contracts), /changed without a shared-package audit/)
})

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
