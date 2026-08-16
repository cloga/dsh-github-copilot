/**
 * Settings section of the inline web-search plugin: the narrow-gate switch,
 * provider whitelist, wire controls, and probe bounds. Everything is
 * configurable through the settings seam; defaults follow the chat route.
 * @module dsh-web-search-provider/config
 */

import z from '@deepseek-ai/schemastery'

/** Plugin configuration. Defaults make the current chat route decide. */
export interface InlineConfig {
  /** Master switch; false sends every request down the normal adapter path. */
  enabled: boolean
  /**
   * Provider whitelist (llm-pi-ai route keys). Empty = follow the current
   * chat route, whose candidates decide whether the plugin can serve.
   */
  providers: string[]
  /** Endpoint base override; `/responses` or `/messages` is appended. Default: from route. */
  baseURL?: string
  /** Model override; used by the probe and by the served wire request. */
  model?: string
  /** Credential reference; defaults to the route's reference. */
  apiKeyEnv?: string
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
}

/** Longest timer either bound may take; `setTimeout`/`AbortSignal.timeout` refuse more. */
const MAX_TIMEOUT_MS = 2_147_483_647

/** Schema of the plugin's settings section. */
export const Config: z<InlineConfig> = z.object({
  enabled: z.boolean().default(true),
  providers: z.array(z.string()).default([]),
  baseURL: z.string(),
  model: z.string(),
  apiKeyEnv: z.string().role('credential-ref'),
  includeSources: z.boolean().default(true),
  stripServerTools: z.boolean().default(true),
  idleTimeoutMs: z.number().step(1).min(1).max(MAX_TIMEOUT_MS).default(300_000),
  probe: z.boolean().default(true),
  probeTimeoutMs: z.number().step(1).min(1).max(MAX_TIMEOUT_MS).default(30_000),
})
