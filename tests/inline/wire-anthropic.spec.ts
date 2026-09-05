/**
 * Anthropic wire tests: the inline stream maps a fake Anthropic event
 * stream onto the harness StreamChunk contract — text, thinking, local
 * tool_use, server-side web search skipping, usage/terminal mapping, HTTP
 * failures, transport aborts — without ever throwing.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { inlineAnthropicStream } from '../../src/wire-anthropic.ts'
import type { InlineConfig } from '../../src/config.ts'
import type { SearchPlanCandidate } from '../../src/plan.ts'
import { markAgentLoopRequest } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, Message, StreamChunk } from '@deepseek-ai/dsh-llm'

const encoder = new TextEncoder()

function sseBody(events: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const event of events) controller.enqueue(encoder.encode(event))
      controller.close()
    },
  })
}

function event(type: string, data: unknown): string {
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`
}

const cfg: InlineConfig = {
  enabled: true,
  providers: [],
  includeSources: true,
  stripServerTools: true,
  idleTimeoutMs: 300_000,
  probe: false,
  probeTimeoutMs: 30_000,
}

const candidate: SearchPlanCandidate = {
  protocol: 'anthropic-messages',
  baseURL: 'https://gw.test/v1',
  model: 'm',
  apiKeyEnv: 'KEY',
  apiVersion: '2023-06-01',
}
const hooks = { resolveApiKey: async () => 'secret' }

function request(overrides: Partial<GenerateOptions> = {}): GenerateOptions {
  return markAgentLoopRequest({
    provider: 'p',
    model: 'deepseek-v4-flash',
    messages: [{ id: 'u1' as Message['id'], role: 'user', content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } }],
    ...overrides,
  })
}

async function collect(request: GenerateOptions): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = []
  for await (const chunk of inlineAnthropicStream(request, candidate, hooks, cfg)) chunks.push(chunk)
  return chunks
}

/** A full search round: text -> server_tool_use -> result -> answer text. */
function searchStream(): string[] {
  return [
    event('message_start', { type: 'message_start', message: { id: 'msg_1', usage: { input_tokens: 0, output_tokens: 0 } } }),
    event('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text' } }),
    event('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Let me ' } }),
    event('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'search.' } }),
    event('content_block_stop', { type: 'content_block_stop', index: 0 }),
    event('content_block_start', { type: 'content_block_start', index: 1, content_block: { type: 'server_tool_use', id: 'call_1', name: 'web_search', input: {} } }),
    event('content_block_delta', { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"queries":["node"]}' } }),
    event('content_block_stop', { type: 'content_block_stop', index: 1 }),
    event('content_block_start', { type: 'content_block_start', index: 2, content_block: { type: 'web_search_tool_result', tool_use_id: 'call_1', content: [{ type: 'web_search_result', title: 't', url: 'u' }] } }),
    event('content_block_stop', { type: 'content_block_stop', index: 2 }),
    event('content_block_start', { type: 'content_block_start', index: 3, content_block: { type: 'text' } }),
    event('content_block_delta', { type: 'content_block_delta', index: 3, delta: { type: 'text_delta', text: 'Node 22 is current' } }),
    event('content_block_stop', { type: 'content_block_stop', index: 3 }),
    event('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 40 } }),
    event('message_stop', { type: 'message_stop' }),
  ]
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('inlineAnthropicStream', () => {
  it('streams text and skips server-side web search blocks', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(sseBody(searchStream()), { status: 200 })))
    const chunks = await collect(request())
    const types = chunks.map(chunk => chunk.type)
    // server_tool_use / web_search_tool_result never slot: no tool-call blocks.
    expect(types).not.toContain('tool-call-delta')
    const text = chunks
      .filter((chunk): chunk is Extract<StreamChunk, { type: 'text-delta' }> => chunk.type === 'text-delta')
      .map(chunk => chunk.text)
      .join('')
    expect(text).toBe('Let me search.Node 22 is current')
    expect(chunks).toContainEqual(expect.objectContaining({
      type: 'usage',
      usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 40 },
    }))
    expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'stop' } })
  })

  it('maps thinking deltas to reasoning chunks', async () => {
    const stream = [
      event('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } }),
      event('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'think' } }),
      event('content_block_stop', { type: 'content_block_stop', index: 0 }),
      event('content_block_start', { type: 'content_block_start', index: 1, content_block: { type: 'text' } }),
      event('content_block_delta', { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'answer' } }),
      event('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { input_tokens: 1, output_tokens: 1 } }),
      event('message_stop', { type: 'message_stop' }),
    ]
    vi.stubGlobal('fetch', vi.fn(async () => new Response(sseBody(stream), { status: 200 })))
    const chunks = await collect(request())
    expect(chunks).toContainEqual(expect.objectContaining({ type: 'reasoning-delta', text: 'think' }))
    expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'stop' } })
  })

  it('drops thinking blocks that never emit non-empty text', async () => {
    const stream = [
      event('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } }),
      event('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '' } }),
      event('content_block_stop', { type: 'content_block_stop', index: 0 }),
      event('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { input_tokens: 1, output_tokens: 1 } }),
      event('message_stop', { type: 'message_stop' }),
    ]
    vi.stubGlobal('fetch', vi.fn(async () => new Response(sseBody(stream), { status: 200 })))
    const chunks = await collect(request())
    expect(chunks.some(chunk => chunk.type === 'block-start' && chunk.blockType === 'reasoning')).toBe(false)
    expect(chunks.some(chunk => chunk.type === 'block-end' && chunk.block.type === 'reasoning')).toBe(false)
  })

  it('drops thinking blocks that emit only whitespace', async () => {
    const stream = [
      event('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } }),
      event('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '   ' } }),
      event('content_block_stop', { type: 'content_block_stop', index: 0 }),
      event('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { input_tokens: 1, output_tokens: 1 } }),
      event('message_stop', { type: 'message_stop' }),
    ]
    vi.stubGlobal('fetch', vi.fn(async () => new Response(sseBody(stream), { status: 200 })))
    const chunks = await collect(request())
    expect(chunks.some(chunk => chunk.type === 'block-start' && chunk.blockType === 'reasoning')).toBe(false)
    expect(chunks.some(chunk => chunk.type === 'block-end' && chunk.block.type === 'reasoning')).toBe(false)
  })

  it('slots local tool_use blocks and finishes with tool-calls', async () => {
    const stream = [
      event('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_1', name: 'bash', input: {} } }),
      event('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"cmd":"ls"}' } }),
      event('content_block_stop', { type: 'content_block_stop', index: 0 }),
      event('message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { input_tokens: 1, output_tokens: 1 } }),
      event('message_stop', { type: 'message_stop' }),
    ]
    vi.stubGlobal('fetch', vi.fn(async () => new Response(sseBody(stream), { status: 200 })))
    const chunks = await collect(request())
    const toolCall = chunks.find((chunk): chunk is Extract<StreamChunk, { type: 'block-end' }> => chunk.type === 'block-end')
    expect(toolCall?.block).toMatchObject({ type: 'tool-call', id: 'toolu_1', name: 'bash', arguments: '{"cmd":"ls"}' })
    expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'tool-calls' } })
  })

  it('maps max_tokens stop to max-tokens finish', async () => {
    const stream = [
      event('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text' } }),
      event('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'partial' } }),
      event('message_delta', { type: 'message_delta', delta: { stop_reason: 'max_tokens' }, usage: { input_tokens: 1, output_tokens: 1 } }),
      event('message_stop', { type: 'message_stop' }),
    ]
    vi.stubGlobal('fetch', vi.fn(async () => new Response(sseBody(stream), { status: 200 })))
    const chunks = await collect(request())
    expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'max-tokens' } })
  })

  it('maps refusal to an error finish', async () => {
    const stream = [
      event('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text' } }),
      event('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'no' } }),
      event('message_delta', { type: 'message_delta', delta: { stop_reason: 'refusal' }, usage: { input_tokens: 1, output_tokens: 1 } }),
      event('message_stop', { type: 'message_stop' }),
    ]
    vi.stubGlobal('fetch', vi.fn(async () => new Response(sseBody(stream), { status: 200 })))
    const chunks = await collect(request())
    const finish = chunks.at(-1) as Extract<StreamChunk, { type: 'finish' }>
    expect(finish.reason.kind).toBe('error')
  })

  it('maps HTTP 401 to an error finish with AUTH', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('denied', { status: 401 })))
    const chunks = await collect(request())
    const finish = chunks.at(-1) as Extract<StreamChunk, { type: 'finish' }>
    expect(finish.type).toBe('finish')
    expect(finish.reason.kind).toBe('error')
    if (finish.reason.kind === 'error') expect(finish.reason.failure.code).toBe('AUTH')
  })

  it('maps an anthropic error event to an error finish', async () => {
    const stream = [
      event('error', { type: 'error', error: { type: 'overloaded_error', message: 'upstream busy' } }),
    ]
    vi.stubGlobal('fetch', vi.fn(async () => new Response(sseBody(stream), { status: 200 })))
    const chunks = await collect(request())
    const finish = chunks.at(-1) as Extract<StreamChunk, { type: 'finish' }>
    expect(finish.reason.kind).toBe('error')
  })

  it('yields an aborted finish when the request signal aborts', async () => {
    const controller = new AbortController()
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      const signal = (init as RequestInit).signal
      return new Response(new ReadableStream({
        start(c) {
          c.enqueue(encoder.encode(event('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text' } })))
          signal?.addEventListener('abort', () => c.error(new Error('aborted')))
        },
      }), { status: 200 })
    }))
    const req = request({ signal: controller.signal })
    const chunks: StreamChunk[] = []
    for await (const chunk of inlineAnthropicStream(req, candidate, hooks, cfg)) {
      chunks.push(chunk)
      if (chunk.type === 'block-start') controller.abort()
    }
    const finish = chunks.at(-1) as Extract<StreamChunk, { type: 'finish' }>
    expect(finish.reason.kind).toBe('aborted')
  })

  it('yields a TIMEOUT finish when the idle watchdog trips', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      const signal = (init as RequestInit).signal
      return new Response(new ReadableStream({
        start(c) {
          c.enqueue(encoder.encode(event('message_start', { type: 'message_start', message: { id: 'm', usage: {} } })))
          signal?.addEventListener('abort', () => c.error(new Error('aborted')))
        },
      }), { status: 200 })
    }))
    const localCfg: InlineConfig = { ...cfg, idleTimeoutMs: 50 }
    const chunks: StreamChunk[] = []
    for await (const chunk of inlineAnthropicStream(request(), candidate, hooks, localCfg)) chunks.push(chunk)
    const finish = chunks.at(-1) as Extract<StreamChunk, { type: 'finish' }>
    expect(finish.type).toBe('finish')
    expect(finish.reason.kind).toBe('error')
    if (finish.reason.kind === 'error') expect(finish.reason.failure.code).toBe('TIMEOUT')
  })

  it('yields an error finish when resolveApiKey throws instead of throwing', async () => {
    const failingHooks = { resolveApiKey: async () => { throw new Error('credential service down') } }
    const chunks: StreamChunk[] = []
    for await (const chunk of inlineAnthropicStream(request(), candidate, failingHooks, cfg)) chunks.push(chunk)
    const finish = chunks.at(-1) as Extract<StreamChunk, { type: 'finish' }>
    expect(finish.type).toBe('finish')
    expect(finish.reason.kind).toBe('error')
  })

  it('merges message_start input usage with message_delta output usage', async () => {
    const stream = [
      event('message_start', { type: 'message_start', message: { id: 'msg_1', usage: { input_tokens: 100, output_tokens: 0, cache_read_input_tokens: 40, cache_creation_input_tokens: 10 } } }),
      event('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text' } }),
      event('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } }),
      event('content_block_stop', { type: 'content_block_stop', index: 0 }),
      event('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 50, output_tokens_details: { thinking_tokens: 7 } } }),
      event('message_stop', { type: 'message_stop' }),
    ]
    vi.stubGlobal('fetch', vi.fn(async () => new Response(sseBody(stream), { status: 200 })))
    const chunks = await collect(request())
    expect(chunks).toContainEqual(expect.objectContaining({
      type: 'usage',
      usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 40, cacheWriteTokens: 10, reasoningTokens: 7 },
    }))
  })

  it('closes open tool slots when the stream ends in an error event', async () => {
    const stream = [
      event('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_1', name: 'bash', input: {} } }),
      event('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{}' } }),
      // no content_block_stop: the error event must close the slot
      event('error', { type: 'error', error: { type: 'overloaded_error', message: 'upstream busy' } }),
    ]
    vi.stubGlobal('fetch', vi.fn(async () => new Response(sseBody(stream), { status: 200 })))
    const chunks = await collect(request())
    const toolCall = chunks.find((chunk): chunk is Extract<StreamChunk, { type: 'block-end' }> => chunk.type === 'block-end')
    expect(toolCall?.block).toMatchObject({ type: 'tool-call', id: 'toolu_1', name: 'bash' })
    expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'error' } })
  })

  it('falls back to stop for unknown stop reasons', async () => {
    const stream = [
      event('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text' } }),
      event('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } }),
      event('message_delta', { type: 'message_delta', delta: { stop_reason: 'weird_reason' }, usage: { input_tokens: 1, output_tokens: 1 } }),
      event('message_stop', { type: 'message_stop' }),
    ]
    vi.stubGlobal('fetch', vi.fn(async () => new Response(sseBody(stream), { status: 200 })))
    const chunks = await collect(request())
    expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'stop' } })
  })

  it('yields a transport error when the stream ends without message_stop', async () => {
    const stream = [
      event('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text' } }),
      event('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'partial' } }),
      // no message_stop
    ]
    vi.stubGlobal('fetch', vi.fn(async () => new Response(sseBody(stream), { status: 200 })))
    const chunks = await collect(request())
    const finish = chunks.at(-1) as Extract<StreamChunk, { type: 'finish' }>
    expect(finish.reason.kind).toBe('error')
    if (finish.reason.kind === 'error') expect(finish.reason.failure.code).toBe('TRANSPORT')
  })
})
