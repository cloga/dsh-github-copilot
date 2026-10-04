import { describe, expect, it } from 'vitest'
import { TurnSelectionStore, TurnSelectionSchema } from '../src/turn-selection.ts'
describe('ephemeral turn selection evidence', () => {
  it('isolates agents/turns, freezes retries and clears on disposal without durable events', () => {
    const store = new TurnSelectionStore(), a = {}, b = {}
    store.record(a, 1, { mode: 'auto', preference: 'balance', reason: 'standard-turn', candidateCount: 2 })
    store.record(a, 1, { mode: 'manual' })
    expect(store.get(a, 1).mode).toBe('auto')
    expect(store.get(b, 1)).toEqual({ mode: 'unknown' })
    expect(store.get(a, 2)).toEqual({ mode: 'unknown' })
    store.remove(a); expect(store.get(a, 1)).toEqual({ mode: 'unknown' })
  })
  it('bounds retained history and reports eviction/restart as unknown, not manual', () => {
    const store = new TurnSelectionStore(), agent = {}
    for (let turn = 0; turn < 129; turn++) store.record(agent, turn, { mode: 'manual' })
    expect(store.get(agent, 0).mode).toBe('unknown')
    expect(store.get(agent, 128).mode).toBe('manual')
    store.clear(); expect(store.get(agent, 128).mode).toBe('unknown')
    expect(() => store.get(agent, -1)).toThrow('INVALID_TURN')
  })
  it('validates strict credential-free result codecs', () => {
    expect(TurnSelectionSchema.safeParse({ mode: 'manual', model: 'invented' }).success).toBe(false)
    expect(TurnSelectionSchema.safeParse({ mode: 'auto', preference: 'balance', reason: 'invented', candidateCount: 2 }).success).toBe(false)
  })
  it('strictly decodes detailed explanations and copies frozen evidence without retaining caller arrays', () => {
    const selection = { mode: 'auto', preference: 'intelligence', reason: 'short-text-turn', candidateCount: 3,
      fittingCandidateCount: 2, explanation: {
        assessment: { demand: 'simple', source: 'local', signals: ['isolated-greeting'] },
        targetCategory: 'lightweight', selectedCategory: 'lightweight', categoryCandidateCount: 1,
        method: 'only-candidate', fallback: false,
      } } as const
    expect(TurnSelectionSchema.safeParse(selection).success).toBe(true)
    expect(TurnSelectionSchema.safeParse({ ...selection, explanation: { ...selection.explanation, model: 'invented' } }).success).toBe(false)
    expect(TurnSelectionSchema.safeParse({ ...selection, explanation: { ...selection.explanation,
      assessment: { ...selection.explanation.assessment, demand: 'invented' } } }).success).toBe(false)
    const store = new TurnSelectionStore(), agent = {}
    store.record(agent, 1, selection)
    const value = store.get(agent, 1)
    expect(value).toEqual(selection)
    if (value.mode !== 'auto') throw new Error('EXPECTED_AUTO')
    expect(value.explanation).not.toBe(selection.explanation)
    expect(Object.isFrozen(value.explanation?.assessment.signals)).toBe(true)
  })
  it('evicts old agents without mixing their records', () => {
    const store = new TurnSelectionStore(), first = {}
    store.record(first, 1, { mode: 'manual' })
    for (let i = 0; i < 64; i++) store.record({}, 1, { mode: 'manual' })
    expect(store.get(first, 1)).toEqual({ mode: 'unknown' })
  })
  it('strictly decodes, copies and freezes semantic evidence while retaining legacy explanations', () => {
    const semantic = { modelId: 'aux-fixture', budgetMs: 8000, elapsedMs: 8001, stage: 'adapter-started' as const,
      adapterStartedMs: 100, outputCharacters: 0, validation: 'not-validated' as const }
    const selection = { mode: 'auto', preference: 'intelligence', reason: 'standard-turn', candidateCount: 2,
      explanation: { assessment: { demand: 'unknown', source: 'local', signals: [], diagnostic: 'timeout', semantic },
        targetCategory: 'powerful', selectedCategory: 'powerful', categoryCandidateCount: 2,
        method: 'equal-distribution', fallback: false } } as const
    expect(TurnSelectionSchema.safeParse(selection).success).toBe(true)
    expect(TurnSelectionSchema.safeParse({ ...selection, explanation: { ...selection.explanation,
      assessment: { ...selection.explanation.assessment, semantic: { ...semantic, raw: 'SECRET' } } } }).success).toBe(false)
    const store = new TurnSelectionStore(), agent = {}
    store.record(agent, 1, selection)
    semantic.elapsedMs = 9000
    const stored = store.get(agent, 1)
    if (stored.mode !== 'auto') throw new Error('EXPECTED_AUTO')
    expect(stored.explanation?.assessment.semantic?.elapsedMs).toBe(8001)
    expect(Object.isFrozen(stored.explanation?.assessment.semantic)).toBe(true)
  })
})
