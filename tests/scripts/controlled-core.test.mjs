import assert from 'node:assert/strict'
import { constants, renameSync, writeFileSync } from 'node:fs'
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import {
  CONTROLLED_CORE_FIXTURE,
  CONTROLLED_CORE_TIMEOUT_MS,
  verifyControlledCore,
} from '../../scripts/lib/controlled-core.mjs'

const commit = 'a'.repeat(40)

async function harness(t, run = () => undefined) {
  const upstream = await mkdtemp(join(tmpdir(), 'dsh-controlled-core-test-'))
  t.after(() => rm(upstream, { recursive: true, force: true }))
  const target = join(upstream, CONTROLLED_CORE_FIXTURE)
  const fixture = join(upstream, 'source.fixture.ts')
  await mkdir(dirname(target), { recursive: true })
  await writeFile(fixture, 'synthetic fixture')
  const calls = []
  const execute = (file, args, options) => {
    calls.push({ file, args, options })
    return file === 'git' ? (args[0] === 'rev-parse' ? `${commit}\n` : '') : run(file, args, options)
  }
  return {
    target,
    calls,
    execute,
    options: { upstream, fixture, supportedCommits: [commit], pnpmCli: 'synthetic-pnpm.cjs' },
  }
}

test('preserves a pre-existing sentinel and does not execute the child', async (t) => {
  const h = await harness(t)
  await writeFile(h.target, 'pre-existing sentinel')
  await assert.rejects(verifyControlledCore(h.options, { execute: h.execute }), { code: 'EEXIST' })
  assert.equal(await readFile(h.target, 'utf8'), 'pre-existing sentinel')
  assert.equal(h.calls.length, 2)
})

test('uses exclusive copy and cleans up its fixture after success', async (t) => {
  const h = await harness(t)
  let copyFlags
  await verifyControlledCore(h.options, {
    execute: h.execute,
    copy: async (source, target, flags) => {
      copyFlags = flags
      await copyFile(source, target, flags)
    },
  })
  assert.equal(copyFlags, constants.COPYFILE_EXCL)
  await assert.rejects(readFile(h.target), { code: 'ENOENT' })
  assert.equal(h.calls.length, 3)
  assert.deepEqual(h.calls[1].args, ['status', '--porcelain=v1', '--untracked-files=no'])
  assert.deepEqual(h.calls[2].args, ['synthetic-pnpm.cjs', 'exec', 'vitest', 'run', CONTROLLED_CORE_FIXTURE])
  assert.equal(h.calls[2].options.timeout, CONTROLLED_CORE_TIMEOUT_MS)
  assert.equal(h.calls[2].options.stdio, 'inherit')
})

test('cleans up only its fixture after child failure', async (t) => {
  const failure = new Error('synthetic child failure')
  const h = await harness(t, () => { throw failure })
  const sibling = join(dirname(h.target), 'existing.spec.ts')
  await writeFile(sibling, 'unrelated sentinel')
  await assert.rejects(verifyControlledCore(h.options, { execute: h.execute }), error => error === failure)
  await assert.rejects(readFile(h.target), { code: 'ENOENT' })
  assert.equal(await readFile(sibling, 'utf8'), 'unrelated sentinel')
})

test('cleans up an owned fixture after a child timeout', async (t) => {
  const timeout = Object.assign(new Error('synthetic timeout'), { code: 'ETIMEDOUT' })
  const h = await harness(t, (_file, _args, options) => {
    assert.equal(options.timeout, CONTROLLED_CORE_TIMEOUT_MS)
    throw timeout
  })
  await assert.rejects(verifyControlledCore(h.options, { execute: h.execute }), { code: 'ETIMEDOUT' })
  await assert.rejects(readFile(h.target), { code: 'ENOENT' })
})

test('does not attempt cleanup when exclusive creation fails', async (t) => {
  const h = await harness(t)
  const failure = new Error('synthetic copy failure')
  let removed = false
  await assert.rejects(verifyControlledCore(h.options, {
    execute: h.execute,
    copy: async () => { throw failure },
    remove: async () => { removed = true },
  }), error => error === failure)
  assert.equal(removed, false)
  assert.equal(h.calls.length, 2)
})

