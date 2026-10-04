import type { RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'
import { strictRemoteCodec } from './remote-codec.ts'
import type { TurnSelection } from './turn-selection.ts'
import { TurnSelectionSchema } from './turn-selection.ts'
export { TurnSelectionSchema } from './turn-selection.ts'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespaceMap {
    githubCopilotTurnSelection: {
      get(agentId: string, turn: number): Promise<RemoteResult<TurnSelection>>
    }
  }
}
const contribution: TypertRemoteContribution = {
  package: 'dsh-github-copilot',
  descriptors: [{
    id: 'dsh-github-copilot:githubCopilotTurnSelection.get',
    namespace: 'githubCopilotTurnSelection', service: 'githubCopilotTurnSelection', method: 'get',
    // The footer always supplies the viewed Session ID, even inside a bound Chat.
    invocation: { kind: 'direct' },
    parameters: [
      { name: 'agent', wire: 'agentId', source: 'lookup', lookup: 'agent',
        codec: strictRemoteCodec('@deepseek-ai/dsh-session/types#SessionId', z.string().min(1).max(256)) },
      { name: 'turn', wire: 'turn', source: 'json',
        codec: strictRemoteCodec('dsh-github-copilot#TurnSelectionTurn', z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)) },
    ],
    result: strictRemoteCodec('dsh-github-copilot#TurnSelection', TurnSelectionSchema),
  }],
}
export default contribution
