import type { Context } from '@deepseek-ai/cordis'
import { WebError, WebRuntime } from '@deepseek-ai/dsh-web'
import type { WebRuntimeConfig, WebSearchRequest, WebSearchResult, WebSearchProvider, WebFetchProvider, WebFetchRequest, WebFetchResult } from '@deepseek-ai/dsh-web'
import type {} from './web-delegate.ts'
import { currentSearchInitiator, currentSearchSelection } from './current-provider.ts'
import { GITHUB_COPILOT_PREVIEW_PROVIDER_ID } from './copilot-identity.ts'
import { isPluginPreviewProvider } from './model-protocol.ts'
import { isCopilotSearchSelection } from './search-routing.ts'

/** Parent dispatch captured from the exact WebRuntime instance serving this call. */
export type NativeSearch = (request: WebSearchRequest, signal?: AbortSignal) => Promise<WebSearchResult>

/** Host-owned router; no credentials or private provider registry cross this service. */
export interface GitHubCopilotSearchRouter {
  search(request: WebSearchRequest, signal: AbortSignal | undefined, delegate: NativeSearch): Promise<WebSearchResult>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    githubCopilotSearchRouter: GitHubCopilotSearchRouter
  }
}

/**
 * Plugin-owned WebRuntime facade. The bundle isolates, but does not reconfigure,
 * the original official service. Normal search, fetch and registrations delegate
 * through its public APIs. A second private official WebRuntime supplies the same
 * validation/source cap for the Copilot branch. No Core prototypes or private
 * registries are read or changed.
 */
export default class CopilotRoutedWeb extends WebRuntime {
  static inject = ['githubCopilotOriginalWeb']
  private readonly bounded: WebRuntime
  private readonly lifetime = new AbortController()
  private readonly pending = new Set<Promise<WebSearchResult>>()

  constructor(ctx: Context, config: WebRuntimeConfig = {}) {
    super(ctx, config)
    this.bounded = new WebRuntime(ctx.isolate('web'), { searchProvider: 'copilot-session-search' })
    this.bounded.registerSearchProvider({
      id: 'copilot-session-search',
      available: () => !this.lifetime.signal.aborted,
      search: (request, signal) => {
        const router = ctx.get('githubCopilotSearchRouter')
        if (router === undefined) throw new WebError('Copilot session search routing is not ready', 'WEB_PROVIDER_UNAVAILABLE')
        return router.search(request, signal, (query, querySignal) => ctx.githubCopilotOriginalWeb.search(query, querySignal))
      },
    })
    ctx.effect(() => async () => {
      this.lifetime.abort()
      await Promise.allSettled(this.pending)
    })
  }

  private disposedError(): WebError {
    return new WebError('Copilot search service was disposed', 'WEB_PROVIDER_UNAVAILABLE')
  }

  override registerSearchProvider(provider: WebSearchProvider): () => void {
    if (this.lifetime.signal.aborted) throw this.disposedError()
    return this.ctx.githubCopilotOriginalWeb.registerSearchProvider(provider)
  }

  override registerFetchProvider(provider: WebFetchProvider): () => void {
    if (this.lifetime.signal.aborted) throw this.disposedError()
    return this.ctx.githubCopilotOriginalWeb.registerFetchProvider(provider)
  }

  override fetch(request: WebFetchRequest, signal?: AbortSignal): Promise<WebFetchResult> {
    if (this.lifetime.signal.aborted) return Promise.reject(this.disposedError())
    return this.ctx.githubCopilotOriginalWeb.fetch(request, signal)
  }

  override search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    if (this.lifetime.signal.aborted) return Promise.reject(this.disposedError())
    const selection = currentSearchSelection(currentSearchInitiator(this.ctx))
    const owned = selection?.provider === GITHUB_COPILOT_PREVIEW_PROVIDER_ID
      && isPluginPreviewProvider(this.ctx, selection.provider)
    if (!isCopilotSearchSelection(selection, owned)) return this.ctx.githubCopilotOriginalWeb.search(request, signal)
    const boundSignal = AbortSignal.any([...signal === undefined ? [] : [signal], this.lifetime.signal])
    const operation = this.bounded.search(request, boundSignal)
    this.pending.add(operation)
    void operation.then(() => this.pending.delete(operation), () => this.pending.delete(operation))
    return operation
  }
}