test('refuses unsupported commits before any fixture write or cleanup', async (t) => {
  const h = await harness(t)
  await writeFile(h.target, 'pre-existing sentinel')
  let copied = false
  let removed = false
  await assert.rejects(verifyControlledCore({ ...h.options, supportedCommits: ['b'.repeat(40)] }, {
    execute: h.execute,
    copy: async () => { copied = true },
    remove: async () => { removed = true },
  }), /unsupported Core commit/)
  assert.equal(copied, false)
  assert.equal(removed, false)
  assert.equal(h.calls.length, 1)
  assert.equal(await readFile(h.target, 'utf8'), 'pre-existing sentinel')
})

test('refuses dirty tracked sources before copying or cleanup', async (t) => {
  const h = await harness(t)
  let copied = false
  let removed = false
  await assert.rejects(verifyControlledCore(h.options, {
    execute: (file, args, options) => args[0] === 'status' ? ' M packages/source.ts\n' : h.execute(file, args, options),
    copy: async () => { copied = true },
    remove: async () => { removed = true },
  }), /dirty tracked Core files/)
  assert.equal(copied, false)
  assert.equal(removed, false)
})

test('refuses a symlink or junction ancestor before creating a fixture outside the checkout', async (t) => {
  const h = await harness(t)
  const outside = await mkdtemp(join(tmpdir(), 'dsh-controlled-core-outside-'))
  t.after(() => rm(outside, { recursive: true, force: true }))
  await rm(dirname(h.target), { recursive: true })
  try {
    await symlink(outside, dirname(h.target), process.platform === 'win32' ? 'junction' : 'dir')
  } catch (error) {
    if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error.code)) {
      t.skip('Windows symlink creation privilege unavailable')
      return
    }
    throw error
  }
  await assert.rejects(verifyControlledCore(h.options, { execute: h.execute }), /symlink or junction fixture ancestor/)
  await assert.rejects(readFile(join(outside, 'dsh-github-copilot-per-model-api.spec.ts')), { code: 'ENOENT' })
  assert.equal(h.calls.length, 2)
})

test('preserves a fixture edited by the child and asks for manual inspection', async (t) => {
  let h
  h = await harness(t, () => writeFileSync(h.target, 'edited sentinel'))
  await assert.rejects(verifyControlledCore(h.options, { execute: h.execute }), /preserved a changed or replaced fixture.*inspect it manually/)
  assert.equal(await readFile(h.target, 'utf8'), 'edited sentinel')
})

test('preserves a replaced fixture even when replacement bytes match the original', async (t) => {
  let h
  h = await harness(t, () => {
    renameSync(h.target, `${h.target}.original`)
    writeFileSync(h.target, 'synthetic fixture')
  })
  await assert.rejects(verifyControlledCore(h.options, { execute: h.execute }), /preserved a changed or replaced fixture/)
  assert.equal(await readFile(h.target, 'utf8'), 'synthetic fixture')
  assert.equal(await readFile(`${h.target}.original`, 'utf8'), 'synthetic fixture')
})

test('preserves an edited fixture and both errors when child execution also fails', async (t) => {
  const failure = new Error('synthetic child failure after edit')
  let h
  h = await harness(t, () => {
    writeFileSync(h.target, 'edited sentinel')
    throw failure
  })
  await assert.rejects(verifyControlledCore(h.options, { execute: h.execute }), error => {
    assert.ok(error instanceof AggregateError)
    assert.equal(error.errors[0], failure)
    assert.match(error.message, /inspect it manually/)
    return true
  })
  assert.equal(await readFile(h.target, 'utf8'), 'edited sentinel')
})

test('refuses a failed commit check before copying or cleanup', async (t) => {
  const h = await harness(t)
  let copied = false
  let removed = false
  await assert.rejects(verifyControlledCore(h.options, {
    execute: () => { throw new Error('synthetic git failure') },
    copy: async () => { copied = true },
    remove: async () => { removed = true },
  }), /synthetic git failure/)
  assert.equal(copied, false)
  assert.equal(removed, false)
})
