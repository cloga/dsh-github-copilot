import { randomUUID } from 'node:crypto'
import { temporaryGitHubCopilotModel, temporaryGitHubCopilotModelFromProfile, temporaryGitHubCopilotModelProfile } from './temporary-models.ts'

/** Journal provenance only; process identity is not namespace lifetime evidence. */
export const ROUTE_OWNERSHIP_EPOCH = randomUUID()

export type RouteMutation =
  | { readonly op: 'set'; readonly path: string[]; readonly value: unknown }
  | { readonly op: 'unset'; readonly path: string[] }

export interface RouteSettings {
  get(namespace: string): unknown
  describe(options?: { redactSecrets?: boolean }): Array<{
    ns: string
    revision: number
    user?: unknown
    base?: unknown
    secrets?: readonly { path: readonly string[]; set: boolean }[]
  }>
  mutate(namespace: string, operations: readonly RouteMutation[], expectedRevision?: number): Promise<void>
}

export class TemporaryRouteConflictError extends Error {
  constructor(readonly code: 'TEMPORARY_ROUTE_OWNERSHIP_CONFLICT' | 'TEMPORARY_ROUTE_LEGACY_CONFLICT' | 'TEMPORARY_ROUTE_INVALID_BACKUP' = 'TEMPORARY_ROUTE_OWNERSHIP_CONFLICT') {
    super(`github-copilot: ${code}; automatic repair stopped without rolling back user edits. Review the temporary route and ownership marker in settings before reconnecting; do not force ownership.`)
    this.name = 'TemporaryRouteConflictError'
  }
}

export function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined
}

export function profileAt(value: unknown): Record<string, unknown> | undefined {
  return object(object(object(value)?.providers)?.['github-copilot'])
}

/** Bounded comparison; never stringify or copy unknown model extras or headers. */
export function equalJson(a: unknown, b: unknown, depth = 0): boolean {
  if (a === b) return true
  if (depth > 12) return false
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length <= 512 && a.length === b.length
      && a.every((value, i) => equalJson(value, b[i], depth + 1))
  }
  const left = object(a)
  const right = object(b)
  if (!left || !right) return false
  const keys = Object.keys(left)
  return keys.length <= 512 && keys.length === Object.keys(right).length
    && keys.every(key => Object.hasOwn(right, key) && equalJson(left[key], right[key], depth + 1))
}

interface Leaves { readonly api?: string; readonly models?: readonly Record<string, unknown>[] }
export interface RouteBackup {
  readonly version: 2
  readonly providerExisted: boolean
  readonly preimage: Leaves
  readonly postimage: Leaves
  readonly ownedHeaders: Readonly<Record<string, string>>
  readonly phase: 'overlay' | 'restoring'
  readonly sourceRevision: number
  readonly sourceEpoch: string
  readonly target?: Leaves
  readonly removeProfile?: boolean
}
const MAX_BACKUP = 131_072

function safeModels(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length > 512) throw new TemporaryRouteConflictError()
  return value.map((entry) => {
    const model = object(entry)
    if (!model || typeof model.id !== 'string' || !/^[a-zA-Z0-9._:/-]{1,200}$/.test(model.id)) throw new TemporaryRouteConflictError()
    // Check only plugin-authored keys against public constants; never inspect,
    // serialize or persist arbitrary extras (which may contain credentials).
    const overlay = temporaryGitHubCopilotModel(model.id, new Set())
    if (overlay && Object.keys(model).some(key => key !== 'id' && key !== 'api')) {
      const known = temporaryGitHubCopilotModelProfile(overlay)
      if (!equalJson(model, known)) throw new TemporaryRouteConflictError()
      return known
    }
    if (Object.keys(model).some(key => key !== 'id' && key !== 'api')
      || (model.api !== undefined && (typeof model.api !== 'string' || !/^[a-z0-9-]{1,80}$/.test(model.api)))) throw new TemporaryRouteConflictError()
    return { id: model.id, ...model.api === undefined ? {} : { api: model.api } }
  })
}

export function leavesOf(profile: Record<string, unknown> | undefined): Leaves {
  if (profile?.api !== undefined && (typeof profile.api !== 'string' || !/^[a-z0-9-]{1,80}$/.test(profile.api))) throw new TemporaryRouteConflictError()
  return {
    ...profile?.api === undefined ? {} : { api: profile.api as string },
    ...profile?.models === undefined ? {} : { models: safeModels(profile.models) },
  }
}

export function encodeBackup(backup: RouteBackup): string {
  const encoded = JSON.stringify(backup)
  if (encoded.length > MAX_BACKUP) throw new TemporaryRouteConflictError()
  return encoded
}

