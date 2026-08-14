/**
 * Register the native web-search provider in `ctx.web`. One provider serves
 * both search-capable protocols — the OpenAI Responses API `web_search`
 * server tool (with its `search` / `open_page` / `find_in_page` actions) and
 * the Anthropic-compatible Messages API `web_search_20250305` server tool —
 * chosen and verified against the provider the harness currently chats with.
 * An explicit config pin always wins; otherwise the current chat route is
 * detected and probed, and the plugin auto-disables when nothing answers.
 * @module dsh-web-search-provider
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-agent'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-web'
import { DEFAULT_API_VERSION, DEFAULT_MAX_TOKENS, DEFAULT_MAX_USES } from './anthropic.ts'
import { probeCandidate } from './probe.ts'
import { NativeSearchProvider } from './provider.ts'
import type { NativeSearchProviderHooks } from './provider.ts'
import { applyNativeTools } from './tools.ts'
import { DEFAULT_MAX_OUTPUT_TOKENS, resolveCandidates, sameCandidates, SearchPlan } from './plan.ts'
import type { PlanConfig, SearchPlanCandidate } from './plan.ts'
import type { SearchLlmRequest } from './types.ts'

export { WEB_SEARCH_PROVIDER_ID, NativeSearchProvider } from './provider.ts'
export type { NativeSearchProviderHooks } from './provider.ts'
export { applyNativeTools, formatBrowseOutput } from './tools.ts'
export { ensureV1Base, resolveCandidates, sameCandidates, SearchPlan } from './plan.ts'
export type { PlanConfig, SearchPlanCandidate, SearchPlanStatus, SearchProtocol } from './plan.ts'
export { runResponsesSearch, mapResponsesSearchResult, sourcesFromAnnotations, buildResponsesSearchBody, openPageInstruction, findInPageInstruction } from './responses.ts'
export type { ResponsesSearchOptions, ResponsesSearchInput, WebSearchAction } from './responses.ts'
export { runAnthropicSearch, mapAnthropicResponse, citationSnippets, buildAnthropicSearchBody } from './anthropic.ts'
export type { AnthropicSearchOptions } from './anthropic.ts'
export { probeCandidate } from './probe.ts'
export type { ProbeOutcome } from './probe.ts'
export { currentChatRoute } from './current-provider.ts'
export type { CurrentChatRoute } from './current-provider.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-provider'

/** Services the plugin registers into: the web seam, the tool registry, and prompt guidance. */
export const inject = ['web', 'tools', 'systemPrompt']

/** Default bound on one capability-probe request, in milliseconds. */
export const DEFAULT_PROBE_TIMEOUT_MS = 30_000

/** Default cooperative tool-call timeout budget (ms) for the browsing tools. */
export const DEFAULT_TOOL_TIMEOUT_MS = 60_000

/** Plugin config. Everything is optional: the current chat provider decides defaults. */
export interface Config {
  /**
   * Explicit protocol pin. When set, search always runs through this
   * protocol and the current chat provider is never consulted; when unset,
   * the current chat route (and its search-capable siblings) is detected and
   * probed.
   */
  protocol?: 'openai-responses' | 'anthropic-messages'
  /**
   * Endpoint base for the pinned protocol (`/responses` or `/messages` is
   * appended). Requires {@link protocol}: without a pin the endpoint layout
   * is derived from the current chat route.
   */
  baseURL?: string
  /** Literal API key; prefer {@link apiKeyEnv} so no secret enters configuration. */
  apiKey?: string
  /**
   * Credential reference resolved for each search through the credentials
   * seam. Defaults to the current chat route's reference, then to a known
   * per-provider variable, then to `DEEPSEEK_API_KEY`.
   */
  apiKeyEnv?: string
  /** Model name for the search request. Defaults to the current chat route's model. */
  model?: string
  /** `anthropic-version` header value (anthropic-messages). Defaults to `2023-06-01`. */
  apiVersion?: string
  /** Upper bound on generated tokens for a Messages search. Defaults to 4096. */
  maxTokens?: number
  /** Maximum `web_search` server-tool uses per Messages request. Defaults to 5. */
  maxUses?: number
  /** Upper bound on generated tokens for a Responses search. Defaults to 4096. */
  maxOutputTokens?: number
  /**
   * Verify the endpoint truly executes native web search with one bounded
   * request before serving. Defaults to true; set false to trust the
   * protocol and endpoint declaration.
   */
  probe?: boolean
  /** Bound on one probe request, in milliseconds. Defaults to 30000. */
  probeTimeoutMs?: number
  /** Cooperative timeout budget (ms) for `open_page` / `find_in_page`. Defaults to 60000. */
  timeoutMs?: number
  /** Which Responses-only browsing tools to register. */
  tools?: {
    /** Register `open_page`. Defaults to true. */
    openPage?: boolean
    /** Register `find_in_page`. Defaults to true. */
    findInPage?: boolean
  }
}

