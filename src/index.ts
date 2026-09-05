/**
 * The inline web-search plugin: short-circuits agent-loop model calls on
 * the `llm/stream` waterfall, injecting the server-side `web_search` tool
 * into the wire request so search executes inside the model's own turn.
 * The narrow gate keeps every other request on the normal adapter path.
 * @module dsh-github-copilot
 */

import type { Context } from '@deepseek-ai/cordis'
import AuthorizationService from '@deepseek-ai/dsh-authorization'
// Bring the `systemPrompt` service declaration (dsh-agent augmentation) into
// the type graph: module augmentations only apply when their module is part
// of the program.
import type {} from '@deepseek-ai/dsh-agent'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { isAgentLoopRequest } from '@deepseek-ai/dsh-llm'
import * as dshSettings from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { GITHUB_COPILOT_CREDENTIAL_KEY, resolveCandidates, sameCandidates, SearchPlan } from './plan.ts'
import type { PlanConfig, SearchPlanCandidate } from './plan.ts'
import { probeCandidate } from './probe.ts'
import { currentChatRoute } from './current-provider.ts'
import type { CurrentChatRoute } from './current-provider.ts'
import { Config } from './config.ts'
import type { InlineConfig } from './config.ts'
import { contentHasImageAttachments, inlineWireStream } from './wire.ts'
import type { InlineHooks } from './wire.ts'
import { createTraditionalSearchProvider } from './traditional-search.ts'
import { assertDshCompatibility } from './compatibility.ts'
import GitHubCopilotAuthorizationController, {
  ensureGitHubCopilotProviderProfile,
} from './authorization-controller.ts'
import { createGitHubCopilotTokenResolver } from './copilot-auth.ts'
import { installCopilotToolSchemaCompatibility } from './tool-schema-compat.ts'
import { contentHasFileCompat } from './content-file.ts'
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

interface SettingsSectionHooks {
  setSource(source: () => InlineConfig): void
  onChange(): void
}

interface InstanceSettingsInstaller {
  installSection(
    owner: Context,
    namespace: SettingsNamespace,
    schema: typeof Config,
    entry: InlineConfig,
    hooks: SettingsSectionHooks,
  ): void
}

interface LegacySettingsModule {
  installSettingsSection?(
    owner: Context,
    namespace: SettingsNamespace,
    schema: typeof Config,
    entry: InlineConfig,
    hooks: SettingsSectionHooks,
  ): void
}

function isInstanceSettingsInstaller(value: unknown): value is InstanceSettingsInstaller {
  return typeof value === 'object'
    && value !== null
    && 'installSection' in value
    && typeof value.installSection === 'function'
}

