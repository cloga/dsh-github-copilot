import { z } from 'zod'

export const SessionContinuationPreferenceSchema = z.object({
  sessionId: z.string().min(1).max(256).refine(value => !/[\p{Cc}\p{Cf}]/u.test(value)),
  version: z.literal(1),
  consentedAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  enabled: z.boolean().optional(),
}).strict()
export const SessionContinuationPreferencesSchema = z.array(SessionContinuationPreferenceSchema).max(2048)
  .refine(rows => new Set(rows.map(row => row.sessionId)).size === rows.length)
export type SessionContinuationPreference = z.infer<typeof SessionContinuationPreferenceSchema>
export const ContinuationDefaultHistorySchema = z.array(z.object({
  enabled: z.boolean(), changedAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
}).strict()).max(2048).refine(rows => rows.every((row, index) => index === 0 || row.changedAt > rows[index - 1]!.changedAt))
export type ContinuationDefaultChange = z.infer<typeof ContinuationDefaultHistorySchema>[number]
export const ContinuationDefaultViewSchema = z.object({
  enabled: z.boolean(), revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
}).strict()
export const SessionContinuationViewSchema = z.object({
  enabled: z.boolean(),
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  activeTurnEnabled: z.boolean().optional(),
  source: z.enum(['default', 'session']).optional(),
  nextTurnAuthorized: z.boolean().optional(),
}).strict()
export type SessionContinuationView = z.infer<typeof SessionContinuationViewSchema>
