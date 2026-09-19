/**
 * The inline web-search plugin: short-circuits agent-loop model calls on
 * the `llm/stream` waterfall, injecting the server-side `web_search` tool
 * into the wire request so search executes inside the model's own turn.
 * The narrow gate keeps every other request on the normal adapter path.
 * @module dsh-github-copilot
 */

import type { Context } from '@deepseek-ai/cordis'
import type z from '@deepseek-ai/schemastery'
import AuthorizationService from '@deepseek-ai/dsh-authorization'
import GitHubCopilotDualModel from './dual-model-host.ts'
import SearchRoutingController from './search-routing-host.ts'
// Bring the `systemPrompt` service declaration (dsh-agent augmentation) into
// the type graph: module augmentations only apply when their module is part
// of the program.
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { isAgentLoopRequest } from '@deepseek-ai/dsh-llm'
import { WebError } from '@deepseek-ai/dsh-web'
import type { WebSearchRequest, WebSearchResult } from '@deepseek-ai/dsh-web'
import * as dshSettings from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { GITHUB_COPILOT_CREDENTIAL_KEY, candidatesForRoute, sameCandidates, SearchPlan } from './plan.ts'
import type { SearchPlanCandidate } from './plan.ts'
import { probeCandidate } from './probe.ts'
import { currentChatRoute, currentSearchInitiator, currentSearchSelection } from './current-provider.ts'
import type { CurrentChatRoute } from './current-provider.ts'
import { Config } from './config.ts'
import type { InlineConfig } from './config.ts'
import {
  NO_DEFAULT_SEARCH_PROVIDER,
  WEB_SEARCH_ROUTING_SETTINGS_NAMESPACE,
  WebSearchRoutingConfigSchema,
} from './web-search-routing-config.ts'
import type { WebSearchRoutingConfig } from './web-search-routing-config.ts'
import { normalizeWebSearchRouting } from './search-routing-policy.ts'
import { routeSearchTools } from './search-tool-routing.ts'
import type { SearchToolProvider } from './search-tool-routing.ts'
import type { CapturedSearchProvider } from './routed-web.ts'
import { contentHasImageAttachments, inlineWireStream } from './wire.ts'
import type { InlineHooks } from './wire.ts'
import { createTraditionalSearchProvider, GITHUB_COPILOT_HOSTED_SEARCH_PROVIDER_ID } from './traditional-search.ts'
import { isCopilotSearchSelection, routeSessionSearch } from './search-routing.ts'
import type { SearchSelection } from './search-routing.ts'
import { createDeepSeekSearchFallback } from './deepseek-search-fallback.ts'
import { isPluginPreviewProvider } from './model-protocol.ts'
import type {} from './routed-web.ts'
import { assertDshCompatibility } from './compatibility.ts'
import GitHubCopilotAuthorizationController, {
  ensureGitHubCopilotProviderProfile,
} from './authorization-controller.ts'
import { createGitHubCopilotTokenResolver } from './copilot-auth.ts'
import { installCopilotToolSchemaCompatibility } from './tool-schema-compat.ts'
import { contentHasFileCompat } from './content-file.ts'
import { hasResponsesReplayContext } from './serialize.ts'
import { resolveCopilotResponsesReasoning } from './responses-reasoning.ts'
import previewPlugin from './preview-route.ts'
import { GITHUB_COPILOT_PROVIDER_ID, GITHUB_COPILOT_PREVIEW_PROVIDER_ID } from './copilot-identity.ts'
export {
  COPILOT_HOSTED_SEARCH_PROVIDER_ID,
  GITHUB_COPILOT_HOSTED_SEARCH_PROVIDER_ID,
} from './traditional-search.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'github-copilot'

/**
 * Bootstrap dependency. The integration itself is mounted below only after
 * every service in {@link integrationInject}, including authorization, is
 * active.
 */
export const inject = ['credentials']

const integrationInject = [
  'llm',
  'systemPrompt',
  'settings',
  'credentials',
  'authorization',
  'web',
  'agentDefaultModel',
]

/** Settings namespace carrying this plugin's section. */
export const GITHUB_COPILOT_SETTINGS_NAMESPACE = 'github-copilot' as SettingsNamespace

/** Schema of the plugin's settings section, exported for composition consumers. */
export { Config } from './config.ts'
export type { InlineConfig } from './config.ts'
export {
  NO_DEFAULT_SEARCH_PROVIDER,
  WEB_SEARCH_ROUTING_SETTINGS_NAMESPACE,
  WebSearchRoutingConfigSchema,
} from './web-search-routing-config.ts'
export type { WebSearchRoutingConfig } from './web-search-routing-config.ts'
export { assertDshCompatibility, DSH_COMPATIBILITY } from './compatibility.ts'
export {
  GITHUB_COPILOT_CREDENTIAL_KEY,
  GitHubCopilotAuthorizationController,
  describeGitHubCopilotProviderProfile,
  ensureGitHubCopilotProviderProfile,
  LLM_PI_AI_SETTINGS_NAMESPACE,
} from './authorization-controller.ts'
export type {
  AuthorizationNoticeView,
  GitHubCopilotAuthorizationPhase,
  GitHubCopilotAuthorizationView,
  GitHubCopilotRouteView,
} from './authorization-controller.ts'

type PromptRouteText = (owner: Agent | undefined, selection: { provider?: string; model?: string }) => string

