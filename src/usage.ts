/**
 * Usage mapping for the inline wire path: Responses-API usage objects
 * project onto the harness TokenUsage shape exactly like the pi-ai adapter
 * (input minus cached, cache and reasoning split out as separate fields).
 * @module dsh-web-search-provider/usage
 */

import type { TokenUsage } from '@deepseek-ai/dsh-llm'

/** The usage object carried by `response.completed` / `response.incomplete` (snake_case wire fields). */
export interface WireUsage {
  readonly input_tokens: number
  readonly output_tokens: number
  readonly total_tokens: number
  readonly input_tokens_details?: { readonly cached_tokens?: number }
  readonly output_tokens_details?: { readonly reasoning_tokens?: number }
}

/**
 * Map a wire usage object to the harness TokenUsage shape.
 * @param usage - the provider usage object (snake_case wire fields).
 * @returns the harness usage; cache and reasoning fields are omitted when absent.
 */
export function mapUsage(usage: WireUsage): TokenUsage {
  const cached = usage.input_tokens_details?.cached_tokens ?? 0
  return {
    // A provider may report more cached than input tokens; the harness
    // budget math must not see a negative input count.
    inputTokens: Math.max(usage.input_tokens - cached, 0),
    outputTokens: usage.output_tokens,
    ...cached > 0 ? { cacheReadTokens: cached } : {},
    ...usage.output_tokens_details?.reasoning_tokens !== undefined
      ? { reasoningTokens: usage.output_tokens_details.reasoning_tokens }
      : {},
  }
}
