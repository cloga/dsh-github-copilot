import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, link } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { validateLiveUi, verifyAcceptance } from '../../scripts/acceptance.mjs'
import { repositoryRoot } from '../../scripts/agent.mjs'
import { verifyCurrentCoreTemplate } from '../../scripts/verify-agent-contract.mjs'

const sha256 = value => createHash('sha256').update(value).digest('hex')
const cli = resolve(repositoryRoot, 'scripts/agent.mjs')
const git = (root, ...args) => {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim()
}

const liveContract = () => ({
  expectedPluginVersion: '0.1.0-alpha.1', panel: 'models-manage',
  checks: [{ id: 'acceptance-binding', action: 'reopen-manage', outcome: 'ready' }],
})
const timeBase = Date.now() - 10000
const t = offset => timeBase + offset
const liveReport = () => ({
  appState: 'running',
  lifecycle: {
    discovery: { state: 'running', atMs: t(500), source: 'list-apps' },
    launch: { state: 'not-needed', atMs: null },
    welcome: { state: 'not-seen', atMs: null },
    rediscovery: { atMs: t(900), source: 'list-apps', window: 'same' },
    final: { atMs: t(1200), source: 'list-apps-and-get-window-state',
      appState: 'running', surface: 'target-panel' },
    interaction: 'clear',
  },
  desktop: { version: '0.2.1-rc.3', source: 'about', observedAtMs: t(1000) },
  installed: { version: '0.1.0-alpha.1', source: 'disk-manifest', observedAtMs: t(1000) },
  loaded: { version: '0.1.0-alpha.1', source: 'public-runtime-status', observedAtMs: t(1000) },
  upgradeSource: {
    kind: 'github-release-url', version: '0.1.0-alpha.1',
    url: 'https://github.com/cloga/dsh-github-copilot/releases/download/v0.1.0-alpha.1/dsh-github-copilot-0.1.0-alpha.1.tgz',
    sha256: 'a'.repeat(64), releaseSha256: 'a'.repeat(64), fallbackReason: 'none', observedAtMs: t(1000),
  },
  navigation: [{ method: 'accessible-control', outcome: 'opened', atMs: t(1001),
    observedAtMs: t(1002), observationSource: 'get-window-state' }],
  handoff: { state: 'none', panel: 'models-manage' },
  permission: { state: 'safe-read-only', action: 'none' },
  steps: [{ checkId: 'acceptance-binding', action: 'reopen-manage', observation: 'ready',
    startedAtMs: t(1003), finishedAtMs: t(1100), observedAtMs: t(1101), observationSource: 'get-window-state' }],
})

