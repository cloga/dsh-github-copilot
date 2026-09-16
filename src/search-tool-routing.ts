import { WebError } from '@deepseek-ai/dsh-web'
import type { WebSearchRequest, WebSearchResult } from '@deepseek-ai/dsh-web'

/** An already selected, operation-owned search entry; availability remains its owner's responsibility. */
export interface SearchToolProvider {
  readonly id: string
  search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult>
}

/** Captured policy for one primary attempt and at most one distinct final fallback. */
export interface SearchToolRoutingDependencies {
  readonly primary?: SearchToolProvider | undefined
  readonly fallback?: SearchToolProvider | undefined
  /** False, or a thrown error, revokes this operation without permitting fallback. */
  readonly canContinue: () => boolean
  /** Legacy failure-spending control; does not prevent fallback when no primary was resolved. */
  readonly allowFailureFallback?: boolean
}

function aborted(): WebError {
  return new WebError('web search aborted', 'WEB_ABORTED')
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true
}

function assertContinuable(signal: AbortSignal | undefined, canContinue: () => boolean): void {
  if (isAborted(signal)) throw aborted()
  let current = false
  try { current = canContinue() }
  catch { /* A failed ownership check cannot authorize another provider request. */ }
  // The ownership callback may itself observe cancellation; recheck the live signal.
  if (isAborted(signal)) throw aborted()
  if (!current) throw new WebError('web search owner or account proof invalidated', 'WEB_PROVIDER_UNAVAILABLE')
}

function isCancellation(error: unknown): boolean {
  return error instanceof WebError && error.code === 'WEB_ABORTED'
    || error instanceof Error && error.name === 'AbortError'
}

/** Only shared public codes may leave the provider boundary; messages, causes and custom codes stay private. */
function failureCode(error: unknown): string {
  if (error instanceof WebError && [
    'WEB_PROVIDER_CONFIGURED_MISSING', 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE',
    'WEB_PROVIDER_UNAVAILABLE', 'WEB_PROVIDER_ERROR', 'WEB_PROVIDER_AMBIGUOUS',
  ].includes(error.code)) return error.code
  return 'WEB_PROVIDER_ERROR'
}

/**
 * Execute a captured primary and optional final fallback without registry or credential access.
 * The caller resolves Auto, handles disabled policy, proves registrations and supplies lifetime guards.
 * Generic providers must honor the signal; this helper cannot inspect their internal auth/HTTP boundary.
 */
export async function routeSearchTools(
  request: WebSearchRequest,
  signal: AbortSignal | undefined,
  deps: SearchToolRoutingDependencies,
): Promise<WebSearchResult> {
  const { primary, fallback, canContinue, allowFailureFallback = true } = deps
  // Snapshot dispatch functions and ids before awaiting, retaining their owning receiver.
  const primaryId = primary?.id
  const primarySearch = primary?.search.bind(primary)
  const fallbackId = fallback?.id
  const fallbackSearch = fallback?.search.bind(fallback)
  assertContinuable(signal, canContinue)

  let primaryFailure: unknown
  if (primarySearch !== undefined) {
    let result: WebSearchResult
    try {
      result = await primarySearch(request, signal)
    } catch (error) {
      assertContinuable(signal, canContinue)
      if (isCancellation(error)) throw aborted()
      primaryFailure = error
      if (!allowFailureFallback || fallbackSearch === undefined || fallbackId === primaryId) {
        throw new WebError(`Search provider ${JSON.stringify(primaryId)} failed (${failureCode(error)}).`, failureCode(error))
      }
      // Only provider rejection authorizes the final fallback. Empty sources are a success.
      return runFallback()
    }
    assertContinuable(signal, canContinue)
    return result
  }
  return runFallback()

  async function runFallback(): Promise<WebSearchResult> {
    assertContinuable(signal, canContinue)
    if (fallbackSearch === undefined) {
      throw new WebError('no selected search provider is available', 'WEB_PROVIDER_UNAVAILABLE')
    }
    const reason = primarySearch === undefined ? 'no matching primary provider' : failureCode(primaryFailure)
    const notice = `Search provider: ${JSON.stringify(fallbackId)} (final fallback${primaryId === undefined ? '' : ` from ${JSON.stringify(primaryId)}`}; reason: ${reason}). This fallback may incur charges from the selected search backend.`
    let result: WebSearchResult
    try {
      result = await fallbackSearch(request, signal)
    } catch (error) {
      assertContinuable(signal, canContinue)
      if (isCancellation(error)) throw aborted()
      throw new WebError(`${notice} The final fallback failed (${failureCode(error)}).`, 'WEB_PROVIDER_ERROR')
    }
    assertContinuable(signal, canContinue)
    return { ...result, content: `${notice}\n\n${result.content ?? ''}`.trimEnd() }
  }
}
