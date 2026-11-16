/**
 * Client-safe Remote contribution for the plugin-owned authorization bridge.
 */

import type {
  RemoteResult,
  TypertRemoteContribution,
} from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'
import { strictRemoteCodec } from './remote-codec.ts'
import type {
  GitHubCopilotAuthorizationView, GitHubCopilotModelPreferencesView,
  GitHubCopilotNativeModelSyncCode, GitHubCopilotNativeModelSyncPreview,
  GitHubCopilotNativeModelSyncResult,
} from './authorization-controller.ts'
import type { GitHubCopilotMigrationStatus } from './migration-status.ts'
import dualModelRemote from './dual-model-remote.ts'
import searchRoutingRemote from './search-routing-remote.ts'
import nativeCopilotSearchRemote from './native-copilot-search-remote.ts'
import copilotUsageRemote from './copilot-usage-remote.ts'
import turnSelectionRemote from './turn-selection-remote.ts'
import replayRecoveryRemote from './replay-recovery-remote.ts'
import copilotAccountsRemote from './copilot-accounts-remote.ts'
import sessionAccountsRemote from './session-accounts-remote.ts'
import sessionContinuationRemote from './session-continuation-remote.ts'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespaceMap {
    githubCopilot: {
      migrationStatus(): Promise<RemoteResult<GitHubCopilotMigrationStatus>>
      status(): Promise<RemoteResult<GitHubCopilotAuthorizationView>>
      reconcile(): Promise<RemoteResult<GitHubCopilotAuthorizationView>>
      discoverModels(): Promise<RemoteResult<GitHubCopilotAuthorizationView>>
      ensureModels(): Promise<RemoteResult<GitHubCopilotAuthorizationView>>
      excludeModel(modelId: string): Promise<RemoteResult<GitHubCopilotAuthorizationView>>
      restoreModel(modelId: string): Promise<RemoteResult<GitHubCopilotAuthorizationView>>
      setModelExcluded(modelId: string, excluded: boolean): Promise<RemoteResult<GitHubCopilotModelPreferencesView>>
      setModelHighCost(modelId: string, highCost: boolean): Promise<RemoteResult<GitHubCopilotModelPreferencesView>>
      prepareNativeModelSync(): Promise<RemoteResult<GitHubCopilotNativeModelSyncPreview>>
      previewNativeModelSync(): Promise<RemoteResult<GitHubCopilotNativeModelSyncPreview>>
      applyNativeModelSync(planId: string): Promise<RemoteResult<GitHubCopilotNativeModelSyncResult>>
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
  modelPreferences: z.object({
    state: z.enum(['ready', 'error']),
    writable: z.boolean(),
    revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    excludedModelIds: z.array(z.string().min(1).max(512)).max(512),
    lockedModelIds: z.array(z.string().min(1).max(512)).max(512),
    unavailableExcludedModelIds: z.array(z.string().min(1).max(512)).max(512),
    highCostModelIds: z.array(z.string().min(1).max(512)).max(512).optional(),
    error: z.enum([
      'COPILOT_MODEL_PREFERENCES_UNAVAILABLE',
      'COPILOT_MODEL_SETTINGS_UNAVAILABLE',
      'COPILOT_MODEL_SETTINGS_INVALID',
      'COPILOT_MODEL_SELECTION_UNAVAILABLE',
      'COPILOT_MODEL_EXCLUSION_SELECTED',
      'COPILOT_MODEL_EXCLUSION_CONFLICT',
      'COPILOT_MODEL_EXCLUSION_SAVE_FAILED',
    ]).optional(),
  }).strict().optional(),
  route: z.object({
    state: z.enum(['ready', 'needs-repair', 'not-configured', 'conflict', 'error']),
    diagnosticCode: z.enum(['ROUTE_READ_FAILED', 'RECONCILIATION_FAILED', 'ROUTE_CONFLICT']).optional(),
  }).strict().optional(),
  error: z.string().optional(),
  authorizationMilestone: z.enum([
    'AUTHORIZATION_REQUESTED',
    'INTERACTION_PROMPT_OBSERVED',
    'INTERACTION_NOTICE_OBSERVED',
  ]).optional(),
}).strict()

const result = strictRemoteCodec(GITHUB_COPILOT_AUTHORIZATION_VIEW_TYPE_SYMBOL, GitHubCopilotAuthorizationViewSchema)
export const GitHubCopilotModelPreferencesViewSchema = GitHubCopilotAuthorizationViewSchema.shape.modelPreferences.unwrap()

