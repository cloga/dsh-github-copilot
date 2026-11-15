/**
 * Host-side bridge between the Models-page companion UI and DSH's neutral
 * authorization, credential-record, and settings seams.
 */

import { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { randomUUID } from 'node:crypto'
import { normalizeGitHubCopilotOAuthCredential } from './copilot-grant.ts'
import {
  ROUTE_OWNERSHIP_EPOCH, TemporaryRouteConflictError, assertOwned, encodeBackup, equalJson, leafOperations,
  object, ownedHeaderRemoval, profileAt, settingsSnapshot, wholeProfileOwned,
  type RouteBackup, type RouteMutation, type RouteSettings,
} from './route-ownership.ts'
import { temporaryGitHubCopilotModelFromProfile } from './temporary-models.ts'
import { migrationStatus, type GitHubCopilotMigrationStatus } from './migration-status.ts'
import { normalizeExcludedModelIds } from './model-exclusions.ts'
import { normalizeHighCostModelIds } from './auto-allocation.ts'
import { emptyNativeCompatibility, matchesNativeModelProfile, planNativeModelSync } from './native-model-sync.ts'
import type { NativeModelProfile, NativeModelSyncSkipCode } from './native-model-sync.ts'
import { captureNativeCopilotCatalog } from './native-copilot-access.ts'
import type { NativeCopilotCatalogSnapshot, NativeCopilotModel } from './native-copilot-access.ts'
import type {} from './copilot-accounts-host.ts'
import type { GitHubCopilotPreview } from './preview-route.ts'

export { GITHUB_COPILOT_CREDENTIAL_KEY, GITHUB_COPILOT_PROVIDER_ID } from './copilot-identity.ts'
import { GITHUB_COPILOT_CREDENTIAL_KEY, GITHUB_COPILOT_PROVIDER_ID, nativeCopilotUsesCanonicalOAuth } from './copilot-identity.ts'
export const LLM_PI_AI_SETTINGS_NAMESPACE = 'llm-pi-ai'
const GITHUB_COPILOT_SETTINGS_NAMESPACE = 'github-copilot'
/** Historical v2 migration risk marker only; never an account-model routing rule. */
const LEGACY_V2_MODEL_ID = 'gpt-6-astra'

export type GitHubCopilotModelCatalogState = 'current' | 'partially-outdated' | 'outdated'

export interface GitHubCopilotModelCatalogView {
  readonly state: GitHubCopilotModelCatalogState
  readonly accountModelCount: number
  readonly supportedModelCount: number
  readonly unknownModelIds: readonly string[]
  readonly temporarilyUnavailableModelIds?: readonly string[]
  /** Exact models served by the plugin-owned route, not canonical Core metadata. */
  readonly previewModelIds?: readonly string[]
}

export interface GitHubCopilotProviderProfileResult {
  readonly changed: boolean
  /** Legacy result field retained for consumers; canonical repair does not project a catalog. */
  readonly catalog?: GitHubCopilotModelCatalogView
}

const profileRepairs = new WeakMap<Context, Promise<GitHubCopilotProviderProfileResult>>()

export interface AuthorizationNoticeView {
  readonly message: string
  readonly url?: string
  readonly code?: string
}

export type GitHubCopilotAuthorizationPhase =
  | 'signed-out'
  | 'authorizing'
  | 'signed-in'
  | 'error'

export interface GitHubCopilotRouteView {
  /** Legacy canonical configuration only; intentional absence is not an OAuth or managed-route failure. */
  readonly state: 'ready' | 'needs-repair' | 'not-configured' | 'conflict' | 'error'
  readonly diagnosticCode?: 'ROUTE_READ_FAILED' | 'RECONCILIATION_FAILED' | 'ROUTE_CONFLICT'
}

export interface GitHubCopilotAccountModelsView {
  readonly state: 'idle' | 'loading' | 'ready' | 'stale' | 'error' | 'disposed' | 'unconfigured' | 'unavailable'
  readonly models: readonly { readonly id: string; readonly name: string; readonly api: string }[]
  readonly rejected: readonly { readonly id?: string; readonly code: string }[]
  readonly warnings?: readonly { readonly id: string; readonly code: string }[]
  readonly discoveredAt?: number
  readonly error?: string
}

export interface GitHubCopilotModelPreferencesView {
  readonly state: 'ready' | 'error'
  readonly writable: boolean
  readonly revision?: number
  readonly excludedModelIds: readonly string[]
  readonly lockedModelIds: readonly string[]
  readonly unavailableExcludedModelIds: readonly string[]
  readonly highCostModelIds?: readonly string[]
  readonly error?: 'COPILOT_MODEL_PREFERENCES_UNAVAILABLE' | 'COPILOT_MODEL_EXCLUSION_SELECTED'
    | 'COPILOT_MODEL_EXCLUSION_CONFLICT' | 'COPILOT_MODEL_EXCLUSION_SAVE_FAILED'
    | 'COPILOT_MODEL_SETTINGS_UNAVAILABLE' | 'COPILOT_MODEL_SETTINGS_INVALID'
    | 'COPILOT_MODEL_SELECTION_UNAVAILABLE'
}

export type GitHubCopilotNativeModelSyncCode =
  | 'NATIVE_MODEL_SYNC_ACCOUNT_MISMATCH'
  | 'NATIVE_MODEL_SYNC_ACCOUNT_UNAVAILABLE'
  | 'NATIVE_MODEL_SYNC_DISCOVERY_UNAVAILABLE'
  | 'NATIVE_MODEL_SYNC_MODELS_UNAVAILABLE'
  | 'NATIVE_MODEL_SYNC_NATIVE_CATALOG_UNAVAILABLE'
  | 'NATIVE_MODEL_SYNC_PREFERENCES_UNAVAILABLE'
  | 'NATIVE_MODEL_SYNC_SETTINGS_UNAVAILABLE'
  | 'NATIVE_MODEL_SYNC_SETTINGS_INVALID'
  | 'NATIVE_MODEL_SYNC_PROFILE_MISSING'
  | 'NATIVE_MODEL_SYNC_ROUTE_OWNERSHIP_CONFLICT'
  | 'NATIVE_MODEL_SYNC_NATIVE_AUTH_UNPROVEN'
  | 'NATIVE_MODEL_SYNC_OVERRIDES_CONFLICT'
  | 'NATIVE_MODEL_SYNC_ROUTE_COMPAT_UNPROVEN'
  | 'NATIVE_MODEL_SYNC_NO_SYNCABLE_MODELS'
  | 'NATIVE_MODEL_SYNC_PLAN_EXPIRED'
  | 'NATIVE_MODEL_SYNC_PLAN_STALE'
  | 'NATIVE_MODEL_SYNC_SETTINGS_CONFLICT'
  | 'NATIVE_MODEL_SYNC_SAVE_FAILED'
  | 'NATIVE_MODEL_SYNC_READBACK_FAILED'

export interface GitHubCopilotNativeModelSyncPreview {
  readonly state: 'ready' | 'blocked' | 'error'
  readonly code?: GitHubCopilotNativeModelSyncCode
  readonly planId?: string
  readonly enabledCount: number
  readonly syncableCount: number
  readonly outputTokenDefaults: readonly { readonly id: string; readonly maxTokens: number }[]
  readonly addedIds: readonly string[]
  readonly removedIds: readonly string[]
  readonly updatedIds: readonly string[]
  readonly skipped: readonly { readonly id: string; readonly code: NativeModelSyncSkipCode }[]
}

export interface GitHubCopilotNativeModelSyncResult {
  readonly state: 'ready' | 'error'
  readonly code?: GitHubCopilotNativeModelSyncCode
  readonly modelCount: number
}

function effectiveNativeModelsMatch(value: unknown, expected: readonly NativeModelProfile[]): boolean {
  return Array.isArray(value) && value.length === expected.length && value.every((entry, index) => {
    const model = object(entry)
    const target = expected[index]
    return model !== undefined && target !== undefined && matchesNativeModelProfile(model, target)
  })
}

function sameNativeCatalog(
  left: ReadonlyMap<string, NativeCopilotModel>, right: ReadonlyMap<string, NativeCopilotModel>,
): boolean {
  return left.size === right.size && [...left].every(([id, model]) => right.get(id)?.api === model.api)
}

function nativeSyncProfileProblem(
  profile: Record<string, unknown>, hasSecrets: boolean,
): GitHubCopilotNativeModelSyncCode | undefined {
  try {
    if (hasSecrets || !nativeCopilotUsesCanonicalOAuth(profile)) return 'NATIVE_MODEL_SYNC_NATIVE_AUTH_UNPROVEN'
    const overrides = object(profile.modelOverrides)
    if (profile.modelOverrides !== undefined && (overrides === undefined || Reflect.ownKeys(overrides).length > 0)) {
      return 'NATIVE_MODEL_SYNC_OVERRIDES_CONFLICT'
    }
    const compat = object(profile.compat)
    if (!emptyNativeCompatibility(profile.compat) && (compat === undefined || compat.supportsStrictMode !== false
      || Reflect.ownKeys(compat).length > 64
      || !Reflect.ownKeys(compat).every(key => key === 'supportsStrictMode'
        || emptyNativeCompatibility(Reflect.get(compat, key))))) {
      return 'NATIVE_MODEL_SYNC_ROUTE_COMPAT_UNPROVEN'
    }
    return undefined
  } catch { return 'NATIVE_MODEL_SYNC_SETTINGS_INVALID' }
}

function nativeSyncSupportsRouteCompatibility(
  profile: Record<string, unknown>, models: readonly NativeModelProfile[],
  accountModels: readonly { readonly id: string; readonly api: string }[],
): boolean {
  if (object(profile.compat)?.supportsStrictMode !== false) return true
  const ids = new Set(models.map(model => model.id))
  return accountModels.some(model => ids.has(model.id)
    && (model.api === 'openai-responses' || model.api === 'openai-completions'))
}

/** Only these owned presentation leaves can cross the Remote boundary. */
function accountModelsView(ctx: Context): GitHubCopilotAccountModelsView | undefined {
  const source: unknown = ctx.get('githubCopilotPreview')
  if (typeof source !== 'object' || source === null) return undefined
  const getView: unknown = Reflect.get(source, 'getView')
  if (typeof getView !== 'function') return undefined
  const empty = { state: 'error', models: [], rejected: [], error: 'COPILOT_MODEL_DISCOVERY_UNAVAILABLE' } as const
  try {
    const view: unknown = getView.call(source)
    if (typeof view !== 'object' || view === null) return empty
    const state: unknown = Reflect.get(view, 'state')
    const allowed = ['idle', 'loading', 'ready', 'stale', 'error', 'disposed', 'unconfigured', 'unavailable'] as const
    if (!allowed.some(value => value === state)) return empty
    const models: unknown = Reflect.get(view, 'models')
    const rejected: unknown = Reflect.get(view, 'rejected')
    if (!Array.isArray(models) || !Array.isArray(rejected) || models.length > 512 || rejected.length > 1024) return empty
    const safeModels = models.map((item: unknown) => {
      if (typeof item !== 'object' || item === null) throw new Error('Invalid model view')
      const id: unknown = Reflect.get(item, 'id'), name: unknown = Reflect.get(item, 'name'), api: unknown = Reflect.get(item, 'api')
      if (typeof id !== 'string' || typeof name !== 'string' || typeof api !== 'string') throw new Error('Invalid model view')
      return { id, name, api }
    })
    const safeRejected = rejected.map((item: unknown) => {
      if (typeof item !== 'object' || item === null) throw new Error('Invalid rejection view')
      const id: unknown = Reflect.get(item, 'id'), code: unknown = Reflect.get(item, 'code')
      if (typeof code !== 'string' || !/^[A-Z][A-Z0-9_]{0,100}$/.test(code) || (id !== undefined && typeof id !== 'string')) throw new Error('Invalid rejection view')
      return { ...id === undefined ? {} : { id }, code }
    })
    const warnings: unknown = Reflect.get(view, 'warnings')
    if (warnings !== undefined && (!Array.isArray(warnings) || warnings.length > 1024)) return empty
    const safeWarnings = warnings === undefined ? undefined : (warnings as unknown[]).map((item: unknown) => {
      if (typeof item !== 'object' || item === null) throw new Error('Invalid warning view')
      const id: unknown = Reflect.get(item, 'id'), code: unknown = Reflect.get(item, 'code')
      if (typeof id !== 'string' || typeof code !== 'string' || !/^[A-Z][A-Z0-9_]{0,100}$/.test(code)) throw new Error('Invalid warning view')
      return { id, code }
    })
    const discoveredAt: unknown = Reflect.get(view, 'discoveredAt')
    const error: unknown = Reflect.get(view, 'error')
    return {
      state: allowed.find(value => value === state)!, models: safeModels, rejected: safeRejected,
      ...safeWarnings === undefined ? {} : { warnings: safeWarnings },
      ...typeof discoveredAt === 'number' && Number.isSafeInteger(discoveredAt) && discoveredAt >= 0 ? { discoveredAt } : {},
      ...error === undefined ? {} : { error: typeof error === 'string' && /^[A-Z][A-Z0-9_]{0,100}$/.test(error) ? error : 'COPILOT_MODEL_DISCOVERY_FAILED' },
    }
  } catch { return empty }
}

export interface GitHubCopilotAuthorizationView {
  readonly phase: GitHubCopilotAuthorizationPhase
  readonly configured: boolean
  readonly writable: boolean
  readonly inFlight: boolean
  readonly notices: readonly AuthorizationNoticeView[]
  readonly catalog?: GitHubCopilotModelCatalogView
  readonly route?: GitHubCopilotRouteView
  readonly accountModels?: GitHubCopilotAccountModelsView
  readonly modelPreferences?: GitHubCopilotModelPreferencesView
  readonly error?: string
  /** Latest fixed interaction milestone observed during a failed or active attempt; never a failure cause. */
  readonly authorizationMilestone?: GitHubCopilotAuthorizationMilestone
}

interface ModelPreferenceSettingsView {
  describe(options: { redactSecrets: true }): readonly {
    readonly ns: string
    readonly revision: number
    readonly user?: unknown
    readonly value?: unknown
  }[]
  mutate(namespace: string, operations: readonly {
    readonly op: 'set' | 'unset'
    readonly path: readonly string[]
    readonly value?: unknown
  }[], expectedRevision?: number): Promise<void>
}

function modelPreferencesView(
  ctx: Context,
  accountModels: GitHubCopilotAccountModelsView | undefined,
  error?: GitHubCopilotModelPreferencesView['error'],
): GitHubCopilotModelPreferencesView {
  const unavailable = (diagnostic: GitHubCopilotModelPreferencesView['error']): GitHubCopilotModelPreferencesView => ({
    state: 'error', writable: false, excludedModelIds: [], lockedModelIds: [],
    unavailableExcludedModelIds: [], error: diagnostic,
  })
  let settings: ModelPreferenceSettingsView
  let descriptor: ReturnType<ModelPreferenceSettingsView['describe']>[number] | undefined
  try {
    settings = service<ModelPreferenceSettingsView>(ctx, 'settings', ['describe', 'mutate'])
    descriptor = settings.describe({ redactSecrets: true }).find(item => item.ns === GITHUB_COPILOT_SETTINGS_NAMESPACE)
  } catch { return unavailable('COPILOT_MODEL_SETTINGS_UNAVAILABLE') }
  if (descriptor === undefined) return unavailable('COPILOT_MODEL_SETTINGS_UNAVAILABLE')
  if (!Number.isSafeInteger(descriptor.revision) || descriptor.revision < 0) return unavailable('COPILOT_MODEL_SETTINGS_INVALID')
  let excludedModelIds: readonly string[]
  let highCostModelIds: readonly string[]
  try {
    const raw = object(descriptor.value)
    if (raw === undefined) return unavailable('COPILOT_MODEL_SETTINGS_INVALID')
    excludedModelIds = normalizeExcludedModelIds(raw.excludedModelIds)
    highCostModelIds = normalizeHighCostModelIds(raw.highCostModelIds)
  } catch { return unavailable('COPILOT_MODEL_SETTINGS_INVALID') }
  const diagnostic = error
  const available = new Set(accountModels?.models.map(model => model.id) ?? [])
  return {
    state: diagnostic === undefined ? 'ready' : 'error',
    writable: true,
    revision: descriptor.revision,
    excludedModelIds,
    highCostModelIds,
    lockedModelIds: [],
    unavailableExcludedModelIds: excludedModelIds.filter(id => !available.has(id)),
    ...diagnostic === undefined ? {} : { error: diagnostic },
  }
}

export type GitHubCopilotAuthorizationMilestone =
  | 'AUTHORIZATION_REQUESTED'
  | 'INTERACTION_PROMPT_OBSERVED'
  | 'INTERACTION_NOTICE_OBSERVED'

interface AuthorizationMethodView {
  readonly id: string
  readonly label: string
}

interface AuthorizationEntryView {
  readonly methods: readonly AuthorizationMethodView[]
  readonly inFlight: boolean
}

interface AuthorizationServiceView {
  describe(key: string): AuthorizationEntryView | undefined
  begin(request: {
    key: string
    method: string
    interaction: {
      notify(notice: AuthorizationNoticeView): void
      prompt(prompt: { readonly kind: string; readonly message: string }): Promise<string>
    }
  }): Promise<{ status: 'authorized' | 'cancelled' }>
  cancel(key: string): void
}

interface CredentialRecordInfoView {
  readonly configured: boolean
  readonly writable: boolean
}

interface CredentialRecordServiceView {
  describeRecord(key: string): Promise<CredentialRecordInfoView>
  readRecord(key: string): Promise<{ readonly kind: string; readonly payload?: unknown } | undefined>
  deleteRecord(key: string): Promise<void>
}

function validateGrant(record: { readonly kind: string; readonly payload?: unknown }): void {
  if (record.kind !== 'grant') throw new Error('github-copilot: the configured credential is not an OAuth grant')
  normalizeGitHubCopilotOAuthCredential(record.payload)
}

function service<T extends object>(
  ctx: Context,
  name: string,
  methods: readonly string[],
): T {
  const candidate = ctx.get(name)
  if (typeof candidate !== 'object' || candidate === null) {
    throw new Error(`github-copilot: required DSH service "${name}" is unavailable`)
  }
  for (const method of methods) {
    if (typeof Reflect.get(candidate, method) !== 'function') {
      throw new Error(`github-copilot: required DSH API "${name}.${method}" is unavailable`)
    }
  }
  return candidate as T
}

function providerModels(value: unknown): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(value)) return undefined
  const models: Array<Record<string, unknown>> = []
  for (const candidate of value) {
    if (typeof candidate !== 'object' || candidate === null) return undefined
    const model = candidate as Record<string, unknown>
    if (typeof model.id !== 'string') return undefined
    if (model.api !== undefined && typeof model.api !== 'string') return undefined
    models.push(model)
  }
  return models
}


