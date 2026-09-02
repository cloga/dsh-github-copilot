import { execFileSync } from 'node:child_process'
import { copyFile, rm } from 'node:fs/promises'
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
const target = resolve(
  upstream,
  'packages/llm/llm-pi-ai/tests/dsh-github-copilot-per-model-api.spec.ts',
)
const pnpmCli = process.env.npm_execpath
if (pnpmCli === undefined || pnpmCli.length === 0) {
  throw new Error('verify-controlled-core must run through pnpm')
}

try {
  await copyFile(fixture, target)
  execFileSync(
    process.execPath,
    [pnpmCli, 'exec', 'vitest', 'run', 'packages/llm/llm-pi-ai/tests/dsh-github-copilot-per-model-api.spec.ts'],
    { cwd: upstream, stdio: 'inherit' },
  )
} finally {
  await rm(target, { force: true })
}
