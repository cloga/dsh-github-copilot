import { describe, expect, it } from 'vitest'
import { formatRequestBodyEvidence, requestBodyEvidence, REQUEST_BODY_EVIDENCE_LIMITS } from '../src/request-body-evidence.ts'
import type { RequestBodyProtocol } from '../src/request-body-evidence.ts'
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8')
describe('bounded numeric-only original request body evidence', () => {
  it.each(['openai-responses', 'openai-completions', 'anthropic-messages'] as const)(
    'partitions actual wire bytes without reserialization for %s', protocol => {
      const image = protocol === 'openai-responses' ? { type: 'input_image', image_url: 'data:image/png;base64,AAAA' }
        : protocol === 'openai-completions' ? { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }
          : { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }
      const opaque = protocol === 'openai-responses' ? { type: 'reasoning', encrypted_content: 'SECRET_REPLAY', summary: [] }
        : { type: 'thinking', thinking: 'SECRET_THOUGHT', signature: 'SECRET_REPLAY' }
      const conversation = [{ role: 'user', content: [{ type: 'text', text: 'SECRET_TEXT 中文 😀' }, image] },
        ...protocol === 'anthropic-messages' ? [{ role: 'assistant', content: [opaque] }] : [opaque]]
      const key = protocol === 'openai-responses' ? 'input' : 'messages'
      const tools = [{ type: 'function', name: 'SECRET_TOOL', parameters: { type: 'object' } }]
      const systemKey = protocol === 'openai-responses' ? 'instructions' : 'system'
      const body = JSON.stringify({ [key]: conversation, tools, [systemKey]: 'SECRET_SYSTEM', model: 'SECRET_MODEL' })
      const result = requestBodyEvidence(body, protocol)
      expect(result).toMatchObject({ state: 'complete', totalBytes: Buffer.byteLength(body),
        conversationBytes: bytes(conversation), toolSchemaBytes: bytes(tools),
        systemBytes: protocol === 'openai-completions' ? 0 : bytes('SECRET_SYSTEM'), imageBlockBytes: bytes(image),
        opaqueReplayBytes: protocol === 'openai-completions' ? 0 : bytes('SECRET_REPLAY') })
      if (result.state !== 'complete') throw new Error('EXPECTED_COMPLETE')
      expect(result.conversationBytes + result.toolSchemaBytes + result.systemBytes + result.otherBytes).toBe(result.totalBytes)
      expect(result.imageBlockBytes + result.opaqueReplayBytes + result.remainingConversationBytes).toBe(result.conversationBytes)
      expect(JSON.stringify(result)).not.toContain('SECRET')
    })
  it('counts escaped and whitespace-rich original spans, not a normalized payload or decoded image', () => {
    const image = '{ "type" : "input_image", "image_url": "data:image\\/png;base64,AAAA" }'
    const conversation = `[{"type":"message","role":"user","content":[${image}]}, {"type":"reasoning","encrypted_content":"\\u4e2d\\n\\\""}]`
    const body = ` { "input" : ${conversation}, "instructions" : "\\u4e2d", "tools": [ ] } \n`
    expect(requestBodyEvidence(body, 'openai-responses')).toMatchObject({
      state: 'complete', totalBytes: Buffer.byteLength(body), conversationBytes: Buffer.byteLength(conversation),
      systemBytes: Buffer.byteLength('"\\u4e2d"'), toolSchemaBytes: 3,
      imageBlockBytes: Buffer.byteLength(image), opaqueReplayBytes: Buffer.byteLength('"\\u4e2d\\n\\\""'),
    })
  })
  it('does not classify fields by name inside text, tool schemas or unknown structures', () => {
    const conversation = [{ type: 'text', text: '{"type":"input_image","encrypted_content":"secret"}',
      encrypted_content: 'not-replay', image_url: 'not-an-image' }]
    expect(requestBodyEvidence(JSON.stringify({ input: conversation,
      tools: [{ type: 'input_image', image_url: 'secret' }] }), 'openai-responses'))
      .toMatchObject({ state: 'complete', imageBlockBytes: 0, opaqueReplayBytes: 0 })
  })
  it('preserves absent, unsupported and malformed evidence rather than returning zero-shaped success', () => {
    expect(requestBodyEvidence(undefined, 'openai-responses')).toEqual({ state: 'unavailable' })
    for (const body of ['{}', 'null', '[]', '{"input":"text"}']) {
      expect(requestBodyEvidence(body, 'openai-responses').state).toBe('unsupported-shape')
    }
    for (const body of ['bad SECRET', '{"input":[}', '{"input":[],"input":[]}']) {
      expect(requestBodyEvidence(body, 'openai-responses').state).toBe('invalid-json')
    }
  })
  it('bounds parse size, traversal depth, value count and key work explicitly', () => {
    expect(requestBodyEvidence(`{"input":["${'x'.repeat(REQUEST_BODY_EVIDENCE_LIMITS.bytes)}"]}`, 'openai-responses').state)
      .toBe('size-limit')
    const deep = `${'['.repeat(65)}0${']'.repeat(65)}`
    expect(requestBodyEvidence(`{"input":${deep}}`, 'openai-responses').state).toBe('work-limit')
    expect(requestBodyEvidence(JSON.stringify({ input: Array(REQUEST_BODY_EVIDENCE_LIMITS.values).fill(0) }), 'openai-responses').state)
      .toBe('work-limit')
    expect(requestBodyEvidence(JSON.stringify({ input: [], ['k'.repeat(129)]: 0 }), 'openai-responses').state).toBe('work-limit')
  })
  it('does not confuse malicious prototype keys with internal metadata or reveal their values', () => {
    const body = '{"input":[{"__proto__":{"type":"input_image","image_url":"SECRET"},"constructor":"SECRET"}]}'
    const result = requestBodyEvidence(body, 'openai-responses')
    expect(result).toMatchObject({ state: 'complete', imageBlockBytes: 0, opaqueReplayBytes: 0 })
    expect(JSON.stringify(result)).not.toContain('SECRET')
    expect({}).not.toHaveProperty('image_url')
  })
  it('reports empty conversations and arbitrary future protocol content as measured residual bytes', () => {
    for (const protocol of ['openai-responses', 'openai-completions', 'anthropic-messages'] satisfies RequestBodyProtocol[]) {
      const key = protocol === 'openai-responses' ? 'input' : 'messages'
      expect(requestBodyEvidence(JSON.stringify({ [key]: [], future: '未知', tools: [] }), protocol))
        .toMatchObject({ state: 'complete', conversationBytes: 2, imageBlockBytes: 0, opaqueReplayBytes: 0,
          toolSchemaBytes: 2, remainingConversationBytes: 2 })
    }
  })
  it('measures a nine MiB native-style inline image without exposing or decoding it', () => {
    const image = { type: 'input_image', image_url: `data:image/png;base64,${'A'.repeat(9 * 1024 * 1024)}` }
    const body = JSON.stringify({ input: [{ role: 'user', content: [image] }] })
    expect(requestBodyEvidence(body, 'openai-responses'))
      .toMatchObject({ state: 'complete', totalBytes: Buffer.byteLength(body), imageBlockBytes: bytes(image) })
  })
  it('counts valid image references and nested tool-result content but not future metadata lookalikes', () => {
    const image = { type: 'image', source: { type: 'url', url: 'https://example.test/private.png' } }
    const opaque = { type: 'redacted_thinking', data: 'PRIVATE_OPAQUE' }
    const conversation = [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'private',
      content: [image], metadata: { content: [image], signature: 'PRIVATE' } }] },
    { role: 'assistant', content: [opaque] }]
    expect(requestBodyEvidence(JSON.stringify({ messages: conversation }), 'anthropic-messages'))
      .toMatchObject({ state: 'complete', imageBlockBytes: bytes(image), opaqueReplayBytes: bytes('PRIVATE_OPAQUE') })
    expect(requestBodyEvidence(JSON.stringify({ input: [{ role: 'user', content: [
      { type: 'input_image', file_id: 'file-private' }, { type: 'input_image' },
    ] }] }), 'openai-responses')).toMatchObject({ state: 'complete',
      imageBlockBytes: bytes({ type: 'input_image', file_id: 'file-private' }) })
  })
  it('does not treat escaped duplicate keys or a literal payload as a successful measurement', () => {
    expect(requestBodyEvidence('{"input":[],"\\u0069nput":[]}', 'openai-responses').state).toBe('invalid-json')
    const body = '{"input":[true,false,null,123.5,-4.2e10,"x\\\\\\"y\\n"]}'
    expect(requestBodyEvidence(body, 'openai-responses')).toMatchObject({
      state: 'complete', imageBlockBytes: 0, opaqueReplayBytes: 0,
    })
  })
  it('labels only a valid measured round trip, never an upload duration or inferred partial composition', () => {
    const evidence = requestBodyEvidence('{"input":[]}', 'openai-responses')
    expect(formatRequestBodyEvidence(evidence, 123.6)).toContain('124 ms (round trip, not upload duration)')
    expect(formatRequestBodyEvidence(evidence, 0)).toContain('0 ms')
    for (const elapsed of [undefined, NaN, Infinity, -1, -0.4, Number.MAX_SAFE_INTEGER * 2]) {
      expect(formatRequestBodyEvidence(evidence, elapsed)).toContain('timing unavailable')
    }
    for (const state of ['unavailable', 'size-limit', 'work-limit', 'invalid-json', 'unsupported-shape'] as const) {
      expect(formatRequestBodyEvidence({ state, totalBytes: 100 }, 50))
        .toBe(`Composition unavailable (${state}); no partial totals inferred. Fetch-to-response-headers: 50 ms (round trip, not upload duration).`)
    }
  })
})
