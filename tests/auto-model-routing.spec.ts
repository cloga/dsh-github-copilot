import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { describe, expect, it, vi } from 'vitest'
import type { AccountModelCategory, AccountModelDescriptor } from '../src/account-model-catalog.ts'
import {
  AutoModelRoutingError, autoModelInputModalities, classifyAutoModelTurn, estimateTurnInputTokens,
  selectAutoModel as selectWithMeasurement,
} from '../src/auto-model-routing.ts'

const estimateMessage = (message: unknown): number => Math.ceil(JSON.stringify(message).length / 4)

function selectAutoModel(...[models, messages, preference, context]: Parameters<typeof selectWithMeasurement>) {
  return selectWithMeasurement(models, messages, preference, { estimateMessage, ...context })
}

function model(id: string, options: {
  contextWindow: number
  maxTokens: number
  efforts?: string[]
  image?: boolean
  category?: AccountModelCategory
}): AccountModelDescriptor {
  return {
    id,
    name: id,
    category: options.category,
    api: 'openai-responses',
    contextWindow: options.contextWindow,
    maxTokens: options.maxTokens,
    input: options.image ? ['text', 'image'] : ['text'],
    reasoning: {
      advertisedEfforts: options.efforts ?? [],
      unmappedEfforts: [],
    },
    sampling: { temperature: 'unknown' },
    evidence: {
      endpoints: ['/responses'],
      unsupportedEndpointCount: 0,
      selectedEndpoint: '/responses',
      apiSource: 'advertised-native',
      policySource: 'server-enabled',
      contextWindowSource: 'max_context_window_tokens',
    },
  }
}

function message(text: string) {
  return createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
}