function providerSupportsStrictMode(profile: Record<string, unknown> | undefined): unknown {
  const compat = profile?.compat
  if (typeof compat !== 'object' || compat === null) return undefined
  return Reflect.get(compat, 'supportsStrictMode')
}

interface RoutePlan {
  readonly operations: RouteMutation[]
  readonly backup?: RouteBackup
  readonly clearBackup?: boolean
}

/** Pure planning: a conflict never acquires or extends ownership. */
function planRoute(
  snapshot: ReturnType<typeof settingsSnapshot>,
): RoutePlan {
  const { current, raw, backup } = snapshot
  const currentHasOverlay = (providerModels(current?.models) ?? [])
    .some(entry => temporaryGitHubCopilotModelFromProfile(entry) !== undefined)
  if (backup !== undefined) {
    if (snapshot.hasOwnedSecrets) throw new TemporaryRouteConflictError()
    const ownership = assertOwned(raw, backup)
    // Core revisions reset when a namespace is registered again, and the public
    // settings seam exposes no registration identity or lifecycle event. Even a
    // matching process epoch/revision cannot prove a prepared write is fresh.
    // A later call may clear an already-restored target, but must never replay
    // an uncommitted activation/restoration from persisted pre/postimages.
    if ((backup.phase === 'overlay' && ownership === 'preimage')
      || (backup.phase === 'restoring' && ownership === 'postimage')) throw new TemporaryRouteConflictError()
    if (backup.preimage.models?.some(model => model.id === LEGACY_V2_MODEL_ID)) {
      // This exact ID identifies an unsafe historical v2 preimage, not a new
      // routing rule. An empty replacement would enable Core's whole catalog.
      throw new TemporaryRouteConflictError()
    }
    if (backup.phase === 'restoring' && !equalJson(backup.target, backup.preimage)) {
      // Older projection-based targets need review; do not reinterpret or erase
      // their original preimage merely because that target was already written.
      throw new TemporaryRouteConflictError()
    }
    if (backup.phase === 'restoring' && ownership === 'target') {
      // Restoration committed already. In particular do not replay header removal.
      return { operations: [], clearBackup: true }
    }
    // The plugin no longer installs a global protocol override. Retire only
    // the verified old writes; the separate preview owns no canonical leaves.
    const restoring: RouteBackup = {
      ...backup,
      phase: 'restoring',
      sourceRevision: snapshot.routeRevision,
      sourceEpoch: ROUTE_OWNERSHIP_EPOCH,
      target: { ...backup.preimage },
      removeProfile: Object.keys(backup.preimage).length === 0 && wholeProfileOwned(snapshot, backup),
    }
    if (restoring.removeProfile && !wholeProfileOwned(snapshot, backup)) throw new TemporaryRouteConflictError()
    const operations: RouteMutation[] = restoring.removeProfile
      ? [{ op: 'unset', path: ['providers', GITHUB_COPILOT_PROVIDER_ID] }]
      : [...leafOperations(raw, restoring.target!), ...ownedHeaderRemoval(current, backup)]
    return { operations, backup: restoring, clearBackup: true }
  }
  else if (currentHasOverlay) {
    throw new TemporaryRouteConflictError('TEMPORARY_ROUTE_LEGACY_CONFLICT')
  }
  // The managed account route does not require a canonical profile. Preserve
  // its intentional absence after migration or first sign-in; startup and auth
  // refresh must not resurrect a second route. Existing Core/user profiles keep
  // their models, APIs and headers, with only the legacy compatibility leaf repaired.
  const operations: RouteMutation[] = []
  if (current !== undefined && providerSupportsStrictMode(current) !== false) {
    operations.push({ op: 'set', path: ['providers', GITHUB_COPILOT_PROVIDER_ID, 'compat', 'supportsStrictMode'], value: false })
  }
  return { operations }
}

