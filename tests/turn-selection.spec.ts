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
  it('evicts old agents without mixing their records', () => {
    const store = new TurnSelectionStore(), first = {}
    store.record(first, 1, { mode: 'manual' })
    for (let i = 0; i < 64; i++) store.record({}, 1, { mode: 'manual' })
    expect(store.get(first, 1)).toEqual({ mode: 'unknown' })
  })
})
