import { execFileSync } from 'node:child_process'
import { constants } from 'node:fs'
import { copyFile, lstat, readFile, realpath, rm } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'

export const CONTROLLED_CORE_FIXTURE = 'packages/llm/llm-pi-ai/tests/dsh-github-copilot-per-model-api.spec.ts'
export const CONTROLLED_CORE_TIMEOUT_MS = 120_000
const COMMIT_CHECK_TIMEOUT_MS = 15_000

function contained(root, path) {
  const suffix = relative(root, path)
  return suffix !== '..' && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix)
}

function sameIdentity(left, right) {
  return left.isFile() && right.isFile()
    && left.dev === right.dev && left.ino === right.ino
    && left.birthtimeNs === right.birthtimeNs
}

/** Refuse observable replacement; this is not an atomic defense against hostile concurrent filesystem mutation. */
async function cleanupOwnedFixture(target, parent, identity, bytes, remove) {
  const preserve = () => new Error(
    `verify-controlled-core preserved a changed or replaced fixture at ${target}; inspect it manually before retrying`,
  )
  let current
  try {
    if (await realpath(dirname(target)) !== parent) throw preserve()
    current = await lstat(target, { bigint: true })
  } catch (error) {
    if (error.code === 'ENOENT') return
    throw error
  }
  if (!sameIdentity(identity, current)) throw preserve()
  const currentBytes = await readFile(target)
  const afterRead = await lstat(target, { bigint: true })
  if (!bytes.equals(currentBytes) || !sameIdentity(identity, afterRead)
    || await realpath(dirname(target)) !== parent) throw preserve()
  await remove(target, { force: true })
}

/** Verify only clean pinned tracked sources and remove only an unchanged fixture created here. */
export async function verifyControlledCore({
  upstream,
  fixture,
  supportedCommits,
  pnpmCli,
  executable = process.execPath,
}, {
  execute = execFileSync,
  copy = copyFile,
  remove = rm,
} = {}) {
  if (typeof pnpmCli !== 'string' || pnpmCli.length === 0) {
    throw new Error('verify-controlled-core must run through pnpm')
  }
  const root = await realpath(upstream)
  const gitOptions = {
    cwd: root,
    encoding: 'utf8',
    timeout: COMMIT_CHECK_TIMEOUT_MS,
    stdio: ['ignore', 'pipe', 'pipe'],
  }
  const commit = execute('git', ['rev-parse', '--verify', 'HEAD'], gitOptions).trim()
  if (!/^[a-f0-9]{40}$/u.test(commit) || !supportedCommits.includes(commit)) {
    throw new Error('verify-controlled-core refuses an unsupported Core commit; use a deployment-baseline.json pin')
  }
  const trackedChanges = execute('git', ['status', '--porcelain=v1', '--untracked-files=no'], gitOptions)
  if (trackedChanges.trim().length > 0) {
    throw new Error('verify-controlled-core refuses dirty tracked Core files; preserve your changes and use a clean pinned checkout')
  }

  const target = resolve(root, CONTROLLED_CORE_FIXTURE)
  const parent = await realpath(dirname(target))
  if (!contained(root, parent) || parent !== dirname(target)) {
    throw new Error('verify-controlled-core refuses a symlink or junction fixture ancestor; use the physical pinned checkout')
  }
  const bytes = await readFile(fixture)
  let identity
  let failure
  try {
    // Exclusive creation is the ownership boundary, not a racy existence check.
    await copy(fixture, target, constants.COPYFILE_EXCL)
    identity = await lstat(target, { bigint: true })
    if (!identity.isFile() || !(await readFile(target)).equals(bytes)
      || await realpath(dirname(target)) !== parent) {
      throw new Error('verify-controlled-core fixture changed during creation; inspect it manually before retrying')
    }
    execute(executable, [pnpmCli, 'exec', 'vitest', 'run', CONTROLLED_CORE_FIXTURE], {
      cwd: root,
      stdio: 'inherit',
      timeout: CONTROLLED_CORE_TIMEOUT_MS,
    })
  } catch (error) {
    failure = error
    throw error
  } finally {
    if (identity !== undefined) {
      try {
        await cleanupOwnedFixture(target, parent, identity, bytes, remove)
      } catch (error) {
        if (failure !== undefined) throw new AggregateError([failure, error], error.message)
        throw error
      }
    }
  }
}
