import { readFile } from 'node:fs/promises'
import { verifyControlledCore } from './lib/controlled-core.mjs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const [argument] = process.argv.slice(2).filter(value => value !== '--')
const input = argument ?? process.env.DSH_CONTROLLED_CORE_ROOT
if (input === undefined || input.length === 0) {
  throw new Error('usage: node scripts/verify-controlled-core.mjs <controlled Core checkout>')
}

const upstream = resolve(input)
const fixture = resolve(root, 'tests/fixtures/controlled-core-per-model-api.fixture.ts')
const manifest = JSON.parse(await readFile(resolve(root, 'deployment-baseline.json'), 'utf8'))
await verifyControlledCore({
  upstream,
  fixture,
  supportedCommits: manifest.supportedBaselines.dsh.baselines.map(baseline => baseline.commit),
  pnpmCli: process.env.npm_execpath,
})
