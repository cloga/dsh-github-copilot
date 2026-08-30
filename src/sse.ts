/**
 * Bounded SSE line parser for the inline wire path. Handles `event:` and
 * `data:` fields, multi-line data, CRLF, comments, and trailing events
 * without a final blank line; unknown fields are ignored and oversized
 * individual events are rejected.
 * @module dsh-web-search-provider/sse
 */

/** Upper bound on one incomplete SSE event, in bytes. */
export const MAX_SSE_EVENT_BYTES = 8 * 1024 * 1024

/** Stable error raised when one incomplete SSE event exceeds its byte bound. */
export class SseEventSizeError extends Error {
  readonly limit = MAX_SSE_EVENT_BYTES

  constructor() {
    super(`SSE event exceeded the ${MAX_SSE_EVENT_BYTES}-byte size bound`)
    this.name = 'SseEventSizeError'
  }
}

/** One parsed SSE event; `type` falls back to `message`. */
export interface SseEvent {
  readonly type: string
  readonly data: unknown
}

/**
 * Parse an SSE byte stream into typed events.
 * @param body - the response body stream.
 * @returns an async generator of parsed events.
 * @throws on invalid JSON or when one event exceeds
 * {@link MAX_SSE_EVENT_BYTES}.
 */
export async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let buffer = new Uint8Array()
  let event = ''
  let data = ''
  let pendingEventBytes = 0

  const consumeLine = (line: string): SseEvent | undefined => {
    if (line.length === 0) {
      const parsed = data.length > 0
        ? { type: event.length > 0 ? event : 'message', data: JSON.parse(data) }
        : undefined
      event = ''
      data = ''
      return parsed
    }
    if (line.startsWith('event:')) {
      event = line.slice(6).trim()
    } else if (line.startsWith('data:')) {
      data += (data.length > 0 ? '\n' : '') + line.slice(5).trimStart()
    }
    return undefined
  }

  const assertWithinBound = (): void => {
    if (pendingEventBytes > MAX_SSE_EVENT_BYTES) throw new SseEventSizeError()
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      const bytes = new Uint8Array(buffer.byteLength + value.byteLength)
      bytes.set(buffer)
      bytes.set(value, buffer.byteLength)

      let lineStart = 0
      for (let index = 0; index < bytes.byteLength; index += 1) {
        if (bytes[index] !== 0x0a) continue
        pendingEventBytes += index - lineStart + 1
        assertWithinBound()
        const line = decoder.decode(bytes.subarray(lineStart, index)).replace(/\r$/, '')
        const parsed = consumeLine(line)
        lineStart = index + 1
        if (line.length === 0) {
          pendingEventBytes = 0
          if (parsed !== undefined) yield parsed
        }
      }

      buffer = bytes.slice(lineStart)
      if (pendingEventBytes + buffer.byteLength > MAX_SSE_EVENT_BYTES) {
        throw new SseEventSizeError()
      }
    }

    if (buffer.byteLength > 0) {
      pendingEventBytes += buffer.byteLength
      assertWithinBound()
      consumeLine(decoder.decode(buffer).replace(/\r$/, ''))
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
