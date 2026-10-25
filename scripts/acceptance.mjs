import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, realpath } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import executionPolicy from '../agent-execution-policy.json' with { type: 'json' }

const statuses = ['passed', 'failed', 'blocked', 'not-run']
const methods = ['static', 'unit', 'integration', 'browser', 'review', 'manual']
const digest = value => createHash('sha256').update(value).digest('hex')
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const text = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 2000
const id = value => typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value)

class AcceptanceError extends Error {}
const require = (condition, code = 'ACCEPTANCE_INVALID') => {
  if (!condition) throw new AcceptanceError(code)
}
const keys = (value, expected) => require(value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key)))
const list = (value, min, max) => require(Array.isArray(value) && value.length >= min && value.length <= max)

function safePath(value) {
  if (typeof value !== 'string' || value.length > 240) return false
  return value.split('/').every(part => /^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(part)
    && !part.endsWith('.') && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part))
}

function validateDocuments(contract, report) {
  const liveRequired = contract.schemaVersion === 2
  keys(contract, ['schemaVersion', 'issue', 'task', 'objective', 'nonGoals', 'requirements',
    ...liveRequired ? ['liveUi'] : []])
  require([1, 2].includes(contract.schemaVersion) && Number.isSafeInteger(contract.issue) && contract.issue > 0
    && id(contract.task) && text(contract.objective))
  list(contract.nonGoals, 1, 16)
  require(contract.nonGoals.every(text))
  list(contract.requirements, 1, 64)
  const required = new Set()
  for (const row of contract.requirements) {
    keys(row, ['id', 'expected', 'method'])
    require(id(row.id) && !required.has(row.id) && text(row.expected) && methods.includes(row.method))
    require(liveRequired || !['browser', 'manual'].includes(row.method), 'ACCEPTANCE_LIVE_CONTRACT_REQUIRED')
    required.add(row.id)
  }
  keys(report, ['schemaVersion', 'commit', 'contractSha256', 'producer', 'environment', 'checks',
    ...liveRequired ? ['liveUi'] : []])
  require(report.schemaVersion === contract.schemaVersion && typeof report.commit === 'string' && /^[a-f0-9]{40}$/.test(report.commit)
    && hash(report.contractSha256) && ['implementation', 'independent-review', 'human', 'ci'].includes(report.producer))
  keys(report.environment, ['node', 'platform', 'core'])
  require(typeof report.environment.node === 'string' && /^\d+\.\d+\.\d+$/.test(report.environment.node)
    && ['win32', 'linux', 'darwin'].includes(report.environment.platform)
    && typeof report.environment.core === 'string'
    && /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(report.environment.core))
  list(report.checks, required.size, required.size)
  const seen = new Set()
  const artifacts = new Map()
  for (const check of report.checks) {
    keys(check, ['id', 'status', 'notes', 'evidence'])
    require(required.has(check.id) && !seen.has(check.id) && statuses.includes(check.status) && text(check.notes))
    if (liveRequired) require(['observed', 'not-run', 'blocked', 'failed'].includes(check.notes)
      && check.evidence.length === 0)
    seen.add(check.id)
    list(check.evidence, check.status === 'passed' && !liveRequired ? 1 : 0, 8)
    const paths = new Set()
    for (const evidence of check.evidence) {
      keys(evidence, ['path', 'sha256'])
      require(safePath(evidence.path) && hash(evidence.sha256) && !paths.has(evidence.path))
      paths.add(evidence.path)
      require(!artifacts.has(evidence.path) || artifacts.get(evidence.path) === evidence.sha256)
      artifacts.set(evidence.path, evidence.sha256)
    }
  }
  require(artifacts.size <= 64)
  return artifacts
}

const panels = ['models-manage', 'plugin-details', 'about']
const version = value => value === null || (typeof value === 'string'
  && /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(value) && value.length <= 100)
const timestamp = value => Number.isSafeInteger(value) && value > 0