for (const [name, mutate, code] of [
  ['not run', r => { r.navigation = []; r.steps = [] }, 'LIVE_UI_NOT_RUN'],
  ['app stopped', r => { r.appState = 'not-running' }, 'LIVE_UI_APP_UNAVAILABLE'],
  ['installed not loaded', r => { r.loaded = { version: null, source: 'unknown', observedAtMs: null } },
    'LIVE_UI_LOADED_VERSION_UNCONFIRMED'],
  ['wrong loaded version', r => { r.loaded.version = '0.1.0-alpha.2' }, 'LIVE_UI_VERSION_PREREQUISITE_UNMET'],
  ['automation failure', r => {
    r.navigation = [{ method: 'accessible-control', outcome: 'unchanged', atMs: t(1001),
      observedAtMs: t(1002), observationSource: 'get-window-state' },
    { method: 'supported-shortcut', outcome: 'no-candidate', atMs: t(1003),
      observedAtMs: t(1004), observationSource: 'get-window-state' }]
    r.steps = []; r.handoff.state = 'requested'
  }, 'LIVE_UI_AUTOMATION_BLOCKED'],
  ['missing check', r => { r.steps = [] }, 'LIVE_UI_INCOMPLETE'],
  ['wrong action for required check', r => { r.steps[0].action = 'observe-panel' }, 'LIVE_UI_INCOMPLETE'],
  ['error', r => { r.steps[0].observation = 'error' }, 'LIVE_UI_OBSERVATION_FAILED'],
  ['timeout', r => { r.steps[0].observation = 'timeout' }, 'LIVE_UI_OBSERVATION_FAILED'],
  ['no change', r => { r.steps[0].observation = 'unchanged' }, 'LIVE_UI_OBSERVATION_FAILED'],
  ['user absent', r => { r.permission.state = 'user-absent' }, 'LIVE_UI_PERMISSION_BLOCKED'],
  ['handoff not opened', r => { r.handoff.state = 'requested' }, 'LIVE_UI_HANDOFF_PENDING'],
  ['historical discovery without startup approval', r => {
    r.lifecycle.discovery.state = 'not-running'
  }, 'LIVE_UI_LAUNCH_BLOCKED'],
  ['welcome requiring real authentication', r => {
    r.lifecycle.welcome = { state: 'auth-required', atMs: t(600) }
  }, 'LIVE_UI_AUTH_REQUIRED'],
  ['safe welcome skip not yet used', r => {
    r.lifecycle.welcome = { state: 'safe-skip-observed', atMs: t(600) }
  }, 'LIVE_UI_WELCOME_UNRESOLVED'],
  ['launch receipt without new window discovery', r => {
    r.lifecycle.rediscovery = { atMs: null, source: 'list-apps', window: 'unobserved' }
  }, 'LIVE_UI_WINDOW_UNCONFIRMED'],
  ['welcome instead of current main interface', r => {
    r.lifecycle.final.surface = 'welcome'
  }, 'LIVE_UI_CURRENT_APP_UNCONFIRMED'],
  ['current app stopped after past success', r => {
    r.lifecycle.final.appState = 'not-running'
  }, 'LIVE_UI_CURRENT_APP_UNCONFIRMED'],
  ['missing final observation', r => { r.lifecycle.final.atMs = null }, 'LIVE_UI_CURRENT_APP_UNCONFIRMED'],
  ['final observation predates action', r => { r.lifecycle.final.atMs = t(1000) }, 'LIVE_UI_CURRENT_APP_UNCONFIRMED'],
  ['input interruption', r => { r.lifecycle.interaction = 'interrupted' }, 'LIVE_UI_INPUT_INTERRUPTED'],
  ...['local-build', 'source-directory', 'link-worktree', 'unknown'].map(kind => [
    `upgrade from ${kind}`, r => { r.upgradeSource.kind = kind }, 'LIVE_UI_UPGRADE_SOURCE_REJECTED',
  ]),
  ['unexplained local cache', r => { r.upgradeSource.kind = 'verified-github-cache' }, 'LIVE_UI_UPGRADE_SOURCE_REJECTED'],
  ['cache hash mismatch', r => {
    r.upgradeSource.kind = 'verified-github-cache'; r.upgradeSource.fallbackReason = 'native-url-rejected'
    r.upgradeSource.sha256 = 'b'.repeat(64)
  }, 'LIVE_UI_UPGRADE_SOURCE_REJECTED'],
  ['missing release digest', r => { r.upgradeSource.releaseSha256 = null }, 'LIVE_UI_UPGRADE_SOURCE_REJECTED'],
  ['cache without archive hash', r => {
    r.upgradeSource.kind = 'verified-github-cache'; r.upgradeSource.fallbackReason = 'native-url-unavailable'
    r.upgradeSource.sha256 = null
  }, 'LIVE_UI_UPGRADE_SOURCE_REJECTED'],
  ['preferred URL mislabeled as fallback', r => {
    r.upgradeSource.fallbackReason = 'native-url-rejected'
  }, 'LIVE_UI_UPGRADE_SOURCE_REJECTED'],
  ...['restart', 'install', 'account-switch', 'oauth', 'paid-call'].map(action => [
    `permission for ${action}`, r => { r.permission = { state: 'approval-required', action } },
    'LIVE_UI_PERMISSION_BLOCKED',
  ]),
]) {
  test(`live consistency rejects ${name} rather than reporting completion`, () => {
    const report = liveReport()
    mutate(report)
    const result = validateLiveUi(liveContract(), report)
    assert.equal(result.ok, false)
    assert.equal(result.code, code)
    assert.equal(result.executionVerified, false)
    assert.equal(result.versionFixReportedConsistent, false)
  })
}

