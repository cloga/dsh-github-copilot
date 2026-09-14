import z from '@deepseek-ai/schemastery'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'

/** Plugin-owned settings namespace for cross-provider web-search routing. */
export const WEB_SEARCH_ROUTING_SETTINGS_NAMESPACE = 'github-copilot-search-routing' as SettingsNamespace

/** Sentinel that disables the default/fixed search backend. */
export const NO_DEFAULT_SEARCH_PROVIDER = 'none'

/** Cross-provider policy applied by this plugin's routed web facade. */
export interface WebSearchRoutingConfig {
  /** Auto prefers the initiating model's native search; fixed always uses the configured provider. */
  searchMode?: 'auto' | 'fixed'
  /** Registered search-provider id used by fixed mode and as auto mode's fallback. */
  defaultSearchProvider?: string
}

/** User-facing routing settings; provider-specific credentials and models remain provider-owned. */
export const WebSearchRoutingConfigSchema: z<WebSearchRoutingConfig> = z.object({
  searchMode: z.union(['auto', 'fixed']).default('auto'),
  defaultSearchProvider: z.string().default('deepseek-official'),
})
