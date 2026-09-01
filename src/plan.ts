/**
 * Search-plan resolution: which protocol and endpoint native search runs
 * through. The current chat route (default-model selection plus the
 * `llm-pi-ai` settings section) is detected and probed — its own protocol
 * when that can search. The {@link SearchPlan} class owns the probe lifecycle so
 * `available()` stays synchronous while the verdict lands in the background.
 * @module dsh-github-copilot/plan
 */

import { WebError } from '@deepseek-ai/dsh-web'
import type { Context } from '@deepseek-ai/cordis'
import type { ProbeOutcome } from './probe.ts'
import { currentChatRoute } from './current-provider.ts'
import type { CurrentChatRoute } from './current-provider.ts'

/** The two search-capable wire protocols this package speaks. */
export type SearchProtocol = 'openai-responses' | 'anthropic-messages'

/** Credential record that owns GitHub Copilot OAuth state and refresh. */
export const GITHUB_COPILOT_CREDENTIAL_KEY = 'llm-pi-ai/github-copilot'

/** Default `anthropic-version` header value. */
export const DEFAULT_API_VERSION = '2023-06-01'

/**
 * The server-side Responses web tool spellings. The standard `web_search`
 * is the preferred Copilot spelling; `web_search_2025_08_26` is retained as
 * a probe fallback for provider-side protocol variation.
 */
export type ResponsesWebSearchToolType = 'web_search' | 'web_search_2025_08_26'

/** Standard server-side web search tool type (OpenAI/DeepSeek official). */
export const WEB_SEARCH_TOOL_TYPE: ResponsesWebSearchToolType = 'web_search'

/**
 * Versioned Responses spelling retained as a capability-probe fallback.
 */
export const RESPONSES_WEB_SEARCH_TOOL_TYPE: ResponsesWebSearchToolType = 'web_search_2025_08_26'

/** Anthropic server-side web search tool type (versioned). */
export const ANTHROPIC_WEB_SEARCH_TOOL_TYPE = 'web_search_20250305'

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
  /** Static provider/model headers inherited from pi-ai's catalog. */
  readonly headers?: Readonly<Record<string, string | null>>
  /**
   * The Responses web tool spelling this candidate serves with (probe-verified;
   * openai-responses only). The probe may settle on the fallback spelling, in
   * which case the chosen candidate carries the verified one.
   */
  readonly webSearchToolType?: ResponsesWebSearchToolType
}

/** The plugin-config fields the plan reads; `apply` projects the full section onto this. */
export interface PlanConfig {
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

/**
 * Return the selected Copilot model's native search protocol. No endpoint or
 * cross-provider sibling is guessed.
 * @param route - the current chat route facts.
 * @returns the single native candidate, or none for an unsupported route.
 */
export function siblingCandidates(
  route: CurrentChatRoute,
): readonly { protocol: SearchProtocol; baseURL: string }[] {
  if (route.provider !== 'github-copilot') return []
  const base = route.baseURL?.replace(/\/+$/, '') ?? ''
  if (base.length === 0) return []
  if (route.api === 'openai-responses' || route.api === 'anthropic-messages') {
    return [{ protocol: route.api, baseURL: base }]
  }
  if (route.supportedApis?.includes('openai-responses') === true) {
    return [{ protocol: 'openai-responses', baseURL: base }]
  }
  return []
}

/** Build one fully defaulted candidate from a protocol and its base. */
function buildCandidate(
  protocol: SearchProtocol,
  baseURL: string,
  route: CurrentChatRoute,
): SearchPlanCandidate {
  return {
    protocol,
    baseURL: protocol === 'anthropic-messages' ? ensureV1Base(baseURL) : baseURL,
    model: route.model,
    apiKeyEnv: GITHUB_COPILOT_CREDENTIAL_KEY,
    apiVersion: DEFAULT_API_VERSION,
    ...route.headers === undefined ? {} : { headers: route.headers },
    ...protocol === 'openai-responses'
      ? { webSearchToolType: WEB_SEARCH_TOOL_TYPE }
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
export function resolveCandidates(ctx: Context, _config: PlanConfig): readonly SearchPlanCandidate[] {
  const route = currentChatRoute(ctx)
  if (route === undefined || route.provider !== 'github-copilot') return []
  // A route whose protocol could not be resolved (no profile `api`, no
  // catalog entry — e.g. the legacy `deepseek-official` alias) is treated as
  // Chat Completions: that is the wire the legacy adapters speak, and it is
  // the one protocol that definitely cannot search, so the sibling probe is
  // the only path that can enable search at all. `siblingCandidates` answers
  // the search-capable route itself when its protocol can search, and the
  // host's known siblings otherwise.
  if (route.api === undefined || route.api === 'openai-completions'
    || route.api === 'openai-responses' || route.api === 'anthropic-messages') {
    return siblingCandidates(route).map(({ protocol, baseURL }) => buildCandidate(protocol, baseURL, route))
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
      this.reason = 'GitHub Copilot hosted search is unavailable: select an account-available github-copilot model whose pi-ai catalog protocol is openai-responses or anthropic-messages'
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
      && JSON.stringify(candidate.headers) === JSON.stringify(other.headers)
      && candidate.webSearchToolType === other.webSearchToolType
  })
}
