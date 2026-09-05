import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(await readFile(resolve(root, 'deployment-baseline.json'), 'utf8'))
const [argument] = process.argv.slice(2).filter(value => value !== '--')
const input = argument ?? process.env.DSH_UPSTREAM_ROOT
if (input === undefined || input.length === 0) {
  throw new Error('usage: node scripts/verify-upstream-baseline.mjs <deepseek-harness checkout>')
}
const upstream = resolve(input)

const commit = execFileSync('git', ['-C', upstream, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const baseline = manifest.supportedBaselines.dsh.baselines.find(entry => entry.commit === commit)
if (baseline === undefined) {
  const expected = manifest.supportedBaselines.dsh.baselines.map(entry => entry.commit).join(' or ')
  throw new Error(`expected DSH ${expected}, received ${commit}`)
}

async function assertMarkers(path, markers) {
  const source = await readFile(resolve(upstream, path), 'utf8')
  for (const marker of markers) {
    if (!source.includes(marker)) {
      throw new Error(`DSH ${baseline.release} marker "${marker}" is missing from ${path}`)
    }
  }
}

await assertMarkers('packages/client/ui-settings-models/src/client/index.ts', [
  'settings.section',
])
if (baseline.modelsUi === 'provider-card') {
  await assertMarkers('packages/client/ui-settings-models/src/client/slot-contract.ts', [
    'settings.models.provider-card',
    'settings.models.footer',
  ])
} else {
  await assertMarkers('packages/client/ui-settings-models/src/client/ModelsSection.tsx', [
    'ProviderEditor',
  ])
}
if (baseline.providerHeaders === 'fetch-validated-discovery') {
  await assertMarkers('packages/llm/llm-pi-ai/src/config.ts', [
    'assertValidHeaders',
    'new Headers([[name, value]])',
  ])
  await assertMarkers('packages/llm/llm-pi-ai/src/discovery.ts', [
    'StoredModelDiscoveryProfile',
    'stored?.headers',
  ])
}
if (baseline.perModelApi === 'model-entry') {
  await assertMarkers('packages/llm/llm-pi-ai/src/config.ts', [
    'api: z.union(supportedProtocols())',
  ])
  await assertMarkers('packages/llm/llm-pi-ai/src/catalog.ts', [
    'entry.api ?? request.api ?? base?.api ?? routeApi',
  ])
}
if (baseline.fileContentHelper === 'contentHasFile') {
  await assertMarkers('packages/llm/llm/src/content.ts', [
    'export function contentHasFile',
    "block.type === 'tool-result' && contentHasFile(block.content)",
  ])
  await assertMarkers('packages/llm/llm/src/index.ts', [
    'contentHasFile, contentHasImage',
  ])
}
if (baseline.strictModeCompat === 'route-switch') {
  await assertMarkers('packages/llm/llm-pi-ai/src/config.ts', [
    'supportsStrictMode: z.boolean()',
  ])
  await assertMarkers('packages/llm/llm-pi-ai/src/catalog.ts', [
    'configuredCompatEntries(route)',
    'gate?.[field] !== \'offer\'',
  ])
}
await assertMarkers('packages/core/agent/src/model-selection.ts', [
  'const assembled = await next()',
  'provider: selected.provider',
  'model: selected.model',
])
await assertMarkers('packages/llm/llm-pi-ai/src/login.ts', [
  'registerPiAiFlows',
  'recordKeyFor(providerId)',
])
await assertMarkers('packages/llm/llm-pi-ai/src/auth.ts', [
  'credentialStoreFrom',
  'modifyRecord',
])
await assertMarkers('packages/llm/llm-pi-ai/src/catalog.ts', [
  'catalogProviderIds',
  'request.api ?? base?.api ?? routeApi',
])
await assertMarkers('packages/settings/settings/src/index.ts', [
  "op: 'unset'",
])
await assertMarkers('packages/bundle/base/cordis.patch.yml', [
  'llm-pi-ai',
])

console.log(`Verified DSH ${baseline.release} public seams at ${commit}.`)
