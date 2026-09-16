import type { Context } from '@deepseek-ai/cordis'
import { WebError, WebRuntime } from '@deepseek-ai/dsh-web'
import type { WebRuntimeConfig, WebSearchRequest, WebSearchResult, WebSearchProvider, WebFetchProvider, WebFetchRequest, WebFetchResult } from '@deepseek-ai/dsh-web'
import type {} from './web-delegate.ts'
import type {} from './search-routing-host.ts'
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

/** Captured facade registration; no provider implementation object crosses the Client boundary. */
export interface CapturedSearchProvider {
  readonly id: string
  readonly signal: AbortSignal
  current(): boolean
  /** Identity proof for a router-owned provider, never an inference from its id. */
  owns(provider: WebSearchProvider): boolean
  search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult>
}

/** Resolve one registered id synchronously before the routing operation starts awaiting. */
export type CaptureSearchProvider = (providerId: string) => CapturedSearchProvider | undefined

interface SearchRegistration {
  readonly provider: WebSearchProvider
  readonly cancellation: AbortController
}

/** Host-owned router; credentials and provider implementation objects stay inside the facade. */
export interface GitHubCopilotSearchRouter {
  search(
    request: WebSearchRequest,
    signal: AbortSignal | undefined,
    delegate: NativeSearch,
    selectProvider?: ProviderSearch,
    captureSearchProvider?: CaptureSearchProvider,
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
  private readonly mirroredSearchProviders = new Map<string, SearchRegistration>()

  constructor(ctx: Context, config: WebRuntimeConfig = {}) {
    super(ctx, config)
    // Registration IDs only. Availability depends on the initiating search and
    // must not hide providers merely because Settings has no Chat initiator.
    ctx.provide('githubCopilotSearchCatalog', { list: () => [...this.mirroredSearchProviders.keys()] })
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
          providerId => this.captureSearchProvider(providerId),
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
    const provider = this.captureSearchProvider(providerId)
    if (provider === undefined) {
      return Promise.reject(new WebError(`configured web provider "${providerId}" is not registered`, 'WEB_PROVIDER_CONFIGURED_MISSING'))
    }
    return provider.search(request, signal)
  }

  private captureSearchProvider(providerId: string): CapturedSearchProvider | undefined {
    const entry = this.mirroredSearchProviders.get(providerId)
    if (entry === undefined) return undefined
    const signal = AbortSignal.any([this.lifetime.signal, entry.cancellation.signal])
    const current = () => !signal.aborted && this.mirroredSearchProviders.get(providerId) === entry
    const available = entry.provider.available.bind(entry.provider)
    const search = entry.provider.search.bind(entry.provider)
    return {
      id: providerId, signal, current,
      owns: provider => current() && entry.provider === provider,
      search: async (request, callerSignal) => {
        const boundSignal = AbortSignal.any([signal, ...callerSignal === undefined ? [] : [callerSignal]])
        const assertCurrent = () => {
          if (boundSignal.aborted) throw new WebError('web search aborted', 'WEB_ABORTED')
          if (!current()) throw new WebError('web search provider registration invalidated', 'WEB_PROVIDER_UNAVAILABLE')
        }
        assertCurrent()
        try {
          const usable = available()
          assertCurrent()
          if (!usable) throw new WebError(`configured web provider "${providerId}" is registered but unavailable`, 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE')
          const result = await search(request, boundSignal)
          assertCurrent()
          return result
        } catch (error) {
          assertCurrent()
          throw error
        }
      },
    }
  }

  override registerSearchProvider(provider: WebSearchProvider): () => void {
    if (this.lifetime.signal.aborted) throw this.disposedError()
    const disposeOriginal = this.ctx.githubCopilotOriginalWeb.registerSearchProvider(provider)
    const providers = this.mirroredSearchProviders
    const providerId = provider.id
    const entry: SearchRegistration = { provider, cancellation: new AbortController() }
    const disposeMirror = this.ctx.effect(function* () {
      providers.set(providerId, entry)
      yield () => {
        entry.cancellation.abort()
        if (providers.get(providerId) === entry) providers.delete(providerId)
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
