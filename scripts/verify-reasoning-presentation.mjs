import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { readFile, writeFile, rm, realpath, lstat } from 'node:fs/promises'
import { dirname, join, resolve, relative, isAbsolute, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cleanupOwnedFixture, CONTROLLED_CORE_TIMEOUT_MS } from './lib/controlled-core.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argument = process.argv.slice(2).find(value => value !== '--')
if (!argument) throw new Error('usage: node scripts/verify-reasoning-presentation.mjs <clean exact Core checkout>')
const core = await realpath(argument)
const supported = new Set([
  'a66e4702047846cdaa10c66c9d3df3951f5ea70d',
  'd347e703908d0406b7a7ef80e3a0e594d86b2215',
  '5dda764ed3aa172535a7967b06ff95d9cbfe536a',
])
const gitOptions = { cwd: core, encoding: 'utf8', timeout: 15000 }
const commit = execFileSync('git', ['rev-parse', '--verify', 'HEAD'], gitOptions).trim()
if (!supported.has(commit)) throw new Error(`unsupported reasoning presentation fixture Core revision: ${commit}`)
if (execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=no'], gitOptions).trim()) {
  throw new Error('reasoning presentation fixture requires a clean tracked Core checkout')
}
const fixtureRelative = 'packages/client/ui-conversation/tests/copilot-reasoning-presentation.client.spec.ts'
const target = join(core, fixtureRelative)
const parent = await realpath(dirname(target))
const suffix = relative(core, parent)
if (suffix === '..' || suffix.startsWith(`..${sep}`) || isAbsolute(suffix) || parent !== dirname(target)) {
  throw new Error('reasoning presentation fixture refuses a symlink or junction ancestor')
}
const require = createRequire(join(core, 'package.json'))
const vitestManifest = require.resolve('vitest/package.json')
const vitestCli = join(dirname(vitestManifest), 'vitest.mjs')
const fixture = await readFile(join(root, 'tests/fixtures/reasoning-presentation-core.fixture.ts'), 'utf8')
const modulePath = join(root, 'src/reasoning-presentation.ts').replaceAll('\\', '/')
const bytes = Buffer.from(fixture.replace("'__COPILOT_REASONING_MODULE__'", JSON.stringify(modulePath)))
let identity
let failure
try {
  await writeFile(target, bytes, { flag: 'wx' })
  identity = await lstat(target, { bigint: true })
  execFileSync(process.execPath, [vitestCli, 'run', fixtureRelative], {
    cwd: core, stdio: 'inherit', timeout: CONTROLLED_CORE_TIMEOUT_MS,
  })
  console.log(`Verified reasoning presentation with real Core registry and assembler at ${commit}; no live profile was changed.`)
} catch (error) {
  failure = error
  throw error
} finally {
  if (identity !== undefined) {
    try {
      await cleanupOwnedFixture(target, parent, identity, bytes, rm)
    } catch (error) {
      if (failure !== undefined) throw new AggregateError([failure, error], error.message)
      throw error
    }
  }
}
