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

export type GitHubCopilotModelCatalogState = 'current' | 'partially-outdated' | 'outdated'

export interface GitHubCopilotModelCatalogView {
  readonly state: GitHubCopilotModelCatalogState
  readonly accountModelCount: number
  readonly supportedModelCount: number
  readonly unknownModelIds: readonly string[]
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

interface SettingsServiceView {
  get(namespace: string): unknown
  mutate(
    namespace: string,
    operations: readonly { op: 'set'; path: string[]; value: unknown }[],
    expectedRevision?: number,
  ): Promise<void>
}

function providerModelsFrom(
  record: { readonly kind: string; readonly payload?: unknown } | undefined,
): {
  readonly models: Record<string, unknown>[]
  readonly requiredHeaders?: Readonly<Record<string, string>>
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
  const models: Record<string, unknown>[] = []
  const unknownModelIds: string[] = []
  let requiredHeaders: Readonly<Record<string, string>> | undefined
  for (const id of available) {
    const api = installed.get(id)
    if (api !== undefined) {
      models.push({ id, api })
      continue
    }
    const temporary = temporaryGitHubCopilotModel(id, installedIds)
    if (temporary === undefined) {
      unknownModelIds.push(id)
      continue
    }
    models.push(temporaryGitHubCopilotModelProfile(temporary))
    requiredHeaders = temporary.headers
  }
  const state: GitHubCopilotModelCatalogState = unknownModelIds.length === 0
    ? 'current'
    : models.length === 0 ? 'outdated' : 'partially-outdated'
  return {
    models,
    ...requiredHeaders === undefined ? {} : { requiredHeaders },
    catalog: {
      state,
      accountModelCount: available.length,
      supportedModelCount: models.length,
      unknownModelIds,
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
    if (typeof model.id !== 'string' || typeof model.api !== 'string') return undefined
    models.push(model)
  }
  return models
}

function sameProviderModels(current: unknown, expected: readonly Record<string, unknown>[]): boolean {
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
    return Object.entries(expectedModel).every(([field, value]) =>
      JSON.stringify(currentModel[field]) === JSON.stringify(value))
  })
}

function providerHeaders(profile: Record<string, unknown> | undefined): Record<string, string> {
  const value = profile?.headers
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  )
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
      },
    }
  }

  const { models, requiredHeaders, catalog } = providerModelsFrom(record)
  // Do not create or widen a route when every account model is unknown. An
  // existing usable profile remains untouched until verified catalog metadata
  // is installed; an absent profile remains absent rather than inheriting the
  // provider's complete static catalog.
  if (models.length === 0) return { changed: false, catalog }

  const settings = service<SettingsServiceView>(ctx, 'settings', ['get', 'mutate'])
  const current = providerProfileAt(settings.get(LLM_PI_AI_SETTINGS_NAMESPACE))
  const operations: Array<{ op: 'set'; path: string[]; value: unknown }> = []
  if (models.length > 0 && !sameProviderModels(current?.models, models)) {
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
  const currentModelEntries = providerModels(current?.models) ?? []
  const retiringOverlays = currentModelEntries.flatMap((entry) => {
    const overlay = temporaryGitHubCopilotModelFromProfile(entry)
    if (overlay === undefined) return []
    const expected = models.find(model => model.id === overlay.id)
    return expected !== undefined && temporaryGitHubCopilotModelFromProfile(expected) !== undefined
      ? []
      : [overlay]
  })
  const currentHeaders = providerHeaders(current)
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
