import { z } from 'zod'

export const ReplayRecoveryDurationSchema = z.enum(['next-turn', 'session'])
export type ReplayRecoveryDuration = z.infer<typeof ReplayRecoveryDurationSchema>
export const ReplayRecoveryViewSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('unavailable') }).strict(),
  z.object({
    state: z.enum(['available', 'enabled']),
    revision: z.string().uuid(),
    itemCount: z.number().int().positive().max(512),
    model: z.string().min(1).max(256),
    duration: ReplayRecoveryDurationSchema.optional(),
    expiresAt: z.number().int().nonnegative().optional(),
  }).strict(),
])
export type ReplayRecoveryView = z.infer<typeof ReplayRecoveryViewSchema>

export const REPLAY_FAILURE_PROJECTION = 'githubCopilotReplayFailure'
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
export const ReplayFailureEvidenceSchema = z.object({
  inherited: count,
  failureSeq: count.nullable(),
}).strict()
export type ReplayFailureEvidence = z.infer<typeof ReplayFailureEvidenceSchema>

export function isReplayScopeFailure(message: unknown): boolean {
  return typeof message === 'string'
    && /(?:^|[^A-Z_])COPILOT_RESPONSES_REPLAY_SCOPE_MISMATCH(?:$|[^A-Z_])/.test(message.slice(0, 4096))
}
