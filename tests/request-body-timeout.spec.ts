import { describe, expect, it, vi } from 'vitest'
import { requestBodyTimeoutDiagnostic } from '../src/request-body-timeout.ts'
import * as bodyEvidence from '../src/request-body-evidence.ts'

const error = { code: 'user_request_timeout',
  message: 'Timed out reading request body. Try again, or use a smaller request size.' }

describe('verified request-body timeout diagnostics', () => {
  it('measures a verified 20.4 MiB failure while preserving the original native response and timing', async () => {
    const body = JSON.stringify({ input: [{ role: 'user', content: 'PRIVATE'.repeat(3559000) }] })
    const response = new Response(JSON.stringify(error), { status: 408 })
    const text = await requestBodyTimeoutDiagnostic(response, body, undefined,
      { protocol: 'openai-responses', responseHeadersMs: 61375 })
    expect(text).toContain('Composition (wire UTF-8 bytes): conversation')
    expect(text).toContain('61375 ms (round trip, not upload duration)')
    expect(text).not.toContain('PRIVATE')
    expect(await response.json()).toEqual(error)
  })
  it('includes local phase evidence only after strict failure verification and keeps the original response', async () => {
    const upload = { state: 'observed' as const, bodyWrite: 'observed' as const,
      bodyWriteCompleteMs: 32, nativeResponseHeadersMs: 900, alpn: 'h2' as const, nodeWritableBufferBytes: 0 }
    const response = new Response(JSON.stringify(error), { status: 408 })
    const text = await requestBodyTimeoutDiagnostic(response, '{"input":[]}', undefined,
      { protocol: 'openai-responses', responseHeadersMs: 901, upload })
    expect(text).toContain('local body-write complete at 32 ms')
    expect(text).toContain('native response headers at 900 ms')
    expect(text).toContain('TLS ALPN h2')
    expect(text).toContain('not upload duration, kernel ACK, supplier receipt or execution')
    expect(await response.json()).toEqual(error)
    expect(await requestBodyTimeoutDiagnostic(new Response('{}', { status: 408 }), '{"input":[]}', undefined,
      { protocol: 'openai-responses', responseHeadersMs: 901, upload })).toBeUndefined()
  })
  it('analyzes only verified failures and reports honest header timing without leaking final payload', async () => {
    const observer = vi.spyOn(bodyEvidence, 'requestBodyEvidence')
    try {
      const body = '{"input":[{"role":"user","content":[{"type":"input_image","file_id":"SECRET"}]}],"tools":[]}'
      expect(await requestBodyTimeoutDiagnostic(new Response('{}', { status: 408 }), body,
        undefined, { protocol: 'openai-responses', responseHeadersMs: 125.4 })).toBeUndefined()
      expect(observer).not.toHaveBeenCalled()
      const text = await requestBodyTimeoutDiagnostic(new Response(JSON.stringify(error), { status: 408 }),
        body, undefined, { protocol: 'openai-responses', responseHeadersMs: 125.4 })
      expect(observer).toHaveBeenCalledExactlyOnceWith(body, 'openai-responses')
      expect(text).toContain('Composition (wire UTF-8 bytes)')
      expect(text).toContain('125 ms (round trip, not upload duration)')
      expect(text).not.toContain('SECRET')
    } finally { observer.mockRestore() }
  })
  it('distinguishes original JSON composition from compressed HTTP body bytes', async () => {
    const body = JSON.stringify({ input: [{ role: 'user', content: [{ type: 'input_text', text: 'synthetic' }] }] })
    const originalBytes = Buffer.byteLength(body, 'utf8')
    const text = await requestBodyTimeoutDiagnostic(new Response(JSON.stringify(error), { status: 408 }), body,
      undefined, { protocol: 'openai-responses', responseHeadersMs: 20,
        compression: { encoding: 'gzip', reason: 'compressed', originalBytes, wireBytes: 64 } })
    expect(text).toContain(`Request body (original JSON): ${originalBytes} UTF-8 bytes`)
    expect(text).toContain('Encoded body: 64 gzip bytes')
    expect(text).toContain('Original JSON composition (UTF-8 bytes, not gzip wire bytes)')
    expect(text).not.toContain('Composition (wire UTF-8 bytes)')
  })
  it('reports a skipped opt-in compression reason without changing identity diagnostics', async () => {
    const text = await requestBodyTimeoutDiagnostic(new Response(JSON.stringify(error), { status: 408 }), '{"input":[]}',
      undefined, { protocol: 'openai-responses', responseHeadersMs: 20,
        compression: { encoding: 'identity', reason: 'work-limit' } })
    expect(text).toContain('Request compression not applied: work-limit; original request retained.')
    expect(text).toContain('Composition (wire UTF-8 bytes)')
    expect(text).not.toContain('Encoded body:')
  })
  it.each([error, { error }])('recognizes the observed structured 408 without leaking body text', async body => {
    const response = new Response(JSON.stringify({ ...body, private: 'SECRET_RESPONSE' }), { status: 408 })
    const text = await requestBodyTimeoutDiagnostic(response, '{"input":"中文"}')
    expect(text).toContain('COPILOT_REQUEST_BODY_TIMEOUT')
    expect(text).toContain(`Request body: ${Buffer.byteLength('{"input":"中文"}', 'utf8')} UTF-8 bytes`)
    expect(text).toContain('not context-window overflow')
    expect(text).not.toContain('SECRET_RESPONSE')
    expect(await response.json()).toEqual({ ...body, private: 'SECRET_RESPONSE' })
  })

  it.each([
    [400, error], [401, error], [500, error],
    [408, { ...error, code: 'other_timeout' }],
    [408, { ...error, message: 'synthetic unrelated timeout' }],
    [408, { error, code: 'auth' }],
    [408, { error, message: 'contradictory outer message' }],
    [408, 'user_request_timeout'],
  ])('retains unknown native behavior for status %s and body %j', async (status, body) => {
    const response = new Response(JSON.stringify(body), { status: Number(status) })
    expect(await requestBodyTimeoutDiagnostic(response, 'synthetic')).toBeUndefined()
    expect(await response.json()).toEqual(body)
  })

  it('reports unknown request bytes honestly without serializing arbitrary bodies', async () => {
    const response = new Response(JSON.stringify(error), { status: 408 })
    expect(await requestBodyTimeoutDiagnostic(response)).toContain('Request body size unavailable')
  })
  it('reports bounded composition failure explicitly without changing a verified native error', async () => {
    for (const body of [undefined, '{"input":"plain"}', 'invalid']) {
      const response = new Response(JSON.stringify(error), { status: 408 })
      const text = await requestBodyTimeoutDiagnostic(response, body, undefined,
        { protocol: 'openai-responses', responseHeadersMs: 75 })
      expect(text).toContain('Composition unavailable')
      expect(text).toContain('no partial totals inferred')
      expect(text).toContain('75 ms')
      expect(text).toContain('Native retry policy is unchanged')
      expect(await response.json()).toEqual(error)
    }
  })

  it('does not infer a diagnostic from malformed or oversized bodies', async () => {
    for (const body of ['not JSON', JSON.stringify({ ...error, private: 'x'.repeat(8192) })]) {
      const response = new Response(body, { status: 408 })
      expect(await requestBodyTimeoutDiagnostic(response, 'synthetic')).toBeUndefined()
      expect(await response.text()).toBe(body)
    }
  })

  it('refuses invalid UTF-8 and bounds empty-chunk work without consuming native data', async () => {
    const invalid = new Response(new Uint8Array([0xc0, 0xaf]), { status: 408 })
    expect(await requestBodyTimeoutDiagnostic(invalid, 'synthetic')).toBeUndefined()
    expect(new Uint8Array(await invalid.arrayBuffer())).toEqual(new Uint8Array([0xc0, 0xaf]))
    let chunks = 0
    const empty = new Response(new ReadableStream<Uint8Array>({
      pull(controller) {
        if (++chunks < 9000) controller.enqueue(new Uint8Array())
        else controller.close()
      },
    }), { status: 408 })
    expect(await requestBodyTimeoutDiagnostic(empty, 'synthetic')).toBeUndefined()
    expect(chunks).toBeLessThan(9000)
    await empty.body?.cancel()
  })

  it('bounds stalled response observation and gives cancellation priority', async () => {
    vi.useFakeTimers()
    try {
      const controller = new AbortController()
      const response = new Response(new ReadableStream<Uint8Array>({ start() {} }), { status: 408 })
      const result = requestBodyTimeoutDiagnostic(response, 'synthetic', controller.signal)
      controller.abort()
      expect(await result).toBeUndefined()
      const stalled = requestBodyTimeoutDiagnostic(response.clone(), 'synthetic')
      await vi.advanceTimersByTimeAsync(250)
      expect(await stalled).toBeUndefined()
    } finally { vi.useRealTimers() }
  })
})
