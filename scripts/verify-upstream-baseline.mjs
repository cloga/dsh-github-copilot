import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const expectedCommit = 'dd6322d604e00eec1ba5e0c8541159906a21094a'
const input = process.argv[2] ?? process.env.DSH_UPSTREAM_ROOT
if (input === undefined || input.length === 0) {
  throw new Error('usage: node scripts/verify-upstream-baseline.mjs <deepseek-harness checkout>')
}
const upstream = resolve(input)

const commit = execFileSync('git', ['-C', upstream, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
if (commit !== expectedCommit) {
  throw new Error(`expected DSH ${expectedCommit}, received ${commit}`)
}

async function assertMarkers(path, markers) {
  const source = await readFile(resolve(upstream, path), 'utf8')
  for (const marker of markers) {
    if (!source.includes(marker)) throw new Error(`DSH alpha.3 marker "${marker}" is missing from ${path}`)
  }
}

await assertMarkers('packages/client/ui-settings-models/src/client/slot-contract.ts', [
  'settings.models.provider-card',
  'settings.models.footer',
])
await assertMarkers('packages/client/ui-settings-models/src/client/index.ts', [
  'settings.models.provider-card',
])
await assertMarkers('packages/client/ui-settings-models/README.md', [
  'client',
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
])
await assertMarkers('packages/bundle/base/cordis.patch.yml', [
  'llm-pi-ai',
])

console.log(`Verified DSH alpha.3 public seams at ${expectedCommit}.`)
