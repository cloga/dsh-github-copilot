import { describe, expect, it } from 'vitest'
import { normalizeCopilotUsage } from '../src/copilot-usage-normalize.ts'

const observedAt = 1_800_000_000_000
function payload(snapshot: object = {}, billing: unknown = true) {
  return { token_based_billing: billing, quota_snapshots: { premium_interactions: {
    unlimited: false, entitlement: '100', quota_remaining: 75, percent_remaining: 75, ...snapshot,
  } } }
}

describe('Copilot account quota normalization', () => {
  it('keeps official account amounts in credits, not nano-AIU or cents', () => {
    expect(normalizeCopilotUsage(payload({ credits_used: 900 }), observedAt)).toEqual({
      state: 'ready', billing: 'credits', budget: 'individual',
      used: 25, remaining: 75, limit: 100, percentUsed: 25, observedAt,
    })
  })
  it('never invents precise amounts from a rounded percentage', () => {
    expect(normalizeCopilotUsage(payload({ quota_remaining: undefined }), observedAt))
      .toEqual({ state: 'ready', billing: 'credits', budget: 'individual', percentUsed: 25, limit: 100, observedAt })
    expect(normalizeCopilotUsage(payload({ entitlement: undefined, quota_remaining: undefined }), observedAt))
      .toEqual({ state: 'ready', billing: 'credits', budget: 'individual', percentUsed: 25, observedAt })
  })
  it('never gives pooled consumed credits a denominator', () => {
    expect(normalizeCopilotUsage(payload({ unlimited: true, entitlement: '-1', credits_used: 12.5 }), observedAt))
      .toEqual({ state: 'ready', billing: 'credits', budget: 'pooled', used: 12.5, observedAt })
    expect(normalizeCopilotUsage(payload({ unlimited: true }), observedAt).diagnostic).toBe('COPILOT_USAGE_POOLED_UNAVAILABLE')
    expect(normalizeCopilotUsage(payload({ unlimited: true, credits_used: 12, has_quota: false }), observedAt).diagnostic)
      .toBe('COPILOT_USAGE_POOLED_EXHAUSTED')
  })
  it('distinguishes explicit legacy requests and missing billing metadata', () => {
    expect(normalizeCopilotUsage(payload({}, false), observedAt)).toMatchObject({ billing: 'requests', used: 25 })
    const missing = payload(); delete (missing as { token_based_billing?: unknown }).token_based_billing
    expect(normalizeCopilotUsage(missing, observedAt)).toMatchObject({
      state: 'unavailable', billing: 'unknown', diagnostic: 'COPILOT_USAGE_BILLING_UNKNOWN',
    })
    expect(normalizeCopilotUsage({ token_based_billing: false, monthly_quotas: { chat: 50 },
      limited_user_quotas: { chat: 20 } }, observedAt)).toMatchObject({
      billing: 'requests', used: 30, remaining: 20, limit: 50, percentUsed: 60,
    })
  })
  it.each([
    { entitlement: 'NaN' }, { entitlement: '' }, { entitlement: '1e3' },
    { entitlement: 1e30 }, { entitlement: -1 }, { quota_remaining: -1 },
    { quota_remaining: 101 }, { quota_remaining: Infinity }, { percent_remaining: 101 },
    { percent_remaining: NaN }, { percent_remaining: 20 }, { unlimited: 'true' },
    { credits_used: -1 }, { credits_used: '12' }, { token_based_billing: false },
  ])('rejects malformed, overlarge or inconsistent fields %j', snapshot => {
    expect(normalizeCopilotUsage(payload(snapshot), observedAt)).toMatchObject({
      state: 'unavailable', diagnostic: 'COPILOT_USAGE_INVALID_RESPONSE',
    })
  })
  it('validates explicit reset dates and prefers snapshot epoch seconds', () => {
    expect(normalizeCopilotUsage(payload({ quota_reset_at: 1_900_000_000 }), observedAt).resetAt).toBe(1_900_000_000_000)
    expect(normalizeCopilotUsage({ ...payload(), quota_reset_date: '2027-01-01' }, observedAt).resetAt)
      .toBe(Date.parse('2027-01-01T00:00:00Z'))
    for (const reset of ['2027-02-30', 'not a date', '', '2027-01-01T25:00:00Z']) {
      expect(normalizeCopilotUsage({ ...payload(), quota_reset_date: reset }, observedAt).state).toBe('unavailable')
    }
    expect(normalizeCopilotUsage(payload(), observedAt).resetAt).toBeUndefined()
  })
  it('uses the free chat quota instead of a zero premium allocation', () => {
    expect(normalizeCopilotUsage({ ...payload({ entitlement: '0', quota_remaining: 0, percent_remaining: 0 }),
      access_type_sku: 'free_limited_copilot', quota_snapshots: { chat: {
        unlimited: false, entitlement: '50', percent_remaining: 80, quota_remaining: 40,
      } } }, observedAt)).toMatchObject({ limit: 50, used: 10 })
  })
})