const nativeModelSyncCode = z.enum([
  'NATIVE_MODEL_SYNC_ACCOUNT_MISMATCH',
  'NATIVE_MODEL_SYNC_ACCOUNT_UNAVAILABLE',
  'NATIVE_MODEL_SYNC_DISCOVERY_UNAVAILABLE',
  'NATIVE_MODEL_SYNC_MODELS_UNAVAILABLE',
  'NATIVE_MODEL_SYNC_NATIVE_CATALOG_UNAVAILABLE',
  'NATIVE_MODEL_SYNC_PREFERENCES_UNAVAILABLE',
  'NATIVE_MODEL_SYNC_SETTINGS_UNAVAILABLE',
  'NATIVE_MODEL_SYNC_SETTINGS_INVALID',
  'NATIVE_MODEL_SYNC_PROFILE_MISSING',
  'NATIVE_MODEL_SYNC_ROUTE_OWNERSHIP_CONFLICT',
  'NATIVE_MODEL_SYNC_NATIVE_AUTH_UNPROVEN',
  'NATIVE_MODEL_SYNC_OVERRIDES_CONFLICT',
  'NATIVE_MODEL_SYNC_ROUTE_COMPAT_UNPROVEN',
  'NATIVE_MODEL_SYNC_ROUTE_API_UNPROVEN',
  'NATIVE_MODEL_SYNC_ROUTE_API_CONFLICT',
  'NATIVE_MODEL_SYNC_NO_SYNCABLE_MODELS',
  'NATIVE_MODEL_SYNC_PLAN_EXPIRED',
  'NATIVE_MODEL_SYNC_PLAN_STALE',
  'NATIVE_MODEL_SYNC_SETTINGS_CONFLICT',
  'NATIVE_MODEL_SYNC_SAVE_FAILED',
  'NATIVE_MODEL_SYNC_READBACK_FAILED',
]) satisfies z.ZodType<GitHubCopilotNativeModelSyncCode>

export const GitHubCopilotNativeModelSyncPreviewSchema = z.object({
  state: z.enum(['ready', 'blocked', 'error']),
  code: nativeModelSyncCode.optional(),
  planId: z.string().uuid().optional(),
  enabledCount: z.number().int().nonnegative().max(512),
  syncableCount: z.number().int().nonnegative().max(512),
  outputTokenDefaults: z.array(z.object({
    id: z.string().min(1).max(200),
    maxTokens: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  }).strict()).max(512),
  addedIds: z.array(z.string().min(1).max(200)).max(512),
  removedIds: z.array(z.string().min(1).max(200)).max(512),
  updatedIds: z.array(z.string().min(1).max(200)).max(512),
  nativeCatalogMissingIds: z.array(z.string().min(1).max(200)).max(512).optional(),
  routeApiChange: z.enum(['anthropic-messages', 'openai-responses', 'openai-completions']).optional(),
  skipped: z.array(z.object({
    id: z.string().min(1).max(200),
    code: z.enum([
      'NATIVE_API_UNAVAILABLE', 'NATIVE_API_MISMATCH', 'NATIVE_INHERITED_API_MISMATCH', 'NATIVE_COMPATIBILITY_UNPROVEN', 'NATIVE_CONTEXT_LIMIT_UNKNOWN',
      'NATIVE_INPUT_LIMIT_UNKNOWN', 'NATIVE_INPUT_LIMIT_UNSUPPORTED', 'NATIVE_REASONING_UNKNOWN', 'NATIVE_REASONING_UNSUPPORTED',
      'NATIVE_VISION_SUPPORT_UNKNOWN', 'NATIVE_VISION_MEDIA_TYPES_UNKNOWN', 'NATIVE_VISION_MEDIA_TYPES_UNSUPPORTED',
    ]),
  }).strict()).max(512),
}).strict() satisfies z.ZodType<GitHubCopilotNativeModelSyncPreview>

