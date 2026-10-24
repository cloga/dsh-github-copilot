import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, link } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { verifyAcceptance } from '../../scripts/acceptance.mjs'
import { repositoryRoot } from '../../scripts/agent.mjs'
import { verifyCurrentCoreTemplate } from '../../scripts/verify-agent-contract.mjs'

const sha256 = value => createHash('sha256').update(value).digest('hex')
const cli = resolve(repositoryRoot, 'scripts/agent.mjs')
const git = (root, ...args) => {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim()
}

async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'copilot-acceptance-'))
  const checkout = join(root, 'checkout')
  const artifacts = join(root, 'evidence')
  await mkdir(checkout)
  await mkdir(artifacts)
  try {
    git(checkout, 'init', '--quiet')
    await writeFile(join(checkout, 'source.txt'), 'original\n')
    git(checkout, 'add', 'source.txt')
    git(checkout, '-c', 'user.name=Acceptance fixture', '-c', 'user.email=fixture@example.invalid',
      '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'synthetic baseline')
    const contract = {
      schemaVersion: 1, issue: 443, task: 'tooling',
      objective: 'Check the requested behavior', nonGoals: ['No live account access'],
      requirements: [{ id: 'acceptance-binding', expected: 'Reject stale evidence', method: 'unit' }],
    }
    const evidence = Buffer.from('Synthetic test evidence only\n')
    await writeFile(join(artifacts, 'checks.txt'), evidence)
    const report = {
      schemaVersion: 1, commit: git(checkout, 'rev-parse', 'HEAD'),
      contractSha256: '', producer: 'ci',
      environment: { node: '24.21.0', platform: 'win32', core: '0.2.1-rc.3' },
      checks: [{ id: 'acceptance-binding', status: 'passed', notes: 'Synthetic fixture, not live evidence.',
        evidence: [{ path: 'checks.txt', sha256: sha256(evidence) }] }],
    }
    const contractPath = join(artifacts, 'contract.json')
    const reportPath = join(artifacts, 'report.json')
    const save = async () => {
      const bytes = JSON.stringify(contract)
      report.contractSha256 = sha256(bytes)
      await writeFile(contractPath, bytes)
      await writeFile(reportPath, JSON.stringify(report))
    }
    await save()
    await run({ checkout, artifacts, contract, report, contractPath, reportPath, save,
      verify: () => verifyAcceptance({ root: checkout, contractPath, reportPath }),
      invoke: (...args) => spawnSync(process.execPath, [cli, 'accept', ...args], {
        cwd: checkout, encoding: 'utf8',
      }) })
  } finally { await rm(root, { recursive: true, force: true }) }
}

test('acceptance verifies exact clean HEAD, contract bytes and local artifact integrity only', () => fixture(async f => {
  const result = await f.verify()
  assert.equal(result.ok, true)
  assert.equal(result.issue, 443)
  assert.equal(result.commit, f.report.commit)
  assert.equal(result.evidenceIntegrityVerified, true)
  assert.equal(result.executionVerified, false)
  assert.equal(result.independenceVerified, false)
  assert.equal(result.environmentVerified, false)
  assert.equal(result.deliveryAuthorized, false)
  assert.deepEqual(result.counts, { passed: 1, failed: 0, blocked: 0, 'not-run': 0 })
  assert.ok(!JSON.stringify(result).includes('Synthetic fixture'))
  const invoked = f.invoke('--contract', f.contractPath, '--report', f.reportPath, '--json')
  assert.equal(invoked.status, 0, invoked.stderr)
  assert.deepEqual(JSON.parse(invoked.stdout), result)
}))

for (const status of ['failed', 'blocked', 'not-run']) {
  test(`acceptance preserves ${status} as a non-passing outcome`, () => fixture(async f => {
    f.report.checks[0].status = status
    f.report.checks[0].evidence = []
    await f.save()
    const result = await f.verify()
    assert.equal(result.ok, false)
    assert.equal(result.counts[status], 1)
    const invoked = f.invoke('--report', f.reportPath, '--contract', f.contractPath)
    assert.equal(invoked.status, 1)
    assert.equal(JSON.parse(invoked.stdout).ok, false)
  }))
}

