import { z } from 'zod'

export const DIAGNOSTICS_OPERATIONS = [
  'account-global-switch', 'account-session-select', 'account-session-inherit',
  'identity-read', 'identity-flight', 'compaction', 'compaction-summary',
  'collection',
] as const
export const DIAGNOSTICS_STAGES = [
  'admitted', 'rpc-invoked', 'host-received', 'identity-validation', 'model-validation',
  'cas', 'readback', 'response-received', 'decoded', 'client-settled',
  'summary-attempt', 'checkpoint-committed', 'ended',
  'cache-hit', 'joined-flight', 'cooldown', 'dispatched',
] as const
export const DIAGNOSTICS_METRICS = [
  'started', 'stage', 'success', 'no-op', 'cancelled', 'policy-rejected',
  'revoked', 'environment-fault', 'failed', 'unknown', 'interrupted',
  'dropped', 'paused', 'expired', 'clock-discontinuity',
  'pending-sample',
] as const
export const DIAGNOSTICS_REASONS = [
  'none', 'unknown', 'rpc-unavailable', 'decode-invalid',
  'COPILOT_ACCOUNTS_BUSY', 'COPILOT_ACCOUNTS_CONFLICT', 'COPILOT_ACCOUNTS_CHANGED',
  'COPILOT_ACCOUNTS_COMMIT_UNCERTAIN', 'COPILOT_ACCOUNTS_IDENTITY_TIMEOUT',
  'COPILOT_ACCOUNTS_IDENTITY_UNAVAILABLE', 'COPILOT_ACCOUNTS_MODELS_FAILED',
  'COPILOT_ACCOUNTS_SETTINGS_UNAVAILABLE', 'COPILOT_ACCOUNTS_IDENTITY_TLS',
  'COPILOT_ACCOUNTS_IDENTITY_NETWORK', 'COPILOT_ACCOUNTS_IDENTITY_RATE_LIMITED',
  'COPILOT_ACCOUNTS_IDENTITY_AUTH_REJECTED', 'COPILOT_ACCOUNTS_IDENTITY_HTTP_ERROR',
  'COPILOT_ACCOUNTS_IDENTITY_INVALID', 'COPILOT_SESSION_ACCOUNTS_UNAVAILABLE',
  'COPILOT_SESSION_ACCOUNTS_SETTINGS_UNAVAILABLE', 'COPILOT_SESSION_ACCOUNTS_COMMIT_UNCERTAIN',
  'COPILOT_RESPONSES_REPLAY_SCOPE_MISMATCH', 'CONTEXT_WINDOW_EXCEEDED',
  'COPILOT_MANUAL_RECOVERY_FIXED_PREFIX', 'COPILOT_MANUAL_RECOVERY_INDIVISIBLE',
  'COPILOT_MANUAL_RECOVERY_CALL_LIMIT', 'COPILOT_MANUAL_RECOVERY_EMPTY_SUMMARY',
  'COPILOT_MANUAL_RECOVERY_UNBALANCED',
] as const
export const DIAGNOSTICS_MAX_ROWS = 4096
export const DIAGNOSTICS_MAX_BYTES = 2 * 1024 * 1024
export const DIAGNOSTICS_RETENTION_MS = 14 * 24 * 60 * 60 * 1000
export const DIAGNOSTICS_MAX_LIVE = 128
const integer = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const version = z.string().max(64).regex(/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/)
export const DiagnosticsRowSchema = z.object({
  hour: integer.multipleOf(3_600_000), version,
  layer: z.enum(['client', 'host']), operation: z.enum(DIAGNOSTICS_OPERATIONS),
  stage: z.enum(DIAGNOSTICS_STAGES), metric: z.enum(DIAGNOSTICS_METRICS),
  reason: z.enum(DIAGNOSTICS_REASONS), bucket: z.number().int().min(0).max(7), count: integer.min(1),
}).strict()
export const DiagnosticsPendingSchema = z.object({
  version,
  operation: z.enum(DIAGNOSTICS_OPERATIONS), stage: z.enum(DIAGNOSTICS_STAGES),
  bucket: z.number().int().min(0).max(7), count: integer.min(1).max(DIAGNOSTICS_MAX_LIVE),
}).strict()
export const DiagnosticsSnapshotSchema = z.object({
  schemaVersion: z.literal(1), coverageVersion: z.literal(1),
  epoch: integer, updatedAt: integer, rows: z.array(DiagnosticsRowSchema).max(DIAGNOSTICS_MAX_ROWS),
  pending: z.array(DiagnosticsPendingSchema).max(DIAGNOSTICS_MAX_LIVE),
  dropped: integer, clientDropped: integer, clientUnconfirmed: integer,
  saturated: integer, evicted: integer, interrupted: integer,
}).strict()
  .refine(value => value.pending.reduce((sum, row) => sum + row.count, 0) <= DIAGNOSTICS_MAX_LIVE, 'Diagnostics pending capacity exceeded')
  .refine(value => JSON.stringify(value).length <= DIAGNOSTICS_MAX_BYTES, 'Diagnostics capacity exceeded')
