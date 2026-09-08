import { describe, expect, it } from 'vitest'
import { Config } from '../src/config.ts'
import type { InlineConfig } from '../src/config.ts'

const base: InlineConfig = { enabled: true, providers: [], includeSources: true, stripServerTools: true,
  idleTimeoutMs: 300_000, probe: true, probeTimeoutMs: 30_000 }

describe('account model cache settings', () => {
  it('defaults to a day of metadata reuse and five minutes between passive failure retries', () => {
    expect(Config(base)).toMatchObject({ accountModelTtlMs: 86_400_000, accountModelFailureCooldownMs: 300_000 })
  })

  it.each(['accountModelTtlMs', 'accountModelFailureCooldownMs'] as const)('accepts bounded integer durations for %s', key => {
    for (const value of [0, 1, 86_400_000, 2_147_483_647]) expect(Config({ ...base, [key]: value })[key]).toBe(value)
  })

  it.each(['accountModelTtlMs', 'accountModelFailureCooldownMs'] as const)('rejects unsafe durations for %s', key => {
    for (const value of [-1, 0.5, Number.NaN, Infinity, 2_147_483_648]) expect(() => Config({ ...base, [key]: value })).toThrow()
  })
})
