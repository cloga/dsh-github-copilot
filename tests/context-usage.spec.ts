import { describe, expect, it } from 'vitest'
import { isZeroContextUsage } from '../src/context-usage.ts'

describe('historical zero usage classification', () => {
  it('classifies zero only for separate historical evidence without changing the sample', () => {
    const usage = Object.freeze({ inputTokens: 0, outputTokens: 0, totalTokens: 0 })
    expect(isZeroContextUsage(usage)).toBe(true)
    expect(usage).toEqual({ inputTokens: 0, outputTokens: 0, totalTokens: 0 })
  })
  it.each([
    { inputTokens: 1, outputTokens: 0 }, { inputTokens: 0, outputTokens: 1 },
    { inputTokens: 0, outputTokens: 0, cacheReadTokens: 1 },
    { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 1 },
    { inputTokens: 0, outputTokens: 0, totalTokens: 1 },
    { inputTokens: 0, outputTokens: 0, reasoningTokens: 1 },
  ])('does not classify nonzero counters as failed zero %j', usage => {
    expect(isZeroContextUsage(usage)).toBe(false)
  })
})
