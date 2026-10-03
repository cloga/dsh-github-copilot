/**
 * Settings for managed account requests and inline hosted search, including
 * separate stream bounds. Credentials and model transport remain native-owned.
 * @module dsh-github-copilot/config
 */

import z from '@deepseek-ai/schemastery'
import { DEFAULT_REQUEST_BUDGET_POLICY } from './request-budget.ts'
import type { RequestBudgetPolicy } from './request-budget.ts'
import { WebSearchRoutingConfigSchema } from './web-search-routing-config.ts'
import type { WebSearchRoutingConfig } from './web-search-routing-config.ts'
import { readConfigValue } from './settings-reader.ts'
import type { LiveSetting } from './settings-reader.ts'
import type { ParentModelBinding } from './parent-model-follow.ts'

/** Plugin configuration. Defaults make the current chat route decide. */
export interface InlineConfig {
  /** Hosted-search switch; managed chat requests remain enabled. */
  enabled: boolean
  /**
   * Provider whitelist (llm-pi-ai route keys). Empty = follow the current
   * chat route, whose candidates decide whether the plugin can serve.
   */
  providers: string[]
  /** Append `include: ['web_search_call.action.sources']` to wire requests. */
  includeSources: boolean
  /** Strip function-tool variants of the server-side web tools from the wire. */
  stripServerTools: boolean
  /** Idle bound for one inline request, in milliseconds. */
  idleTimeoutMs: number
  /** Managed chat byte-idle interval; separate from hosted search. */
  chatStreamIdleTimeoutMs?: number
  /** Enable bounded HTTP byte-aware liveness without fabricated assistant progress. */
  chatStreamLiveness?: boolean
  /** Native request image projection budget; changing it can offload older images. */
  chatMaxRequestImageBytes?: number
  /** Verify the endpoint executes native search before serving. */
  probe: boolean
  /** Bound on one probe request, in milliseconds. */
  probeTimeoutMs: number
  /** Maximum reuse of account model metadata; credential proof guards still take precedence. */
  accountModelTtlMs?: number
  /** Minimum delay after failed passive discovery; explicit Refresh bypasses it. */
  accountModelFailureCooldownMs?: number
  /** Exact account model IDs hidden from the managed directory and every Auto candidate pool. */
  excludedModelIds?: string[]
  /** Explicit native child/direct-parent enrollments; empty preserves native routing. */
  parentModelFollow?: ParentModelBinding[]
  /** Profile-wide next-turn policy for supported native children. */
  followParentModel?: boolean
  /** Default-on bounded task assessment; explicit false opts out of auxiliary inference. */
  autoSemanticAssessment?: boolean
  /** Estimated managed-route input headroom, separate from truthful catalog capacities. */
  requestBudgetSafetyTokens?: number
  /** Fraction of admissible input used by eligible automatic-compaction requests. */
  requestBudgetPressureRatio?: number
  /** Supported low effort only for summary calls with no already resolved effort. */
  compactionReasoning?: RequestBudgetPolicy['compactionReasoning']
  /** Route the official web-search consumer by initiating Session when the bundle isolate is mounted. */
  routeWebSearch?: boolean
  /** Automatic fallback, disclosed in results; no per-search approval dialog. */
  searchFallback?: 'none' | 'deepseek'
  /** Optional authoritative legacy override; otherwise hosted search resolves bounded account-owned candidates independently of Chat. */
  searchModel?: string
  /** Provider routing folded into this plugin entry on current Core releases. */
  searchRouting?: WebSearchRoutingConfig
  /** Internal JSON backup of route leaves temporarily owned by the GPT-6 overlay. */
  temporaryRouteBackup?: string
}

export type LiveInlineConfig = Omit<InlineConfig, 'searchModel' | 'searchRouting' | 'temporaryRouteBackup' | 'excludedModelIds' | 'parentModelFollow' | 'followParentModel'> & {
  followParentModel?: boolean | LiveSetting<boolean>
  parentModelFollow?: ParentModelBinding[] | LiveSetting<ArrayLike<ParentModelBinding>>
  excludedModelIds?: string[] | LiveSetting<ArrayLike<string>>
  searchModel?: string | LiveSetting<string | undefined>
  searchRouting?: WebSearchRoutingConfig | LiveSetting<WebSearchRoutingConfig | undefined>
  temporaryRouteBackup?: string | LiveSetting<string | undefined>
}

