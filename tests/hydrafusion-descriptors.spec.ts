import { describe, expect, it } from 'vitest'
import { mapHydraFusionDescriptors } from '../src/hydrafusion-descriptors.ts'

describe('HydraFusion session descriptors', () => {
  it('maps only explicitly enabled, picker-visible Fusion tiers and preserves opaque IDs', () => {
    const result = mapHydraFusionDescriptors({
      auto: {
        tiers: [
          { id: 'opaque-standard', type: 'fusion', displayName: 'HydraFusion', description: 'Standard preview', fusionTier: 'standard', status: { enabled: true, pickerVisible: true } },
          { id: 'opaque-max', type: 'fusion', displayName: 'HydraFusion Max', status: { enabled: true } },
          { id: 'disabled', type: 'fusion', displayName: 'Disabled', status: { enabled: false } },
          { id: 'hidden', type: 'fusion', displayName: 'Hidden', status: { enabled: true, pickerVisible: false } },
          { id: 'unknown-enabled', type: 'fusion', displayName: 'Unknown', status: {} },
          { id: 'ordinary-auto', type: 'auto', displayName: 'Auto', status: { enabled: true } },
          { id: 'unknown-kind', type: 'future', displayName: 'Future', status: { enabled: true } },
        ],
      },
    })

    expect(result).toEqual({
      status: 'ready',
      descriptors: [
        { id: 'opaque-standard', displayName: 'HydraFusion', description: 'Standard preview', fusionTier: 'standard' },
        { id: 'opaque-max', displayName: 'HydraFusion Max' },
      ],
      truncated: false,
    })
  })

  it('excludes duplicate opaque IDs and malformed or incomplete descriptors', () => {
    const result = mapHydraFusionDescriptors({ auto: { tiers: [
      { id: 'duplicate', type: 'fusion', displayName: 'First', status: { enabled: true } },
      { id: 'duplicate', type: 'fusion', displayName: 'Second', status: { enabled: true } },
      { id: 'ambiguous', type: 'fusion', displayName: 'Visible', status: { enabled: true } },
      { id: 'ambiguous', type: 'auto', displayName: 'Auto', status: { enabled: true } },
      { id: 'too-long', type: 'fusion', displayName: 'x'.repeat(513), status: { enabled: true } },
      { id: 'bad-description', type: 'fusion', displayName: 'Bad', description: '', status: { enabled: true } },
    ] } })

    expect(result).toEqual({ status: 'unavailable', descriptors: [], truncated: false })
    expect(mapHydraFusionDescriptors({ models: [] })).toEqual({
      status: 'unavailable', descriptors: [], truncated: false,
    })
  })

  it('fails closed on oversized metadata and bounds returned choices', () => {
    const oversized = mapHydraFusionDescriptors({ auto: { tiers: Array.from({ length: 129 }, (_, index) => ({
      id: `opaque-${index}`, type: 'fusion', displayName: 'Tier', status: { enabled: true },
    })) } })
    expect(oversized).toEqual({ status: 'unavailable', descriptors: [], truncated: true })

    const manyChoices = mapHydraFusionDescriptors({ auto: { tiers: Array.from({ length: 33 }, (_, index) => ({
      id: `opaque-${index}`, type: 'fusion', displayName: `Tier ${index}`, status: { enabled: true },
    })) } })
    expect(manyChoices.status).toBe('ready')
    expect(manyChoices.descriptors).toHaveLength(32)
    expect(manyChoices.truncated).toBe(true)
  })
})
