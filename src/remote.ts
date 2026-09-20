/**
 * Client-safe Remote contribution for the plugin-owned authorization bridge.
 */

import type {
  RemoteResult,
  TypertRemoteContribution,
} from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'
import { strictRemoteCodec } from './remote-codec.ts'
import type { GitHubCopilotAuthorizationView } from './authorization-controller.ts'
import type { GitHubCopilotMigrationStatus } from './migration-status.ts'
import dualModelRemote from './dual-model-remote.ts'
import searchRoutingRemote from './search-routing-remote.ts'
import copilotUsageRemote from './copilot-usage-remote.ts'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespaceMap {
    githubCopilot: {
      migrationStatus(): Promise<RemoteResult<GitHubCopilotMigrationStatus>>
      status(): Promise<RemoteResult<GitHubCopilotAuthorizationView>>
      reconcile(): Promise<RemoteResult<GitHubCopilotAuthorizationView>>
      discoverModels(): Promise<RemoteResult<GitHubCopilotAuthorizationView>>
      ensureModels(): Promise<RemoteResult<GitHubCopilotAuthorizationView>>
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
    previewModelIds: z.array(z.string()).optional(),
  }).strict().optional(),
  accountModels: z.object({
    state: z.enum(['idle', 'loading', 'ready', 'stale', 'error', 'disposed', 'unconfigured', 'unavailable']),
    models: z.array(z.object({ id: z.string(), name: z.string(), api: z.string() }).strict()).max(512),
    rejected: z.array(z.object({ id: z.string().optional(), code: z.string() }).strict()).max(1024),
    warnings: z.array(z.object({ id: z.string(), code: z.string() }).strict()).max(1024).optional(),
    discoveredAt: z.number().int().nonnegative().optional(),
    error: z.string().optional(),
  }).strict().optional(),
  route: z.object({
    state: z.enum(['ready', 'needs-repair', 'not-configured', 'conflict', 'error']),
    diagnosticCode: z.enum(['ROUTE_READ_FAILED', 'RECONCILIATION_FAILED', 'ROUTE_CONFLICT']).optional(),
  }).strict().optional(),
  error: z.string().optional(),
}).strict()

const result = strictRemoteCodec(GITHUB_COPILOT_AUTHORIZATION_VIEW_TYPE_SYMBOL, GitHubCopilotAuthorizationViewSchema)

export const GITHUB_COPILOT_MIGRATION_STATUS_TYPE_SYMBOL
  = 'dsh-github-copilot#GitHubCopilotMigrationStatus'
const selectionSchema = z.object({
  provider: z.string().min(1).max(512),
  model: z.string().min(1).max(512),
  reasoningEffort: z.string().min(1).max(512).optional(),
}).strict()

/** Independent Ops result: strict at every object level; no account or private Session data. */
export const GitHubCopilotMigrationStatusSchema = z.object({
  plugin: z.object({ name: z.literal('dsh-github-copilot'), version: z.string().min(1).max(512) }).strict(),
  protocolVersion: z.literal(1),
  historyScope: z.literal('live-agents-only'),
  observedAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  capabilities: z.object({
    agentsList: z.boolean(), sessionProjections: z.boolean(), settingsCas: z.boolean(),
    providerRegistry: z.boolean(), defaultSelection: z.boolean(),
  }).strict(),
  complete: z.object({ sessions: z.boolean(), defaultSelection: z.boolean(), routes: z.boolean() }).strict(),
  defaultSelection: selectionSchema.nullable(),
  sessions: z.array(z.object({
    id: z.string().min(1).max(512), status: z.enum(['idle', 'running']),
    effectiveSelection: selectionSchema.nullable(),
    selectionSource: z.enum(['pending', 'request-header', 'default', 'unknown']),
    activeRequestSelection: selectionSchema.nullable(),
  }).strict()).max(1024),
  routes: z.object({
    nativeConfigured: z.boolean().nullable(), nativeRegistered: z.boolean().nullable(), managedRegistered: z.boolean().nullable(),
  }).strict(),
}).strict()

const contribution: TypertRemoteContribution = {
  package: 'dsh-github-copilot',
  descriptors: [
    ...['status', 'reconcile', 'discoverModels', 'ensureModels', 'start', 'cancel', 'signOut'].map(method => ({
      id: `dsh-github-copilot:githubCopilot.${method}`,
      service: 'githubCopilotAuthorization',
      namespace: 'githubCopilot',
      method,
      invocation: direct,
      parameters: [],
      result,
    })),
    {
      id: 'dsh-github-copilot:githubCopilot.migrationStatus',
      service: 'githubCopilotAuthorization', namespace: 'githubCopilot', method: 'migrationStatus',
      invocation: direct, parameters: [],
      result: strictRemoteCodec(GITHUB_COPILOT_MIGRATION_STATUS_TYPE_SYMBOL, GitHubCopilotMigrationStatusSchema),
    },
    ...dualModelRemote.descriptors,
    ...searchRoutingRemote.descriptors,
    ...copilotUsageRemote.descriptors,
  ],
}

export default contribution
