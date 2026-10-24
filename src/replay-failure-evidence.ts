import type { Context } from '@deepseek-ai/cordis'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { REPLAY_FAILURE_PROJECTION, ReplayFailureEvidenceSchema, isReplayScopeFailure } from './replay-recovery-types.ts'
import type { ReplayFailureEvidence } from './replay-recovery-types.ts'

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap { githubCopilotReplayFailure: ReplayFailureEvidence }
  interface SessionProjectionStateMap { githubCopilotReplayFailure: ReplayFailureEvidence }
}
type Definition = Omit<ProjectionDefinition<typeof REPLAY_FAILURE_PROJECTION>, 'stateSchema' | 'wire'> & {
  stateSchema: typeof ReplayFailureEvidenceSchema
  wire: Omit<NonNullable<ProjectionDefinition<typeof REPLAY_FAILURE_PROJECTION>['wire']>, 'viewSchema'> & {
    viewSchema: typeof ReplayFailureEvidenceSchema
  }
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
export function foldReplayFailure(state: ReplayFailureEvidence, event: unknown): ReplayFailureEvidence {
  if (!record(event) || !Number.isSafeInteger(event.seq) || Number(event.seq) < state.inherited
    || !record(event.data)) return state
  if (event.type === 'turn/start') return { ...state, failureSeq: null }
  if (event.type !== 'turn/end') return state
  const reason = event.data.reason
  const failed = record(reason) && reason.kind === 'error' && record(reason.error)
    && isReplayScopeFailure(reason.error.message)
  return { ...state, failureSeq: failed ? Number(event.seq) : null }
}

/** Refold only the latest terminal classification; never retain errors, payloads or account origin. */
export const replayFailureDefinition = {
  key: REPLAY_FAILURE_PROJECTION,
  stateVersion: 1,
  stateSchema: ReplayFailureEvidenceSchema,
  init: (_header: unknown, inherited = 0): ReplayFailureEvidence => ({ inherited, failureSeq: null }),
  apply: foldReplayFailure,
  wire: { viewSchema: ReplayFailureEvidenceSchema, view: (state: ReplayFailureEvidence) => state },
} satisfies Definition

export function installReplayFailureEvidence(ctx: Context): () => void {
  const registration = ctx.inject(['sessionProjections'], scope => {
    const registry: unknown = scope.get('sessionProjections')
    if (!record(registry) || typeof registry.register !== 'function')
      throw new Error('COPILOT_REPLAY_FAILURE_PROJECTION_UNAVAILABLE')
    const remove: unknown = registry.register(replayFailureDefinition)
    if (typeof remove !== 'function') throw new Error('COPILOT_REPLAY_FAILURE_PROJECTION_DISPOSER_UNAVAILABLE')
    return () => { remove() }
  })
  return () => { void registration.dispose() }
}
