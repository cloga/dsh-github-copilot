import type { AccountModelDescriptor } from './account-model-catalog.ts'

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
