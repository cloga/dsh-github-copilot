/**
 * Host-side bridge between the Models-page companion UI and DSH's neutral
 * authorization, credential-record, and settings seams.
 */

import { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { normalizeGitHubCopilotOAuthCredential } from './copilot-grant.ts'
import {
  ROUTE_OWNERSHIP_EPOCH, TemporaryRouteConflictError, assertOwned, encodeBackup, equalJson, leafOperations,
  object, ownedHeaderRemoval, settingsSnapshot, wholeProfileOwned,
  type RouteBackup, type RouteMutation, type RouteSettings,
} from './route-ownership.ts'
import { temporaryGitHubCopilotModelFromProfile } from './temporary-models.ts'

export { GITHUB_COPILOT_CREDENTIAL_KEY, GITHUB_COPILOT_PROVIDER_ID } from './copilot-identity.ts'
import { GITHUB_COPILOT_CREDENTIAL_KEY, GITHUB_COPILOT_PROVIDER_ID } from './copilot-identity.ts'
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
  readonly error?: string
}

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

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
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
    const settings = service<RouteSettings>(ctx, 'settings', ['get', 'describe'])
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
  const settings = service<RouteSettings>(ctx, 'settings', ['get', 'describe', 'mutate'])
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

  constructor(ctx: Context) {
    super(ctx, 'githubCopilotAuthorization', { namespace: 'githubCopilot' })
  }

  @Remote
  async status(): Promise<GitHubCopilotAuthorizationView> {
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
    // Completion must use the same barrier as discoverModels(): native OAuth
    // can finish before this attempt's post-grant profile repair has settled.
    const inFlight = authorization.describe(GITHUB_COPILOT_CREDENTIAL_KEY)?.inFlight === true
      || this.attempt !== undefined
    const discovered = accountModelsView(this.ctx)
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
      ...this.failure === undefined ? {} : { error: this.failure },
    }
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
    const current = await this.status()
    if (!current.configured || current.inFlight || this.attempt !== undefined) return current
    await this.ensureProviderProfile()
    return this.status()
  }

  @Remote
  async start(): Promise<GitHubCopilotAuthorizationView> {
    const current = await this.status()
    if (current.inFlight || this.attempt !== undefined) return current
    if (current.configured) return this.reconcile()

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

    this.notices = []
    this.failure = undefined
    this.reconciliationFailed = false
    const running = authorization.begin({
      key: GITHUB_COPILOT_CREDENTIAL_KEY,
      method: oauth.id,
      interaction: {
        notify: (notice) => {
          this.notices = [...this.notices, { ...notice }]
        },
        prompt: (prompt) => {
          if (prompt.kind === 'text' && /GitHub Enterprise URL\/domain/i.test(prompt.message)) {
            return Promise.resolve('')
          }
          return Promise.reject(new Error(
            `github-copilot: this browser bridge cannot answer authorization prompt "${prompt.message}"`,
          ))
        },
      },
    }).then(async (outcome) => {
      if (outcome.status === 'authorized') {
        // Device-code notices are instructions for an in-flight attempt, not
        // durable provider status. Clear them before the profile repair so a
        // completed grant cannot render "Signed in" beside an expired code.
        this.notices = []
        await this.ensureProviderProfile()
        return
      }
      this.notices = []
    }).catch((error: unknown) => {
      this.notices = []
      this.failure = messageOf(error)
      this.ctx.logger.error('github-copilot: GitHub Copilot authorization failed')
      this.ctx.logger.error(error)
    }).finally(() => {
      this.attempt = undefined
    })
    this.attempt = running
    return this.status()
  }

  @Remote
  async cancel(): Promise<GitHubCopilotAuthorizationView> {
    const authorization = service<AuthorizationServiceView>(
      this.ctx,
      'authorization',
      ['describe', 'begin', 'cancel'],
    )
    this.notices = []
    authorization.cancel(GITHUB_COPILOT_CREDENTIAL_KEY)
    return this.status()
  }

  @Remote
  async signOut(): Promise<GitHubCopilotAuthorizationView> {
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
    return this.status()
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
