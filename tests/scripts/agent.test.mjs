import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { spawnSync } from 'node:child_process'
import { attribution, describeRepository, doctor, planTask, repositoryRoot } from '../../scripts/agent.mjs'
import { verifyAgentContract, verifyCurrentCoreDocument, verifyDocumentationReview } from '../../scripts/verify-agent-contract.mjs'
import { assessDocumentationImpact } from '../../scripts/verify-documentation-impact.mjs'

const documentationImpactBody = `### Documentation impact
- Behavior: user-facing
- Docs: README.md, README.zh.md, docs/accounts.md
- Details: Explain the account switch and its profile-wide behavior.`

test('documentation impact requires reviewable evidence for code and tooling changes', () => {
  const unchanged = {
    changedFiles: ['src/example.ts'],
    body: `### Documentation impact
- Behavior: unchanged
- Details: Refactors internal bookkeeping without changing public behavior.`,
  }
  assert.equal(assessDocumentationImpact(unchanged).required, true)
  assert.equal(assessDocumentationImpact({ changedFiles: ['docs/accounts.md'], body: null }).required, false)
  for (const body of [
    null,
    '<!-- ### Documentation impact\n- Behavior: unchanged\n- Details: Hidden text does not count as a review. -->',
    '### Documentation impact\n- Behavior: unchanged\n- Details: TODO',
    '### Documentation impact\n- Behavior: unchanged\n- Details: Reasonable explanation of the internal change.\n- Behavior: user-facing',
    '### Documentation impact\n- Behavior: unchanged\n- Details: Reasonable explanation of the internal change.\n### Documentation impact',
  ]) {
    assert.throws(() => assessDocumentationImpact({ ...unchanged, body }), /DOCUMENTATION_IMPACT/)
  }
  for (const path of ['scripts/example.mjs', 'package.json']) {
    assert.throws(() => assessDocumentationImpact({ changedFiles: [path], body: null }), /DOCUMENTATION_IMPACT/)
  }
})

test('user-facing changes require substantive bilingual and named domain documentation', () => {
  const input = {
    changedFiles: ['src/example.ts', 'README.md', 'README.zh.md', 'docs/accounts.md'],
    body: documentationImpactBody,
    versions: ['1.0.0', '1.1.0'],
    before: {
      'README.md': 'Install 1.0.0.\nOld behavior.',
      'README.zh.md': 'Install 1.0.0.\nOld behavior.',
      'docs/accounts.md': 'Old account behavior.',
    },
    after: {
      'README.md': 'Install 1.1.0.\nNew account behavior.',
      'README.zh.md': 'Install 1.1.0.\nNew account behavior.',
      'docs/accounts.md': 'New account behavior.',
    },
  }
  assert.deepEqual(assessDocumentationImpact(input).docs, ['README.md', 'README.zh.md', 'docs/accounts.md'])
  for (const invalid of [
    { ...input, changedFiles: input.changedFiles.filter(path => path !== 'README.zh.md') },
    { ...input, after: { ...input.after, 'README.md': 'Install 1.1.0.\nOld behavior.' } },
    { ...input, body: documentationImpactBody.replace(', docs/accounts.md', '') },
    { ...input, body: documentationImpactBody.replace('docs/accounts.md', 'docs/../accounts.md') },
    { ...input, after: { ...input.after, 'docs/accounts.md': 'Old account behavior.' } },
  ]) {
    assert.throws(() => assessDocumentationImpact(invalid), /DOCUMENTATION_IMPACT/)
  }
})

