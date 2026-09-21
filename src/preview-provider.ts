import { hasApi, lazyStream } from '@earendil-works/pi-ai'
import type { Api, Context as PiContext, Model, OAuthAuth, StreamOptions, ThinkingLevelMap } from '@earendil-works/pi-ai'
import type { AccountModelApi, AccountModelDescriptor } from './account-model-catalog.ts'
import { coreProviderView } from './pi-provider-bridge.ts'
import type { CoreCompatibleProvider, SimpleNativeProvider } from './pi-provider-bridge.ts'
import { githubCopilotProvider } from '@earendil-works/pi-ai/providers/github-copilot'
import { buildCopilotDynamicHeaders, hasCopilotVisionInput } from '@earendil-works/pi-ai/api/github-copilot-headers'
import { GITHUB_COPILOT_PREVIEW_PROVIDER_ID } from './copilot-identity.ts'
import { normalizeGitHubCopilotOAuthCredential } from './copilot-grant.ts'
import type { GitHubCopilotOAuthCredential } from './copilot-grant.ts'
import { trustedGitHubCopilotBaseUrl } from './copilot-auth.ts'
import { CopilotResponsesReplayError, isCopilotInputItemScopeError, normalizeCopilotResponsesPayload } from './responses-replay-compat.ts'

/** Per-call authorization/lifetime checks supplied by the owning route. */
export interface PreviewProviderGuard {
  readonly signal: AbortSignal
  assertActive(): void
  assertAccount(credential: GitHubCopilotOAuthCredential): void
  beforeWire(model: Model<Api>, options?: StreamOptions): Promise<{ signal: AbortSignal; release(): void }>
  /** Actual model HTTP 401, excluding proven Responses replay-scope failures; no request replay. */
  onUnauthorized?(): void
  /** Dispatch-local, verified replay failure; never inferred from SDK error text. */
  onReplayFailure?(error: CopilotResponsesReplayError): void
}

/** Guard for one selected model in an account-bound descriptor snapshot. */
export interface AccountProviderGuard extends PreviewProviderGuard {
  readonly selectedModelId?: string
  /** Per-dispatch admission after native context conversion, before starting a model wire. */
  inspectRequest?(model: Model<Api>, context: PiContext, options?: StreamOptions): void
  assertEntitled(credential: GitHubCopilotOAuthCredential, modelId: string): void
}

/** The independent prompt limit is retained for the route's budget guard, not folded into context capacity. */
export type AccountPiModel = Model<AccountModelApi> & {
  readonly maxInputTokens?: number
  readonly unmappedReasoningEfforts: readonly string[]
  readonly minThinkingBudget?: number
  readonly maxThinkingBudget?: number
}

const enabledLevels = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
const headerNames = ['User-Agent', 'Editor-Version', 'Editor-Plugin-Version', 'Copilot-Integration-Id'] as const

export function copilotPublicHeaders(): Readonly<Record<string, string>> {
  const models = githubCopilotProvider().getModels()
  const headers: Record<string, string> = {}
  for (const name of headerNames) {
    const value = models[0]?.headers?.[name]
    if (typeof value !== 'string' || value.length === 0 || !models.every(model => model.headers?.[name] === value)) {
      throw new Error('COPILOT_MANAGED_PUBLIC_HEADERS_UNAVAILABLE')
    }
    headers[name] = value
  }
  return Object.freeze(headers)
}

function accountBaseURL(value: string): string {
  let url: URL
  try { url = new URL(value) } catch { throw new Error('COPILOT_MANAGED_BASE_URL_INVALID') }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== ''
    || url.search !== '' || url.hash !== '' || url.pathname !== '/') throw new Error('COPILOT_MANAGED_BASE_URL_INVALID')
  return url.origin
}

