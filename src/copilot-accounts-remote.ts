import type { RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'
import { strictRemoteCodec } from './remote-codec.ts'
import { COPILOT_ACCOUNT_ID_PATTERN, COPILOT_ACCOUNTS_DIAGNOSTICS, COPILOT_ACCOUNTS_MAX, GITHUB_ACCOUNT_LOGIN_PATTERN } from './copilot-accounts-types.ts'
import type { CopilotAccountsView } from './copilot-accounts-types.ts'
import { COPILOT_LOGIN_HOST_PATTERN, copilotLoginHost, copilotVerificationUri } from './copilot-login-environment.ts'
export type { CopilotAccountsView, CopilotAccountIdentity, CopilotAccountView } from './copilot-accounts-types.ts'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespaceMap {
    githubCopilotAccounts: {
      get(): Promise<RemoteResult<CopilotAccountsView>>
      refreshIdentity(): Promise<RemoteResult<CopilotAccountsView>>
      ensureIdentity(): Promise<RemoteResult<CopilotAccountsView>>
      add(): Promise<RemoteResult<CopilotAccountsView>>
      addForEnvironment(host: string): Promise<RemoteResult<CopilotAccountsView>>
      cancel(): Promise<RemoteResult<CopilotAccountsView>>
      reauthorize(accountId: string, expectedRevision: number): Promise<RemoteResult<CopilotAccountsView>>
      reauthorizeForEnvironment(accountId: string, expectedRevision: number, host: string): Promise<RemoteResult<CopilotAccountsView>>
      switchAccount(accountId: string, expectedRevision: number): Promise<RemoteResult<CopilotAccountsView>>
      removeAccount(accountId: string, expectedRevision: number): Promise<RemoteResult<CopilotAccountsView>>
    }
  }
}
export const CopilotAccountIdSchema = z.string().max(36).regex(COPILOT_ACCOUNT_ID_PATTERN)
const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const host = z.string().max(71).regex(COPILOT_LOGIN_HOST_PATTERN)
export const CopilotAccountsViewSchema = z.object({
  state: z.enum(['ready', 'error']),
  activeAccountId: CopilotAccountIdSchema, revision: revision.optional(),
  writable: z.boolean(), switchable: z.boolean(),
  accounts: z.array(z.object({
    id: CopilotAccountIdSchema, configured: z.boolean(),
    identityState: z.enum(['ready', 'unavailable', 'unknown']),
    identity: z.object({ login: z.string().min(1).max(39).regex(GITHUB_ACCOUNT_LOGIN_PATTERN),
      userId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), host: host.optional() }).strict().optional(),
  }).strict()).max(COPILOT_ACCOUNTS_MAX),
  operation: z.enum(['authorizing', 'verifying', 'switching']).optional(),
  notices: z.array(z.object({
    message: z.string().min(1).max(512),
    url: z.string().max(100).refine(value => {
      try { return value === copilotVerificationUri(copilotLoginHost(new URL(value).hostname)) }
      catch { return false }
    }).optional(),
    code: z.string().min(1).max(32).regex(/^[A-Z0-9-]+$/u).optional(),
  }).strict()).max(8),
  diagnostic: z.enum(COPILOT_ACCOUNTS_DIAGNOSTICS).optional(),
}).strict().superRefine((view, ctx) => {
  const invalid = () => ctx.addIssue({ code: 'custom', message: 'Invalid account evidence' })
  if ((view.state === 'error') !== (view.diagnostic !== undefined)) invalid()
  if (view.switchable && (!view.writable || view.operation !== undefined
    || view.state !== 'ready' && view.diagnostic !== 'COPILOT_ACCOUNTS_SELECTED_MISSING')) invalid()
  if (view.writable && view.revision === undefined) invalid()
  if (new Set(view.accounts.map(row => row.id)).size !== view.accounts.length) invalid()
  for (const row of view.accounts) {
    if ((row.identityState === 'ready') !== (row.identity !== undefined)) invalid()
    if (row.identity !== undefined && !row.configured) invalid()
  }
})
const contribution: TypertRemoteContribution = {
  package: 'dsh-github-copilot',
  descriptors: ['get', 'refreshIdentity', 'ensureIdentity', 'add', 'cancel', 'switchAccount', 'removeAccount', 'reauthorize',
    'addForEnvironment', 'reauthorizeForEnvironment'].map(method => ({
    id: `dsh-github-copilot:githubCopilotAccounts.${method}`,
    namespace: 'githubCopilotAccounts', service: 'githubCopilotAccounts', method,
    invocation: { kind: 'direct' },
    parameters: [...(method === 'switchAccount' || method === 'removeAccount' || method === 'reauthorize'
      || method === 'reauthorizeForEnvironment' ? [
      { name: 'accountId', wire: 'accountId', source: 'json' as const, codec: strictRemoteCodec('dsh-github-copilot#CopilotAccountId', CopilotAccountIdSchema) },
      { name: 'expectedRevision', wire: 'expectedRevision', source: 'json' as const, codec: strictRemoteCodec('dsh-github-copilot#CopilotAccountsRevision', revision) },
    ] : []), ...(method === 'addForEnvironment' || method === 'reauthorizeForEnvironment' ? [
      { name: 'host', wire: 'host', source: 'json' as const, codec: strictRemoteCodec('dsh-github-copilot#CopilotLoginHost', host) },
    ] : [])],
    result: strictRemoteCodec('dsh-github-copilot#CopilotAccountsView', CopilotAccountsViewSchema),
  })),
}
export default contribution
