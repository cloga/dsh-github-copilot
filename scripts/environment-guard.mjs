import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { open, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const policyPath = resolve(scriptRoot, 'agent-execution-policy.json')
const taskId = value => typeof value === 'string' && value.length <= 64
  && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
const commitId = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value)
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const requiredJobs = [
  'verify (ubuntu-latest)',
  'verify (windows-latest)',
  'Published adapter (ubuntu-latest)',
  'Published adapter (windows-latest)',
  'release-ready',
]
const scriptsTestArgv = [
  'node', '--test', 'tests/scripts/agent.test.mjs', 'tests/scripts/acceptance.test.mjs',
  'tests/scripts/environment-guardrails.test.mjs',
]

class GuardError extends Error {
  constructor(code, details = {}) {
    super(code)
    this.code = code
    this.details = details
  }
}

class CiEvidenceError extends GuardError {
  constructor(code, details = {}, evidenceState = 'rejected') {
    super(code, { ...details, evidenceState })
  }
}

function validPolicy(policy) {
  return isRecord(policy) && policy.schemaVersion === 1
    && policy.repository === 'cloga/dsh-github-copilot' && policy.ownerTask === 'tooling'
    && policy.maxTaskScopes === 128
    && JSON.stringify(policy.environments?.['local-auxiliary']?.operations) === JSON.stringify(['scripts-test'])
    && JSON.stringify(policy.environments?.['github-actions-evidence']?.operations) === JSON.stringify(['ci-evidence'])
    && policy.operations?.['dependency-install']?.kind === 'network'
    && policy.operations['dependency-install'].maxFailures === 0
    && policy.operations?.['scripts-test']?.kind === 'local-command'
    && policy.operations['scripts-test'].environment === 'local-auxiliary'
    && policy.operations['scripts-test'].maxFailures === 2
    && JSON.stringify(policy.operations['scripts-test'].argv) === JSON.stringify(scriptsTestArgv)
    && policy.operations?.['ci-evidence']?.kind === 'github-actions-read'
    && policy.operations['ci-evidence'].environment === 'github-actions-evidence'
    && policy.operations['ci-evidence'].maxFailures === 2
    && policy.operations['ci-evidence'].maxApiCalls === 3
    && policy.operations['ci-evidence'].requestTimeoutMs === 15000
    && policy.operations['ci-evidence'].workflowPath === '.github/workflows/ci.yml'
    && policy.operations['ci-evidence'].workflowName === 'CI'
    && JSON.stringify(policy.operations['ci-evidence'].requiredJobs) === JSON.stringify(requiredJobs)
    && JSON.stringify(policy.operations['ci-evidence'].optionalJobs) === JSON.stringify([
      { name: 'release', allowedConclusions: ['success', 'skipped'] },
    ])
}

function executeGit(root, args, execute) {
  const result = execute('git', ['-C', root, ...args], {
    encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024, windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  })
  if (result.error || result.status !== 0) throw new GuardError('GUARD_GIT_UNAVAILABLE')
  return result.stdout.trim()
}

async function readPolicy() {
  let policy
  try { policy = JSON.parse(await readFile(policyPath, 'utf8')) }
  catch { throw new GuardError('GUARD_POLICY_UNAVAILABLE') }
  if (!validPolicy(policy)) throw new GuardError('GUARD_POLICY_INVALID')
  return policy
}

async function budgetPath(root, execute) {
  const path = executeGit(root, ['rev-parse', '--git-path', 'copilot-agent-guard-state.json'], execute)
  return isAbsolute(path) ? path : resolve(root, path)
}

async function readBudget(path) {
  try {
    const state = JSON.parse(await readFile(path, 'utf8'))
    if (!isRecord(state) || state.schemaVersion !== 1 || !isRecord(state.failures)
      || Object.keys(state.failures).length > 128
      || Object.values(state.failures).some(value => !Number.isSafeInteger(value) || value < 0)) {
      throw new GuardError('GUARD_BUDGET_STATE_INVALID')
    }
    return state
  } catch (error) {
    if (error instanceof GuardError) throw error
    if (error.code === 'ENOENT') return { schemaVersion: 1, failures: {} }
    throw new GuardError('GUARD_BUDGET_STATE_INVALID')
  }
}