class ConfiguredSearchProofInvalidated extends WebError {
  constructor() {
    super('configured Copilot search owner or account proof invalidated', 'WEB_PROVIDER_UNAVAILABLE')
  }
}

interface SettingsSectionHooks<T> {
  setSource(source: () => T): void
  onChange(): void
}

interface InstanceSettingsInstaller {
  installSection<T>(
    owner: Context,
    namespace: SettingsNamespace,
    schema: z<T>,
    entry: T,
    hooks: SettingsSectionHooks<T>,
  ): void
}

interface LegacySettingsModule {
  installSettingsSection?<T>(
    owner: Context,
    namespace: SettingsNamespace,
    schema: z<T>,
    entry: T,
    hooks: SettingsSectionHooks<T>,
  ): void
}

function isInstanceSettingsInstaller(value: unknown): value is InstanceSettingsInstaller {
  return typeof value === 'object'
    && value !== null
    && 'installSection' in value
    && typeof value.installSection === 'function'
}

function installSettingsNamespace<T>(
  ctx: Context,
  namespace: SettingsNamespace,
  schema: z<T>,
  config: T,
  hooks: SettingsSectionHooks<T>,
): void {
  const legacyInstaller = (dshSettings as LegacySettingsModule).installSettingsSection
  if (legacyInstaller !== undefined) {
    legacyInstaller(ctx, namespace, schema, config, hooks)
    return
  }
  ctx.inject(['settings'], (settingsCtx) => {
    if (!isInstanceSettingsInstaller(settingsCtx.settings)) {
      throw new Error('github-copilot: settings service does not support section installation')
    }
    settingsCtx.settings.installSection(ctx, namespace, schema, config, hooks)
  })
}

/**
 * Register the inline short-circuit. The plan (candidates plus probe
 * verdict) follows the settings section; the listener reads the CURRENT
 * plan and config per request.
 * @param ctx - context whose `llm` events and `systemPrompt` receive the
 *   registrations; both are effect-scoped and unregister on dispose.
 * @param config - the composition entry config, used as the settings base layer.
 */
export function apply(ctx: Context, config: InlineConfig): void {
  // Register before dependency-gated activation so every Agent-scoped model
  // selection listener remains downstream. The filter must observe the
  // provider/model variables that model selection adds while unwinding.
  installCopilotToolSchemaCompatibility(ctx)
  let promptText: PromptRouteText = () => ''
  ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
    const owner = currentSearchInitiator(ctx)
    const assembled = await next()
    // Model selection unwinds before this listener. A previous request header
    // cannot establish the selected model for this new prompt assembly.
    const text = promptText(owner, { provider: assembled.variables.provider, model: assembled.variables.model })
    return { ...assembled, sections: assembled.sections.map(section => section.name === 'tool:github-copilot'
      ? { ...section, text } : section) }
  }, { prepend: true })
  ensureAuthorization(ctx)
  ctx.inject(integrationInject, (integrationCtx) => {
    promptText = activate(integrationCtx, config)
  })
}

/**
 * Reuse an authorization provider already mounted by Core. rc.2 profiles do
 * not mount one, so the package's runtime dependency supplies it. The
 * non-strict lookup also sees a provider whose owning fiber is still loading;
 * the registry check covers this package's provider while it is pending.
 */
function ensureAuthorization(ctx: Context): void {
  if (ctx.get('authorization', false) !== undefined || ctx.registry.has(AuthorizationService)) return
  ctx.plugin(AuthorizationService)
}