/** Read-only legacy configuration planning; not-configured permits managed-only use and never requests creation. */
export async function describeGitHubCopilotProviderProfile(ctx: Context): Promise<{
  state: 'ready' | 'needs-repair' | 'not-configured' | 'conflict'
  catalog?: GitHubCopilotModelCatalogView
}> {
  const credentials = service<CredentialRecordServiceView>(ctx, 'credentials', ['readRecord'])
  const record = await credentials.readRecord(GITHUB_COPILOT_CREDENTIAL_KEY)
  if (record === undefined) return { state: 'not-configured' }
  validateGrant(record)
  try {
    const settings = service<RouteSettings>(ctx, 'settings', ['describe'])
    const snapshot = settingsSnapshot(settings)
    const plan = planRoute(snapshot)
    const needsRepair = plan.operations.length > 0 || plan.clearBackup === true
      || (plan.backup !== undefined && !equalJson(plan.backup, snapshot.backup))
    return { state: needsRepair ? 'needs-repair' : snapshot.current === undefined ? 'not-configured' : 'ready' }
  }
  catch (error) {
    if (error instanceof TemporaryRouteConflictError) return { state: 'conflict' }
    throw error
  }
}

async function repairGitHubCopilotProviderProfile(ctx: Context): Promise<GitHubCopilotProviderProfileResult> {
  const credentials = service<CredentialRecordServiceView>(ctx, 'credentials', ['readRecord'])
  const record = await credentials.readRecord(GITHUB_COPILOT_CREDENTIAL_KEY)
  if (record === undefined) return { changed: false }
  validateGrant(record)
  const settings = service<RouteSettings>(ctx, 'settings', ['describe', 'mutate'])
  const snapshot = settingsSnapshot(settings)
  const plan = planRoute(snapshot)
  let markerRevision = snapshot.markerRevision
  let changed = false
  const write = async (namespace: string, operations: readonly RouteMutation[], revision: number) => {
    try { await settings.mutate(namespace, operations, revision) }
    catch (error) {
      if (object(error)?.code === 'SETTINGS_CONFLICT') throw new TemporaryRouteConflictError()
      throw error
    }
  }
  if (plan.backup !== undefined && !equalJson(plan.backup, snapshot.backup)) {
    await write(GITHUB_COPILOT_SETTINGS_NAMESPACE, [{ op: 'set', path: ['temporaryRouteBackup'], value: encodeBackup(plan.backup) }], markerRevision)
    // Read the exact committed descriptor revision, never assume it increments by one.
    const after = settingsSnapshot(settings)
    if (!equalJson(after.backup, plan.backup)) throw new TemporaryRouteConflictError()
    markerRevision = after.markerRevision
    changed = true
  }
  if (plan.operations.length > 0) {
    await write(LLM_PI_AI_SETTINGS_NAMESPACE, plan.operations, snapshot.routeRevision)
    // The settings seam has no cross-namespace transaction. Detect a lost or
    // replaced marker after the await; never claim success or blindly roll back.
    const after = settingsSnapshot(settings)
    if (!equalJson(after.backup, plan.backup ?? snapshot.backup)) throw new TemporaryRouteConflictError()
    changed = true
  }
  if (plan.clearBackup) {
    // Validate the restored target again before clearing. A failed clear is a
    // durable restoring journal, not permission to overwrite a later user edit.
    const after = settingsSnapshot(settings)
    const restoring = plan.backup ?? snapshot.backup!
    if (assertOwned(after.raw, restoring) !== 'target') throw new TemporaryRouteConflictError()
    await write(GITHUB_COPILOT_SETTINGS_NAMESPACE, [{ op: 'unset', path: ['temporaryRouteBackup'] }], markerRevision)
    changed = true
  }
  return { changed }
}

