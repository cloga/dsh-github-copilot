/** Shared Client-safe settings shape; provider credentials and models remain provider-owned. */
export interface WebSearchRoutingConfig {
  /** Auto follows the initiating Chat provider; a concrete id pins the primary, and none disables search. */
  searchProvider?: string
  /** Legacy primary selection; used only when searchProvider has not been explicitly saved. */
  searchMode?: 'auto' | 'fixed'
  /** Final fallback provider id, or none; legacy fixed mode also uses this id as its primary. */
  defaultSearchProvider?: string
}

/** Operation-local normalized policy; reading legacy settings never migrates them on disk. */
export interface NormalizedWebSearchRouting {
  readonly primaryProvider: string
  readonly defaultProvider: string
  readonly legacy: boolean
}

/** Resolve old and new settings without guessing registered providers or dropping unknown ids. */
export function normalizeWebSearchRouting(config: WebSearchRoutingConfig): NormalizedWebSearchRouting {
  const defaultProvider = config.defaultSearchProvider?.trim() || 'deepseek-official'
  const legacy = config.searchProvider === undefined
  return {
    primaryProvider: legacy
      ? config.searchMode === 'fixed' ? defaultProvider : 'auto'
      : config.searchProvider?.trim() || 'auto',
    defaultProvider,
    legacy,
  }
}
