/**
 * Client-safe Remote contribution for the plugin-owned authorization bridge.
 */

import type {
  RemoteResult,
  TypertRemoteContribution,
} from '@deepseek-ai/dsh-typert-protocol'
import type { GitHubCopilotAuthorizationView } from './authorization-controller.ts'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespaceMap {
    githubCopilot: {
      status(): Promise<RemoteResult<GitHubCopilotAuthorizationView>>
      start(): Promise<RemoteResult<GitHubCopilotAuthorizationView>>
      cancel(): Promise<RemoteResult<GitHubCopilotAuthorizationView>>
      signOut(): Promise<RemoteResult<GitHubCopilotAuthorizationView>>
    }
  }
}

const direct = { kind: 'direct' } as const
const result = { mode: 'src-json' } as const

const contribution: TypertRemoteContribution = {
  package: 'dsh-github-copilot',
  descriptors: ['status', 'start', 'cancel', 'signOut'].map(method => ({
    id: `dsh-github-copilot:githubCopilot.${method}`,
    service: 'githubCopilotAuthorization',
    namespace: 'githubCopilot',
    method,
    invocation: direct,
    parameters: [],
    result,
  })),
}

export default contribution
