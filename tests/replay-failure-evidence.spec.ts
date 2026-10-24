import { Context } from '@deepseek-ai/cordis'
import { expect, it, vi } from 'vitest'
import { foldReplayFailure, installReplayFailureEvidence, replayFailureDefinition } from '../src/replay-failure-evidence.ts'
import { isReplayScopeFailure, ReplayFailureEvidenceSchema } from '../src/replay-recovery-types.ts'

const failure = (seq = 42, message = 'COPILOT_RESPONSES_REPLAY_SCOPE_MISMATCH: synthetic scope rejection') => ({
  seq, type: 'turn/end', data: { turn: 3, reason: { kind: 'error', error: { code: 'INVALID_REQUEST', message } } },
})
it('cold-folds only the latest exact terminal replay failure without retaining raw errors or request evidence', () => {
  const initial = replayFailureDefinition.init(undefined)
  const event = failure()
  const before = JSON.stringify(event)
  const state = foldReplayFailure(initial, event)
  expect(state).toEqual({ inherited: 0, failureSeq: 42 })
  expect(ReplayFailureEvidenceSchema.parse(state)).toEqual(state)
  expect(JSON.stringify(event)).toBe(before)
  expect(foldReplayFailure(initial, { ...event, type: 'assistant/attempt' })).toBe(initial)
  expect(foldReplayFailure(state, { seq: 43, type: 'turn/start', data: { turn: 4 } })).toEqual(initial)
  expect(foldReplayFailure(state, { seq: 43, type: 'turn/end', data: { reason: { kind: 'completed' } } })).toEqual(initial)
  expect(foldReplayFailure(state, failure(43, 'generic INVALID_REQUEST'))).toEqual(initial)
  expect(foldReplayFailure(state, failure(43, 'NOT_COPILOT_RESPONSES_REPLAY_SCOPE_MISMATCH'))).toEqual(initial)
  expect(foldReplayFailure(state, { ...event, seq: Number.NaN })).toBe(state)
  expect(foldReplayFailure(state, { ...event, seq: -1 })).toBe(state)
  expect(isReplayScopeFailure(null)).toBe(false)
})
it('does not offer recovery for a copied fork or child failure and admits only the new owner tail', () => {
  const initial = replayFailureDefinition.init(undefined, 50)
  expect(foldReplayFailure(initial, failure(42))).toBe(initial)
  expect(foldReplayFailure(initial, failure(50))).toEqual({ inherited: 50, failureSeq: 50 })
  expect(foldReplayFailure(initial, { seq: 51, type: 'user/message', data: {
    content: [{ type: 'text', text: 'COPILOT_RESPONSES_REPLAY_SCOPE_MISMATCH' }],
  } })).toBe(initial)
})
it('registers and removes only its public projection contribution', async () => {
  const ctx = new Context()
  const remove = vi.fn()
  const register = vi.fn(() => remove)
  const ready = new Promise<void>(resolve => {
    register.mockImplementation(() => { resolve(); return remove })
  })
  const provide = (key: Extract<keyof Context, string>, value: object) => ctx.provide(key, value)
  provide('sessionProjections', { register })
  const dispose = installReplayFailureEvidence(ctx)
  try {
    await ready
    expect(register).toHaveBeenCalledExactlyOnceWith(replayFailureDefinition)
    dispose()
    await ctx.fiber.dispose()
    expect(remove).toHaveBeenCalledOnce()
  } finally { await ctx.fiber.dispose() }
})
