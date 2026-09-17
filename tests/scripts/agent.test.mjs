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
  assert.equal(result.release.npm.spec, `${pkg.name}@${pkg.version}`)
  assert.equal(result.release.npm.publicationVerified, false)
  assert.deepEqual(result.baselines.map(baseline => baseline.release), [
    '0.1.1-rc.2', '0.1.2-rc.1', '0.1.3-alpha.1', '0.1.5-alpha.1', '0.1.5-alpha.2', '0.1.5-rc.1', '0.1.5-rc.2', '0.1.6-alpha.1', '0.1.6-alpha.2',
  ])
})

test('plans only known task IDs with unexecuted argument arrays', async () => {
  const plan = await planTask('models')
  assert.ok(plan.commands.every(command => command.executed === false && Array.isArray(command.argv)))
  for (const testFile of ['tests/account-model-catalog.spec.ts', 'tests/account-model-source.spec.ts', 'tests/preview-route.spec.ts', 'tests/pi-provider-bridge.spec.ts']) {
    assert.ok(plan.commands.some(command => command.argv.includes(testFile)), `Missing general model gate: ${testFile}`)
  }
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
  assert.deepEqual(policy.completionEvidence, ['published-release-url', 'tag-and-commit', 'asset-and-sha256', 'npm-version-and-integrity'])
  assert.ok(plan.commands.some(command => command.argv[0] === 'node' && command.argv[1] === '--test'
    && command.argv.includes('tests/scripts/npm-distribution.test.mjs')))
  assert.ok(!plan.commands.some(command => command.argv.includes('vitest')
    && command.argv.some(arg => arg.startsWith('tests/scripts/'))))
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

test('every task plan carries the plugin-only implementation boundary', async () => {
  const description = await describeRepository()
  const policy = description.boundaries.implementationScope
  assert.equal(policy.mode, 'plugin-only')
  assert.equal(policy.coreInspection, 'read-only')
  assert.equal(policy.allowedIntegration, 'published-public-apis')
  assert.equal(policy.unsupportedCapability, 'report-limitation-and-plugin-local-alternative')
  assert.equal(policy.scopeException, 'separate-explicit-human-request-only')
  for (const field of ['coreSourceChanges', 'coreArtifactPatching', 'coreRuntimeMonkeyPatching', 'corePatchDependency', 'coreCommitPrRelease']) {
    assert.equal(policy[field], false, field)
  }
  for (const task of Object.keys(description.tasks)) {
    assert.deepEqual((await planTask(task)).boundaries.implementationScope, policy)
  }
})

test('contract validation rejects removal or weakening of the plugin-only boundary', async () => {
  const root = await mkdtemp(join(tmpdir(), 'copilot-plugin-only-policy-'))
  try {
    const original = JSON.parse(await readFile(join(repositoryRoot, 'agent-contract.json'), 'utf8'))
    await writeFile(join(root, 'package.json'), await readFile(join(repositoryRoot, 'package.json')))
    const mutations = [
      contract => { delete contract.boundaries.implementationScope },
      ...['coreSourceChanges', 'coreArtifactPatching', 'coreRuntimeMonkeyPatching', 'corePatchDependency', 'coreCommitPrRelease']
        .map(field => contract => { contract.boundaries.implementationScope[field] = true }),
      contract => { contract.boundaries.implementationScope.mode = 'core-first' },
      contract => { contract.boundaries.implementationScope.allowCorePatchWhenConvenient = true },
      contract => { contract.boundaries.implementationScope.coreInspection = 'read-write' },
      contract => { contract.boundaries.implementationScope.allowedIntegration = 'private-internals' },
      contract => { contract.boundaries.implementationScope.unsupportedCapability = 'patch-core' },
      contract => { contract.boundaries.implementationScope.scopeException = 'infer-from-compatibility-task' },
    ]
    for (const mutate of mutations) {
      const contract = structuredClone(original)
      mutate(contract)
      await writeFile(join(root, 'agent-contract.json'), JSON.stringify(contract))
      await assert.rejects(verifyAgentContract(root), { message: /^Agent contract: plugin-only/ })
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
