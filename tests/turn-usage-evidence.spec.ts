import { describe, expect, it } from 'vitest'
import { turnUsageEvidenceDefinition as definition, isTurnUsageEvidence, turnUsageDiagnostic } from '../src/turn-usage-evidence.ts'
import { REQUEST_BODY_TIMEOUT_MARKER } from '../src/request-body-timeout-marker.ts'

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
const timeout = (seq = 3, step = 2, message = `${REQUEST_BODY_TIMEOUT_MARKER} Safe diagnostic guidance.`) =>
  ({ ...event('assistant/attempt', { step, stream: [{ type: 'chunk', chunk: {
    type: 'finish', reason: { kind: 'error', failure: { code: 'HTTP_ERROR', message } },
  } }] }), seq })
const retry = (type: string, seq: number, step = 2) => ({ ...event(type, { step, retryId: 'fixture-retry', retry: 1 }), seq })
const success = (seq = 6, step = 2) => ({ ...event('assistant/message', { step, usage: {},
  stream: [{ type: 'chunk', chunk: { type: 'finish', reason: { kind: 'stop' } } }],
}), seq })
it('retains same-attempt timeout coordinates and proven same-step retry completion without filling usage', () => {
  const events = [event('turn/start'), timeout(), retry('llm/retry', 4), retry('llm/retry-started', 5), success(), event('turn/end')]
  const original = JSON.stringify(events)
  const evidence = fold(events)?.value
  expect(evidence).toMatchObject({ unreportedAttempts: 1, requestBodyTimeouts: 1,
    timeoutDetails: [{ step: 2, seq: 3, recovered: true }] })
  expect(turnUsageDiagnostic(228, { turn: 228, seq: 7 }, evidence, true)).toMatchObject({
    requestBodyTimeouts: 1, timeoutDetails: [{ step: 2, seq: 3, recovered: true }],
  })
  let state = definition.start({ matches: [] }, { event: events[0] })
  for (const event of events.slice(1)) state = definition.update({ state, matches: [] }, { event })
  expect(definition.buildLocationData({ state, matches: [] }, 'turn', null)).toEqual(fold(events))
  expect(JSON.stringify(events)).toBe(original)
})
it('does not infer timeout from generic text, cancellation or another settlement', () => {
  for (const attempt of [timeout(3, 2, 'HTTP 408'), timeout(3, 2, `Untrusted prefix ${REQUEST_BODY_TIMEOUT_MARKER}`),
    timeout(3, 2, `${REQUEST_BODY_TIMEOUT_MARKER}${'x'.repeat(8192)}`),
    event('assistant/attempt', { stream: [{ type: 'chunk', chunk: { type: 'finish', reason: {
      kind: 'error', failure: { code: 'ABORTED', message: REQUEST_BODY_TIMEOUT_MARKER },
    } } }] })]) {
    expect(fold([attempt])?.value.requestBodyTimeouts).toBeUndefined()
  }
  expect(fold([timeout(), success()])?.value.timeoutDetails?.[0]?.recovered).toBe(false)
  expect(fold([timeout(), retry('llm/retry-started', 5), success()])?.value.timeoutDetails?.[0]?.recovered).toBe(false)
})
it('keeps incomplete, reordered, interrupted and cross-step retry evidence uncertain', () => {
  for (const events of [
    [timeout(), retry('llm/retry', 4), retry('llm/retry-started', 5, 3), success()],
    [timeout(), retry('llm/retry', 4), retry('llm/retry-started', 2), success()],
    [timeout(), retry('llm/retry', 4), retry('llm/retry-started', 5), success(6, 3)],
    [timeout(), retry('llm/retry', 4), retry('llm/retry-started', 5), retry('step/end', 6), success(7)],
    [timeout(), retry('llm/retry', 4), retry('llm/retry-started', 5), timeout(6), success(7)],
    [timeout(), retry('llm/retry', 4), { ...retry('llm/retry-started', 5), data: { turn: 228, step: 2, retryId: 'other', retry: 1 } }, success()],
  ]) expect(fold(events)?.value.timeoutDetails?.[0]?.recovered).toBe(false)
})
it('bounds detailed failure evidence while retaining missing counts and legacy projection compatibility', () => {
  const evidence = fold(Array.from({ length: 20 }, (_, i) => timeout(i)))?.value
  expect(evidence).toMatchObject({ requestBodyTimeouts: 20, unreportedAttempts: 20 })
  expect(evidence?.timeoutDetails).toHaveLength(8)
  expect(isTurnUsageEvidence(evidence)).toBe(true)
  expect(isTurnUsageEvidence({ ...evidence, requestBodyTimeouts: 21 })).toBe(false)
  expect(isTurnUsageEvidence({ ...evidence, timeoutDetails: [{ seq: -1, recovered: false }] })).toBe(false)
  expect(isTurnUsageEvidence({ ended: true, hasStart: true, localPreDispatchBlocks: 0, unreportedAttempts: 1 })).toBe(true)
  expect(fold([timeout(), event('turn/end')])?.value.hasStart).toBe(false)
})
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
