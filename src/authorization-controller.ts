/**
 * Host-side bridge between the Models-page companion UI and DSH's neutral
 * authorization, credential-record, and settings seams.
 */

import { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all'
import { normalizeGitHubCopilotOAuthCredential } from './copilot-grant.ts'
import {
  ROUTE_OWNERSHIP_EPOCH, TemporaryRouteConflictError, assertOwned, encodeBackup, equalJson, leafOperations,
  leavesOf, object, ownedHeaderRemoval, settingsSnapshot, wholeProfileOwned,
  type RouteBackup, type RouteMutation, type RouteSettings,
} from './route-ownership.ts'
import {
  temporaryGitHubCopilotModel,
  temporaryGitHubCopilotModelFromProfile,
  temporaryGitHubCopilotModelProfile,
} from './temporary-models.ts'

export const GITHUB_COPILOT_CREDENTIAL_KEY = 'llm-pi-ai/github-copilot'
export const GITHUB_COPILOT_PROVIDER_ID = 'github-copilot'
export const LLM_PI_AI_SETTINGS_NAMESPACE = 'llm-pi-ai'
const GITHUB_COPILOT_SETTINGS_NAMESPACE = 'github-copilot'

export type GitHubCopilotModelCatalogState = 'current' | 'partially-outdated' | 'outdated'

export interface GitHubCopilotModelCatalogView {
  readonly state: GitHubCopilotModelCatalogState
  readonly accountModelCount: number
  readonly supportedModelCount: number
  readonly unknownModelIds: readonly string[]
  readonly temporarilyUnavailableModelIds?: readonly string[]
}

export interface GitHubCopilotProviderProfileResult {
  readonly changed: boolean
  readonly catalog: GitHubCopilotModelCatalogView
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
  readonly state: 'ready' | 'needs-repair' | 'not-configured' | 'conflict' | 'error'
  readonly diagnosticCode?: 'ROUTE_READ_FAILED' | 'RECONCILIATION_FAILED' | 'ROUTE_CONFLICT'
}

export interface GitHubCopilotAuthorizationView {
  readonly phase: GitHubCopilotAuthorizationPhase
  readonly configured: boolean
  readonly writable: boolean
  readonly inFlight: boolean
  readonly notices: readonly AuthorizationNoticeView[]
  readonly catalog?: GitHubCopilotModelCatalogView
  readonly route?: GitHubCopilotRouteView
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

function providerModelsFrom(
  record: { readonly kind: string; readonly payload?: unknown } | undefined,
): {
  readonly models: Record<string, unknown>[]
  readonly restorationModels: Record<string, unknown>[]
  readonly requiredHeaders?: Readonly<Record<string, string>>
  readonly requiredRouteApi?: string
  readonly catalog: GitHubCopilotModelCatalogView
} {
  if (record?.kind !== 'grant') {
    throw new Error('github-copilot: the configured credential is not an OAuth grant')
  }
  const available = [...new Set(
    normalizeGitHubCopilotOAuthCredential(record.payload).availableModelIds ?? [],
  )]
  const installedModels = getBuiltinModels('github-copilot')
  const installed = new Map(installedModels.map(model => [model.id, model.api] as const))
  const installedIds = new Set(installed.keys())
  const temporary = new Map(available.flatMap((id) => {
    const model = temporaryGitHubCopilotModel(id, installedIds)
    return model === undefined ? [] : [[id, model] as const]
  }))
  const requiredApis = new Set([...temporary.values()].map(model => model.api))
  if (requiredApis.size > 1) {
    throw new Error('github-copilot: temporary account models require incompatible route protocols')
  }
  const requiredRouteApi = requiredApis.values().next().value as string | undefined
  const models: Record<string, unknown>[] = []
  const restorationModels: Record<string, unknown>[] = []
  const unknownModelIds: string[] = []
  const temporarilyUnavailableModelIds: string[] = []
  let requiredHeaders: Readonly<Record<string, string>> | undefined
  for (const id of available) {
    const api = installed.get(id)
    if (api !== undefined) {
      restorationModels.push({ id, api })
      if (requiredRouteApi === undefined || api === requiredRouteApi) models.push({ id, api })
      else temporarilyUnavailableModelIds.push(id)
      continue
    }
    const temporaryModel = temporary.get(id)
    if (temporaryModel === undefined) {
      unknownModelIds.push(id)
      continue
    }
    models.push(temporaryGitHubCopilotModelProfile(temporaryModel))
    requiredHeaders = temporaryModel.headers
  }
  const state: GitHubCopilotModelCatalogState = unknownModelIds.length === 0
    ? 'current'
    : models.length === 0 ? 'outdated' : 'partially-outdated'
  return {
    models,
    restorationModels,
    ...requiredHeaders === undefined ? {} : { requiredHeaders },
    ...requiredRouteApi === undefined ? {} : { requiredRouteApi },
    catalog: {
      state,
      accountModelCount: available.length,
      supportedModelCount: models.length,
      unknownModelIds,
      temporarilyUnavailableModelIds,
    },
  }
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

function sameProviderModels(
  current: unknown,
  expected: readonly Record<string, unknown>[],
  currentRouteApi?: string,
  expectedRouteApi?: string,
): boolean {
  const currentModels = providerModels(current)
  const expectedModels = providerModels(expected)
  if (currentModels === undefined || expectedModels === undefined || currentModels.length !== expectedModels.length) {
    return false
  }
  return expectedModels.every((expectedModel, index) => {
    const currentModel = currentModels[index]
    if (currentModel === undefined) return false
    const currentOverlay = temporaryGitHubCopilotModelFromProfile(currentModel)
    const expectedOverlay = temporaryGitHubCopilotModelFromProfile(expectedModel)
    if (currentOverlay !== undefined && expectedOverlay === undefined) return false
    return Object.entries(expectedModel).every(([field, value]) => {
      if (field === 'api') {
        return (currentModel.api ?? currentRouteApi) === (value ?? expectedRouteApi)
      }
      return JSON.stringify(currentModel[field]) === JSON.stringify(value)
    })
  })
}

function providerApi(profile: Record<string, unknown> | undefined): string | undefined {
  return typeof profile?.api === 'string' ? profile.api : undefined
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
  projection: ReturnType<typeof providerModelsFrom>,
): RoutePlan {
  const { current, raw, backup } = snapshot
  const { models, requiredHeaders, requiredRouteApi } = projection
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
    if (backup.phase === 'restoring' || requiredRouteApi === undefined) {
      if (backup.phase === 'restoring' && ownership === 'target') {
        // Restoration committed already. In particular do not replay header removal.
        return { operations: [], clearBackup: true }
      }
      const restoring: RouteBackup = backup.phase === 'restoring' ? backup : {
        ...backup,
        phase: 'restoring',
        sourceRevision: snapshot.routeRevision,
        sourceEpoch: ROUTE_OWNERSHIP_EPOCH,
        target: { ...backup.preimage, ...models.length === 0 ? {} : { models: leavesOf({ models }).models } },
        removeProfile: models.length === 0 && wholeProfileOwned(snapshot, backup),
      }
      if (restoring.removeProfile && !wholeProfileOwned(snapshot, backup)) throw new TemporaryRouteConflictError()
      const operations: RouteMutation[] = restoring.removeProfile
        ? [{ op: 'unset', path: ['providers', GITHUB_COPILOT_PROVIDER_ID] }]
        : [...leafOperations(raw, restoring.target!), ...ownedHeaderRemoval(current, backup)]
      return { operations, backup: restoring, clearBackup: true }
    }
    if (!equalJson(backup.postimage, leavesOf({ api: requiredRouteApi, models }))) {
      // Catalog changes during an active overlay need a new explicit ownership cycle.
      throw new TemporaryRouteConflictError()
    }
  }
  else if (currentHasOverlay) {
    throw new TemporaryRouteConflictError('TEMPORARY_ROUTE_LEGACY_CONFLICT')
  }
  if (models.length === 0) return { operations: [] }
  let nextBackup = backup
  if (requiredRouteApi !== undefined) {
    if (backup === undefined && current?.api !== undefined) throw new TemporaryRouteConflictError()
    const headers = object(current?.headers) ?? {}
    if (Object.entries(requiredHeaders ?? {}).some(([name, value]) =>
      Object.entries(headers).some(([existingName, existingValue]) => existingName.toLowerCase() === name.toLowerCase() && existingValue !== value))) {
      throw new TemporaryRouteConflictError()
    }
    if (nextBackup === undefined) {
      if (snapshot.hasOwnedSecrets) throw new TemporaryRouteConflictError()
      nextBackup = {
        version: 2, phase: 'overlay', sourceRevision: snapshot.routeRevision,
        sourceEpoch: ROUTE_OWNERSHIP_EPOCH, providerExisted: current !== undefined,
        preimage: leavesOf(raw), postimage: leavesOf({ api: requiredRouteApi, models }),
        ownedHeaders: Object.fromEntries(Object.entries(requiredHeaders ?? {}).filter(([name]) =>
          !Object.keys(headers).some(existing => existing.toLowerCase() === name.toLowerCase()))),
      }
    }
  }
  const operations: RouteMutation[] = []
  if (requiredRouteApi !== undefined) operations.push(...leafOperations(raw, nextBackup!.postimage))
  else if (!sameProviderModels(
    (providerModels(current?.models) ?? []).map(entry => ({
      id: entry.id,
      api: entry.api
        ?? (providerModels(raw?.models) ?? []).find(model => model.id === entry.id)?.api
        ?? providerApi(current)
        ?? getBuiltinModels('github-copilot').find(model => model.id === entry.id)?.api,
    })), models,
  )) {
    // Only the raw user layer establishes ownership of extras. Schema defaults
    // and inherited composition values must never be copied into user settings.
    const entries = providerModels(raw?.models) ?? []
    if (snapshot.hasOwnedSecrets) throw new TemporaryRouteConflictError()
    if (entries.some(entry => !models.some(model => model.id === entry.id)
      && Object.keys(entry).some(key => key !== 'id' && key !== 'api'))) throw new TemporaryRouteConflictError()
    operations.push({ op: 'set', path: ['providers', GITHUB_COPILOT_PROVIDER_ID, 'models'],
      value: models.map(model => ({ ...entries.find(entry => entry.id === model.id), ...model })) })
  }
  if (providerSupportsStrictMode(current) !== false) {
    operations.push({ op: 'set', path: ['providers', GITHUB_COPILOT_PROVIDER_ID, 'compat', 'supportsStrictMode'], value: false })
  }
  const currentHeaders = object(current?.headers) ?? {}
  for (const [name, value] of Object.entries(requiredHeaders ?? {})) {
    if (!Object.entries(currentHeaders).some(([existing, entry]) => existing.toLowerCase() === name.toLowerCase() && entry === value)) {
      operations.push({ op: 'set', path: ['providers', GITHUB_COPILOT_PROVIDER_ID, 'headers', name], value })
    }
  }
  return { operations, ...nextBackup === undefined ? {} : { backup: nextBackup } }
}

const emptyCatalog: GitHubCopilotModelCatalogView = {
  state: 'current', accountModelCount: 0, supportedModelCount: 0,
  unknownModelIds: [], temporarilyUnavailableModelIds: [],
}

/** Read-only catalog and exact repair planning; never mutates, authorizes, or probes. */
export async function describeGitHubCopilotProviderProfile(ctx: Context): Promise<{
  state: 'ready' | 'needs-repair' | 'not-configured' | 'conflict'
  catalog?: GitHubCopilotModelCatalogView
}> {
  const credentials = service<CredentialRecordServiceView>(ctx, 'credentials', ['readRecord'])
  const record = await credentials.readRecord(GITHUB_COPILOT_CREDENTIAL_KEY)
  if (record === undefined) return { state: 'not-configured' }
  const projection = providerModelsFrom(record)
  try {
    const settings = service<RouteSettings>(ctx, 'settings', ['get', 'describe'])
    const snapshot = settingsSnapshot(settings)
    const plan = planRoute(snapshot, projection)
    const needsRepair = plan.operations.length > 0 || plan.clearBackup === true
      || (plan.backup !== undefined && !equalJson(plan.backup, snapshot.backup))
    return { state: needsRepair ? 'needs-repair' : snapshot.current === undefined || projection.models.length === 0 ? 'not-configured' : 'ready', catalog: projection.catalog }
  }
  catch (error) {
    if (error instanceof TemporaryRouteConflictError) return { state: 'conflict', catalog: projection.catalog }
    throw error
  }
}

async function repairGitHubCopilotProviderProfile(ctx: Context): Promise<GitHubCopilotProviderProfileResult> {
  const credentials = service<CredentialRecordServiceView>(ctx, 'credentials', ['readRecord'])
  const record = await credentials.readRecord(GITHUB_COPILOT_CREDENTIAL_KEY)
  if (record === undefined) return { changed: false, catalog: emptyCatalog }
  const projection = providerModelsFrom(record)
  const settings = service<RouteSettings>(ctx, 'settings', ['get', 'describe', 'mutate'])
  const snapshot = settingsSnapshot(settings)
  const plan = planRoute(snapshot, projection)
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
  return { changed, catalog: projection.catalog }
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
    const inFlight = authorization.describe(GITHUB_COPILOT_CREDENTIAL_KEY)?.inFlight === true
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
      ...this.failure === undefined ? {} : { error: this.failure },
    }
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