function validateAppLifecycle(value, now) {
  keys(value, ['discovery', 'launch', 'welcome', 'rediscovery', 'final', 'interaction'])
  keys(value.discovery, ['state', 'atMs', 'source'])
  require(['running', 'not-running', 'unknown'].includes(value.discovery.state)
    && timestamp(value.discovery.atMs) && value.discovery.source === 'list-apps')
  keys(value.launch, ['state', 'atMs'])
  require(['not-needed', 'authorized-start-app', 'not-authorized'].includes(value.launch.state)
    && (value.launch.state === 'authorized-start-app'
      ? timestamp(value.launch.atMs) && value.launch.atMs > value.discovery.atMs
        && value.discovery.state === 'not-running'
      : value.launch.atMs === null))
  keys(value.welcome, ['state', 'atMs'])
  require(['not-seen', 'safe-skip-observed', 'safe-skip-used', 'auth-required', 'unknown'].includes(value.welcome.state)
    && (value.welcome.state === 'not-seen' ? value.welcome.atMs === null : timestamp(value.welcome.atMs)
      && value.welcome.atMs >= (value.launch.atMs ?? value.discovery.atMs)))
  keys(value.rediscovery, ['atMs', 'source', 'window'])
  require(['same', 'replacement', 'unobserved'].includes(value.rediscovery.window)
    && value.rediscovery.source === 'list-apps'
    && (value.rediscovery.atMs === null || timestamp(value.rediscovery.atMs)
      && value.rediscovery.atMs > (value.welcome.atMs ?? value.launch.atMs ?? value.discovery.atMs)))
  keys(value.final, ['atMs', 'source', 'appState', 'surface'])
  require((value.final.atMs === null || timestamp(value.final.atMs))
    && value.final.source === 'list-apps-and-get-window-state'
    && ['running', 'not-running', 'unknown'].includes(value.final.appState)
    && ['target-panel', 'workspace', 'welcome', 'unobserved'].includes(value.final.surface)
    && ['clear', 'interrupted'].includes(value.interaction))
  if (value.interaction === 'interrupted') return 'LIVE_UI_INPUT_INTERRUPTED'
  if (value.discovery.state !== 'running' && value.launch.state !== 'authorized-start-app') {
    return 'LIVE_UI_LAUNCH_BLOCKED'
  }
  if (value.welcome.state === 'auth-required') return 'LIVE_UI_AUTH_REQUIRED'
  if (['safe-skip-observed', 'unknown'].includes(value.welcome.state)) return 'LIVE_UI_WELCOME_UNRESOLVED'
  if (value.rediscovery.atMs === null || value.rediscovery.window === 'unobserved') return 'LIVE_UI_WINDOW_UNCONFIRMED'
  if (value.final.atMs === null || value.final.atMs <= value.rediscovery.atMs
    || value.final.atMs > now || now - value.final.atMs > 120000
    || value.final.appState !== 'running' || !['target-panel', 'workspace'].includes(value.final.surface)) {
    return 'LIVE_UI_CURRENT_APP_UNCONFIRMED'
  }
  return null
}

