import { describe, expect, it } from 'vitest'
import type { AccountModelDescriptor } from '../src/account-model-catalog.ts'
import { selectAutoModel } from '../src/auto-model-routing.ts'
import { AutoAllocationSchema } from '../src/auto-allocation.ts'
import { summarizeAutoAllocations } from '../src/auto-allocation-evidence.ts'
import { AutoAllocationDiagnosticsCollector } from '../src/auto-allocation-diagnostics.ts'
import { selectionExplanation } from '../src/auto-selection-explanation.ts'

const models: AccountModelDescriptor[] = ['powerful', 'versatile', 'lightweight'].flatMap(category =>
  ['a', 'b'].map(suffix => ({
    id: `${category}-${suffix}`, name: `${category}-${suffix}`,
    category: category as 'powerful' | 'versatile' | 'lightweight',
    api: 'openai-responses' as const, contextWindow: 128_000, maxTokens: 8_000,
    input: ['text'] as ['text'], reasoning: { advertisedEfforts: [], unmappedEfforts: [] },
    evidence: { endpoints: ['/responses'], unsupportedEndpointCount: 0,
      selectedEndpoint: '/responses', apiSource: 'advertised-native' as const,
      policySource: 'server-enabled' as const, contextWindowSource: 'max_context_window_tokens' as const },
  })))

