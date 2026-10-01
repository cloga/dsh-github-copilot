import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { describe, expect, it } from 'vitest'
import type { AccountModelDescriptor } from '../src/account-model-catalog.ts'
import {
  AutoModelRoutingError, autoModelInputModalities, classifyAutoModelTurn, selectAutoModel,
} from '../src/auto-model-routing.ts'

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
})
