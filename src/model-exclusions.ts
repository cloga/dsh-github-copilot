import { autoModelPreference } from './copilot-identity.ts'

export const MAX_EXCLUDED_MODEL_IDS = 512
const MAX_MODEL_ID_LENGTH = 512

/** Admission is bound to the native turn and its request signal, not the global picker. */
export class ModelExclusionTurns {
  private readonly turns = new WeakMap<object, { turn: number; model: string }>()
  private readonly signals = new WeakMap<AbortSignal, { owner: object; turn: number; model: string }>()

  admit(owner: object, turn: number, model: string, signal: AbortSignal, excluded: ReadonlySet<string>): boolean {
    const previous = this.turns.get(owner)
    if (signal.aborted || excluded.has(model) && (previous?.turn !== turn || previous.model !== model)) {
      if (previous?.turn !== turn) this.turns.delete(owner)
      return false
    }
    this.turns.set(owner, { turn, model })
    this.signals.set(signal, { owner, turn, model })
    return true
  }

  permits(signal: AbortSignal | undefined, model: string): boolean {
    if (signal === undefined || signal.aborted) return false
    const admitted = this.signals.get(signal)
    if (admitted?.model !== model) return false
    const current = this.turns.get(admitted.owner)
    return current?.turn === admitted.turn && current.model === model
  }

  end(owner: object): void {
    this.turns.delete(owner)
  }
}

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
