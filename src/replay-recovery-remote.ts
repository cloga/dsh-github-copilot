import type { RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'
import { strictRemoteCodec } from './remote-codec.ts'
import { ReplayRecoveryDurationSchema, ReplayRecoveryViewSchema } from './replay-recovery-types.ts'
import type { ReplayRecoveryDuration, ReplayRecoveryView } from './replay-recovery-types.ts'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespaceMap {
    githubCopilotReplayRecovery: {
      get(agentId: string): Promise<RemoteResult<ReplayRecoveryView>>
      setEnabled(agentId: string, revision: string, enabled: boolean): Promise<RemoteResult<ReplayRecoveryView>>
      authorize(agentId: string, revision: string, duration: ReplayRecoveryDuration): Promise<RemoteResult<ReplayRecoveryView>>
    }
  }
}
const agent = { name: 'agent', wire: 'agentId', source: 'lookup' as const, lookup: 'agent',
  codec: strictRemoteCodec('@deepseek-ai/dsh-session/types#SessionId', z.string().min(1).max(256)) }
const contribution: TypertRemoteContribution = {
  package: 'dsh-github-copilot',
  descriptors: [
    {
      id: 'dsh-github-copilot:githubCopilotReplayRecovery.get',
      namespace: 'githubCopilotReplayRecovery', service: 'githubCopilotReplayRecovery', method: 'get',
      invocation: { kind: 'direct' }, parameters: [agent],
      result: strictRemoteCodec('dsh-github-copilot#ReplayRecoveryView', ReplayRecoveryViewSchema),
    },
    {
      id: 'dsh-github-copilot:githubCopilotReplayRecovery.authorize',
      namespace: 'githubCopilotReplayRecovery', service: 'githubCopilotReplayRecovery', method: 'authorize',
      invocation: { kind: 'direct' }, parameters: [
        agent,
        { name: 'revision', wire: 'revision', source: 'json', codec: strictRemoteCodec('dsh-github-copilot#ReplayRecoveryRevision', z.string().uuid()) },
        { name: 'duration', wire: 'duration', source: 'json', codec: strictRemoteCodec('dsh-github-copilot#ReplayRecoveryDuration', ReplayRecoveryDurationSchema) },
      ],
      result: strictRemoteCodec('dsh-github-copilot#ReplayRecoveryView', ReplayRecoveryViewSchema),
    },
    {
      id: 'dsh-github-copilot:githubCopilotReplayRecovery.setEnabled',
      namespace: 'githubCopilotReplayRecovery', service: 'githubCopilotReplayRecovery', method: 'setEnabled',
      invocation: { kind: 'direct' }, parameters: [
        agent,
        { name: 'revision', wire: 'revision', source: 'json', codec: strictRemoteCodec('dsh-github-copilot#ReplayRecoveryRevision', z.string().uuid()) },
        { name: 'enabled', wire: 'enabled', source: 'json', codec: strictRemoteCodec('dsh-github-copilot#ReplayRecoveryEnabled', z.boolean()) },
      ],
      result: strictRemoteCodec('dsh-github-copilot#ReplayRecoveryView', ReplayRecoveryViewSchema),
    },
  ],
}
export default contribution
