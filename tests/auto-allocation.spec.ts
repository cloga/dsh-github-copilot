import { describe, expect, it } from 'vitest'
import { allocateAutoModel, AutoAllocationSchema } from '../src/auto-allocation.ts'

describe('positive weighted Auto allocation', () => {
  const pool = [{ id: 'ordinary' }, { id: 'marked' }]

  it('keeps marking orthogonal and captures finite continuity weights', () => {
    const allocation = allocateAutoModel(pool, ['marked'], 'marked', 42)
    expect(allocation.policyVersion).toBe('high-cost-v1')
    expect(allocation.candidates).toEqual([
      { modelId: 'ordinary', highCost: false, previous: false, weight: 1, expectedShare: 10 / 13 },
      { modelId: 'marked', highCost: true, previous: true, weight: 0.3, expectedShare: 3 / 13 },
    ])
    expect(AutoAllocationSchema.safeParse(allocation).success).toBe(true)
    expect(allocateAutoModel([{ id: 'marked' }], ['marked'], undefined, 0).selectedModelId).toBe('marked')
    expect(allocateAutoModel(pool, ['ordinary', 'marked'], undefined, 0).candidates.map(row => row.expectedShare))
      .toEqual([0.5, 0.5])
  })

  it('gives every candidate opportunity without an absolute previous-model shortcut', () => {
    for (const previous of [undefined, 'marked', 'ordinary']) {
      const counts = new Map<string, number>()
      let expectedMarked = 0
      for (let seed = 0; seed < 20_000; seed++) {
        const result = allocateAutoModel(pool, ['marked'], previous, seed)
        counts.set(result.selectedModelId, (counts.get(result.selectedModelId) ?? 0) + 1)
        expectedMarked += result.candidates.find(row => row.modelId === 'marked')!.expectedShare
        expect(allocateAutoModel(pool, ['marked'], previous, seed)).toEqual(result)
      }
      expect(counts.get('marked')).toBeGreaterThan(0)
      expect(counts.get('ordinary')).toBeGreaterThan(counts.get('marked')!)
      expect(Math.abs(counts.get('marked')! - expectedMarked) / 20_000).toBeLessThan(0.02)
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
    const result = AutoAllocationSchema.parse(allocateAutoModel(pool, ['marked'], 'marked', 42))
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
})
