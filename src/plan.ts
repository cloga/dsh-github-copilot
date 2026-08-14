/**
 * Search-plan resolution: which protocol and endpoint native search runs
 * through. An explicit config pin always wins; otherwise the current chat
 * route (default-model selection plus the `llm-pi-ai` settings section) is
 * detected and probed — its own protocol when that can search, the known
 * search-capable sibling protocols of its host otherwise. The {@link SearchPlan}
 * class owns the probe lifecycle so `available()` stays synchronous while the
 * verdict lands in the background.
 * @module dsh-web-search-provider/plan
 */

import { WebError } from '@deepseek-ai/dsh-web'
import type { Context } from '@deepseek-ai/cordis'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import type { ProbeOutcome } from './probe.ts'
import { currentChatRoute } from './current-provider.ts'
import type { CurrentChatRoute } from './current-provider.ts'
import { DEFAULT_API_VERSION, DEFAULT_MAX_TOKENS, DEFAULT_MAX_USES } from './anthropic.ts'

/** The two search-capable wire protocols this package speaks. */
export type SearchProtocol = 'openai-responses' | 'anthropic-messages'

/** Default model for both protocols when neither config nor route names one. */
export const DEFAULT_MODEL = 'deepseek-v4-flash'

/** Default credential reference when neither config nor route names one. */
export const DEFAULT_API_KEY_ENV = 'DEEPSEEK_API_KEY'

/** Default Responses base URL (DeepSeek first-party; `/responses` is appended). */
export const DEFAULT_RESPONSES_BASE_URL = 'https://api.deepseek.com'

/** Default Anthropic-compatible base URL (DeepSeek first-party; `/messages` is appended). */
export const DEFAULT_ANTHROPIC_BASE_URL = 'https://api.deepseek.com/anthropic/v1'

/** Default upper bound on generated tokens for a Responses search. */
export const DEFAULT_MAX_OUTPUT_TOKENS = 4096

/**
 * Environment variables naming endpoint bases for the pinned-protocol mode.
 * Deliberately distinct from `$DEEPSEEK_BASE_URL`, which belongs to the
 * chat-completions LLM adapter: search speaks the search protocols, so one
 * variable cannot serve both.
 */
export const RESPONSES_BASE_URL_ENV = 'DSH_WEB_SEARCH_RESPONSES_BASE_URL'
export const ANTHROPIC_BASE_URL_ENV = 'DSH_WEB_SEARCH_ANTHROPIC_BASE_URL'

/** Known credential references for pi-ai catalog routes without a profile override. */
const KNOWN_API_KEY_ENVS: Readonly<Record<string, string>> = {
  deepseek: 'DEEPSEEK_API_KEY',
  // The legacy `@deepseek-ai/dsh-llm-deepseek` adapter's route alias; the
  // shipped base composition still selects it by default.
  'deepseek-official': 'DEEPSEEK_API_KEY',
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
}

/** Whether a route is the DeepSeek first-party family (catalog or legacy alias). */
function isDeepSeekFamily(provider: string): boolean {
  return provider === 'deepseek' || provider === 'deepseek-official'
}

/**
 * Fully defaulted endpoint facts one search (or probe) operation runs with.
 * Every field is resolved once at plan build time so the adapters never fall
 * back mid-operation.
 */
export interface SearchPlanCandidate {
  readonly protocol: SearchProtocol
  /** Endpoint base; `/responses` or `/messages` is appended by the adapter. */
  readonly baseURL: string
  readonly model: string
  /** Credential reference resolved through the credentials seam. */
  readonly apiKeyEnv: string
  /** `anthropic-version` header value (anthropic-messages only). */
  readonly apiVersion: string
  /** Upper bound on generated tokens for the Messages request (anthropic-messages only). */
  readonly maxTokens: number
  /** Maximum `web_search` server-tool uses per request (anthropic-messages only). */
  readonly maxUses: number
  /** Upper bound on generated tokens for a Responses search (openai-responses only). */
  readonly maxOutputTokens: number
}

/** The plugin-config fields the plan reads; `apply` projects the full section onto this. */
export interface PlanConfig {
  readonly protocol?: SearchProtocol
  readonly baseURL?: string
  readonly apiKeyEnv?: string
  readonly model?: string
  readonly apiVersion?: string
  readonly maxTokens?: number
  readonly maxUses?: number
  readonly maxOutputTokens?: number
  /** Whether a live capability probe verifies each candidate before use. */
  readonly probe: boolean
  /** Bound on one probe request, in milliseconds. */
  readonly probeTimeoutMs: number
}

/** Whether an anthropic base already carries the `/v1` version segment. */
function hasV1Segment(baseURL: string): boolean {
  return /\/v1\/?$/u.test(baseURL)
}

/**
 * Normalize an anthropic-messages base so appending `/messages` reaches the
 * Messages endpoint under either base convention: the SDK-style root
 * (`https://api.anthropic.com` → `/v1/messages`) and the v1-included base
 * (`https://api.deepseek.com/anthropic/v1` → `/messages`).
 * @param baseURL - the configured or catalog base.
 * @returns the base `/messages` is appended to.
 */