for (const [name, mutate] of [
  ['duplicate navigation method', r => { r.navigation.push({ ...r.navigation[0] }) }],
  ['third navigation attempt', r => { r.navigation = Array(3).fill(r.navigation[0]) }],
  ['unbounded wait', r => { r.steps[0].finishedAtMs = 200000 }],
  ['wrong time order', r => { r.steps[0].finishedAtMs = 1 }],
  ['raw account field', r => { r.account = 'PRIVATE_SENTINEL' }],
  ['raw observation text', r => { r.steps[0].observation = 'PRIVATE_SENTINEL' }],
  ['unknown version source', r => { r.loaded.source = 'installed-means-loaded' }],
  ['unsupported activation', r => { r.steps[0].action = 'shell-activate' }],
  ['action receipt instead of fresh UI observation', r => { r.steps[0].observationSource = 'action-done' }],
  ['immediate diff instead of fresh navigation observation', r => { r.navigation[0].observationSource = 'action-diff' }],
  ['stale post-action observation', r => { r.steps[0].observedAtMs = r.steps[0].finishedAtMs }],
  ['local source path', r => { r.upgradeSource.url = 'C:\\local\\build.tgz' }],
  ['wrong release version URL', r => { r.upgradeSource.url = r.upgradeSource.url.replaceAll('alpha.1', 'alpha.2') }],
  ['noncanonical release URL', r => { r.upgradeSource.url = 'https://example.invalid/package.tgz' }],
  ['shell launch source', r => { r.lifecycle.launch.state = 'shell-start' }],
  ['raw workspace title', r => { r.lifecycle.final.title = 'PRIVATE_SENTINEL' }],
  ['launch again when app already running', r => {
    r.lifecycle.launch = { state: 'authorized-start-app', atMs: t(550) }
  }],
]) {
  test(`live consistency rejects ${name} with a fixed diagnostic`, () => {
    const report = liveReport()
    mutate(report)
    assert.throws(() => validateLiveUi(liveContract(), report), /^Error: ACCEPTANCE_INVALID$/)
  })
}

test('complete bounded live evidence remains a consistency judgment, not execution attestation', () => {
  const result = validateLiveUi(liveContract(), liveReport())
  assert.equal(result.ok, true)
  assert.equal(result.source, 'report-consistency-only')
  assert.equal(result.executionVerified, false)
  const contract = liveContract(), report = liveReport()
  contract.checks[0].outcome = report.steps[0].observation = 'actionable-failure'
  assert.equal(validateLiveUi(contract, report).ok, true)
  report.upgradeSource.kind = 'verified-github-cache'
  report.upgradeSource.fallbackReason = 'native-url-unavailable'
  const cached = validateLiveUi(contract, report)
  assert.equal(cached.ok, true)
  assert.equal(cached.upgradeSourceKind, 'verified-github-cache')
  assert.equal(cached.provenanceVerified, false)
})

test('navigation escalation asks for the specified panel once without inferring user response', () => {
  const report = liveReport()
  report.steps = []
  report.navigation[0].outcome = 'unchanged'
  assert.equal(validateLiveUi(liveContract(), report).nextAction, 'try-one-supported-alternate')
  report.navigation.push({ method: 'supported-shortcut', outcome: 'no-candidate',
    atMs: t(1003), observedAtMs: t(1004), observationSource: 'get-window-state' })
  assert.equal(validateLiveUi(liveContract(), report).nextAction, 'request-specified-panel-once')
  report.handoff.state = 'user-absent'
  assert.equal(validateLiveUi(liveContract(), report).nextAction, 'wait-for-user-panel')
  assert.equal(validateLiveUi(liveContract(), report).ok, false)
  const unknown = liveReport()
  unknown.loaded = { version: null, source: 'unknown', observedAtMs: null }
  const qualified = validateLiveUi(liveContract(), unknown)
  assert.equal(qualified.qualifiedObservation, true)
  assert.equal(qualified.ok, false)
})

