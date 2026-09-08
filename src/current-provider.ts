/**
 * Detection of an operation's provider route: the initiating Agent or explicit
 * request names a route and model, the `llm-pi-ai` settings
 * section carries the route's profile, and the pi-ai catalog supplies the
 * defaults (wire protocol, base URL) a profile that overrides nothing inherits.
 * The probe and plan modules read this to decide which search-capable
 * protocol to use without any configuration.
 * @module dsh-github-copilot/current-provider
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { builtinProviders, getBuiltinModels } from '@earendil-works/pi-ai/providers/all'
import type { BuiltinProvider } from '@earendil-works/pi-ai/providers/all'
import type { Api, Model } from '@earendil-works/pi-ai'
import { readCopilotCatalog, isPluginPreviewProvider } from './model-protocol.ts'
import { GITHUB_COPILOT_PREVIEW_PROVIDER_ID } from './copilot-identity.ts'

/** Settings namespace of the harness's pi-ai LLM adapter (its `providers` dict). */
const LLM_PI_AI_NAMESPACE = 'llm-pi-ai' as SettingsNamespace

/** The resolved chat-route facts this package consumes. */
export interface CurrentChatRoute {
  /** Registered provider route key (the llm-pi-ai `providers` dict key). */
  readonly provider: string
  /** Provider-owned model id. */
  readonly model: string
  /** Wire protocol the route speaks, when determinable. */
  readonly api?: string
  /** Endpoint base the route's requests go to. */
  readonly baseURL?: string
  /** Credential reference the route resolves its key through. */
  readonly apiKeyEnv?: string
  /** All interactive APIs advertised by this route's selected model. */
  readonly supportedApis?: readonly string[]
  /** Static provider/model request headers from pi-ai's catalog. */
  readonly headers?: Readonly<Record<string, string | null>>
}

/** Catalog providers indexed by route id. The catalog is static for a given
 * pi-ai version; constructing it per call would rebuild ~30 provider objects
 * on every route read (several per request). */
let catalogCache: ReadonlyMap<string, { readonly baseUrl?: string }> | undefined

function catalogById(): ReadonlyMap<string, { readonly baseUrl?: string }> {
  if (catalogCache === undefined) {
    const map = new Map<string, { readonly baseUrl?: string }>()
    for (const provider of builtinProviders()) map.set(provider.id, provider)
    catalogCache = map
  }
  return catalogCache
}

/** Per-provider model tables, cached the same way. */
const modelTableCache = new Map<string, readonly Model<Api>[]>()

function modelTableOf(provider: string): readonly Model<Api>[] {
  const cached = modelTableCache.get(provider)
  if (cached !== undefined) return cached
  try {
    const models = getBuiltinModels(provider as BuiltinProvider)
    modelTableCache.set(provider, models)
    return models
  } catch {
    // A provider entry whose model table fails to materialize is treated as
    // unknown rather than failing route detection for every other route.
    return []
  }
}

/**
 * The catalog facts for one route+model: the model's own wire protocol and
 * base URL. A route pi-ai does not ship, or a model it does not list, yields
 * no facts — the profile is then the whole answer.
 * @param provider - provider route key.
 * @param model - model id.
 * @returns the catalog protocol and base URL, when known.
 */
function catalogModelFacts(
  ctx: Context,
  provider: string,
  model: string,
): { api?: string; baseUrl?: string; headers?: Readonly<Record<string, string | null>> } {
  if (provider === GITHUB_COPILOT_PREVIEW_PROVIDER_ID) {
    if (!isPluginPreviewProvider(ctx, provider)) return {}
    const owner: unknown = ctx.get('githubCopilotPreview')
    if (typeof owner !== 'object' || owner === null) return {}
    const method: unknown = Reflect.get(owner, 'routeFacts')
    if (typeof method !== 'function') return {}
    const facts: unknown = method.call(owner, model)
    if (typeof facts !== 'object' || facts === null) return {}
    const api: unknown = Reflect.get(facts, 'api'), baseURL: unknown = Reflect.get(facts, 'baseURL')
    if (typeof api !== 'string' || typeof baseURL !== 'string') return {}
    // The owning route validates this endpoint and freshness. Never use another
    // pi copy or a model-name correction as evidence for managed requests.
    return { api, baseUrl: baseURL }
  }
  if (provider === 'github-copilot') {
    const found = readCopilotCatalog(ctx).models.find(candidate => candidate.id === model)
    return found === undefined ? {} : { api: found.api, baseUrl: found.baseUrl, headers: found.headers }
  }
  const catalog = catalogById().get(provider)
  if (catalog === undefined) return {}
  const found = modelTableOf(provider).find(candidate => candidate.id === model)
  return found === undefined ? {} : { api: found.api, baseUrl: found.baseUrl, headers: found.headers }
}

