import { describe, expect, it } from 'vitest'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { guardContextUsage, isZeroContextUsage } from '../src/context-usage-guard.ts'

const zero: StreamChunk = { type: 'usage', usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } }
const failed: StreamChunk = { type: 'finish', reason: { kind: 'error', failure: { message: 'synthetic transport failure', code: 'TRANSPORT' } } }
async function collect(chunks: StreamChunk[], error?: Error) {
  const result: StreamChunk[] = []
  const source = (async function* () { yield* chunks; if (error) throw error })()
  try { for await (const chunk of guardContextUsage(source)) result.push(chunk) }
  catch (cause) { return { result, error: cause } }
  return { result, error: undefined }
}
describe('managed terminal context usage', () => {
  it.each(['error', 'aborted'] as const)('does not report failed zero usage on %s', async kind => {
    const finish: StreamChunk = { type: 'finish', reason: { kind, failure: { code: 'SYNTHETIC', message: 'synthetic' } } }
    expect((await collect([zero, finish])).result).toEqual([finish])
  })
  it.each(['stop', 'max-tokens', 'tool-calls'] as const)('preserves successful zero usage and exact finish on %s', async kind => {
    const finish: StreamChunk = { type: 'finish', reason: { kind } }
    const result = (await collect([zero, finish])).result
    expect(result).toEqual([zero, finish])
    expect(result[0]).toBe(zero)
    expect(result[1]).toBe(finish)
  })
  it.each([
    { inputTokens: 1, outputTokens: 0 }, { inputTokens: 0, outputTokens: 1 },
    { inputTokens: 0, outputTokens: 0, cacheReadTokens: 1 },
    { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 1 },
    { inputTokens: 0, outputTokens: 0, totalTokens: 1 },
    { inputTokens: 0, outputTokens: 0, reasoningTokens: 1 },
  ])('preserves real failure usage %j', async usage => {
    const chunk: StreamChunk = { type: 'usage', usage }
    expect(isZeroContextUsage(usage)).toBe(false)
    expect((await collect([chunk, failed])).result).toEqual([chunk, failed])
  })
  it('propagates thrown cancellation/transport errors without reporting pending zero', async () => {
    const error = new Error('synthetic abort')
    expect(await collect([zero], error)).toEqual({ result: [], error })
    expect((await collect([zero])).result).toEqual([])
  })
  it('preserves non-terminal samples and content order', async () => {
    const text: StreamChunk = { type: 'text-delta', index: 0, text: 'synthetic' }
    expect((await collect([zero, text, failed])).result).toEqual([zero, text, failed])
  })
})