/** Materialize advertised capabilities only; model names and the local static catalog never select the API. */
export function accountModelFromDescriptor(descriptor: AccountModelDescriptor, baseURL: string): AccountPiModel {
  const map: ThinkingLevelMap = { off: null, minimal: null, low: null, medium: null, high: null, xhigh: null, max: null }
  const advertised = new Set(descriptor.reasoning.advertisedEfforts)
  const supported = enabledLevels.filter(level => advertised.has(level)
    && (descriptor.api !== 'anthropic-messages' || descriptor.reasoning.adaptiveThinking === true && level !== 'minimal'))
  for (const level of supported) map[level] = level
  const mapped = new Set<string>(supported)
  const unmapped = [...new Set([...descriptor.reasoning.unmappedEfforts,
    ...descriptor.reasoning.advertisedEfforts.filter(level => !mapped.has(level))])].sort()
  const model: AccountPiModel = {
    id: descriptor.id, name: descriptor.name, provider: GITHUB_COPILOT_PREVIEW_PROVIDER_ID,
    api: descriptor.api, baseUrl: accountBaseURL(baseURL),
    contextWindow: descriptor.contextWindow, maxTokens: descriptor.maxTokens,
    ...descriptor.maxInputTokens === undefined ? {} : { maxInputTokens: descriptor.maxInputTokens },
    input: [...descriptor.input], reasoning: supported.length > 0,
    thinkingLevelMap: Object.freeze(map),
    unmappedReasoningEfforts: Object.freeze(unmapped),
    ...descriptor.reasoning.minThinkingBudget === undefined ? {} : { minThinkingBudget: descriptor.reasoning.minThinkingBudget },
    ...descriptor.reasoning.maxThinkingBudget === undefined ? {} : { maxThinkingBudget: descriptor.reasoning.maxThinkingBudget },
    headers: copilotPublicHeaders(),
    cost: Object.freeze({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }),
    compat: descriptor.api === 'anthropic-messages'
      ? Object.freeze({ forceAdaptiveThinking: descriptor.reasoning.adaptiveThinking === true, supportsEagerToolInputStreaming: false })
      : descriptor.api === 'openai-completions'
        ? Object.freeze({ supportsStore: false, supportsDeveloperRole: false, supportsStrictMode: false,
          supportsReasoningEffort: supported.length > 0, thinkingFormat: 'openai' as const })
        : Object.freeze({ supportsStrictMode: false }),
  }
  Object.freeze(model.input)
  return Object.freeze(model)
}

