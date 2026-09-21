import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CopilotResponsesReplayError,
  isCopilotInputItemScopeError,
  normalizeCopilotResponsesPayload,
} from '../src/responses-replay-compat.ts'

const encoder = new TextEncoder()

function normalize(input: unknown[]) {
  return normalizeCopilotResponsesPayload({ input }) as { input: Record<string, unknown>[] }
}

function expectSafeFailure(payload: unknown) {
  let failure: unknown
  try { normalizeCopilotResponsesPayload(payload) } catch (error) { failure = error }
  expect(failure).toBeInstanceOf(CopilotResponsesReplayError)
  expect(failure).toMatchObject({ name: 'CopilotResponsesReplayError' })
  expect([
    new CopilotResponsesReplayError('unsupported').message,
    new CopilotResponsesReplayError('invalid-payload').message,
  ]).toContain((failure as Error).message)
  expect(String(failure)).not.toContain('secret')
}

describe('Copilot Responses wire replay normalization', () => {
  it('shallow-copies only eligible direct IDs without touching immutable history or nested fields', () => {
    const text = Object.freeze({ type: 'output_text', text: 'answer', id: 'nested-text', annotations: Object.freeze([]) })
    const content = Object.freeze([text])
    const summary = Object.freeze([Object.freeze({ type: 'summary_text', text: 'summary', id: 'nested-summary' })])
    const nested = Object.freeze({ id: 'nested-metadata' })
    const output = Object.freeze([Object.freeze({ type: 'input_text', text: '{"id":"result-id"}', id: 'output-id' })])
    const assistant = Object.freeze({ type: 'message', role: 'assistant', status: 'completed', id: 'msg-old', phase: 'commentary', content, metadata: nested })
    const call = Object.freeze({ type: 'function_call', status: 'completed', id: 'fc-old', call_id: 'call-stable', name: 'run', arguments: '{"id":"argument-id"}', phase: 'analysis' })
    const reasoning = Object.freeze({ type: 'reasoning', id: 'rs-old', encrypted_content: 'opaque-encrypted-content', summary, content, metadata: nested })
    const result = Object.freeze({ type: 'function_call_output', call_id: 'call-stable', output })
    const user = Object.freeze({ type: 'message', role: 'user', id: 'user-untouched', content: 'continue' })
    const input = Object.freeze([assistant, call, reasoning, result, user])
    const context = Object.freeze({ messages: input })
    const payload = Object.freeze({ model: 'account-model', input, metadata: nested, context })
    const normalized = normalizeCopilotResponsesPayload(payload) as { input: Record<string, unknown>[]; context: unknown; metadata: unknown }
    expect(normalized).not.toBe(payload)
    expect(normalized.input).not.toBe(input)
    expect(normalized.input).toEqual([
      { type: 'message', role: 'assistant', status: 'completed', phase: 'commentary', content, metadata: nested },
      { type: 'function_call', status: 'completed', call_id: 'call-stable', name: 'run', arguments: '{"id":"argument-id"}', phase: 'analysis' },
      { type: 'reasoning', encrypted_content: 'opaque-encrypted-content', summary, content, metadata: nested },
      result, user,
    ])
    expect(normalized.input[0]?.content).toBe(content)
    expect(normalized.input[0]?.metadata).toBe(nested)
    expect(normalized.input[2]?.summary).toBe(summary)
    expect(normalized.input[2]?.content).toBe(content)
    expect(normalized.input[3]).toBe(result)
    expect(normalized.input[4]).toBe(user)
    expect(normalized.metadata).toBe(nested)
    expect(normalized.context).toBe(context)
    expect(context.messages).toBe(input)
    expect(assistant.id).toBe('msg-old')
    expect(call.id).toBe('fc-old')
    expect(reasoning.id).toBe('rs-old')
    expect(normalizeCopilotResponsesPayload(normalized)).toBe(normalized)
  })

  it('accepts complete replay forms without optional status and keeps opaque values unchanged', () => {
    const items = [
      { type: 'message', role: 'assistant', id: 'm', content: [] },
      { type: 'function_call', id: 'f', call_id: 'c', name: 'n', arguments: '' },
      { type: 'reasoning', id: 'r', encrypted_content: 'opaque', summary: { id: 'not-interpreted' } },
    ]
    expect(normalize(items).input).toEqual(items.map(({ id: _id, ...item }) => item))
  })

  it('passes valid ID-free unknown types and ordinary input through by identity', () => {
    const input = Object.freeze([
      Object.freeze({ role: 'user', content: 'hello' }),
      Object.freeze({ role: 'system', content: 'policy' }),
      Object.freeze({ type: 'message', role: 'developer', id: 'policy-id', content: [] }),
      Object.freeze({ type: 'future_native_type', payload: { id: 'nested-unknown' } }),
      Object.freeze({ type: 'function_call_output', call_id: 'call', output: 'result' }),
      Object.freeze({ type: 'reasoning', encrypted_content: 'opaque', summary: [] }),
      Object.freeze({ type: 'reasoning', summary: [] }),
      Object.freeze({ type: 'function_call_output', output: 'native-owned' }),
      Object.freeze({ type: 'function_call', status: 'in_progress' }),
      Object.freeze({ type: 'function_call', id: undefined, status: 'in_progress' }),
      Object.freeze({ type: 'message', role: 'assistant', content: [], status: 'incomplete' }),
      Object.freeze({ role: 'assistant', content: 'easy message' }),
      Object.freeze({}),
    ])
    const payload = Object.freeze({ input, metadata: { id: 'outside-input' } })
    expect(normalizeCopilotResponsesPayload(payload)).toBe(payload)
    const stringPayload = Object.freeze({ input: 'plain prompt' })
    expect(normalizeCopilotResponsesPayload(stringPayload)).toBe(stringPayload)
    const emptyPayload = Object.freeze({ input: [] })
    expect(normalizeCopilotResponsesPayload(emptyPayload)).toBe(emptyPayload)
  })

  it.each([
    { type: 'item_reference', id: 'secret-reference' },
    { type: 'item_reference' },
    { type: 'reasoning', id: 'secret-reasoning', summary: [] },
    { type: 'reasoning', id: 'secret', summary: [{ type: 'summary_text', text: 'secret-summary' }] },
    { type: 'reasoning', id: 'secret', encrypted_content: '' },
    { type: 'reasoning', id: 'secret', encrypted_content: '   ' },
    { type: 'reasoning', id: 'secret', encrypted_content: 42 },
    { type: 'reasoning', id: 'secret', encrypted_content: 'opaque', status: 'in_progress' },
    { type: 'message', role: 'assistant', id: 'secret-message' },
    { type: 'message', role: 'assistant', id: 'secret-message', content: 'partial' },
    { type: 'message', role: 'assistant', id: 'secret', content: [], status: 'incomplete' },
    { type: 'message', role: 'assistant', id: 'secret', content: [], status: 'in_progress' },
    { role: 'assistant', id: 'secret-ambiguous', content: [] },
    { type: 'function_call', id: 'secret-call', name: 'run', arguments: '{}' },
    { type: 'function_call', id: 'secret', call_id: '', name: 'run', arguments: '{}' },
    { type: 'function_call', id: 'secret', call_id: 'call', name: '', arguments: '{}' },
    { type: 'function_call', id: 'secret', call_id: 'call', name: 'run', arguments: {} },
    { type: 'function_call', id: 'secret', call_id: 'call', name: 'run', arguments: '{}', status: 'in_progress' },
    { type: 'function_call_output', id: 'secret-output', call_id: 'call', output: 'result' },
    { type: 'web_search_call', id: 'secret-native-call', status: 'completed', action: { type: 'search', query: 'secret' } },
    { type: 'future_native_type', id: 'secret-unknown' },
    { id: 'secret-ambiguous' },
  ])('rejects ambiguous or reference-dependent replay safely: %#', item => {
    expectSafeFailure({ input: [item] })
  })

  it.each([
    undefined, null, false, 1, 'secret', [], {}, { input: null }, { input: 1 }, { input: {} },
    { input: [null] }, { input: ['secret'] }, { input: [[]] },
    { input: [{ type: 'message', role: 'unrecognized', id: 'secret', content: [] }] },
    { input: [{ type: 'message', role: 'assistant', id: 1, content: [] }] },
  ])('rejects structurally malformed payloads with a fixed diagnostic: %#', payload => {
    expectSafeFailure(payload)
  })

  it('rejects a nonempty previous_response_id rather than guessing how to replay it', () => {
    expectSafeFailure({ input: [], previous_response_id: 'secret-previous-response' })
    for (const previous_response_id of [undefined, null, '']) {
      const payload = { input: [], previous_response_id }
      expect(normalizeCopilotResponsesPayload(payload)).toBe(payload)
    }
  })

  it('does not expose failures from unexpected input property accessors', () => {
    const payload = { get input() { throw new Error('secret-payload') } }
    const item = { get type() { throw new Error('secret-item') } }
    expectSafeFailure(payload)
    expectSafeFailure({ input: [item] })
  })

  it.each([null, '', '   ', false, 42])('rejects malformed direct replay IDs without changing them: %#', id => {
    const item = Object.freeze({ type: 'message', role: 'assistant', id, content: Object.freeze([]) })
    expectSafeFailure({ input: [item] })
    expect(item.id).toBe(id)
  })

  it('exposes fixed, safe diagnostics for parent INVALID_REQUEST mapping', () => {
    expect(new CopilotResponsesReplayError().message).toBe('COPILOT_RESPONSES_REPLAY_UNSUPPORTED: Copilot Responses input cannot be replayed safely without connection-scoped references.')
    expect(new CopilotResponsesReplayError('scope-mismatch')).toMatchObject({
      name: 'CopilotResponsesReplayError',
      message: 'COPILOT_RESPONSES_REPLAY_SCOPE_MISMATCH: Copilot Responses input references belong to a different connection.',
    })
    expect(new CopilotResponsesReplayError('invalid-payload').message).toBe('COPILOT_RESPONSES_REPLAY_INVALID_PAYLOAD: Copilot Responses payload has an invalid replay structure.')
  })

  it('fails atomically without modifying an earlier eligible item', () => {
    const assistant = Object.freeze({ type: 'message', role: 'assistant', id: 'original', content: Object.freeze([]) })
    const payload = Object.freeze({ input: Object.freeze([assistant, Object.freeze({ type: 'item_reference', id: 'secret' })]) })
    expectSafeFailure(payload)
    expect(assistant.id).toBe('original')
  })
})

