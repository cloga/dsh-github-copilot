/**
 * Host-side bridge between the Models-page companion UI and DSH's neutral
 * authorization, credential-record, and settings seams.
 */

import { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all'

export const GITHUB_COPILOT_CREDENTIAL_KEY = 'llm-pi-ai/github-copilot'
export const GITHUB_COPILOT_PROVIDER_ID = 'github-copilot'
export const LLM_PI_AI_SETTINGS_NAMESPACE = 'llm-pi-ai'

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
    operations: readonly { op: 'set'; path: string[]; value: Record<string, unknown> }[],
    expectedRevision?: number,
  ): Promise<void>
}

function providerProfileFrom(record: { readonly kind: string; readonly payload?: unknown } | undefined): Record<string, unknown> {
  if (record?.kind !== 'grant' || typeof record.payload !== 'object' || record.payload === null) return {}
  const available = Reflect.get(record.payload, 'availableModelIds')
  if (!Array.isArray(available) || !available.every(id => typeof id === 'string')) return {}
  const installed = new Map(
    getBuiltinModels('github-copilot').map(model => [model.id, model.api] as const),
  )
  const models = [...new Set(available)].flatMap((id) => {
    const api = installed.get(id)
    return api === undefined ? [] : [{ id, api }]
  })
  if (models.length === 0) {
    throw new Error('github-copilot: the signed-in account exposes no models from the installed pi-ai catalog')
  }
  return { models }
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

function hasProviderProfile(section: unknown): boolean {
  if (typeof section !== 'object' || section === null) return false
  const providers = Reflect.get(section, 'providers')
  return typeof providers === 'object'
    && providers !== null
    && Object.hasOwn(providers, GITHUB_COPILOT_PROVIDER_ID)
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
        await this.ensureProviderProfile()
        return
      }
      this.notices = []
    }).catch((error: unknown) => {
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
    const settings = service<SettingsServiceView>(this.ctx, 'settings', ['get', 'mutate'])
    if (hasProviderProfile(settings.get(LLM_PI_AI_SETTINGS_NAMESPACE))) return
    const credentials = service<CredentialRecordServiceView>(
      this.ctx,
      'credentials',
      ['readRecord'],
    )
    const profile = providerProfileFrom(await credentials.readRecord(GITHUB_COPILOT_CREDENTIAL_KEY))
    await settings.mutate(LLM_PI_AI_SETTINGS_NAMESPACE, [{
      op: 'set',
      path: ['providers', GITHUB_COPILOT_PROVIDER_ID],
      value: profile,
    }])
  }
}

export default GitHubCopilotAuthorizationController
