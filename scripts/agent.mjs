import { readFile, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const readJson = async (root, path) => JSON.parse(await readFile(resolve(root, path), 'utf8'))

/** Read repository-owned metadata only. Never inspect DSH_HOME, credentials or live services. */
export async function describeRepository(root = repositoryRoot) {
  const [contract, pkg, baseline, executionPolicy] = await Promise.all([
    readJson(root, 'agent-contract.json'),
    readJson(root, 'package.json'),
    readJson(root, 'deployment-baseline.json'),
    readJson(root, 'agent-execution-policy.json'),
  ])
  return {
    schemaVersion: 1,
    kind: 'repository-contract',
    package: { name: pkg.name, version: pkg.version, node: pkg.engines.node, packageManager: pkg.packageManager },
    executionPolicy,
    entrypoints: contract.entrypoints,
    boundaries: contract.boundaries,
    acceptance: contract.acceptance,
    tasks: contract.tasks,
    scripts: pkg.scripts,
    admittedReleases: baseline.supportedBaselines.dsh.admittedReleases,
    baselines: baseline.supportedBaselines.dsh.baselines.map(({ release, commit, perModelApi }) => ({
      release, commit, perModelApi,
    })),
    release: {
      tag: `v${pkg.version}`,
      tarball: `dsh-github-copilot-${pkg.version}.tgz`,
      url: `${baseline.baseline.source}/releases/download/v${pkg.version}/dsh-github-copilot-${pkg.version}.tgz`,
      publicationVerified: false,
      npm: { spec: `${pkg.name}@${pkg.version}`, registry: pkg.publishConfig?.registry,
        tag: pkg.publishConfig?.tag, publicationVerified: false },
    },
  }
}

export async function planTask(task, root = repositoryRoot) {
  const description = await describeRepository(root)
  const area = Object.hasOwn(description.tasks, task) ? description.tasks[task] : undefined
  if (area === undefined) throw new Error(`Unknown task. Choose: ${Object.keys(description.tasks).join(', ')}`)
  const commands = [
    ['node', 'scripts/agent.mjs', 'guard', '--task', 'TASK_ID',
      '--environment', 'local-auxiliary', '--operation', 'scripts-test'],
    ['node', 'scripts/agent.mjs', 'guard', '--task', 'TASK_ID',
      '--environment', 'github-actions-evidence', '--operation', 'ci-evidence',
      '--head', 'FULL_40_CHARACTER_COMMIT'],
  ]
  return {
    schemaVersion: 1,
    kind: 'task-plan',
    task,
    ...area,
    cwd: 'repository root',
    preflightChecks: area.iterationReview ? [{
      argv: ['node', 'scripts/iteration-review.mjs', '--report', area.iterationReview.report],
      executed: false,
      requiredBeforeImplementation: area.iterationReview.requiredBeforeImplementation,
    }] : [],
    commands: commands.map(argv => ({ argv, executed: false })),
    acceptance: description.acceptance,
    executionPolicy: description.executionPolicy,
    delivery: 'Issue -> feature branch -> focused tests -> complete gate -> reviewed merge without a separate approval prompt; important updates continue to verified Release and npm integrity without a second release prompt, unless user scope excludes it. Other changes need an explicit release request. Ask before profile installation or interrupting restart; report any publication blocker.',
    boundaries: description.boundaries,
  }
}

export async function doctor(root = repositoryRoot, nodeVersion = process.versions.node) {
  const description = await describeRepository(root)
  const checks = []
  const [major, minor] = nodeVersion.split('.').map(Number)
  const nodeOk = major > 22 || (major === 22 && minor >= 19)
  checks.push({ id: 'node-runtime', status: nodeOk ? 'pass' : 'fail', detail: nodeVersion, next: nodeOk ? null : 'Use Node 24 LTS (runtime requires >=22.19.0).' })
  for (const name of ['typescript', 'vitest', 'tsdown', '@earendil-works/pi-ai', '@deepseek-ai/dsh-llm-pi-ai']) {
    try {
      const pkg = await readJson(root, `node_modules/${name}/package.json`)
      checks.push({ id: `dependency:${name}`, status: 'pass', detail: pkg.version, next: null })
    } catch {
      checks.push({ id: `dependency:${name}`, status: 'fail', detail: 'missing-or-unreadable',
        next: 'Use the guarded GitHub Actions evidence check for full verification; do not restore dependencies on a local checkout.' })
    }
  }
  for (const path of ['lib/index.js', 'lib/client.js', 'lib/remote.js']) {
    let present = false
    try { present = (await stat(resolve(root, path))).isFile() } catch {}
    checks.push({ id: `build:${path}`, status: present ? 'pass' : 'warning', detail: present ? 'present; freshness and execution NOT checked' : 'not built', next: 'pnpm verify' })
  }
  return {
    schemaVersion: 1,
    kind: 'repository-preflight',
    ok: checks.every(check => check.status !== 'fail'),
    package: description.package,
    checks,
    notChecked: ['GitHub authentication/CI/Release', 'npm ownership/authentication/publication', 'live DSH profile and loaded plugin', 'Copilot account availability', 'model transport', 'hosted search', 'build freshness', 'pnpm executable version'],
    next: 'Choose an explicit guarded environment and task. Use local-auxiliary only for dependency-free script tests; full verification requires actual GitHub Actions evidence.',
  }
}

export function attribution(tool) {
  if (typeof tool !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9 ()_.+-]{0,79}$/.test(tool)) {
    throw new Error('Provide the actual assisting tool as one short printable name; no email, newline or extra trailer.')
  }
  return `Assisted-by: ${tool}`
}

export async function main(args = process.argv.slice(2)) {
  const json = args.includes('--json')
  const rest = args.filter(arg => arg !== '--json')
  const [command, value, extra] = rest
  if (command === 'accept') {
    const { acceptanceMain } = await import('./acceptance.mjs')
    return acceptanceMain(rest.slice(1))
  }
  if (command === 'guard') {
    const { guardErrorResult, guardMain } = await import('./environment-guard.mjs')
    try { return await guardMain(rest.slice(1)) }
    catch (error) {
      console.log(JSON.stringify(guardErrorResult(error)))
      return 2
    }
  }
  try {
    let result
    if (extra !== undefined) throw new Error('Too many arguments.')
    if (command === 'describe' && value === undefined) result = await describeRepository()
    else if (command === 'doctor' && value === undefined) result = await doctor()
    else if (command === 'plan' && value !== undefined) result = await planTask(value)
    else if (command === 'attribution' && value !== undefined) result = { schemaVersion: 1, trailer: attribution(value) }
    else throw new Error('Usage: node scripts/agent.mjs describe|doctor|plan <task>|attribution "Actual Tool"|accept --contract FILE --report FILE [--json]|guard --task TASK_ID --environment local-auxiliary|github-actions-evidence --operation NAME [--head SHA]')
    if (json || command !== 'attribution') console.log(JSON.stringify(result, null, 2))
    else console.log(result.trailer)
    return result.ok === false ? 1 : 0
  } catch (error) {
    const message = error instanceof SyntaxError ? 'Repository metadata contains invalid JSON.' : error.message
    if (json) console.log(JSON.stringify({ schemaVersion: 1, ok: false, error: message }))
    else console.error(message)
    return 2
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main()
}