/**
 * Schema of the plugin's settings section; the documented defaults live on
 * {@link Config} so a configuration surface renders them.
 */
export const Config: z<Config> = z.object({
  protocol: z.union(['openai-responses', 'anthropic-messages']),
  // Declared here rather than only at the use site: a configuration surface
  // renders the resolved section, so a default the schema does not carry
  // reads there as no value at all.
  baseURL: z.string(),
  apiKey: z.string().role('secret'),
  apiKeyEnv: z.string().role('credential-ref'),
  model: z.string(),
  apiVersion: z.string().default(DEFAULT_API_VERSION),
  maxTokens: z.number().step(1).min(1).default(DEFAULT_MAX_TOKENS),
  maxUses: z.number().step(1).min(1).default(DEFAULT_MAX_USES),
  maxOutputTokens: z.number().step(1).min(1).default(DEFAULT_MAX_OUTPUT_TOKENS),
  probe: z.boolean().default(true),
  probeTimeoutMs: z.number().step(1).min(1).default(DEFAULT_PROBE_TIMEOUT_MS),
  timeoutMs: z.number().step(1).min(1).default(DEFAULT_TOOL_TIMEOUT_MS),
  tools: z.object({
    openPage: z.boolean().default(true),
    findInPage: z.boolean().default(true),
  }).default({ openPage: true, findInPage: true }),
})

/** Settings namespace carrying this plugin's section (endpoint, model, probe switches). */
export const WEB_SEARCH_PROVIDER_SETTINGS_NAMESPACE = settingsNamespace('web-search-provider')

/** Project the resolved section onto the plan's config subset. */
function projectConfig(config: Config): PlanConfig {
  return {
    ...config.protocol === undefined ? {} : { protocol: config.protocol },
    ...config.baseURL === undefined ? {} : { baseURL: config.baseURL },
    ...config.apiKeyEnv === undefined ? {} : { apiKeyEnv: config.apiKeyEnv },
    ...config.model === undefined ? {} : { model: config.model },
    apiVersion: config.apiVersion ?? DEFAULT_API_VERSION,
    maxTokens: config.maxTokens ?? DEFAULT_MAX_TOKENS,
    maxUses: config.maxUses ?? DEFAULT_MAX_USES,
    maxOutputTokens: config.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    probe: config.probe ?? true,
    probeTimeoutMs: config.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS,
  }
}

/**
 * Register the native search provider and the Responses-only browsing tools.
 * The plan (candidates plus probe verdict) is rebuilt when the settings
 * section changes; the provider and tools read the CURRENT plan per
 * operation, so a committed change reaches the next search without a
 * restart and never splits an in-flight one.
 * @param ctx - context whose `web`, `tools`, and `systemPrompt` services
 *   receive the registrations; all are effect-scoped and unregister on dispose.
 * @param config - the composition entry config, used as the settings base layer.
 */
