import { describe, expect, it } from 'vitest'
import { turnUsageEvidenceDefinition as definition, isTurnUsageEvidence, turnUsageDiagnostic } from '../src/turn-usage-evidence.ts'

const event = (type: string, data: Record<string, unknown> = {}): {
  type: string; surfaceOp: string; data: Record<string, unknown>
} => ({ type, surfaceOp: 'append', data: { turn: 228, ...data } })
const local = (message = 'Copilot local estimated input budget exceeded (796299 estimated tokens > 781113 budget tokens); requesting stock compaction before provider dispatch.') =>
  event('assistant/attempt', { stream: [{ type: 'chunk', chunk: { type: 'finish', reason: {
    kind: 'error', failure: { code: 'CONTEXT_WINDOW_EXCEEDED', message },
  } } }] })
function fold(events: unknown[]) {
  return definition.buildLocationData({ matches: events.map(event => ({ event })) }, 'turn', null)
}
describe('missing turn usage evidence without fabricated accounting', () => {
  it('explains a recovered local block alongside reported successful steps without summing tokens', () => {
    const message = event('assistant/message', { usage: { inputTokens: 3, outputTokens: 1854, totalTokens: 158746 } })
    Object.defineProperty(message.data, 'message', { get() { throw new Error('Do not read content or replay') } })
    const events = [event('turn/start'), local(), event('compaction/end'), message, event('turn/end')]
    expect(fold(events)?.value).toEqual({ ended: true, hasStart: true, localPreDispatchBlocks: 1, unreportedAttempts: 0 })
    expect(fold(events)?.value).not.toHaveProperty('totalTokens')
  })
  it('does not label generic overflow, provider errors or ambiguous streams as pre-dispatch', () => {
    for (const attempt of [local('provider context exceeded'), local('Copilot local estimated input budget exceeded (1 estimated tokens > 2 budget tokens); requesting stock compaction before provider dispatch.'),
      event('assistant/attempt', { stream: [{ type: 'chunk', chunk: { type: 'finish', reason: { kind: 'error', failure: { code: 'HTTP_ERROR' } } } }] })]) {
      expect(fold([event('turn/start'), attempt, event('turn/end')])?.value)
        .toEqual({ ended: true, hasStart: true, localPreDispatchBlocks: 0, unreportedAttempts: 1 })
    }
    const stream = local().data.stream
    if (!Array.isArray(stream)) throw new Error('Missing fixture stream')
    const attempt = event('assistant/attempt', { stream: [
      ...stream, { type: 'chunk', chunk: { type: 'text', text: 'partial' } },
    ] })
    expect(fold([attempt])?.value.localPreDispatchBlocks).toBe(0)
  })
  it('preserves reported zero and streamed usage without treating either as absent', () => {
    for (const data of [{ usage: { inputTokens: 0, outputTokens: 0 } },
      { stream: [{ type: 'chunk', chunk: { type: 'usage', usage: { inputTokens: 1, outputTokens: 2 } } }] }]) {
      expect(fold([event('turn/start'), event('assistant/message', data), event('turn/end')])?.value.unreportedAttempts).toBe(0)
    }
  })
  it('leaves invalid reported samples to native validation instead of inventing a missing-sample cause', () => {
    const invalid = event('assistant/message', { usage: { inputTokens: -1, outputTokens: 2, totalTokens: 1 } })
    const evidence = fold([event('turn/start'), invalid, event('turn/end')])?.value
    expect(evidence?.unreportedAttempts).toBe(0)
    expect(turnUsageDiagnostic(228, { turn: 228, seq: 42 }, evidence, true))
      .toEqual({ localPreDispatchBlocks: 0, unreportedAttempts: 0, incompleteHistory: false })
    expect(fold([event('assistant/attempt', { usage: { inputTokens: 1 } })])?.value.unreportedAttempts).toBe(1)
  })
  it('retains paging uncertainty and never carries evidence across turns or nonappend messages', () => {
    expect(fold([local(), event('turn/end')])?.value.hasStart).toBe(false)
    expect(definition.match({ ...event('assistant/message'), surfaceOp: 'replace' })).toBeNull()
    expect(fold([event('turn/start'), { ...local(), data: { ...local().data, turn: 229 } }, event('turn/end')])?.value.localPreDispatchBlocks).toBe(0)
    expect(definition.buildLocationData({ matches: [] }, 'turn', null)).toBeNull()
  })
  it('matches live and historical fold and reuses unchanged snapshots', () => {
    const events = [event('turn/start'), local(), event('turn/end')]
    let state = definition.start({ matches: [] }, { event: events[0] })
    for (const event of events.slice(1)) state = definition.update({ state, matches: [] }, { event })
    const live = definition.buildLocationData({ state, matches: [] }, 'turn', null)
    expect(live).toEqual(fold(events))
    expect(definition.buildLocationData({ state, matches: [] }, 'turn', live)).toBe(live)
    expect(isTurnUsageEvidence(live?.value)).toBe(true)
    expect(isTurnUsageEvidence({ ...live?.value, unreportedAttempts: -1 })).toBe(false)
  })
  it('never substitutes a diagnostic for native totals or guesses completion and provider', () => {
    const evidence = fold([event('turn/start'), local(), event('turn/end')])?.value
    expect(turnUsageDiagnostic(228, { turn: 228, seq: 42 }, evidence, false))
      .toEqual({ localPreDispatchBlocks: 1, unreportedAttempts: 0, incompleteHistory: false })
    expect(turnUsageDiagnostic(228, { turn: 228, seq: 42 }, undefined, true)?.incompleteHistory).toBe(true)
    for (const tail of [undefined, { turn: 229, seq: 42 }, { turn: 228 }, { turn: 228, seq: 42, tokenUsage: {} }]) {
      expect(turnUsageDiagnostic(228, tail, evidence, true)).toBeUndefined()
    }
    expect(turnUsageDiagnostic(228, { turn: 228, seq: 42 }, undefined, false)).toBeUndefined()
    expect(turnUsageDiagnostic(228, { turn: 228, seq: 42 }, { ...evidence, ended: false }, false)).toBeUndefined()
  })
})