describe('soft Auto category distribution', () => {
  it.each(['simple', 'routine', 'complex', 'unknown'] as const)(
    'retains positive opportunity for every fitting model for %s demand', demand => {
      for (const preference of ['efficiency', 'balance', 'intelligence'] as const) {
        const counts = new Map<string, number>()
        const expected = new Map<string, number>()
        for (let turn = 1; turn <= 10_000; turn++) {
          const decision = selectAutoModel(models, [], preference, {
            estimateMessage: () => 100, sessionId: 'synthetic-category-regression', turn,
            assessment: { demand, source: 'semantic', signals: [] },
            highCostModelIds: ['powerful-a'], previousModelId: 'powerful-a',
          })
          const rows = decision.explanation.allocation!.candidates
          expect(rows).toHaveLength(models.length)
          for (const row of rows) expected.set(row.modelId, (expected.get(row.modelId) ?? 0) + row.expectedShare)
          counts.set(decision.model.id, (counts.get(decision.model.id) ?? 0) + 1)
        }
        for (const model of models) {
          expect(counts.get(model.id) ?? 0).toBeGreaterThan(0)
          expect(Math.abs((counts.get(model.id) ?? 0) - expected.get(model.id)!) / 10_000).toBeLessThan(0.02)
        }
      }
    })

  it('keeps unknown category explicit with positive trial weight and no guessed category', () => {
    const unknown = { ...models[0]!, id: 'unclassified', category: undefined }
    const result = selectAutoModel([...models, unknown], [], 'balance', {
      estimateMessage: () => 100, seed: 42,
      assessment: { demand: 'complex', source: 'semantic', signals: [] },
    })
    expect(result.explanation.allocation!.candidates.find(row => row.modelId === unknown.id))
      .toMatchObject({ category: 'unknown', categoryWeight: 0.02, weight: 0.02 })
  })

  it('validates category multipliers and keeps legacy v3 unchanged', () => {
    const decision = selectAutoModel(models, [], 'balance', {
      estimateMessage: () => 100, seed: 42,
      assessment: { demand: 'complex', source: 'semantic', signals: [] },
    })
    const allocation = decision.explanation.allocation!
    expect(AutoAllocationSchema.safeParse(allocation).success).toBe(true)
    for (const change of [
      { targetCategory: 'lightweight' },
      { candidates: allocation.candidates.map(row => ({ ...row, categoryWeight: 1 })) },
      { candidates: allocation.candidates.map(row => ({ ...row, category: undefined })) },
      { policyVersion: 'high-cost-v3' },
    ]) expect(AutoAllocationSchema.safeParse({ ...allocation, ...change }).success).toBe(false)
    const legacy = { policyVersion: 'high-cost-v3', selectedModelId: 'costly', candidates: [
      { modelId: 'ordinary', highCost: false, previous: false, weight: 1, expectedShare: 50 / 51 },
      { modelId: 'costly', highCost: true, previous: true, weight: 0.02, expectedShare: 1 / 51 },
    ] }
    expect(AutoAllocationSchema.parse(legacy)).toEqual(legacy)
    expect(selectionExplanation({ ...decision.explanation, allocationPolicy: undefined, allocation: AutoAllocationSchema.parse(legacy) }, 'en').choice)
      .toContain('one-turn recency decay')
  })

  it('attributes each candidate to its own category in bounded summaries and persistent cohorts', () => {
    const decision = selectAutoModel(models, [], 'balance', {
      estimateMessage: () => 100, seed: 42,
      assessment: { demand: 'complex', source: 'semantic', signals: [] },
    })
    const summary = summarizeAutoAllocations([decision.explanation])
    const collector = new AutoAllocationDiagnosticsCollector('0.0.0-synthetic')
    collector.setEnabled(true)
    collector.record(decision.explanation)
    for (const model of models) {
      expect(summary.rows.find(row => row.modelId === model.id)?.category).toBe(model.category)
      expect(collector.snapshot().rows.find(row => row.modelId === model.id))
        .toMatchObject({ category: model.category, targetCategory: 'powerful' })
    }
    expect(summary.rows.reduce((sum, row) => sum + row.selections, 0)).toBe(1)
    expect(collector.snapshot().rows.reduce((sum, row) => sum + row.expectedSelections, 0)).toBeCloseTo(1)
  })

  it('removes unsupported or oversized models before allocation and retains all fitting categories', () => {
    const oversized = { ...models[0]!, id: 'too-small', contextWindow: 10_000 }
    const image = [{ role: 'user', content: [{ type: 'image' }] }]
    const vision = { ...models[2]!, input: ['text', 'image'] as ['text', 'image'] }
    const capacity = selectAutoModel([...models, oversized], [], 'balance', {
      estimateMessage: () => 100, inputTokenFloor: 20_000, seed: 42,
    })
    expect(capacity.explanation.allocation?.candidates).toHaveLength(6)
    expect(capacity.explanation.allocation?.candidates.some(row => row.modelId === oversized.id)).toBe(false)
    const modality = selectAutoModel([models[0]!, vision], image, 'intelligence', {
      estimateMessage: () => 100, seed: 42,
    })
    expect(modality.model).toBe(vision)
    expect(modality.explanation.allocation?.candidates).toHaveLength(1)
    expect(modality.explanation.allocation?.candidates[0]?.expectedShare).toBe(1)
  })

  it('discloses cross-category choice without falsely claiming target absence, including evidence opt-out', () => {
    const context = { estimateMessage: () => 100, seed: 5,
      assessment: { demand: 'simple', source: 'semantic', signals: [] } as const }
    const decision = selectAutoModel(models, [], 'intelligence', context)
    expect(decision.explanation).toMatchObject({ targetCategory: 'lightweight', selectedCategory: 'powerful', fallback: false })
    for (const locale of ['en', 'zh']) {
      const text = selectionExplanation(decision.explanation, locale)
      expect(text.choice).toContain(locale === 'en' ? 'uncalibrated trial' : '未校准试验')
      expect(text.conclusion).not.toContain(locale === 'en' ? 'No eligible fitting' : '没有合格')
      const optedOut = selectAutoModel(models, [], 'intelligence', { ...context, collectAllocationEvidence: false })
      expect(optedOut.model).toBe(decision.model)
      expect(selectionExplanation(optedOut.explanation, locale).choice)
        .toContain(locale === 'en' ? 'cross-category' : '跨分类')
    }
  })
})