export async function inspectGitHubCopilotProviderProfile(
  ctx: Context,
): Promise<GitHubCopilotProviderProfileResult> {
  const active = profileRepairs.get(ctx)
  if (active !== undefined) return active
  const repair = repairGitHubCopilotProviderProfile(ctx).finally(() => {
    if (profileRepairs.get(ctx) === repair) profileRepairs.delete(ctx)
  })
  profileRepairs.set(ctx, repair)
  return repair
}

export async function ensureGitHubCopilotProviderProfile(ctx: Context): Promise<boolean> {
  return (await inspectGitHubCopilotProviderProfile(ctx)).changed
}

/**
 * Remote owner for the browser companion. No credential payload crosses this
 * service: status uses record descriptions, sign-in delegates to the
 * registered llm-pi-ai flow, and sign-out asks the credential seam to delete
 * only llm-pi-ai's Copilot record.
 */
export class GitHubCopilotAuthorizationController extends TypertRemoteService {
  private notices: AuthorizationNoticeView[] = []
  private failure: string | undefined
  private reconciliationFailed = false
  private attempt: Promise<void> | undefined
  private authorizationMilestone: GitHubCopilotAuthorizationMilestone | undefined
  private modelPreferenceFailure: GitHubCopilotModelPreferencesView['error']
  private readonly nativeModelSyncPlans = new Map<string, {
    readonly expiresAt: number
    readonly accountGeneration: number
    readonly generation: number
    readonly fetchedAt: number
    readonly preferencesRevision: number
    readonly routeRevision: number
    readonly markerRevision: number
    readonly models: readonly NativeModelProfile[]
    readonly proofCurrent: () => boolean
    readonly nativeCatalog: NativeCopilotCatalogSnapshot
    readonly source: GitHubCopilotPreview
  }>()

  constructor(ctx: Context) {
    super(ctx, 'githubCopilotAuthorization', { namespace: 'githubCopilot' })
  }

  /** No-argument Ops evidence; deliberately independent of ordinary account status. */
  @Remote
  migrationStatus(): GitHubCopilotMigrationStatus {
    return migrationStatus(this.ctx)
  }

