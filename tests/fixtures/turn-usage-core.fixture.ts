/** Synthetic accounting evidence on unchanged official rc.2; no live provider calls or history writes. */
import { createAssistantMessage } from '@deepseek-ai/dsh-llm'
import { SessionSeq } from '@deepseek-ai/dsh-session/types'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { deriveTurnTokenUsage } from '@deepseek-ai/dsh-token-meter/client'
import { beforeAll, describe, expect, it } from 'vitest'
import { turnUsageEvidenceDefinition as definition, turnUsageDiagnostic } from '../../src/turn-usage-evidence.ts'
import { REQUEST_BODY_TIMEOUT_MARKER } from '../../src/request-body-timeout-marker.ts'
import { turnModelProvenanceDefinition } from '../../src/turn-model-provenance.ts'
import type { RetryId } from '@deepseek-ai/dsh-llm-retry/types'

const usage = { inputTokens: 3, outputTokens: 113, totalTokens: 32601, cacheReadTokens: 30237, cacheWriteTokens: 2248 }
beforeAll(() => {
  expect(process.env.DSH_CORE_EVIDENCE).toBe('tagged-source-runtime')
  expect(process.env.DSH_PUBLISHED_CORE_RELEASE).toBe('0.2.0-rc.2')
})
function reply(seq: number, step: number): SessionEvent<'assistant/message'> {
  return { type: 'assistant/message', seq: SessionSeq(seq), time: seq, surfaceOp: 'append', data: {
    turn: 228, step, usage, stream: [{ type: 'chunk', time: seq, chunk: { type: 'usage', usage } }],
    message: createAssistantMessage({ content: [{ type: 'text', text: 'synthetic completion' }],
      source: { provider: 'github-copilot-preview', model: 'fixture-model' } }),
  } }
}
function start(seq: number, step: number): SessionEvent<'step/start'> {
  return { seq: SessionSeq(seq), time: seq, type: 'step/start', data: { turn: 228, step } }
}
function end(seq: number, step: number): SessionEvent<'step/end'> {
  return { seq: SessionSeq(seq), time: seq, type: 'step/end', data: { turn: 228, step } }
}
describe('missing turn usage on unchanged official accounting', () => {
  it.each(['aborted', 'error'] as const)('retains native whole-turn accounting for a sampled %s attempt after successful steps', kind => {
    const zero = { inputTokens: 0, outputTokens: 0, totalTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
    const events: SessionEvent[] = [
      { seq: SessionSeq(1), time: 1, type: 'turn/start', data: { turn: 228 } },
      start(2, 1), reply(3, 1), end(4, 1), start(5, 2),
      { seq: SessionSeq(6), time: 6, type: 'assistant/attempt', data: {
        turn: 228, step: 2, stream: [
          { type: 'chunk', time: 6, chunk: { type: 'usage', usage: zero } },
          { type: 'chunk', time: 6, chunk: {
            type: 'finish', reason: { kind, failure: { code: 'ABORTED', message: 'synthetic' } },
          } },
        ],
      } },
      end(7, 2),
      { seq: SessionSeq(8), time: 8, type: 'turn/end', data: { turn: 228, reason: { kind: 'completed' } } },
    ]
    const original = JSON.stringify(events)
    const tokenUsage = deriveTurnTokenUsage(events)
    expect(tokenUsage?.routes).toBeUndefined()
    expect(turnModelProvenanceDefinition.buildLocationData({ matches: events.map(event => ({ event })) }, 'turn', null)?.value)
      .toMatchObject({ incomplete: true, routes: [{ provider: 'github-copilot-preview', model: 'fixture-model' }] })
    expect(tokenUsage).toMatchObject({
      uncachedInputTokens: usage.inputTokens, outputTokens: usage.outputTokens, totalTokens: usage.totalTokens,
      cacheReadTokens: usage.cacheReadTokens, cacheWriteTokens: usage.cacheWriteTokens,
    })
    const evidence = definition.buildLocationData({ matches: events.map(event => ({ event })) }, 'turn', null)?.value
    expect(evidence?.unreportedAttempts).toBe(0)
    expect(turnUsageDiagnostic(228, { turn: 228, seq: 8, tokenUsage }, evidence, true)).toBeUndefined()
    expect(JSON.stringify(events)).toBe(original)
  })
  it('associates a recorded 408 with its missing sample and exact retry without restoring the native total', () => {
    const retryId = 'synthetic-retry' as RetryId
    const failure = { code: 'HTTP_ERROR' as const, message: `${REQUEST_BODY_TIMEOUT_MARKER} Synthetic bounded guidance.` }
    const completion = reply(6, 2)
    const events: SessionEvent[] = [
      { seq: SessionSeq(1), time: 1, type: 'turn/start', data: { turn: 228 } },
      start(2, 2),
      { seq: SessionSeq(3), time: 3, type: 'assistant/attempt', data: {
        turn: 228, step: 2, stream: [{ type: 'chunk', time: 3, chunk: {
          type: 'finish', reason: { kind: 'error', failure },
        } }],
      } },
      { seq: SessionSeq(4), time: 4, type: 'llm/retry', data: {
        retryId, turn: 228, step: 2, provider: 'github-copilot-preview', mode: 'normal',
        policyKey: 'synthetic', retry: 1, maxRetries: 2, delayMs: 0, failure,
      } },
      { seq: SessionSeq(5), time: 5, type: 'llm/retry-started', data: { retryId, turn: 228, step: 2, retry: 1 } },
      { ...completion, data: { ...completion.data, stream: [...completion.data.stream,
        { type: 'chunk', time: 6, chunk: { type: 'finish', reason: { kind: 'stop' } } }] } },
      end(7, 2),
      { seq: SessionSeq(8), time: 8, type: 'turn/end', data: { turn: 228, reason: { kind: 'completed' } } },
    ]
    const original = JSON.stringify(events)
    expect(deriveTurnTokenUsage(events)).toBeUndefined()
    const evidence = definition.buildLocationData({ matches: events.map(event => ({ event })) }, 'turn', null)?.value
    expect(turnUsageDiagnostic(228, { turn: 228, seq: 8 }, evidence, true)).toMatchObject({
      unreportedAttempts: 1, requestBodyTimeouts: 1, timeoutDetails: [{ step: 2, seq: 3, recovered: true }],
    })
    expect(JSON.stringify(events)).toBe(original)
    expect(deriveTurnTokenUsage(events)).toBeUndefined()
  })
  it('reproduces the finish-only local block and explains it without changing native accounting', () => {
    const events: SessionEvent[] = [
      { seq: SessionSeq(1), time: 1, type: 'turn/start', data: { turn: 228 } },
      start(2, 1), reply(3, 1), end(4, 1), start(5, 2),
      { seq: SessionSeq(6), time: 6, type: 'assistant/attempt', data: {
        turn: 228, step: 2, stream: [{ type: 'chunk', time: 6, chunk: {
          type: 'finish', reason: { kind: 'error', failure: {
            code: 'CONTEXT_WINDOW_EXCEEDED',
            message: 'Copilot local estimated input budget exceeded (796299 estimated tokens > 781113 budget tokens); requesting stock compaction before provider dispatch.',
          } },
        } }],
      } },
      reply(7, 2), end(8, 2),
      { seq: SessionSeq(9), time: 9, type: 'turn/end', data: { turn: 228, reason: { kind: 'completed' } } },
    ]
    const original = JSON.stringify(events)
    expect(deriveTurnTokenUsage(events)).toBeUndefined()
    const evidence = definition.buildLocationData({ matches: events.map(event => ({ event })) }, 'turn', null)?.value
    expect(turnUsageDiagnostic(228, { turn: 228, seq: 9 }, evidence, true))
      .toEqual({ localPreDispatchBlocks: 1, unreportedAttempts: 0, incompleteHistory: false })
    expect(JSON.stringify(events)).toBe(original)
    expect(deriveTurnTokenUsage(events)).toBeUndefined()
  })
  it('leaves a complete native total as the only usage disclosure', () => {
    const events: SessionEvent[] = [
      { seq: SessionSeq(1), time: 1, type: 'turn/start', data: { turn: 228 } },
      start(2, 1), reply(3, 1), end(4, 1),
      { seq: SessionSeq(5), time: 5, type: 'turn/end', data: { turn: 228, reason: { kind: 'completed' } } },
    ]
    const tokenUsage = deriveTurnTokenUsage(events)
    expect(tokenUsage).toMatchObject({ totalTokens: 32601 })
    const evidence = definition.buildLocationData({ matches: events.map(event => ({ event })) }, 'turn', null)?.value
    expect(turnUsageDiagnostic(228, { turn: 228, seq: 5, tokenUsage }, evidence, true)).toBeUndefined()
  })
})