async function writeBudget(path, state) {
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, JSON.stringify(state), { flag: 'wx' })
    await rename(temporary, path)
  } catch {
    throw new GuardError('GUARD_BUDGET_STATE_UNAVAILABLE')
  }
}

function githubRepository(remote) {
  if (typeof remote !== 'string') return null
  const match = remote.match(/^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/]+\/[^/]+?)(?:\.git)?$/)
  return match?.[1] ?? null
}

function ghJson(endpoint, execute, limits) {
  limits.calls++
  if (limits.calls > limits.maxApiCalls) throw new GuardError('CI_API_CALL_LIMIT')
  const result = execute('gh', ['api', endpoint], {
    encoding: 'utf8', timeout: limits.requestTimeoutMs, maxBuffer: 4 * 1024 * 1024, windowsHide: true,
    env: { ...process.env, GH_PROMPT_DISABLED: '1', GH_PAGER: 'cat', GH_NO_UPDATE_NOTIFIER: '1' },
  })
  if (result.error || result.status !== 0) throw new GuardError('CI_GITHUB_READ_UNAVAILABLE')
  try { return JSON.parse(result.stdout) }
  catch { throw new GuardError('CI_GITHUB_RESPONSE_INVALID') }
}

function failedConclusion(conclusion, prefix) {
  const status = typeof conclusion === 'string' ? conclusion.toLowerCase() : 'unknown'
  const suffix = {
    failure: 'FAILED',
    cancelled: 'CANCELLED',
    timed_out: 'TIMED_OUT',
    skipped: 'SKIPPED',
    neutral: 'NEUTRAL',
    action_required: 'ACTION_REQUIRED',
  }[status] ?? 'NOT_SUCCESSFUL'
  return `${prefix}_${suffix}`
}

function requireSuccessfulJob(job, name) {
  if (!job) throw new CiEvidenceError('CI_REQUIRED_JOB_MISSING', { job: name }, 'not-ready')
  if (job.status !== 'completed') {
    throw new CiEvidenceError('CI_REQUIRED_JOB_IN_PROGRESS', { job: name }, 'not-ready')
  }
  if (job.conclusion !== 'success') {
    throw new CiEvidenceError(failedConclusion(job.conclusion, 'CI_REQUIRED_JOB'), { job: name })
  }
}

function findUniqueJob(jobs, name) {
  const matches = jobs.filter(job => job.name === name)
  if (matches.length > 1) throw new CiEvidenceError('CI_REQUIRED_JOB_DUPLICATE', { job: name })
  return matches[0]
}

function compareRuns(a, b) {
  if (a.id === b.id) return b.run_attempt - a.run_attempt
  return b.run_number - a.run_number || b.id - a.id
}