test('documentation impact CLI checks the actual PR base, head and event body', async () => {
  const root = await mkdtemp(join(tmpdir(), 'copilot-documentation-impact-'))
  const git = (...args) => {
    const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout.trim()
  }
  try {
    await mkdir(join(root, 'src'))
    await mkdir(join(root, 'docs'))
    const write = (path, content) => writeFile(join(root, path), content)
    await write('package.json', JSON.stringify({ version: '1.0.0' }))
    await write('README.md', 'Version 1.0.0\nOld behavior.\n')
    await write('README.zh.md', 'Version 1.0.0\nOld behavior.\n')
    await write('docs/accounts.md', 'Old account behavior.\n')
    await write('src/example.ts', 'export const value = 1\n')
    git('init', '-q')
    git('add', '.')
    git('-c', 'user.name=Documentation test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'base')
    git('update-ref', 'refs/remotes/origin/test-base', git('rev-parse', 'HEAD'))
    await write('package.json', JSON.stringify({ version: '1.1.0' }))
    await write('README.md', 'Version 1.1.0\nNew account behavior.\n')
    await write('README.zh.md', 'Version 1.1.0\nNew account behavior.\n')
    await write('docs/accounts.md', 'New account behavior.\n')
    await write('src/example.ts', 'export const value = 2\n')
    git('add', '.')
    git('-c', 'user.name=Documentation test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'change')
    const event = join(root, 'event.json')
    const invoke = () => spawnSync(process.execPath, [join(repositoryRoot, 'scripts', 'verify-documentation-impact.mjs')], {
      cwd: root, encoding: 'utf8',
      env: { ...process.env, GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: event, GITHUB_BASE_REF: 'test-base' },
    })

    await writeFile(event, JSON.stringify({ pull_request: { body: documentationImpactBody } }))
    assert.equal(invoke().status, 0)
    await writeFile(event, JSON.stringify({ pull_request: { body: 'SECRET_SENTINEL' } }))
    const rejected = invoke()
    assert.notEqual(rejected.status, 0)
    assert.match(rejected.stderr, /DOCUMENTATION_IMPACT/)
    assert.ok(!`${rejected.stdout}${rejected.stderr}`.includes('SECRET_SENTINEL'))
    git('update-ref', 'refs/remotes/origin/test-base', git('rev-parse', 'HEAD'))
    git('rm', 'src/example.ts')
    git('-c', 'user.name=Documentation test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'delete runtime')
    assert.notEqual(invoke().status, 0, 'deleting a runtime file still requires a declaration')
    await write('src/example.ts', 'export const value = 2\n')
    git('add', 'src/example.ts')
    git('-c', 'user.name=Documentation test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'restore runtime')
    git('update-ref', 'refs/remotes/origin/test-base', git('rev-parse', 'HEAD'))
    await mkdir(join(root, 'misc'))
    git('mv', 'src/example.ts', 'misc/example.ts')
    git('-c', 'user.name=Documentation test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'move runtime')
    assert.notEqual(invoke().status, 0, 'moving a runtime file outside its directory still requires a declaration')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('current documentation targets track package metadata rather than historical pins', async () => {
  const pkg = JSON.parse(await readFile(join(repositoryRoot, 'package.json'), 'utf8'))
  for (const file of ['AGENTS.md', 'docs/model-compatibility-acceptance.md', 'docs/image-input-compatibility.md']) {
    const text = await readFile(join(repositoryRoot, file), 'utf8')
    verifyCurrentCoreDocument(text, pkg.engines.dsh)
    assert.throws(() => verifyCurrentCoreDocument(text.replace(
      `Current source target: official DSH \`${pkg.engines.dsh}\``,
      'Current source target: official DSH `0.0.0-stale`',
    ), pkg.engines.dsh), /current-Core document/)
  }
})

test('agent contract keeps documentation review and PR-body edit checks wired into CI', async () => {
  const contract = JSON.parse(await readFile(join(repositoryRoot, 'agent-contract.json'), 'utf8'))
  const policy = contract.tasks.tooling.documentationReview
  const template = await readFile(join(repositoryRoot, '.github', 'PULL_REQUEST_TEMPLATE.md'), 'utf8')
  const workflow = await readFile(join(repositoryRoot, '.github', 'workflows', 'ci.yml'), 'utf8')
  verifyDocumentationReview(policy, template, workflow)
  for (const invalid of [
    { ...policy, detailsRequired: false },
    { ...policy, versionOnlyInsufficient: false },
    { ...policy, rerunOnBodyEdit: false },
    { ...policy, semanticReview: 'automated' },
  ]) {
    assert.throws(() => verifyDocumentationReview(invalid, template, workflow), /documentation impact/)
  }
  assert.throws(() => verifyDocumentationReview(policy, template.replace('### Documentation impact', '### Removed'), workflow), /documentation impact/)
  assert.throws(() => verifyDocumentationReview(policy, template, workflow.replace('opened, synchronize, reopened, edited', 'opened, synchronize, reopened')), /documentation impact/)
  assert.throws(() => verifyDocumentationReview(policy, template, workflow.replace('test "$DOCUMENTATION_RESULT" = success', 'echo ignored')), /documentation impact/)
})

test('describes actual package metadata without claiming a release exists', async () => {
  const result = await describeRepository()
  const pkg = JSON.parse(await readFile(join(repositoryRoot, 'package.json')))
  const baseline = JSON.parse(await readFile(join(repositoryRoot, 'deployment-baseline.json')))
  assert.equal(result.package.version, pkg.version)
  assert.equal(result.release.tag, `v${pkg.version}`)
  assert.equal(result.release.publicationVerified, false)
  assert.equal(result.release.npm.spec, `${pkg.name}@${pkg.version}`)
  assert.equal(result.release.npm.publicationVerified, false)
  assert.equal(result.acceptance.mode, 'evidence-consistency-only')
  assert.equal(result.acceptance.executed, false)
  assert.equal(result.acceptance.executionVerified, false)
  assert.equal(result.acceptance.independenceVerified, false)
  assert.deepEqual(result.acceptance.liveUi, {
    schemaVersion: 2, ci: 'guarded-exact-head', source: 'report-consistency-only',
    browserManualRequireLiveContract: true, automaticClosure: false,
    upgradeSource: 'exact-github-release-url-or-verified-cache',
    appLifecycle: 'fresh-discovery-consented-launch-safe-skip-rediscovery-final',
    disposition: 'separate-explicit-residual-risk-no-required-waiver',
    maxNavigationMethods: 2, maxObservationMs: 120000,
  })
  assert.deepEqual(result.admittedReleases, baseline.supportedBaselines.dsh.admittedReleases)
  assert.deepEqual(result.baselines.map(item => item.release),
    baseline.supportedBaselines.dsh.baselines.map(item => item.release))
})

test('plans only known task IDs with unexecuted argument arrays', async () => {
  const plan = await planTask('models')
  assert.ok(plan.commands.every(command => command.executed === false && Array.isArray(command.argv)))
  for (const testFile of ['tests/account-model-catalog.spec.ts', 'tests/account-model-source.spec.ts', 'tests/preview-route.spec.ts', 'tests/pi-provider-bridge.spec.ts']) {
    assert.ok(plan.tests.includes(testFile), `Missing general model gate: ${testFile}`)
  }
  await assert.rejects(planTask('__proto__'), /Unknown task/)
  assert.deepEqual((await planTask('tooling')).commands.map(command => command.argv.slice(3)), [
    ['--task', 'TASK_ID', '--environment', 'local-auxiliary', '--operation', 'scripts-test'],
    ['--task', 'TASK_ID', '--environment', 'github-actions-evidence', '--operation', 'ci-evidence',
      '--head', 'FULL_40_CHARACTER_COMMIT'],
  ])
  assert.ok(!(await planTask('tooling')).commands.some(command => command.argv.includes('pnpm')))
  assert.deepEqual((await planTask('tooling')).acceptance, (await describeRepository()).acceptance)
})

test('context diagnostics preserve shared usage and include native whole-turn evidence', async () => {
  const plan = await planTask('context')
  assert.ok(plan.tests.includes('tests/fixtures/turn-usage-core.fixture.ts'))
  const contract = JSON.parse(await readFile(join(repositoryRoot, 'agent-contract.json'), 'utf8'))
  assert.ok(contract.tasks.context.risk.includes('Never filter or delay shared native usage'))
  await verifyAgentContract()
})

test('guarded plans retain required read-only iteration review preflight', async () => {
  const plan = await planTask('autorouting')
  assert.deepEqual(plan.preflightChecks, [{
    argv: ['node', 'scripts/iteration-review.mjs', '--report', 'docs/auto-iteration-review.json'],
    executed: false,
    requiredBeforeImplementation: true,
  }])
  assert.ok(plan.commands.every(command => command.argv[1] === 'scripts/agent.mjs'
    && command.argv[2] === 'guard' && command.executed === false))
  assert.deepEqual((await planTask('tooling')).preflightChecks, [])
})

test('multi-account plan retains explicit direct-grant ownership and UI boundaries', async () => {
  const plan = await planTask('accounts')
  assert.ok(plan.tests.includes('tests/copilot-accounts-card.spec.ts'))
  const contract = JSON.parse(await readFile(join(repositoryRoot, 'agent-contract.json'), 'utf8'))
  assert.match(contract.tasks.accounts.risk, /never grant copies/)
  assert.match(contract.tasks.accounts.risk, /Models alone/)
  assert.match(contract.tasks.accounts.risk, /missing records never fall back/)
  assert.match(contract.tasks.accounts.risk, /Credits selects this Session's subsequent turns or restores inheritance/)
  assert.match(contract.tasks.accounts.risk, /hold account pins through native turn\/end\/disposal/)
  assert.match(contract.tasks.accounts.risk, /No durable account events, history\/default\/model\/Usage writes/)
  const doc = await readFile(join(repositoryRoot, 'docs/copilot-accounts.md'), 'utf8')
  assert.match(doc, /immutable account identifier/)
  assert.match(doc, /not a cross-namespace/)
  assert.match(doc, /No automatic fallback/)
  await verifyAgentContract()
})

test('upload evidence retains request scope, cleanup and local-only observation boundaries', async () => {
  const plan = await planTask('authorization')
  assert.ok(plan.tests.includes('tests/request-upload-evidence.spec.ts'))
  const contract = JSON.parse(await readFile(join(repositoryRoot, 'agent-contract.json'), 'utf8'))
  assert.ok(contract.tasks.authorization.read.includes('src/request-upload-evidence.ts'))
  assert.match(contract.tasks.authorization.requestBodyEvidenceBoundary, /dispose subscriptions/)
  assert.match(contract.tasks.authorization.requestBodyEvidenceBoundary, /not kernel ACK, supplier receipt or execution/)
  await verifyAgentContract()
})

test('automatic recovery plan preserves explicit composition and bounded capacity-only escalation', async () => {
  const plan = await planTask('compaction')
  for (const file of ['tests/preview-route.spec.ts', 'tests/fixtures/scoped-compaction-core.fixture.ts']) {
    assert.ok(plan.tests.includes(file))
  }
  assert.match(plan.automaticRecoveryBoundary, /Default-on only in the explicitly selected replacement/)
  assert.match(plan.automaticRecoveryBoundary, /at most 16 calls including the failed first attempt/)
  assert.match(plan.automaticRecoveryBoundary, /No 408\/network\/auth\/quota fallback/)
  assert.match(plan.automaticRecoveryBoundary, /no automatic live composition migration/)
  assert.match(plan.planningBoundary, /tokenMeter\.estimateMessage/)
  assert.match(plan.planningBoundary, /never compare content bytes directly with a token budget/)
  assert.match(plan.planningBoundary, /final native converted admission/)
  const guide = await readFile(join(repositoryRoot, 'docs/manual-compaction-recovery.md'), 'utf8')
  assert.match(guide, /matching guard, not a replacement/)
  assert.match(guide, /Existing Agents may retain the older preset generation/)
  await verifyAgentContract()
})

test('important updates carry release follow-through without a second approval prompt', async () => {
  const plan = await planTask('release')
  const policy = plan.boundaries.releaseDelivery
  assert.equal(policy.mode, 'important-update-follow-through')
  assert.equal(policy.repeatApprovalRequired, false)
  assert.equal(policy.userRestrictionsTakePrecedence, true)
  assert.equal(policy.otherChangesRequireExplicitReleaseRequest, true)
  assert.deepEqual(policy.requiredConditions, ['reviewed-merge', 'green-required-ci', 'fresh-annotated-tag', 'verified-release-assets'])
  assert.equal(policy.localGateWhenRegistryBlocked, 'record-environment-blocker-and-require-complete-github-ci')
  assert.deepEqual(policy.completionEvidence, ['published-release-url', 'tag-and-commit', 'asset-and-sha256', 'npm-version-and-integrity'])
  assert.ok(plan.tests.includes('tests/scripts/npm-distribution.test.mjs'))
  assert.ok(plan.commands.every(command => command.argv[1] === 'scripts/agent.mjs'
    && command.argv[2] === 'guard'))
  for (const boundary of ['merge', 'release']) {
    assert.ok(!plan.boundaries.approvalRequired.includes(boundary))
  }
  for (const boundary of ['install into a user profile', 'sign-out', 'worktree checkout']) {
    assert.ok(plan.boundaries.approvalRequired.includes(boundary))
  }
  assert.match(plan.delivery, /reviewed merge without a separate approval prompt; important updates continue to verified Release/)
  assert.ok(plan.commands.every(command => command.executed === false))
})

test('workspace policy preserves isolation, existing files and tool-specific delivery boundaries', async () => {
  const description = await describeRepository()
  assert.deepEqual(description.boundaries.workspaceIsolation, {
    default: 'app-managed-worktree-when-authorized',
    nonWorktree: 'inspect-and-preserve-shared-workspace',
    temporaryArtifacts: 'session-owned-outside-checkout',
    existingFiles: 'preserve-never-hide-or-delete-for-gates',
    delivery: 'review-explicit-commit-and-respect-tool-policy',
    escalation: 'once-for-genuine-blocker-or-risk',
    enforcement: 'advisory-not-a-sandbox',
  })
  const root = await mkdtemp(join(tmpdir(), 'copilot-workspace-policy-'))
  try {
    const original = JSON.parse(await readFile(join(repositoryRoot, 'agent-contract.json'), 'utf8'))
    const guide = await readFile(join(repositoryRoot, 'AGENTS.md'), 'utf8')
    await writeFile(join(root, 'package.json'), await readFile(join(repositoryRoot, 'package.json')))
    await writeFile(join(root, 'AGENTS.md'), guide)
    for (const mutate of [
      contract => { delete contract.boundaries.workspaceIsolation },
      contract => { contract.boundaries.workspaceIsolation.temporaryArtifacts = 'inside-checkout' },
      contract => { contract.boundaries.workspaceIsolation.existingFiles = 'delete-to-pass' },
      contract => { contract.boundaries.workspaceIsolation.delivery = 'bypass-tool-policy' },
      contract => { contract.boundaries.workspaceIsolation.enforcement = 'filesystem-sandbox' },
      contract => { contract.boundaries.workspaceIsolation.allowUnapprovedCheckout = true },
    ]) {
      const contract = structuredClone(original)
      mutate(contract)
      await writeFile(join(root, 'agent-contract.json'), JSON.stringify(contract))
      await assert.rejects(verifyAgentContract(root), /workspace isolation/)
    }
    await writeFile(join(root, 'agent-contract.json'), JSON.stringify(original))
    await writeFile(join(root, 'AGENTS.md'), guide.replace('## Session isolation and temporary artifacts (#442)', '## Removed'))
    await assert.rejects(verifyAgentContract(root), /workspace isolation/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('manual replay recovery plan retains explicit consent and rejects weakened boundaries', async () => {
  const plan = await planTask('compaction')
  assert.ok(plan.read.includes('src/compaction-replay.ts'))
  assert.ok(plan.tests.includes('tests/compaction-replay.spec.ts'))
  assert.match(plan.visibleHistoryBoundary, /Persistent Session visible-history policy/)
  assert.match(plan.visibleHistoryBoundary, /legacy next-turn-only consent is not summary consent/)
  assert.match(plan.visibleHistoryBoundary, /Disabled\/unknown policy never silently enables loss/)
  const root = await mkdtemp(join(tmpdir(), 'copilot-compaction-consent-'))
  try {
    const original = JSON.parse(await readFile(join(repositoryRoot, 'agent-contract.json'), 'utf8'))
    for (const file of original.entrypoints) {
      await mkdir(dirname(join(root, file)), { recursive: true })
      await writeFile(join(root, file), '')
    }
    await writeFile(join(root, 'package.json'), await readFile(join(repositoryRoot, 'package.json')))
    await writeFile(join(root, 'AGENTS.md'), await readFile(join(repositoryRoot, 'AGENTS.md')))
    for (const mutate of [
      contract => { delete contract.tasks.compaction.visibleHistoryBoundary },
      contract => { contract.tasks.compaction.visibleHistoryBoundary = 'Automatic fallback is permitted' },
      contract => { contract.tasks.compaction.tests = contract.tasks.compaction.tests.filter(file => file !== 'tests/compaction-replay.spec.ts') },
    ]) {
      const contract = structuredClone(original)
      mutate(contract)
      await writeFile(join(root, 'agent-contract.json'), JSON.stringify(contract))
      await assert.rejects(verifyAgentContract(root), /visible-history summary consent/)
    }
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('login environment plan rejects weakened native OAuth and tenant boundaries', async () => {
  const plan = await planTask('accounts')
  assert.ok(plan.read.includes('src/copilot-login-environment.ts'))
  assert.ok(plan.tests.includes('tests/scripts/copilot-login-environment.test.mjs'))
  const root = await mkdtemp(join(tmpdir(), 'copilot-login-contract-'))
  try {
    const original = JSON.parse(await readFile(join(repositoryRoot, 'agent-contract.json'), 'utf8'))
    for (const file of original.entrypoints) {
      await mkdir(dirname(join(root, file)), { recursive: true })
      await writeFile(join(root, file), '')
    }
    await writeFile(join(root, 'package.json'), await readFile(join(repositoryRoot, 'package.json')))
    await writeFile(join(root, 'AGENTS.md'), await readFile(join(repositoryRoot, 'AGENTS.md')))
    for (const mutate of [
      contract => { delete contract.tasks.accounts.loginEnvironmentBoundary },
      contract => { contract.tasks.accounts.loginEnvironmentBoundary = 'Accept arbitrary hosts with a second OAuth implementation' },
      contract => { contract.tasks.accounts.tests = contract.tasks.accounts.tests.filter(file => file !== 'tests/scripts/copilot-login-environment.test.mjs') },
    ]) {
      const contract = structuredClone(original)
      mutate(contract)
      await writeFile(join(root, 'agent-contract.json'), JSON.stringify(contract))
      await assert.rejects(verifyAgentContract(root), /login environments/)
    }
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('large composition plan rejects weakened replay, transport and consent boundaries', async () => {
  const plan = await planTask('diagnostics')
  assert.ok(plan.read.includes('src/request-body-composition.ts'))
  assert.ok(plan.tests.includes('tests/request-body-composition.spec.ts'))
  const root = await mkdtemp(join(tmpdir(), 'copilot-composition-contract-'))
  try {
    const original = JSON.parse(await readFile(join(repositoryRoot, 'agent-contract.json'), 'utf8'))
    for (const file of original.entrypoints) {
      await mkdir(dirname(join(root, file)), { recursive: true })
      await writeFile(join(root, file), '')
    }
    await writeFile(join(root, 'package.json'), await readFile(join(repositoryRoot, 'package.json')))
    await writeFile(join(root, 'AGENTS.md'), await readFile(join(repositoryRoot, 'AGENTS.md')))
    for (const mutate of [
      contract => { delete contract.tasks.diagnostics.compositionBoundary },
      contract => { contract.tasks.diagnostics.compositionBoundary = 'Increase replay limits and wait for diagnostics before sending' },
      contract => { contract.tasks.diagnostics.tests = contract.tasks.diagnostics.tests.filter(file => file !== 'tests/request-body-composition.spec.ts') },
    ]) {
      const contract = structuredClone(original)
      mutate(contract)
      await writeFile(join(root, 'agent-contract.json'), JSON.stringify(contract))
      await assert.rejects(verifyAgentContract(root), /large-request composition/)
    }
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('contract validation rejects a redundant release prompt or weakened release prerequisites', async () => {
  const root = await mkdtemp(join(tmpdir(), 'copilot-release-policy-'))
  try {
    const original = JSON.parse(await readFile(join(repositoryRoot, 'agent-contract.json'), 'utf8'))
    await writeFile(join(root, 'package.json'), await readFile(join(repositoryRoot, 'package.json')))
    await writeFile(join(root, 'AGENTS.md'), await readFile(join(repositoryRoot, 'AGENTS.md')))
    for (const [mutate, message] of [
      [contract => contract.boundaries.approvalRequired.push('release'), /release delivery/],
      [contract => contract.boundaries.approvalRequired.push('merge'), /merge must not require a separate approval/],
      [contract => { contract.boundaries.releaseDelivery.repeatApprovalRequired = true }, /release delivery/],
      [contract => { contract.boundaries.releaseDelivery.userRestrictionsTakePrecedence = false }, /release delivery/],
      [contract => { contract.boundaries.releaseDelivery.requiredConditions = ['reviewed-merge'] }, /release delivery/],
      [contract => { contract.boundaries.releaseDelivery.localGateWhenRegistryBlocked = 'skip-ci' }, /blocked local gate/],
      [contract => { contract.boundaries.releaseDelivery.completionEvidence = [] }, /release delivery/],
    ]) {
      const contract = structuredClone(original)
      mutate(contract)
      await writeFile(join(root, 'agent-contract.json'), JSON.stringify(contract))
      await assert.rejects(verifyAgentContract(root), message)
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
    assert.ok((await planTask(task)).commands.every(command => command.argv[2] === 'guard'))
  }
})

test('contract validation preserves quota and rejects plugin-owned parent-child policy', async () => {
  const root = await mkdtemp(join(tmpdir(), 'copilot-native-child-policy-'))
  try {
    const original = JSON.parse(await readFile(join(repositoryRoot, 'agent-contract.json'), 'utf8'))
    await writeFile(join(root, 'package.json'), await readFile(join(repositoryRoot, 'package.json')))
    for (const mutate of [
      contract => { contract.boundaries.confirmedProductScope.parentChildPolicyOwner = undefined },
      contract => { contract.boundaries.confirmedProductScope.parentChildPolicyOwner = 'plugin' },
      contract => { contract.boundaries.confirmedProductScope.preserve = contract.boundaries.confirmedProductScope.preserve.filter(value => value !== 'copilot-account-quota') },
      contract => { contract.boundaries.confirmedProductScope.enhancementPolicy = 'remove-all' },
    ]) {
      const contract = structuredClone(original)
      mutate(contract)
      await writeFile(join(root, 'agent-contract.json'), JSON.stringify(contract))
      await assert.rejects(verifyAgentContract(root), /confirmed Copilot-only model integration scope/)
    }
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('contract validation preserves the explicitly confirmed native model sync boundary', async () => {
  const root = await mkdtemp(join(tmpdir(), 'copilot-native-sync-policy-'))
  try {
    const original = JSON.parse(await readFile(join(repositoryRoot, 'agent-contract.json'), 'utf8'))
    await writeFile(join(root, 'package.json'), await readFile(join(repositoryRoot, 'package.json')))
    for (const mutate of [
      contract => { delete contract.tasks.models.nativeModelSyncBoundary },
      contract => { contract.tasks.models.nativeModelSyncBoundary = 'Automatically replace every provider.' },
      contract => { contract.tasks.models.nativeModelSyncBoundary = contract.tasks.models.nativeModelSyncBoundary.replace('non-forcing preview', 'preview') },
      contract => { contract.tasks.models.nativeModelSyncBoundary = contract.tasks.models.nativeModelSyncBoundary.replace('preserve supportsStrictMode: false only when at least one synced Responses or Completions model supports it', 'permit all overrides') },
      contract => { contract.tasks.models.tests = contract.tasks.models.tests.filter(value => !value.includes('native-model-sync')) },
    ]) {
      const contract = structuredClone(original)
      mutate(contract)
      await writeFile(join(root, 'agent-contract.json'), JSON.stringify(contract))
      await assert.rejects(verifyAgentContract(root), /native model sync/)
    }
  } finally { await rm(root, { recursive: true, force: true }) }
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
    for (const path of ['agent-contract.json', 'package.json', 'deployment-baseline.json', 'agent-execution-policy.json']) {
      await writeFile(join(root, path), await readFile(join(repositoryRoot, path)))
    }
    const missing = await doctor(root, '22.0.0')
    assert.equal(missing.ok, false)
    assert.equal(missing.checks.find(check => check.id === 'node-runtime').status, 'fail')
    assert.equal(missing.checks.find(check => check.id === 'build:lib/index.js').status, 'warning')
    assert.match(missing.next, /guarded environment/)
    assert.ok(missing.checks.filter(check => check.id.startsWith('dependency:'))
      .every(check => !check.next.includes('pnpm install')))
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
  assert.equal(result.taskCount, 17)
  const dropdown = await planTask('dropdown')
  assert.ok(dropdown.read.includes('src/account-dropdown.ts'))
  assert.ok(dropdown.tests.includes('tests/account-dropdown.spec.ts'))
  const continuation = await planTask('continuation')
  assert.ok(continuation.read.includes('docs/account-management-experience.md'))
  assert.ok(continuation.tests.includes('tests/session-continuation-ui.spec.ts'))
  const autointent = await planTask('autointent')
  assert.ok(autointent.read.includes('src/auto-model-intent.ts'))
  assert.ok(autointent.tests.includes('tests/fixtures/session-context-core.fixture.ts'))
  assert.ok(autointent.risk.includes('No Core projection replacement'))
  const autorouting = await planTask('autorouting')
  assert.ok(autorouting.read.includes('docs/auto-task-routing.md'))
  assert.ok(autorouting.tests.includes('tests/auto-task-classifier.spec.ts'))
  const context = await planTask('context')
  assert.ok(context.read.includes('src/context-evidence.ts'))
  assert.ok(context.tests.includes('tests/context-evidence-runtime.spec.ts'))
  const history = await planTask('history')
  assert.ok(history.read.includes('scripts/repair-auto-model-history.mjs'))
  assert.ok(history.tests.includes('tests/scripts/repair-auto-model-history.test.mjs'))
  assert.ok(history.read.includes('src/turn-usage-evidence.ts'))
  assert.ok(history.tests.includes('tests/fixtures/turn-usage-core.fixture.ts'))
  assert.ok(history.risk.includes('No fabricated zero usage, partial token totals'))
  const usage = await planTask('usage')
  assert.ok(usage.read.includes('src/copilot-usage-host.ts'))
  assert.ok(usage.tests.includes('tests/scripts/copilot-usage-gateway.test.mjs'))
  const compaction = await planTask('compaction')
  assert.ok(compaction.read.includes('docs/manual-compaction-recovery.md'))
  assert.ok(compaction.tests.includes('tests/manual-compaction-recovery.spec.ts'))
})