export function validateLiveUi(contract, report, now = Date.now()) {
  keys(contract, ['expectedPluginVersion', 'panel', 'checks'])
  require(version(contract.expectedPluginVersion) && contract.expectedPluginVersion !== null
    && panels.includes(contract.panel))
  list(contract.checks, 1, 16)
  const required = new Map()
  for (const row of contract.checks) {
    keys(row, ['id', 'action', 'outcome'])
    require(id(row.id) && !required.has(row.id) && ['ready', 'actionable-failure'].includes(row.outcome)
      && ['observe-panel', 'reopen-manage', 'refresh-models'].includes(row.action))
    required.set(row.id, row)
  }
  keys(report, ['appState', 'desktop', 'installed', 'loaded', 'upgradeSource',
    'navigation', 'handoff', 'permission', 'steps', 'lifecycle'])
  const lifecycleCode = validateAppLifecycle(report.lifecycle, now)
  require(['running', 'not-running', 'unknown'].includes(report.appState))
  for (const [field, sources] of [
    ['desktop', ['about', 'unknown']],
    ['installed', ['disk-manifest', 'unknown']],
    ['loaded', ['public-runtime-status', 'runtime-ui', 'unknown']],
  ]) {
    keys(report[field], ['version', 'source', 'observedAtMs'])
    require(version(report[field].version) && sources.includes(report[field].source)
      && (report[field].source === 'unknown') === (report[field].version === null)
      && (report[field].version === null ? report[field].observedAtMs === null : timestamp(report[field].observedAtMs)))
  }
  const source = report.upgradeSource
  keys(source, ['kind', 'version', 'url', 'sha256', 'releaseSha256', 'fallbackReason', 'observedAtMs'])
  require(['github-release-url', 'verified-github-cache', 'local-build', 'source-directory',
    'link-worktree', 'unknown'].includes(source.kind) && version(source.version)
    && (source.url === null || source.url === `https://github.com/${executionPolicy.repository}/releases/download/v${source.version}/dsh-github-copilot-${source.version}.tgz`)
    && (source.sha256 === null || hash(source.sha256))
    && (source.releaseSha256 === null || hash(source.releaseSha256))
    && ['none', 'native-url-unavailable', 'native-url-rejected'].includes(source.fallbackReason)
    && (source.observedAtMs === null || timestamp(source.observedAtMs)))
  keys(report.permission, ['state', 'action'])
  require(['safe-read-only', 'approval-required', 'user-absent'].includes(report.permission.state)
    && ['none', 'restart', 'install', 'account-switch', 'oauth', 'paid-call'].includes(report.permission.action))
  keys(report.handoff, ['state', 'panel'])
  require(['none', 'requested', 'user-absent'].includes(report.handoff.state)
    && report.handoff.panel === contract.panel)
  list(report.navigation, 0, 2)
  const methods = new Set()
  for (const attempt of report.navigation) {
    keys(attempt, ['method', 'outcome', 'atMs', 'observedAtMs', 'observationSource'])
    require(['accessible-control', 'supported-shortcut', 'user-opened-panel'].includes(attempt.method)
      && !methods.has(attempt.method) && ['opened', 'unchanged', 'no-candidate'].includes(attempt.outcome)
      && timestamp(attempt.atMs) && timestamp(attempt.observedAtMs)
      && attempt.observedAtMs > attempt.atMs && attempt.observedAtMs - attempt.atMs <= 120000
      && attempt.observationSource === 'get-window-state')
    require(!report.navigation.slice(0, methods.size).some(row => row.outcome === 'opened'))
    require(report.navigation.slice(0, methods.size).every(row => row.observedAtMs <= attempt.atMs))
    methods.add(attempt.method)
  }
  list(report.steps, 0, 32)
  const observed = new Map()
  let lastEnd = 0
  for (const step of report.steps) {
    keys(step, ['checkId', 'action', 'observation', 'startedAtMs', 'finishedAtMs',
      'observedAtMs', 'observationSource'])
    require(required.has(step.checkId) && !observed.has(step.checkId)
      && ['observe-panel', 'reopen-manage', 'refresh-models'].includes(step.action)
      && ['ready', 'actionable-failure', 'error', 'timeout', 'unchanged'].includes(step.observation)
      && timestamp(step.startedAtMs) && timestamp(step.finishedAtMs)
      && step.startedAtMs >= lastEnd && step.finishedAtMs >= step.startedAtMs
      && timestamp(step.observedAtMs) && step.observedAtMs > step.finishedAtMs
      && step.observedAtMs - step.startedAtMs <= 120000
      && step.observationSource === 'get-window-state')
    lastEnd = step.observedAtMs
    observed.set(step.checkId, step)
  }
  const opened = report.navigation.at(-1)?.outcome === 'opened'
  require(!opened || report.steps.every(step => step.startedAtMs >= report.navigation.at(-1).observedAtMs))
  const qualifiedObservation = opened && report.steps.length > 0
  const result = code => ({ code, ok: code === 'LIVE_UI_REPORTED_COMPLETE', qualifiedObservation,
    upgradeSourceKind: source.kind, provenanceVerified: false,
    currentAppObservedAtMs: report.lifecycle.final.atMs,
    nextAction: ({
      LIVE_UI_LAUNCH_BLOCKED: 'stop-for-explicit-launch-permission',
      LIVE_UI_AUTH_REQUIRED: 'stop-at-authentication-boundary',
      LIVE_UI_WELCOME_UNRESOLVED: 'inspect-official-safe-skip',
      LIVE_UI_WINDOW_UNCONFIRMED: 'rediscover-app-window',
      LIVE_UI_CURRENT_APP_UNCONFIRMED: 'fresh-discovery-and-observation',
      LIVE_UI_INPUT_INTERRUPTED: 'reread-ui-before-same-action-retry',
    })[code] ?? (code === 'LIVE_UI_AUTOMATION_BLOCKED'
      ? report.handoff.state === 'none' ? 'request-specified-panel-once' : 'wait-for-user-panel'
      : code === 'LIVE_UI_NOT_RUN'
        ? report.navigation.length === 0 ? 'inspect-running-app' : 'try-one-supported-alternate'
        : code === 'LIVE_UI_PERMISSION_BLOCKED' ? 'stop-for-explicit-permission'
          : code === 'LIVE_UI_APP_UNAVAILABLE' ? 'report-app-unavailable'
            : code === 'LIVE_UI_HANDOFF_PENDING' ? 'wait-for-user-panel'
              : code === 'LIVE_UI_LOADED_VERSION_UNCONFIRMED' ? 'read-public-loaded-version'
                : code === 'LIVE_UI_VERSION_PREREQUISITE_UNMET' ? 'request-exact-upgrade-permission'
                  : code === 'LIVE_UI_UPGRADE_SOURCE_REJECTED' ? 'select-exact-github-release-url'
                : code === 'LIVE_UI_INCOMPLETE' ? 'perform-remaining-authorized-checks' : 'report-result'),
    versionFixReportedConsistent: code === 'LIVE_UI_REPORTED_COMPLETE', executionVerified: false,
    environmentVerified: false, source: 'report-consistency-only' })
  if (report.permission.state !== 'safe-read-only' || report.permission.action !== 'none') {
    return result('LIVE_UI_PERMISSION_BLOCKED')
  }
  if (lifecycleCode) return result(lifecycleCode)
  if (report.navigation.some(row => row.atMs < report.lifecycle.rediscovery.atMs)
    || report.lifecycle.final.atMs < lastEnd
    || (lastEnd > 0 && report.lifecycle.final.atMs - lastEnd > 120000)
    || report.navigation.some(row => row.observedAtMs > report.lifecycle.final.atMs)) {
    return result('LIVE_UI_CURRENT_APP_UNCONFIRMED')
  }
  if (report.appState !== 'running') return result('LIVE_UI_APP_UNAVAILABLE')
  if (!opened) return result(report.navigation.length === 2
    ? 'LIVE_UI_AUTOMATION_BLOCKED' : 'LIVE_UI_NOT_RUN')
  if (report.handoff.state !== 'none') return result('LIVE_UI_HANDOFF_PENDING')
  if ([...observed.values()].some(value => ['error', 'timeout', 'unchanged'].includes(value.observation))) {
    return result('LIVE_UI_OBSERVATION_FAILED')
  }
  if ([...required].some(([key, expected]) => observed.get(key)?.observation !== expected.outcome
    || observed.get(key)?.action !== expected.action)) return result('LIVE_UI_INCOMPLETE')
  if (report.loaded.version === null) return result('LIVE_UI_LOADED_VERSION_UNCONFIRMED')
  if (report.loaded.version !== contract.expectedPluginVersion) return result('LIVE_UI_VERSION_PREREQUISITE_UNMET')
  if (!['github-release-url', 'verified-github-cache'].includes(source.kind)
    || source.version !== contract.expectedPluginVersion || source.url === null
    || source.sha256 === null || source.sha256 !== source.releaseSha256 || source.observedAtMs === null
    || (source.kind === 'github-release-url' ? source.fallbackReason !== 'none' : source.fallbackReason === 'none')) {
    return result('LIVE_UI_UPGRADE_SOURCE_REJECTED')
  }
  return result('LIVE_UI_REPORTED_COMPLETE')
}

