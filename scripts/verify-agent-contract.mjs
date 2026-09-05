import { access, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { repositoryRoot } from './agent.mjs'

export async function verifyAgentContract(root = repositoryRoot) {
  const contract = JSON.parse(await readFile(resolve(root, 'agent-contract.json'), 'utf8'))
  const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
  const require = (condition, message) => { if (!condition) throw new Error(`Agent contract: ${message}`) }
  require(contract.schemaVersion === 1, 'unsupported schemaVersion')
  require(contract.boundaries?.approvalRequired?.includes('merge'), 'merge approval boundary is missing')
  require(contract.boundaries?.approvalRequired?.includes('release'), 'release approval boundary is missing')
  require(contract.boundaries?.approvalRequired?.includes('install into a user profile'), 'installation approval boundary is missing')
  const file = async path => {
    require(typeof path === 'string' && !path.startsWith('/') && !path.includes('..') && !path.includes('\\') && !path.includes(':'), 'unsafe relative path')
    await access(resolve(root, path))
  }
  require(Array.isArray(contract.entrypoints) && contract.entrypoints.includes('AGENTS.md'), 'authoritative entrypoint is missing')
  for (const path of contract.entrypoints) await file(path)
  require(contract.tasks && Object.keys(contract.tasks).length > 0, 'task directory is missing')
  for (const [name, task] of Object.entries(contract.tasks)) {
    require(/^[a-z]+$/.test(name), 'invalid task id')
    require(typeof task.purpose === 'string' && typeof task.risk === 'string', `${name} needs purpose and risk`)
    require(Array.isArray(task.read) && task.read.length > 0 && Array.isArray(task.tests), `${name} needs read/tests lists`)
    for (const path of [...task.read, ...task.tests]) await file(path)
  }
  for (const script of ['agent:describe', 'agent:doctor', 'agent:plan', 'verify:agent', 'test:scripts', 'typecheck:tests', 'verify:tarball']) {
    require(typeof pkg.scripts[script] === 'string', `missing package script ${script}`)
  }
  for (const script of ['verify:agent', 'typecheck:tests', 'test:scripts']) {
    require(pkg.scripts.verify.includes(`pnpm ${script}`), `${script} is absent from the full gate`)
  }
  for (const path of ['AGENTS.md', 'CONTRIBUTING.md', '.github/PULL_REQUEST_TEMPLATE.md']) {
    const text = await readFile(resolve(root, path), 'utf8')
    require(text.includes('Assisted-by'), `${path} needs accurate tool attribution guidance`)
    require(!text.includes('required co-author trailer') && !text.includes('repository-required co-author trailer'), `${path} mandates unverified co-author attribution`)
  }
  const workflow = await readFile(resolve(root, '.github/workflows/release.yml'), 'utf8')
  require(/needs:\s*verify/.test(workflow) && workflow.includes('uses: ./.github/workflows/ci.yml'), 'release must wait for the complete CI matrix')
  return { schemaVersion: 1, ok: true, taskCount: Object.keys(contract.tasks).length }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await verifyAgentContract()))
}
