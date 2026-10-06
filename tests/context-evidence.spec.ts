import { describe, expect, it } from 'vitest'
import { ContextEvidenceSchema, contextEvidenceDefinition, foldContextEvidence as fold, initialContextEvidence as initial } from '../src/context-evidence.ts'
const route = { provider: 'github-copilot-preview', model: 'synthetic-model' }
const header = (selection = route) => ({ seq: 1, type: 'request/header', data: { header: { config: selection } } })
const usage = (inputTokens: number, type = 'assistant/message', kind = 'stop', seq = 2) => ({
  seq, type, data: { turn: 1, step: 1, source: route, stream: [
    { type: 'chunk', chunk: { type: 'usage', usage: { inputTokens, outputTokens: 0 } } },
    { type: 'chunk', chunk: { type: 'finish', reason: { kind } } },
  ] },
})
describe('separate bounded historical context evidence', () => {
  const compact = () => [
    header(), usage(100),
    { seq: 3, type: 'compaction/start', data: { compactionId: 'compact' } },
    { seq: 4, type: 'user/message', surfaceOp: { replace: [2] },
      data: { source: { kind: 'compact-checkpoint', compactionId: 'compact' } } },
    { seq: 5, type: 'compaction/end', data: { compactionId: 'compact' } },
  ].reduce(fold, initial())
  it('separates committed compaction, subsequent request success and applicable input sampling', () => {
    let state = compact()
    expect(state.compaction).toMatchObject({ id: 'compact', state: 'completed', request: 'idle', endSeq: 5 })
    expect(state.sample).toBeNull()
    expect(state.invalid).toBe(true)
    state = fold(state, { seq: 6, type: 'step/start', data: { turn: 1, step: 1 } })
    state = fold(state, { ...header(), seq: 7 })
    state = fold(state, { ...usage(0), seq: 8, data: { turn: 1, step: 1, source: route, stream: [
      { type: 'chunk', chunk: { type: 'finish', reason: { kind: 'stop' } } },
    ] } })
    expect(state.compaction?.request).toBe('succeeded')
    expect(state.sample).toBeNull()
    state = fold(state, { seq: 9, type: 'step/start', data: { turn: 1, step: 1 } })
    state = fold(state, { ...header(), seq: 10 })
    state = fold(state, usage(40, 'assistant/message', 'stop', 11))
    expect(state.compaction?.request).toBe('succeeded')
    expect(state.sample?.tokens).toBe(40)
    state = fold(state, { seq: 12, type: 'step/start', data: { turn: 1, step: 1 } })
    state = fold(state, { ...header(), seq: 13 })
    state = fold(state, usage(0, 'assistant/attempt', 'error', 14))
    expect(state.compaction?.request).toBe('failed')
    expect(state.invalid).toBe(true)
    expect(state.sample?.tokens).toBe(40)
  })
  it('requires matching native checkpoint and settlement before claiming compaction completed', () => {
    const start = fold(initial(), { seq: 1, type: 'compaction/start', data: { compactionId: 'c' } })
    expect(fold(start, { seq: 2, type: 'compaction/end', data: { compactionId: 'c' } }).compaction?.state).toBe('unknown')
    expect(fold(start, { seq: 2, type: 'compaction/end', data: { compactionId: 'c', error: 'synthetic' } }).compaction?.state).toBe('failed')
    expect(fold(start, { seq: 2, type: 'compaction/end', data: { compactionId: 'other' } }).compaction?.state).toBe('running')
  })
  it('does not attribute summary output, stale settlements or another route to subsequent chat', () => {
    let state = compact()
    expect(fold(state, usage(50, 'assistant/message', 'stop', 6)).compaction?.request).toBe('idle')
    state = fold(state, { seq: 7, type: 'step/start', data: { turn: 1, step: 1 } })
    state = fold(state, { ...header(), seq: 8 })
    expect(fold(state, usage(50, 'assistant/message', 'stop', 7)).compaction?.request).toBe('pending')
    const conflicting = { ...usage(50, 'assistant/message', 'stop', 9),
      data: { ...usage(50).data, source: { provider: 'other', model: 'other' } } }
    expect(fold(state, conflicting).compaction?.request).toBe('unknown')
    state = fold(state, usage(0, 'assistant/attempt', 'aborted', 9))
    expect(state.compaction?.request).toBe('cancelled')
    state = fold(state, { seq: 10, type: 'model/selection', data: { ...route, model: 'changed' } })
    expect(state.compaction?.request).toBe('unknown')
    expect(state.sample).toBeNull()
  })
  it('replays failed zero samples without discarding the last valid input sample', () => {
    const sample = { ...usage(3), data: { ...usage(3).data, usage: {
      inputTokens: 3, outputTokens: 2839, cacheReadTokens: 670_335, cacheWriteTokens: 1371, totalTokens: 674_548,
    } } }
    const state = [header(), sample, usage(0, 'assistant/attempt', 'error', 3), usage(0, 'assistant/attempt', 'aborted', 4)].reduce(fold, initial())
    expect(state.invalid).toBe(true)
    expect(state.sample).toEqual({ tokens: 671_709, seq: 2, route })
    expect(ContextEvidenceSchema.parse(JSON.parse(JSON.stringify(state)))).toEqual(state)
    expect(contextEvidenceDefinition.key).not.toBe('contextPressure')
  })
  it('does not treat zero successful usage as missing', () => {
    const state = [header(), usage(20), usage(0)].reduce(fold, initial())
    expect(state.sample?.tokens).toBe(0)
    expect(state.invalid).toBe(false)
  })
  it('retains real nonzero failure samples and recovers after a successful request', () => {
    let state = [header(), usage(20), usage(0, 'assistant/attempt', 'error')].reduce(fold, initial())
    state = fold(state, usage(30, 'assistant/attempt', 'error'))
    expect(state.invalid).toBe(false)
    expect(state.sample?.tokens).toBe(30)
  })
  it.each(['compaction/start', 'compaction/summary', 'compaction/end'])('revokes historical counts on %s', type => {
    let state = [header(), usage(20), usage(0, 'assistant/attempt', 'error')].reduce(fold, initial())
    state = fold(state, { seq: 4, type, data: {} })
    expect(state.sample).toBeNull()
    expect(state.invalid).toBe(true)
    expect(state.reason).toBe('compaction')
  })
  it('revokes samples on model changes and never borrows another provider', () => {
    let state = [header(), usage(20)].reduce(fold, initial())
    state = fold(state, header({ provider: 'other', model: 'synthetic-other' }))
    expect(state.sample).toBeNull()
    expect(fold(state, usage(50))).toBe(state)
    expect(fold(initial(), usage(50))).toEqual(initial())
  })
  it('does not access content or encrypted replay when folding', () => {
    const event = usage(20)
    const message = { source: route }
    Object.defineProperty(message, 'content', { get() { throw new Error('Content must remain opaque') } })
    Object.defineProperty(event.data, 'message', { value: message })
    expect(fold(fold(initial(), header()), event).sample?.tokens).toBe(20)
  })
  it('tracks unchanged-header native steps and reads only the settled message source leaves', () => {
    let state = compact()
    state = fold(state, { seq: 6, type: 'step/start', data: { turn: 2, step: 1 } })
    const data = { ...usage(40).data, turn: 2, step: 1, message: { source: route } }
    expect(fold(state, { seq: 7, type: 'assistant/message', data }).compaction?.request).toBe('succeeded')
    expect(fold(state, { seq: 7, type: 'assistant/message', data: { ...data, turn: 1 } }).compaction?.request).toBe('pending')
    expect(fold(state, { seq: 7, type: 'assistant/message', data: { ...data, interrupted: true } }).compaction?.request).toBe('unknown')
    expect(fold(state, { seq: 7, type: 'assistant/message', data: {
      ...data, message: { source: { provider: 'other', model: 'other' } },
    } }).compaction?.request).toBe('unknown')
  })
  it('binds a resumed request to the native step already open before compaction', () => {
    let state = fold(initial(), { seq: 0, type: 'step/start', data: { turn: 1, step: 1 } })
    state = [
      header(),
      { seq: 2, type: 'compaction/start', data: { compactionId: 'c' } },
      { seq: 3, type: 'user/message', data: { source: { kind: 'compact-checkpoint', compactionId: 'c' } } },
      { seq: 4, type: 'compaction/end', data: { compactionId: 'c' } },
      { ...header(), seq: 5 },
      usage(40, 'assistant/message', 'stop', 6),
    ].reduce(fold, state)
    expect(state.compaction?.request).toBe('succeeded')
    expect(state.sample?.tokens).toBe(40)
    state = fold(state, { seq: 7, type: 'step/end', data: { turn: 1, step: 1 } })
    state = fold(state, { ...header(), seq: 8 })
    expect(fold(state, usage(40, 'assistant/message', 'stop', 9)).compaction?.request).toBe('unknown')
  })
  it('rejects invalid and overflowing counts instead of guessing', () => {
    let state = fold(initial(), header())
    state = fold(state, usage(-1))
    expect(state.reason).toBe('unknown')
    expect(state.invalid).toBe(true)
    expect(ContextEvidenceSchema.safeParse({ ...state, secret: 'synthetic' }).success).toBe(false)
  })
  it('revokes samples on native surface replacements but not ordinary appends', () => {
    const state = [header(), usage(20), usage(0, 'assistant/attempt', 'error')].reduce(fold, initial())
    expect(fold(state, { seq: 4, type: 'user/message', surfaceOp: 'append', data: {} })).toBe(state)
    const replaced = fold(state, { seq: 4, type: 'user/message', surfaceOp: { replace: [2] }, data: {} })
    expect(replaced.sample).toBeNull()
    expect(replaced.reason).toBe('compaction')
  })
  it('does not attribute a conflicting settled source to the last header', () => {
    const event = { ...usage(20), data: { ...usage(20).data, source: { provider: 'other', model: 'other' } } }
    expect(fold(fold(initial(), header()), event)).toMatchObject({ sample: null, invalid: true, reason: 'unknown' })
  })
  it('uses the last stream sample and preserves settled message-level precedence', () => {
    const event = usage(20)
    event.data.stream.unshift({ type: 'chunk', chunk: { type: 'usage', usage: { inputTokens: 1, outputTokens: 0 } } })
    const state = fold(initial(), header())
    expect(fold(state, event).sample?.tokens).toBe(20)
    expect(fold(state, { ...event, data: { ...event.data, usage: { inputTokens: 3, outputTokens: 0, cacheReadTokens: 8 } } }).sample?.tokens).toBe(11)
  })
})
