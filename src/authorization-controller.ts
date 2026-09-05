/**
 * Host-side bridge between the Models-page companion UI and DSH's neutral
 * authorization, credential-record, and settings seams.
 */

import { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all'
import { normalizeGitHubCopilotOAuthCredential } from './copilot-grant.ts'
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

export interface GitHubCopilotAuthorizationView {
  readonly phase: GitHubCopilotAuthorizationPhase
  readonly configured: boolean
  readonly writable: boolean
  readonly inFlight: boolean
  readonly notices: readonly AuthorizationNoticeView[]
  readonly catalog?: GitHubCopilotModelCatalogView
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

type SettingsMutation =
  | { readonly op: 'set'; readonly path: string[]; readonly value: unknown }
  | { readonly op: 'unset'; readonly path: string[] }

interface SettingsServiceView {
  get(namespace: string): unknown
  mutate(
    namespace: string,
    operations: readonly SettingsMutation[],
    expectedRevision?: number,
  ): Promise<void>
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

function providerProfileAt(section: unknown): Record<string, unknown> | undefined {
  if (typeof section !== 'object' || section === null) return undefined
  const providers = Reflect.get(section, 'providers')
  if (typeof providers !== 'object' || providers === null) return undefined
  const profile = Reflect.get(providers, GITHUB_COPILOT_PROVIDER_ID)
  if (typeof profile !== 'object' || profile === null) return undefined
  return profile as Record<string, unknown>
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

function providerHeaders(profile: Record<string, unknown> | undefined): Record<string, string> {
  const value = profile?.headers
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  )
}

function conflictingRequiredHeader(
  current: Readonly<Record<string, string>>,
  required: Readonly<Record<string, string>>,
): string | undefined {
  const currentByName = new Map(Object.entries(current).map(([name, value]) => [name.toLowerCase(), value]))
  return Object.entries(required).find(([name, value]) => {
    const existing = currentByName.get(name.toLowerCase())
    return existing !== undefined && existing !== value
  })?.[0]
}

function withRequiredHeaders(
  current: Readonly<Record<string, string>>,
  required: Readonly<Record<string, string>>,
): Record<string, string> {
  const requiredNames = new Set(Object.keys(required).map(name => name.toLowerCase()))
  return {
    ...Object.fromEntries(Object.entries(current).filter(([name]) => !requiredNames.has(name.toLowerCase()))),
    ...required,
  }
}

function withoutOwnedHeaders(
  current: Readonly<Record<string, string>>,
  owned: readonly Readonly<Record<string, string>>[],
): Record<string, string> {
  const ownedValues = new Map<string, string>()
  for (const headers of owned) {
    for (const [name, value] of Object.entries(headers)) ownedValues.set(name.toLowerCase(), value)
  }
  return Object.fromEntries(Object.entries(current).filter(([name, value]) =>
    ownedValues.get(name.toLowerCase()) !== value))
}

function providerApi(profile: Record<string, unknown> | undefined): string | undefined {
  return typeof profile?.api === 'string' ? profile.api : undefined
}

interface TemporaryRouteBackup {
  readonly providerExisted: boolean
  readonly leaves: Readonly<Record<string, unknown>>
  readonly preservedHeaderNames: readonly string[]
}

function temporaryRouteBackup(settings: SettingsServiceView): TemporaryRouteBackup | undefined {
  const section = settings.get(GITHUB_COPILOT_SETTINGS_NAMESPACE)
  if (typeof section !== 'object' || section === null) return undefined
  const encoded = Reflect.get(section, 'temporaryRouteBackup')
  if (encoded === undefined) return undefined
  if (typeof encoded !== 'string') {
    throw new Error('github-copilot: temporary route backup must be a JSON string')
  }
  const value: unknown = JSON.parse(encoded)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('github-copilot: temporary route backup must decode to an object')
  }
  const providerExisted = Reflect.get(value, 'providerExisted')
  const leaves = Reflect.get(value, 'leaves')
  const preservedHeaderNames = Reflect.get(value, 'preservedHeaderNames')
  if (
    typeof providerExisted !== 'boolean'
    || typeof leaves !== 'object'
    || leaves === null
    || Array.isArray(leaves)
    || !Array.isArray(preservedHeaderNames)
    || !preservedHeaderNames.every(name => typeof name === 'string')
  ) {
    throw new Error('github-copilot: temporary route backup has an invalid shape')
  }
  const leafRecord = leaves as Record<string, unknown>
  if (
    Object.keys(leafRecord).some(field => field !== 'api' && field !== 'models')
    || (leafRecord.api !== undefined && typeof leafRecord.api !== 'string')
    || (leafRecord.models !== undefined && providerModels(leafRecord.models) === undefined)
  ) {
    throw new Error('github-copilot: temporary route backup has invalid route leaves')
  }
  return {
    providerExisted,
    leaves: leafRecord,
    preservedHeaderNames,
  }
}

function createTemporaryRouteBackup(
  current: Record<string, unknown> | undefined,
  currentHasOverlay: boolean,
  restorationModels: readonly Record<string, unknown>[],
  requiredHeaders: Readonly<Record<string, string>> | undefined,
): TemporaryRouteBackup {
  if (current === undefined) {
    return { providerExisted: false, leaves: {}, preservedHeaderNames: [] }
  }
  if (currentHasOverlay) {
    return {
      providerExisted: true,
      leaves: { models: restorationModels },
      preservedHeaderNames: [],
    }
  }
  const leaves: Record<string, unknown> = {}
  for (const field of ['api', 'models'] as const) {
    if (Object.hasOwn(current, field)) leaves[field] = current[field]
  }
  const requiredByName = new Map(
    Object.entries(requiredHeaders ?? {}).map(([name, value]) => [name.toLowerCase(), value]),
  )
  const preservedHeaderNames = Object.entries(providerHeaders(current)).flatMap(([name, value]) =>
    requiredByName.get(name.toLowerCase()) === value ? [name.toLowerCase()] : [])
  return { providerExisted: true, leaves, preservedHeaderNames }
}

function restoreTemporaryRouteOperations(
  backup: TemporaryRouteBackup,
  currentModels: readonly Record<string, unknown>[],
  currentHeaders: Readonly<Record<string, string>>,
  ownedHeaders: readonly Readonly<Record<string, string>>[],
): SettingsMutation[] {
  if (!backup.providerExisted && currentModels.length === 0) {
    return [{ op: 'unset', path: ['providers', GITHUB_COPILOT_PROVIDER_ID] }]
  }
  const operations: SettingsMutation[] = []
  operations.push(Object.hasOwn(backup.leaves, 'api')
    ? {
        op: 'set',
        path: ['providers', GITHUB_COPILOT_PROVIDER_ID, 'api'],
        value: backup.leaves.api,
      }
    : { op: 'unset', path: ['providers', GITHUB_COPILOT_PROVIDER_ID, 'api'] })
  const preservedNames = new Set(backup.preservedHeaderNames.map(name => name.toLowerCase()))
  const removableHeaders = ownedHeaders.map(headers => Object.fromEntries(
    Object.entries(headers).filter(([name]) => !preservedNames.has(name.toLowerCase())),
  ))
  const restoredHeaders = withoutOwnedHeaders(currentHeaders, removableHeaders)
  if (JSON.stringify(currentHeaders) !== JSON.stringify(restoredHeaders)) {
    operations.push({
      op: 'set',
      path: ['providers', GITHUB_COPILOT_PROVIDER_ID, 'headers'],
      value: restoredHeaders,
    })
  }
  if (currentModels.length > 0) {
    operations.push({
      op: 'set',
      path: ['providers', GITHUB_COPILOT_PROVIDER_ID, 'models'],
      value: currentModels,
    })
  }
  else {
    operations.push(Object.hasOwn(backup.leaves, 'models')
      ? {
          op: 'set',
          path: ['providers', GITHUB_COPILOT_PROVIDER_ID, 'models'],
          value: backup.leaves.models,
        }
      : { op: 'unset', path: ['providers', GITHUB_COPILOT_PROVIDER_ID, 'models'] })
  }
  return operations
}

function providerSupportsStrictMode(profile: Record<string, unknown> | undefined): unknown {
  const compat = profile?.compat
  if (typeof compat !== 'object' || compat === null) return undefined
  return Reflect.get(compat, 'supportsStrictMode')
}

/**
 * Reconcile only the Copilot route's known account models and strict-mode leaf
 * from an existing provider-owned OAuth grant. Unknown account model IDs are
 * reported separately and never assigned a guessed protocol.
 */
async function repairGitHubCopilotProviderProfile(ctx: Context): Promise<GitHubCopilotProviderProfileResult> {
  const credentials = service<CredentialRecordServiceView>(
    ctx,
    'credentials',
    ['readRecord'],
  )
  const record = await credentials.readRecord(GITHUB_COPILOT_CREDENTIAL_KEY)
  if (record === undefined) {
    return {
      changed: false,
      catalog: {
        state: 'current',
        accountModelCount: 0,
        supportedModelCount: 0,
        unknownModelIds: [],
        temporarilyUnavailableModelIds: [],
      },
    }
  }

  const { models, restorationModels, requiredHeaders, requiredRouteApi, catalog } = providerModelsFrom(record)
  const settings = service<SettingsServiceView>(ctx, 'settings', ['get', 'mutate'])
  const current = providerProfileAt(settings.get(LLM_PI_AI_SETTINGS_NAMESPACE))
  const currentRouteApi = providerApi(current)
  const currentHeaders = providerHeaders(current)
  const currentModelEntries = providerModels(current?.models) ?? []
  const currentOverlays = currentModelEntries.flatMap((entry) => {
    const overlay = temporaryGitHubCopilotModelFromProfile(entry)
    return overlay === undefined ? [] : [overlay]
  })
  const currentHasOverlay = currentOverlays.length > 0
  let backup = temporaryRouteBackup(settings)
  if (requiredRouteApi !== undefined) {
    if (currentRouteApi !== undefined && currentRouteApi !== requiredRouteApi) {
      throw new Error(
        `github-copilot: temporary model protocol "${requiredRouteApi}" conflicts with configured route api "${currentRouteApi}"`,
      )
    }
    if (currentRouteApi === requiredRouteApi && !currentHasOverlay && backup === undefined) {
      throw new Error(
        `github-copilot: configured route api "${currentRouteApi}" is not owned by the temporary GPT-6 overlay`,
      )
    }
    if (requiredHeaders !== undefined) {
      const conflict = conflictingRequiredHeader(currentHeaders, requiredHeaders)
      if (conflict !== undefined) {
        throw new Error(`github-copilot: temporary GPT-6 header "${conflict}" conflicts with the configured route`)
      }
    }
    if (backup === undefined) {
      backup = createTemporaryRouteBackup(
        current,
        currentHasOverlay,
        restorationModels,
        requiredHeaders,
      )
      await settings.mutate(GITHUB_COPILOT_SETTINGS_NAMESPACE, [{
        op: 'set',
        path: ['temporaryRouteBackup'],
        value: JSON.stringify(backup),
      }])
    }
  }
  else if (backup !== undefined) {
    await settings.mutate(
      LLM_PI_AI_SETTINGS_NAMESPACE,
      restoreTemporaryRouteOperations(
        backup,
        models,
        providerHeaders(current),
        currentOverlays.map(model => model.headers),
      ),
    )
    await settings.mutate(GITHUB_COPILOT_SETTINGS_NAMESPACE, [{
      op: 'unset',
      path: ['temporaryRouteBackup'],
    }])
    return { changed: true, catalog }
  }
  else if (currentHasOverlay) {
    throw new Error('github-copilot: temporary GPT-6 route has no ownership backup; reconnect before cleanup')
  }
  if (models.length === 0) return { changed: false, catalog }

  const operations: SettingsMutation[] = []
  if (requiredRouteApi !== undefined) {
    if (currentRouteApi !== requiredRouteApi) {
      operations.push({
        op: 'set',
        path: ['providers', GITHUB_COPILOT_PROVIDER_ID, 'api'],
        value: requiredRouteApi,
      })
    }
  }
  if (models.length > 0 && !sameProviderModels(
    current?.models,
    models,
    currentRouteApi,
    requiredRouteApi,
  )) {
    operations.push({
      op: 'set',
      path: ['providers', GITHUB_COPILOT_PROVIDER_ID, 'models'],
      value: models,
    })
  }
  if (providerSupportsStrictMode(current) !== false) {
    operations.push({
      op: 'set',
      path: ['providers', GITHUB_COPILOT_PROVIDER_ID, 'compat', 'supportsStrictMode'],
      value: false,
    })
  }
  const retiringOverlays = currentModelEntries.flatMap((entry) => {
    const overlay = temporaryGitHubCopilotModelFromProfile(entry)
    if (overlay === undefined) return []
    const expected = models.find(model => model.id === overlay.id)
    return expected !== undefined && temporaryGitHubCopilotModelFromProfile(expected) !== undefined
      ? []
      : [overlay]
  })
  const retainedHeaders = withoutOwnedHeaders(currentHeaders, retiringOverlays.map(model => model.headers))
  const headers = requiredHeaders === undefined
    ? retainedHeaders
    : withRequiredHeaders(retainedHeaders, requiredHeaders)
  if (JSON.stringify(currentHeaders) !== JSON.stringify(headers)) {
    operations.push({
      op: 'set',
      path: ['providers', GITHUB_COPILOT_PROVIDER_ID, 'headers'],
      value: headers,
    })
  }
  if (operations.length > 0) await settings.mutate(LLM_PI_AI_SETTINGS_NAMESPACE, operations)
  return { changed: operations.length > 0, catalog }
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
  private attempt: Promise<void> | undefined

  constructor(ctx: Context) {
    super(ctx, 'githubCopilotAuthorization', { namespace: 'githubCopilot' })
  }

  @Remote
  async status(): Promise<GitHubCopilotAuthorizationView> {
    const authorization = service<AuthorizationServiceView>(
      this.ctx,
      'authorization',
      ['describe', 'begin', 'cancel'],
    )
    const credentials = service<CredentialRecordServiceView>(
      this.ctx,
      'credentials',
      ['describeRecord', 'deleteRecord'],
    )
    const record = await credentials.describeRecord(GITHUB_COPILOT_CREDENTIAL_KEY)
    const profile = record.configured
      ? await inspectGitHubCopilotProviderProfile(this.ctx)
      : undefined
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
      notices: [...this.notices],
      ...profile === undefined ? {} : { catalog: profile.catalog },
      ...this.failure === undefined ? {} : { error: this.failure },
    }
  }

  @Remote
  async start(): Promise<GitHubCopilotAuthorizationView> {
    const current = await this.status()
    if (current.configured) {
      await this.ensureProviderProfile()
      return this.status()
    }
    if (current.inFlight || this.attempt !== undefined) return current

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
    return this.status()
  }

  private async ensureProviderProfile(): Promise<void> {
    await ensureGitHubCopilotProviderProfile(this.ctx)
  }
}

export default GitHubCopilotAuthorizationController
