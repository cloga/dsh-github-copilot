import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { spawnSync } from 'node:child_process'
import { attribution, describeRepository, doctor, planTask, repositoryRoot } from '../../scripts/agent.mjs'
import { verifyAgentContract } from '../../scripts/verify-agent-contract.mjs'
import { HydraFusionEvidenceCollector } from '../../src/hydrafusion-evidence.ts'
import { mapHydraFusionDescriptors } from '../../src/hydrafusion-descriptors.ts'

const fusionSelectionId = 'synthetic-selection-id'
const fusionStarted = {
  type: 'session.fusion_route_started', ephemeral: true,
  data: { attemptId: 'attempt-1', syntheticModel: fusionSelectionId, turnKind: 'user' },
}
const fusionResolved = {
  type: 'session.fusion_resolved',
  data: { fusionId: 'fusion-1', syntheticModel: fusionSelectionId, pattern: 'single' },
}
const fusionCompleted = (overrides = {}) => ({
  type: 'session.fusion_completed',
  data: {
    fusionId: 'fusion-1', syntheticModel: fusionSelectionId, commitId: 'commit-1',
    finalSourceModel: 'model-from-runtime', finalSourcePhaseId: 'phase-1',
    degradedReason: null, awaitingBackgroundWork: false, inputTokens: 10,
    outputTokens: 5, cachedTokens: 0, requestCount: 1, phaseCount: 1, totalNanoAiu: 50,
    ...overrides,
  },
})
const sessionIdle = (data = {}) => ({ type: 'session.idle', ephemeral: true, data })

