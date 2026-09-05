import { readFile, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const readJson = async (root, path) => JSON.parse(await readFile(resolve(root, path), 'utf8'))

/** Read repository-owned metadata only. Never inspect DSH_HOME, credentials or live services. */
export async function describeRepository(root = repositoryRoot) {
  const [contract, pkg, baseline] = await Promise.all([
    readJson(root, 'agent-contract.json'),
    readJson(root, 'package.json'),
    readJson(root, 'deployment-baseline.json'),
  ])
  return {
    schemaVersion: 1,
    kind: 'repository-contract',
    package: { name: pkg.name, version: pkg.version, node: pkg.engines.node, packageManager: pkg.packageManager },
    entrypoints: contract.entrypoints,
    boundaries: contract.boundaries,
    tasks: contract.tasks,
    scripts: pkg.scripts,
    baselines: baseline.supportedBaselines.dsh.baselines.map(({ release, commit, perModelApi }) => ({
      release, commit, perModelApi,
    })),
    release: {
      tag: `v${pkg.version}`,
      tarball: `dsh-github-copilot-${pkg.version}.tgz`,
      url: `${baseline.baseline.source}/releases/download/v${pkg.version}/dsh-github-copilot-${pkg.version}.tgz`,
      publicationVerified: false,
    },
  }
}

export async function planTask(task, root = repositoryRoot) {
  const description = await describeRepository(root)
  const area = Object.hasOwn(description.tasks, task) ? description.tasks[task] : undefined
  if (area === undefined) throw new Error(`Unknown task. Choose: ${Object.keys(description.tasks).join(', ')}`)
  const commands = [
    ['pnpm', 'install', '--frozen-lockfile'],
    ...(area.tests.length === 0 ? [['pnpm', 'test:scripts']] : [['pnpm', 'exec', 'vitest', 'run', ...area.tests]]),
    ['pnpm', 'verify'],
    ['pnpm', 'pack', '--pack-destination', 'artifacts'],
    ['pnpm', 'verify:tarball', '--', `artifacts/${description.release.tarball}`],
  ]
  return {
    schemaVersion: 1,
    kind: 'task-plan',
    task,
    ...area,
    cwd: 'repository root',
    commands: commands.map(argv => ({ argv, executed: false })),
    delivery: 'Issue -> feature branch -> focused tests -> complete gate -> review -> PR. Ask before merge/release/install.',
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
      checks.push({ id: `dependency:${name}`, status: 'fail', detail: 'missing-or-unreadable', next: 'pnpm install --frozen-lockfile' })
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
    notChecked: ['GitHub authentication/CI/Release', 'live DSH profile and loaded plugin', 'Copilot account availability', 'model transport', 'hosted search', 'build freshness', 'pnpm executable version'],
    next: 'Run pnpm verify. Do not treat this report as runtime or release validation.',
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
  try {
    let result
    if (extra !== undefined) throw new Error('Too many arguments.')
    if (command === 'describe' && value === undefined) result = await describeRepository()
    else if (command === 'doctor' && value === undefined) result = await doctor()
    else if (command === 'plan' && value !== undefined) result = await planTask(value)
    else if (command === 'attribution' && value !== undefined) result = { schemaVersion: 1, trailer: attribution(value) }
    else throw new Error('Usage: node scripts/agent.mjs describe|doctor|plan <task>|attribution "Actual Tool" [--json]')
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
