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

/** Exact-id dispatch over providers registered through the routed facade. */
export type ProviderSearch = (
  providerId: string, request: WebSearchRequest, signal?: AbortSignal,
) => Promise<WebSearchResult>

/** Host-owned router; credentials and provider implementation objects stay inside the facade. */
export interface GitHubCopilotSearchRouter {
  search(
    request: WebSearchRequest,
    signal: AbortSignal | undefined,
    delegate: NativeSearch,
    selectProvider?: ProviderSearch,
  ): Promise<WebSearchResult>
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
  private readonly mirroredSearchProviders = new Map<string, WebSearchProvider>()

  constructor(ctx: Context, config: WebRuntimeConfig = {}) {
    super(ctx, config)
    this.bounded = new WebRuntime(ctx.isolate('web'), { searchProvider: 'copilot-session-search' })
    this.bounded.registerSearchProvider({
      id: 'copilot-session-search',
      available: () => !this.lifetime.signal.aborted,
      search: (request, signal) => {
        const router = ctx.get('githubCopilotSearchRouter')
        if (router === undefined) throw new WebError('Copilot session search routing is not ready', 'WEB_PROVIDER_UNAVAILABLE')
        return router.search(
          request,
          signal,
          (query, querySignal) => ctx.githubCopilotOriginalWeb.search(query, querySignal),
          (providerId, query, querySignal) => this.searchWithProvider(providerId, query, querySignal),
        )
      },
    })
    ctx.effect(() => async () => {
      this.lifetime.abort()
      await Promise.allSettled(this.pending)
      this.mirroredSearchProviders.clear()
    })
  }

  private disposedError(): WebError {
    return new WebError('Copilot search service was disposed', 'WEB_PROVIDER_UNAVAILABLE')
  }

  private searchWithProvider(
    providerId: string, request: WebSearchRequest, signal?: AbortSignal,
  ): Promise<WebSearchResult> {
    const provider = this.mirroredSearchProviders.get(providerId)
    if (provider === undefined) {
      return Promise.reject(new WebError(`configured web provider "${providerId}" is not registered`, 'WEB_PROVIDER_CONFIGURED_MISSING'))
    }
    if (!provider.available()) {
      return Promise.reject(new WebError(`configured web provider "${providerId}" is registered but unavailable`, 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE'))
    }
    return provider.search(request, signal)
  }

  override registerSearchProvider(provider: WebSearchProvider): () => void {
    if (this.lifetime.signal.aborted) throw this.disposedError()
    const disposeOriginal = this.ctx.githubCopilotOriginalWeb.registerSearchProvider(provider)
    const providers = this.mirroredSearchProviders
    const disposeMirror = this.ctx.effect(function* () {
      providers.set(provider.id, provider)
      yield () => {
        if (providers.get(provider.id) === provider) providers.delete(provider.id)
      }
    }, 'github-copilot.search-provider-mirror')
    return () => {
      disposeMirror()
      disposeOriginal()
    }
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
    // Preserve the stock web path when the router has not activated. Copilot
    // requests remain fail-closed; unrelated models keep working during partial load.
    if (!isCopilotSearchSelection(selection, owned) && this.ctx.get('githubCopilotSearchRouter') === undefined) {
      return this.ctx.githubCopilotOriginalWeb.search(request, signal)
    }
    const boundSignal = AbortSignal.any([...signal === undefined ? [] : [signal], this.lifetime.signal])
    const operation = this.bounded.search(request, boundSignal)
    this.pending.add(operation)
    void operation.then(() => this.pending.delete(operation), () => this.pending.delete(operation))
    return operation
  }
}