export function readBackup(value: unknown): RouteBackup | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.length > MAX_BACKUP) throw new TemporaryRouteConflictError('TEMPORARY_ROUTE_INVALID_BACKUP')
  try {
    const decoded = object(JSON.parse(value))
    if (!decoded) throw new Error()
    if (decoded.version === undefined || (decoded.version === 2 && decoded.sourceEpoch === undefined)) throw new TemporaryRouteConflictError('TEMPORARY_ROUTE_LEGACY_CONFLICT')
    if (decoded.version !== 2 || typeof decoded.providerExisted !== 'boolean'
      || typeof decoded.sourceEpoch !== 'string' || !/^[a-f0-9-]{36}$/.test(decoded.sourceEpoch)
      || !Number.isSafeInteger(decoded.sourceRevision) || Number(decoded.sourceRevision) < 0
      || !['overlay', 'restoring'].includes(String(decoded.phase))
      || !object(decoded.preimage) || !object(decoded.postimage) || !object(decoded.ownedHeaders)
      || Object.keys(decoded).some(key => !['version', 'providerExisted', 'preimage', 'postimage', 'ownedHeaders', 'phase', 'sourceRevision', 'sourceEpoch', 'target', 'removeProfile'].includes(key))) throw new Error()
    for (const leaf of [decoded.preimage, decoded.postimage, ...(decoded.phase === 'restoring' ? [decoded.target] : [])]) {
      const record = object(leaf)
      if (!record || !equalJson(record, leavesOf(record))) throw new Error()
    }
    // Only public constants from the recognized overlay may ever be persisted as headers.
    const models = (object(decoded.postimage)?.models ?? []) as Record<string, unknown>[]
    const knownHeaders = Object.assign({}, ...models.flatMap(model => {
      const overlay = temporaryGitHubCopilotModelFromProfile(model)
      return overlay ? [overlay.headers] : []
    })) as Record<string, unknown>
    if (!Object.entries(object(decoded.ownedHeaders)!).every(([name, header]) => knownHeaders[name] === header)) throw new Error()
    if (decoded.removeProfile !== undefined && typeof decoded.removeProfile !== 'boolean') throw new Error()
    return decoded as unknown as RouteBackup
  }
  catch (error) {
    if (error instanceof TemporaryRouteConflictError && error.code === 'TEMPORARY_ROUTE_LEGACY_CONFLICT') throw error
    throw new TemporaryRouteConflictError('TEMPORARY_ROUTE_INVALID_BACKUP')
  }
}

export function settingsSnapshot(settings: RouteSettings) {
  const descriptors = settings.describe({ redactSecrets: true })
  const route = descriptors.find(item => item.ns === 'llm-pi-ai')
  const marker = descriptors.find(item => item.ns === 'github-copilot')
  if (!route || !marker || !Number.isSafeInteger(route.revision) || !Number.isSafeInteger(marker.revision)) {
    throw new Error('github-copilot: required DSH API "settings.describe revision" is unavailable')
  }
  const current = profileAt(settings.get('llm-pi-ai'))
  const raw = profileAt(route.user)
  // Redaction is not evidence that a secret-bearing field is absent.
  const secrets = (route.secrets ?? []).filter(secret => secret.set
    && secret.path[0] === 'providers' && secret.path[1] === 'github-copilot')
  const hasSecrets = secrets.length > 0
  const hasOwnedSecrets = secrets.some(secret => secret.path[2] === 'api' || secret.path[2] === 'models')
  return { current, raw, base: profileAt(route.base), hasSecrets, hasOwnedSecrets, routeRevision: route.revision, markerRevision: marker.revision,
    backup: readBackup(object(settings.get('github-copilot'))?.temporaryRouteBackup) }
}

export function assertOwned(current: Record<string, unknown> | undefined, backup: RouteBackup): 'preimage' | 'postimage' | 'target' {
  // Unknown extras on an owned models array are a conflict, never dropped by projection.
  const leaves = leavesOf(current)
  if (backup.phase === 'restoring') {
    if (equalJson(leaves, backup.target) && (!backup.removeProfile || current === undefined)) return 'target'
    if (equalJson(leaves, backup.postimage)) return 'postimage'
  }
  else {
    if (equalJson(leaves, backup.postimage)) return 'postimage'
    if (equalJson(leaves, backup.preimage)) return 'preimage'
  }
  throw new TemporaryRouteConflictError()
}

export function leafOperations(current: Record<string, unknown> | undefined, target: Leaves): RouteMutation[] {
  return (['api', 'models'] as const).flatMap((field): RouteMutation[] => equalJson(current?.[field], target[field]) ? [] : [
    target[field] === undefined
      ? { op: 'unset', path: ['providers', 'github-copilot', field] }
      : { op: 'set', path: ['providers', 'github-copilot', field], value: target[field] },
  ])
}

export function ownedHeaderRemoval(current: Record<string, unknown> | undefined, backup: RouteBackup): RouteMutation[] {
  return Object.entries(object(current?.headers) ?? {}).flatMap(([name, value]): RouteMutation[] =>
    Object.entries(backup.ownedHeaders).some(([ownedName, ownedValue]) => name.toLowerCase() === ownedName.toLowerCase() && value === ownedValue)
      ? [{ op: 'unset', path: ['providers', 'github-copilot', 'headers', name] }] : [])
}

/** Raw shape, not schema-resolved defaults, proves whole-profile ownership. */
export function wholeProfileOwned(snapshot: ReturnType<typeof settingsSnapshot>, backup: RouteBackup): boolean {
  if (backup.providerExisted || snapshot.base || snapshot.hasSecrets || !snapshot.raw) return false
  return equalJson(snapshot.raw, {
    ...backup.postimage,
    compat: { supportsStrictMode: false },
    ...Object.keys(backup.ownedHeaders).length === 0 ? {} : { headers: backup.ownedHeaders },
  })
}