/** Read one route profile from the llm-pi-ai settings section, defensively narrowed. */
function profileFacts(
  section: unknown,
  provider: string,
  model: string,
): { api?: string; baseURL?: string; apiKeyEnv?: string; supportedApis?: readonly string[] } | undefined {
  if (typeof section !== 'object' || section === null) return undefined
  const providers = (section as Record<string, unknown>)['providers']
  if (typeof providers !== 'object' || providers === null) return undefined
  const profile = (providers as Record<string, unknown>)[provider]
  if (typeof profile !== 'object' || profile === null) return undefined
  const record = profile as Record<string, unknown>
  const stringField = (key: string): string | undefined =>
    typeof record[key] === 'string' && (record[key] as string).length > 0 ? record[key] as string : undefined
  const models = Array.isArray(record['models']) ? record['models'] : []
  const selected = models.find((candidate) =>
    typeof candidate === 'object'
    && candidate !== null
    && (candidate as Record<string, unknown>)['id'] === model,
  ) as Record<string, unknown> | undefined
  const declaredApis = Array.isArray(selected?.['apis'])
    ? selected.apis.filter((api): api is string => typeof api === 'string')
    : []
  const selectedApi = typeof selected?.['api'] === 'string' ? selected.api : undefined
  const routeApi = stringField('api')
  // Stock Core canonical profiles do not implement model-entry API precedence.
  // Managed models bypass this settings path and use their owner's routeFacts.
  const effectiveApi = provider === 'github-copilot' ? routeApi : selectedApi ?? routeApi
  const supportedApis = provider === 'github-copilot' ? undefined : declaredApis.length > 0
    ? declaredApis
    : selectedApi === undefined ? undefined : [selectedApi]
  return {
    ...effectiveApi === undefined ? {} : { api: effectiveApi },
    ...stringField('baseURL') === undefined ? {} : { baseURL: stringField('baseURL') },
    ...stringField('apiKeyEnv') === undefined ? {} : { apiKeyEnv: stringField('apiKeyEnv') },
    ...supportedApis === undefined ? {} : { supportedApis },
  }
}

/**
 * Read the public asynchronous initiator seam when supported by Core.
 * Older Core and agentless callers have no session selection; never substitute
 * the default-model service or an arbitrary registered Agent.
 * @param ctx - Host context with the optional Agent registry.
 * @returns the initiating Agent, or undefined when the capability/caller is absent.
 */
export function currentSearchInitiator(ctx: Context): Agent | undefined {
  const agents = ctx.get('agents') as { currentInitiator?: () => Agent | undefined } | undefined
  return typeof agents?.currentInitiator === 'function' ? agents.currentInitiator() : undefined
}

/**
 * Capture the initiating Session's effective request route. Agent.options is
 * only an activation seed; Core model-selection waterfalls need not update it.
 * @param agent - initiating Agent recovered at the operation entry.
 * @returns provider/model leaves from the last committed request header, or none.
 */
export function currentSearchSelection(agent: Agent | undefined): { provider: string; model: string } | undefined {
  const session = agent?.session as { requestHeader?: () => { config?: { provider?: string; model?: string } } | undefined } | undefined
  const config = typeof session?.requestHeader === 'function' ? session.requestHeader()?.config : undefined
  return config?.provider && config.model ? { provider: config.provider, model: config.model } : undefined
}

/**
 * Resolve one operation's route. Explicit GenerateOptions fields are already
 * resolved by Core and take precedence; otherwise use the initiating Session's
 * effective request header. Missing request evidence fails closed.
 * @param ctx - context used for public initiator, settings and catalog reads.
 * @param explicit - explicit request selection, captured at operation entry.
 * @returns owned route facts, or undefined without a usable selection.
 */
export function currentChatRoute(
  ctx: Context,
  explicit?: { readonly provider?: string; readonly model?: string },
): CurrentChatRoute | undefined {
  const selection = explicit ?? currentSearchSelection(currentSearchInitiator(ctx))
  if (!selection?.provider || !selection.model) return undefined
  if (selection.provider === GITHUB_COPILOT_PREVIEW_PROVIDER_ID
    && !isPluginPreviewProvider(ctx, selection.provider)) return undefined
  const profile = selection.provider === GITHUB_COPILOT_PREVIEW_PROVIDER_ID
    ? undefined : profileFacts(ctx.get('settings')?.get(LLM_PI_AI_NAMESPACE), selection.provider, selection.model)
  const catalog = catalogModelFacts(ctx, selection.provider, selection.model)
  return {
    provider: selection.provider,
    model: selection.model,
    ...profile?.api === undefined ? {} : { api: profile.api },
    ...profile?.api === undefined && catalog.api !== undefined ? { api: catalog.api } : {},
    ...profile?.baseURL === undefined ? {} : { baseURL: profile.baseURL },
    ...profile?.baseURL === undefined && catalog.baseUrl !== undefined ? { baseURL: catalog.baseUrl } : {},
    ...profile?.apiKeyEnv === undefined ? {} : { apiKeyEnv: profile.apiKeyEnv },
    ...profile?.supportedApis === undefined ? {} : { supportedApis: profile.supportedApis },
    ...catalog.headers === undefined ? {} : { headers: catalog.headers },
  }
}