async function readBounded(path, limit) {
  let handle
  try {
    const before = await lstat(path)
    require(before.isFile() && !before.isSymbolicLink() && before.nlink === 1, 'ACCEPTANCE_UNSAFE_FILE')
    require(before.size <= limit, 'ACCEPTANCE_FILE_LIMIT')
    handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    const info = await handle.stat()
    require(info.isFile() && info.nlink === 1 && info.ino === before.ino && info.dev === before.dev,
      'ACCEPTANCE_UNSAFE_FILE')
    const bytes = Buffer.alloc(limit + 1)
    let length = 0
    while (length < bytes.length) {
      const { bytesRead } = await handle.read(bytes, length, bytes.length - length, length)
      if (bytesRead === 0) break
      length += bytesRead
    }
    require(length <= limit, 'ACCEPTANCE_FILE_LIMIT')
    const after = await handle.stat()
    require(length === info.size && info.size === after.size && info.mtimeMs === after.mtimeMs
      && info.ctimeMs === after.ctimeMs, 'ACCEPTANCE_FILE_CHANGED')
    return bytes.subarray(0, length)
  } catch (error) {
    if (error instanceof AcceptanceError) throw error
    throw new AcceptanceError('ACCEPTANCE_FILE_UNAVAILABLE')
  } finally { await handle?.close() }
}

