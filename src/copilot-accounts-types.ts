export const COPILOT_ACCOUNT_ID_PATTERN = /^(?:canonical|[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/u
export const COPILOT_ACCOUNTS_MAX = 32
export const GITHUB_ACCOUNT_LOGIN_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9_-]*[a-zA-Z0-9])?$/u
export const COPILOT_ACCOUNTS_DIAGNOSTICS = [
  'COPILOT_ACCOUNTS_SELECTOR_INVALID', 'COPILOT_ACCOUNTS_SETTINGS_UNAVAILABLE',
  'COPILOT_ACCOUNTS_SELECTED_MISSING', 'COPILOT_ACCOUNTS_CREDENTIALS_UNAVAILABLE',
  'COPILOT_ACCOUNTS_CHANGED', 'COPILOT_ACCOUNTS_BUSY', 'COPILOT_ACCOUNTS_CONFLICT',
  'COPILOT_ACCOUNTS_COMMIT_UNCERTAIN', 'COPILOT_ACCOUNTS_MODELS_FAILED',
  'COPILOT_ACCOUNTS_IDENTITY_UNAVAILABLE', 'COPILOT_ACCOUNTS_IDENTITY_INVALID',
  'COPILOT_ACCOUNTS_IDENTITY_CHANGED', 'COPILOT_ACCOUNTS_DUPLICATE',
  'COPILOT_ACCOUNTS_ENTERPRISE_UNSUPPORTED', 'COPILOT_ACCOUNTS_ROUTE_BLOCKED',
  'COPILOT_ACCOUNTS_EVIDENCE_INCOMPLETE', 'COPILOT_ACCOUNTS_LIMIT',
  'COPILOT_ACCOUNTS_AUTH_FAILED', 'COPILOT_ACCOUNTS_AUTH_UNAVAILABLE',
  'COPILOT_ACCOUNTS_ACTIVE_REMOVE_BLOCKED', 'COPILOT_ACCOUNTS_REMOVE_FAILED',
  'COPILOT_ACCOUNTS_DISPOSED',
] as const
export type CopilotAccountsDiagnostic = typeof COPILOT_ACCOUNTS_DIAGNOSTICS[number]
export interface CopilotAccountIdentity { readonly login: string; readonly userId: number }
export interface CopilotAccountView {
  readonly id: string
  readonly identity?: CopilotAccountIdentity
  readonly identityState: 'ready' | 'unavailable' | 'unknown'
  readonly configured: boolean
}
export interface CopilotAccountsNotice { readonly message: string; readonly url?: string; readonly code?: string }
export interface CopilotAccountsView {
  readonly state: 'ready' | 'error'
  readonly activeAccountId: string
  readonly revision?: number
  readonly writable: boolean
  readonly switchable: boolean
  readonly accounts: readonly CopilotAccountView[]
  readonly operation?: 'authorizing' | 'switching'
  readonly notices: readonly CopilotAccountsNotice[]
  readonly diagnostic?: CopilotAccountsDiagnostic
}
/** Host-only, immutable addressing. Never serialize this object into a Remote. */
export interface CopilotAccountBinding {
  readonly accountId: string
  readonly key: string
  readonly generation: number
  assertCurrent(): void
}
export interface CopilotAccountLease {
  readonly binding: CopilotAccountBinding
  release(): void
}
