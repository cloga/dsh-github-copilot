import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { repositoryRoot } from './agent.mjs'

const DEFAULT_CONTRACT = resolve(repositoryRoot, 'tests/fixtures/desktop-shared-package-contracts.json')

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
}

function entries(value) {
  return record(value) ? Object.entries(value) : []
}

function version(value) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/u.exec(value)
  if (!match) throw new Error(`Unsupported shared-package version ${JSON.stringify(value)}`)
  return match.slice(1, 4).map(Number)
}

function admits(actual, range) {
  return range.split(/\s+\|\|\s+/u).some((candidate) => {
    if (!candidate.startsWith('^')) return candidate === actual
    const expected = version(candidate.slice(1))
    const found = version(actual)
    const minimum = found[0] > expected[0]
      || (found[0] === expected[0] && (found[1] > expected[1]
        || (found[1] === expected[1] && found[2] >= expected[2])))
    if (!minimum) return false
    if (expected[0] > 0) return found[0] === expected[0]
    if (expected[1] > 0) return found[0] === 0 && found[1] === expected[1]
    return found[0] === 0 && found[1] === 0 && found[2] === expected[2]
  })
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
  const rawExternals = manifest.dsh?.client?.external ?? []
  if (!Array.isArray(rawExternals) || rawExternals.some(name => typeof name !== 'string' || name.length === 0)
    || new Set(rawExternals).size !== rawExternals.length) {
    throw new Error('Client external declarations are invalid')
  }
  const clientExternals = new Set(rawExternals)
  const declared = [...new Set([...Object.keys(dependencies), ...Object.keys(peers), ...clientExternals])].sort()
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
      if (hostVersion === null) {
        if (name in peers && manifest.peerDependenciesMeta?.[name]?.optional !== true) {
          throw new Error(`${contract.id}: ${manifest.name} requires missing non-host peer ${name}`)
        }
        continue
      }
      if (typeof hostVersion !== 'string') throw new Error(`${contract.id}: invalid shared version for ${name}`)
      if (name in dependencies) {
        throw new Error(`${contract.id}: ${manifest.name} must declare ${name} as a peer dependency`)
      }
      const range = peers[name]
      if (typeof range !== 'string') throw new Error(`${contract.id}: missing shared peer ${name}`)
      if (!admits(hostVersion, range)) {
        throw new Error(`${contract.id}: ${name}@${range} does not admit host ${hostVersion}`)
      }
    }
  }

  for (const name of clientExternals) {
    if (name in dependencies || name in peers) {
      throw new Error(`Client external ${name} must not be a Node dependency or peer`)
    }
    if (typeof manifest.devDependencies?.[name] !== 'string') {
      throw new Error(`Standalone development must retain Client external ${name} as a dev dependency`)
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
