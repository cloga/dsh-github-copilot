/**
 * Usage mapping tests: Responses-API usage objects project onto the harness
 * TokenUsage shape with cache and reasoning split out.
 */

import { describe, expect, it } from 'vitest'
import { mapUsage } from '../../src/usage.ts'

describe('mapUsage', () => {
  it('maps plain usage with no details', () => {
    expect(mapUsage({ input_tokens: 100, output_tokens: 50, total_tokens: 150 })).toEqual({
      inputTokens: 100,
      outputTokens: 50,
    })
  })

  it('subtracts cached tokens from input and reports cacheReadTokens', () => {
    expect(mapUsage({
      input_tokens: 500,
      output_tokens: 80,
      total_tokens: 580,
      input_tokens_details: { cached_tokens: 400 },
    })).toEqual({
      inputTokens: 100,
      outputTokens: 80,
      cacheReadTokens: 400,
    })
  })

  it('reports reasoning tokens when present', () => {
    expect(mapUsage({
      input_tokens: 10,
      output_tokens: 90,
      total_tokens: 100,
      output_tokens_details: { reasoning_tokens: 60 },
    })).toEqual({
      inputTokens: 10,
      outputTokens: 90,
      reasoningTokens: 60,
    })
  })

  it('floors input tokens at zero when cached tokens exceed input', () => {
    expect(mapUsage({
      input_tokens: 10,
      output_tokens: 5,
      total_tokens: 15,
      input_tokens_details: { cached_tokens: 40 },
    })).toEqual({
      inputTokens: 0,
      outputTokens: 5,
      cacheReadTokens: 40,
    })
  })
})
