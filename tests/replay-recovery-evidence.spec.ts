import { expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { foldReplayRecoveryEvidence, initialReplayRecoveryEvidence, installReplayRecoveryEvidence,
  REPLAY_RECOVERY_EVIDENCE, ReplayRecoveryEvidenceSchema } from '../src/replay-recovery-evidence.ts'

const code = 'COPILOT_RESPONSES_REPLAY_SCOPE_MISMATCH'
const start = { type: 'turn/start', seq: 10, data: { turn: 2 } }
const header = { type: 'request/header', seq: 11, data: { header: { config: { provider: 'github-copilot-preview' } } } }
const end = (message = `${code}: synthetic scope rejection`) => ({
  type: 'turn/end', seq: 12, data: { turn: 2, reason: { kind: 'error', error: { message, code: 'INVALID_REQUEST' } } },
})

it('refolds only the latest owned managed turn failure into content-free recovery evidence', () => {
  const initial = initialReplayRecoveryEvidence()
  const active = foldReplayRecoveryEvidence(foldReplayRecoveryEvidence(initial, start), header)
  const failed = foldReplayRecoveryEvidence(active, end())
  expect(failed).toEqual({ inherited: 0, turn: null, managed: true, failureSeq: 12 })
  expect(JSON.stringify(failed)).not.toContain('synthetic')
  expect(foldReplayRecoveryEvidence(failed, { type: 'model/selection', seq: 13, data: {} })).toBe(failed)
  expect(foldReplayRecoveryEvidence(failed, { ...start, seq: 14, data: { turn: 3 } }).failureSeq).toBeNull()
  expect(initial).toEqual(initialReplayRecoveryEvidence())
})

it('retains an owned rc.2 route across turns that do not append an unchanged request header', () => {
  const first = [start, header, end()].reduce(foldReplayRecoveryEvidence, initialReplayRecoveryEvidence())
  const next = foldReplayRecoveryEvidence(first, { ...start, seq: 13, data: { turn: 3 } })
  expect(next.failureSeq).toBeNull()
  expect(foldReplayRecoveryEvidence(next, { ...end(), seq: 14, data: { ...end().data, turn: 3 } }).failureSeq).toBe(14)
  const changed = foldReplayRecoveryEvidence(next, { ...header, seq: 14,
    data: { header: { config: { provider: 'other' } } } })
  expect(foldReplayRecoveryEvidence(changed, { ...end(), seq: 15, data: { ...end().data, turn: 3 } }).failureSeq).toBeNull()
})

it('rejects generic errors, embedded codes, other routes, unmatched turns and inherited failures', () => {
  const active = foldReplayRecoveryEvidence(foldReplayRecoveryEvidence(initialReplayRecoveryEvidence(), start), header)
  for (const message of ['INVALID_REQUEST', `unrelated ${code}: quoted text`, `${code}suffix: unrelated`, `${code}: ${'x'.repeat(8192)}`]) {
    expect(foldReplayRecoveryEvidence(active, end(message)).failureSeq).toBeNull()
  }
  expect(foldReplayRecoveryEvidence(initialReplayRecoveryEvidence(), end()).failureSeq).toBeNull()
  const other = foldReplayRecoveryEvidence(active, { ...header,
    data: { header: { config: { provider: 'other' } } } })
  expect(foldReplayRecoveryEvidence(other, end()).failureSeq).toBeNull()
  expect(foldReplayRecoveryEvidence(active, { ...end(), data: { ...end().data, turn: 3 } })).toBe(active)
  expect(foldReplayRecoveryEvidence(active, { type: 'user/message', seq: 12, data: { text: code } })).toBe(active)
  expect([start, header, end()].reduce(foldReplayRecoveryEvidence, initialReplayRecoveryEvidence(13)))
    .toEqual(initialReplayRecoveryEvidence(13))
  expect(foldReplayRecoveryEvidence(active, { ...end(), seq: -1 })).toBe(active)
  for (const reason of [{ kind: 'completed' }, { kind: 'aborted' }]) {
    expect(foldReplayRecoveryEvidence(active, { ...end(), data: { turn: 2, reason } }).failureSeq).toBeNull()
  }
})

it('cold-folds the native rc.2 saved failure and removes only its public projection registration', async () => {
  const ctx = new Context()
  try {
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    const session = ctx.sessions.create()
    const started = session.append('turn/start', { turn: 2 })
    const requested = session.append('request/header', { header: { config: {
      provider: 'github-copilot-preview', model: 'synthetic-model',
    } }, reason: 'initial' })
    const failure = session.append('turn/end', { turn: 2, reason: {
      kind: 'error', error: { code: 'INVALID_REQUEST', message: `${code}: synthetic scope rejection` },
    } })
    const seed = [started, requested, failure]
    const original = JSON.stringify(seed)
    const restored = ctx.sessions.create(undefined, { seed })
    const fiber = ctx.plugin({ apply: installReplayRecoveryEvidence })
    await fiber
    const view = ctx.sessionProjections.snapshot(restored, [REPLAY_RECOVERY_EVIDENCE])
    expect(ReplayRecoveryEvidenceSchema.parse(view.values[REPLAY_RECOVERY_EVIDENCE]))
      .toEqual({ inherited: 0, turn: null, managed: true, failureSeq: failure.seq })
    expect(ctx.sessionProjections.checkpoint(restored)[REPLAY_RECOVERY_EVIDENCE]?.ver).toBe(1)
    expect(ReplayRecoveryEvidenceSchema.safeParse({ ...view.values[REPLAY_RECOVERY_EVIDENCE], account: 'forbidden' }).success).toBe(false)
    const child = ctx.sessions.fork(restored)
    expect(ctx.sessionProjections.stateOf(child, REPLAY_RECOVERY_EVIDENCE)?.failureSeq).toBeNull()
    restored.append('turn/start', { turn: 3 })
    expect(ctx.sessionProjections.stateOf(restored, REPLAY_RECOVERY_EVIDENCE)?.failureSeq).toBeNull()
    await fiber.dispose()
    expect(ctx.sessionProjections.snapshot(restored).values).not.toHaveProperty(REPLAY_RECOVERY_EVIDENCE)
    expect(JSON.stringify(seed)).toBe(original)
  } finally { await ctx.fiber.dispose() }
})
