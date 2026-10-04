import { describe, expect, it } from 'vitest'
import {
  filterExcludedModels,
  normalizeExcludedModelIds,
  ModelExclusionTurns,
} from '../src/model-exclusions.ts'

describe('model exclusions', () => {
  it('keeps an admitted turn on its model but rejects that model on the next turn', () => {
    const turns = new ModelExclusionTurns()
    const owner = {}
    const first = new AbortController()
    expect(turns.admit(owner, 1, 'model-a', first.signal, new Set())).toBe(true)
    const excluded = new Set(['model-a'])
    const nextStep = new AbortController()
    expect(turns.admit(owner, 1, 'model-a', nextStep.signal, excluded)).toBe(true)
    expect(turns.permits(nextStep.signal, 'model-a')).toBe(true)
    expect(turns.permits(nextStep.signal, 'model-b')).toBe(false)
    expect(turns.permits(new AbortController().signal, 'model-a')).toBe(false)
    nextStep.abort()
    expect(turns.permits(nextStep.signal, 'model-a')).toBe(false)
    expect(turns.admit(owner, 2, 'model-a', new AbortController().signal, excluded)).toBe(false)
    expect(turns.admit({}, 1, 'model-a', new AbortController().signal, excluded)).toBe(false)
    expect(turns.admit(owner, 2, 'model-b', new AbortController().signal, excluded)).toBe(true)
    expect(turns.permits(first.signal, 'model-a')).toBe(false)
    const last = new AbortController()
    expect(turns.admit(owner, 2, 'model-b', last.signal, excluded)).toBe(true)
    turns.end(owner)
    expect(turns.permits(last.signal, 'model-b')).toBe(false)
  })
  it('normalizes exact IDs deterministically and preserves temporarily absent intent', () => {
    expect(normalizeExcludedModelIds(['future-z', 'current-a', 'future-z']))
      .toEqual(['current-a', 'future-z'])
    expect(filterExcludedModels([{ id: 'current-a' }, { id: 'current-b' }],
      ['future-z', 'current-a'])).toEqual([{ id: 'current-b' }])
  })

  it.each([
    ' auto',
    'auto',
    '',
    'model ',
  ])('rejects invalid or virtual model IDs: %j', id => {
    expect(() => normalizeExcludedModelIds([id])).toThrow('COPILOT_MODEL_EXCLUSIONS_INVALID')
  })
})