export const GitHubCopilotNativeModelSyncResultSchema = z.object({
  state: z.enum(['ready', 'error']),
  code: nativeModelSyncCode.optional(),
  modelCount: z.number().int().nonnegative().max(512),
}).strict() satisfies z.ZodType<GitHubCopilotNativeModelSyncResult>

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
    ...['excludeModel', 'restoreModel'].map(method => ({
      id: `dsh-github-copilot:githubCopilot.${method}`,
      service: 'githubCopilotAuthorization',
      namespace: 'githubCopilot',
      method,
      invocation: direct,
      parameters: [{
        name: 'modelId',
        wire: 'modelId',
        source: 'json' as const,
        codec: strictRemoteCodec('dsh-github-copilot#GitHubCopilotModelId', z.string().min(1).max(512)),
      }],
      result,
    })),
    {
      id: 'dsh-github-copilot:githubCopilot.setModelExcluded',
      service: 'githubCopilotAuthorization', namespace: 'githubCopilot', method: 'setModelExcluded',
      invocation: direct,
      parameters: [
        { name: 'modelId', wire: 'modelId', source: 'json',
          codec: strictRemoteCodec('dsh-github-copilot#GitHubCopilotModelId', z.string().min(1).max(512)) },
        { name: 'excluded', wire: 'excluded', source: 'json',
          codec: strictRemoteCodec('dsh-github-copilot#GitHubCopilotModelExcluded', z.boolean()) },
      ],
      result: strictRemoteCodec('dsh-github-copilot#GitHubCopilotModelPreferencesView', GitHubCopilotModelPreferencesViewSchema),
    },
    {
      id: 'dsh-github-copilot:githubCopilot.setModelHighCost',
      service: 'githubCopilotAuthorization', namespace: 'githubCopilot', method: 'setModelHighCost',
      invocation: direct,
      parameters: [
        { name: 'modelId', wire: 'modelId', source: 'json',
          codec: strictRemoteCodec('dsh-github-copilot#GitHubCopilotModelId', z.string().min(1).max(512)) },
        { name: 'highCost', wire: 'highCost', source: 'json',
          codec: strictRemoteCodec('dsh-github-copilot#GitHubCopilotModelHighCost', z.boolean()) },
      ],
      result: strictRemoteCodec('dsh-github-copilot#GitHubCopilotModelPreferencesView', GitHubCopilotModelPreferencesViewSchema),
    },
    {
      id: 'dsh-github-copilot:githubCopilot.prepareNativeModelSync',
      service: 'githubCopilotAuthorization', namespace: 'githubCopilot', method: 'prepareNativeModelSync',
      invocation: direct, parameters: [],
      result: strictRemoteCodec('dsh-github-copilot#GitHubCopilotNativeModelSyncPreview', GitHubCopilotNativeModelSyncPreviewSchema),
    },
    {
      id: 'dsh-github-copilot:githubCopilot.previewNativeModelSync',
      service: 'githubCopilotAuthorization', namespace: 'githubCopilot', method: 'previewNativeModelSync',
      invocation: direct, parameters: [],
      result: strictRemoteCodec('dsh-github-copilot#GitHubCopilotNativeModelSyncPreview', GitHubCopilotNativeModelSyncPreviewSchema),
    },
    {
      id: 'dsh-github-copilot:githubCopilot.applyNativeModelSync',
      service: 'githubCopilotAuthorization', namespace: 'githubCopilot', method: 'applyNativeModelSync',
      invocation: direct,
      parameters: [{
        name: 'planId', wire: 'planId', source: 'json',
        codec: strictRemoteCodec('dsh-github-copilot#GitHubCopilotNativeModelSyncPlanId', z.string().uuid()),
      }],
      result: strictRemoteCodec('dsh-github-copilot#GitHubCopilotNativeModelSyncResult', GitHubCopilotNativeModelSyncResultSchema),
    },
    {
      id: 'dsh-github-copilot:githubCopilot.migrationStatus',
      service: 'githubCopilotAuthorization', namespace: 'githubCopilot', method: 'migrationStatus',
      invocation: direct, parameters: [],
      result: strictRemoteCodec(GITHUB_COPILOT_MIGRATION_STATUS_TYPE_SYMBOL, GitHubCopilotMigrationStatusSchema),
    },
    ...dualModelRemote.descriptors,
    ...searchRoutingRemote.descriptors,
    ...nativeCopilotSearchRemote.descriptors,
    ...copilotUsageRemote.descriptors,
    ...turnSelectionRemote.descriptors,
    ...replayRecoveryRemote.descriptors,
    ...copilotAccountsRemote.descriptors,
    ...sessionAccountsRemote.descriptors,
    ...sessionContinuationRemote.descriptors,
  ],
}

export default contribution
