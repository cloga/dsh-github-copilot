/**
 * Search-plan resolution: which protocol and endpoint native search runs
 * through. The current chat route (default-model selection plus the
 * `llm-pi-ai` settings section) is detected and probed — its own protocol
 * when that can search, the known search-capable sibling protocols of its
 * host otherwise. The {@link SearchPlan} class owns the probe lifecycle so
 * `available()` stays synchronous while the verdict lands in the background.
 * @module dsh-web-search-provider/plan
 */

import { WebError } from '@deepseek-ai/dsh-web'
import type { Context } from '@deepseek-ai/cordis'
import type { ProbeOutcome } from './probe.ts'
import { currentChatRoute } from './current-provider.ts'
import type { CurrentChatRoute } from './current-provider.ts'

/** The two search-capable wire protocols this package speaks. */
export type SearchProtocol = 'openai-responses' | 'anthropic-messages'

/** Default credential reference when neither config nor route names one. */
export const DEFAULT_API_KEY_ENV = 'DEEPSEEK_API_KEY'

/** Default Responses base URL (DeepSeek first-party; `/responses` is appended). */
export const DEFAULT_RESPONSES_BASE_URL = 'https://api.deepseek.com'

/** Default `anthropic-version` header value. */
export const DEFAULT_API_VERSION = '2023-06-01'

/**
 * The server-side Responses web tool spellings. The standard `web_search`
 * is the OpenAI/DeepSeek-official default; `web_search_2025_08_26` is the
 * versioned spelling OpenCode Go-style gateways require. The probe tries the
 * candidate's primary spelling first and falls back to the other, so unknown
 * gateway endpoints self-adapt.
 */
export type ResponsesWebSearchToolType = 'web_search' | 'web_search_2025_08_26'

/** Standard server-side web search tool type (OpenAI/DeepSeek official). */
export const WEB_SEARCH_TOOL_TYPE: ResponsesWebSearchToolType = 'web_search'

/**
 * Versioned spelling required by OpenCode Go (opencode.ai) and similar
 * gateways that parse tools as function-like entries keyed by `name` and
 * drop a nameless `web_search`.
 */
export const RESPONSES_WEB_SEARCH_TOOL_TYPE: ResponsesWebSearchToolType = 'web_search_2025_08_26'

/** Anthropic server-side web search tool type (versioned). */
export const ANTHROPIC_WEB_SEARCH_TOOL_TYPE = 'web_search_20250305'

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
  /**
   * The Responses web tool spelling this candidate serves with (probe-verified;
   * openai-responses only). The probe may settle on the fallback spelling, in
   * which case the chosen candidate carries the verified one.
   */
  readonly webSearchToolType?: ResponsesWebSearchToolType
}

