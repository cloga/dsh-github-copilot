import type { RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'
import { strictRemoteCodec } from './remote-codec.ts'
import { SessionContinuationViewSchema, ContinuationDefaultViewSchema } from './session-continuation-types.ts'
import type { SessionContinuationView } from './session-continuation-types.ts'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespaceMap {
    githubCopilotSessionContinuation: {
      get(agentId: string): Promise<RemoteResult<SessionContinuationView>>
      set(agentId: string, revision: number, enabled: boolean | null): Promise<RemoteResult<SessionContinuationView>>
      authorizeNext(agentId: string, revision: number, enabled: boolean): Promise<RemoteResult<SessionContinuationView>>
      defaults(): Promise<RemoteResult<{ enabled: boolean; revision: number }>>
      setDefault(revision: number, enabled: boolean): Promise<RemoteResult<{ enabled: boolean; revision: number }>>
    }
  }
}
const contribution: TypertRemoteContribution = {
  package: 'dsh-github-copilot',
  descriptors: ['get', 'set', 'authorizeNext', 'defaults', 'setDefault'].map(method => ({
    id: `dsh-github-copilot:githubCopilotSessionContinuation.${method}`,
    namespace: 'githubCopilotSessionContinuation', service: 'githubCopilotSessionContinuation', method,
    invocation: { kind: 'direct' },
    parameters: [
      ...method === 'defaults' || method === 'setDefault' ? [] : [
        { name: 'agent', wire: 'agentId', source: 'lookup' as const, lookup: 'agent',
          codec: strictRemoteCodec('@deepseek-ai/dsh-session/types#SessionId', z.string().min(1).max(256)) }],
      ...method === 'set' || method === 'authorizeNext' || method === 'setDefault' ? [
        { name: 'revision', wire: 'revision', source: 'json' as const,
          codec: strictRemoteCodec('dsh-github-copilot#SessionContinuationRevision', z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)) },
        { name: 'enabled', wire: 'enabled', source: 'json' as const,
          codec: strictRemoteCodec('dsh-github-copilot#SessionContinuationEnabled', method === 'set' ? z.boolean().nullable() : z.boolean()) },
      ] : [],
    ],
    result: method === 'defaults' || method === 'setDefault'
      ? strictRemoteCodec('dsh-github-copilot#ContinuationDefaultView', ContinuationDefaultViewSchema)
      : strictRemoteCodec('dsh-github-copilot#SessionContinuationView', SessionContinuationViewSchema),
  })),
}
export default contribution
