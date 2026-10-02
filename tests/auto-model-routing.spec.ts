import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { describe, expect, it, vi } from 'vitest'
import type { AccountModelDescriptor } from '../src/account-model-catalog.ts'
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
}): AccountModelDescriptor {
  return {
    id,
    name: id,
    api: 'openai-responses',
    contextWindow: options.contextWindow,
    maxTokens: options.maxTokens,
    input: options.image ? ['text', 'image'] : ['text'],
    reasoning: {
      advertisedEfforts: options.efforts ?? [],
      unmappedEfforts: [],
    },
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
  const fast = model('fixture-fast', { contextWindow: 64_000, maxTokens: 8_000, efforts: ['low'] })
  const balanced = model('fixture-balanced', { contextWindow: 128_000, maxTokens: 16_000, efforts: ['medium'] })
  const strong = model('fixture-strong', { contextWindow: 256_000, maxTokens: 32_000, efforts: ['high', 'xhigh'] })

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

  it('classifies only the latest user turn and selects a deterministic capacity tier', () => {
    expect(classifyAutoModelTurn([message('old '.repeat(2_000)), message('Explain this symbol.')]))
      .toMatchObject({ taskClass: 'fast', requiresImage: false })
    expect(selectAutoModel([strong, fast, balanced], [message('Explain this symbol.')]))
      .toMatchObject({ model: fast, taskClass: 'fast', reason: 'short-text-turn', candidateCount: 3 })
    expect(selectAutoModel([strong, fast, balanced], [message('Investigate this behavior with enough detail to exceed the short threshold. '.repeat(20))]))
      .toMatchObject({ model: balanced, taskClass: 'balanced', reason: 'standard-turn' })
    expect(selectAutoModel([balanced, strong, fast], [message(`Analyze:\n${'detail '.repeat(700)}`)]))
      .toMatchObject({ model: strong, taskClass: 'strong', reason: 'large-structured-turn' })
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

  it('uses one candidate pool with bounded soft preferences rather than tier filters', () => {
    const pool = [strong, fast, balanced]
    const short = [message('Explain this symbol.')]
    const ordinary = [message('Investigate the behavior in detail. '.repeat(30))]
    const demanding = [message('Analyze:\n' + 'detail '.repeat(700))]
    expect(selectAutoModel(pool, short, 'efficiency').model).toBe(fast)
    expect(selectAutoModel(pool, short, 'balance').model).toBe(fast)
    expect(selectAutoModel(pool, short, 'intelligence').model).toBe(balanced)
    expect(selectAutoModel(pool, ordinary, 'efficiency').model).toBe(fast)
    expect(selectAutoModel(pool, ordinary, 'balance').model).toBe(balanced)
    expect(selectAutoModel(pool, ordinary, 'intelligence').model).toBe(strong)
    expect(selectAutoModel(pool, demanding, 'efficiency').model).toBe(balanced)
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

  it('distributes unrelated balanced/strong Intelligence turns across upper candidates without monopolization', () => {
    const m1 = model('fixture-fast', { contextWindow: 64_000, maxTokens: 8_000, efforts: ['low'] })
    const m2 = model('fixture-mid-1', { contextWindow: 128_000, maxTokens: 16_000, efforts: ['medium'] })
    const m3 = model('fixture-mid-2', { contextWindow: 200_000, maxTokens: 24_000, efforts: ['medium'] })
    const m4 = model('fixture-strong-1', { contextWindow: 256_000, maxTokens: 32_000, efforts: ['high'] })
    const m5 = model('fixture-strong-2', { contextWindow: 500_000, maxTokens: 64_000, efforts: ['xhigh'] })
    const pool5 = [m1, m2, m3, m4, m5]
    const demanding = [message('Analyze:\n' + 'detail '.repeat(700))]

    const chosen = new Set<string>()
    for (let i = 0; i < 20; i++) {
      const decision = selectAutoModel(pool5, demanding, 'intelligence', {
        sessionId: `session-${i}`,
        turn: 1,
      })
      chosen.add(decision.model.id)
      // All selected models must be in the upper capacity band (m3, m4, m5)
      expect([m3.id, m4.id, m5.id]).toContain(decision.model.id)
    }
    // Multiple distinct upper-tier models must be selected across different sessions
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

  it('picks lighter capacity for simple Intelligence turns and higher capacity for demanding Efficiency turns', () => {
    const m1 = model('fixture-fast', { contextWindow: 64_000, maxTokens: 8_000, efforts: ['low'] })
    const m2 = model('fixture-mid-1', { contextWindow: 128_000, maxTokens: 16_000, efforts: ['medium'] })
    const m3 = model('fixture-mid-2', { contextWindow: 200_000, maxTokens: 24_000, efforts: ['medium'] })
    const m4 = model('fixture-strong', { contextWindow: 500_000, maxTokens: 64_000, efforts: ['xhigh'] })
    const pool = [m1, m2, m3, m4]
    const short = [message('Explain this symbol.')]
    const demanding = [message('Analyze:\n' + 'detail '.repeat(700))]

    // Simple Intelligence picks lighter/middle, not the highest monster model
    expect(selectAutoModel(pool, short, 'intelligence').model.id).toBe(m2.id)
    expect(selectAutoModel(pool, short, 'efficiency').model.id).toBe(m1.id)

    // Demanding Efficiency picks a capable model (task demand dominates over efficiency preference)
    expect(selectAutoModel(pool, demanding, 'efficiency').model.id).toBe(m2.id)
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