export type ResolvedInlineConfig = Omit<InlineConfig, 'searchModel' | 'searchRouting' | 'temporaryRouteBackup' | 'excludedModelIds' | 'parentModelFollow' | 'followParentModel'> & {
  followParentModel: LiveSetting<boolean>
  parentModelFollow: LiveSetting<ArrayLike<ParentModelBinding>>
  excludedModelIds: LiveSetting<ArrayLike<string>>
  searchModel: LiveSetting<string | undefined>
  searchRouting: LiveSetting<WebSearchRoutingConfig>
  temporaryRouteBackup: LiveSetting<string | undefined>
}

/** Keep native live references at the boundary; request code consumes plain snapshots. */
export function readInlineConfig(config: LiveInlineConfig): InlineConfig {
  const exclusions = readConfigValue<ArrayLike<string> | undefined>(config.excludedModelIds)
  const bindings = readConfigValue<ArrayLike<ParentModelBinding> | undefined>(config.parentModelFollow)
  return {
    ...config,
    excludedModelIds: exclusions === undefined ? undefined : Array.from(exclusions),
    parentModelFollow: bindings === undefined ? undefined : Array.from(bindings, binding => ({
      childSessionId: binding.childSessionId, parentSessionId: binding.parentSessionId,
    })),
    followParentModel: readConfigValue(config.followParentModel),
    searchModel: readConfigValue(config.searchModel),
    searchRouting: readConfigValue(config.searchRouting),
    temporaryRouteBackup: readConfigValue(config.temporaryRouteBackup),
  }
}

/** Longest timer either bound may take; `setTimeout`/`AbortSignal.timeout` refuse more. */
const MAX_TIMEOUT_MS = 2_147_483_647

/** Schema of the plugin's settings section. */
export const Config: z<Partial<InlineConfig>, ResolvedInlineConfig> = z.object({
  enabled: z.boolean().default(true),
  providers: z.array(z.string()).default([]),
  includeSources: z.boolean().default(true),
  stripServerTools: z.boolean().default(true),
  idleTimeoutMs: z.number().step(1).min(1).max(MAX_TIMEOUT_MS).default(300_000),
  chatStreamIdleTimeoutMs: z.number().step(1).min(1).max(MAX_TIMEOUT_MS).default(300_000),
  chatStreamLiveness: z.boolean().default(true),
  chatMaxRequestImageBytes: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(20_971_520),
  probe: z.boolean().default(true),
  probeTimeoutMs: z.number().step(1).min(1).max(MAX_TIMEOUT_MS).default(30_000),
  accountModelTtlMs: z.number().step(1).min(0).max(MAX_TIMEOUT_MS).default(86_400_000),
  accountModelFailureCooldownMs: z.number().step(1).min(0).max(MAX_TIMEOUT_MS).default(300_000),
  excludedModelIds: z.array(z.string()).default([]).hidden().volatile(),
  followParentModel: z.boolean().default(false).volatile(),
  autoSemanticAssessment: z.boolean().default(true),
  parentModelFollow: z.array(z.object({
    childSessionId: z.string().min(1), parentSessionId: z.string().min(1),
  })).default([]).hidden().volatile(),
  requestBudgetSafetyTokens: z.number().step(1).min(0).max(Number.MAX_SAFE_INTEGER).default(DEFAULT_REQUEST_BUDGET_POLICY.safetyTokens),
  requestBudgetPressureRatio: z.number().step(0.01).min(0.01).max(1).default(DEFAULT_REQUEST_BUDGET_POLICY.pressureRatio),
  compactionReasoning: z.union(['prefer-low', 'preserve']).default(DEFAULT_REQUEST_BUDGET_POLICY.compactionReasoning),
  routeWebSearch: z.boolean().default(true),
  searchFallback: z.union(['none', 'deepseek']).default('deepseek'),
  searchModel: z.string().hidden().volatile(),
  searchRouting: WebSearchRoutingConfigSchema.default({}).volatile(),
  temporaryRouteBackup: z.string().hidden().volatile(),
})