  @Remote
  async status(): Promise<GitHubCopilotAuthorizationView> {
    const accounts = this.ctx.get('githubCopilotAccounts')
    if (accounts) {
      let accountId: string
      try { accountId = accounts.host.capture().accountId }
      catch {
        return { phase: 'error', configured: false, writable: false, inFlight: false, notices: [],
          error: 'COPILOT_ACCOUNTS_SELECTOR_INVALID' }
      }
      if (accountId !== 'canonical') {
        const view = await accounts.get()
        const row = view.accounts.find(row => row.id === accountId)
        const discovered = accountModelsView(this.ctx)
        return { phase: view.operation === 'authorizing' ? 'authorizing' : view.state === 'error' ? 'error'
          : row?.configured ? 'signed-in' : 'signed-out',
        configured: row?.configured === true, writable: view.writable, inFlight: view.operation !== undefined,
        notices: view.notices, route: { state: 'not-configured' },
        ...discovered === undefined ? {} : { accountModels: discovered },
        modelPreferences: modelPreferencesView(this.ctx, discovered, this.modelPreferenceFailure),
        ...view.diagnostic === undefined ? {} : { error: view.diagnostic } }
      }
    }
    const authorization = service<AuthorizationServiceView>(
      this.ctx,
      'authorization',
      ['describe'],
    )
    const credentials = service<CredentialRecordServiceView>(
      this.ctx,
      'credentials',
      ['describeRecord'],
    )
    const record = await credentials.describeRecord(GITHUB_COPILOT_CREDENTIAL_KEY)
    let route: GitHubCopilotRouteView = { state: 'not-configured' }
    let catalog: GitHubCopilotModelCatalogView | undefined
    if (record.configured) {
      try {
        const profile = await describeGitHubCopilotProviderProfile(this.ctx)
        catalog = profile.catalog
        route = {
          state: profile.state,
          ...profile.state === 'conflict' ? { diagnosticCode: 'ROUTE_CONFLICT' as const } : {},
        }
      } catch {
        route = { state: 'error', diagnosticCode: 'ROUTE_READ_FAILED' }
      }
      if (this.reconciliationFailed && route.state === 'needs-repair') {
        route = { state: 'needs-repair', diagnosticCode: 'RECONCILIATION_FAILED' }
      }
    }
    // Keep the attempt visible until its native authorization promise settles.
    const inFlight = authorization.describe(GITHUB_COPILOT_CREDENTIAL_KEY)?.inFlight === true
      || this.attempt !== undefined
    const discovered = accountModelsView(this.ctx)
    const modelPreferences = modelPreferencesView(this.ctx, discovered, this.modelPreferenceFailure)
    return {
      phase: inFlight
        ? 'authorizing'
        : this.failure !== undefined
          ? 'error'
          : record.configured ? 'signed-in' : 'signed-out',
      configured: record.configured,
      writable: record.writable,
      inFlight,
      notices: inFlight ? [...this.notices] : [],
      route,
      ...catalog === undefined ? {} : { catalog },
      ...discovered === undefined ? {} : { accountModels: discovered },
      ...modelPreferences === undefined ? {} : { modelPreferences },
      ...this.failure === undefined ? {} : { error: this.failure },
      ...this.authorizationMilestone === undefined ? {} : { authorizationMilestone: this.authorizationMilestone },
    }
  }

  @Remote
  async excludeModel(modelId: string): Promise<GitHubCopilotAuthorizationView> {
    await this.updateModelExclusion(modelId, true)
    return this.status()
  }

  @Remote
  async restoreModel(modelId: string): Promise<GitHubCopilotAuthorizationView> {
    await this.updateModelExclusion(modelId, false)
    return this.status()
  }

  @Remote
  async setModelExcluded(modelId: string, excluded: boolean): Promise<GitHubCopilotModelPreferencesView> {
    return this.updateModelExclusion(modelId, excluded)
  }

  @Remote
  async setModelHighCost(modelId: string, highCost: boolean): Promise<GitHubCopilotModelPreferencesView> {
    return this.updateModelExclusion(modelId, highCost, 'highCostModelIds')
  }

  /** Refresh and preview a one-time snapshot for the native canonical profile. */
  @Remote
  async previewNativeModelSync(): Promise<GitHubCopilotNativeModelSyncPreview> {
    return this.buildNativeModelSyncPlan(true)
  }

  /** Prepare from current account evidence without forcing discovery or changing settings. */
  @Remote
  async prepareNativeModelSync(): Promise<GitHubCopilotNativeModelSyncPreview> {
    return this.buildNativeModelSyncPlan(false)
  }

