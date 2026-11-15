import { realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { parseAcceptanceJson, readAcceptanceFile } from './acceptance.mjs'

const stages = ['desktop', 'release', 'preflight', 'installed', 'loaded', 'behavior']
const dependencies = {
  desktop: [],
  release: ['desktop'],
  preflight: ['desktop'],
  installed: ['release', 'preflight'],
  loaded: ['installed'],
  behavior: ['loaded'],
}
const versioned = new Set(['desktop', 'release', 'installed', 'loaded'])
const statuses = new Set(['passed', 'failed', 'blocked', 'unknown', 'not-run'])
const peerStates = new Set(['matching', 'mismatch', 'unknown'])
const validVersion = value => typeof value === 'string' && value.length <= 100
  && /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/.test(value)
const exact = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))

function invalid() {
  throw new Error('LOCAL_DELIVERY_INVALID')
}

export function assessLocalDelivery(input, now = Date.now()) {
  if (!Number.isSafeInteger(now) || now <= 0
    || !exact(input, ['schemaVersion', 'target', 'stages', 'peers']) || input.schemaVersion !== 1
    || !exact(input.target, ['profile', 'desktopVersion', 'pluginVersion']) || input.target.profile !== 'desktop'
    || !validVersion(input.target.desktopVersion) || !validVersion(input.target.pluginVersion)
    || !exact(input.stages, stages) || !exact(input.peers, ['bundled', 'resolved', 'loaded'])
    || Object.values(input.peers).some(value => !peerStates.has(value))) invalid()

  const evaluated = {}
  const reportedStatuses = {}
  for (const stage of stages) {
    const item = input.stages[stage]
    const hasVersion = versioned.has(stage)
    if (!exact(item, hasVersion ? ['status', 'version', 'observedAtMs'] : ['status', 'observedAtMs'])
      || !statuses.has(item.status)
      || (item.status === 'not-run' ? item.observedAtMs !== null
        : !Number.isSafeInteger(item.observedAtMs) || item.observedAtMs <= 0 || item.observedAtMs > now)
      || (hasVersion && item.version !== null && !validVersion(item.version))
      || (hasVersion && item.status === 'passed' && item.version === null)
      || (hasVersion && item.status === 'not-run' && item.version !== null)) invalid()

    reportedStatuses[stage] = item.status
    const expected = stage === 'desktop' ? input.target.desktopVersion : input.target.pluginVersion
    if (hasVersion && item.version !== null && item.version !== expected) {
      evaluated[stage] = 'version-mismatch'
    } else if (item.status === 'passed' && dependencies[stage].some(dependency =>
      evaluated[dependency] !== 'passed' || input.stages[dependency].observedAtMs > item.observedAtMs)) {
      evaluated[stage] = 'stale'
    } else {
      evaluated[stage] = item.status
    }
  }

  const warnings = ['bundled', 'resolved', 'loaded']
    .filter(source => input.peers[source] !== 'matching')
    .map(source => `${source}-peer-${input.peers[source]}`)
  const nextStage = stages.find(stage => evaluated[stage] !== 'passed') ?? null
  return {
    schemaVersion: 1,
    kind: 'local-delivery-reported-state',
    state: nextStage !== null ? 'incomplete'
      : warnings.length > 0 ? 'reported-complete-with-uncertainty' : 'reported-complete',
    stages: evaluated,
    reportedStatuses,
    nextStage,
    warnings,
    executionVerified: false,
    authorizationVerified: false,
    acceptanceVerified: false,
  }
}

export async function readLocalDelivery(path, root, now = Date.now()) {
  let actualFile
  let actualRoot
  try {
    ;[actualFile, actualRoot] = await Promise.all([realpath(resolve(path)), realpath(resolve(root))])
  } catch {
    throw new Error('LOCAL_DELIVERY_FILE_UNAVAILABLE')
  }
  const fromRoot = relative(actualRoot, actualFile)
  if (fromRoot === '' || (!isAbsolute(fromRoot) && fromRoot !== '..' && !fromRoot.startsWith(`..${sep}`))) {
    throw new Error('LOCAL_DELIVERY_UNSAFE_FILE')
  }
  let bytes
  try {
    bytes = await readAcceptanceFile(resolve(path), 65536)
  } catch (error) {
    const code = error.message === 'ACCEPTANCE_UNSAFE_FILE' ? 'LOCAL_DELIVERY_UNSAFE_FILE'
      : error.message === 'ACCEPTANCE_FILE_LIMIT' ? 'LOCAL_DELIVERY_INVALID'
        : 'LOCAL_DELIVERY_FILE_UNAVAILABLE'
    throw new Error(code)
  }
  let input
  try { input = parseAcceptanceJson(bytes) } catch { invalid() }
  return assessLocalDelivery(input, now)
}

export async function localDeliveryMain(args, root) {
  try {
    if (args.length !== 2 || args[0] !== '--state' || !args[1]) invalid()
    const result = await readLocalDelivery(args[1], root)
    console.log(JSON.stringify(result))
    return result.state === 'reported-complete' ? 0 : 1
  } catch (error) {
    const code = ['LOCAL_DELIVERY_INVALID', 'LOCAL_DELIVERY_UNSAFE_FILE', 'LOCAL_DELIVERY_FILE_UNAVAILABLE']
      .includes(error.message) ? error.message : 'LOCAL_DELIVERY_INVALID'
    console.log(JSON.stringify({ schemaVersion: 1, kind: 'local-delivery-reported-state', error: code }))
    return 2
  }
}