test('describes actual package metadata without claiming a release exists', async () => {
  const result = await describeRepository()
  const pkg = JSON.parse(await readFile(join(repositoryRoot, 'package.json')))
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
  assert.deepEqual(result.admittedReleases, ['0.2.1-rc.3'])
  assert.deepEqual(result.baselines.map(baseline => baseline.release), [
    '0.1.1-rc.2', '0.1.2-rc.1', '0.1.3-alpha.1', '0.1.5-alpha.1', '0.1.5-alpha.2', '0.1.5-rc.1', '0.1.5-rc.2', '0.1.6-alpha.1', '0.1.6-alpha.2', '0.2.0-rc.1', '0.2.0-rc.2', '0.2.1-alpha.4', '0.2.1-alpha.5', '0.2.1-rc.3',
  ])
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

test('Client planning keeps Fusion preview informational until runtime ownership is qualified', async () => {
  const plan = await planTask('client')
  assert.ok(plan.read.includes('src/hydrafusion-preview-card.ts'))
  assert.ok(plan.read.includes('src/hydrafusion-descriptors.ts'))
  assert.ok(plan.read.includes('src/hydrafusion-evidence.ts'))
  assert.ok(plan.read.includes('docs/hydrafusion-integration-readiness.md'))
  assert.ok(plan.tests.includes('tests/scripts/agent.test.mjs'))
  assert.ok(plan.tests.includes('tests/hydrafusion-preview-card.spec.ts'))
  assert.ok(plan.tests.includes('tests/hydrafusion-descriptors.spec.ts'))
  assert.match(plan.hydrafusionPreviewBoundary, /read-only/)
  assert.match(plan.hydrafusionPreviewBoundary, /exact account\/runtime descriptors/)
  assert.match(plan.hydrafusionPreviewBoundary, /No model registration/)
  assert.match(plan.hydrafusionDescriptorBoundary, /explicit enabled true/)
  assert.match(plan.hydrafusionDescriptorBoundary, /Preserve ordinary DSH Auto/)
  assert.match(plan.hydrafusionEvidenceBoundary, /root session\.idle/)
  assert.match(plan.hydrafusionEvidenceBoundary, /No SDK runtime/)
  const card = await readFile(join(repositoryRoot, 'src/hydrafusion-preview-card.ts'), 'utf8')
  assert.match(card, /Not available in this plugin build\./)
  assert.doesNotMatch(card, /from ['"](?!react|\.\/native-settings-style\.ts)/)
  assert.doesNotMatch(card, /\b(fetch|useEffect|setInterval|setTimeout|onClick|onChange)\b/)
  assert.doesNotMatch(card, /createElement\('(button|input|select|option|progress)'/)
  const client = await readFile(join(repositoryRoot, 'src/client.ts'), 'utf8')
  const page = client.slice(client.indexOf('export function CopilotPluginSettingsPage'), client.indexOf('function DiagnosticsConnectionCard'))
  assert.match(page, /createElement\(HydraFusionPreviewCard\)/)
})

test('Fusion evidence is selection-bound and excludes intermediate content', () => {
  const collector = new HydraFusionEvidenceCollector(fusionSelectionId)
  collector.observe(fusionStarted)
  collector.observe(fusionResolved)
  collector.observe({
    type: 'assistant.fusion_phase_started',
    data: { fusionId: 'fusion-1', phaseId: 'phase-1', phaseKind: 'primary', model: 'model-from-runtime', role: 'solver' },
  })

  test('maps only explicit visible Fusion tiers from session model-list metadata', () => {
    const result = mapHydraFusionDescriptors({ auto: { tiers: [
      { id: 'opaque-standard', type: 'fusion', displayName: 'HydraFusion', description: 'Preview', fusionTier: 'standard', status: { enabled: true, pickerVisible: true } },
      { id: 'opaque-max', type: 'fusion', displayName: 'HydraFusion Max', status: { enabled: true } },
      { id: 'disabled', type: 'fusion', displayName: 'Disabled', status: { enabled: false } },
      { id: 'hidden', type: 'fusion', displayName: 'Hidden', status: { enabled: true, pickerVisible: false } },
      { id: 'unknown-enabled', type: 'fusion', displayName: 'Unknown', status: {} },
      { id: 'ordinary-auto', type: 'auto', displayName: 'Auto', status: { enabled: true } },
    ] } })

    assert.deepEqual(result, {
      status: 'ready',
      descriptors: [
        { id: 'opaque-standard', displayName: 'HydraFusion', description: 'Preview', fusionTier: 'standard' },
        { id: 'opaque-max', displayName: 'HydraFusion Max' },
      ],
      truncated: false,
    })

    assert.deepEqual(mapHydraFusionDescriptors({ auto: { tiers: [
      { id: 'duplicate', type: 'fusion', displayName: 'First', status: { enabled: true } },
      { id: 'duplicate', type: 'fusion', displayName: 'Second', status: { enabled: true } },
    ] } }), { status: 'unavailable', descriptors: [], truncated: false })
    assert.deepEqual(mapHydraFusionDescriptors({ models: [] }), {
      status: 'unavailable', descriptors: [], truncated: false,
    })
  })
  collector.observe({
    type: 'assistant.fusion_phase_completed',
    data: {
      fusionId: 'fusion-1', phaseId: 'phase-1', phaseKind: 'primary',
      model: 'model-from-runtime', role: 'solver', status: 'succeeded',
      durationMs: 125, content: 'intermediate private draft',
    },
  })
  const completed = collector.observe(fusionCompleted())
  assert.equal(completed.lifecycle, 'running')
  assert.equal(completed.outcome, undefined)
  assert.equal(completed.phases[0].status, 'succeeded')
  assert.equal(JSON.stringify(completed).includes('intermediate private draft'), false)

  const settled = collector.observe(sessionIdle())
  assert.equal(settled.lifecycle, 'idle')
  assert.equal(settled.outcome, 'completed')
  assert.deepEqual(settled.usage, {
    inputTokens: 10, outputTokens: 5, cachedTokens: 0,
    requestCount: 1, phaseCount: 1, totalNanoAiu: 50,
  })
})

test('Fusion stop acknowledgement is not cancellation until root session idle confirms abort', () => {
  const collector = new HydraFusionEvidenceCollector(fusionSelectionId)
  collector.observe(fusionStarted)
  assert.equal(collector.requestStop().lifecycle, 'stopping')
  assert.equal(collector.snapshot().outcome, undefined)
  collector.observe({ type: 'session.autopilot_stopped', data: {} })
  collector.observe({ type: 'assistant.idle', ephemeral: true, data: { aborted: true } })
  assert.equal(collector.snapshot().outcome, undefined)
  assert.equal(collector.snapshot().lifecycle, 'stopping')
  const settled = collector.observe(sessionIdle({ aborted: true }))
  assert.equal(settled.lifecycle, 'idle')
  assert.equal(settled.outcome, 'cancelled')
})

test('Fusion fallback is reported only after correlated committed completion and idle', () => {
  const collector = new HydraFusionEvidenceCollector(fusionSelectionId)
  collector.observe(fusionStarted)
  collector.observe(fusionResolved)
  collector.observe({
    type: 'session.fusion_route_failed',
    data: { attemptId: 'attempt-1', syntheticModel: fusionSelectionId, fallbackModel: 'fallback-from-runtime', reason: 'policy' },
  })
  assert.equal(collector.snapshot().outcome, undefined)
  collector.observe(fusionCompleted())
  assert.equal(collector.snapshot().outcome, undefined)
  assert.equal(collector.observe(sessionIdle()).outcome, 'completed-with-fallback')
})

test('Fusion evidence rejects mismatched selections and incomplete usage without inventing totals', () => {
  const collector = new HydraFusionEvidenceCollector(fusionSelectionId)
  collector.observe({ ...fusionStarted, data: { ...fusionStarted.data, syntheticModel: 'different-selection' } })
  collector.observe({ ...fusionResolved, data: { ...fusionResolved.data, syntheticModel: 'different-selection' } })
  collector.observe(fusionCompleted())
  assert.equal(collector.snapshot().lifecycle, 'unavailable')
  assert.equal(collector.snapshot().usage, undefined)

  const active = new HydraFusionEvidenceCollector(fusionSelectionId)
  active.observe(fusionStarted)
  active.observe(fusionResolved)
  active.observe(fusionCompleted({ outputTokens: undefined }))
  const settled = active.observe(sessionIdle())
  assert.equal(settled.outcome, 'completed')
  assert.equal(settled.usage, undefined)
})

test('Fusion evidence waits for all background work and ignores subagent terminal signals', () => {
  const background = new HydraFusionEvidenceCollector(fusionSelectionId)
  background.observe(fusionStarted)
  background.observe(fusionResolved)
  background.observe(fusionCompleted({ awaitingBackgroundWork: true }))
  const pending = background.observe(sessionIdle())
  assert.equal(pending.lifecycle, 'stopping')
  assert.equal(pending.outcome, undefined)

  const active = new HydraFusionEvidenceCollector(fusionSelectionId)
  active.observe(fusionStarted)
  assert.equal(active.observe({ type: 'session.idle', agentId: 'child-1', ephemeral: true, data: {} }).lifecycle, 'routing')
  assert.equal(active.observe({ type: 'session.error', agentId: 'child-1', data: {} }).lifecycle, 'routing')
  const failed = active.observe({ type: 'session.error', data: { message: 'private failure detail' } })
  assert.equal(failed.lifecycle, 'stopping')
  assert.equal(failed.outcome, undefined)
  const settled = active.observe(sessionIdle())
  assert.equal(settled.outcome, 'failed')
  assert.equal(JSON.stringify(settled).includes('private failure detail'), false)
})

test('Fusion phase projection is bounded and reports truncation', () => {
  const collector = new HydraFusionEvidenceCollector(fusionSelectionId)
  collector.observe(fusionStarted)
  collector.observe(fusionResolved)
  for (let index = 0; index < 33; index++) {
    collector.observe({
      type: 'assistant.fusion_phase_started',
      data: { fusionId: 'fusion-1', phaseId: `phase-${index}`, phaseKind: 'primary', model: 'model', role: 'solver' },
    })
  }
  assert.equal(collector.snapshot().phases.length, 32)
  assert.equal(collector.snapshot().phasesTruncated, true)
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