/** Activate the integration only after the complete DSH service contract is available. */
function activate(ctx: Context, config: InlineConfig): PromptRouteText {
  assertDshCompatibility(ctx)
  let current: () => InlineConfig = () => config
  let routingCurrent: () => WebSearchRoutingConfig = () => ({
    searchMode: 'auto',
    defaultSearchProvider: 'deepseek-official',
  })
  ctx.plugin(previewPlugin, { accountModelSettings: () => current(), requestBudgetSettings: () => {
    const selected = current()
    return { safetyTokens: selected.requestBudgetSafetyTokens, pressureRatio: selected.requestBudgetPressureRatio,
      compactionReasoning: selected.compactionReasoning }
  } })
  ctx.plugin(GitHubCopilotAuthorizationController)
  ctx.plugin(GitHubCopilotDualModel)
  ctx.plugin(SearchRoutingController)
  const resolveGitHubCopilotToken = createGitHubCopilotTokenResolver(ctx, async () => {
    await ensureGitHubCopilotProviderProfile(ctx)
  })
  // Only an actual eligible request creates a plan. Attach, settings, and
  // credential notifications must never start authenticated capability work.
  // A record notification cannot distinguish token refresh from account
  // replacement: invalidate even the current request's proof, without retrying
  // automatically. Only a later actual request may prove the new credentials.
  let active = true
  let generation = 0
  let proofCancellation = new AbortController()
  const candidateGenerations = new WeakMap<SearchPlanCandidate, number>()
  const candidateProviders = new WeakMap<SearchPlanCandidate, string>()
  interface CachedPlan {
    plan: SearchPlan
    route: CurrentChatRoute | undefined
    probe: { enabled: boolean; timeoutMs: number }
    generation: number
    assertProof?: () => void
    probeSignal?: AbortSignal
  }
  interface ConfiguredPlanOperation {
    readonly signal?: AbortSignal
    readonly assertCurrent: () => void
    readonly assertProof: () => void
  }
  interface OwnerPlans {
    cancellation: AbortController
    inline?: CachedPlan
    traditional?: CachedPlan
    configured?: CachedPlan
  }
  // Weak keys do not retain a Session solely for its cached plans and guards.
  // Route changes replace only this owner's cache; operations already started
  // continue with their captured route.
  const ownerPlans = new WeakMap<object, OwnerPlans>()
  const disposedOwners = new WeakSet<object>()
  const candidateSignals = new WeakMap<SearchPlanCandidate, AbortSignal>()

  function plansFor(owner: object): OwnerPlans {
    let plans = ownerPlans.get(owner)
    if (plans === undefined) {
      plans = { cancellation: new AbortController() }
      ownerPlans.set(owner, plans)
    }
    return plans
  }

  ctx.on('agent/disposed', ({ agent }) => {
    disposedOwners.add(agent)
    ownerPlans.get(agent)?.cancellation.abort()
    ownerPlans.delete(agent)
  })

  function invalidatePlans(): void {
    generation++
    proofCancellation.abort()
    proofCancellation = new AbortController()
    // Cached entries carry a generation, so invalidation needs no strong list
    // of Agent owners and cannot revive a plan after credential replacement.
  }

  // Public emit seam: the payload is a record key, not a grant. ctx.on owns
  // the listener in this Fiber; do not resolve auth or inspect settings here.
  ctx.on('credentials/record-updated', (key) => {
    if (key === GITHUB_COPILOT_CREDENTIAL_KEY) invalidatePlans()
  })
  ctx.effect(() => () => {
    active = false
    invalidatePlans()
  })

  function assertCurrentCandidate(candidate: SearchPlanCandidate): void {
    if (!active) throw new Error('github-copilot: hosted search integration was disposed')
    if (candidateSignals.get(candidate)?.aborted === true) {
      throw new Error('github-copilot: search owner or proof was disposed')
    }
    if (candidateGenerations.get(candidate) !== generation) {
      throw new Error('github-copilot: search proof invalidated; retry with current credentials')
    }
  }

  const hooks: InlineHooks = {
    resolveResponsesReasoning: (request, candidate) => resolveCopilotResponsesReasoning(ctx, request, candidate),
    resolveApiKey: async (candidate) => {
      assertCurrentCandidate(candidate)
      if (candidateProviders.get(candidate) !== GITHUB_COPILOT_PREVIEW_PROVIDER_ID && !isDirectGitHubCopilot(candidate)) {
        throw new Error('github-copilot: hosted search refuses non-Copilot endpoints')
      }
      const provider = candidateProviders.get(candidate)
      try {
        const auth = provider === GITHUB_COPILOT_PREVIEW_PROVIDER_ID
          ? await ctx.get('githubCopilotPreview')?.resolveRequestAuth(candidate.model, candidateSignals.get(candidate))
          : await resolveGitHubCopilotToken(candidate.model)
        if (provider === GITHUB_COPILOT_PREVIEW_PROVIDER_ID) {
          const facts = ctx.get('githubCopilotPreview')?.routeFacts(candidate.model)
          if (auth === undefined || facts === undefined || facts.api !== candidate.protocol || facts.baseURL !== candidate.baseURL
            || auth.baseURL !== candidate.baseURL) throw new Error('COPILOT_MANAGED_SEARCH_METADATA_CHANGED')
        }
        // A credential lookup started before unload must not launch a late probe
        // or search request after the integration has been disposed.
        assertCurrentCandidate(candidate)
        return auth
      } catch (error) {
        // Auth/proof failures are terminal, not paid-fallback eligibility. Revoke
        // before probe/plan/web error translation can erase their distinction.
        // A late failure from an older generation must not cancel a newer proof.
        if (active && candidateGenerations.get(candidate) === generation
          && candidateSignals.get(candidate)?.aborted !== true) invalidatePlans()
        throw error
      }
    },
  }

  function isDirectGitHubCopilot(candidate: SearchPlanCandidate): boolean {
    try {
      return new URL(candidate.baseURL).hostname === 'api.individual.githubcopilot.com'
    } catch {
      return false
    }
  }

  function createPlan(
    candidates: readonly SearchPlanCandidate[], cfg: InlineConfig,
    provider: string | undefined, plans: OwnerPlans | undefined,
    operation?: ConfiguredPlanOperation,
  ): SearchPlan {
    const startedAt = generation
    const signal = AbortSignal.any([proofCancellation.signal,
      ...plans === undefined ? [] : [plans.cancellation.signal]])
    // Only unfinished probes belong to the creating request. A verified plan
    // must never lend that request's cancellation or deadline to a later query.
    const probeSignal = operation?.signal === undefined ? signal : AbortSignal.any([signal, operation.signal])
    function bind(candidate: SearchPlanCandidate, lifetime: AbortSignal): void {
      candidateGenerations.set(candidate, startedAt)
      candidateSignals.set(candidate, lifetime)
      if (provider !== undefined) candidateProviders.set(candidate, provider)
    }
    for (const candidate of candidates) bind(candidate, cfg.probe ? probeSignal : signal)
    const nextPlan = new SearchPlan(
      candidates,
      candidate => probeCandidate(candidate, async selected => {
        operation?.assertCurrent()
        const auth = await hooks.resolveApiKey(selected)
        operation?.assertCurrent()
        return auth
      }, cfg.probeTimeoutMs, probeSignal),
      cfg.probe,
      signal,
    )
    // SearchPlan may clone the candidate when a fallback spelling wins. Bind
    // that exact chosen object before any caller awaits settle() to use it.
    void nextPlan.settled.then(() => {
      const chosen = nextPlan.chosenCandidate()
      if (chosen !== undefined) bind(chosen, signal)
    })
    return nextPlan
  }

  function matches(
    cached: CachedPlan | undefined, route: CurrentChatRoute | undefined,
    candidates: readonly SearchPlanCandidate[], cfg: InlineConfig,
  ): cached is CachedPlan {
    // A silent account-proof revision can revoke an old configured capability
    // verdict without emitting a credential event or changing endpoint facts.
    try { cached?.assertProof?.() } catch { return false }
    // Concurrent configured callers own separate unfinished probes. Cancellation
    // is not negative capability evidence, but a completed unsupported verdict is.
    if (cached?.assertProof !== undefined && cached.plan.chosenCandidate() === undefined
      && (cached.plan.available() || cached.probeSignal?.aborted === true)) return false
    return cached !== undefined && cached.generation === generation
      && cached.plan.signal?.aborted !== true
      && sameRoute(route, cached.route)
      && cached.probe.enabled === cfg.probe && cached.probe.timeoutMs === cfg.probeTimeoutMs
      && sameCandidates(candidates, cached.plan.candidates)
  }

  function plan(
    route: CurrentChatRoute | undefined, cfg: InlineConfig,
    owner: object | undefined, surface: 'inline' | 'traditional' | 'configured',
    operation?: ConfiguredPlanOperation,
  ): SearchPlan {
    const plans = owner === undefined ? undefined : plansFor(owner)
    const candidates = surface === 'inline' ? candidatesForRoute(route)
      : surface === 'configured' ? configuredCandidates(cfg)
        : traditionalCandidates(route, cfg)
    const cached = plans?.[surface]
    if (matches(cached, route, candidates, cfg)) return cached.plan
    const startedAt = generation
    // Configured candidates all belong to the account-owned route, even when
    // automatic selection has no single model route to use as a cache key.
    const provider = surface === 'configured' ? GITHUB_COPILOT_PREVIEW_PROVIDER_ID : route?.provider
    const nextPlan = createPlan(candidates, cfg, provider, plans, operation)
    // A resolver may synchronously invalidate credentials before construction returns.
    if (generation === startedAt && active && plans?.cancellation.signal.aborted !== true) {
      if (plans !== undefined) plans[surface] = {
        plan: nextPlan, route, probe: probeSettings(cfg), generation: startedAt,
        ...operation === undefined ? {} : { assertProof: operation.assertProof,
          ...operation.signal === undefined ? {} : { probeSignal: operation.signal } },
      }
    }
    if (surface === 'inline') {
      reportRoute(ctx, route)
      reportPlan(ctx, nextPlan, () => active && generation === startedAt
        && plans?.cancellation.signal.aborted !== true && (plans === undefined || plans.inline?.plan === nextPlan))
    }
    return nextPlan
  }

  /** Traditional requests have no explicit model fields: require their initiator. */
  async function webPlan(signal?: AbortSignal): Promise<SearchPlan> {
    const owner = currentSearchInitiator(ctx)
    const cfg = current()
    const selection = currentSearchSelection(owner)
    const startedAt = generation
    if (owner === undefined || disposedOwners.has(owner) || selection === undefined) {
      throw new Error('github-copilot: hosted search requires agents.currentInitiator() and Session.requestHeader().config')
    }
    const plans = plansFor(owner)
    if (selection?.provider === GITHUB_COPILOT_PREVIEW_PROVIDER_ID) {
      const signals = [proofCancellation.signal, plans.cancellation.signal]
      if (signal !== undefined) signals.push(signal)
      await ctx.get('githubCopilotPreview')?.discover({ force: false, signal: AbortSignal.any(signals) })
    }
    if (!active || startedAt !== generation || plans.cancellation.signal.aborted || signal?.aborted === true) {
      throw new Error('github-copilot: search proof invalidated during route resolution')
    }
    return plan(currentChatRoute(ctx, selection), cfg, owner, 'traditional')
  }

  function configuredSearchSelection(cfg: InlineConfig): SearchSelection | undefined {
    const model = cfg.searchModel?.trim()
    if (model === undefined || model.length === 0) return undefined
    return { provider: GITHUB_COPILOT_PREVIEW_PROVIDER_ID, model }
  }

  /** Resolve provider-owned candidates only on an actual search, never from Chat defaults. */
  async function configuredWebPlan(assertCurrent: () => void, assertProof: () => void, signal?: AbortSignal): Promise<SearchPlan> {
    const owner = currentSearchInitiator(ctx)
    const cfg = current()
    const selection = configuredSearchSelection(cfg)
    const startedAt = generation
    if (owner === undefined || disposedOwners.has(owner) || !configuredAllowed(cfg)) {
      throw new Error('github-copilot: independent hosted search requires an initiating Agent and an allowed Copilot provider')
    }
    const plans = plansFor(owner)
    const signals = [proofCancellation.signal, plans.cancellation.signal]
    if (signal !== undefined) signals.push(signal)
    await ctx.get('githubCopilotPreview')?.discover({ force: false, signal: AbortSignal.any(signals) })
    assertCurrent()
    if (!active || startedAt !== generation || plans.cancellation.signal.aborted || signal?.aborted === true) {
      throw new Error('github-copilot: configured search proof invalidated during route resolution')
    }
    // Passing undefined to currentChatRoute would read Chat: automatic plans
    // intentionally have no route key and fingerprint the entire candidate set.
    const route = selection === undefined ? undefined : currentChatRoute(ctx, selection)
    return plan(route, cfg, owner, 'configured', { assertCurrent, assertProof, ...signal === undefined ? {} : { signal } })
  }

  function traditionalCandidates(route: CurrentChatRoute | undefined, cfg: InlineConfig): readonly SearchPlanCandidate[] {
    if (!cfg.enabled || route === undefined) return []
    if (cfg.providers.length > 0 && !cfg.providers.includes(route.provider)) return []
    return candidatesForRoute(route).filter(candidate => candidate.protocol === 'openai-responses')
  }

  function configuredAllowed(cfg: InlineConfig): boolean {
    return cfg.enabled && (cfg.providers.length === 0
      || cfg.providers.includes(GITHUB_COPILOT_PROVIDER_ID)
      || cfg.providers.includes(GITHUB_COPILOT_PREVIEW_PROVIDER_ID))
  }

  function configuredCandidates(cfg: InlineConfig): readonly SearchPlanCandidate[] {
    if (!configuredAllowed(cfg)) return []
    const selection = configuredSearchSelection(cfg)
    // A nonempty legacy override is authoritative, including an unknown or
    // unsupported model. Never silently replace it with an automatic candidate.
    if (selection !== undefined) return candidatesForRoute(currentChatRoute(ctx, selection))
      .filter(candidate => candidate.protocol === 'openai-responses')
    const preview = ctx.get('githubCopilotPreview')
    const ids = [...new Set(preview?.getView().models.map(model => model.id) ?? [])].sort()
    const candidates: SearchPlanCandidate[] = []
    for (const model of ids) {
      const route = currentChatRoute(ctx, { provider: GITHUB_COPILOT_PREVIEW_PROVIDER_ID, model })
      // Display metadata may be stale. Only current account-owned routeFacts
      // supply protocol and endpoint evidence; neither proves search capability.
      if (route?.api !== 'openai-responses') continue
      candidates.push(...candidatesForRoute(route))
      if (candidates.length === 3) break
    }
    return candidates
  }

  /** Local checks only; availability must never start a credential lookup or probe. */
  function traditionalAvailable(): boolean {
    if (!active) return false
    const owner = currentSearchInitiator(ctx)
    if (owner === undefined || disposedOwners.has(owner)) return false
    const selection = currentSearchSelection(owner)
    if (selection === undefined) return false
    const route = currentChatRoute(ctx, selection)
    const cfg = current()
    const candidates = traditionalCandidates(route, cfg)
    if (candidates.length === 0) {
      // Expired/cold managed facts may be ensured only by an actual request.
      // This is eligibility, not a successful capability proof or model claim.
      return cfg.enabled && route?.provider === GITHUB_COPILOT_PREVIEW_PROVIDER_ID
        && route.api === undefined
        && (cfg.providers.length === 0 || cfg.providers.includes(route.provider))
        && ctx.get('githubCopilotPreview')?.getView().configured === true
    }
    const cached = ownerPlans.get(owner)?.traditional
    return !matches(cached, route, candidates, cfg) || cached.plan.available()
  }

  /** Local readiness for the provider-owned Copilot search model. */
  function configuredAvailable(): boolean {
    if (!active) return false
    const owner = currentSearchInitiator(ctx)
    if (owner === undefined || disposedOwners.has(owner)) return false
    const cfg = current()
    if (!configuredAllowed(cfg)) return false
    const selection = configuredSearchSelection(cfg)
    const route = selection === undefined ? undefined : currentChatRoute(ctx, selection)
    const candidates = configuredCandidates(cfg)
    if (candidates.length === 0) {
      const view = ctx.get('githubCopilotPreview')?.getView()
      // A cold/stale snapshot can be ensured by the actual request. Ready
      // metadata with no eligible automatic candidate remains unavailable.
      return view?.configured === true && (selection === undefined
        ? view.state !== 'ready'
        : route?.provider === GITHUB_COPILOT_PREVIEW_PROVIDER_ID && route.api === undefined)
    }
    const cached = ownerPlans.get(owner)?.configured
    return !matches(cached, route, candidates, cfg) || cached.plan.available()
  }

  const traditionalProvider = createTraditionalSearchProvider(
    traditionalAvailable,
    webPlan,
    hooks,
    current,
  )
  async function configuredSearch(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const owner = currentSearchInitiator(ctx)
    const startedGeneration = generation
    const cfg = current()
    // Capture continuity before discovery can revoke the old account revision.
    // Cold metadata is allowed by the owner proof; a later account change is not.
    const preview = ctx.get('githubCopilotPreview')
    const proof = preview?.captureSearchProof()
    const assertProof = () => {
      if (!active || generation !== startedGeneration || owner === undefined || disposedOwners.has(owner)
        || preview === undefined || ctx.get('githubCopilotPreview') !== preview || proof?.() !== true) {
        throw new ConfiguredSearchProofInvalidated()
      }
    }
    const assertCurrent = () => {
      if (signal?.aborted) throw new WebError('web search aborted', 'WEB_ABORTED')
      assertProof()
    }
    assertCurrent()
    const provider = createTraditionalSearchProvider(configuredAvailable, async requestSignal => {
      assertCurrent()
      const searchPlan = await configuredWebPlan(assertCurrent, assertProof, requestSignal)
      assertCurrent()
      return searchPlan
    }, {
      ...hooks,
      resolveApiKey: async candidate => {
        // Probe authentication may start before the plan resolver returns, so
        // keep the entry proof around both discovery and native authentication.
        assertCurrent()
        const auth = await hooks.resolveApiKey(candidate)
        assertCurrent()
        return auth
      },
    }, () => cfg,
    'github-copilot-hosted requires an eligible account-authorized Responses search candidate; an explicit searchModel override must also be eligible')
    try {
      const result = await provider.search(request, signal)
      assertCurrent()
      return result
    } catch (error) {
      // Probe/wire translation may replace the original exception, including a
      // swallowed discovery failure. Recheck the entry proof before any fallback.
      assertCurrent()
      throw error
    }
  }
  ctx.web.registerSearchProvider(traditionalProvider)
  ctx.provide('githubCopilotSearchRouter', {
    search: async (request, signal, delegate, selectProvider, captureSearchProvider) => {
      const cfg = current()
      const routing = routingCurrent()
      const policy = normalizeWebSearchRouting(routing)
      const owner = currentSearchInitiator(ctx)
      const selection = currentSearchSelection(owner)
      const managedOwned = selection?.provider === GITHUB_COPILOT_PREVIEW_PROVIDER_ID
        && isPluginPreviewProvider(ctx, selection.provider)
      if (!cfg.enabled || cfg.routeWebSearch === false) return delegate(request, signal)
      if (!policy.legacy && captureSearchProvider === undefined) {
        throw new WebError('explicit search routing requires captureSearchProvider from the routed Web facade', 'WEB_PROVIDER_UNAVAILABLE')
      }
      if (owner === undefined) {
        if (!policy.legacy) throw new WebError('explicit search routing requires agents.currentInitiator()', 'WEB_PROVIDER_UNAVAILABLE')
        return delegate(request, signal)
      }
      if (captureSearchProvider !== undefined) {
        if (policy.primaryProvider === NO_DEFAULT_SEARCH_PROVIDER) {
          throw new WebError('web search is disabled by the primary search provider setting', 'WEB_PROVIDER_UNAVAILABLE')
        }
        const startedGeneration = generation
        const registrations: CapturedSearchProvider[] = []
        let usingManagedPrimary = false
        let configuredProofInvalid = false
        const managedPreview = managedOwned ? ctx.get('githubCopilotPreview') : undefined
        const managedProof = managedPreview?.captureSearchProof()
        const capture = (id: string): CapturedSearchProvider | undefined => {
          const provider = captureSearchProvider(id)
          if (provider !== undefined) registrations.push(provider)
          return provider
        }
        const missing = (id: string): SearchToolProvider => ({
          id,
          search: async () => { throw new WebError('the configured search provider is not registered', 'WEB_PROVIDER_CONFIGURED_MISSING') },
        })
        const configured = (id: string): SearchToolProvider => {
          const registration = capture(id)
          if (registration === undefined) return missing(id)
          if (id !== GITHUB_COPILOT_HOSTED_SEARCH_PROVIDER_ID || !registration.owns(traditionalProvider)) return registration
          return {
            id,
            search: async (query, querySignal) => {
              try { return await configuredSearch(query, querySignal) }
              catch (error) {
                // Configured search owns a separate account proof. Its invalidation
                // must not be translated into a generic paid-fallback opportunity.
                if (error instanceof ConfiguredSearchProofInvalidated) configuredProofInvalid = true
                throw error
              }
            },
          }
        }
        let primary: SearchToolProvider | undefined
        if (policy.primaryProvider === 'auto') {
          const nativeAllowed = isCopilotSearchSelection(selection, managedOwned)
            && (cfg.providers.length === 0 || cfg.providers.includes(selection?.provider ?? ''))
          if (nativeAllowed) {
            const native = capture(GITHUB_COPILOT_HOSTED_SEARCH_PROVIDER_ID)
            // Only our exact registration can authorize alias-based native search.
            // Another implementation choosing this id must never receive our auth or model.
            if (native?.owns(traditionalProvider)) {
              usingManagedPrimary = managedOwned
              primary = native
            }
          } else if (selection !== undefined) primary = capture(selection.provider)
        } else primary = configured(policy.primaryProvider)
        const fallback = policy.defaultProvider === NO_DEFAULT_SEARCH_PROVIDER
          ? undefined : configured(policy.defaultProvider)
        const boundSignal = AbortSignal.any([
          ...signal === undefined ? [] : [signal],
          proofCancellation.signal,
          plansFor(owner).cancellation.signal,
          ...registrations.map(provider => provider.signal),
        ])
        const canContinue = () => active && generation === startedGeneration && !disposedOwners.has(owner)
          && !configuredProofInvalid && registrations.every(provider => provider.current())
          && (!usingManagedPrimary || ctx.get('githubCopilotPreview') === managedPreview && managedProof?.() === true)
        // Generic dispatch calls the captured registration, including DeepSeek.
        // An id is not proof that it is the official adapter or has a pre-auth hook.
        // The older direct-call path below retains its separately owned guarded factory.
        return routeSearchTools(request, boundSignal, {
          primary, fallback, canContinue,
          allowFailureFallback: !policy.legacy || cfg.searchFallback !== 'none',
        })
      }
      const copilotSelection = isCopilotSearchSelection(selection, managedOwned)
      const nativeAllowed = copilotSelection
        && (cfg.providers.length === 0 || cfg.providers.includes(selection?.provider ?? ''))
      const useNative = (routing.searchMode ?? 'auto') === 'auto' && nativeAllowed
        && (selectProvider === undefined || traditionalAvailable())
      const defaultProviderId = routing.defaultSearchProvider?.trim() || 'deepseek-official'
      if (!useNative && defaultProviderId === NO_DEFAULT_SEARCH_PROVIDER) {
        throw new WebError('web search is disabled by github-copilot-search-routing.defaultSearchProvider', 'WEB_PROVIDER_UNAVAILABLE')
      }
      // Legacy direct callers do not supply exact-id dispatch. Preserve their
      // original delegate and signal identity for every non-Copilot backend.
      if (!useNative && defaultProviderId !== GITHUB_COPILOT_HOSTED_SEARCH_PROVIDER_ID
        && selectProvider === undefined) return delegate(request, signal)
      const startedGeneration = generation
      const managedPreview = useNative && managedOwned ? ctx.get('githubCopilotPreview') : undefined
      const managedProof = managedPreview?.captureSearchProof()
      const ownerSignal = plansFor(owner).cancellation.signal
      const boundSignal = AbortSignal.any([
        ...signal === undefined ? [] : [signal],
        proofCancellation.signal,
        ownerSignal,
      ])
      const canContinue = (): boolean => active && generation === startedGeneration && !disposedOwners.has(owner)
        && (!useNative || !managedOwned
          || ctx.get('githubCopilotPreview') === managedPreview && managedProof?.() === true)

      if (!useNative) {
        if (defaultProviderId === GITHUB_COPILOT_HOSTED_SEARCH_PROVIDER_ID) {
          return configuredSearch(request, boundSignal)
        }
        return selectProvider!(defaultProviderId, request, boundSignal)
      }

      const outcome = await routeSessionSearch(request, boundSignal, {
        selection,
        managedOwned,
        // Retain the known pre-dispatch-guarded DeepSeek failure fallback only
        // when it is also the selected default. Never silently spend on DeepSeek
        // after the user chose another backend or disabled the default.
        fallback: defaultProviderId === 'deepseek-official' ? cfg.searchFallback ?? 'deepseek' : 'none',
        copilot: traditionalProvider,
        delegate,
        resolveDeepSeek: () => createDeepSeekSearchFallback(ctx, owner, canContinue),
        canContinue,
      })
      return outcome.result
    },
  })

  installSettingsNamespace(ctx, GITHUB_COPILOT_SETTINGS_NAMESPACE, Config, config, {
    setSource: (source) => {
      current = source
    },
    // Invalidate only. Even an event burst coalesces into one fresh proof per
    // search surface on its next actual request, never one probe per event.
    onChange: invalidatePlans,
  })
  installSettingsNamespace(ctx, WEB_SEARCH_ROUTING_SETTINGS_NAMESPACE, WebSearchRoutingConfigSchema, {}, {
    setSource: (source) => {
      routingCurrent = source
    },
    onChange: invalidatePlans,
  })

  // The temporary GPT-6 route writes its ownership backup into this plugin's
  // settings namespace, so reconcile only after that section is installed.
  void ensureGitHubCopilotProviderProfile(ctx).catch((error: unknown) => {
    ctx.logger.error('github-copilot: failed to repair the GitHub Copilot provider route during startup')
    ctx.logger.error(error)
  })

  ctx.on('llm/stream', (request: GenerateOptions, next: () => AsyncIterable<StreamChunk>) => {
    const cfg = current()
    // Zero-cost gate first: disabled plugins, non-loop requests, purposed
    // calls, provider mismatches, and image-bearing requests never build a
    // plan and never start a probe.
    if (!active || normalizeWebSearchRouting(routingCurrent()).primaryProvider !== 'auto') return next()
    const owner = currentSearchInitiator(ctx)
    if (owner !== undefined && disposedOwners.has(owner)) return next()
    const route = currentChatRoute(ctx, request)
    if (!preflight(request, cfg, ctx, route)) return next()
    const p = plan(route, cfg, owner, 'inline')
    if (!p.available()) return next()
    // Preserve the caller's request and bind both protocol wires to this exact
    // owner/proof lifetime, including final HTTP and streaming body reads.
    const signals = [request.signal, p.signal].filter((signal): signal is AbortSignal => signal !== undefined)
    const operation = { ...request, signal: AbortSignal.any(signals) }
    return inlineWireStream(operation, p, hooks, cfg)
  })

  ctx.systemPrompt.section({
    name: 'tool:github-copilot',
    order: 115,
    // Native-search availability is advertised only after proof. The routed
    // bundle may separately explain how to disclose a reported fallback, without
    // claiming that a search endpoint is ready.
    text: () => '',
  })
  return (owner, selection) => {
    const policy = normalizeWebSearchRouting(routingCurrent())
    if (!active || owner === undefined || disposedOwners.has(owner) || policy.primaryProvider !== 'auto') return ''
    const route = currentChatRoute(ctx, selection)
    const cfg = current()
    if (route === undefined || (cfg.providers.length > 0 && !cfg.providers.includes(route.provider))) return ''
    const cached = ownerPlans.get(owner)?.inline
    const nativeGuidance = servingPrompt(current, matches(cached, route, candidatesForRoute(route), cfg) ? cached.plan : undefined)
    const owned = route.provider === GITHUB_COPILOT_PREVIEW_PROVIDER_ID && isPluginPreviewProvider(ctx, route.provider)
    if (!cfg.enabled || cfg.routeWebSearch === false || ctx.get('githubCopilotOriginalWeb') === undefined
      || !isCopilotSearchSelection(route, owned)) return nativeGuidance
    const disclosure = policy.defaultProvider === NO_DEFAULT_SEARCH_PROVIDER || policy.legacy && cfg.searchFallback === 'none'
      ? 'Copilot search fallback is disabled. Do not silently substitute another paid search backend after a search failure.'
      : 'When web_search reports a fallback, explicitly tell the user the actual search backend (and custom endpoint/model when provided) and possible API charges in your answer. Never describe fallback results as Copilot search. Automatic fallback does not need per-search confirmation.'
    return [nativeGuidance, disclosure].filter(Boolean).join('\n\n')
  }
}