export function apply(ctx: Context, config: Config): void {
  let current: () => Config = () => config
  let currentPlan: SearchPlan
  let toolsDisposer: (() => void) | undefined
  let syncedKey: string | undefined

  const hooks: NativeSearchProviderHooks = {
    apiKeyOf: () => current().apiKey,
    resolveApiKey: async (apiKeyEnv) => {
      const credentials = ctx.get('credentials')
      if (credentials !== undefined) return (await credentials.resolve(credentialRef(apiKeyEnv)))?.value
      // Without the seam the environment is the whole credential plane.
      const ambient = launchEnvironmentOf(ctx).get(apiKeyEnv)
      return ambient !== undefined && ambient.value.length > 0 ? ambient.value : undefined
    },
    recordRequest: (request: SearchLlmRequest) => {
      ctx.get('agents')?.currentInitiator()?.session.append('web/search-native-llm-request', request)
    },
  }

  function buildPlan(entry: Config): SearchPlan {
    const planConfig = projectConfig(entry)
    const candidates = resolveCandidates(ctx, planConfig)
    return new SearchPlan(
      candidates,
      (candidate: SearchPlanCandidate) => probeCandidate(candidate, hooks.resolveApiKey, planConfig.probeTimeoutMs),
      planConfig.probe,
    )
  }

  /**
   * Register or withdraw the browsing tools to match the CURRENT plan and
   * section: they exist only while the plan serves the Responses protocol,
   * and their timeout and enable flags come from the section. The key guards
   * against re-registering on a probe that changed nothing.
   */
  function syncTools(): void {
    const entry = current()
    const key = `${currentPlan.chosenCandidate()?.protocol ?? 'none'}|${String(entry.timeoutMs)}|${String(entry.tools?.openPage)}|${String(entry.tools?.findInPage)}`
    if (syncedKey === key) return
    toolsDisposer?.()
    toolsDisposer = undefined
    syncedKey = key
    if (currentPlan.chosenCandidate()?.protocol !== 'openai-responses') return
    toolsDisposer = applyNativeTools(ctx, {
      planOf: () => currentPlan,
      apiKeyOf: hooks.apiKeyOf,
      resolveApiKey: hooks.resolveApiKey,
      ...hooks.recordRequest === undefined ? {} : { recordRequest: hooks.recordRequest },
      timeoutMs: entry.timeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS,
      openPage: entry.tools?.openPage ?? true,
      findInPage: entry.tools?.findInPage ?? true,
    })
  }

  /** Rebuild the plan when the section changed; re-probe only when the candidates moved. */
  function refresh(): void {
    const next = buildPlan(current())
    if (!sameCandidates(next.candidates, currentPlan.candidates)) {
      currentPlan = next
      syncTools()
      // The first probe verdict may land later; re-sync when it does.
      void next.settled.then(() => {
        if (currentPlan === next) {
          syncTools()
          reportPlan(next)
        }
      })
      return
    }
    // The plan is unchanged, but the timeout or tool-enable flags may have
    // moved; the sync key makes this a no-op when nothing relevant changed.
    syncTools()
  }

  /** Announce the plan's verdict so an auto-disable is visible in the boot log. */
  function reportPlan(plan: SearchPlan): void {
    void plan.settled.then(() => {
      const chosen = plan.chosenCandidate()
      if (chosen === undefined) {
        ctx.logger.warn('[web-search-provider] %s', plan.failureReason() ?? 'native web search is disabled')
        return
      }
      ctx.logger.info(
        '[web-search-provider] serving native web search through %s at %s (model %s, key %s)',
        chosen.protocol,
        chosen.baseURL,
        chosen.model,
        chosen.apiKeyEnv,
      )
    })
  }

  // The initial plan is built here (not only through the settings hook) so
  // the plugin works identically when no settings service is mounted; the
  // settings hook below may then replace it synchronously.
  currentPlan = buildPlan(config)
  installSettingsSection(ctx, WEB_SEARCH_PROVIDER_SETTINGS_NAMESPACE, Config, config, {
    setSource: (source) => {
      current = source
    },
    onChange: refresh,
    validate: (value) => {
      if (value.baseURL !== undefined && value.baseURL.length > 0 && value.protocol === undefined) {
        throw new Error('web-search-provider: "baseURL" requires an explicit "protocol"')
      }
    },
  })
  const initial = currentPlan
  ctx.web.registerSearchProvider(new NativeSearchProvider(() => currentPlan, hooks))
  syncTools()
  reportPlan(initial)
  void initial.settled.then(() => {
    if (currentPlan === initial) {
      syncTools()
      reportPlan(initial)
    }
  })
}