/** The plugin-config fields the plan reads; `apply` projects the full section onto this. */
export interface PlanConfig {
  readonly baseURL?: string
  readonly apiKeyEnv?: string
  readonly model?: string
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

/** Whether a base belongs to the OpenCode Go family, which needs the versioned spelling. */
function isOpenCodeHost(baseURL: string): boolean {
  const hostname = hostnameOf(baseURL)
  return hostname !== undefined && (hostname === 'opencode.ai' || hostname.endsWith('.opencode.ai'))
}

/**
 * The search-capable sibling protocols one chat route can be asked through,
 * in preference order. A route whose own protocol can already search is
 * asked on it alone; a Chat-Completions route cannot search on that wire, so
 * the known first-party endpoints sharing the route's host are asked instead.
 * Unknown hosts yield no siblings: deriving endpoint layouts for a gateway
 * nobody knows would be guessing. To enable such a gateway, declare its
 * search-capable api (openai-responses or anthropic-messages) in the
 * llm-pi-ai route profile — the plan then derives that route's own protocol
 * as its single candidate, and baseURL/model/apiKeyEnv overrides apply.
 * @param route - the current chat route facts.
 * @param baseOverride - optional configured base replacing the route's own.
 * @returns `{ protocol, baseURL }` pairs in probe order.
 */
export function siblingCandidates(
  route: CurrentChatRoute,
  baseOverride?: string,
): readonly { protocol: SearchProtocol; baseURL: string }[] {
  const base = (baseOverride ?? route.baseURL)?.replace(/\/+$/, '') ?? ''
  if (route.api === 'openai-responses' || route.api === 'anthropic-messages') {
    return [{ protocol: route.api, baseURL: base }]
  }
  if (isDeepSeekFamily(route.provider) || hostnameOf(baseOverride ?? route.baseURL) === 'api.deepseek.com') {
    // Chat-Completions bases conventionally end in `/v1` (DeepSeek accepts
    // both https://api.deepseek.com and …/v1); the search endpoints live at
    // the host root, so the suffix is stripped before deriving them.
    const chatBase = base.replace(/\/v1$/u, '')
    return [
      { protocol: 'openai-responses', baseURL: chatBase.length > 0 ? chatBase : DEFAULT_RESPONSES_BASE_URL },
      { protocol: 'anthropic-messages', baseURL: `${chatBase.length > 0 ? chatBase : DEFAULT_RESPONSES_BASE_URL}/anthropic/v1` },
    ]
  }
  if (route.provider === 'openai' || hostnameOf(baseOverride ?? route.baseURL) === 'api.openai.com') {
    return [{ protocol: 'openai-responses', baseURL: base.length > 0 ? base : 'https://api.openai.com/v1' }]
  }
  return []
}

/** Build one fully defaulted candidate from a protocol and its base. */
function buildCandidate(
  protocol: SearchProtocol,
  baseURL: string,
  route: CurrentChatRoute,
  config: PlanConfig,
): SearchPlanCandidate {
  return {
    protocol,
    baseURL: protocol === 'anthropic-messages' ? ensureV1Base(baseURL) : baseURL,
    // `route.model` is always present (the selection names one); only the
    // config override can replace it.
    model: config.model ?? route.model,
    apiKeyEnv: config.apiKeyEnv ?? route.apiKeyEnv ?? KNOWN_API_KEY_ENVS[route.provider] ?? DEFAULT_API_KEY_ENV,
    apiVersion: DEFAULT_API_VERSION,
    // OpenAI-standard semantics by default; only OpenCode Go hosts get the
    // versioned spelling up front (the probe still falls back for unknown
    // gateway-style endpoints).
    ...protocol === 'openai-responses'
      ? { webSearchToolType: isOpenCodeHost(baseURL) ? RESPONSES_WEB_SEARCH_TOOL_TYPE : WEB_SEARCH_TOOL_TYPE }
      : {},
  }
}

/**
 * Resolve the candidate set for one plan from the current chat route. An
 * empty result means the plugin auto-disables — nothing to probe, nothing to
 * register.
 * @param ctx - plugin context for route detection.
 * @param config - the currently authoritative plan config.
 * @returns the candidates in probe order.
 */
export function resolveCandidates(ctx: Context, config: PlanConfig): readonly SearchPlanCandidate[] {
  const route = currentChatRoute(ctx)
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
    return siblingCandidates(route, config.baseURL).map(({ protocol, baseURL }) => buildCandidate(protocol, baseURL, route, config))
  }
  return []
}

/** Lifecycle state of one search plan. */
export type SearchPlanStatus = 'probing' | 'ready' | 'failed'

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

  private status: SearchPlanStatus
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
      this.reason = 'native web search is disabled: no search-capable provider is configured and the current chat provider could not be detected; make the default model selection resolvable, declare a search-capable "api" (openai-responses or anthropic-messages) for the chat route in the llm-pi-ai settings profile, or switch to a provider with known search-capable endpoints'
      this.settled = Promise.resolve()
      return
    }
    if (!probeEnabled) {
      this.status = 'ready'
      this.chosen = candidates[0]
      this.settled = Promise.resolve()
      return
    }
    this.status = 'probing'
    this.settled = this.runProbe()
  }

  /** Probe candidates in order; the first supported verdict wins. */
  private async runProbe(): Promise<void> {
    for (const candidate of this.candidates) {
      let outcome: ProbeOutcome
      try {
        outcome = await this.probe(candidate)
      } catch (error) {
        // A crashing probe must not reject `settled`: listeners never await
        // the plan, and a rejected promise here would be unhandled.
        outcome = { supported: false, detail: `probe crashed: ${String(error)}` }
      }
      if (outcome.supported) {
        this.status = 'ready'
        // The probe may have passed on the FALLBACK spelling; the wire must
        // send exactly the spelling that was verified, so the chosen
        // candidate carries the verified value.
        this.chosen = outcome.webSearchToolType !== undefined && outcome.webSearchToolType !== candidate.webSearchToolType
          ? { ...candidate, webSearchToolType: outcome.webSearchToolType }
          : candidate
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
   * Cheap synchronous usability check for the listener gate. While probing
   * the plan is PROVISIONALLY available — the first gated request may enter
   * and await {@link settle} — so the probe verdict and the stream start in
   * parallel; only a failed (or candidate-less) plan is unavailable and keeps
   * the request on the normal adapter path.
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
      && candidate.webSearchToolType === other.webSearchToolType
  })
}