/**
 * The web-search guidance text, or an empty string while the plugin cannot
 * serve: disabled, no plan yet, or a plan that has not settled on a
 * VERIFIED candidate (probing or failed). Only a ready plan — the state
 * `available()` admits for serving — may tell the model the tool exists.
 * @param current - the authoritative config source.
 * @param plan - the live plan, when one exists.
 * @returns the section text to contribute to this assembly.
 */
function servingPrompt(current: () => InlineConfig, plan: SearchPlan | undefined): string {
  if (!current().enabled || plan?.chosenCandidate() === undefined) return ''
  return '## Web Search\n\n'
    + 'The web_search tool runs natively on the model provider inside the same request: '
    + 'when you call it, the search executes server-side and its results are immediately '
    + 'available for you to answer from. Use web_search when the user asks for current or '
    + 'online information. Prefer web_search over guessing when freshness matters. '
    + 'Cite the relevant URLs as markdown links in your answer.'
}

/**
 * Announce the plan's verdict through the harness logger.
 * @param ctx - the plugin context whose logger receives the line.
 * @param plan - the plan whose settled verdict to announce.
 */
function reportPlan(ctx: Context, plan: SearchPlan, isCurrent: () => boolean): void {
  void plan.settled.then(() => {
    if (!isCurrent()) return
    const chosen = plan.chosenCandidate()
    if (chosen === undefined) {
      ctx.logger.warn('[github-copilot] %s', plan.failureReason() ?? 'web search is disabled')
      return
    }
    ctx.logger.info(
      '[github-copilot] serving inline web search through %s at %s (model %s, key %s)',
      chosen.protocol,
      chosen.baseURL,
      chosen.model,
      chosen.apiKeyEnv,
    )
  })
}

