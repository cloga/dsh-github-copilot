import type { AccountModelApi, AccountModelDescriptor } from './account-model-catalog.ts'

export type NativeModelSyncSkipCode = 'NATIVE_API_UNAVAILABLE' | 'NATIVE_API_MISMATCH' | 'NATIVE_INHERITED_API_MISMATCH'
  | 'NATIVE_COMPATIBILITY_UNPROVEN'
  | 'NATIVE_CONTEXT_LIMIT_UNKNOWN' | 'NATIVE_INPUT_LIMIT_UNKNOWN' | 'NATIVE_INPUT_LIMIT_UNSUPPORTED'
  | 'NATIVE_REASONING_UNKNOWN' | 'NATIVE_REASONING_UNSUPPORTED' | 'NATIVE_VISION_SUPPORT_UNKNOWN'
  | 'NATIVE_VISION_MEDIA_TYPES_UNKNOWN' | 'NATIVE_VISION_MEDIA_TYPES_UNSUPPORTED'

export interface NativeModelProfile {
  readonly id: string
}

export interface NativeModelSyncPreview {
  readonly enabledCount: number
  readonly syncableCount: number
  readonly models: readonly NativeModelProfile[]
  readonly outputTokenDefaults: readonly { readonly id: string; readonly maxTokens: number }[]
  readonly addedIds: readonly string[]
  readonly removedIds: readonly string[]
  readonly updatedIds: readonly string[]
  readonly skipped: readonly { readonly id: string; readonly code: NativeModelSyncSkipCode }[]
  readonly nativeCatalogMissingIds: readonly string[]
}

export interface NativeCatalogModel {
  readonly id: string
  readonly api: string
}

export interface NativeModelSyncInput {
  readonly accountModels: readonly AccountModelDescriptor[]
  readonly excludedModelIds: ReadonlySet<string>
  readonly currentModels: readonly Readonly<Record<string, unknown>>[]
  readonly currentModelsUseCatalog: boolean
  readonly nativeCatalog: readonly NativeCatalogModel[]
}

export type NativeModelSyncRouteApiPlan =
  | { readonly state: 'ready'; readonly changed: false }
  | { readonly state: 'ready'; readonly changed: true; readonly api: AccountModelApi }
  | {
    readonly state: 'blocked'
    readonly code: 'NATIVE_MODEL_SYNC_ROUTE_API_UNPROVEN' | 'NATIVE_MODEL_SYNC_ROUTE_API_CONFLICT'
    readonly changed: false
  }

export function planNativeModelSyncRouteApi(input: {
  readonly accountModels: readonly AccountModelDescriptor[]
  readonly models: readonly NativeModelProfile[]
  readonly currentApi: string | undefined
  readonly nativeCatalog: readonly NativeCatalogModel[]
}): NativeModelSyncRouteApiPlan {
  const accountById = new Map(input.accountModels.map(model => [model.id, model]))
  const nativeById = new Map(input.nativeCatalog.map(model => [model.id, model]))
  const foundModels = input.models.map(({ id }) => accountById.get(id))
  if (foundModels.length === 0 || foundModels.some(model => model === undefined)) {
    return { state: 'blocked', code: 'NATIVE_MODEL_SYNC_ROUTE_API_UNPROVEN', changed: false }
  }
  const targetModels = foundModels.filter((model): model is AccountModelDescriptor => model !== undefined)

  if (input.currentApi !== undefined) {
    if (targetModels.some(model => model.api !== input.currentApi)
      || input.models.some(({ id }) => {
        const native = nativeById.get(id)
        return native !== undefined && native.api !== input.currentApi
      })) {
      return { state: 'blocked', code: 'NATIVE_MODEL_SYNC_ROUTE_API_CONFLICT', changed: false }
    }
    return { state: 'ready', changed: false }
  }

  const missingNativeModel = input.models.some(({ id }) => !nativeById.has(id))
  if (!missingNativeModel) return { state: 'ready', changed: false }

  const apis = new Set(targetModels.map(model => model.api))
  if (apis.size !== 1) return { state: 'blocked', code: 'NATIVE_MODEL_SYNC_ROUTE_API_UNPROVEN', changed: false }
  const api = targetModels[0]?.api
  if (api === undefined) return { state: 'blocked', code: 'NATIVE_MODEL_SYNC_ROUTE_API_UNPROVEN', changed: false }
  if (input.models.some(({ id }) => {
    const native = nativeById.get(id)
    return native !== undefined && native.api !== api
  })) {
    return { state: 'blocked', code: 'NATIVE_MODEL_SYNC_ROUTE_API_CONFLICT', changed: false }
  }
  return { state: 'ready', api, changed: true }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function emptyNativeCompatibility(value: unknown, depth = 0): boolean {
  if (value === undefined) return true
  if (!isRecord(value) || depth > 3) return false
  const keys = Reflect.ownKeys(value)
  return keys.length <= 64 && keys.every(key => emptyNativeCompatibility(Reflect.get(value, key), depth + 1))
}

export function matchesNativeModelProfile(left: Readonly<Record<string, unknown>>, right: NativeModelProfile): boolean {
  return left.id === right.id && Object.keys(left).every(key => key === 'id'
    || key === 'compat' && emptyNativeCompatibility(left.compat)
    || key === 'input' && Array.isArray(left.input) && left.input.length === 0)
}

/** Submit enabled account IDs; native configuration owns definitions and validation. */
export function planNativeModelSync(input: NativeModelSyncInput): NativeModelSyncPreview {
  if (input.nativeCatalog.length > 512) throw new Error('NATIVE_MODEL_SYNC_SETTINGS_INVALID')
  const staticById = new Map(input.nativeCatalog.map(model => [model.id, model]))
  if (staticById.size !== input.nativeCatalog.length) throw new Error('NATIVE_MODEL_SYNC_SETTINGS_INVALID')
  const currentById = new Map<string, Readonly<Record<string, unknown>>>()
  const currentEntries = input.currentModelsUseCatalog
    ? input.nativeCatalog.map(({ id }) => ({ id }))
    : input.currentModels
  for (const entry of currentEntries) {
    if (typeof entry.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/u.test(entry.id)
      || currentById.has(entry.id)) {
      throw new Error('NATIVE_MODEL_SYNC_SETTINGS_INVALID')
    }
    currentById.set(entry.id, entry)
  }

  const enabled = input.accountModels.filter(model => !input.excludedModelIds.has(model.id))
  const models = enabled.map(({ id }) => ({ id }))

  const targetById = new Map(models.map(model => [model.id, model]))
  const addedIds = models.filter(model => !currentById.has(model.id)).map(model => model.id)
  const removedIds = [...currentById.keys()].filter(id => !targetById.has(id))
  const updatedIds = models.filter(model => {
    const current = currentById.get(model.id)
    return current !== undefined && !matchesNativeModelProfile(current, model)
  }).map(model => model.id)
  return {
    enabledCount: enabled.length,
    syncableCount: models.length,
    models,
    outputTokenDefaults: [],
    addedIds,
    removedIds,
    updatedIds,
    skipped: [],
    nativeCatalogMissingIds: models.filter(model => !staticById.has(model.id)).map(model => model.id),
  }
}
