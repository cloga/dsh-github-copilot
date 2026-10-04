import { afterEach, describe, expect, it, vi } from 'vitest'
import { CopilotStreamIdleError, CopilotStreamLiveness } from '../src/copilot-stream-liveness.ts'

afterEach(() => vi.useRealTimers())

describe('managed HTTP stream liveness', () => {
  it.each([0, -1, 0.5, NaN, Infinity, 2_147_483_648])('rejects an invalid timer interval %s', timeout => {
    expect(() => new CopilotStreamLiveness(timeout, new AbortController().signal))
      .toThrow('COPILOT_STREAM_IDLE_INTERVAL_INVALID')
  })
  it('preserves the pre-header idle bound', async () => {
    vi.useFakeTimers()
    const owner = new CopilotStreamLiveness(100, new AbortController().signal)
    owner.beginRequest('{"synthetic":"你好"}')
    await vi.advanceTimersByTimeAsync(100)
    expect(owner.signal.reason).toBeInstanceOf(CopilotStreamIdleError)
    expect(owner.signal.reason.message).toContain(`Request body: ${Buffer.byteLength('{"synthetic":"你好"}', 'utf8')} UTF-8 bytes`)
    expect(owner.signal.reason.message).not.toContain('synthetic')
    owner.dispose()
  })

  it('passes exact SSE bytes and pulses only nonempty chunks', async () => {
    vi.useFakeTimers()
    let source!: ReadableStreamDefaultController<Uint8Array>
    const response = new Response(new ReadableStream<Uint8Array>({ start(controller) { source = controller } }),
      { headers: { 'content-type': 'text/event-stream', 'x-synthetic': 'retained' } })
    const owner = new CopilotStreamLiveness(100, new AbortController().signal)
    const observed = owner.observe(response)
    expect(observed.status).toBe(response.status)
    expect(observed.headers.get('x-synthetic')).toBe('retained')
    const reader = observed.body!.getReader()
    const pending = reader.read()
    await vi.advanceTimersByTimeAsync(80)
    const bytes = new TextEncoder().encode(': heartbeat\n\n')
    source.enqueue(bytes)
    expect((await pending).value).toEqual(bytes)
    await vi.advanceTimersByTimeAsync(80)
    expect(owner.signal.aborted).toBe(false)
    source.enqueue(new Uint8Array())
    await reader.read()
    await vi.advanceTimersByTimeAsync(20)
    expect(owner.signal.reason).toBeInstanceOf(CopilotStreamIdleError)
    await reader.cancel()
    owner.dispose()
  })

  it('cancels a stalled reader on expiry without changing the caller signal', async () => {
    vi.useFakeTimers()
    const caller = new AbortController()
    const cancel = vi.fn()
    const owner = new CopilotStreamLiveness(100, caller.signal)
    const response = owner.observe(new Response(new ReadableStream({ cancel }), {
      headers: { 'content-type': 'text/event-stream' },
    }))
    const reader = response.body!.getReader()
    const pending = reader.read()
    await vi.advanceTimersByTimeAsync(100)
    expect((await pending).done).toBe(true)
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(caller.signal.aborted).toBe(false)
    expect(owner.signal.reason).toBeInstanceOf(CopilotStreamIdleError)
    owner.dispose()
  })

  it('preserves caller abort identity and tears down timers', async () => {
    vi.useFakeTimers()
    const caller = new AbortController()
    const owner = new CopilotStreamLiveness(100, caller.signal)
    const reason = new Error('Synthetic caller cancellation')
    caller.abort(reason)
    await vi.advanceTimersByTimeAsync(1000)
    expect(owner.signal.reason).toBe(reason)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('leaves unsuccessful and non-SSE responses untouched', () => {
    const owner = new CopilotStreamLiveness(100, new AbortController().signal)
    const error = new Response('Synthetic error', { status: 408 })
    const json = new Response('{}', { headers: { 'content-type': 'application/json' } })
    expect(owner.observe(error)).toBe(error)
    expect(owner.observe(json)).toBe(json)
    owner.dispose()
  })

  it('does not count consumer think time as provider idle', async () => {
    vi.useFakeTimers()
    const owner = new CopilotStreamLiveness(100, new AbortController().signal)
    owner.pause()
    owner.pulse()
    await vi.advanceTimersByTimeAsync(1000)
    expect(owner.signal.aborted).toBe(false)
    owner.resume()
    await vi.advanceTimersByTimeAsync(100)
    expect(owner.signal.reason).toBeInstanceOf(CopilotStreamIdleError)
    owner.dispose()
  })

  it('cleans up at normal EOF and preserves stream errors', async () => {
    vi.useFakeTimers()
    const owner = new CopilotStreamLiveness(100, new AbortController().signal)
    const closed = owner.observe(new Response(new ReadableStream({
      start(controller) { controller.close() },
    }), { headers: { 'content-type': 'text/event-stream' } }))
    expect(await closed.text()).toBe('')
    expect(vi.getTimerCount()).toBe(0)
    const second = new CopilotStreamLiveness(100, new AbortController().signal)
    const original = new Response(new ReadableStream({
      start(controller) { controller.error(new Error('Synthetic terminated')) },
    }), { headers: { 'content-type': 'text/event-stream' } })
    const failed = second.observe(original)
    await expect(failed.text()).rejects.toThrow('Synthetic terminated')
    expect(original.body?.locked).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })
})
