/**
 * SSE parser tests: event framing, multi-line data, CRLF, comments, unknown
 * events, size bounds, and trailing events without a blank line.
 */

import { describe, expect, it, vi } from 'vitest'
import { MAX_SSE_EVENT_BYTES, parseSse } from '../../src/sse.ts'

function streamOf(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text))
      controller.close()
    },
  })
}

async function collect(text: string): Promise<Array<{ type: string; data: unknown }>> {
  const events: Array<{ type: string; data: unknown }> = []
  for await (const event of parseSse(streamOf(text))) events.push(event)
  return events
}

describe('parseSse', () => {
  it('parses one event with default type', async () => {
    const events = await collect('data: {"a":1}\n\n')
    expect(events).toEqual([{ type: 'message', data: { a: 1 } }])
  })

  it('parses named events', async () => {
    const events = await collect('event: response.completed\ndata: {"ok":true}\n\n')
    expect(events[0]).toEqual({ type: 'response.completed', data: { ok: true } })
  })

  it('joins multi-line data with newlines', async () => {
    const events = await collect('data: {"a":\ndata: 1}\n\n')
    expect(events).toEqual([{ type: 'message', data: { a: 1 } }])
  })

  it('handles CRLF line endings', async () => {
    const events = await collect('event: ping\r\ndata: {}\r\n\r\n')
    expect(events[0]).toEqual({ type: 'ping', data: {} })
  })

  it('skips comment lines and unknown fields', async () => {
    const events = await collect(': keepalive\nfoo: bar\ndata: {"x":1}\n\n')
    expect(events).toEqual([{ type: 'message', data: { x: 1 } }])
  })

  it('emits a trailing event without a final blank line', async () => {
    const events = await collect('event: response.created\ndata: {"x":2}')
    expect(events[0]).toEqual({ type: 'response.created', data: { x: 2 } })
  })

  it('throws on invalid JSON', async () => {
    await expect(collect('data: not-json\n\n')).rejects.toThrow()
  })

  it('allows cumulative stream bytes past the bound across valid events', async () => {
    const payload = 'x'.repeat(4096)
    const text = Array.from({ length: 2049 }, (_, index) =>
      `data: ${JSON.stringify({ index, payload })}\n\n`).join('')
    const events = await collect(text)
    expect(events).toHaveLength(2049)
    expect((events.at(-1)?.data as { index: number }).index).toBe(2048)
  })

  it('resets pending byte accounting at blank-line event boundaries', async () => {
    const first = `data: ${JSON.stringify('a'.repeat(5 * 1024 * 1024))}\n\n`
    const second = `data: ${JSON.stringify('b'.repeat(4 * 1024 * 1024))}\n\n`
    await expect(collect(first + second)).resolves.toHaveLength(2)
  })

  it('throws when one incomplete event exceeds the size bound', async () => {
    const big = `data: ${JSON.stringify('a'.repeat(MAX_SSE_EVENT_BYTES))}`
    await expect(collect(big)).rejects.toThrow(
      `SSE event exceeded the ${MAX_SSE_EVENT_BYTES}-byte size bound`,
    )
  })
})

describe('parseSse cancellation', () => {
  it('cancels the underlying stream when iteration stops early', async () => {
    let cancelled = false
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"a":1}\n\n'))
        controller.enqueue(new TextEncoder().encode('data: {"b":2}\n\n'))
      },
      cancel() {
        cancelled = true
      },
    })
    const events: Array<{ type: string; data: unknown }> = []
    for await (const event of parseSse(stream)) {
      events.push(event)
      break
    }
    expect(events).toHaveLength(1)
    expect(cancelled).toBe(true)
  })

  it('rejects invalid UTF-8 bytes instead of substituting them', async () => {
    // 0xff is invalid UTF-8. Inside a JSON string a lenient decoder would
    // substitute U+FFFD and the payload would still parse — silently
    // corrupting it — so the parser must fail on the raw byte.
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"a":"'))
        controller.enqueue(new Uint8Array([0xff]))
        controller.enqueue(new TextEncoder().encode('"}\n\n'))
        controller.close()
      },
    })
    await expect(async () => {
      for await (const _event of parseSse(stream)) { /* drain */ }
    }).rejects.toThrow()
  })

  it('rejects a truncated UTF-8 sequence left at end of stream', async () => {
    // 0xe4 0xb8 is the first two bytes of a three-byte character: at EOF the
    // decoder must flush and fail, not silently drop the tail bytes.
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"a":1}\n\n'))
        controller.enqueue(new Uint8Array([0xe4, 0xb8]))
        controller.close()
      },
    })
    await expect(async () => {
      for await (const _event of parseSse(stream)) { /* drain */ }
    }).rejects.toThrow()
  })
})
