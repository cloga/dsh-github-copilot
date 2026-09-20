import { z } from 'zod'
import { COPILOT_USAGE_MAX_AMOUNT, COPILOT_USAGE_MAX_TIMESTAMP } from './copilot-usage-types.ts'
import type { CopilotUsageView, CopilotUsageDiagnostic } from './copilot-usage-types.ts'

const amount = z.number().finite().min(0).max(COPILOT_USAGE_MAX_AMOUNT)
const entitlement = z.union([amount, z.literal(-1), z.string().max(32).regex(/^(?:-1|(?:0|[1-9]\d*)(?:\.\d+)?)$/u)])
  .transform(Number).refine(value => Number.isFinite(value) && value <= COPILOT_USAGE_MAX_AMOUNT)
const snapshot = z.object({
  unlimited: z.boolean(), entitlement: entitlement.optional(),
  percent_remaining: z.number().finite().min(0).max(100).optional(),
  quota_remaining: amount.optional(), credits_used: amount.optional(),
  has_quota: z.boolean().optional(), token_based_billing: z.boolean().optional(),
  quota_reset_at: z.number().int().min(0).max(Math.floor(COPILOT_USAGE_MAX_TIMESTAMP / 1000)).optional(),
})
const response = z.object({
  token_based_billing: z.boolean().optional(), access_type_sku: z.string().max(128).optional(),
  quota_reset_date: z.string().max(64).optional(), quota_reset_date_utc: z.string().max(64).optional(),
  limited_user_reset_date: z.string().max(64).optional(),
  quota_snapshots: z.object({ chat: snapshot.optional(), premium_interactions: snapshot.optional() }).optional(),
  monthly_quotas: z.object({ chat: amount }).optional(),
  limited_user_quotas: z.object({ chat: amount }).optional(),
})

export function unavailableCopilotUsage(
  diagnostic: CopilotUsageDiagnostic, billing: CopilotUsageView['billing'] = 'unknown',
  budget: CopilotUsageView['budget'] = 'unknown',
): CopilotUsageView {
  return { state: diagnostic === 'COPILOT_USAGE_SIGNED_OUT' ? 'signed-out' : 'unavailable', billing, budget, diagnostic }
}

function resetDate(value: string): number | undefined {
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/u.test(value)) return undefined
  // Date.parse normalizes impossible days, so separately validate the calendar date.
  const date = value.slice(0, 10)
  const day = Date.parse(`${date}T00:00:00Z`)
  if (!Number.isFinite(day) || new Date(day).toISOString().slice(0, 10) !== date) return undefined
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= COPILOT_USAGE_MAX_TIMESTAMP ? parsed : undefined
}

/**
 * Pinned VS Code 44825207: parseQuotas/getQuotaUsage and chatStatusDashboard
 * display account amounts directly. Only per-turn nano-AIU uses /1e9; it is
 * intentionally absent here. Pooled credits_used never shares an entitlement.
 */
export function normalizeCopilotUsage(input: unknown, observedAt: number): CopilotUsageView {
  const parsed = response.safeParse(input)
  if (!parsed.success) return unavailableCopilotUsage('COPILOT_USAGE_INVALID_RESPONSE')
  const data = parsed.data
  if (data.token_based_billing === undefined) return unavailableCopilotUsage('COPILOT_USAGE_BILLING_UNKNOWN')
  const billing = data.token_based_billing ? 'credits' : 'requests'
  const quota = data.access_type_sku === 'free_limited_copilot'
    ? data.quota_snapshots?.chat : data.quota_snapshots?.premium_interactions
  const reset = data.quota_reset_date_utc ?? data.quota_reset_date ?? data.limited_user_reset_date
  const accountReset = reset === undefined ? undefined : resetDate(reset)
  if (reset !== undefined && accountReset === undefined) return unavailableCopilotUsage('COPILOT_USAGE_INVALID_RESPONSE', billing)
  const resetAt = quota?.quota_reset_at === undefined ? accountReset : quota.quota_reset_at * 1000
  const dates = { observedAt, ...resetAt === undefined ? {} : { resetAt } }
  if (!quota) {
    const limit = data.monthly_quotas?.chat, remaining = data.limited_user_quotas?.chat
    if (billing === 'requests' && limit !== undefined && limit > 0 && remaining !== undefined && remaining <= limit) {
      return { state: 'ready', billing, budget: 'individual', limit, remaining,
        used: limit - remaining, percentUsed: (limit - remaining) / limit * 100, ...dates }
    }
    return unavailableCopilotUsage('COPILOT_USAGE_SNAPSHOT_MISSING', billing)
  }
  if (quota.token_based_billing !== undefined && quota.token_based_billing !== data.token_based_billing) {
    return unavailableCopilotUsage('COPILOT_USAGE_INVALID_RESPONSE', billing)
  }
  if (quota.unlimited) {
    if (quota.has_quota === false) return unavailableCopilotUsage('COPILOT_USAGE_POOLED_EXHAUSTED', billing, 'pooled')
    if (billing !== 'credits' || quota.credits_used === undefined) {
      return unavailableCopilotUsage('COPILOT_USAGE_POOLED_UNAVAILABLE', billing, 'pooled')
    }
    return { state: 'ready', billing, budget: 'pooled', used: quota.credits_used, ...dates }
  }
  const limit = quota.entitlement, percent = quota.percent_remaining
  if (limit === 0) return unavailableCopilotUsage('COPILOT_USAGE_NO_ALLOCATION', billing, 'individual')
  if ((limit !== undefined && limit < 0) || percent === undefined
    || (limit !== undefined && quota.quota_remaining !== undefined && quota.quota_remaining > limit)) {
    return unavailableCopilotUsage('COPILOT_USAGE_INVALID_RESPONSE', billing)
  }
  if (limit !== undefined && quota.quota_remaining !== undefined
    && Math.abs(quota.quota_remaining / limit * 100 - percent) > 1) {
    return unavailableCopilotUsage('COPILOT_USAGE_INVALID_RESPONSE', billing)
  }
  const remaining = quota.quota_remaining
  return { state: 'ready', billing, budget: 'individual', percentUsed: 100 - percent, ...dates,
    ...limit === undefined ? {} : { limit },
    ...remaining === undefined ? {} : { remaining },
    ...limit === undefined || remaining === undefined ? {} : { used: limit - remaining } }
}
