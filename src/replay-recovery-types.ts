import { z } from 'zod'

export const ReplayRecoveryViewSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('unavailable') }).strict(),
  z.object({
    state: z.enum(['available', 'enabled']),
    revision: z.string().uuid(),
    itemCount: z.number().int().positive().max(512),
    model: z.string().min(1).max(256),
  }).strict(),
])
export type ReplayRecoveryView = z.infer<typeof ReplayRecoveryViewSchema>