function json(bytes) {
  try {
    const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    const value = JSON.parse(source)
    // JSON.parse validates syntax but silently overwrites duplicate members.
    const stack = []
    for (const [token] of source.matchAll(/"(?:\\[\s\S]|[^"\\])*"|[{}[\],:]/g)) {
      const frame = stack.at(-1)
      if (token === '{' || token === '[') {
        require(stack.length < 32)
        stack.push({ object: token === '{', keys: new Set(), key: true })
      } else if (token === '}' || token === ']') stack.pop()
      else if (token === ',' && frame?.object) frame.key = true
      else if (token.startsWith('"') && frame?.object && frame.key) {
        const name = JSON.parse(token)
        require(!frame.keys.has(name))
        frame.keys.add(name)
        frame.key = false
      }
    }
    return value
  }
  catch { throw new AcceptanceError('ACCEPTANCE_INVALID') }
}

function cleanHead(root) {
  const git = args => {
    const result = spawnSync('git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', ...args], {
      cwd: root, encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      windowsHide: true,
    })
    require(result.status === 0, 'ACCEPTANCE_GIT_UNAVAILABLE')
    return result.stdout.trim()
  }
  const commit = git(['rev-parse', '--verify', 'HEAD'])
  require(/^[a-f0-9]{40}$/.test(commit), 'ACCEPTANCE_GIT_UNAVAILABLE')
  require(git(['status', '--porcelain=v1', '--untracked-files=all', '--ignore-submodules=none']) === '',
    'ACCEPTANCE_DIRTY_CHECKOUT')
  return commit
}

async function artifactPath(root, path) {
  let current = root
  try {
    const parts = path.split('/')
    for (let index = 0; index < parts.length; index++) {
      current = join(current, parts[index])
      const info = await lstat(current)
      require(!info.isSymbolicLink() && (index === parts.length - 1 ? info.isFile() : info.isDirectory()),
        'ACCEPTANCE_UNSAFE_FILE')
    }
    return current
  } catch (error) {
    if (error instanceof AcceptanceError) throw error
    throw new AcceptanceError('ACCEPTANCE_FILE_UNAVAILABLE')
  }
}