export function ensureV1Base(baseURL: string): string {
  const trimmed = baseURL.replace(/\/+$/, '')
  return hasV1Segment(trimmed) ? trimmed : `${trimmed}/v1`
}

/** Hostname of a base URL, or `undefined` when unparseable. */
function hostnameOf(baseURL: string | undefined): string | undefined {
  if (baseURL === undefined) return undefined
  try {
    return new URL(baseURL).hostname
  } catch {
    return undefined
  }
}

/**
 * The search-capable sibling protocols one chat route can be asked through,
 * in preference order. A route whose own protocol can already search is
 * asked on it alone; a Chat-Completions route cannot search on that wire, so
 * the known first-party endpoints sharing the route's host are asked instead.
 * Unknown hosts yield no siblings: deriving endpoint layouts for a gateway
 * nobody knows would be guessing, and explicit configuration exists for that
 * case.
 * @param route - the current chat route facts.
 * @returns `{ protocol, baseURL }` pairs in probe order.
 */
export function siblingCandidates(route: CurrentChatRoute): readonly { protocol: SearchProtocol; baseURL: string }[] {
  if (route.api === 'openai-responses' || route.api === 'anthropic-messages') {
    return [{ protocol: route.api, baseURL: route.baseURL ?? '' }]
  }
  const base = route.baseURL?.replace(/\/+$/, '') ?? ''
  if (isDeepSeekFamily(route.provider) || hostnameOf(route.baseURL) === 'api.deepseek.com') {
    return [
      { protocol: 'openai-responses', baseURL: base.length > 0 ? base : DEFAULT_RESPONSES_BASE_URL },
      { protocol: 'anthropic-messages', baseURL: `${base.length > 0 ? base : DEFAULT_RESPONSES_BASE_URL}/anthropic/v1` },
    ]
  }
  if (route.provider === 'openai' || hostnameOf(route.baseURL) === 'api.openai.com') {
    return [{ protocol: 'openai-responses', baseURL: base.length > 0 ? base : 'https://api.openai.com/v1' }]
  }
  return []
}

/** The base URL a pinned protocol falls back to when the route cannot answer. */
function pinnedBaseURL(protocol: SearchProtocol, config: PlanConfig, route: CurrentChatRoute | undefined, ctx: Context): string {
  if (config.baseURL !== undefined && config.baseURL.length > 0) return config.baseURL
  if (route !== undefined) {
    if (protocol === 'openai-responses' && (route.api === 'openai-responses'
      || isDeepSeekFamily(route.provider) || hostnameOf(route.baseURL) === 'api.deepseek.com'
      || route.provider === 'openai' || hostnameOf(route.baseURL) === 'api.openai.com')) {
      return route.baseURL ?? DEFAULT_RESPONSES_BASE_URL
    }
    if (protocol === 'anthropic-messages' && route.api === 'anthropic-messages') {
      return route.baseURL ?? DEFAULT_ANTHROPIC_BASE_URL
    }
    if (protocol === 'anthropic-messages' && (isDeepSeekFamily(route.provider) || hostnameOf(route.baseURL) === 'api.deepseek.com')) {
      return `${route.baseURL ?? DEFAULT_RESPONSES_BASE_URL}/anthropic/v1`
    }
  }
  const ambient = launchEnvironmentOf(ctx).get(protocol === 'openai-responses' ? RESPONSES_BASE_URL_ENV : ANTHROPIC_BASE_URL_ENV)
  if (ambient !== undefined && ambient.value.length > 0) return ambient.value
  return protocol === 'openai-responses' ? DEFAULT_RESPONSES_BASE_URL : DEFAULT_ANTHROPIC_BASE_URL
}

/** Build one fully defaulted candidate from a protocol and its base. */
function buildCandidate(
  protocol: SearchProtocol,
  baseURL: string,
  route: CurrentChatRoute | undefined,
  config: PlanConfig,
): SearchPlanCandidate {
  return {
    protocol,
    baseURL: protocol === 'anthropic-messages' ? ensureV1Base(baseURL) : baseURL,
    model: config.model ?? route?.model ?? DEFAULT_MODEL,
    apiKeyEnv: config.apiKeyEnv ?? route?.apiKeyEnv ?? KNOWN_API_KEY_ENVS[route?.provider ?? ''] ?? DEFAULT_API_KEY_ENV,
    apiVersion: config.apiVersion ?? DEFAULT_API_VERSION,
    maxTokens: config.maxTokens ?? DEFAULT_MAX_TOKENS,
    maxUses: config.maxUses ?? DEFAULT_MAX_USES,
    maxOutputTokens: config.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
  }
}

/**
 * Resolve the candidate set for one plan. An explicit protocol pin yields a
 * single candidate (the user owns the endpoint); otherwise the current chat
 * route decides, with the sibling fallback above. An empty result means the
 * plugin auto-disables — nothing to probe, nothing to register.
 * @param ctx - plugin context for route detection and environment layers.
 * @param config - the currently authoritative plan config.
 * @returns the candidates in probe order.
 */
