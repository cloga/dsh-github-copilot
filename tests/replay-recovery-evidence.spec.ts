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
  expect(failed).toEqual({ inherited: 0, turn: null, managed: false, failureSeq: 12 })
  expect(JSON.stringify(failed)).not.toContain('synthetic')
  expect(foldReplayRecoveryEvidence(failed, { type: 'model/selection', seq: 13, data: {} })).toBe(failed)
  expect(foldReplayRecoveryEvidence(failed, { ...start, seq: 14, data: { turn: 3 } }).failureSeq).toBeNull()
  expect(initial).toEqual(initialReplayRecoveryEvidence())
})

it('does not infer a replay rejection from generic errors, another route, user text or copied history', () => {
  const active = foldReplayRecoveryEvidence(foldReplayRecoveryEvidence(initialReplayRecoveryEvidence(), start), header)
  expect(foldReplayRecoveryEvidence(active, end('INVALID_REQUEST')).failureSeq).toBeNull()
  expect(foldReplayRecoveryEvidence(initialReplayRecoveryEvidence(), end()).failureSeq).toBeNull()
  const other = foldReplayRecoveryEvidence(active, { ...header,
    data: { header: { config: { provider: 'other' } } } })
  expect(foldReplayRecoveryEvidence(other, end()).failureSeq).toBeNull()
  expect(foldReplayRecoveryEvidence(active, { ...end(), data: { ...end().data, turn: 3 } })).toBe(active)
  expect(foldReplayRecoveryEvidence(active, { type: 'user/message', seq: 12, data: { text: code } })).toBe(active)
  const copied = [start, header, end()].reduce(foldReplayRecoveryEvidence, initialReplayRecoveryEvidence(13))
  expect(copied).toEqual(initialReplayRecoveryEvidence(13))
  expect(foldReplayRecoveryEvidence(active, { ...end(), seq: -1 })).toBe(active)
})

it('cold-folds the native saved failure through a strict public projection and removes only its registration', async () => {
  const ctx = new Context()
  try {
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    const session = ctx.sessions.create()
    session.append('turn/start', { turn: 2 })
    session.append('request/header', { header: { config: {
      provider: 'github-copilot-preview', model: 'synthetic-model',
    } }, reason: 'initial' })
    const failure = session.append('turn/end', { turn: 2, reason: {
      kind: 'error', error: { code: 'INVALID_REQUEST', message: `${code}: synthetic scope rejection` },
    } })
    const fiber = ctx.plugin({ apply: installReplayRecoveryEvidence })
    await fiber
    const view = ctx.sessionProjections.snapshot(session, [REPLAY_RECOVERY_EVIDENCE])
    expect(ReplayRecoveryEvidenceSchema.parse(view.values[REPLAY_RECOVERY_EVIDENCE]))
      .toEqual({ inherited: 0, turn: null, managed: false, failureSeq: failure.seq })
    expect(ctx.sessionProjections.checkpoint(session)[REPLAY_RECOVERY_EVIDENCE]?.ver).toBe(1)
    expect(ReplayRecoveryEvidenceSchema.safeParse({ ...view.values[REPLAY_RECOVERY_EVIDENCE], account: 'forbidden' }).success).toBe(false)
    session.append('turn/start', { turn: 3 })
    expect(ctx.sessionProjections.stateOf(session, REPLAY_RECOVERY_EVIDENCE)?.failureSeq).toBeNull()
    await fiber.dispose()
    expect(ctx.sessionProjections.snapshot(session).values).not.toHaveProperty(REPLAY_RECOVERY_EVIDENCE)
  } finally { await ctx.fiber.dispose() }
})