for (const [name, mutate] of [
  ['missing check', f => { f.report.checks = [] }],
  ['unknown check', f => { f.report.checks[0].id = 'not-required' }],
  ['duplicate check', f => { f.report.checks.push(structuredClone(f.report.checks[0])) }],
  ['duplicate requirement', f => { f.contract.requirements.push(structuredClone(f.contract.requirements[0])) }],
  ['empty contract', f => { f.contract.requirements = [] }],
  ['unknown field', f => { f.report.execute = 'DO_NOT_EXECUTE' }],
  ['unknown nested field', f => { f.report.checks[0].waiver = true }],
  ['unknown environment field', f => { f.report.environment.token = 'SECRET_SENTINEL' }],
  ['unknown method', f => { f.contract.requirements[0].method = 'guess' }],
  ['invalid issue', f => { f.contract.issue = 0 }],
  ['missing scope', f => { f.contract.nonGoals = [] }],
  ['unknown outcome', f => { f.report.checks[0].status = 'skipped' }],
  ['missing reason', f => { f.report.checks[0].notes = '' }],
  ['no passing evidence', f => { f.report.checks[0].evidence = [] }],
  ['duplicate artifact', f => { f.report.checks[0].evidence.push(structuredClone(f.report.checks[0].evidence[0])) }],
  ['bad digest', f => { f.report.checks[0].evidence[0].sha256 = 'invalid' }],
  ['too many requirements', f => { f.contract.requirements = Array.from({ length: 65 }, (_, i) => ({
    id: `case-${i}`, expected: 'Bounded work', method: 'unit',
  })) }],
  ['oversized text', f => { f.contract.objective = 'x'.repeat(2001) }],
]) {
  test(`acceptance rejects ${name}`, () => fixture(async f => {
    mutate(f)
    await f.save()
    await assert.rejects(f.verify(), /ACCEPTANCE_INVALID/)
  }))
}

for (const path of ['../outside.txt', '/absolute.txt', 'C:\\outside.txt', 'nested\\file.txt',
  'https://example.invalid/evidence', './checks.txt', 'nested//file.txt', 'checks.txt:stream',
  'nul', 'CON.txt', 'trailing.', 'trailing ', 'a/../checks.txt']) {
  test(`acceptance rejects unsafe evidence path ${JSON.stringify(path)}`, () => fixture(async f => {
    f.report.checks[0].evidence[0].path = path
    await f.save()
    await assert.rejects(f.verify(), /ACCEPTANCE_INVALID/)
  }))
}

test('acceptance rejects another commit and contract edits after evidence capture', () => fixture(async f => {
  f.report.commit = 'a'.repeat(40)
  await f.save()
  await assert.rejects(f.verify(), /ACCEPTANCE_STALE_COMMIT/)
  f.report.commit = git(f.checkout, 'rev-parse', 'HEAD')
  await f.save()
  await writeFile(f.contractPath, `${JSON.stringify(f.contract)}\n`)
  await assert.rejects(f.verify(), /ACCEPTANCE_STALE_CONTRACT/)
}))

test('acceptance rejects tracked, staged and untracked workspace changes', () => fixture(async f => {
  await writeFile(join(f.checkout, 'source.txt'), 'changed\n')
  await assert.rejects(f.verify(), /ACCEPTANCE_DIRTY_CHECKOUT/)
  git(f.checkout, 'add', 'source.txt')
  await assert.rejects(f.verify(), /ACCEPTANCE_DIRTY_CHECKOUT/)
  await writeFile(join(f.checkout, 'source.txt'), 'original\n')
  git(f.checkout, 'add', 'source.txt')
  await writeFile(join(f.checkout, 'extra.txt'), 'untracked\n')
  await assert.rejects(f.verify(), /ACCEPTANCE_DIRTY_CHECKOUT/)
}))

test('acceptance rejects missing and modified artifacts', () => fixture(async f => {
  await rm(join(f.artifacts, 'checks.txt'))
  await assert.rejects(f.verify(), /ACCEPTANCE_FILE_UNAVAILABLE/)
  await writeFile(join(f.artifacts, 'checks.txt'), 'different\n')
  await assert.rejects(f.verify(), /ACCEPTANCE_EVIDENCE_MISMATCH/)
}))

test('acceptance accepts nested regular artifacts and shared evidence across requirements', () => fixture(async f => {
  await mkdir(join(f.artifacts, 'nested'))
  await writeFile(join(f.artifacts, 'nested', 'checks.txt'), await readFile(join(f.artifacts, 'checks.txt')))
  f.report.checks[0].evidence[0].path = 'nested/checks.txt'
  f.contract.requirements.push({ id: 'second-case', expected: 'Another assertion', method: 'integration' })
  f.report.checks.push({ ...structuredClone(f.report.checks[0]), id: 'second-case' })
  await f.save()
  assert.equal((await f.verify()).counts.passed, 2)
}))

test('acceptance rejects hard-linked files and directory symlink escapes', () => fixture(async f => {
  await link(join(f.artifacts, 'checks.txt'), join(f.artifacts, 'linked.txt'))
  await assert.rejects(f.verify(), /ACCEPTANCE_UNSAFE_FILE/)
  await rm(join(f.artifacts, 'linked.txt'))
  await symlink(f.checkout, join(f.artifacts, 'escape'), process.platform === 'win32' ? 'junction' : 'dir')
  f.report.checks[0].evidence[0].path = 'escape/source.txt'
  await f.save()
  await assert.rejects(f.verify(), /ACCEPTANCE_UNSAFE_FILE/)
}))

