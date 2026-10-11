import { describe, expect, it } from 'vitest'
import { allocateAutoModel, AutoAllocationSchema } from '../src/auto-allocation.ts'

describe('positive weighted Auto allocation', () => {
  const pool = [{ id: 'ordinary' }, { id: 'marked' }]

  it('decays a marked previous model tenfold without eliminating its opportunity', () => {
    const first = allocateAutoModel(pool, ['marked'], 'ordinary', 42)
    const repeat = allocateAutoModel(pool, ['marked'], 'marked', 42)
    expect(first.candidates[1]).toMatchObject({ weight: 0.2, expectedShare: 2 / 17 })
    expect(repeat.candidates[1]).toMatchObject({ weight: 0.02, expectedShare: 1 / 51 })
    expect(repeat.deferredHighCostCount).toBeUndefined()
  })
  it('decays a high-cost previous model in a marked-only pool without making it unavailable', () => {
    const result = allocateAutoModel(pool, ['ordinary', 'marked'], 'marked', 42)
    expect(result.candidates.map(row => row.expectedShare)).toEqual([10 / 11, 1 / 11])
  })

  it('keeps marking orthogonal and captures finite continuity weights', () => {
    const allocation = allocateAutoModel(pool, ['marked'], 'marked', 42)
    expect(allocation.policyVersion).toBe('high-cost-v3')
    expect(allocation.deferredHighCostCount).toBeUndefined()
    expect(allocation.candidates).toEqual([
      { modelId: 'ordinary', highCost: false, previous: false, weight: 1, expectedShare: 50 / 51 },
      { modelId: 'marked', highCost: true, previous: true, weight: 0.02, expectedShare: 1 / 51 },
    ])
    expect(AutoAllocationSchema.safeParse(allocation).success).toBe(true)
    expect(allocateAutoModel([{ id: 'marked' }], ['marked'], undefined, 0).selectedModelId).toBe('marked')
    expect(allocateAutoModel(pool, ['ordinary', 'marked'], undefined, 0).candidates.map(row => row.expectedShare))
      .toEqual([0.5, 0.5])
  })

  it('simulates 20000 turns per previous state with positive cost-decayed opportunity', () => {
    for (const previous of [undefined, 'marked', 'ordinary']) {
      const counts = new Map<string, number>()
      let expected = 0
      for (let seed = 0; seed < 20_000; seed++) {
        const result = allocateAutoModel(pool, ['marked'], previous, seed)
        counts.set(result.selectedModelId, (counts.get(result.selectedModelId) ?? 0) + 1)
        expected += result.candidates[1]!.expectedShare
        expect(allocateAutoModel(pool, ['marked'], previous, seed)).toEqual(result)
      }
      expect(counts.get('marked')).toBeGreaterThan(0)
      expect(Math.abs(counts.get('marked')! - expected) / 20_000).toBeLessThan(0.01)
    }
  })

  it('rejects invalid/duplicate pools, reserved IDs, malformed markings and nonfinite seeds', () => {
    for (const rows of [[], [{ id: 'same' }, { id: 'same' }]]) {
      expect(() => allocateAutoModel(rows, [], undefined, 0)).toThrow('COPILOT_AUTO_ALLOCATION_INVALID')
    }
    expect(() => allocateAutoModel([{ id: 'auto' }], [], undefined, 0)).toThrow()
    expect(() => allocateAutoModel(pool, ['auto'], undefined, 0)).toThrow()
    expect(() => allocateAutoModel(pool, [], undefined, NaN)).toThrow('COPILOT_AUTO_ALLOCATION_INVALID')
  })

  it('rejects contradictory selection, marking, share and continuity evidence', () => {
    const result = AutoAllocationSchema.parse(allocateAutoModel(pool, ['ordinary', 'marked'], 'marked', 42))
    for (const mutate of [
      (value: typeof result) => { value.selectedModelId = 'outside-pool' },
      (value: typeof result) => { value.candidates[1]!.modelId = 'ordinary' },
      (value: typeof result) => { value.candidates[1]!.weight = 1 },
      (value: typeof result) => { value.candidates[1]!.expectedShare = 0.8 },
      (value: typeof result) => { value.candidates[0]!.previous = true },
    ]) {
      const value = structuredClone(result); mutate(value)
      expect(AutoAllocationSchema.safeParse(value).success).toBe(false)
    }
  })

  it('keeps v1 historical weights readable without relabeling them as v2', () => {
    const legacy = { policyVersion: 'high-cost-v1', selectedModelId: 'marked', candidates: [
      { modelId: 'ordinary', highCost: false, previous: false, weight: 1, expectedShare: 10 / 13 },
      { modelId: 'marked', highCost: true, previous: true, weight: 0.3, expectedShare: 3 / 13 },
    ] }
    expect(AutoAllocationSchema.parse(legacy)).toEqual(legacy)
    expect(AutoAllocationSchema.safeParse({ ...legacy, policyVersion: 'high-cost-v2', deferredHighCostCount: 0 }).success).toBe(false)
  })

  it('keeps v2 hard-deferral evidence readable without relabeling it as v3', () => {
    const legacy = { policyVersion: 'high-cost-v2', deferredHighCostCount: 1,
      selectedModelId: 'ordinary', candidates: [
        { modelId: 'ordinary', highCost: false, previous: false, weight: 1, expectedShare: 1 },
      ] }
    expect(AutoAllocationSchema.parse(legacy)).toEqual(legacy)
    expect(AutoAllocationSchema.safeParse({ ...legacy, policyVersion: 'high-cost-v3' }).success).toBe(false)
  })

  it('resets decay after a different model and never penalizes other marked peers', () => {
    const models = [{ id: 'ordinary' }, { id: 'marked' }, { id: 'other-marked' }]
    const repeat = allocateAutoModel(models, ['marked', 'other-marked'], 'marked', 42)
    expect(repeat.candidates.map(row => row.weight)).toEqual([1, 0.02, 0.2])
    const reset = allocateAutoModel(models, ['marked', 'other-marked'], 'ordinary', 42)
    expect(reset.candidates.map(row => row.weight)).toEqual([1.5, 0.2, 0.2])
    const lone = allocateAutoModel([{ id: 'marked' }], ['marked'], 'marked', 42)
    expect(lone.candidates[0]).toMatchObject({ weight: 0.02, expectedShare: 1 })
    expect(lone.selectedModelId).toBe('marked')
  })

  it('simulates sequential selections with a captured previous-model update rather than independent fixed-previous draws', () => {
    let previous: string | undefined = 'ordinary'
    let hits = 0, pairs = 0, expected = 0, repeatExpected = 0, repeatHits = 0
    for (let seed = 0; seed < 100_000; seed++) {
      const result = allocateAutoModel(pool, ['marked'], previous, seed)
      const share = result.candidates[1]!.expectedShare
      expected += share
      const selected = result.selectedModelId === 'marked'
      if (previous === 'marked') { repeatExpected += share; if (selected) { pairs++; repeatHits++ } }
      if (selected) hits++
      previous = result.selectedModelId
    }
    expect(hits).toBeGreaterThan(0)
    expect(pairs).toBeGreaterThan(0)
    expect(pairs / hits).toBeLessThan(0.03)
    expect(Math.abs(hits - expected) / 100_000).toBeLessThan(0.005)
    expect(Math.abs(repeatHits - repeatExpected) / hits).toBeLessThan(0.01)
  })

  it.each([{ marks: [] }, { marks: ['ordinary', 'marked'] }])('preserves positive within-tier distribution without marked continuity ($marks)', ({ marks }) => {
    const counts = new Map<string, number>()
    let expected = 0
    for (let seed = 0; seed < 20_000; seed++) {
      const result = allocateAutoModel(pool, marks, 'marked', seed)
      counts.set(result.selectedModelId, (counts.get(result.selectedModelId) ?? 0) + 1)
      expected += result.candidates[1]!.expectedShare
    }
    expect(Math.abs((counts.get('marked') ?? 0) - expected) / 20_000).toBeLessThan(0.02)
    expect(counts.get('ordinary')).toBeGreaterThan(0)
    expect(counts.get('marked')).toBeGreaterThan(0)
  })
})
