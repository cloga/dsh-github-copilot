import type { StreamChunk, TokenUsage } from '@deepseek-ai/dsh-llm'

/** All observed counters are zero, not proof that an attempted prompt was empty. */
export function isZeroContextUsage(usage: TokenUsage): boolean {
  return usage.inputTokens === 0 && usage.outputTokens === 0
    && (usage.cacheReadTokens ?? 0) === 0 && (usage.cacheWriteTokens ?? 0) === 0
    && (usage.totalTokens ?? 0) === 0 && (usage.reasoningTokens ?? 0) === 0
}

/**
 * Native pi-ai emits terminal usage immediately before finish, including a
 * default zero sample when no provider usage arrived. Delay only that sample;
 * failed, cancelled or truncated attempts must not reset Core's last reading.
 */
export async function* guardContextUsage(stream: AsyncIterable<StreamChunk>): AsyncGenerator<StreamChunk> {
  let pending: Extract<StreamChunk, { type: 'usage' }> | undefined
  for await (const chunk of stream) {
    if (pending !== undefined) {
      if (chunk.type !== 'finish' || (chunk.reason.kind !== 'error' && chunk.reason.kind !== 'aborted')) {
        yield pending
      }
      pending = undefined
    }
    if (chunk.type === 'usage' && isZeroContextUsage(chunk.usage)) pending = chunk
    else yield chunk
  }
  // No terminal evidence: a pending zero cannot certify a successful request.
}
