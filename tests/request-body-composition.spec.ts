import { describe, expect, it, vi } from 'vitest'
import { requestBodyComposition, REQUEST_BODY_COMPOSITION_LIMITS } from '../src/request-body-composition.ts'
import { requestBodyEvidence } from '../src/request-body-evidence.ts'

describe('cooperative large-request numeric span evidence', () => {
  it('partitions a 20.4 MiB request without parsing its payload object graph', async () => {
    const image = JSON.stringify({ type: 'input_image', image_url: `data:image/png;base64,${'A'.repeat(20 * 1024 * 1024)}` })
    const replay = JSON.stringify('PRIVATE_REPLAY'.repeat(32768))
    const input = `[{"content":[${image}],"role":"user"},{"encrypted_content":${replay},"type":"reasoning"}]`
    const tools = '[{"type":"function","parameters":{"type":"object"}}]'
    const body = `{"input":${input},"tools":${tools},"instructions":"PRIVATE_SYSTEM"}`
    const parse = vi.spyOn(JSON, 'parse')
    const result = await requestBodyComposition(body, 'openai-responses')
    expect(result).toMatchObject({ state: 'complete', totalBytes: Buffer.byteLength(body),
      conversationBytes: Buffer.byteLength(input), imageBlockBytes: Buffer.byteLength(image),
      opaqueReplayBytes: Buffer.byteLength(replay), toolSchemaBytes: Buffer.byteLength(tools) })
    expect(parse.mock.calls.every(([value]) => typeof value === 'string' && value.length <= 128)).toBe(true)
    parse.mockRestore()
    if (result.state !== 'complete') throw new Error('EXPECTED_COMPLETE')
    expect(result.conversationBytes + result.toolSchemaBytes + result.systemBytes + result.otherBytes).toBe(result.totalBytes)
    expect(result.imageBlockBytes + result.opaqueReplayBytes + result.remainingConversationBytes).toBe(result.conversationBytes)
    expect(JSON.stringify(result)).not.toContain('PRIVATE')
    expect(requestBodyEvidence(body, 'openai-responses').state).toBe('size-limit')
  })
  it.each(['openai-responses', 'openai-completions', 'anthropic-messages'] as const)(
    'matches existing exact span semantics for %s, including late discriminator fields', async protocol => {
      const image = protocol === 'openai-responses' ? { file_id: 'PRIVATE_FILE', type: 'input_image' }
        : protocol === 'openai-completions' ? { image_url: { url: 'PRIVATE_URL' }, type: 'image_url' }
          : { source: { data: 'PRIVATE_IMAGE', type: 'base64' }, type: 'image' }
      const opaque = protocol === 'openai-responses' ? { encrypted_content: 'PRIVATE_REPLAY', type: 'reasoning' }
        : { signature: 'PRIVATE_REPLAY', type: 'thinking' }
      const input = [{ content: [{ content: [image], type: 'tool_result', metadata: { content: [image] } }], role: 'user' },
        ...protocol === 'anthropic-messages' ? [{ content: [opaque], role: 'assistant' }] : [opaque]]
      const body = JSON.stringify({ [protocol === 'openai-responses' ? 'input' : 'messages']: input,
        tools: [{ parameters: { type: 'object' } }], instructions: '中文 😀', system: ['中文 😀'] }, null, 2)
      expect(await requestBodyComposition(body, protocol)).toEqual(requestBodyEvidence(body, protocol))
    })
  it('counts escaped keys/spans, function output images and UTF-8 without content lookalikes', async () => {
    const body = ' {"\\u0069nput":[{"output":[{"image_url":"data:image\\/png;base64,\\u0041","type":"input_image"}],"type":"function_call_output"},'
      + '{"text":"中文 😀 \\uD800","metadata":{"content":[{"type":"input_image","file_id":"PRIVATE"}]}}],"tools":[]} \n'
    expect(await requestBodyComposition(body, 'openai-responses')).toEqual(requestBodyEvidence(body, 'openai-responses'))
  })
  it.each([
    '{"input":[],"\\u0069nput":[]}', '{"input":[01]}', '{"input":[1.]}', '{"input":[+1]}',
    '{"input":[NaN]}', '{"input":[true,]}', '{"input":[{"x":1,}]}', '{"input":["\\q"]}',
    '{"input":["\\u123x"]}', '{"input":["\u0001"]}', '{"input":[]} trailing',
  ])('rejects malformed or ambiguous spans without partial success: %s', async body => {
    expect((await requestBodyComposition(body, 'openai-responses')).state).toBe('invalid-json')
  })
  it('bounds bytes, depth, values and keys without changing replay recovery limits', async () => {
    expect((await requestBodyComposition(`{"input":["${'x'.repeat(REQUEST_BODY_COMPOSITION_LIMITS.bytes)}"]}`,
      'openai-responses')).state).toBe('size-limit')
    for (const body of [`{"input":${'['.repeat(65)}0${']'.repeat(65)}}`,
      JSON.stringify({ input: Array(65536).fill(0) }), JSON.stringify({ input: [], ['k'.repeat(129)]: 0 })]) {
      expect((await requestBodyComposition(body, 'openai-responses')).state).toBe('work-limit')
    }
  })
  it('yields to cancellation without treating incomplete work as healthy zero composition', async () => {
    const controller = new AbortController()
    const work = requestBodyComposition(`{"input":["${'x'.repeat(21 * 1024 * 1024)}"]}`, 'openai-responses',
      { signal: controller.signal })
    setImmediate(() => controller.abort())
    expect(await work).toMatchObject({ state: 'cancelled' })
  })
  it('preserves unavailable and unsupported evidence', async () => {
    expect(await requestBodyComposition(undefined, 'openai-responses')).toEqual({ state: 'unavailable' })
    for (const body of ['{}', '[]', 'null', '{"input":"not-array"}']) {
      expect((await requestBodyComposition(body, 'openai-responses')).state).toBe('unsupported-shape')
    }
  })
  it('bounds concurrent scans independently of native requests', async () => {
    const scans = Array.from({ length: REQUEST_BODY_COMPOSITION_LIMITS.concurrent },
      () => requestBodyComposition('{"input":[]}', 'openai-responses'))
    expect(await requestBodyComposition('{"input":[]}', 'openai-responses')).toMatchObject({ state: 'work-limit' })
    expect((await Promise.all(scans)).every(result => result.state === 'complete')).toBe(true)
  })
  it('checks monotonic elapsed time after yielding and releases the scan slot', async () => {
    const clock = vi.spyOn(performance, 'now').mockReturnValueOnce(0)
      .mockReturnValue(REQUEST_BODY_COMPOSITION_LIMITS.elapsedMs)
    try {
      expect(await requestBodyComposition('{"input":[]}', 'openai-responses')).toMatchObject({ state: 'time-limit' })
    } finally { clock.mockRestore() }
    expect(await requestBodyComposition('{"input":[]}', 'openai-responses')).toMatchObject({ state: 'complete' })
  })
  it('allows long future discriminator strings without decoding or guessing capabilities', async () => {
    const body = JSON.stringify({ input: [{ type: 'PRIVATE'.repeat(500), content: 'PRIVATE' }] })
    expect(await requestBodyComposition(body, 'openai-responses')).toEqual(requestBodyEvidence(body, 'openai-responses'))
  })
})
