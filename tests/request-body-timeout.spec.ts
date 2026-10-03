import { describe, expect, it, vi } from 'vitest'
import { requestBodyTimeoutDiagnostic } from '../src/request-body-timeout.ts'
import * as bodyEvidence from '../src/request-body-evidence.ts'

const error = { code: 'user_request_timeout',
  message: 'Timed out reading request body. Try again, or use a smaller request size.' }

describe('verified request-body timeout diagnostics', () => {
  it('correlates verified failure using bounded model, protocol, UTC time and supplier identifiers only', async () => {
    const response = new Response(JSON.stringify(error), { status: 408, headers: {
      'x-request-id': '12345678-1234-4abc-8abc-123456789abc',
      'x-github-request-id': 'ABCD:1234:123ABC:456DEF:6789ABCD',
      authorization: 'PRIVATE_TOKEN', 'x-private': 'PRIVATE_HEADER',
    } })
    const text = await requestBodyTimeoutDiagnostic(response, '{"input":[],"tools":[]}', undefined,
      { protocol: 'openai-responses', responseHeadersMs: 60566, modelId: 'fixture-model',
        observedAtMs: Date.UTC(2026, 9, 3, 23, 30) })
    expect(text).toContain('Model: fixture-model; protocol: openai-responses')
    expect(text).toContain('Observed at: 2026-10-03T23:30:00.000Z')
    expect(text).toContain('x-request-id=12345678-1234-4abc-8abc-123456789abc')
    expect(text).toContain('x-github-request-id=ABCD:1234:123ABC:456DEF:6789ABCD')
    expect(text).not.toContain('PRIVATE')
    expect(text).toContain('No image blocks were identified')
    expect(text).not.toContain('attachment/image-offload budget change')
    expect(await response.json()).toEqual(error)
  })
  it('rejects unrecognized identifier shapes and unsafe metadata rather than echoing headers', async () => {
    const text = await requestBodyTimeoutDiagnostic(new Response(JSON.stringify(error), { status: 408, headers: {
      'x-request-id': 'private-customer-name', 'x-github-request-id': 'private-value',
      'request-id': '12345678-1234-4abc-8abc-123456789abc',
    } }), '{"input":[]}', undefined, { protocol: 'openai-responses', responseHeadersMs: 1,
      modelId: 'PRIVATE\nVALUE', observedAtMs: Infinity })
    expect(text).toContain('Model: unavailable')
    expect(text).toContain('Observed at: unavailable')
    expect(text).toContain('Supplier request IDs: unavailable')
    expect(text).not.toContain('private')
    expect(text).not.toContain('PRIVATE')
  })
  it.each([
    ['fixture\n', -1], ['x'.repeat(201), 253402300800000], ['', 1.5],
  ] as const)('rejects invalid model and timestamp bounds (%j)', async (modelId, observedAtMs) => {
    const text = await requestBodyTimeoutDiagnostic(new Response(JSON.stringify(error), { status: 408 }),
      undefined, undefined, { protocol: 'openai-responses', responseHeadersMs: 1, modelId, observedAtMs })
    expect(text).toContain('Model: unavailable')
    expect(text).toContain('Observed at: unavailable')
    expect(text).toContain('Composition is unavailable')
    expect(text).not.toContain('No image blocks were identified')
    expect(text).not.toContain('attachment/image-offload budget change')
  })
  it.each([
    '12345678-1234-4abc-8abc-123456789abc, 12345678-1234-4abc-8abc-123456789abc',
    'a'.repeat(1000),
    'customer-token',
  ])('does not echo joined, oversized or unknown supplier IDs', async value => {
    const response = new Response(JSON.stringify(error), { status: 408,
      headers: { 'x-request-id': value, 'x-github-request-id': value } })
    const text = await requestBodyTimeoutDiagnostic(response)
    expect(text).toContain('Supplier request IDs: unavailable')
    expect(text).not.toContain(value)
    expect(text).toContain('protocol: unavailable')
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
      expect(text).toContain('attachment/image-offload budget change only for identified image blocks')
      expect(text).not.toContain('No image blocks were identified')
      expect(text).not.toContain('SECRET')
    } finally { observer.mockRestore() }
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
