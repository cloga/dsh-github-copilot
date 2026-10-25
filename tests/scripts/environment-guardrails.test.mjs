import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { runGuardedOperation } from '../../scripts/environment-guard.mjs'

const repository = 'cloga/dsh-github-copilot'
const requiredJobs = [
  'verify (ubuntu-latest)',
  'verify (windows-latest)',
  'Published adapter (ubuntu-latest)',
  'Published adapter (windows-latest)',
  'release-ready',
]
const git = (cwd, ...args) => {
  const result = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim()
}

async function checkout(run) {
  const root = await mkdtemp(join(tmpdir(), 'copilot-env-guard-'))
  try {
    git(root, 'init', '--quiet')
    git(root, 'config', 'user.name', 'Environment guard fixture')
    git(root, 'config', 'user.email', 'fixture@example.invalid')
    await writeFile(join(root, 'source.txt'), 'fixture\n')
    git(root, 'add', 'source.txt')
    git(root, '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'fixture')
    git(root, 'remote', 'add', 'origin', `https://github.com/${repository}.git`)
    const head = git(root, 'rev-parse', 'HEAD')
    await run({ root, head })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

function ciPayload({ workflow = {}, run = {}, jobs = [], includeRelease = true } = {}) {
  return {
    workflow: {
      id: 42, name: 'CI', path: '.github/workflows/ci.yml', state: 'active', ...workflow,
    },
    runs: {
      workflow_runs: [{
        id: 100, workflow_id: 42, head_sha: '', status: 'completed', conclusion: 'success',
        run_number: 12, run_attempt: 1, event: 'pull_request',
        html_url: 'https://github.com/cloga/dsh-github-copilot/actions/runs/100',
        ...run,
      }],
    },
    jobs: {
      jobs: [
        ...requiredJobs.map(name => ({ name, status: 'completed', conclusion: 'success' })),
        ...(includeRelease ? [{ name: 'release', status: 'completed', conclusion: 'skipped' }] : []),
        ...jobs,
      ],
    },
  }
}

function ciExecutor(payload, calls = []) {
  return (command, args, options) => {
    if (command === 'git') return spawnSync(command, args, options)
    assert.equal(command, 'gh')
    calls.push({ args, timeout: options.timeout })
    const endpoint = args[1]
    const body = endpoint.endsWith('/actions/workflows/ci.yml') ? payload.workflow
      : endpoint.includes('/actions/runs?') ? payload.runs
        : endpoint.includes('/actions/runs/100/jobs?') ? payload.jobs
          : null
    if (body === null) return { status: 1, stdout: '', stderr: '' }
    if (endpoint.includes('/actions/runs?') && payload.runs.workflow_runs[0]?.head_sha === '') {
      payload.runs.workflow_runs[0].head_sha = payload.head
    }
    return { status: 0, stdout: JSON.stringify(body), stderr: '' }
  }
}

test('local dependency-network operation fails before executing any process', async () => checkout(async ({ root }) => {
  let executions = 0
  const result = await runGuardedOperation({
    root, task: '451', environment: 'local-auxiliary', operation: 'dependency-install',
    execute: () => { executions++; throw new Error('must not execute') },
  })
  assert.equal(executions, 0)
  assert.equal(result.state, 'blocked')
  assert.equal(result.code, 'GUARD_LOCAL_NETWORK_BLOCKED')
  assert.equal(result.executed, false)
}))

test('failed operation budget persists across calls and blocks before the next execution', async () => checkout(async ({ root }) => {
  let executions = 0
  const execute = (command, args, options) => {
    if (command === 'git') return spawnSync(command, args, options)
    executions++
    return { status: 1, error: null, stdout: '', stderr: '' }
  }
  const invoke = () => runGuardedOperation({
    root, task: '451', environment: 'local-auxiliary', operation: 'scripts-test', execute,
  })
  const first = await invoke()
  const second = await invoke()
  const blocked = await invoke()
  assert.deepEqual([first.failedAttempts, second.failedAttempts], [1, 2])
  assert.equal(first.state, 'failed')
  assert.equal(second.remainingFailures, 0)
  assert.equal(blocked.code, 'GUARD_FAILURE_BUDGET_EXHAUSTED')
  assert.equal(blocked.executed, false)
  assert.equal(executions, 2)
  const statePath = git(root, 'rev-parse', '--git-path', 'copilot-agent-guard-state.json')
  const state = JSON.parse(await readFile(join(root, statePath), 'utf8'))
  assert.equal(state.failures['451:scripts-test'], 2)
}))

test('task and operation scopes do not share failure counts', async () => checkout(async ({ root }) => {
  let executions = 0
  const execute = (command, args, options) => command === 'git'
    ? spawnSync(command, args, options)
    : (++executions, { status: 1, stdout: '', stderr: '' })
  await runGuardedOperation({
    root, task: '451', environment: 'local-auxiliary', operation: 'scripts-test', execute,
  })
  const otherTask = await runGuardedOperation({
    root, task: '452', environment: 'local-auxiliary', operation: 'scripts-test', execute,
  })
  assert.equal(otherTask.failedAttempts, 1)
  assert.equal(executions, 2)
}))

test('CI evidence accepts official Windows/Linux verification and an expected skipped release', async () => checkout(async ({ root, head }) => {
  const calls = []
  const payload = ciPayload({ run: { head_sha: head } })
  payload.head = head
  const result = await runGuardedOperation({
    root, task: '451', environment: 'github-actions-evidence', operation: 'ci-evidence',
    head, execute: ciExecutor(payload, calls),
  })
  assert.equal(result.state, 'passed')
  assert.equal(result.code, 'CI_EVIDENCE_VERIFIED')
  assert.equal(result.evidence.repository, repository)
  assert.equal(result.evidence.head, head)
  assert.equal(result.evidence.workflow.path, '.github/workflows/ci.yml')
  assert.deepEqual(result.evidence.jobs.map(job => job.name), [...requiredJobs, 'release'])
  assert.equal(result.evidence.jobs.at(-1).conclusion, 'skipped')
  assert.equal(calls.length, 3)
  assert.ok(calls.every(call => call.args[0] === 'api' && !call.args.includes('--paginate')
    && call.timeout === 15000))
}))

for (const [label, configure, expectedCode] of [
  ['missing run', payload => { payload.runs.workflow_runs = [] }, 'CI_RUN_MISSING'],
  ['old head', payload => { payload.runs.workflow_runs[0].head_sha = 'b'.repeat(40) }, 'CI_RUN_MISSING'],
  ['wrong workflow', payload => { payload.runs.workflow_runs[0].workflow_id = 99 }, 'CI_WORKFLOW_MISMATCH'],
  ['wrong workflow path', payload => { payload.workflow.path = '.github/workflows/release.yml' }, 'CI_WORKFLOW_MISMATCH'],
  ['failed run', payload => { payload.runs.workflow_runs[0].conclusion = 'failure' }, 'CI_RUN_FAILED'],
  ['cancelled run', payload => { payload.runs.workflow_runs[0].conclusion = 'cancelled' }, 'CI_RUN_CANCELLED'],
  ['in-progress run', payload => { payload.runs.workflow_runs[0].status = 'in_progress' }, 'CI_RUN_IN_PROGRESS'],
  ['skipped required job', payload => { payload.jobs.jobs[0].conclusion = 'skipped' }, 'CI_REQUIRED_JOB_SKIPPED'],
  ['failed required job', payload => { payload.jobs.jobs[1].conclusion = 'failure' }, 'CI_REQUIRED_JOB_FAILED'],
  ['cancelled required job', payload => { payload.jobs.jobs[1].conclusion = 'cancelled' }, 'CI_REQUIRED_JOB_CANCELLED'],
  ['missing required job', payload => { payload.jobs.jobs = payload.jobs.jobs.filter(job => job.name !== requiredJobs[0]) }, 'CI_REQUIRED_JOB_MISSING'],
  ['duplicate required job', payload => { payload.jobs.jobs.push({ ...payload.jobs.jobs[0] }) }, 'CI_REQUIRED_JOB_DUPLICATE'],
  ['in-progress required job', payload => { payload.jobs.jobs[0].status = 'in_progress' }, 'CI_REQUIRED_JOB_IN_PROGRESS'],
  ['failed optional release', payload => { payload.jobs.jobs.at(-1).conclusion = 'failure' }, 'CI_RELEASE_JOB_FAILED'],
]) {
  test(`CI evidence rejects ${label}`, async () => checkout(async ({ root, head }) => {
    const payload = ciPayload({ run: { head_sha: head } })
    payload.head = head
    configure(payload)
    const result = await runGuardedOperation({
      root, task: '451', environment: 'github-actions-evidence', operation: 'ci-evidence',
      head, execute: ciExecutor(payload),
    })
    assert.equal(result.state, 'blocked')
    assert.equal(result.code, expectedCode)
  }))
}

test('CI evidence rejects a changed local HEAD before contacting GitHub', async () => checkout(async ({ root, head }) => {
  await writeFile(join(root, 'source.txt'), 'changed\n')
  git(root, 'add', 'source.txt')
  git(root, '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'move HEAD')
  let ghCalls = 0
  const result = await runGuardedOperation({
    root, task: '451', environment: 'github-actions-evidence', operation: 'ci-evidence',
    head, execute: (command, args, options) => command === 'git'
      ? spawnSync(command, args, options) : (++ghCalls, { status: 1, stdout: '', stderr: '' }),
  })
  assert.equal(result.code, 'CI_HEAD_MISMATCH')
  assert.equal(result.executed, true)
  assert.equal(ghCalls, 0)
}))

test('CI evidence rejects a repository that does not match the configured origin', async () => checkout(async ({ root, head }) => {
  git(root, 'remote', 'set-url', 'origin', 'https://github.com/example/another-repo.git')
  let ghCalls = 0
  const result = await runGuardedOperation({
    root, task: '451', environment: 'github-actions-evidence', operation: 'ci-evidence',
    head, execute: (command, args, options) => command === 'git'
      ? spawnSync(command, args, options) : (++ghCalls, { status: 1, stdout: '', stderr: '' }),
  })
  assert.equal(result.code, 'CI_REPOSITORY_MISMATCH')
  assert.equal(ghCalls, 0)
}))

test('CI evidence accepts a successful run when the optional release job is absent', async () => checkout(async ({ root, head }) => {
  const payload = ciPayload({ run: { head_sha: head }, includeRelease: false })
  payload.head = head
  const result = await runGuardedOperation({
    root, task: '451', environment: 'github-actions-evidence', operation: 'ci-evidence',
    head, execute: ciExecutor(payload),
  })
  assert.equal(result.state, 'passed')
  assert.equal(result.evidence.jobs.length, requiredJobs.length)
}))

test('CI query failures consume a persistent budget and stop before a third query', async () => checkout(async ({ root, head }) => {
  let ghCalls = 0
  const execute = (command, args, options) => {
    if (command === 'git') return spawnSync(command, args, options)
    ghCalls++
    return { status: 1, stdout: '', stderr: '' }
  }
  const invoke = () => runGuardedOperation({
    root, task: '451', environment: 'github-actions-evidence', operation: 'ci-evidence',
    head, execute,
  })
  const first = await invoke()
  const second = await invoke()
  const third = await invoke()
  assert.equal(first.code, 'CI_GITHUB_READ_UNAVAILABLE')
  assert.equal(second.code, 'CI_GITHUB_READ_UNAVAILABLE')
  assert.equal(second.remainingFailures, 0)
  assert.equal(third.code, 'GUARD_FAILURE_BUDGET_EXHAUSTED')
  assert.equal(third.executed, false)
  assert.equal(ghCalls, 2)
}))

for (const [status, conclusion, code] of [
  ['completed', 'failure', 'CI_RUN_FAILED'],
  ['in_progress', null, 'CI_RUN_IN_PROGRESS'],
]) {
  test(`an older successful rerun cannot mask a newer ${status} run`, () => checkout(async ({ root, head }) => {
    const payload = ciPayload({ run: { head_sha: head, run_attempt: 2 } })
    payload.runs.workflow_runs.push({
      ...payload.runs.workflow_runs[0],
      id: 101, run_number: 13, run_attempt: 1, status, conclusion,
    })
    const calls = []
    const result = await runGuardedOperation({
      root, task: '451', environment: 'github-actions-evidence', operation: 'ci-evidence',
      head, execute: ciExecutor(payload, calls),
    })
    assert.equal(result.state, 'blocked')
    assert.equal(result.code, code)
    assert.equal(calls.length, 2)
  }))
}

for (const [label, prepare, code] of [
  ['missing run', payload => { payload.runs.workflow_runs = [] }, 'CI_RUN_MISSING'],
  ['queued run', payload => {
    payload.runs.workflow_runs[0].status = 'queued'
    payload.runs.workflow_runs[0].conclusion = null
  }, 'CI_RUN_IN_PROGRESS'],
  ['running required job', payload => {
    payload.jobs.jobs[0].status = 'in_progress'
    payload.jobs.jobs[0].conclusion = null
  }, 'CI_REQUIRED_JOB_IN_PROGRESS'],
]) {
  test(`${label} does not consume failure budget or prevent later successful evidence`, () => checkout(async ({ root, head }) => {
    const payload = ciPayload({ run: { head_sha: head } })
    const original = structuredClone(payload)
    prepare(payload)
    const invoke = () => runGuardedOperation({
      root, task: '451', environment: 'github-actions-evidence', operation: 'ci-evidence',
      head, execute: ciExecutor(payload),
    })
    for (let count = 0; count < 3; count++) {
      const pending = await invoke()
      assert.equal(pending.state, 'blocked')
      assert.equal(pending.code, code)
      assert.equal(pending.evidenceState, 'not-ready')
      assert.equal(pending.failedAttempts, 0)
      assert.equal(pending.remainingFailures, 2)
    }
    Object.assign(payload, original)
    const completed = await invoke()
    assert.equal(completed.state, 'passed')
    assert.equal(completed.failedAttempts, 0)
  }))
}

test('rejected CI conclusions stay blocked without consuming execution failure budget', () => checkout(async ({ root, head }) => {
  const payload = ciPayload({ run: { head_sha: head, conclusion: 'failure' } })
  const invoke = () => runGuardedOperation({
    root, task: '451', environment: 'github-actions-evidence', operation: 'ci-evidence',
    head, execute: ciExecutor(payload),
  })
  for (let count = 0; count < 3; count++) {
    const result = await invoke()
    assert.equal(result.code, 'CI_RUN_FAILED')
    assert.equal(result.evidenceState, 'rejected')
    assert.equal(result.ok, false)
    assert.equal(result.failedAttempts, 0)
  }
  payload.runs.workflow_runs[0].conclusion = 'success'
  assert.equal((await invoke()).state, 'passed')
}))

test('attempt ordering applies only within the same CI run', () => checkout(async ({ root, head }) => {
  const payload = ciPayload({ run: { head_sha: head, run_attempt: 1 } })
  payload.runs.workflow_runs.push({
    ...payload.runs.workflow_runs[0], run_attempt: 2, conclusion: 'failure',
  })
  const result = await runGuardedOperation({
    root, task: '451', environment: 'github-actions-evidence', operation: 'ci-evidence',
    head, execute: ciExecutor(payload),
  })
  assert.equal(result.code, 'CI_RUN_FAILED')
  assert.equal(result.ok, false)
}))

test('pending and successful evidence reads do not reset an earlier API failure', () => checkout(async ({ root, head }) => {
  const payload = ciPayload({ run: { head_sha: head } })
  let unavailable = true
  const nativeExecute = ciExecutor(payload)
  const execute = (command, args, options) => command === 'gh' && unavailable
    ? { status: 1, stdout: '', stderr: '' } : nativeExecute(command, args, options)
  const invoke = () => runGuardedOperation({
    root, task: '451', environment: 'github-actions-evidence', operation: 'ci-evidence',
    head, execute,
  })
  assert.equal((await invoke()).failedAttempts, 1)
  unavailable = false
  payload.runs.workflow_runs[0].status = 'in_progress'
  const pending = await invoke()
  assert.equal(pending.evidenceState, 'not-ready')
  assert.equal(pending.failedAttempts, 1)
  payload.runs.workflow_runs[0].status = 'completed'
  const passed = await invoke()
  assert.equal(passed.ok, true)
  assert.equal(passed.failedAttempts, 1)
  unavailable = true
  assert.equal((await invoke()).failedAttempts, 2)
  const blocked = await invoke()
  assert.equal(blocked.code, 'GUARD_FAILURE_BUDGET_EXHAUSTED')
  assert.equal(blocked.executed, false)
}))