/** Report the detected chat route through the harness logger. */
function reportRoute(ctx: Context, route: CurrentChatRoute | undefined): void {
  if (route === undefined) {
    ctx.logger.warn('[github-copilot] chat route undetectable; inline web search stays on the adapter path')
    return
  }
  ctx.logger.info(
    '[github-copilot] chat route %s (api=%s, baseURL=%s)',
    route.provider,
    route.api ?? 'unknown',
    route.baseURL ?? 'unknown',
  )
}

/** The probe knobs deciding whether a candidate set needs a new verdict. */
function probeSettings(cfg: InlineConfig): { enabled: boolean; timeoutMs: number } {
  return { enabled: cfg.probe, timeoutMs: cfg.probeTimeoutMs }
}

/** Whether two route snapshots are identical for plan rebuilding purposes. */
function sameRoute(left: CurrentChatRoute | undefined, right: CurrentChatRoute | undefined): boolean {
  if (left === undefined || right === undefined) return left === right
  return left.provider === right.provider
    && left.model === right.model
    && left.api === right.api
    && left.baseURL === right.baseURL
    && left.apiKeyEnv === right.apiKeyEnv
    && JSON.stringify(left.supportedApis) === JSON.stringify(right.supportedApis)
}

/**
 * The narrow gate: short-circuit only agent-loop conversation requests on a
 * whitelisted route; everything else keeps the normal adapter path. Runs
 * before the plan is built so disabled plugins and unrelated requests never
 * trigger a probe.
 */