describe.each([
  'input item ID does not belong to this connection',
  'input item does not belong to this connection',
])('strict bounded Copilot input item scope classification: %s', scopeMessage => {
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

  it.each([
    { message: scopeMessage },
    { error: { message: scopeMessage } },
    { error: { message: scopeMessage, code: '', type: null } },
    { message: scopeMessage, code: null, type: '' },
    { message: scopeMessage, code: '', type: null, error: { message: scopeMessage } },
    { code: null, type: '', error: { message: scopeMessage, code: null, type: '' } },
  ])('accepts only an exact structured 401 and preserves the original body', async body => {
    const json = JSON.stringify(body)
    const response = new Response(json, { status: 401 })
    expect(await isCopilotInputItemScopeError(response)).toBe(true)
    expect(response.bodyUsed).toBe(false)
    expect(await response.text()).toBe(json)
  })

  it.each([200, 400, 403, 429, 500])('does not inspect HTTP %s even with exact JSON', async status => {
    const response = Response.json({ error: { message: scopeMessage } }, { status })
    const clone = vi.spyOn(response, 'clone')
    expect(await isCopilotInputItemScopeError(response)).toBe(false)
    expect(clone).not.toHaveBeenCalled()
    expect(response.bodyUsed).toBe(false)
  })

  it.each([
    scopeMessage,
    JSON.stringify(scopeMessage),
    JSON.stringify({ message: `prefix ${scopeMessage}` }),
    JSON.stringify({ message: `${scopeMessage}.` }),
    JSON.stringify({ message: ` ${scopeMessage}` }),
    JSON.stringify({ message: scopeMessage.toUpperCase() }),
    JSON.stringify({ error: scopeMessage }),
    JSON.stringify({ error: { detail: scopeMessage } }),
    JSON.stringify({ other: { message: scopeMessage } }),
    JSON.stringify([{ message: scopeMessage }]),
    JSON.stringify({ message: [scopeMessage] }),
    JSON.stringify({ message: 'unauthorized', error: { message: 'expired token' } }),
    JSON.stringify({ message: scopeMessage, code: 'invalid_api_key' }),
    JSON.stringify({ message: scopeMessage, type: 'authentication_error' }),
    JSON.stringify({ error: { message: scopeMessage, code: 'invalid_api_key' } }),
    JSON.stringify({ error: { message: scopeMessage, type: 'authentication_error' } }),
    JSON.stringify({ error: { message: scopeMessage, code: 401 } }),
    JSON.stringify({ error: { message: scopeMessage, code: false } }),
    JSON.stringify({ message: scopeMessage, error: { message: 'expired token', code: 'invalid_api_key' } }),
    JSON.stringify({ code: 'invalid_api_key', error: { message: scopeMessage } }),
    JSON.stringify({ type: 'authentication_error', error: { message: scopeMessage } }),
    JSON.stringify({ code: 'invalid_api_key', type: 'authentication_error', error: { message: scopeMessage } }),
    JSON.stringify({ message: 'expired token', error: { message: scopeMessage } }),
    JSON.stringify({ message: scopeMessage === 'input item ID does not belong to this connection'
      ? 'input item does not belong to this connection' : 'input item ID does not belong to this connection',
    error: { message: scopeMessage } }),
    JSON.stringify({ message: '', error: { message: scopeMessage } }),
    JSON.stringify({ message: null, error: { message: scopeMessage } }),
    JSON.stringify({ message: scopeMessage, error: null }),
    JSON.stringify({ message: scopeMessage, error: 'unauthorized' }),
    'null', '[]', '{', '', `<html>${scopeMessage}</html>`,
  ])('does not classify text, nested lookalikes or malformed JSON: %#', async body => {
    const response = new Response(body, { status: 401 })
    expect(await isCopilotInputItemScopeError(response)).toBe(false)
    expect(response.bodyUsed).toBe(false)
    expect(await response.text()).toBe(body)
  })

  it('handles multibyte streamed JSON without treating character count as the byte bound', async () => {
    const bytes = encoder.encode(JSON.stringify({ message: scopeMessage, extra: 'é' }))
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const byte of bytes) controller.enqueue(Uint8Array.of(byte))
        controller.close()
      },
    })
    const response = new Response(stream, { status: 401 })
    expect(await isCopilotInputItemScopeError(response)).toBe(true)
    expect(response.bodyUsed).toBe(false)
    expect(await response.json()).toEqual({ message: scopeMessage, extra: 'é' })
  })

  it('accepts exactly 8KiB but rejects excess bytes regardless of content-length', async () => {
    const json = JSON.stringify({ message: scopeMessage })
    const boundary = json.padEnd(8192, ' ')
    expect(await isCopilotInputItemScopeError(new Response(boundary, { status: 401 }))).toBe(true)
    for (const headers of [undefined, { 'content-length': '1' }]) {
      const response = new Response(`${boundary} `, { status: 401, headers })
      expect(await isCopilotInputItemScopeError(response)).toBe(false)
      expect(await response.text()).toBe(`${boundary} `)
    }
    expect(await isCopilotInputItemScopeError(Response.json({ message: scopeMessage, extra: 'é'.repeat(4096) }, { status: 401 }))).toBe(false)
  })

  it('returns false promptly for excess streaming bytes without awaiting tee cancellation', async () => {
    const cancel = vi.fn(() => new Promise<void>(() => {}))
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(encoder.encode(' '.repeat(8193))) }, cancel,
    }), { status: 401 })
    expect(await isCopilotInputItemScopeError(response)).toBe(false)
    expect(response.bodyUsed).toBe(false)
    const reader = response.body!.getReader()
    expect((await reader.read()).value?.byteLength).toBe(8193)
    void reader.cancel().catch(() => {})
  })

  it('bounds immediate empty chunks that could otherwise starve the timeout', async () => {
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        for (let index = 0; index < 8193; index++) controller.enqueue(new Uint8Array())
        controller.enqueue(encoder.encode(JSON.stringify({ message: scopeMessage })))
        controller.close()
      },
    }), { status: 401 })
    expect(await isCopilotInputItemScopeError(response)).toBe(false)
    expect(response.bodyUsed).toBe(false)
    expect(await response.json()).toEqual({ message: scopeMessage })
  })

  it('bounds a never-ending body by a short timeout even if cancellation never resolves', async () => {
    vi.useFakeTimers()
    const response = new Response(new ReadableStream<Uint8Array>({ cancel: () => new Promise<void>(() => {}) }), { status: 401 })
    const result = isCopilotInputItemScopeError(response)
    await vi.advanceTimersByTimeAsync(1000)
    expect(await result).toBe(false)
    expect(response.bodyUsed).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
    void response.body!.cancel().catch(() => {})
  })

  it('returns false on pre-abort without cloning or reading', async () => {
    const controller = new AbortController()
    controller.abort(new Error('secret-abort-reason'))
    const response = Response.json({ message: scopeMessage }, { status: 401 })
    const clone = vi.spyOn(response, 'clone')
    expect(await isCopilotInputItemScopeError(response, controller.signal)).toBe(false)
    expect(clone).not.toHaveBeenCalled()
    expect(response.bodyUsed).toBe(false)
  })

  it('aborts a pending clone read without awaiting cancellation or leaving timers/listeners', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const remove = vi.spyOn(controller.signal, 'removeEventListener')
    const response = new Response(new ReadableStream<Uint8Array>({ cancel: () => new Promise<void>(() => {}) }), { status: 401 })
    const result = isCopilotInputItemScopeError(response, controller.signal)
    controller.abort(new Error('secret-abort-reason'))
    expect(await result).toBe(false)
    expect(response.bodyUsed).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
    void response.body!.cancel().catch(() => {})
  })

  it('treats consumed, empty, failing and invalid UTF-8 bodies as unknown', async () => {
    const consumed = Response.json({ message: scopeMessage }, { status: 401 })
    await consumed.text()
    expect(await isCopilotInputItemScopeError(consumed)).toBe(false)
    expect(await isCopilotInputItemScopeError(new Response(null, { status: 401 }))).toBe(false)
    const broken = new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.error(new Error('secret-network-error')) } }), { status: 401 })
    expect(await isCopilotInputItemScopeError(broken)).toBe(false)
    const malformed = new Uint8Array([...encoder.encode('{"message":"'), 0xff, ...encoder.encode(scopeMessage + '"}')])
    expect(await isCopilotInputItemScopeError(new Response(malformed, { status: 401 }))).toBe(false)
  })
})
