/**
 * Client-safe Remote contribution for the plugin-owned authorization bridge.
 */

import type {
  RemoteResult,
  TypertRemoteContribution,
} from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'
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
export const GITHUB_COPILOT_AUTHORIZATION_VIEW_TYPE_SYMBOL
  = 'dsh-github-copilot#GitHubCopilotAuthorizationView'

export const GitHubCopilotAuthorizationViewSchema = z.object({
  phase: z.enum(['signed-out', 'authorizing', 'signed-in', 'error']),
  configured: z.boolean(),
  writable: z.boolean(),
  inFlight: z.boolean(),
  notices: z.array(z.object({
    message: z.string(),
    url: z.string().optional(),
    code: z.string().optional(),
  }).strict()),
  catalog: z.object({
    state: z.enum(['current', 'partially-outdated', 'outdated']),
    accountModelCount: z.number().int().nonnegative(),
    supportedModelCount: z.number().int().nonnegative(),
    unknownModelIds: z.array(z.string()),
    temporarilyUnavailableModelIds: z.array(z.string()).optional(),
  }).strict().optional(),
  error: z.string().optional(),
}).strict()

const result = {
  mode: 'strict',
  typeSymbol: GITHUB_COPILOT_AUTHORIZATION_VIEW_TYPE_SYMBOL,
  schema: GitHubCopilotAuthorizationViewSchema,
} as const

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