  private async buildNativeModelSyncPlan(forceDiscovery: boolean): Promise<GitHubCopilotNativeModelSyncPreview> {
    const empty = (state: GitHubCopilotNativeModelSyncPreview['state'],
      code?: GitHubCopilotNativeModelSyncCode): GitHubCopilotNativeModelSyncPreview => ({
      state, ...(code === undefined ? {} : { code }), enabledCount: 0, syncableCount: 0,
      outputTokenDefaults: [], addedIds: [], removedIds: [], updatedIds: [], skipped: [],
    })
    const lease = this.acquireNativeModelSyncLease()
    if (lease === null) return empty('error', 'NATIVE_MODEL_SYNC_ACCOUNT_UNAVAILABLE')
    try {
      if (lease.binding.accountId !== 'canonical') {
        return empty('blocked', 'NATIVE_MODEL_SYNC_ACCOUNT_MISMATCH')
      }
      try {
        const settings = service<RouteSettings>(this.ctx, 'settings', ['describe', 'mutate'])
        if (settingsSnapshot(settings).current === undefined) {
          return empty('blocked', 'NATIVE_MODEL_SYNC_PROFILE_MISSING')
        }
      } catch { return empty('error', 'NATIVE_MODEL_SYNC_SETTINGS_UNAVAILABLE') }
      const source = this.ctx.get('githubCopilotPreview')
      if (source === undefined) return empty('error', 'NATIVE_MODEL_SYNC_DISCOVERY_UNAVAILABLE')
      if (forceDiscovery) {
        try { await source.discoverNativeModelSync() }
        catch { return empty('error', 'NATIVE_MODEL_SYNC_DISCOVERY_UNAVAILABLE') }
      }
      try { lease.binding.assertCurrent() }
      catch { return empty('blocked', 'NATIVE_MODEL_SYNC_ACCOUNT_MISMATCH') }
      if (!this.nativeSyncUsesCanonicalAccount()) return empty('blocked', 'NATIVE_MODEL_SYNC_ACCOUNT_MISMATCH')
      const snapshot = source.nativeModelSyncSnapshot()
      if (snapshot === undefined) return empty('error', 'NATIVE_MODEL_SYNC_MODELS_UNAVAILABLE')
      const proofCurrent = snapshot.isCurrent
      if (!proofCurrent()) return empty('error', 'NATIVE_MODEL_SYNC_MODELS_UNAVAILABLE')

      let nativeCatalog: NativeCopilotCatalogSnapshot | undefined
      try { nativeCatalog = await captureNativeCopilotCatalog(this.ctx) }
      catch { return empty('error', 'NATIVE_MODEL_SYNC_NATIVE_CATALOG_UNAVAILABLE') }
      if (nativeCatalog === undefined || nativeCatalog.namespace !== LLM_PI_AI_SETTINGS_NAMESPACE) {
        return empty('error', 'NATIVE_MODEL_SYNC_NATIVE_CATALOG_UNAVAILABLE')
      }
      try { nativeCatalog.assertCurrent() }
      catch { return empty('error', 'NATIVE_MODEL_SYNC_NATIVE_CATALOG_UNAVAILABLE') }
      try { lease.binding.assertCurrent() }
      catch { return empty('blocked', 'NATIVE_MODEL_SYNC_ACCOUNT_MISMATCH') }
      const currentSnapshot = source.nativeModelSyncSnapshot()
      if (this.ctx.get('githubCopilotPreview') !== source || !proofCurrent()
        || currentSnapshot === undefined || currentSnapshot.generation !== snapshot.generation
        || currentSnapshot.fetchedAt !== snapshot.fetchedAt) {
        return empty('error', 'NATIVE_MODEL_SYNC_MODELS_UNAVAILABLE')
      }
      const preferences = modelPreferencesView(this.ctx, accountModelsView(this.ctx))
      if (preferences.state !== 'ready' || !preferences.writable || preferences.revision === undefined) {
        return empty('error', 'NATIVE_MODEL_SYNC_PREFERENCES_UNAVAILABLE')
      }

      let route: ReturnType<typeof settingsSnapshot>
      try {
        const settings = service<RouteSettings>(this.ctx, 'settings', ['describe', 'mutate'])
        route = settingsSnapshot(settings)
        nativeCatalog.assertCurrent()
      } catch { return empty('error', 'NATIVE_MODEL_SYNC_SETTINGS_UNAVAILABLE') }
      if (route.backup !== undefined || route.hasOwnedSecrets) {
        return empty('blocked', 'NATIVE_MODEL_SYNC_ROUTE_OWNERSHIP_CONFLICT')
      }
      const profile = route.current
      if (profile === undefined) return empty('blocked', 'NATIVE_MODEL_SYNC_PROFILE_MISSING')
      const profileProblem = nativeSyncProfileProblem(profile, route.hasSecrets)
      if (profileProblem !== undefined) return empty('blocked', profileProblem)

      let currentModels: readonly Readonly<Record<string, unknown>>[]
      const configuredModels = profile.models
      if (configuredModels === undefined || Array.isArray(configuredModels) && configuredModels.length === 0) {
        currentModels = []
      } else if (Array.isArray(configuredModels) && configuredModels.length <= 512
        && configuredModels.every(item => object(item) !== undefined)) {
        currentModels = configuredModels as readonly Readonly<Record<string, unknown>>[]
      } else return empty('error', 'NATIVE_MODEL_SYNC_SETTINGS_INVALID')
      if (profile.api !== undefined && (typeof profile.api !== 'string' || profile.api.length === 0)
        || profile.reasoning !== undefined && typeof profile.reasoning !== 'string') {
        return empty('error', 'NATIVE_MODEL_SYNC_SETTINGS_INVALID')
      }
      let plan: ReturnType<typeof planNativeModelSync>
      try {
        plan = planNativeModelSync({
          accountModels: snapshot.models,
          excludedModelIds: new Set(preferences.excludedModelIds),
          currentModels,
          currentModelsUseCatalog: currentModels.length === 0,
          ...(typeof profile.api === 'string' ? { routeApi: profile.api } : {}),
          ...(typeof profile.reasoning === 'string' ? { routeReasoning: profile.reasoning } : {}),
          nativeCatalog: [...nativeCatalog.catalog.values()],
        })
      } catch { return empty('error', 'NATIVE_MODEL_SYNC_SETTINGS_INVALID') }
      if (plan.models.length === 0) {
        return { ...empty('blocked', 'NATIVE_MODEL_SYNC_NO_SYNCABLE_MODELS'),
          enabledCount: plan.enabledCount, skipped: plan.skipped }
      }
      if (!nativeSyncSupportsRouteCompatibility(profile, plan.models, snapshot.models)) {
        return empty('blocked', 'NATIVE_MODEL_SYNC_ROUTE_COMPAT_UNPROVEN')
      }

      const now = Date.now()
      for (const [id, pending] of this.nativeModelSyncPlans) {
        if (pending.expiresAt <= now) this.nativeModelSyncPlans.delete(id)
      }
      while (this.nativeModelSyncPlans.size >= 8) {
        this.nativeModelSyncPlans.delete(this.nativeModelSyncPlans.keys().next().value!)
      }
      const planId = randomUUID()
      this.nativeModelSyncPlans.set(planId, {
        expiresAt: now + 5 * 60_000,
        accountGeneration: lease.binding.generation,
        generation: snapshot.generation,
        fetchedAt: snapshot.fetchedAt,
        preferencesRevision: preferences.revision,
        routeRevision: route.routeRevision,
        markerRevision: route.markerRevision,
        models: plan.models,
        proofCurrent,
        nativeCatalog,
        source,
      })
      return {
        state: 'ready', planId, enabledCount: plan.enabledCount, syncableCount: plan.syncableCount,
        outputTokenDefaults: plan.outputTokenDefaults,
        addedIds: plan.addedIds, removedIds: plan.removedIds, updatedIds: plan.updatedIds, skipped: plan.skipped,
      }
    } finally { lease.release() }
  }

