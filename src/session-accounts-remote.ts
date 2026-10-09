import { z } from 'zod'
import type { RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { strictRemoteCodec } from './remote-codec.ts'
import { CopilotAccountIdSchema, CopilotAccountsViewSchema } from './copilot-accounts-remote.ts'
import { CopilotUsageViewSchema } from './copilot-usage-remote.ts'
import type { CopilotUsageView } from './copilot-usage-types.ts'
import type { CopilotAccountsView } from './copilot-accounts-types.ts'

export const SessionAccountViewSchema = z.object({
  source: z.enum(['global', 'session']),
  accountId: CopilotAccountIdSchema,
  globalAccountId: CopilotAccountIdSchema,
  runningAccountId: CopilotAccountIdSchema.optional(),
  accounts: CopilotAccountsViewSchema,
}).strict().refine(view => view.accountId === view.accounts.activeAccountId, { message: 'Session account identity mismatch' })
export interface SessionAccountView {
  readonly source: 'global' | 'session'
  readonly accountId: string
  readonly globalAccountId: string
  readonly runningAccountId?: string
  readonly accounts: CopilotAccountsView
}
export const TurnAccountViewSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('unknown') }).strict(),
  z.object({ state: z.literal('recorded'), accountId: CopilotAccountIdSchema,
    source: z.enum(['global', 'session']),
    identity: CopilotAccountsViewSchema.shape.accounts.element.shape.identity }).strict(),
])
export type TurnAccountView = z.infer<typeof TurnAccountViewSchema>
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespaceMap {
    githubCopilotSessionAccount: {
      get(agentId: string): Promise<RemoteResult<SessionAccountView>>
      set(agentId: string, accountId: string | null, revision: number): Promise<RemoteResult<SessionAccountView>>
      refreshIdentity(agentId: string): Promise<RemoteResult<SessionAccountView>>
      ensureIdentity(agentId: string): Promise<RemoteResult<SessionAccountView>>
      usage(agentId: string): Promise<RemoteResult<CopilotUsageView>>
      refreshUsage(agentId: string): Promise<RemoteResult<CopilotUsageView>>
      turn(agentId: string, turn: number): Promise<RemoteResult<TurnAccountView>>
    }
  }
}
const agent = { name: 'agent', wire: 'agentId', source: 'lookup' as const, lookup: 'agent',
  codec: strictRemoteCodec('@deepseek-ai/dsh-session/types#SessionId', z.string().min(1).max(256)) }
const contribution: TypertRemoteContribution = {
  package: 'dsh-github-copilot',
  descriptors: ['get', 'set', 'refreshIdentity', 'ensureIdentity', 'usage', 'refreshUsage', 'turn'].map(method => ({
    id: `dsh-github-copilot:githubCopilotSessionAccount.${method}`,
    namespace: 'githubCopilotSessionAccount', service: 'githubCopilotSessionAccount', method,
    invocation: { kind: 'direct' },
    parameters: [agent, ...(method === 'set' ? [
      { name: 'accountId', wire: 'accountId', source: 'json' as const,
        codec: strictRemoteCodec('dsh-github-copilot#SessionAccountChoice', CopilotAccountIdSchema.nullable()) },
      { name: 'revision', wire: 'revision', source: 'json' as const,
        codec: strictRemoteCodec('dsh-github-copilot#SessionAccountRevision', z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)) },
    ] : method === 'turn' ? [
      { name: 'turn', wire: 'turn', source: 'json' as const,
        codec: strictRemoteCodec('dsh-github-copilot#SessionAccountTurn', z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)) },
    ] : [])],
    result: method === 'usage' || method === 'refreshUsage'
      ? strictRemoteCodec('dsh-github-copilot#CopilotUsageView', CopilotUsageViewSchema)
      : method === 'turn' ? strictRemoteCodec('dsh-github-copilot#TurnAccountView', TurnAccountViewSchema)
        : strictRemoteCodec('dsh-github-copilot#SessionAccountView', SessionAccountViewSchema),
  })),
}
export default contribution
