import type { RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'
import { strictRemoteCodec } from './remote-codec.ts'
import { COPILOT_ACCOUNT_ID_PATTERN, COPILOT_ACCOUNTS_DIAGNOSTICS, COPILOT_ACCOUNTS_MAX, GITHUB_ACCOUNT_LOGIN_PATTERN } from './copilot-accounts-types.ts'
import type { CopilotAccountsView } from './copilot-accounts-types.ts'
export type { CopilotAccountsView, CopilotAccountIdentity, CopilotAccountView } from './copilot-accounts-types.ts'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespaceMap {
    githubCopilotAccounts: {
      get(): Promise<RemoteResult<CopilotAccountsView>>
      refreshIdentity(): Promise<RemoteResult<CopilotAccountsView>>
      add(): Promise<RemoteResult<CopilotAccountsView>>
      cancel(): Promise<RemoteResult<CopilotAccountsView>>
      reauthorize(accountId: string, expectedRevision: number): Promise<RemoteResult<CopilotAccountsView>>
      switchAccount(accountId: string, expectedRevision: number): Promise<RemoteResult<CopilotAccountsView>>
      removeAccount(accountId: string, expectedRevision: number): Promise<RemoteResult<CopilotAccountsView>>
    }
  }
}
export const CopilotAccountIdSchema = z.string().max(36).regex(COPILOT_ACCOUNT_ID_PATTERN)
const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
export const CopilotAccountsViewSchema = z.object({
  state: z.enum(['ready', 'error']),
  activeAccountId: CopilotAccountIdSchema, revision: revision.optional(),
  writable: z.boolean(), switchable: z.boolean(),
  accounts: z.array(z.object({
    id: CopilotAccountIdSchema, configured: z.boolean(),
    identityState: z.enum(['ready', 'unavailable', 'unknown']),
    identity: z.object({ login: z.string().min(1).max(39).regex(GITHUB_ACCOUNT_LOGIN_PATTERN),
      userId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).strict().optional(),
  }).strict()).max(COPILOT_ACCOUNTS_MAX),
  operation: z.enum(['authorizing', 'switching']).optional(),
  notices: z.array(z.object({
    message: z.string().min(1).max(512),
    url: z.literal('https://github.com/login/device').optional(),
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
  descriptors: ['get', 'refreshIdentity', 'add', 'cancel', 'switchAccount', 'removeAccount', 'reauthorize'].map(method => ({
    id: `dsh-github-copilot:githubCopilotAccounts.${method}`,
    namespace: 'githubCopilotAccounts', service: 'githubCopilotAccounts', method,
    invocation: { kind: 'direct' },
    parameters: method === 'switchAccount' || method === 'removeAccount' || method === 'reauthorize' ? [
      { name: 'accountId', wire: 'accountId', source: 'json', codec: strictRemoteCodec('dsh-github-copilot#CopilotAccountId', CopilotAccountIdSchema) },
      { name: 'expectedRevision', wire: 'expectedRevision', source: 'json', codec: strictRemoteCodec('dsh-github-copilot#CopilotAccountsRevision', revision) },
    ] : [],
    result: strictRemoteCodec('dsh-github-copilot#CopilotAccountsView', CopilotAccountsViewSchema),
  })),
}
export default contribution
