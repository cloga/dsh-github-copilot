import { describe, expect, it } from 'vitest'
import {
  filterExcludedModels,
  normalizeExcludedModelIds,
} from '../src/model-exclusions.ts'

describe('model exclusions', () => {
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