test('acceptance rejects oversized documents, invalid UTF-8 and oversized artifacts', () => fixture(async f => {
  await writeFile(f.reportPath, ' '.repeat(65537))
  await assert.rejects(f.verify(), /ACCEPTANCE_FILE_LIMIT/)
  await writeFile(f.reportPath, Buffer.from([0xff]))
  await assert.rejects(f.verify(), /ACCEPTANCE_INVALID/)
  await f.save()
  await writeFile(join(f.artifacts, 'checks.txt'), Buffer.alloc(1024 * 1024 + 1))
  await assert.rejects(f.verify(), /ACCEPTANCE_FILE_LIMIT/)
}))

test('acceptance rejects duplicate JSON members, including equivalent escaped names', () => fixture(async f => {
  const original = JSON.stringify(f.report)
  for (const ambiguous of [
    original.replace('"status":"passed"', '"status":"failed","status":"passed"'),
    original.replace('"status":"passed"', '"status":"failed","st\\u0061tus":"passed"'),
    original.replace('"checks":[', '"checks":[],"checks":['),
    original.replace('"core":', '"core":"0.0.0","core":'),
  ]) {
    await writeFile(f.reportPath, ambiguous)
    await assert.rejects(f.verify(), /ACCEPTANCE_INVALID/)
  }
  await f.save()
  const contract = JSON.stringify(f.contract).replace('"requirements":[', '"requirements":[],"requirements":[')
  await writeFile(f.contractPath, contract)
  f.report.contractSha256 = sha256(contract)
  await writeFile(f.reportPath, JSON.stringify(f.report))
  await assert.rejects(f.verify(), /ACCEPTANCE_INVALID/)
}))

test('acceptance bounds total artifact bytes and distinct artifact paths', () => fixture(async f => {
  const bytes = Buffer.alloc(1024 * 1024)
  f.contract.requirements = []
  f.report.checks = []
  for (let i = 0; i < 17; i++) {
    const id = `case-${i}`
    const path = `evidence-${i}.txt`
    await writeFile(join(f.artifacts, path), bytes)
    f.contract.requirements.push({ id, expected: 'Bounded work', method: 'static' })
    f.report.checks.push({ id, status: 'passed', notes: 'Synthetic size fixture',
      evidence: [{ path, sha256: sha256(bytes) }] })
  }
  await f.save()
  await assert.rejects(f.verify(), /ACCEPTANCE_TOTAL_LIMIT/)
  for (const check of f.report.checks) {
    check.evidence = Array.from({ length: 4 }, (_, i) => ({
      path: `${check.id}-${i}.txt`, sha256: sha256(bytes),
    }))
  }
  await f.save()
  await assert.rejects(f.verify(), /ACCEPTANCE_INVALID/)
}))

test('acceptance CLI sanitizes invalid input and rejects duplicate or missing options', () => fixture(async f => {
  await writeFile(f.reportPath, '{"secret":"SECRET_SENTINEL",invalid}')
  for (const args of [
    ['--contract', f.contractPath, '--report', f.reportPath],
    ['--contract', f.contractPath, '--report', f.reportPath, '--report', f.reportPath],
    ['--contract', f.contractPath],
    ['--contract', f.contractPath, '--report', f.reportPath, '--execute'],
  ]) {
    const result = f.invoke(...args)
    assert.equal(result.status, 2)
    assert.equal(JSON.parse(result.stdout).ok, false)
    assert.ok(!`${result.stdout}${result.stderr}`.includes('SECRET_SENTINEL'))
    assert.ok(!`${result.stdout}${result.stderr}`.includes(f.artifacts))
  }
}))

test('current-Core template gate rejects missing, duplicate and stale target markers', async () => {
  const pkg = JSON.parse(await readFile(join(repositoryRoot, 'package.json')))
  const template = await readFile(join(repositoryRoot, '.github/PULL_REQUEST_TEMPLATE.md'), 'utf8')
  assert.doesNotThrow(() => verifyCurrentCoreTemplate(template, pkg.engines.dsh))
  for (const invalid of [
    template.replace(`current DSH ${pkg.engines.dsh}`, 'current DSH 0.0.0-stale'),
    template.replace(`current DSH ${pkg.engines.dsh}`, 'DSH target omitted'),
    `${template}\nAll Windows/Linux exact current DSH ${pkg.engines.dsh} tagged-source`,
  ]) {
    assert.throws(() => verifyCurrentCoreTemplate(invalid, pkg.engines.dsh), /current-Core PR template/)
  }
})
