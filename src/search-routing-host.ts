/** Read-only search catalog bridge; no credentials, availability probes or writes. */
import { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { SearchProviderCatalogSchema } from './search-routing-remote.ts'
import type { SearchProviderCatalog } from './search-routing-remote.ts'

export interface SearchProviderDirectory {
  /** Fresh IDs from facade-owned registrations, not a process-wide registry. */
  list(): readonly string[]
}
declare module '@deepseek-ai/cordis' {
  interface Context {
    githubCopilotSearchCatalog: SearchProviderDirectory
    githubCopilotSearchRouting: SearchRoutingController
  }
}

export default class SearchRoutingController extends TypertRemoteService {
  constructor(ctx: Context) { super(ctx, 'githubCopilotSearchRouting') }

  @Remote
  providers(): SearchProviderCatalog {
    const unavailable: SearchProviderCatalog = { supported: false, providers: [] }
    const catalog = this.ctx.get('githubCopilotSearchCatalog')
    if (typeof catalog?.list !== 'function') return unavailable
    try {
      const ids = catalog.list()
      const parsed = SearchProviderCatalogSchema.safeParse({ supported: true, providers: ids.map(id => ({ id })) })
      if (!parsed.success || new Set(ids).size !== ids.length) return unavailable
      parsed.data.providers.sort((a, b) => a.id.localeCompare(b.id))
      return parsed.data
    } catch { return unavailable }
  }
}