describe('Auto model routing policy', () => {
  const fast = model('fixture-fast', { contextWindow: 64_000, maxTokens: 8_000, efforts: ['low'], category: 'lightweight' })
  const balanced = model('fixture-balanced', { contextWindow: 128_000, maxTokens: 16_000, efforts: ['medium'], category: 'versatile' })
  const strong = model('fixture-strong', { contextWindow: 256_000, maxTokens: 32_000, efforts: ['high', 'xhigh'], category: 'powerful' })

  it('does not discard a complete Core assistant message when it contains reasoning', () => {
    const history = [
      { role: 'assistant', content: [
        { type: 'text', text: 'x'.repeat(400_000) },
        { type: 'reasoning', text: 'r'.repeat(400_000) },
      ] },
      message('Continue.'),
    ]
    expect(estimateTurnInputTokens(history, estimateMessage)).toBeGreaterThanOrEqual(200_000)
    expect(selectAutoModel([fast, strong], history, 'efficiency').model.id).toBe(strong.id)
  })

  it('prices every Core message through the supplied native estimator without swallowing failures', () => {
    const history = [message('One.'), message('Two.')]
    const estimate = vi.fn().mockReturnValueOnce(40).mockReturnValueOnce(60)
    expect(estimateTurnInputTokens(history, estimate)).toBe(100)
    expect(estimate.mock.calls).toEqual(history.map(item => [item]))
    expect(() => estimateTurnInputTokens(history, () => { throw new Error('native-estimator-failed') }))
      .toThrow('native-estimator-failed')
    expect(() => estimateTurnInputTokens(history)).toThrow('COPILOT_AUTO_TOKEN_METER_UNAVAILABLE')
    for (const value of [NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => estimateTurnInputTokens(history, () => value)).toThrow('COPILOT_AUTO_TOKEN_ESTIMATE_INVALID')
    }
  })

  it('retains the native current-surface and tool-envelope measurement as an input floor', () => {
    expect(selectAutoModel([fast, strong], [message('Continue.')], 'efficiency', { inputTokenFloor: 100_000 }))
      .toMatchObject({ model: strong, estimatedInputTokens: 100_000, fittingCandidateCount: 1 })
    expect(() => selectAutoModel([fast], [], 'balance', { inputTokenFloor: NaN }))
      .toThrow('COPILOT_AUTO_TOKEN_ESTIMATE_INVALID')
  })

  it('retains legacy length evidence but does not use it as task or supplier category evidence', () => {
    expect(classifyAutoModelTurn([message('old '.repeat(2_000)), message('Explain this symbol.')]))
      .toMatchObject({ taskClass: 'fast', requiresImage: false })
    expect(selectAutoModel([strong, fast, balanced], [message('Explain this symbol.')]))
      .toMatchObject({ model: balanced, taskClass: 'fast', reason: 'short-text-turn', candidateCount: 3,
        explanation: { assessment: { demand: 'unknown' }, targetCategory: 'versatile' } })
    expect(selectAutoModel([strong, fast, balanced], [message('Investigate this behavior with enough detail to exceed the short threshold. '.repeat(20))]))
      .toMatchObject({ model: strong, taskClass: 'balanced', reason: 'standard-turn' })
    expect(selectAutoModel([balanced, strong, fast], [message(`Analyze:\n${'detail '.repeat(700)}`)]))
      .toMatchObject({ model: balanced, taskClass: 'strong', reason: 'large-structured-turn' })
  })

  it('requires account-verified image capability for image turns', () => {
    const vision = model('fixture-vision', { contextWindow: 96_000, maxTokens: 12_000, efforts: ['medium'], image: true })
    const image = { role: 'user', content: [
      { type: 'text', text: 'What is shown?' },
      { type: 'image' },
    ] }
    expect(autoModelInputModalities([fast, vision])).toEqual(['text', 'image'])
    expect(selectAutoModel([fast, vision], [image])).toMatchObject({
      model: vision, taskClass: 'balanced', reason: 'image-capability', candidateCount: 1,
    })
    expect(() => selectAutoModel([fast], [image])).toThrow(AutoModelRoutingError)
  })

  it('does not treat a reserved real model ID as an eligible target', () => {
    const reserved = model('auto', { contextWindow: 1_000_000, maxTokens: 100_000, efforts: ['max'], image: true })
    expect(selectAutoModel([reserved, fast], [message('hi')]).model).toBe(fast)
  })

  it.each(['user', 'tool'])('retains historical %s image requirements after a text-only continuation', (role) => {
    const vision = model('fixture-vision', { contextWindow: 128_000, maxTokens: 16_000, image: true })
    const history = [
      { role, content: [{ type: 'image', attachment: { mediaType: 'image/webp' } }] },
      message('Continue.'),
    ]
    const before = structuredClone(history)
    for (const preference of ['efficiency', 'balance', 'intelligence'] as const) {
      expect(selectAutoModel([fast, strong, vision], history, preference))
        .toMatchObject({ model: vision, reason: 'image-capability', candidateCount: 1 })
      expect(() => selectAutoModel([fast, strong], history, preference)).toThrow(AutoModelRoutingError)
    }
    expect(history).toEqual(before)
  })

  it('does not infer image requirements from filenames, tool arguments, or offloaded text', () => {
    const history = [
      { role: 'assistant', content: [{ type: 'tool-call', arguments: { type: 'image' } }] },
      { role: 'tool', content: [{ type: 'text', text: '[image omitted to fit request image limits; photo.webp]' }] },
      { role: 'tool', content: [{ type: 'image', offloaded: true, attachment: { mediaType: 'image/webp' } }] },
      message('Continue reviewing photo.png.'),
    ]
    expect(classifyAutoModelTurn(history)).toMatchObject({ requiresImage: false, taskClass: 'fast' })
    expect(selectAutoModel([fast], history).model).toBe(fast)
  })

  it('uses the task/category policy with one hard-eligible pool for all preferences', () => {
    const pool = [strong, fast, balanced]
    const short = [message('Hello!')]
    const ordinary = [message('Convert this table.')]
    const demanding = [message('Prove this theorem.')]
    const routine = { assessment: { demand: 'routine', source: 'semantic', signals: ['bounded-transformation'] } } as const
    expect(selectAutoModel(pool, short, 'efficiency').model).toBe(fast)
    expect(selectAutoModel(pool, short, 'balance').model).toBe(fast)
    expect(selectAutoModel(pool, short, 'intelligence').model).toBe(fast)
    expect(selectAutoModel(pool, ordinary, 'efficiency', routine).model).toBe(fast)
    expect(selectAutoModel(pool, ordinary, 'balance', routine).model).toBe(balanced)
    expect(selectAutoModel(pool, ordinary, 'intelligence', routine).model).toBe(strong)
    expect(selectAutoModel(pool, demanding, 'efficiency').model).toBe(strong)
    expect(selectAutoModel(pool, demanding, 'balance').model).toBe(strong)
    expect(selectAutoModel(pool, demanding, 'intelligence').model).toBe(strong)
    for (const preference of ['efficiency', 'balance', 'intelligence'] as const) {
      expect(selectAutoModel([strong], short, preference).model).toBe(strong)
      expect(selectAutoModel([fast, strong], demanding, preference).model).toBe(strong)
      expect(selectAutoModel(pool, short, preference).candidateCount).toBe(3)
    }
  })

  it('applies capability requirements before any preference', () => {
    const vision = model('fixture-vision', { contextWindow: 128_000, maxTokens: 16_000, image: true })
    const image = [{ role: 'user', content: [{ type: 'image' }] }]
    for (const preference of ['efficiency', 'balance', 'intelligence'] as const) {
      expect(selectAutoModel([fast, strong, vision], image, preference))
        .toMatchObject({ model: vision, candidateCount: 1 })
      expect(() => selectAutoModel([fast, strong], image, preference)).toThrow(AutoModelRoutingError)
    }
  })

  it('distributes only equally categorized fitting candidates without capacity-based weights', () => {
    const m1 = model('fixture-fast', { contextWindow: 64_000, maxTokens: 8_000, efforts: ['low'] })
    const m2 = model('fixture-mid-1', { contextWindow: 128_000, maxTokens: 16_000, efforts: ['medium'] })
    const m3 = model('fixture-mid-2', { contextWindow: 200_000, maxTokens: 24_000, efforts: ['medium'], category: 'powerful' })
    const m4 = model('fixture-strong-1', { contextWindow: 256_000, maxTokens: 32_000, efforts: ['high'], category: 'powerful' })
    const m5 = model('fixture-strong-2', { contextWindow: 500_000, maxTokens: 64_000, efforts: ['xhigh'], category: 'powerful' })
    const pool5 = [m1, m2, m3, m4, m5]
    const demanding = [message('Analyze:\n' + 'detail '.repeat(700))]

    const chosen = new Set<string>()
    for (let i = 0; i < 20; i++) {
      const decision = selectAutoModel(pool5, demanding, 'intelligence', {
        sessionId: `session-${i}`,
        turn: 1,
      })
      chosen.add(decision.model.id)
      expect([m3.id, m4.id, m5.id]).toContain(decision.model.id)
      expect(decision.explanation).toMatchObject({ selectedCategory: 'powerful', method: 'weighted-distribution', categoryCandidateCount: 3 })
    }
    expect(chosen.size).toBeGreaterThan(1)
  })

  it('freezes model selection across steps and retries within the same turn', () => {
    const m1 = model('fixture-fast', { contextWindow: 64_000, maxTokens: 8_000, efforts: ['low'] })
    const m2 = model('fixture-strong-1', { contextWindow: 256_000, maxTokens: 32_000, efforts: ['high'] })
    const m3 = model('fixture-strong-2', { contextWindow: 500_000, maxTokens: 64_000, efforts: ['xhigh'] })
    const pool = [m1, m2, m3]
    const demanding = [message('Analyze:\n' + 'detail '.repeat(700))]

    const first = selectAutoModel(pool, demanding, 'intelligence', { sessionId: 'session-alpha', turn: 2 })
    const retry = selectAutoModel(pool, demanding, 'intelligence', { sessionId: 'session-alpha', turn: 2 })
    expect(retry.model.id).toBe(first.model.id)
    expect(retry.selectedInputBudget).toBe(first.selectedInputBudget)
  })

  it('uses lightweight for an isolated greeting even with Intelligence and powerful for short hard Efficiency work', () => {
    expect(selectAutoModel([fast, balanced, strong], [message('Hello!')], 'intelligence').model).toBe(fast)
    expect(selectAutoModel([fast, balanced, strong], [message('Prove this theorem.')], 'efficiency').model).toBe(strong)
    expect(selectAutoModel([fast, balanced, strong], [message('Continue.')], 'intelligence').model).toBe(strong)
  })

  it('uses finite continuity but never lets it override task category or input fit', () => {
    const second = { ...balanced, id: 'second-versatile' }
    expect(selectAutoModel([fast, balanced, second, strong], [message('Continue.')], 'balance',
      { previousModelId: second.id }).explanation.method).toBe('weighted-distribution')
    expect(selectAutoModel([fast, balanced, strong], [message('Prove it.')], 'balance',
      { previousModelId: balanced.id }).model).toBe(strong)
    expect(selectAutoModel([fast, balanced, strong], [message('Hello!')], 'intelligence',
      { previousModelId: strong.id }).model).toBe(fast)
    expect(selectAutoModel([fast, balanced, strong], [message('Continue.')], 'balance',
      { previousModelId: balanced.id, inputTokenFloor: 150_000 }).model).toBe(strong)
  })

  it('discloses category fallbacks and never guesses missing category from ID or capacity', () => {
    const unknown = model('powerful-sounding-name', { contextWindow: 1_000_000, maxTokens: 100_000 })
    expect(selectAutoModel([balanced, unknown], [message('Prove it.')], 'intelligence'))
      .toMatchObject({ model: balanced, explanation: { fallback: true, selectedCategory: 'versatile', targetCategory: 'powerful' } })
    expect(selectAutoModel([unknown], [message('Hello!')], 'intelligence').explanation)
      .toMatchObject({ fallback: true, selectedCategory: 'unknown' })
  })

  it('keeps costly Fast models eligible and evidence opt-out independent of the selected route', () => {
    const peer = { ...fast, id: 'ordinary-fast' }
    const context = { sessionId: 'weighted-fast', turn: 3, highCostModelIds: [fast.id], previousModelId: fast.id }
    const captured = selectAutoModel([fast, peer, strong], [message('Hello!')], 'intelligence', context)
    expect(captured.explanation.selectedCategory).toBe('lightweight')
    expect(captured.explanation.allocation?.candidates.find(row => row.modelId === fast.id))
      .toMatchObject({ highCost: true, previous: true, weight: 0.3 })
    const optedOut = selectAutoModel([fast, peer, strong], [message('Hello!')], 'intelligence',
      { ...context, collectAllocationEvidence: false })
    expect(optedOut.model).toBe(captured.model)
    expect(optedOut.explanation.allocation).toBeUndefined()
  })

  it('preserves single candidate unchanged across all preferences', () => {
    const single = model('fixture-solo', { contextWindow: 128_000, maxTokens: 16_000, efforts: ['medium'] })
    const demanding = [message('Analyze:\n' + 'detail '.repeat(700))]
    for (const preference of ['efficiency', 'balance', 'intelligence'] as const) {
      const decision = selectAutoModel([single], demanding, preference)
      expect(decision.model).toBe(single)
      expect(decision.candidateCount).toBe(1)
      expect(decision.fittingCandidateCount).toBe(1)
    }
  })

  it('eliminates screenshot-style insufficient model and chooses fitting candidate', () => {
    // Replicates Grok 4.7 screenshot conditions:
    // Grok: contextWindow 500_000, maxTokens 128_000 -> hardInputLimit = 500_000 - 128_000 - 4_096 = 367_904.
    const grokStyle = model('fixture-grok-47', { contextWindow: 500_000, maxTokens: 128_000, efforts: ['xhigh'] })
    // Large context model: contextWindow 1_000_000, maxTokens 64_000 -> hardInputLimit = 931_904.
    const largeContext = model('fixture-large-context', { contextWindow: 1_000_000, maxTokens: 64_000, efforts: ['high'] })

    // Estimated input: 439,022 tokens (exceeds Grok 367,904 but fits in largeContext 931,904)
    const screenshotTurn = [message('word '.repeat(439_022))]
    const decision = selectAutoModel([grokStyle, largeContext], screenshotTurn, 'intelligence')

    expect(decision.model.id).toBe(largeContext.id)
    expect(decision.candidateCount).toBe(2)
    expect(decision.fittingCandidateCount).toBe(1)
    expect(decision.inputFitDiagnostic).toBe('fitting-candidate-selected')
    expect(decision.selectedInputBudget).toBe(931_904)
  })

  it('selects largest capacity model and sets diagnostic when no candidate fits', () => {
    const grokStyle = model('fixture-grok-47', { contextWindow: 500_000, maxTokens: 128_000, efforts: ['xhigh'] })
    const largeContext = model('fixture-large-context', { contextWindow: 1_000_000, maxTokens: 64_000, efforts: ['high'] })
    const massiveHistory = [
      message('prior history block '.repeat(300_000)),
      message('active user prompt.'),
    ]

    // 1. Compaction eligible
    const eligible = selectAutoModel([grokStyle, largeContext], massiveHistory, 'intelligence', {
      compactionAvailable: true,
    })
    expect(eligible.model.id).toBe(largeContext.id)
    expect(eligible.fittingCandidateCount).toBe(0)
    expect(eligible.inputFitDiagnostic).toBe('compaction-eligible')

    // 2. Compaction unavailable
    const unavail = selectAutoModel([grokStyle, largeContext], massiveHistory, 'intelligence', {
      compactionAvailable: false,
    })
    expect(unavail.inputFitDiagnostic).toBe('compaction-unavailable')

    // 3. Compaction already attempted
    const attempted = selectAutoModel([grokStyle, largeContext], massiveHistory, 'intelligence', {
      hasCompactionSummary: true,
    })
    expect(attempted.inputFitDiagnostic).toBe('attempted-but-still-oversized')

    // 4. Fixed content cannot fit (active user prompt alone exceeds largest capacity)
    const massiveUserPrompt = [message('huge user message '.repeat(300_000))]
    const fixed = selectAutoModel([grokStyle, largeContext], massiveUserPrompt, 'intelligence')
    expect(fixed.inputFitDiagnostic).toBe('fixed-content-cannot-fit')
  })
})
