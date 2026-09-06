import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { spawnSync } from 'node:child_process'
import { attribution, describeRepository, doctor, planTask, repositoryRoot } from '../../scripts/agent.mjs'
import { verifyAgentContract } from '../../scripts/verify-agent-contract.mjs'

test('describes actual package metadata without claiming a release exists', async () => {
  const result = await describeRepository()
  const pkg = JSON.parse(await readFile(join(repositoryRoot, 'package.json')))
  assert.equal(result.package.version, pkg.version)
  assert.equal(result.release.tag, `v${pkg.version}`)
  assert.equal(result.release.publicationVerified, false)
  assert.equal(result.baselines.length, 3)
})

test('plans only known task IDs with unexecuted argument arrays', async () => {
  const plan = await planTask('models')
  assert.ok(plan.commands.every(command => command.executed === false && Array.isArray(command.argv)))
  assert.ok(plan.commands.some(command => command.argv.includes('tests/temporary-model-runtime.spec.ts')))
  await assert.rejects(planTask('__proto__'), /Unknown task/)
  assert.ok((await planTask('tooling')).commands.some(command => command.argv[1] === 'test:scripts'))
})

test('important updates carry release follow-through without a second approval prompt', async () => {
  const plan = await planTask('release')
  const policy = plan.boundaries.releaseDelivery
  assert.equal(policy.mode, 'important-update-follow-through')
  assert.equal(policy.repeatApprovalRequired, false)
  assert.equal(policy.userRestrictionsTakePrecedence, true)
  assert.equal(policy.otherChangesRequireExplicitReleaseRequest, true)
  assert.deepEqual(policy.requiredConditions, ['authorized-merge', 'green-required-ci', 'fresh-annotated-tag', 'verified-release-assets'])
  assert.deepEqual(policy.completionEvidence, ['published-release-url', 'tag-and-commit', 'asset-and-sha256'])
  assert.ok(!plan.boundaries.approvalRequired.includes('release'))
  for (const boundary of ['merge', 'install into a user profile', 'sign-out', 'worktree checkout']) {
    assert.ok(plan.boundaries.approvalRequired.includes(boundary))
  }
  assert.match(plan.delivery, /important updates continue to verified Release/)
  assert.ok(plan.commands.every(command => command.executed === false))
})

test('contract validation rejects a redundant release prompt or weakened release prerequisites', async () => {
  const root = await mkdtemp(join(tmpdir(), 'copilot-release-policy-'))
  try {
    const original = JSON.parse(await readFile(join(repositoryRoot, 'agent-contract.json'), 'utf8'))
    await writeFile(join(root, 'package.json'), await readFile(join(repositoryRoot, 'package.json')))
    for (const mutate of [
      contract => contract.boundaries.approvalRequired.push('release'),
      contract => { contract.boundaries.releaseDelivery.repeatApprovalRequired = true },
      contract => { contract.boundaries.releaseDelivery.userRestrictionsTakePrecedence = false },
      contract => { contract.boundaries.releaseDelivery.requiredConditions = ['authorized-merge'] },
      contract => { contract.boundaries.releaseDelivery.completionEvidence = [] },
    ]) {
      const contract = structuredClone(original)
      mutate(contract)
      await writeFile(join(root, 'agent-contract.json'), JSON.stringify(contract))
      await assert.rejects(verifyAgentContract(root), /release delivery/)
    }
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('attribution names the actual tool without inventing a co-author email', () => {
  assert.equal(attribution('DeepSeek Harness (DSH)'), 'Assisted-by: DeepSeek Harness (DSH)')
  for (const value of ['', 'DSH\nCo-authored-by: fake@example.com', 'fake@example.com']) {
    assert.throws(() => attribution(value))
  }
})

test('doctor fails missing dependencies but reports build and runtime evidence honestly', async () => {
  const root = await mkdtemp(join(tmpdir(), 'copilot-doctor-'))
  try {
    for (const path of ['agent-contract.json', 'package.json', 'deployment-baseline.json']) {
      await writeFile(join(root, path), await readFile(join(repositoryRoot, path)))
    }
    const missing = await doctor(root, '22.0.0')
    assert.equal(missing.ok, false)
    assert.equal(missing.checks.find(check => check.id === 'node-runtime').status, 'fail')
    assert.equal(missing.checks.find(check => check.id === 'build:lib/index.js').status, 'warning')
    for (const name of ['typescript', 'vitest', 'tsdown', '@earendil-works/pi-ai', '@deepseek-ai/dsh-llm-pi-ai']) {
      const path = join(root, 'node_modules', name)
      await mkdir(path, { recursive: true })
      await writeFile(join(path, 'package.json'), JSON.stringify({ name, version: '1.0.0' }))
    }
    assert.equal((await doctor(root, '22.18.0')).ok, false)
    assert.equal((await doctor(root, '22.19.0')).ok, true)
    const installed = await doctor(root, '24.19.0')
    assert.equal(installed.ok, true)
    assert.ok(installed.notChecked.includes('model transport'))
    assert.ok(installed.notChecked.includes('Copilot account availability'))
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('CLI unknown input returns one JSON error with exit 2', () => {
  const child = spawnSync(process.execPath, ['scripts/agent.mjs', 'unknown', '--json'], {
    cwd: repositoryRoot, encoding: 'utf8', timeout: 10_000,
  })
  assert.equal(child.status, 2)
  const result = JSON.parse(child.stdout)
  assert.equal(result.ok, false)
  assert.equal(result.schemaVersion, 1)
})

test('agent contract references actual files and verification gates', async () => {
  const result = await verifyAgentContract()
  assert.equal(result.ok, true)
  assert.equal(result.taskCount, 7)
})
