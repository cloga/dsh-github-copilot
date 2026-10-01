import { autoModelPreference } from './copilot-identity.ts'

export const MAX_EXCLUDED_MODEL_IDS = 512
const MAX_MODEL_ID_LENGTH = 512

export function normalizeExcludedModelIds(value: unknown): readonly string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > MAX_EXCLUDED_MODEL_IDS) {
    throw new Error('COPILOT_MODEL_EXCLUSIONS_INVALID')
  }
  const ids = new Set<string>()
  for (const candidate of value) {
    if (typeof candidate !== 'string' || candidate.length === 0 || candidate.length > MAX_MODEL_ID_LENGTH
      || candidate.trim() !== candidate || autoModelPreference(candidate) !== undefined) {
      throw new Error('COPILOT_MODEL_EXCLUSIONS_INVALID')
    }
    ids.add(candidate)
  }
  return [...ids].toSorted()
}

export function excludedModelSet(value: unknown): ReadonlySet<string> {
  return new Set(normalizeExcludedModelIds(value))
}

export function filterExcludedModels<T extends { readonly id: string }>(
  models: readonly T[],
  value: unknown,
): readonly T[] {
  const excluded = excludedModelSet(value)
  return models.filter(model => !excluded.has(model.id))
}
