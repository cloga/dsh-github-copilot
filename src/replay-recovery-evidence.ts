import type { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'

export const REPLAY_RECOVERY_EVIDENCE = 'githubCopilotReplayRecoveryEvidence'
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
export const ReplayRecoveryEvidenceSchema = z.object({
  inherited: count,
  turn: count.nullable(),
  managed: z.boolean(),
  failureSeq: count.nullable(),
}).strict()
export type ReplayRecoveryEvidence = z.infer<typeof ReplayRecoveryEvidenceSchema>
declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap { githubCopilotReplayRecoveryEvidence: ReplayRecoveryEvidence }
  interface SessionProjectionStateMap { githubCopilotReplayRecoveryEvidence: ReplayRecoveryEvidence }
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
export function initialReplayRecoveryEvidence(inherited = 0): ReplayRecoveryEvidence {
  return { inherited, turn: null, managed: false, failureSeq: null }
}
/** A historical fixed-code notice is not current account proof or recovery authorization. */
export function foldReplayRecoveryEvidence(state: ReplayRecoveryEvidence, event: unknown): ReplayRecoveryEvidence {
  if (!record(event) || !count.safeParse(event.seq).success || Number(event.seq) < state.inherited
    || !record(event.data)) return state
  const data = event.data
  if (event.type === 'turn/start') {
    const turn = count.safeParse(data.turn)
    return { ...state, turn: turn.success ? turn.data : null, managed: false, failureSeq: null }
  }
  if (state.turn === null) return state
  if (event.type === 'request/header') {
    const config = record(data.header) ? data.header.config : undefined
    return { ...state, managed: record(config) && config.provider === 'github-copilot-preview' }
  }
  if (event.type !== 'turn/end' || data.turn !== state.turn) return state
  const reason = data.reason
  const error = record(reason) && reason.kind === 'error' ? reason.error : undefined
  const rejected = record(error) && (error.code === 'COPILOT_RESPONSES_REPLAY_SCOPE_MISMATCH'
    || typeof error.message === 'string' && error.message.length <= 8192
      && /(?:^|\b)COPILOT_RESPONSES_REPLAY_SCOPE_MISMATCH:/.test(error.message))
  return { ...state, turn: null, managed: false,
    failureSeq: state.managed && rejected ? Number(event.seq) : null }
}
export const replayRecoveryEvidenceDefinition = {
  key: REPLAY_RECOVERY_EVIDENCE,
  stateVersion: 1,
  stateSchema: ReplayRecoveryEvidenceSchema,
  init: (_header: unknown, inherited = 0) => initialReplayRecoveryEvidence(inherited),
  apply: foldReplayRecoveryEvidence,
  wire: { viewSchema: ReplayRecoveryEvidenceSchema, view: (state: ReplayRecoveryEvidence) => state },
}
export function installReplayRecoveryEvidence(ctx: Context): void {
  ctx.inject(['sessionProjections'], scope => {
    const registry: unknown = scope.get('sessionProjections')
    if (!record(registry) || typeof registry.register !== 'function') {
      scope.logger.warn('COPILOT_REPLAY_RECOVERY_PROJECTION_UNAVAILABLE')
      return
    }
    const remove: unknown = registry.register(replayRecoveryEvidenceDefinition)
    if (typeof remove !== 'function') throw new Error('COPILOT_REPLAY_RECOVERY_PROJECTION_DISPOSER_UNAVAILABLE')
    return () => { remove() }
  })
}