function verifyCi({ root, head, policy, execute }) {
  if (!commitId(head)) throw new CiEvidenceError('CI_HEAD_INVALID')
  const actualHead = executeGit(root, ['rev-parse', '--verify', 'HEAD'], execute)
  if (actualHead !== head) throw new CiEvidenceError('CI_HEAD_MISMATCH')
  if (executeGit(root, ['status', '--porcelain=v1', '--untracked-files=all'], execute) !== '') {
    throw new CiEvidenceError('CI_WORKTREE_DIRTY')
  }
  const repository = githubRepository(executeGit(root, ['config', '--get', 'remote.origin.url'], execute))
  if (repository !== policy.repository) throw new CiEvidenceError('CI_REPOSITORY_MISMATCH')

  const limits = { calls: 0, ...policy.operations['ci-evidence'] }
  const workflow = ghJson(`/repos/${repository}/actions/workflows/ci.yml`, execute, limits)
  if (!isRecord(workflow) || String(workflow.path ?? '').replaceAll('\\', '/') !== '.github/workflows/ci.yml'
    || workflow.name !== 'CI' || !Number.isSafeInteger(workflow.id) || workflow.state !== 'active') {
    throw new CiEvidenceError('CI_WORKFLOW_MISMATCH')
  }
  const runsResponse = ghJson(`/repos/${repository}/actions/runs?head_sha=${head}&per_page=100`, execute, limits)
  if (!isRecord(runsResponse) || !Array.isArray(runsResponse.workflow_runs)) {
    throw new GuardError('CI_GITHUB_RESPONSE_INVALID')
  }
  const exactHead = runsResponse.workflow_runs.filter(run => isRecord(run) && run.head_sha === head)
  const runs = exactHead.filter(run => String(run.workflow_id) === String(workflow.id))
  if (runs.length === 0) {
    throw new CiEvidenceError(exactHead.length ? 'CI_WORKFLOW_MISMATCH' : 'CI_RUN_MISSING',
      {}, exactHead.length ? 'rejected' : 'not-ready')
  }
  if (runs.some(run => !['id', 'run_number', 'run_attempt'].every(
    key => Number.isSafeInteger(run[key]) && run[key] > 0))) {
    throw new GuardError('CI_GITHUB_RESPONSE_INVALID')
  }
  runs.sort(compareRuns)
  const run = runs[0]
  if (run.status !== 'completed') throw new CiEvidenceError('CI_RUN_IN_PROGRESS', {}, 'not-ready')
  if (run.conclusion !== 'success') throw new CiEvidenceError(failedConclusion(run.conclusion, 'CI_RUN'))

  const jobsResponse = ghJson(
    `/repos/${repository}/actions/runs/${run.id}/jobs?filter=latest&per_page=100`, execute, limits)
  if (!isRecord(jobsResponse) || !Array.isArray(jobsResponse.jobs)) {
    throw new GuardError('CI_GITHUB_RESPONSE_INVALID')
  }
  const jobs = jobsResponse.jobs.filter(isRecord)
  for (const name of policy.operations['ci-evidence'].requiredJobs) {
    requireSuccessfulJob(findUniqueJob(jobs, name), name)
  }
  const release = findUniqueJob(jobs, 'release')
  if (release && (release.status !== 'completed'
    || !policy.operations['ci-evidence'].optionalJobs[0].allowedConclusions.includes(release.conclusion))) {
    throw new CiEvidenceError(release.status !== 'completed'
      ? 'CI_RELEASE_JOB_IN_PROGRESS' : failedConclusion(release.conclusion, 'CI_RELEASE_JOB'),
    {}, release.status !== 'completed' ? 'not-ready' : 'rejected')
  }
  return {
    repository,
    head,
    runId: run.id,
    runUrl: typeof run.html_url === 'string' ? run.html_url : null,
    workflow: { id: workflow.id, name: workflow.name, path: workflow.path },
    event: typeof run.event === 'string' ? run.event : null,
    jobs: [
      ...requiredJobs.map(name => ({ name, status: 'completed', conclusion: 'success' })),
      ...(release ? [{ name: release.name, status: release.status, conclusion: release.conclusion }] : []),
    ],
    verification: 'github-actions-results-only',
  }
}

function output(state, task, environment, operation, code, executed, details = {}) {
  return {
    schemaVersion: 1, kind: 'guarded-operation-result', state, ok: state === 'passed',
    code, task, environment, operation, executed, ...details,
  }
}

