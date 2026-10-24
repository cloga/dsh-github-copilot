import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, realpath } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

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
  keys(contract, ['schemaVersion', 'issue', 'task', 'objective', 'nonGoals', 'requirements'])
  require(contract.schemaVersion === 1 && Number.isSafeInteger(contract.issue) && contract.issue > 0
    && id(contract.task) && text(contract.objective))
  list(contract.nonGoals, 1, 16)
  require(contract.nonGoals.every(text))
  list(contract.requirements, 1, 64)
  const required = new Set()
  for (const row of contract.requirements) {
    keys(row, ['id', 'expected', 'method'])
    require(id(row.id) && !required.has(row.id) && text(row.expected) && methods.includes(row.method))
    required.add(row.id)
  }
  keys(report, ['schemaVersion', 'commit', 'contractSha256', 'producer', 'environment', 'checks'])
  require(report.schemaVersion === 1 && typeof report.commit === 'string' && /^[a-f0-9]{40}$/.test(report.commit)
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
    seen.add(check.id)
    list(check.evidence, check.status === 'passed' ? 1 : 0, 8)
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

export async function verifyAcceptance({ root = process.cwd(), contractPath, reportPath }) {
  const commit = cleanHead(root)
  const contractBytes = await readBounded(resolve(contractPath), 65536)
  const reportBytes = await readBounded(resolve(reportPath), 65536)
  const contract = json(contractBytes)
  const report = json(reportBytes)
  const artifacts = validateDocuments(contract, report)
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
  return {
    schemaVersion: 1, kind: 'acceptance-evidence-consistency',
    ok: counts.passed === contract.requirements.length,
    issue: contract.issue, commit, contractSha256: report.contractSha256, counts,
    evidenceIntegrityVerified: true, executionVerified: false, independenceVerified: false,
    environmentVerified: false, deliveryAuthorized: false,
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
