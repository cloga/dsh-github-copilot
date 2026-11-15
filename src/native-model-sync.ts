import type { ImageMediaType } from '@deepseek-ai/dsh-attachment'
import type { AccountModelDescriptor } from './account-model-catalog.ts'

export type NativeModelSyncSkipCode = 'NATIVE_API_UNAVAILABLE' | 'NATIVE_API_MISMATCH' | 'NATIVE_INHERITED_API_MISMATCH'
  | 'NATIVE_COMPATIBILITY_UNPROVEN'
  | 'NATIVE_CONTEXT_LIMIT_UNKNOWN' | 'NATIVE_INPUT_LIMIT_UNKNOWN' | 'NATIVE_INPUT_LIMIT_UNSUPPORTED'
  | 'NATIVE_REASONING_UNKNOWN' | 'NATIVE_REASONING_UNSUPPORTED' | 'NATIVE_VISION_SUPPORT_UNKNOWN'
  | 'NATIVE_VISION_MEDIA_TYPES_UNKNOWN' | 'NATIVE_VISION_MEDIA_TYPES_UNSUPPORTED'

export interface NativeModelProfile {
  readonly id: string
  readonly name: string
  readonly contextWindow: number
  readonly maxTokens: number
  readonly input: readonly ('text' | 'image')[]
  readonly reasoningEfforts: false | Readonly<Record<string, string | null>>
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
  readonly routeApi?: string
  readonly routeReasoning?: string
  readonly nativeCatalog: readonly NativeCatalogModel[]
}

const nativeImageMediaTypes = {
  'image/png': true, 'image/jpeg': true, 'image/webp': true, 'image/gif': true,
} satisfies Record<ImageMediaType, true>

function profileFor(model: AccountModelDescriptor): NativeModelProfile {
  const efforts = model.reasoning.advertisedEfforts.filter(effort => effort !== 'off')
  return {
    id: model.id,
    name: model.name,
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    input: [...model.input],
    reasoningEfforts: efforts.length === 0 ? false
      : Object.fromEntries(efforts.map(effort => [effort, effort])),
  }
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
  const leftInput = left.input
  const leftEfforts = left.reasoningEfforts
  const rightEfforts = right.reasoningEfforts
  const leftKeys = Object.keys(left).filter(key => key !== 'compat' || !emptyNativeCompatibility(left.compat)).sort()
  const rightKeys = Object.keys(right).sort()
  const effortsMatch = leftEfforts === false && rightEfforts === false
    || isRecord(leftEfforts) && isRecord(rightEfforts)
      && Object.keys(leftEfforts).length === Object.keys(rightEfforts).length
      && Object.entries(rightEfforts).every(([key, value]) => leftEfforts[key] === value)
  return leftKeys.length === rightKeys.length && rightKeys.every((key, index) => leftKeys[index] === key)
    && left.id === right.id && left.name === right.name
    && left.contextWindow === right.contextWindow && left.maxTokens === right.maxTokens
    && Array.isArray(leftInput) && leftInput.length === right.input.length
    && right.input.every((value, index) => leftInput[index] === value)
    && effortsMatch
}

/** Build a safe one-protocol native model snapshot; unsupported metadata is reported, never guessed. */
export function planNativeModelSync(input: NativeModelSyncInput): NativeModelSyncPreview {
  if (input.nativeCatalog.length > 512) throw new Error('NATIVE_MODEL_SYNC_SETTINGS_INVALID')
  const staticById = new Map(input.nativeCatalog.map(model => [model.id, model]))
  if (staticById.size !== input.nativeCatalog.length) throw new Error('NATIVE_MODEL_SYNC_SETTINGS_INVALID')
  const catalogApis = new Set(input.nativeCatalog.map(model => model.api))
  const catalogApi = catalogApis.size === 1 ? [...catalogApis][0] : undefined
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

  const models: NativeModelProfile[] = []
  const skipped: { id: string; code: NativeModelSyncSkipCode }[] = []
  const enabled = input.accountModels.filter(model => !input.excludedModelIds.has(model.id))
  for (const model of enabled) {
    const nativeModel = staticById.get(model.id)
    const nativeApi = input.routeApi ?? nativeModel?.api ?? catalogApi
    if (nativeApi === undefined) {
      skipped.push({ id: model.id, code: 'NATIVE_API_UNAVAILABLE' })
      continue
    }
    if (nativeApi !== model.api) {
      skipped.push({ id: model.id, code: 'NATIVE_API_MISMATCH' })
      continue
    }
    if (nativeModel !== undefined && nativeModel.api !== nativeApi) {
      skipped.push({ id: model.id, code: 'NATIVE_INHERITED_API_MISMATCH' })
      continue
    }
    if (model.evidence.contextWindowSource !== 'max_context_window_tokens') {
      skipped.push({ id: model.id, code: 'NATIVE_CONTEXT_LIMIT_UNKNOWN' })
      continue
    }
    if (model.maxInputTokens === undefined) {
      skipped.push({ id: model.id, code: 'NATIVE_INPUT_LIMIT_UNKNOWN' })
      continue
    }
    if (model.maxInputTokens < model.contextWindow) {
      skipped.push({ id: model.id, code: 'NATIVE_INPUT_LIMIT_UNSUPPORTED' })
      continue
    }
    if (model.evidence.visionSupportKnown !== true) {
      skipped.push({ id: model.id, code: 'NATIVE_VISION_SUPPORT_UNKNOWN' })
      continue
    }
    if (model.input.includes('image')) {
      const supported = model.evidence.visionMediaTypes
      if (supported === undefined || !Object.keys(nativeImageMediaTypes).every(type => supported.includes(type))) {
        skipped.push({ id: model.id, code: supported === undefined
          ? 'NATIVE_VISION_MEDIA_TYPES_UNKNOWN' : 'NATIVE_VISION_MEDIA_TYPES_UNSUPPORTED' })
        continue
      }
    }
    const reasoning = model.reasoning
    if (reasoning.advertisedEfforts.length === 0 && model.evidence.reasoningEffortsKnown !== true) {
      skipped.push({ id: model.id, code: 'NATIVE_REASONING_UNKNOWN' })
      continue
    }
    if (reasoning.unmappedEfforts.length > 0 || reasoning.adaptiveThinking === true
      || reasoning.minThinkingBudget !== undefined || reasoning.maxThinkingBudget !== undefined
      || reasoning.advertisedEfforts.length > 0 && reasoning.advertisedEfforts.every(effort => effort === 'off')
      || model.api !== 'openai-responses' && reasoning.advertisedEfforts.length > 0
      || input.routeReasoning !== undefined && !(reasoning.advertisedEfforts.length === 0
        ? input.routeReasoning === 'off' : input.routeReasoning !== 'off' && reasoning.advertisedEfforts.includes(input.routeReasoning))) {
      skipped.push({ id: model.id, code: 'NATIVE_REASONING_UNSUPPORTED' })
      continue
    }
    // Core's non-Responses defaults differ from the managed adapter when no native entry exists.
    if (nativeModel === undefined && model.api !== 'openai-responses') {
      skipped.push({ id: model.id, code: 'NATIVE_COMPATIBILITY_UNPROVEN' })
      continue
    }
    models.push(profileFor(model))
  }

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
    outputTokenDefaults: models.map(({ id, maxTokens }) => ({ id, maxTokens })),
    addedIds,
    removedIds,
    updatedIds,
    skipped,
  }
}