export async function runGuardedOperation({
  task, environment, operation, head, root = scriptRoot, execute = spawnSync,
}) {
  if (!taskId(task)) throw new GuardError('GUARD_TASK_REQUIRED')
  if (!['local-auxiliary', 'github-actions-evidence'].includes(environment)) {
    throw new GuardError('GUARD_ENVIRONMENT_REQUIRED')
  }
  if (typeof operation !== 'string') throw new GuardError('GUARD_OPERATION_REQUIRED')
  const policy = await readPolicy()
  const spec = policy.operations[operation]
  if (!spec) throw new GuardError('GUARD_OPERATION_UNKNOWN')
  if (operation === 'dependency-install') {
    return output('blocked', task, environment, operation, environment === 'local-auxiliary'
      ? 'GUARD_LOCAL_NETWORK_BLOCKED' : 'GUARD_CI_IS_EXTERNAL_ONLY', false)
  }
  if (spec.environment !== environment || !policy.environments[environment].operations.includes(operation)) {
    return output('blocked', task, environment, operation, 'GUARD_ENVIRONMENT_OPERATION_MISMATCH', false)
  }
  const path = await budgetPath(root, execute)
  const lockPath = `${path}.lock`
  let lock
  try { lock = await open(lockPath, 'wx') }
  catch (error) {
    if (error.code === 'EEXIST') {
      return output('blocked', task, environment, operation, 'GUARD_BUDGET_BUSY', false)
    }
    throw new GuardError('GUARD_BUDGET_STATE_UNAVAILABLE')
  }
  try {
    const state = await readBudget(path)
    const key = `${task}:${operation}`
    const failures = state.failures[key] ?? 0
    if (failures === 0 && Object.keys(state.failures).length >= policy.maxTaskScopes) {
      return output('blocked', task, environment, operation, 'GUARD_BUDGET_SCOPE_LIMIT', false, {
        maxTaskScopes: policy.maxTaskScopes,
      })
    }
    if (failures >= spec.maxFailures) {
      return output('blocked', task, environment, operation, 'GUARD_FAILURE_BUDGET_EXHAUSTED', false, {
        failedAttempts: failures, maxFailures: spec.maxFailures,
      })
    }
    try {
      if (operation === 'scripts-test') {
        const [command, ...args] = spec.argv
        const child = execute(command === 'node' ? process.execPath : command, args, {
          cwd: root, encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024, windowsHide: true,
          stdio: 'inherit',
        })
        if (child.error || child.status !== 0) {
          const next = failures + 1
          state.failures[key] = next
          await writeBudget(path, state)
          return output('failed', task, environment, operation, 'GUARD_LOCAL_CHECK_FAILED', true, {
            exitCode: Number.isInteger(child.status) ? child.status : null,
            failedAttempts: next, maxFailures: spec.maxFailures, remainingFailures: spec.maxFailures - next,
          })
        }
        return output('passed', task, environment, operation, 'GUARD_LOCAL_CHECK_PASSED', true, {
          failedAttempts: failures, maxFailures: spec.maxFailures, remainingFailures: spec.maxFailures - failures,
        })
      }
      const evidence = verifyCi({ root, head, policy, execute })
      return output('passed', task, environment, operation, 'CI_EVIDENCE_VERIFIED', true, {
        failedAttempts: failures, maxFailures: spec.maxFailures, remainingFailures: spec.maxFailures - failures,
        evidence,
      })
    } catch (error) {
      if (error instanceof CiEvidenceError) {
        return output('blocked', task, environment, operation, error.code, true, {
          failedAttempts: failures, maxFailures: spec.maxFailures,
          remainingFailures: spec.maxFailures - failures, ...error.details,
        })
      }
      const next = failures + 1
      state.failures[key] = next
      await writeBudget(path, state)
      return output('blocked', task, environment, operation,
        error instanceof GuardError ? error.code : 'GUARD_OPERATION_UNAVAILABLE', true, {
          failedAttempts: next, maxFailures: spec.maxFailures, remainingFailures: spec.maxFailures - next,
          ...(error instanceof GuardError ? error.details : {}),
        })
    }
  } finally {
    try {
      await lock.close()
      await unlink(lockPath)
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw new GuardError('GUARD_BUDGET_LOCK_RELEASE_FAILED', { executed: null })
      }
    }
  }
}

export async function guardMain(args) {
  const options = {}
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]
    const value = args[index + 1]
    if (!['--task', '--environment', '--operation', '--head'].includes(key)
      || Object.hasOwn(options, key) || typeof value !== 'string' || value.startsWith('--')) {
      throw new GuardError('GUARD_ARGUMENTS')
    }
    options[key] = value
  }
  if (!options['--task'] || !options['--environment'] || !options['--operation']) {
    throw new GuardError('GUARD_ARGUMENTS')
  }
  const value = await runGuardedOperation({
    task: options['--task'], environment: options['--environment'],
    operation: options['--operation'], head: options['--head'],
  })
  console.log(JSON.stringify(value))
  return value.ok ? 0 : 1
}

export function guardErrorResult(error) {
  return {
    schemaVersion: 1, kind: 'guarded-operation-result', state: 'blocked', ok: false,
    code: error instanceof GuardError ? error.code : 'GUARD_OPERATION_UNAVAILABLE',
    executed: error instanceof GuardError ? error.details.executed ?? false : false,
    ...(error instanceof GuardError ? error.details : {}),
  }
}