export const DiagnosticsViewSchema = z.object({
  enabled: z.boolean(), state: z.enum(['loading', 'ready', 'unavailable', 'error']),
  diagnostic: z.enum(['none', 'storage-unavailable', 'storage-invalid', 'storage-write-failed',
    'profile-unavailable', 'settings-unavailable', 'settings-conflict', 'client-report-failed', 'client-report-revoked', 'closed']),
  persistedAt: integer.optional(), dirty: z.boolean(), snapshot: DiagnosticsSnapshotSchema,
}).strict()
export type DiagnosticsRow = z.infer<typeof DiagnosticsRowSchema>
export type DiagnosticsSnapshot = z.infer<typeof DiagnosticsSnapshotSchema>
export type DiagnosticsView = z.infer<typeof DiagnosticsViewSchema>
export type DiagnosticsOperation = typeof DIAGNOSTICS_OPERATIONS[number]
export type DiagnosticsStage = typeof DIAGNOSTICS_STAGES[number]
export type DiagnosticsMetric = typeof DIAGNOSTICS_METRICS[number]
export type DiagnosticsReason = typeof DIAGNOSTICS_REASONS[number]
export type DiagnosticsOutcome = Exclude<DiagnosticsMetric,
  'started' | 'stage' | 'dropped' | 'paused' | 'expired' | 'clock-discontinuity' | 'pending-sample'>

export function diagnosticsBucket(ms: number): number {
  return [100, 500, 1000, 5000, 15000, 60000, 300000].findIndex(bound => ms < bound) === -1
    ? 7 : [100, 500, 1000, 5000, 15000, 60000, 300000].findIndex(bound => ms < bound)
}
export function diagnosticsReason(error: unknown): DiagnosticsReason {
  const seen = new Set<Error>()
  for (let depth = 0; depth < 8 && error instanceof Error && !seen.has(error); depth++) {
    seen.add(error)
    const nativeCode = 'code' in error ? error.code : undefined
    const typed = DIAGNOSTICS_REASONS.find(code => code !== 'none' && code !== 'unknown' && code === nativeCode)
    if (typed !== undefined) return typed
    const message = error.message.slice(0, 4096)
    for (const code of DIAGNOSTICS_REASONS) {
      if (code.startsWith('COPILOT_') || code === 'CONTEXT_WINDOW_EXCEEDED') {
        if (new RegExp(`(?:^|[^A-Za-z0-9_])${code}(?:$|[^A-Za-z0-9_])`).test(message)) return code
      }
    }
    error = error.cause
  }
  return 'unknown'
}
export function diagnosticsOutcome(reason: DiagnosticsReason): DiagnosticsOutcome {
  if (reason === 'COPILOT_ACCOUNTS_BUSY' || reason === 'COPILOT_ACCOUNTS_CONFLICT') return 'policy-rejected'
  if (reason === 'COPILOT_ACCOUNTS_CHANGED') return 'revoked'
  if (reason.endsWith('SETTINGS_UNAVAILABLE') || reason === 'COPILOT_SESSION_ACCOUNTS_UNAVAILABLE') return 'environment-fault'
  return 'failed'
}
