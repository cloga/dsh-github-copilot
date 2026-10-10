import { describe, expect, it } from 'vitest'
import { Config, readInlineConfig } from '../src/config.ts'
import type { InlineConfig } from '../src/config.ts'

const base: InlineConfig = { enabled: true, providers: [], includeSources: true, stripServerTools: true,
  idleTimeoutMs: 300_000, probe: true, probeTimeoutMs: 30_000 }

describe('session search settings', () => {
  it('keeps request diagnostics independently default-off, hidden, volatile and boolean-only', () => {
    expect(readInlineConfig(Config({ ...base, diagnosticsEnabled: true,
      autoAllocationDiagnosticsEnabled: true })).requestDiagnosticsEnabled).toBe(false)
    expect(Config.dict?.requestDiagnosticsEnabled?.meta.hidden).toBe(true)
    expect(Config.dict?.requestDiagnosticsEnabled?.meta.volatile).toBe(true)
    let enabled = false
    const live = { ...base, requestDiagnosticsEnabled: { get: () => enabled } }
    expect(readInlineConfig(live).requestDiagnosticsEnabled).toBe(false)
    enabled = true
    expect(readInlineConfig(live).requestDiagnosticsEnabled).toBe(true)
    expect(() => Config({ ...base, requestDiagnosticsEnabled: 'true' } as unknown as InlineConfig)).toThrow()
  })
  it('keeps managed Responses request compression default-off and boolean-only', () => {
    expect(readInlineConfig(Config(base)).responsesRequestCompression).toBe(false)
    expect(readInlineConfig(Config({ ...base, responsesRequestCompression: true })).responsesRequestCompression).toBe(true)
    expect(readInlineConfig(Config({ ...base, responsesRequestCompression: false })).responsesRequestCompression).toBe(false)
    expect(() => Config({ ...base, responsesRequestCompression: 'true' } as unknown as InlineConfig)).toThrow()
  })
  it('keeps managed Responses temperature omission default-off and boolean-only', () => {
    expect(readInlineConfig(Config(base)).responsesOmitTemperature).toBe(false)
    expect(readInlineConfig(Config({ ...base, responsesOmitTemperature: true })).responsesOmitTemperature).toBe(true)
    expect(readInlineConfig(Config({ ...base, responsesOmitTemperature: false })).responsesOmitTemperature).toBe(false)
    expect(() => Config({ ...base, responsesOmitTemperature: 'true' } as unknown as InlineConfig)).toThrow()
  })
  it('keeps persistent Auto allocation observation independent and default-off', () => {
    expect(readInlineConfig(Config(base)).autoAllocationDiagnosticsEnabled).toBe(false)
    expect(readInlineConfig(Config({ ...base, autoAllocationDiagnosticsEnabled: true })).autoAllocationDiagnosticsEnabled).toBe(true)
    expect(readInlineConfig(Config({ ...base, autoAllocationDiagnosticsEnabled: false })).autoAllocationDiagnosticsEnabled).toBe(false)
  })

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
      .toEqual(['diagnosticsEnabled', 'autoAllocationDiagnosticsEnabled', 'requestDiagnosticsEnabled', 'excludedModelIds', 'highCostModelIds', 'activeAccountId', 'sessionAccounts', 'sessionContinuation', 'continuationDefaultHistory', 'followParentModel', 'autoSemanticAssessmentTimeoutMs', 'autoSemanticAssessmentModel', 'parentModelFollow', 'searchModel', 'searchRouting', 'temporaryRouteBackup'])
    const parsed = Config({ ...base, searchModel: 'saved-model', temporaryRouteBackup: 'saved-journal' })
    expect(parsed.searchModel.get()).toBe('saved-model')
    expect(parsed.temporaryRouteBackup.get()).toBe('saved-journal')
    expect(parsed.searchRouting.get()).toMatchObject({ defaultSearchProvider: 'deepseek-official' })
    expect(readInlineConfig(parsed)).toMatchObject({ searchModel: 'saved-model', temporaryRouteBackup: 'saved-journal' })
  })

  it('keeps diagnostics default-off and reads the hidden live collection setting', () => {
    expect(Config.dict?.diagnosticsEnabled?.meta.hidden).toBe(true)
    expect(Config.dict?.diagnosticsEnabled?.meta.volatile).toBe(true)
    expect(Config.dict?.autoAllocationDiagnosticsEnabled?.meta.hidden).toBe(true)
    expect(Config.dict?.autoAllocationDiagnosticsEnabled?.meta.volatile).toBe(true)
    expect(readInlineConfig(Config(base)).diagnosticsEnabled).toBe(false)
    let enabled = false
    const live = { ...base, diagnosticsEnabled: { get: () => enabled } }
    expect(readInlineConfig(live).diagnosticsEnabled).toBe(false)
    enabled = true
    expect(readInlineConfig(live).diagnosticsEnabled).toBe(true)
    const untrusted = { ...base, diagnosticsEnabled: 'true' } as unknown as InlineConfig
    expect(() => Config(untrusted)).toThrow()
  })

  it('keeps the account selector hidden, volatile and absent by default', () => {
    expect(Config.dict?.activeAccountId?.meta.hidden).toBe(true)
    expect(readInlineConfig(Config(base)).activeAccountId).toBeUndefined()
    let accountId: string | undefined
    const live = { ...base, activeAccountId: { get: () => accountId } }
    expect(readInlineConfig(live).activeAccountId).toBeUndefined()
    accountId = '11111111-1111-4111-8111-111111111111'
    expect(readInlineConfig(live).activeAccountId).toBe(accountId)
  })
  it('keeps Session account preferences hidden and snapshots their live rows', () => {
    expect(Config.dict?.sessionAccounts?.meta.hidden).toBe(true)
    expect(readInlineConfig(Config(base)).sessionAccounts).toEqual([])
    const preference = { sessionId: 'session-a', accountId: 'canonical' }
    const current = readInlineConfig({ ...base, sessionAccounts: { get: () => ({ 0: preference, length: 1 }) } })
    expect(current.sessionAccounts).toEqual([preference])
  })

  describe('explicit parent model following', () => {
    it('defaults to no enrolled children and snapshots live binding values', () => {
      expect(readInlineConfig(Config(base)).parentModelFollow).toEqual([])
      expect(readInlineConfig(Config(base)).followParentModel).toBe(false)
      let enabled = false
      const live = { ...base, followParentModel: { get: () => enabled } }
      expect(readInlineConfig(live).followParentModel).toBe(false)
      enabled = true
      expect(readInlineConfig(live).followParentModel).toBe(true)
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
  it('exposes a bounded assessment budget and optional exact classifier without changing opt-out', () => {
    for (const field of ['autoSemanticAssessmentTimeoutMs', 'autoSemanticAssessmentModel'] as const) {
      expect(Config.dict?.[field]?.meta.hidden).not.toBe(true)
      expect(Config.dict?.[field]?.meta.volatile).toBe(true)
    }
    expect(readInlineConfig(Config(base))).toMatchObject({
      autoSemanticAssessmentTimeoutMs: 30000, autoSemanticAssessmentModel: '',
    })
    for (const timeout of [1000, 8000, 30000, 120000]) {
      expect(readInlineConfig(Config({ ...base, autoSemanticAssessment: false,
        autoSemanticAssessmentTimeoutMs: timeout, autoSemanticAssessmentModel: 'account/model' })))
        .toMatchObject({ autoSemanticAssessment: false,
          autoSemanticAssessmentTimeoutMs: timeout, autoSemanticAssessmentModel: 'account/model' })
    }
    for (const timeout of [0, -1, 999, 120001, 30000.5, Infinity, NaN]) {
      expect(() => Config({ ...base, autoSemanticAssessmentTimeoutMs: timeout })).toThrow()
    }
    expect(() => Config({ ...base, autoSemanticAssessmentModel: 'x'.repeat(513) })).toThrow()
    let timeoutMs = 30000, model = ''
    const live = { ...base, autoSemanticAssessmentTimeoutMs: { get: () => timeoutMs },
      autoSemanticAssessmentModel: { get: () => model } }
    expect(readInlineConfig(live)).toMatchObject({
      autoSemanticAssessmentTimeoutMs: 30000, autoSemanticAssessmentModel: '',
    })
    timeoutMs = 8000; model = 'account/model'
    expect(readInlineConfig(live)).toMatchObject({
      autoSemanticAssessmentTimeoutMs: 8000, autoSemanticAssessmentModel: 'account/model',
    })
  })
  it('defaults semantic Auto assessment on while preserving explicit opt-out', () => {
    expect(readInlineConfig(Config(base)).autoSemanticAssessment).toBe(true)
    expect(readInlineConfig(Config({ ...base, autoSemanticAssessment: true })).autoSemanticAssessment).toBe(true)
    expect(readInlineConfig(Config({ ...base, autoSemanticAssessment: false })).autoSemanticAssessment).toBe(false)
  })
  it('separates managed chat liveness and image projection from search deadlines', () => {
    expect(readInlineConfig(Config(base))).toMatchObject({
      chatStreamIdleTimeoutMs: 300_000, chatStreamLiveness: true, chatMaxRequestImageBytes: 20_971_520,
      responsesRequestCompression: false, responsesOmitTemperature: false,
    })
    expect(readInlineConfig(Config({ ...base, chatStreamIdleTimeoutMs: 400_000,
      chatStreamLiveness: false, chatMaxRequestImageBytes: 8_388_608, responsesRequestCompression: true,
      responsesOmitTemperature: true }))).toMatchObject({
      idleTimeoutMs: 300_000, chatStreamIdleTimeoutMs: 400_000,
      chatStreamLiveness: false, chatMaxRequestImageBytes: 8_388_608, responsesRequestCompression: true,
      responsesOmitTemperature: true,
    })
  })
  it.each(['chatStreamIdleTimeoutMs', 'chatMaxRequestImageBytes'] as const)('rejects unsafe managed request setting %s', key => {
    for (const value of [0, -1, 0.5, Number.NaN, Infinity]) expect(() => Config({ ...base, [key]: value })).toThrow()
  })
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
