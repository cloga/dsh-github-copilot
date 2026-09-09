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
  await assertMarkers('packages/client/ui-chat/src/client/contract/slots.ts', [
    "'conversation.chat.node'", "keyProps: { [Kind in ChatNodeKind]",
  ])
  await assertMarkers('packages/client/ui-chat/src/client/chat/register-node-renderers.ts', [
    "key: 'assistant-step', locale: NS", 'AssistantNodeView',
  ])
  await assertMarkers('packages/client/ui-conversation/src/client/contract/conversation.ts', [
    'buildLocationData', 'ConversationLocationDataSource', 'ConversationStepDataMap',
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
  'redactSecrets',
  'expectedRevision',
  'describe(',
])
await assertMarkers('packages/credentials/credentials/src/types.ts', [
  'credentials/record-updated',
])
await assertMarkers('packages/bundle/base/cordis.patch.yml', [
  'llm-pi-ai',
])

if (['0.1.5-alpha.1', '0.1.5-alpha.2'].includes(baseline.release)) {
  for (const path of ['package.json', 'packages/core/session/package.json', 'packages/llm/llm-pi-ai/package.json']) {
    const metadata = JSON.parse(await readFile(resolve(upstream, path), 'utf8'))
    if (metadata.version !== baseline.release) throw new Error(`DSH target package version differs in ${path}`)
  }
  await assertMarkers('packages/core/session/src/index.ts', ['requestHeader(): EpochHeader | undefined'])
  await assertMarkers('packages/core/session/src/types.ts', ['SESSION_FORMAT_VERSION = 3'])
  await assertMarkers('packages/core/agent/src/index.ts', ['currentInitiator(): Agent | undefined'])
  await assertMarkers('packages/session/session-projection/src/index.ts', ['stateOf<K extends keyof SessionProjectionStateMap>'])
  await assertMarkers('packages/api/session-controller/src/model-selection-projection.ts', [
    'pending: modelSelectionSchema.nullable()',
    "event.type === 'model/selection'",
    "event.type !== 'request/header'",
  ])
}

if (baseline.release === '0.1.5-alpha.2') {
  await assertMarkers('packages/llm/llm-pi-ai/src/config.ts', ['modelErrors: ReadonlyMap<string, string>', 'piProvider?: Provider', 'catalogError?: string'])
  await assertMarkers('packages/llm/llm-pi-ai/src/adapter.ts', ['profile.modelErrors.get(model)', "throw new LlmError(failure, 'INVALID_CONFIG')"])
}

console.log(`Verified DSH ${baseline.release} public seams at ${commit}.`)
