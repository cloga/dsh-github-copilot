import { describe, expect, it } from 'vitest'
import { ContextEvidenceSchema, contextEvidenceDefinition, foldContextEvidence as fold, initialContextEvidence as initial } from '../src/context-evidence.ts'
const route = { provider: 'github-copilot-preview', model: 'synthetic-model' }
const header = (selection = route) => ({ seq: 1, type: 'request/header', data: { header: { config: selection } } })
const usage = (inputTokens: number, type = 'assistant/message', kind = 'stop', seq = 2) => ({
  seq, type, data: { stream: [
    { type: 'chunk', chunk: { type: 'usage', usage: { inputTokens, outputTokens: 0 } } },
    { type: 'chunk', chunk: { type: 'finish', reason: { kind } } },
  ] },
})
describe('separate bounded historical context evidence', () => {
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
    Object.defineProperty(event.data, 'message', { get() { throw new Error('Content must remain opaque') } })
    expect(fold(fold(initial(), header()), event).sample?.tokens).toBe(20)
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