  /** Apply only the exact previewed model array using namespace CAS and readback. */
  @Remote
  async applyNativeModelSync(planId: string): Promise<GitHubCopilotNativeModelSyncResult> {
    const failed = (code: GitHubCopilotNativeModelSyncCode): GitHubCopilotNativeModelSyncResult =>
      ({ state: 'error', code, modelCount: 0 })
    const plan = this.nativeModelSyncPlans.get(planId)
    this.nativeModelSyncPlans.delete(planId)
    if (plan === undefined || plan.expiresAt <= Date.now()) return failed('NATIVE_MODEL_SYNC_PLAN_EXPIRED')
    const lease = this.acquireNativeModelSyncLease()
    if (lease === null) return failed('NATIVE_MODEL_SYNC_ACCOUNT_UNAVAILABLE')
    try {
      if (lease.binding.accountId !== 'canonical') return failed('NATIVE_MODEL_SYNC_ACCOUNT_MISMATCH')
      if (lease.binding.generation !== plan.accountGeneration) return failed('NATIVE_MODEL_SYNC_PLAN_STALE')
      const source = this.ctx.get('githubCopilotPreview')
      const snapshot = source?.nativeModelSyncSnapshot()
      if (source !== plan.source || snapshot === undefined
        || snapshot.generation !== plan.generation || snapshot.fetchedAt !== plan.fetchedAt
        || !plan.proofCurrent()) {
        return failed('NATIVE_MODEL_SYNC_PLAN_STALE')
      }
      try { plan.nativeCatalog.assertCurrent() }
      catch { return failed('NATIVE_MODEL_SYNC_PLAN_STALE') }
      const preferences = modelPreferencesView(this.ctx, accountModelsView(this.ctx))
      if (preferences.state !== 'ready' || !preferences.writable || preferences.revision !== plan.preferencesRevision) {
        return failed('NATIVE_MODEL_SYNC_PLAN_STALE')
      }

      let settings: RouteSettings
      let route: ReturnType<typeof settingsSnapshot>
      try {
        settings = service<RouteSettings>(this.ctx, 'settings', ['describe', 'mutate'])
        route = settingsSnapshot(settings)
      } catch { return failed('NATIVE_MODEL_SYNC_SETTINGS_UNAVAILABLE') }
      if (route.backup !== undefined || route.hasOwnedSecrets) return failed('NATIVE_MODEL_SYNC_ROUTE_OWNERSHIP_CONFLICT')
      if (route.current === undefined) return failed('NATIVE_MODEL_SYNC_PROFILE_MISSING')
      const profileProblem = nativeSyncProfileProblem(route.current, route.hasSecrets)
      if (profileProblem !== undefined) return failed(profileProblem)
      if (!nativeSyncSupportsRouteCompatibility(route.current, plan.models, snapshot.models)) {
        return failed('NATIVE_MODEL_SYNC_ROUTE_COMPAT_UNPROVEN')
      }
      if (route.routeRevision !== plan.routeRevision || route.markerRevision !== plan.markerRevision) {
        return failed('NATIVE_MODEL_SYNC_PLAN_STALE')
      }
      const routeApi = route.current.api
      const routeReasoning = route.current.reasoning
      const routeCompatibility = structuredClone(route.current.compat)
      const latestPreferences = modelPreferencesView(this.ctx, accountModelsView(this.ctx))
      if (latestPreferences.state !== 'ready' || !latestPreferences.writable
        || latestPreferences.revision !== plan.preferencesRevision || !plan.proofCurrent()) {
        return failed('NATIVE_MODEL_SYNC_PLAN_STALE')
      }
      try { lease.binding.assertCurrent(); plan.nativeCatalog.assertCurrent() }
      catch { return failed('NATIVE_MODEL_SYNC_PLAN_STALE') }
      try {
        await settings.mutate(LLM_PI_AI_SETTINGS_NAMESPACE, [{
          op: 'set', path: ['providers', GITHUB_COPILOT_PROVIDER_ID, 'models'], value: plan.models,
        }], plan.routeRevision)
      } catch (cause) {
        const error = object(cause)
        try { lease.binding.assertCurrent() }
        catch { return failed('NATIVE_MODEL_SYNC_READBACK_FAILED') }
        return failed(error?.code === 'SETTINGS_CONFLICT' || cause instanceof Error && /conflict/i.test(cause.message)
          ? 'NATIVE_MODEL_SYNC_SETTINGS_CONFLICT' : 'NATIVE_MODEL_SYNC_SAVE_FAILED')
      }
      try {
        const nativeCatalog = await captureNativeCopilotCatalog(this.ctx)
        if (nativeCatalog === undefined || nativeCatalog.namespace !== plan.nativeCatalog.namespace
          || !sameNativeCatalog(nativeCatalog.catalog, plan.nativeCatalog.catalog)) {
          return failed('NATIVE_MODEL_SYNC_READBACK_FAILED')
        }
        lease.binding.assertCurrent()
        const saved = settingsSnapshot(settings)
        const currentPreferences = modelPreferencesView(this.ctx, accountModelsView(this.ctx))
        const currentSnapshot = source?.nativeModelSyncSnapshot()
        nativeCatalog.assertCurrent()
        if (saved.current === undefined || saved.backup !== undefined
          || saved.markerRevision !== plan.markerRevision
          || saved.routeRevision < plan.routeRevision || saved.routeRevision > plan.routeRevision + 1
          || nativeSyncProfileProblem(saved.current, saved.hasSecrets) !== undefined
          || saved.current.api !== routeApi || saved.current.reasoning !== routeReasoning
          || !equalJson(saved.current.compat, routeCompatibility)
          || !nativeSyncSupportsRouteCompatibility(saved.current, plan.models, snapshot.models)
          || !equalJson(saved.raw?.models, plan.models) || !effectiveNativeModelsMatch(saved.current.models, plan.models)
          || currentPreferences.state !== 'ready' || !currentPreferences.writable
          || currentPreferences.revision !== plan.preferencesRevision || !plan.proofCurrent()
          || this.ctx.get('githubCopilotPreview') !== source
          || currentSnapshot === undefined || currentSnapshot.generation !== plan.generation
          || currentSnapshot.fetchedAt !== plan.fetchedAt) {
          return failed('NATIVE_MODEL_SYNC_READBACK_FAILED')
        }
      } catch { return failed('NATIVE_MODEL_SYNC_READBACK_FAILED') }
      return { state: 'ready', modelCount: plan.models.length }
    } finally { lease.release() }
  }

  private acquireNativeModelSyncLease() {
    try { return this.ctx.get('githubCopilotAccounts')?.host.acquire(undefined, true) ?? null }
    catch { return null }
  }

  private nativeSyncUsesCanonicalAccount(): boolean {
    try { return this.ctx.get('githubCopilotAccounts')?.host.capture().accountId === 'canonical' }
    catch { return false }
  }

  /** Explicit model discovery: may refresh OAuth and GET the account catalog, never changes selection. */
  @Remote
  async discoverModels(): Promise<GitHubCopilotAuthorizationView> {
    return this.loadAccountModels(true)
  }

  /** Ensure metadata for a visible account view, honoring shared cache and failure cooldown. */
  @Remote
  async ensureModels(): Promise<GitHubCopilotAuthorizationView> {
    return this.loadAccountModels(false)
  }

  private async loadAccountModels(force: boolean): Promise<GitHubCopilotAuthorizationView> {
    const current = await this.status()
    if (!current.configured || current.inFlight || this.attempt !== undefined) return current
    const source: unknown = this.ctx.get('githubCopilotPreview')
    const discover: unknown = typeof source === 'object' && source !== null ? Reflect.get(source, 'discover') : undefined
    if (typeof discover !== 'function') return { ...current, accountModels: {
      state: 'error', models: [], rejected: [], error: 'COPILOT_MODEL_DISCOVERY_UNAVAILABLE',
    } }
    try { await discover.call(source, { force }) }
    catch { return { ...await this.status(), accountModels: {
      state: 'error', models: [], rejected: [], error: 'COPILOT_MODEL_DISCOVERY_FAILED',
    } } }
    return this.status()
  }

  /** Explicit route repair over the stored account snapshot; never forces OAuth or a network probe. */
  @Remote
  async reconcile(): Promise<GitHubCopilotAuthorizationView> {
    const accounts = this.ctx.get('githubCopilotAccounts')
    if (accounts && accounts.host.capture().accountId !== 'canonical') return this.status()
    const current = await this.status()
    if (!current.configured || current.inFlight || this.attempt !== undefined) return current
    await this.ensureProviderProfile()
    return this.status()
  }

