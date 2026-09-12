import { WebError } from '@deepseek-ai/dsh-web'
import type { WebSearchProvider, WebSearchRequest, WebSearchResult } from '@deepseek-ai/dsh-web'
import { GITHUB_COPILOT_PROVIDER_ID, GITHUB_COPILOT_PREVIEW_PROVIDER_ID } from './copilot-identity.ts'
import { GITHUB_COPILOT_HOSTED_SEARCH_PROVIDER_ID } from './traditional-search.ts'
import { describeSearchBackend, DescribedSearchFallbackError } from './search-backend.ts'

/** Explicit cross-provider spending policy; disabled unless the operator selects DeepSeek. */
export type SearchFallback = 'none' | 'deepseek'

/** Selection captured from the initiating request, never from a global default. */
export interface SearchSelection {
  readonly provider: string
  readonly model: string
}

/** Public, non-secret provenance retained outside the canonical WebSearchResult. */
export interface SearchRouting {
  readonly requestedProvider: 'github-copilot-hosted'
  readonly actualProvider: 'github-copilot-hosted' | 'deepseek-official'
  readonly model: string
  readonly fallback: boolean
  readonly reason?: string
}

/** Delegated results have no plugin provenance and retain their original object identity. */
export interface RoutedSearchResult {
  readonly result: WebSearchResult
  readonly routing?: SearchRouting
}

/** Operation-local dependencies; providers must be owned instances, not private-registry lookups. */
export interface SessionSearchDependencies {
  readonly selection: SearchSelection | undefined
  readonly managedOwned: boolean
  readonly fallback: SearchFallback
  readonly copilot: WebSearchProvider
  readonly delegate: (request: WebSearchRequest, signal?: AbortSignal) => Promise<WebSearchResult>
  readonly resolveDeepSeek: () => Promise<WebSearchProvider>
  /** Recheck captured owner/account generation after every asynchronous boundary. */
  readonly canContinue: () => boolean
}

/** Match only the canonical route or a verified plugin-owned managed route. */
export function isCopilotSearchSelection(selection: SearchSelection | undefined, managedOwned: boolean): boolean {
  return selection?.provider === GITHUB_COPILOT_PROVIDER_ID
    || (selection?.provider === GITHUB_COPILOT_PREVIEW_PROVIDER_ID && managedOwned)
}

function assertContinuable(signal: AbortSignal | undefined, canContinue: () => boolean): void {
  if (signal?.aborted === true) throw new WebError('web search aborted', 'WEB_ABORTED')
  if (!canContinue()) throw new WebError('web search owner or account proof invalidated', 'WEB_PROVIDER_UNAVAILABLE')
}

/** Public reason codes only: never copy upstream bodies, headers or arbitrary exception messages. */
function publicFailureReason(error: unknown): string {
  if (error instanceof WebError && ['WEB_PROVIDER_UNAVAILABLE', 'WEB_PROVIDER_ERROR', 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE', 'WEB_PROVIDER_CONFIGURED_MISSING'].includes(error.code)) {
    return error.code
  }
  return 'COPILOT_SEARCH_FAILED'
}

/**
 * Route one already-validated search using captured request identity.
 * Non-Copilot calls delegate untouched. Copilot failures reach a known DeepSeek
 * provider only under the explicit spending policy; cancellation and invalidated
 * ownership never trigger fallback. Consumer validation, batching and deadlines
 * remain the caller's responsibility, not this provider-selection function.
 */
export async function routeSessionSearch(
  request: WebSearchRequest,
  signal: AbortSignal | undefined,
  deps: SessionSearchDependencies,
): Promise<RoutedSearchResult> {
  if (!isCopilotSearchSelection(deps.selection, deps.managedOwned)) {
    return { result: await deps.delegate(request, signal) }
  }
  const model = deps.selection!.model
  const allowFallback = deps.fallback === 'deepseek'
  assertContinuable(signal, deps.canContinue)
  if (deps.copilot.id !== GITHUB_COPILOT_HOSTED_SEARCH_PROVIDER_ID) {
    throw new WebError('plugin-owned Copilot search provider is required', 'WEB_PROVIDER_UNAVAILABLE')
  }
  let failure: unknown
  try {
    if (!deps.copilot.available()) {
      throw new WebError('Copilot search is unavailable for this initiating model', 'WEB_PROVIDER_UNAVAILABLE')
    }
    const result = await deps.copilot.search(request, signal)
    assertContinuable(signal, deps.canContinue)
    return {
      result,
      routing: { requestedProvider: GITHUB_COPILOT_HOSTED_SEARCH_PROVIDER_ID, actualProvider: GITHUB_COPILOT_HOSTED_SEARCH_PROVIDER_ID, model, fallback: false },
    }
  } catch (error) {
    assertContinuable(signal, deps.canContinue)
    if (error instanceof WebError && error.code === 'WEB_ABORTED') throw error
    if (!allowFallback) throw error
    failure = error
  }

  const fallback = await deps.resolveDeepSeek()
  assertContinuable(signal, deps.canContinue)
  if (fallback.id !== 'deepseek-official' || !fallback.available()) {
    throw new WebError('the explicitly requested DeepSeek fallback is unavailable', 'WEB_PROVIDER_UNAVAILABLE')
  }
  const reason = publicFailureReason(failure)
  let result: WebSearchResult
  try {
    result = await fallback.search(request, signal)
  } catch (error) {
    assertContinuable(signal, deps.canContinue)
    if (error instanceof WebError && error.code === 'WEB_ABORTED') throw error
    const backend = error instanceof DescribedSearchFallbackError && error.backend !== undefined
      ? ` ${describeSearchBackend(error.backend)}` : ''
    throw new WebError(`Copilot search failed (${reason}); DeepSeek fallback also failed and may have incurred DeepSeek API charges (or configured backend charges).${backend}`, 'WEB_PROVIDER_ERROR')
  }
  assertContinuable(signal, deps.canContinue)
  const notice = `Search provider: deepseek-official (explicit fallback from github-copilot-hosted; reason: ${reason}). This fallback may incur DeepSeek API charges (or charges from a configured custom backend). These are not Copilot search results.`
  return {
    result: { ...result, content: `${notice}\n\n${result.content ?? ''}`.trimEnd() },
    routing: { requestedProvider: GITHUB_COPILOT_HOSTED_SEARCH_PROVIDER_ID, actualProvider: 'deepseek-official', model, fallback: true, reason },
  }
}
