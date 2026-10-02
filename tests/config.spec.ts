import { describe, expect, it } from 'vitest'
import { Config, readInlineConfig } from '../src/config.ts'
import type { InlineConfig } from '../src/config.ts'

const base: InlineConfig = { enabled: true, providers: [], includeSources: true, stripServerTools: true,
  idleTimeoutMs: 300_000, probe: true, probeTimeoutMs: 30_000 }

describe('session search settings', () => {
  it('defaults to session routing with automatic disclosed DeepSeek fallback', () => {
    expect(Config(base)).toMatchObject({ routeWebSearch: true, searchFallback: 'deepseek' })
  })

  it('allows disabling fallback or the routing feature and configuring an independent search model', () => {
    expect(readInlineConfig(Config({ ...base, routeWebSearch: false, searchFallback: 'none', searchModel: 'gpt-5.6-sol' }))).toMatchObject({
      ...base, routeWebSearch: false, searchFallback: 'none', searchModel: 'gpt-5.6-sol',
    })
  })

  it('rejects an unrecognized fallback instead of treating it as delegated search', () => {
    const untrusted = { ...base, searchFallback: 'some-global-provider' } as unknown as InlineConfig
    expect(() => Config(untrusted)).toThrow()
  })

  it('projects exclusions, routing, the legacy model override and its ownership journal as live fields', () => {
    expect(Object.entries(Config.dict ?? {}).filter(([, schema]) => schema.meta.volatile).map(([key]) => key))
      .toEqual(['excludedModelIds', 'parentModelFollow', 'searchModel', 'searchRouting', 'temporaryRouteBackup'])
    const parsed = Config({ ...base, searchModel: 'saved-model', temporaryRouteBackup: 'saved-journal' })
    expect(parsed.searchModel.get()).toBe('saved-model')
    expect(parsed.temporaryRouteBackup.get()).toBe('saved-journal')
    expect(parsed.searchRouting.get()).toMatchObject({ defaultSearchProvider: 'deepseek-official' })
    expect(readInlineConfig(parsed)).toMatchObject({ searchModel: 'saved-model', temporaryRouteBackup: 'saved-journal' })
  })

  describe('explicit parent model following', () => {
    it('defaults to no enrolled children and snapshots live binding values', () => {
      expect(readInlineConfig(Config(base)).parentModelFollow).toEqual([])
      const binding = { childSessionId: 'child', parentSessionId: 'parent' }
      const current = readInlineConfig({ ...base, parentModelFollow: { get: () => ({ 0: binding, length: 1 }) } })
      expect(current.parentModelFollow).toEqual([binding])
      binding.parentSessionId = 'changed'
      expect(current.parentModelFollow?.[0]?.parentSessionId).toBe('parent')
    })
    it('rejects empty lineage identities', () => {
      expect(() => Config({ ...base, parentModelFollow: [{ childSessionId: '', parentSessionId: 'parent' }] })).toThrow()
    })
  })

  it('reads each current snapshot rather than freezing live routing at activation', () => {
    let routing = { searchProvider: 'auto', defaultSearchProvider: 'deepseek-official' }
    const live = { ...base, searchRouting: { get: () => routing } }
    expect(readInlineConfig(live).searchRouting?.searchProvider).toBe('auto')
    routing = { searchProvider: 'github-copilot-hosted', defaultSearchProvider: 'none' }
    expect(readInlineConfig(live).searchRouting).toEqual(routing)
    expect(readInlineConfig(base)).toEqual(base)
  })
})

describe('managed request and compaction settings', () => {
  it('defaults to estimated headroom, early pressure and supported low summary effort', () => {
    expect(Config(base)).toMatchObject({ requestBudgetSafetyTokens: 4096, requestBudgetPressureRatio: 0.9, compactionReasoning: 'prefer-low' })
  })
  it('allows explicit headroom and preserving summary reasoning', () => {
    expect(Config({ ...base, requestBudgetSafetyTokens: 6000, requestBudgetPressureRatio: 1, compactionReasoning: 'preserve' })).toMatchObject({
      requestBudgetSafetyTokens: 6000, requestBudgetPressureRatio: 1, compactionReasoning: 'preserve',
    })
  })
  it.each([-1, 0.5, Number.NaN, Infinity])('rejects invalid token allowance %s', value => {
    expect(() => Config({ ...base, requestBudgetSafetyTokens: value })).toThrow()
  })
  it.each([0, -1, 1.1, Number.NaN, Infinity])('rejects invalid pressure fraction %s', value => {
    expect(() => Config({ ...base, requestBudgetPressureRatio: value })).toThrow()
  })
  it('does not accept an unsupported summary reasoning policy', () => {
    expect(() => Config({ ...base, compactionReasoning: 'force-off' } as unknown as InlineConfig)).toThrow()
  })
})

describe('account model cache settings', () => {
  it('defaults to a day of metadata reuse and five minutes between passive failure retries', () => {
    expect(readInlineConfig(Config(base))).toMatchObject({
      accountModelTtlMs: 86_400_000,
      accountModelFailureCooldownMs: 300_000,
      excludedModelIds: [],
    })
  })

  it.each(['accountModelTtlMs', 'accountModelFailureCooldownMs'] as const)('accepts bounded integer durations for %s', key => {
    for (const value of [0, 1, 86_400_000, 2_147_483_647]) expect(Config({ ...base, [key]: value })[key]).toBe(value)
  })

  it.each(['accountModelTtlMs', 'accountModelFailureCooldownMs'] as const)('rejects unsafe durations for %s', key => {
    for (const value of [-1, 0.5, Number.NaN, Infinity, 2_147_483_648]) expect(() => Config({ ...base, [key]: value })).toThrow()
  })
})
