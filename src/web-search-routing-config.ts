import z from '@deepseek-ai/schemastery'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import type { WebSearchRoutingConfig } from './search-routing-policy.ts'
export { normalizeWebSearchRouting } from './search-routing-policy.ts'
export type { WebSearchRoutingConfig, NormalizedWebSearchRouting } from './search-routing-policy.ts'

/** Plugin-owned settings namespace for cross-provider web-search routing. */
export const WEB_SEARCH_ROUTING_SETTINGS_NAMESPACE = 'github-copilot-search-routing' as SettingsNamespace

/** Sentinel that disables the default/fixed search backend. */
export const NO_DEFAULT_SEARCH_PROVIDER = 'none'

/** User-facing routing settings; provider-specific credentials and models remain provider-owned. */
export const WebSearchRoutingConfigSchema: z<WebSearchRoutingConfig> = z.object({
  searchProvider: z.string(),
  searchMode: z.union(['auto', 'fixed']).default('auto'),
  defaultSearchProvider: z.string().default('deepseek-official'),
})
