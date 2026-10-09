import type { TokenUsage } from '@deepseek-ai/dsh-llm'

/** All observed counters are zero, not proof that an attempted prompt was empty. */
export function isZeroContextUsage(usage: TokenUsage): boolean {
  return usage.inputTokens === 0 && usage.outputTokens === 0
    && (usage.cacheReadTokens ?? 0) === 0 && (usage.cacheWriteTokens ?? 0) === 0
    && (usage.totalTokens ?? 0) === 0 && (usage.reasoningTokens ?? 0) === 0
}
