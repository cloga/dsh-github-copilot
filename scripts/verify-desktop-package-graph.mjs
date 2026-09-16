import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { satisfies } from 'semver'
import { repositoryRoot } from './agent.mjs'

const DEFAULT_CONTRACT = resolve(repositoryRoot, 'tests/fixtures/desktop-shared-package-contracts.json')

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
}

function entries(value) {
  return record(value) ? Object.entries(value) : []
}

export async function readDesktopSharedPackageContracts(path = DEFAULT_CONTRACT) {
  const value = JSON.parse(await readFile(path, 'utf8'))
  if (value?.schemaVersion !== 1 || value.projection !== 'manifest-runtime-and-peer-names'
    || !Array.isArray(value.contracts) || value.contracts.length === 0) {
    throw new Error('Desktop shared-package contract fixture is invalid')
  }
  if (new Set(value.contracts.map(contract => contract?.id)).size !== value.contracts.length) {
    throw new Error('Desktop shared-package contract fixture has duplicate ids')
  }
  return value.contracts
}

export function verifyDesktopPackageGraph(manifest, contracts) {
  const dependencies = Object.fromEntries([
    ...entries(manifest.dependencies),
    ...entries(manifest.optionalDependencies),
  ])
  const peers = Object.fromEntries(entries(manifest.peerDependencies))
  const declared = [...new Set([...Object.keys(dependencies), ...Object.keys(peers)])].sort()
  const requiredPeers = new Set(['@deepseek-ai/dsh-authorization', '@deepseek-ai/schemastery'])

  for (const contract of contracts) {
    if (typeof contract?.id !== 'string' || !/^[a-f0-9]{64}$/u.test(contract.sourceSha256)
      || !Number.isSafeInteger(contract.sourceBytes) || contract.sourceBytes <= 0
      || !Number.isSafeInteger(contract.packageCount) || contract.packageCount <= 0
      || !record(contract.auditedPackages)) {
      throw new Error('Desktop shared-package contract entry is invalid')
    }
    const audited = Object.keys(contract.auditedPackages).sort()
    if (JSON.stringify(audited) !== JSON.stringify(declared)) {
      throw new Error(`${contract.id}: dependency declarations changed without a shared-package audit`)
    }
    for (const [name, hostVersion] of Object.entries(contract.auditedPackages)) {
      if (hostVersion === null) continue
      if (typeof hostVersion !== 'string') throw new Error(`${contract.id}: invalid shared version for ${name}`)
      if (name in dependencies) {
        throw new Error(`${contract.id}: ${manifest.name} must declare ${name} as a peer dependency`)
      }
      const range = peers[name]
      if (typeof range !== 'string') throw new Error(`${contract.id}: missing shared peer ${name}`)
      if (!satisfies(hostVersion, range)) {
        throw new Error(`${contract.id}: ${name}@${range} does not admit host ${hostVersion}`)
      }
    }
  }

  for (const name of requiredPeers) {
    if (typeof peers[name] !== 'string') throw new Error(`Missing required host peer ${name}`)
    if (manifest.peerDependenciesMeta?.[name]?.optional === true) {
      throw new Error(`Host peer ${name} must not be optional`)
    }
    if (typeof manifest.devDependencies?.[name] !== 'string') {
      throw new Error(`Standalone development must retain ${name} as a dev dependency`)
    }
  }

  return contracts.map(contract => ({
    id: contract.id,
    sourceSha256: contract.sourceSha256,
    packageCount: contract.packageCount,
  }))
}
