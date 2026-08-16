/**
 * Bounded SSE line parser for the inline wire path. Handles `event:` and
 * `data:` fields, multi-line data, CRLF, comments, and trailing events
 * without a final blank line; unknown fields are ignored and oversize
 * streams are rejected.
 * @module dsh-web-search-provider/sse
 */

/** Upper bound on one SSE stream, in bytes. */
export const MAX_SSE_BYTES = 8 * 1024 * 1024

/** One parsed SSE event; `type` falls back to `message`. */
export interface SseEvent {
  readonly type: string
  readonly data: unknown
}

/**
 * Parse an SSE byte stream into typed events.
 * @param body - the response body stream.
 * @returns an async generator of parsed events.
 * @throws on invalid JSON or when the stream exceeds {@link MAX_SSE_BYTES}.
 */
export async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = body.getReader()
  // Strict decoding: an invalid UTF-8 byte is a corrupt stream and must fail
  // the parse, never be silently substituted into the payload.
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let buffer = ''
  let event = ''
  let data = ''
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_SSE_BYTES) throw new Error('SSE stream exceeded the size bound')
      buffer += decoder.decode(value, { stream: true })
      let newline: number
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, '')
        buffer = buffer.slice(newline + 1)
        if (line.length === 0) {
          if (data.length > 0) {
            yield { type: event.length > 0 ? event : 'message', data: JSON.parse(data) }
            event = ''
            data = ''
          }
        } else if (line.startsWith('event:')) {
          event = line.slice(6).trim()
        } else if (line.startsWith('data:')) {
          data += (data.length > 0 ? '\n' : '') + line.slice(5).trimStart()
        }
      }
    }
    // EOF flush: a truncated multi-byte sequence must fail here (fatal
    // decoder), never be dropped silently; completed trailing characters
    // join the final line processing below.
    buffer += decoder.decode()
    if (buffer.length > 0) {
      const line = buffer.replace(/\r$/, '')
      if (line.length === 0) {
        // A final blank line means the event was already emitted above.
      } else if (line.startsWith('event:')) {
        event = line.slice(6).trim()
      } else if (line.startsWith('data:')) {
        data += (data.length > 0 ? '\n' : '') + line.slice(5).trimStart()
      }
    }
    if (data.length > 0) {
      yield { type: event.length > 0 ? event : 'message', data: JSON.parse(data) }
    }
  } finally {
    // Cancel the reader so an abandoned stream (early finish, consumer
    // return) releases the connection instead of holding it open with
    // backpressure. cancel() releases the lock, so no releaseLock follows.
    await reader.cancel().catch(() => undefined)
  }
}