function preflight(
  request: GenerateOptions, cfg: InlineConfig, ctx: Context, route: CurrentChatRoute | undefined,
): boolean {
  if (!isAgentLoopRequest(request)) return false
  // The registered preview keeps native adapter metadata, replay and file projection.
  if (request.provider === GITHUB_COPILOT_PREVIEW_PROVIDER_ID) return false
  if (request.purpose !== undefined) return false
  if (!cfg.enabled) return false
  if (!providerAllowed(request, cfg, route)) return false
  if (request.messages.some(message => contentHasFileCompat(message.content))) return false
  if (contentHasImageAttachments(request)) return false
  // New Core messages may carry system authority in-band. The legacy Anthropic
  // serializer only models user/assistant turns; let Core preserve that authority.
  if (route?.api === 'anthropic-messages' && request.messages.some(message => String(message.role) === 'system')) return false
  // Public summaries are not raw reasoning. Core alone owns encrypted/signed replay.
  if (hasResponsesReplayContext(request.messages)) return false
  if (route?.api === 'openai-responses') {
    try {
      resolveCopilotResponsesReasoning(ctx, request, { protocol: 'openai-responses', model: route.model })
    } catch {
      // Core enforces the original request when native facts are unavailable or disagree.
      return false
    }
  }
  return true
}


/**
 * The whitelist restricts the explicit request route; it never selects a
 * different Session or authorizes a different provider/model for the plan.
 */
function providerAllowed(request: GenerateOptions, cfg: InlineConfig, route: CurrentChatRoute | undefined): boolean {
  if (route === undefined || route.provider !== request.provider || route.model !== request.model) return false
  return cfg.providers.length === 0 || cfg.providers.includes(request.provider)
}