function installWebSearchSettings(
  ctx: Context,
  config: InlineConfig,
  hooks: SettingsSectionHooks,
): void {
  const legacyInstaller = (dshSettings as LegacySettingsModule).installSettingsSection
  if (legacyInstaller !== undefined) {
    legacyInstaller(ctx, GITHUB_COPILOT_SETTINGS_NAMESPACE, Config, config, hooks)
    return
  }
  ctx.inject(['settings'], (settingsCtx) => {
    if (!isInstanceSettingsInstaller(settingsCtx.settings)) {
      throw new Error('github-copilot: settings service does not support section installation')
    }
    settingsCtx.settings.installSection(ctx, GITHUB_COPILOT_SETTINGS_NAMESPACE, Config, config, hooks)
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
  ensureAuthorization(ctx)
  ctx.inject(integrationInject, (integrationCtx) => {
    activate(integrationCtx, config)
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
function activate(ctx: Context, config: InlineConfig): void {
  assertDshCompatibility(ctx)
  ctx.plugin(GitHubCopilotAuthorizationController)
  const resolveGitHubCopilotToken = createGitHubCopilotTokenResolver(ctx, async () => {
    await ensureGitHubCopilotProviderProfile(ctx)
  })
  let current: () => InlineConfig = () => config
  // Only an actual eligible request creates a plan. Attach, settings, and
  // credential notifications must never start authenticated capability work.
  // A record notification cannot distinguish token refresh from account
  // replacement: invalidate even the current request's proof, without retrying
  // automatically. Only a later actual request may prove the new credentials.
  let active = true
  let generation = 0
  let proofCancellation = new AbortController()
  const candidateGenerations = new WeakMap<SearchPlanCandidate, number>()
  let currentPlan: SearchPlan | undefined
  // The route snapshot the current plan was built for: model/provider
  // switches in the web UI must rebuild the plan (and re-probe) instead of
  // reusing a stale candidate set.
  let planRoute: CurrentChatRoute | undefined
  // The probe knobs the current plan was built with: a probe/probeTimeoutMs
  // change must rebuild even when the candidate set is unchanged (e.g. to
  // recover a failed plan with a longer timeout or probing off).
  let planProbe: { enabled: boolean; timeoutMs: number } | undefined
  let traditionalPlan: SearchPlan | undefined
  let traditionalPlanRoute: CurrentChatRoute | undefined
  let traditionalPlanProbe: { enabled: boolean; timeoutMs: number } | undefined
  let traditionalPlanCandidates: readonly SearchPlanCandidate[] | undefined

  function invalidatePlans(): void {
    generation++
    proofCancellation.abort()
    proofCancellation = new AbortController()
    currentPlan = undefined
    planRoute = undefined
    planProbe = undefined
    traditionalPlan = undefined
    traditionalPlanRoute = undefined
    traditionalPlanProbe = undefined
    traditionalPlanCandidates = undefined
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
    if (candidateGenerations.get(candidate) !== generation) {
      throw new Error('github-copilot: search proof invalidated; retry with current credentials')
    }
  }

  const hooks: InlineHooks = {
    resolveApiKey: async (candidate) => {
      assertCurrentCandidate(candidate)
      if (!isDirectGitHubCopilot(candidate)) {
        throw new Error('github-copilot: hosted search refuses non-Copilot endpoints')
      }
      const auth = await resolveGitHubCopilotToken(candidate.model)
      // A credential lookup started before unload must not launch a late probe
      // or search request after the integration has been disposed.
      assertCurrentCandidate(candidate)
      return auth
    },
  }

  function isDirectGitHubCopilot(candidate: SearchPlanCandidate): boolean {
    try {
      return new URL(candidate.baseURL).hostname === 'api.individual.githubcopilot.com'
    } catch {
      return false
    }
  }

  function createPlan(candidates: readonly SearchPlanCandidate[], cfg: InlineConfig): SearchPlan {
    const startedAt = generation
    const signal = proofCancellation.signal
    for (const candidate of candidates) candidateGenerations.set(candidate, startedAt)
    const nextPlan = new SearchPlan(
      candidates,
      candidate => probeCandidate(candidate, hooks.resolveApiKey, cfg.probeTimeoutMs, signal),
      cfg.probe,
    )
    // SearchPlan may clone the candidate when a fallback spelling wins. Bind
    // that exact chosen object before any caller awaits settle() to use it.
    void nextPlan.settled.then(() => {
      const chosen = nextPlan.chosenCandidate()
      if (chosen !== undefined) candidateGenerations.set(chosen, startedAt)
    })
    return nextPlan
  }

  /** The live plan, built on first use and rebuilt when the chat route moves. */
  function plan(): SearchPlan {
    const route = currentChatRoute(ctx)
    const cfg = current()
    const probe = probeSettings(cfg)
    const candidates = resolveCandidates(ctx, planConfigOf(cfg))
    if (currentPlan !== undefined && sameRoute(route, planRoute)
      && planProbe?.enabled === probe.enabled
      && planProbe.timeoutMs === probe.timeoutMs
      && sameCandidates(candidates, currentPlan.candidates)) return currentPlan
    const startedAt = generation
    const nextPlan = createPlan(candidates, cfg)
    // A resolver can synchronously emit before the constructor returns. Never
    // install a plan across that invalidation, even before its first await.
    if (generation === startedAt && active) {
      currentPlan = nextPlan
      planRoute = route
      planProbe = probe
    }
    reportRoute(ctx)
    reportPlan(ctx, nextPlan, () => active && currentPlan === nextPlan)
    return nextPlan
  }

  /** Responses-only plan used by the traditional `ctx.web.search()` bridge. */
  function webPlan(): SearchPlan {
    const route = currentChatRoute(ctx)
    const probe = probeSettings(current())
    const candidates = traditionalCandidates()
    if (traditionalPlan !== undefined
      && sameRoute(route, traditionalPlanRoute)
      && traditionalPlanProbe?.enabled === probe.enabled
      && traditionalPlanProbe.timeoutMs === probe.timeoutMs
      && traditionalPlanCandidates !== undefined
      && sameCandidates(candidates, traditionalPlanCandidates)) return traditionalPlan
    const cfg = current()
    const startedAt = generation
    const nextPlan = createPlan(candidates, cfg)
    if (generation === startedAt && active) {
      traditionalPlan = nextPlan
      traditionalPlanRoute = route
      traditionalPlanProbe = probe
      traditionalPlanCandidates = candidates
    }
    return nextPlan
  }

  /** Responses candidates admitted by the current route whitelist. */
  function traditionalCandidates(): readonly SearchPlanCandidate[] {
    const cfg = current()
    const route = currentChatRoute(ctx)
    if (!cfg.enabled || route === undefined) return []
    if (cfg.providers.length > 0 && !cfg.providers.includes(route.provider)) return []
    return resolveCandidates(ctx, planConfigOf(cfg)).filter(candidate => candidate.protocol === 'openai-responses')
  }

  /** Local/provisional availability, refined by a matching cached probe verdict. */
  function traditionalAvailable(): boolean {
    if (!active) return false
    const route = currentChatRoute(ctx)
    const probe = probeSettings(current())
    const candidates = traditionalCandidates()
    if (candidates.length === 0) return false
    if (traditionalPlan === undefined
      || !sameRoute(route, traditionalPlanRoute)
      || traditionalPlanProbe?.enabled !== probe.enabled
      || traditionalPlanProbe.timeoutMs !== probe.timeoutMs
      || traditionalPlanCandidates === undefined
      || !sameCandidates(candidates, traditionalPlanCandidates)) return true
    return traditionalPlan.available()
  }

  ctx.web.registerSearchProvider(createTraditionalSearchProvider(
    traditionalAvailable,
    webPlan,
    hooks,
    current,
  ))

  installWebSearchSettings(ctx, config, {
    setSource: (source) => {
      current = source
    },
    // Invalidate only. Even an event burst coalesces into one fresh proof per
    // search surface on its next actual request, never one probe per event.
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
    if (!active || !preflight(request, cfg, ctx)) return next()
    const p = plan()
    if (!p.available()) return next()
    return inlineWireStream(request, p, hooks, cfg)
  })

  ctx.systemPrompt.section({
    name: 'tool:github-copilot',
    order: 115,
    // The guidance is only true while the plugin actually serves: with the
    // plugin disabled or the plan failed, an empty section keeps the model
    // from being steered toward a web_search tool that does not exist.
    text: () => servingPrompt(current, currentPlan),
  })
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
function reportRoute(ctx: Context): void {
  const route = currentChatRoute(ctx)
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

/** Project the settings section onto the plan's config surface. */
function planConfigOf(cfg: InlineConfig): PlanConfig {
  return {
    probe: cfg.probe,
    probeTimeoutMs: cfg.probeTimeoutMs,
  }
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
function preflight(request: GenerateOptions, cfg: InlineConfig, ctx: Context): boolean {
  if (!isAgentLoopRequest(request)) return false
  if (request.purpose !== undefined) return false
  if (!cfg.enabled) return false
  if (!providerAllowed(request, cfg, ctx)) return false
  if (request.messages.some(message => contentHasFileCompat(message.content))) return false
  if (contentHasImageAttachments(request)) return false
  return true
}


/**
 * Provider whitelist; empty config follows the current chat route. The
 * request provider AND model must match the default route used by the plan.
 * Session overrides may select another model on the same provider; those must
 * keep Core's normal transport instead of silently using the default model.
 * The whitelist only restricts which of the route's providers may be served;
 * it can never extend serving to a provider the plan was not built for.
 */
function providerAllowed(request: GenerateOptions, cfg: InlineConfig, ctx: Context): boolean {
  const route = currentChatRoute(ctx)
  if (route === undefined || route.provider !== request.provider || route.model !== request.model) return false
  return cfg.providers.length === 0 || cfg.providers.includes(request.provider)
}
