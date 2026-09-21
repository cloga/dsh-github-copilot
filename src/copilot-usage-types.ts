/** Client-safe account snapshot. Amounts are credits or requests, never token estimates. */
export interface CopilotUsageView {
  readonly state: 'ready' | 'stale' | 'unavailable' | 'signed-out'
  readonly billing: 'credits' | 'requests' | 'unknown'
  readonly budget: 'individual' | 'pooled' | 'unknown'
  readonly used?: number
  readonly remaining?: number
  readonly limit?: number
  readonly percentUsed?: number
  /** Supplier-reported next reset in Unix epoch milliseconds, later than observedAt. */
  readonly resetAt?: number
  readonly observedAt?: number
  readonly diagnostic?: string
}

export const COPILOT_USAGE_MAX_AMOUNT = 1_000_000_000_000
export const COPILOT_USAGE_MAX_TIMESTAMP = 253_402_300_799_999
export const COPILOT_USAGE_DIAGNOSTICS = [
  'COPILOT_USAGE_SIGNED_OUT', 'COPILOT_USAGE_INVALID_GRANT',
  'COPILOT_USAGE_CREDENTIALS_UNAVAILABLE', 'COPILOT_USAGE_ENTERPRISE_UNSUPPORTED',
  'COPILOT_USAGE_ACCOUNT_CHANGED', 'COPILOT_USAGE_DISPOSED',
  'COPILOT_USAGE_BILLING_UNKNOWN', 'COPILOT_USAGE_SNAPSHOT_MISSING',
  'COPILOT_USAGE_INVALID_RESPONSE', 'COPILOT_USAGE_POOLED_UNAVAILABLE',
  'COPILOT_USAGE_POOLED_EXHAUSTED', 'COPILOT_USAGE_NO_ALLOCATION',
  'COPILOT_USAGE_NETWORK', 'COPILOT_USAGE_TIMEOUT', 'COPILOT_USAGE_BODY_TOO_LARGE',
  'COPILOT_USAGE_REDIRECT', 'COPILOT_USAGE_AUTH_REJECTED',
  'COPILOT_USAGE_HTTP_ERROR', 'COPILOT_USAGE_RATE_LIMITED',
] as const
export type CopilotUsageDiagnostic = typeof COPILOT_USAGE_DIAGNOSTICS[number]