  @Remote
  async start(): Promise<GitHubCopilotAuthorizationView> {
    const accounts = this.ctx.get('githubCopilotAccounts')
    if (accounts) {
      const binding = accounts.host.capture()
      if (binding.accountId !== 'canonical') {
        const view = await accounts.get()
        if (view.revision === undefined) return this.status()
        await accounts.host.reauthorize(binding.accountId, view.revision)
        return this.status()
      }
    }
    const current = await this.status()
    if (current.inFlight || this.attempt !== undefined) return current
    if (current.configured) return current

    const authorization = service<AuthorizationServiceView>(
      this.ctx,
      'authorization',
      ['describe', 'begin', 'cancel'],
    )
    const flow = authorization.describe(GITHUB_COPILOT_CREDENTIAL_KEY)
    if (flow === undefined) {
      throw new Error(
        'github-copilot: DSH llm-pi-ai did not register the GitHub Copilot authorization flow',
      )
    }
    const oauth = flow.methods.find(method => method.id === 'oauth')
    if (oauth === undefined) {
      throw new Error(
        'github-copilot: the installed llm-pi-ai GitHub Copilot provider offers no OAuth method',
      )
    }

    const admission = accounts?.host.acquireCanonicalAuthorization()
    this.notices = []
    this.failure = undefined
    this.reconciliationFailed = false
    this.authorizationMilestone = 'AUTHORIZATION_REQUESTED'
    let begun: ReturnType<typeof authorization.begin>
    try {
      begun = authorization.begin({
        key: GITHUB_COPILOT_CREDENTIAL_KEY,
        method: oauth.id,
        interaction: {
          notify: (notice) => {
            this.authorizationMilestone = 'INTERACTION_NOTICE_OBSERVED'
            this.notices = [...this.notices, { ...notice }]
          },
          prompt: (prompt) => {
            this.authorizationMilestone = 'INTERACTION_PROMPT_OBSERVED'
            if (prompt.kind === 'text' && /GitHub Enterprise URL\/domain/i.test(prompt.message)) {
              return Promise.resolve('')
            }
            return Promise.reject(new Error(
              'github-copilot: this browser bridge cannot answer the authorization prompt',
            ))
          },
        },
      })
    } catch {
      begun = Promise.reject(new Error('github-copilot: authorization.begin failed'))
    }
    const running = begun.then(async (outcome) => {
      if (outcome.status === 'authorized') {
        // Device-code notices are instructions for an in-flight attempt, not
        // durable provider status.
        this.notices = []
        this.authorizationMilestone = undefined
        return
      }
      this.notices = []
      this.authorizationMilestone = undefined
    }).catch(() => {
      this.notices = []
      this.failure = 'COPILOT_AUTHORIZATION_BEGIN_FAILED'
      this.ctx.logger.error('github-copilot: authorization.begin failed (COPILOT_AUTHORIZATION_BEGIN_FAILED)')
    }).finally(() => {
      this.attempt = undefined
      admission?.release()
    })
    this.attempt = running
    return this.status()
  }

  @Remote
  async cancel(): Promise<GitHubCopilotAuthorizationView> {
    const accounts = this.ctx.get('githubCopilotAccounts')
    if (accounts && accounts.host.capture().accountId !== 'canonical') {
      await accounts.cancel()
      return this.status()
    }
    const authorization = service<AuthorizationServiceView>(
      this.ctx,
      'authorization',
      ['describe', 'begin', 'cancel'],
    )
    this.notices = []
    this.authorizationMilestone = undefined
    authorization.cancel(GITHUB_COPILOT_CREDENTIAL_KEY)
    return this.status()
  }

  @Remote
  async signOut(): Promise<GitHubCopilotAuthorizationView> {
    const accounts = this.ctx.get('githubCopilotAccounts')
    if (accounts && accounts.host.capture().accountId !== 'canonical') {
      await accounts.host.signOutActive()
      return this.status()
    }
    const authorization = service<AuthorizationServiceView>(
      this.ctx,
      'authorization',
      ['describe', 'begin', 'cancel'],
    )
    if (authorization.describe(GITHUB_COPILOT_CREDENTIAL_KEY)?.inFlight === true) {
      throw new Error('github-copilot: cancel the active sign-in attempt before signing out')
    }
    const credentials = service<CredentialRecordServiceView>(
      this.ctx,
      'credentials',
      ['describeRecord', 'deleteRecord'],
    )
    await credentials.deleteRecord(GITHUB_COPILOT_CREDENTIAL_KEY)
    this.notices = []
    this.failure = undefined
    this.reconciliationFailed = false
    this.authorizationMilestone = undefined
    return this.status()
  }

  private async updateModelExclusion(
    modelId: string, exclude: boolean, field: 'excludedModelIds' | 'highCostModelIds' = 'excludedModelIds',
  ): Promise<GitHubCopilotModelPreferencesView> {
    const view = () => modelPreferencesView(this.ctx, accountModelsView(this.ctx), this.modelPreferenceFailure)
    let normalized: string
    try { [normalized] = normalizeExcludedModelIds([modelId]) as [string] }
    catch {
      this.modelPreferenceFailure = 'COPILOT_MODEL_EXCLUSION_SAVE_FAILED'
      return view()
    }
    const current = modelPreferencesView(this.ctx, accountModelsView(this.ctx))
    if (!current.writable || current.revision === undefined) {
      this.modelPreferenceFailure = 'COPILOT_MODEL_PREFERENCES_UNAVAILABLE'
      return view()
    }
    const original = field === 'excludedModelIds' ? current.excludedModelIds : current.highCostModelIds ?? []
    const ids = new Set(original)
    if (exclude) ids.add(normalized)
    else ids.delete(normalized)
    const next = normalizeExcludedModelIds([...ids])
    if (next.length === original.length
      && next.every((id, index) => id === original[index])) {
      this.modelPreferenceFailure = undefined
      return current
    }
    try {
      const settings = service<ModelPreferenceSettingsView>(this.ctx, 'settings', ['describe', 'mutate'])
      await settings.mutate(GITHUB_COPILOT_SETTINGS_NAMESPACE,
        [{ op: 'set', path: [field], value: next }], current.revision)
      this.modelPreferenceFailure = undefined
      const saved = view()
      const readback = field === 'excludedModelIds' ? saved.excludedModelIds : saved.highCostModelIds
      if (!saved.writable || readback === undefined || readback.length !== next.length
        || readback.some((id, index) => id !== next[index])) {
        this.modelPreferenceFailure = 'COPILOT_MODEL_EXCLUSION_SAVE_FAILED'
        return { ...saved, state: 'error', error: this.modelPreferenceFailure }
      }
      return saved
    } catch (cause) {
      const record = object(cause)
      this.modelPreferenceFailure = record?.code === 'SETTINGS_CONFLICT'
        || cause instanceof Error && /conflict/i.test(cause.message)
        ? 'COPILOT_MODEL_EXCLUSION_CONFLICT' : 'COPILOT_MODEL_EXCLUSION_SAVE_FAILED'
    }
    return view()
  }

  private async ensureProviderProfile(): Promise<void> {
    try {
      await ensureGitHubCopilotProviderProfile(this.ctx)
      this.reconciliationFailed = false
    } catch {
      // Valid authentication is independent of configuration repair. Keep
      // credentials and expose only classified, retryable route diagnostics.
      this.reconciliationFailed = true
      this.ctx.logger.warn('github-copilot: route reconciliation failed; review route status before retrying')
    }
  }
}

export default GitHubCopilotAuthorizationController