export async function verifyAcceptance({ root = process.cwd(), contractPath, reportPath, execute }) {
  const commit = cleanHead(root)
  const contractBytes = await readBounded(resolve(contractPath), 65536)
  const reportBytes = await readBounded(resolve(reportPath), 65536)
  const contract = json(contractBytes)
  const report = json(reportBytes)
  const artifacts = validateDocuments(contract, report)
  let liveUi = contract.schemaVersion === 2 ? validateLiveUi(contract.liveUi, report.liveUi) : null
  if (liveUi) require(contract.liveUi.checks.every(row => contract.requirements.some(required => required.id === row.id)))
  if (liveUi) require(contract.requirements.filter(row => ['browser', 'manual'].includes(row.method))
    .every(row => contract.liveUi.checks.some(live => live.id === row.id)))
  require(report.commit === commit, 'ACCEPTANCE_STALE_COMMIT')
  require(report.contractSha256 === digest(contractBytes), 'ACCEPTANCE_STALE_CONTRACT')
  const evidenceRoot = await realpath(dirname(resolve(reportPath)))
  let totalBytes = 0
  for (const [path, expected] of artifacts) {
    const target = await artifactPath(evidenceRoot, path)
    const bytes = await readBounded(target, 1024 * 1024)
    totalBytes += bytes.length
    require(totalBytes <= 16 * 1024 * 1024, 'ACCEPTANCE_TOTAL_LIMIT')
    await artifactPath(evidenceRoot, path)
    require(digest(bytes) === expected, 'ACCEPTANCE_EVIDENCE_MISMATCH')
  }
  require(digest(await readBounded(resolve(contractPath), 65536)) === digest(contractBytes)
    && digest(await readBounded(resolve(reportPath), 65536)) === digest(reportBytes), 'ACCEPTANCE_FILE_CHANGED')
  require(cleanHead(root) === commit, 'ACCEPTANCE_STALE_COMMIT')
  const counts = Object.fromEntries(statuses.map(status => [status, report.checks.filter(check => check.status === status).length]))
  let ci = null
  if (liveUi) {
    const { runGuardedOperation } = await import('./environment-guard.mjs')
    ci = await runGuardedOperation({ task: String(contract.issue), environment: 'github-actions-evidence',
      operation: 'ci-evidence', head: commit, root, execute })
    require(cleanHead(root) === commit, 'ACCEPTANCE_STALE_COMMIT')
    require(digest(await readBounded(resolve(contractPath), 65536)) === digest(contractBytes)
      && digest(await readBounded(resolve(reportPath), 65536)) === digest(reportBytes), 'ACCEPTANCE_FILE_CHANGED')
    liveUi = validateLiveUi(contract.liveUi, report.liveUi)
  }
  const ok = counts.passed === contract.requirements.length && (!liveUi || (liveUi.ok && ci.ok))
  return {
    schemaVersion: 1, kind: 'acceptance-evidence-consistency',
    ok,
    issue: contract.issue, commit, contractSha256: report.contractSha256, counts,
    evidenceIntegrityVerified: true, executionVerified: false, independenceVerified: false,
    environmentVerified: false, deliveryAuthorized: false,
    ...liveUi ? { state: ok ? 'reported-complete' : 'blocked', closeEligible: ok,
      liveUi, ci, ciVerified: ci.ok } : {},
  }
}

export async function acceptanceMain(args) {
  try {
    const options = {}
    for (let i = 0; i < args.length; i += 2) {
      require(['--contract', '--report'].includes(args[i]) && !Object.hasOwn(options, args[i])
        && typeof args[i + 1] === 'string' && args[i + 1].length > 0 && !args[i + 1].startsWith('--'),
      'ACCEPTANCE_ARGUMENTS')
      options[args[i]] = args[i + 1]
    }
    require(Object.keys(options).length === 2, 'ACCEPTANCE_ARGUMENTS')
    const result = await verifyAcceptance({ contractPath: options['--contract'], reportPath: options['--report'] })
    console.log(JSON.stringify(result))
    return result.ok ? 0 : 1
  } catch (error) {
    console.log(JSON.stringify({ schemaVersion: 1, ok: false,
      error: error instanceof AcceptanceError ? error.message : 'ACCEPTANCE_UNAVAILABLE' }))
    return 2
  }
}
