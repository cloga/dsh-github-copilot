import { describe, expect, it } from 'vitest'
import { allocateAutoModel, AutoAllocationSchema } from '../src/auto-allocation.ts'

describe('positive weighted Auto allocation', () => {
  const pool = [{ id: 'ordinary' }, { id: 'marked' }]

  it('defers a marked previous model whenever an unmarked fitting peer participates', () => {
    for (let seed = 0; seed < 1000; seed++) {
      const result = allocateAutoModel(pool, ['marked'], 'marked', seed)
      expect(result.selectedModelId).toBe('ordinary')
      expect(result.deferredHighCostCount).toBe(1)
    }
  })
  it('does not grant continuity to a high-cost model in a marked-only pool', () => {
    const result = allocateAutoModel(pool, ['ordinary', 'marked'], 'marked', 42)
    expect(result.candidates.map(row => row.expectedShare)).toEqual([0.5, 0.5])
  })

  it('keeps marking orthogonal and captures finite continuity weights', () => {
    const allocation = allocateAutoModel(pool, ['marked'], 'marked', 42)
    expect(allocation.policyVersion).toBe('high-cost-v2')
    expect(allocation.deferredHighCostCount).toBe(1)
    expect(allocation.candidates).toEqual([
      { modelId: 'ordinary', highCost: false, previous: false, weight: 1, expectedShare: 1 },
    ])
    expect(AutoAllocationSchema.safeParse(allocation).success).toBe(true)
    expect(allocateAutoModel([{ id: 'marked' }], ['marked'], undefined, 0).selectedModelId).toBe('marked')
    expect(allocateAutoModel(pool, ['ordinary', 'marked'], undefined, 0).candidates.map(row => row.expectedShare))
      .toEqual([0.5, 0.5])
  })

  it('simulates 20000 turns per previous state without selecting a deferred high-cost peer', () => {
    for (const previous of [undefined, 'marked', 'ordinary']) {
      const counts = new Map<string, number>()
      for (let seed = 0; seed < 20_000; seed++) {
        const result = allocateAutoModel(pool, ['marked'], previous, seed)
        counts.set(result.selectedModelId, (counts.get(result.selectedModelId) ?? 0) + 1)
        expect(allocateAutoModel(pool, ['marked'], previous, seed)).toEqual(result)
      }
      expect(counts.get('marked') ?? 0).toBe(0)
      expect(counts.get('ordinary')).toBe(20_000)
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
