import type { CopilotAccountIdentity } from './copilot-accounts-types.ts'

export const COPILOT_LOGIN_HOST_PATTERN = /^(?:github\.com|[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.ghe\.com)$/u
export class CopilotLoginEnvironmentError extends Error {
  constructor() { super('COPILOT_ACCOUNTS_ENTERPRISE_UNSUPPORTED') }
}

/** Validate the original spelling before URL parsing can discard ports or paths. */
export function copilotLoginHost(value: string | undefined = undefined): string {
  if (value === undefined) return 'github.com'
  if (typeof value !== 'string') throw new CopilotLoginEnvironmentError()
  const host = value.trim().toLowerCase().replace(/^https:\/\//u, '').replace(/\/$/u, '')
  if (!COPILOT_LOGIN_HOST_PATTERN.test(host)) throw new CopilotLoginEnvironmentError()
  return host
}

export function copilotIdentityEndpoint(host: string): string {
  return `https://api.${copilotLoginHost(host)}/user`
}

export function copilotVerificationUri(host: string): string {
  return `https://${copilotLoginHost(host)}/login/device`
}

export function sameCopilotIdentity(a: CopilotAccountIdentity, b: CopilotAccountIdentity): boolean {
  return a.userId === b.userId && (a.host ?? 'github.com') === (b.host ?? 'github.com')
}

export function copilotIdentityLabel(identity: CopilotAccountIdentity): string {
  return `@${identity.login}${identity.host && identity.host !== 'github.com' ? ` · ${identity.host}` : ''}`
}
