/**
 * Shared HTTP plumbing for the capability probe and the inline wires:
 * bounded response reading, caller-cancellation races for preflight steps,
 * and the stable {@link WebError} translations. The patterns mirror the
 * harness `dsh-web` package family (web-search-deepseek, model discovery) so
 * every credentialed request rejects redirects before a `Location` target can
 * be contacted.
 * @module dsh-web-search-provider/http
 */

import { WebError } from '@deepseek-ai/dsh-web'

/**
 * Endpoint replies larger than this are refused. The endpoint is whatever
 * base URL the configuration named, so the ceiling holds on the bytes
 * actually read rather than on the length the server claims.
 */
export const MAX_RESPONSE_BYTES = 4 * 1024 * 1024

/**
 * Read a response body with a hard byte cap, refusing one that outgrows it.
 * A declared length is checked first so an honest server is turned away
 * without transferring anything; the accumulated total is what actually
 * enforces the bound, because a server that under-declares (or streams) tells
 * us nothing up front.
 * @param response - the HTTP response whose body is read to completion.
 * @param url - the requested URL, named in the refusal message.
 * @returns the decoded body text.
 * @throws WebError `WEB_PROVIDER_ERROR` when the body exceeds the cap.
 */
export async function readBounded(response: Response, url: string): Promise<string> {
  const oversized = (): WebError =>
    new WebError(`${url} answered with more than ${MAX_RESPONSE_BYTES} bytes`, 'WEB_PROVIDER_ERROR')
  const declared = Number(response.headers.get('content-length') ?? Number.NaN)
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    await response.body?.cancel()
    throw oversized()
  }
  if (response.body === null) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_RESPONSE_BYTES) throw oversized()
      chunks.push(value)
    }
  } finally {
    // Cancel after a drained read, or after this function walked away from
    // an oversized one, is cleanup; the reply is already decided either way.
    await reader.cancel().catch(() => undefined)
  }
  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  // Strict decoding, mirroring the SSE parser: invalid UTF-8 is a corrupt
  // reply and must fail the read, not be substituted into the payload.
  return new TextDecoder('utf-8', { fatal: true }).decode(body)
}

/** Whether an error is the fetch/`AbortSignal` abort signal. */
export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

/**
 * Race a same-process asynchronous preflight (credential resolution) against
 * a cancellation signal. The attached settlement handlers keep observing an
 * uncooperative operation after the race is lost, so a later rejection cannot
 * become unhandled.
 * @param operation - the preflight promise.
 * @param signal - the cancellation signal (request abort or idle watchdog).
 * @returns the operation's value, or a rejection once the signal fires.
 */
export function abortable<T>(operation: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal === undefined) return operation
  if (signal.aborted) {
    // The caller will not await the operation; keep observing it so a later
    // rejection cannot become unhandled.
    operation.then(() => undefined, () => undefined)
    return Promise.reject(new DOMException('aborted', 'AbortError'))
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(new DOMException('aborted', 'AbortError'))
    signal.addEventListener('abort', onAbort, { once: true })
    operation.then((value) => {
      signal.removeEventListener('abort', onAbort)
      resolve(value)
    }, (error: unknown) => {
      signal.removeEventListener('abort', onAbort)
      reject(error)
    })
  })
}

/**
 * Extract a provider error message from an error envelope whose shape varies
 * by protocol and vendor: `{ error: { message } }`, `{ error: "text" }`, or
 * `{ message }`. Returns `undefined` when nothing usable is present.
 * @param body - the parsed non-2xx response body.
 * @returns the provider message, or `undefined`.
 */
export function providerErrorMessage(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const record = body as Record<string, unknown>
  const error = record['error']
  if (typeof error === 'string' && error.length > 0) return error
  if (typeof error === 'object' && error !== null) {
    const message = (error as Record<string, unknown>)['message']
    if (typeof message === 'string' && message.length > 0) return message
  }
  const message = record['message']
  return typeof message === 'string' && message.length > 0 ? message : undefined
}
