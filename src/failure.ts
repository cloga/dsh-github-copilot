/**
 * Failure classification for the inline wire path. The codes must land in
 * the harness vocabulary dsh-llm-retry understands (AUTH, RATE_LIMIT,
 * INVALID_REQUEST, SERVER, TIMEOUT, TRANSPORT, QUOTA,
 * CONTEXT_WINDOW_EXCEEDED, UNKNOWN) so the standard retry policy applies.
 * Also owns the finish-chunk constructors the two wires share.
 * @module dsh-web-search-provider/failure
 */

import type { LlmFailure, StreamChunk } from '@deepseek-ai/dsh-llm'

/**
 * Classify a non-OK HTTP response into the harness failure vocabulary.
 * @param status - the HTTP status code.
 * @param retryAfterMs - optional provider-requested delay in milliseconds.
 * @param requestId - optional provider request id for diagnostics.
 * @param apiLabel - the API family named in the diagnostic, e.g. `Messages API`.
 * @returns the failure object for a finish chunk.
 */
export function classifyHttpStatus(status: number, retryAfterMs?: number, requestId?: string, apiLabel = 'Responses API'): LlmFailure {
  const code = status === 401 || status === 403
    ? 'AUTH'
    : status === 429
      ? 'RATE_LIMIT'
      : status === 400
        ? 'INVALID_REQUEST'
        : status === 408
          ? 'TIMEOUT'
          : status >= 500
            ? 'SERVER'
            : 'UNKNOWN'
  return {
    message: `${apiLabel} error (HTTP ${status})`,
    code,
    ...retryAfterMs !== undefined ? { providerRetryAfterMs: retryAfterMs } : {},
    ...requestId !== undefined ? { requestId: requestId as LlmFailure['requestId'] } : {},
  }
}

/**
 * Parse an HTTP `Retry-After` header value into milliseconds. Only a
 * non-negative seconds integer is accepted; an HTTP-date or any other value
 * yields `undefined` rather than a `NaN` delay.
 * @param retryAfter - the raw header value, or `null` when absent.
 * @returns the delay in milliseconds, or `undefined`.
 */
export function parseRetryAfterMs(retryAfter: string | null): number | undefined {
  if (retryAfter === null) return undefined
  const seconds = Number(retryAfter)
  if (!Number.isFinite(seconds) || seconds < 0) return undefined
  return Math.round(seconds * 1000)
}

/**
 * Classify a transport-level error (fetch throw, timeout, malformed body)
 * into the harness failure vocabulary.
 * @param error - the thrown value.
 * @returns the failure object for a finish chunk.
 */
export function classifyWireError(error: unknown): LlmFailure {
  const message = error instanceof Error ? error.message : String(error)
  const text = message.toLowerCase()
  if (text.includes('timeout') || text.includes('timed out')) return { message, code: 'TIMEOUT' }
  if (text.includes('context') && text.includes('window')) return { message, code: 'CONTEXT_WINDOW_EXCEEDED' }
  if (text.includes('quota')) return { message, code: 'QUOTA' }
  if (/(network|socket|connect|fetch failed|stream ended|econnreset|econnrefused|enotfound|undici)/u.test(text)) {
    return { message, code: 'TRANSPORT' }
  }
  return { message, code: 'UNKNOWN' }
}

/** The finish chunk for any failure; the generator never throws it. */
export function errorFinish(failure: LlmFailure): StreamChunk {
  return { type: 'finish', reason: { kind: 'error', failure } }
}

/** The finish chunk for a caller-aborted request. */
export function abortedFinish(): StreamChunk {
  return { type: 'finish', reason: { kind: 'aborted', failure: { message: 'aborted', code: 'ABORTED' } } }
}