/** Create a descriptor-driven, OAuth-only provider using native SDK serialization for all supported endpoints. */
export function createAccountProvider(
  descriptors: readonly AccountModelDescriptor[],
  guard: AccountProviderGuard,
  baseURL: string,
): { provider: CoreCompatibleProvider; models: readonly AccountPiModel[] } {
  const native = githubCopilotProvider()
  const oauth = native.auth.oauth
  if (oauth === undefined) throw new Error('COPILOT_MANAGED_OAUTH_UNAVAILABLE')
  const models = Object.freeze(descriptors.map(descriptor => accountModelFromDescriptor(descriptor, baseURL)))
  const table = new Map(models.map(model => [model.id, model]))
  if (table.size !== models.length) throw new Error('COPILOT_MANAGED_DUPLICATE_MODEL')
  const selected = (): string => {
    if (guard.selectedModelId === undefined || !table.has(guard.selectedModelId)) throw new Error('COPILOT_MANAGED_MODEL_NOT_PREPARED')
    return guard.selectedModelId
  }
  const guardedOAuth: OAuthAuth = {
    name: oauth.name, isSubscription: true,
    login: async () => { throw new Error('COPILOT_MANAGED_USE_CANONICAL_SIGN_IN') },
    refresh: async (credential, signal) => {
      guard.assertActive()
      const current = normalizeGitHubCopilotOAuthCredential(credential)
      guard.assertAccount(current)
      const operationSignal = signal === undefined ? guard.signal : AbortSignal.any([signal, guard.signal])
      let fresh: Awaited<ReturnType<OAuthAuth['refresh']>>
      try { fresh = await oauth.refresh(current, operationSignal) }
      catch { guard.assertActive(); throw new Error(operationSignal.aborted ? 'COPILOT_MANAGED_ABORTED' : 'COPILOT_MANAGED_REFRESH_FAILED') }
      guard.assertActive()
      const result = normalizeGitHubCopilotOAuthCredential(fresh)
      guard.assertAccount(result)
      // Revocation must be persisted by Models before toAuth rejects this call.
      return result
    },
    toAuth: async credential => {
      guard.assertActive()
      const current = normalizeGitHubCopilotOAuthCredential(credential)
      guard.assertAccount(current)
      guard.assertEntitled(current, selected())
      let auth: Awaited<ReturnType<OAuthAuth['toAuth']>>
      try { auth = await oauth.toAuth(current) }
      catch { throw new Error('COPILOT_MANAGED_AUTH_DERIVATION_FAILED') }
      guard.assertActive()
      guard.assertEntitled(current, selected())
      return { ...auth, baseUrl: trustedGitHubCopilotBaseUrl(auth.baseUrl ?? baseURL, current) }
    },
  }
  const provider: SimpleNativeProvider = {
    id: GITHUB_COPILOT_PREVIEW_PROVIDER_ID, name: 'GitHub Copilot', baseUrl: accountBaseURL(baseURL),
    auth: Object.freeze({ oauth: Object.freeze(guardedOAuth) }),
    getModels: () => models,
    filterModels: (candidates, credential) => {
      if (credential?.type !== 'oauth') return []
      const grant = normalizeGitHubCopilotOAuthCredential(credential)
      return candidates.filter(model => {
        if (!table.has(model.id)) return false
        try { guard.assertEntitled(grant, model.id); return true } catch { return false }
      })
    },
    streamSimple: (model, context, options) => lazyStream(model, async () => {
      guard.assertActive()
      const entry = table.get(model.id)
      if (model.provider !== GITHUB_COPILOT_PREVIEW_PROVIDER_ID || model.id !== selected()
        || entry === undefined || model.api !== entry.api) throw new Error('COPILOT_MANAGED_MODEL_MISMATCH')
      guard.inspectRequest?.(model, context, options)
      const lease = await guard.beforeWire(model, options)
      if (typeof options?.apiKey !== 'string' || options.apiKey.length === 0) {
        lease.release()
        throw new Error('COPILOT_MANAGED_OAUTH_REQUIRED')
      }
      const headers: Record<string, string | null> = {}
      for (const [name, value] of Object.entries(options.headers ?? {})) {
        if (name.toLowerCase() !== 'authorization' && name.toLowerCase() !== 'x-api-key') headers[name] = value
      }
      Object.assign(headers, buildCopilotDynamicHeaders({ messages: context.messages, hasImages: hasCopilotVisionInput(context.messages) }))
      // The guard-verified OAuth key is authoritative, including over differently cased caller headers.
      headers.authorization = `Bearer ${options.apiKey}`
      headers['x-api-key'] = null
      // Alias identity is retained for replay. Anthropic's native alias branch
      // uses API-key auth unless we provide verified Bearer header-owned auth.
      let unauthorized = false
      const responses = model.api === 'openai-responses'
      const reportReplayFailure = (error: CopilotResponsesReplayError): void => {
        if (lease.signal.aborted || options.signal?.aborted) return
        try { guard.onReplayFailure?.(error) } catch { /* Keep native cleanup and terminal delivery intact. */ }
      }
      const onPayload: StreamOptions['onPayload'] = responses ? async (payload, selectedModel) => {
        // Preserve caller callback ordering and undefined-as-no-replacement semantics.
        const replacement = await options.onPayload?.(payload, selectedModel)
        if (lease.signal.aborted || options.signal?.aborted) throw new Error('COPILOT_MANAGED_ABORTED')
        try { return normalizeCopilotResponsesPayload(replacement === undefined ? payload : replacement) }
        catch (error) {
          if (error instanceof CopilotResponsesReplayError) reportReplayFailure(error)
          throw error
        }
      } : options.onPayload
      const fetch = options.fetch ?? globalThis.fetch
      const observeResponse: NonNullable<StreamOptions['fetch']> = async (input, init) => {
        const response = await fetch(input, init)
        // A bounded clone identifies only the observed request-scope rejection.
        // Preserve the original Response/status/body for the native SDK.
        if (response.status === 401) {
          if (responses && await isCopilotInputItemScopeError(response, lease.signal)) {
            reportReplayFailure(new CopilotResponsesReplayError('scope-mismatch'))
          } else unauthorized = true
        }
        return response
      }
      const wireOptions = model.api === 'anthropic-messages'
        ? { ...options, signal: lease.signal, apiKey: undefined, headers, fetch: observeResponse }
        : { ...options, signal: lease.signal, headers, fetch: observeResponse, onPayload }
      if (!hasApi(model, 'openai-responses') && !hasApi(model, 'openai-completions') && !hasApi(model, 'anthropic-messages')) {
        lease.release()
        throw new Error('COPILOT_MANAGED_PROTOCOL_UNSUPPORTED')
      }
      return (async function* () {
        try { yield* native.streamSimple(model, context, wireOptions) } finally {
          lease.release()
          if (unauthorized && !guard.signal.aborted && !options.signal?.aborted) {
            try { guard.onUnauthorized?.() } catch { /* Preserve the native terminal result. */ }
          }
        }
      })()
    }),
  }
  return { provider: Object.freeze(coreProviderView(provider)), models }
}
