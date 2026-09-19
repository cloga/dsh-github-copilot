/**
 * Settings section of the inline web-search plugin: the narrow-gate switch,
 * provider whitelist, wire controls, and probe bounds. Everything is
 * configurable through the settings seam; defaults follow the chat route.
 * @module dsh-github-copilot/config
 */

import z from '@deepseek-ai/schemastery'
import { DEFAULT_REQUEST_BUDGET_POLICY } from './request-budget.ts'
import type { RequestBudgetPolicy } from './request-budget.ts'

/** Plugin configuration. Defaults make the current chat route decide. */
export interface InlineConfig {
  /** Master switch; false sends every request down the normal adapter path. */
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
  /** Verify the endpoint executes native search before serving. */
  probe: boolean
  /** Bound on one probe request, in milliseconds. */
  probeTimeoutMs: number
  /** Maximum reuse of account model metadata; credential proof guards still take precedence. */
  accountModelTtlMs?: number
  /** Minimum delay after failed passive discovery; explicit Refresh bypasses it. */
  accountModelFailureCooldownMs?: number
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
  /** Internal JSON backup of route leaves temporarily owned by the GPT-6 overlay. */
  temporaryRouteBackup?: string
}

/** Longest timer either bound may take; `setTimeout`/`AbortSignal.timeout` refuse more. */
const MAX_TIMEOUT_MS = 2_147_483_647

/** Schema of the plugin's settings section. */
export const Config: z<InlineConfig> = z.object({
  enabled: z.boolean().default(true),
  providers: z.array(z.string()).default([]),
  includeSources: z.boolean().default(true),
  stripServerTools: z.boolean().default(true),
  idleTimeoutMs: z.number().step(1).min(1).max(MAX_TIMEOUT_MS).default(300_000),
  probe: z.boolean().default(true),
  probeTimeoutMs: z.number().step(1).min(1).max(MAX_TIMEOUT_MS).default(30_000),
  accountModelTtlMs: z.number().step(1).min(0).max(MAX_TIMEOUT_MS).default(86_400_000),
  accountModelFailureCooldownMs: z.number().step(1).min(0).max(MAX_TIMEOUT_MS).default(300_000),
  requestBudgetSafetyTokens: z.number().step(1).min(0).max(Number.MAX_SAFE_INTEGER).default(DEFAULT_REQUEST_BUDGET_POLICY.safetyTokens),
  requestBudgetPressureRatio: z.number().step(0.01).min(0.01).max(1).default(DEFAULT_REQUEST_BUDGET_POLICY.pressureRatio),
  compactionReasoning: z.union(['prefer-low', 'preserve']).default(DEFAULT_REQUEST_BUDGET_POLICY.compactionReasoning),
  routeWebSearch: z.boolean().default(true),
  searchFallback: z.union(['none', 'deepseek']).default('deepseek'),
  searchModel: z.string().hidden(),
  temporaryRouteBackup: z.string().hidden(),
})