test('consented controlled launch and safe welcome skip require rediscovered main window and fresh final state', () => {
  const report = liveReport()
  report.lifecycle.discovery.state = 'not-running'
  report.lifecycle.launch = { state: 'authorized-start-app', atMs: t(550) }
  report.lifecycle.welcome = { state: 'safe-skip-used', atMs: t(600) }
  report.lifecycle.rediscovery.window = 'replacement'
  report.lifecycle.final.surface = 'workspace'
  const result = validateLiveUi(liveContract(), report, t(1300))
  assert.equal(result.ok, true)
  assert.equal(result.currentAppObservedAtMs, t(1200))
  assert.equal(result.executionVerified, false)
  assert.equal(validateLiveUi(liveContract(), report, t(121201)).code, 'LIVE_UI_CURRENT_APP_UNCONFIRMED')
  assert.equal(validateLiveUi(liveContract(), report, t(1199)).code, 'LIVE_UI_CURRENT_APP_UNCONFIRMED')
  report.lifecycle.launch.state = 'not-authorized'; report.lifecycle.launch.atMs = null
  assert.equal(validateLiveUi(liveContract(), report).code, 'LIVE_UI_LAUNCH_BLOCKED')
})

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

test('live contract composes real CI reader and persistent budget, never a supplied green report', () => fixture(async f => {
  git(f.checkout, 'remote', 'add', 'origin', 'https://github.com/cloga/dsh-github-copilot.git')
  f.contract.schemaVersion = f.report.schemaVersion = 2
  f.contract.requirements[0].method = 'manual'
  f.contract.liveUi = liveContract()
  f.report.liveUi = liveReport()
  f.report.checks[0].notes = 'observed'
  f.report.checks[0].evidence = []
  let apiFailure = false, conclusion = 'success', calls = 0
  const execute = (command, args, options) => {
    if (command !== 'gh') return spawnSync(command, args, options)
    calls++
    if (apiFailure) return { status: 1, stdout: '' }
    const endpoint = args[1]
    const value = endpoint.includes('/workflows/') ? {
      id: 1, name: 'CI', path: '.github/workflows/ci.yml', state: 'active',
    } : endpoint.includes('/jobs?') ? { jobs: [
      'verify (ubuntu-latest)', 'verify (windows-latest)', 'Published adapter (ubuntu-latest)',
      'Published adapter (windows-latest)', 'release-ready',
    ].map(name => ({ name, status: 'completed', conclusion: 'success' })) } : {
      workflow_runs: [{ id: 1, workflow_id: 1, run_number: 1, run_attempt: 1,
        head_sha: f.report.commit, status: 'completed', conclusion }],
    }
    return { status: 0, stdout: JSON.stringify(value) }
  }
  const verify = () => verifyAcceptance({
    root: f.checkout, contractPath: f.contractPath, reportPath: f.reportPath, execute,
  })
  await f.save()
  const complete = await verify()
  assert.equal(complete.ok, true)
  assert.equal(complete.ciVerified, true)
  assert.equal(complete.executionVerified, false)
  assert.equal(calls, 3)
  f.report.checks[0].status = 'not-run'
  await f.save()
  assert.equal((await verify()).closeEligible, false)
  f.report.checks[0].status = 'passed'
  f.report.liveUi.steps = []
  await f.save()
  const missing = await verify()
  assert.equal(missing.ciVerified, true)
  assert.equal(missing.ok, false)
  assert.equal(missing.closeEligible, false)
  f.report.liveUi = liveReport()
  f.report.liveUi.loaded = { version: null, source: 'unknown', observedAtMs: null }
  await f.save()
  const installedOnly = await verify()
  assert.equal(installedOnly.ciVerified, true)
  assert.equal(installedOnly.closeEligible, false)
  assert.equal(installedOnly.liveUi.qualifiedObservation, true)
  f.report.liveUi = liveReport()
  conclusion = 'failure'
  await f.save()
  const failedCi = await verify()
  assert.equal(failedCi.liveUi.ok, true)
  assert.equal(failedCi.ok, false)
  assert.equal(failedCi.ci.code, 'CI_RUN_FAILED')
  apiFailure = true
  assert.equal((await verify()).ci.failedAttempts, 1)
  apiFailure = false; conclusion = 'success'
  assert.equal((await verify()).ci.failedAttempts, 1)
  apiFailure = true
  assert.equal((await verify()).ci.failedAttempts, 2)
  const before = calls
  assert.equal((await verify()).ci.code, 'GUARD_FAILURE_BUDGET_EXHAUSTED')
  assert.equal(calls, before)
}))

test('legacy report cannot claim required live acceptance without a live contract', () => fixture(async f => {
  f.contract.requirements[0].method = 'browser'
  await f.save()
  await assert.rejects(f.verify(), /ACCEPTANCE_LIVE_CONTRACT_REQUIRED/)
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