export function resolveCandidates(ctx: Context, config: PlanConfig): readonly SearchPlanCandidate[] {
  const route = currentChatRoute(ctx)
  if (config.protocol !== undefined) {
    return [buildCandidate(config.protocol, pinnedBaseURL(config.protocol, config, route, ctx), route, config)]
  }
  if (route === undefined) return []
  // A route whose protocol could not be resolved (no profile `api`, no
  // catalog entry — e.g. the legacy `deepseek-official` alias) is treated as
  // Chat Completions: that is the wire the legacy adapters speak, and it is
  // the one protocol that definitely cannot search, so the sibling probe is
  // the only path that can enable search at all. `siblingCandidates` answers
  // the search-capable route itself when its protocol can search, and the
  // host's known siblings otherwise.
  if (route.api === undefined || route.api === 'openai-completions'
    || route.api === 'openai-responses' || route.api === 'anthropic-messages') {
    return siblingCandidates(route).map(({ protocol, baseURL }) => buildCandidate(protocol, baseURL, route, config))
  }
  return []
}

/** Lifecycle state of one search plan. */
export type SearchPlanStatus = 'pending' | 'probing' | 'ready' | 'failed'

/**
 * One candidate set plus its probe lifecycle. The probe runs in the
 * background so plugin load never blocks on a provider round-trip;
 * `available()` stays synchronous and `settle()` awaits the verdict. A
 * failed plan keeps its reason so the first search (or tool call) surfaces
 * the auto-disable diagnostic instead of a bare "no provider" error.
 */
export class SearchPlan {
  readonly candidates: readonly SearchPlanCandidate[]
  /** Resolves when the probe verdict (or the immediate decision) lands. */
  readonly settled: Promise<void>

  private status: SearchPlanStatus = 'pending'
  private chosen: SearchPlanCandidate | undefined
  private reason: string | undefined

  /**
   * @param candidates - the candidates in probe order; empty disables the plan.
   * @param probe - verifies one candidate; called sequentially until one passes.
   * @param probeEnabled - when false the first candidate is trusted outright.
   */
  constructor(
    candidates: readonly SearchPlanCandidate[],
    private readonly probe: (candidate: SearchPlanCandidate) => Promise<ProbeOutcome>,
    probeEnabled: boolean,
  ) {
    this.candidates = candidates
    if (candidates.length === 0) {
      this.status = 'failed'
      this.reason = 'native web search is disabled: no search-capable provider is configured and the current chat provider could not be detected; configure a "protocol" in the web-search-provider plugin config'
      this.settled = Promise.resolve()
      return
    }
    if (!probeEnabled) {
      this.status = 'ready'
      this.chosen = candidates[0]
      this.settled = Promise.resolve()
      return
    }
    this.settled = this.runProbe()
  }

  /** Probe candidates in order; the first supported verdict wins. */
  private async runProbe(): Promise<void> {
    this.status = 'probing'
    for (const candidate of this.candidates) {
      const outcome = await this.probe(candidate)
      if (outcome.supported) {
        this.status = 'ready'
        this.chosen = candidate
        return
      }
      this.reason = outcome.detail
    }
    this.status = 'failed'
    if (this.reason === undefined) {
      this.reason = 'native web search is disabled: every candidate failed the capability probe'
    } else {
      this.reason = `native web search is disabled: ${this.reason}`
    }
  }

  /**
   * Cheap synchronous usability check for the web seam's provider selection.
   * While probing (or after a probe failure) the provider is unavailable, so
   * the seam reports a structured unavailable error rather than admitting a
   * call that cannot run.
   * @returns whether a search can currently be served.
   */
  available(): boolean {
    return this.candidates.length > 0 && this.status !== 'failed'
  }

  /**
   * Await the probe verdict and return the winning candidate.
   * @returns the candidate whose probe passed (or the first, when probing is off).
   * @throws WebError `WEB_PROVIDER_UNAVAILABLE` naming the auto-disable reason.
   */
  async settle(): Promise<SearchPlanCandidate> {
    await this.settled
    if (this.status === 'ready' && this.chosen !== undefined) return this.chosen
    throw new WebError(this.reason ?? 'native web search is unavailable', 'WEB_PROVIDER_UNAVAILABLE')
  }

  /** The candidate currently serving searches, once the plan settled on one. */
  chosenCandidate(): SearchPlanCandidate | undefined {
    return this.chosen
  }

  /** The auto-disable reason, once a probe failed (or no candidate existed). */
  failureReason(): string | undefined {
    return this.reason
  }
}

/** Whether two candidate sets are identical (skips re-probing on no-op settings changes). */
export function sameCandidates(
  left: readonly SearchPlanCandidate[],
  right: readonly SearchPlanCandidate[],
): boolean {
  if (left.length !== right.length) return false
  return left.every((candidate, index) => {
    const other = right[index]
    return other !== undefined
      && candidate.protocol === other.protocol
      && candidate.baseURL === other.baseURL
      && candidate.model === other.model
      && candidate.apiKeyEnv === other.apiKeyEnv
      && candidate.apiVersion === other.apiVersion
      && candidate.maxTokens === other.maxTokens
      && candidate.maxUses === other.maxUses
      && candidate.maxOutputTokens === other.maxOutputTokens
  })
}
