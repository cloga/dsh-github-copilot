import '@earendil-works/pi-ai/api/openai-responses'
import type { Context, StreamOptions } from '@earendil-works/pi-ai'
import { githubCopilotProvider } from '@earendil-works/pi-ai/providers/github-copilot'
import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all'
import { normalizeContext } from '@earendil-works/pi-ai/utils/transcript'
import { describe, expect, it, vi } from 'vitest'
import { normalizeCopilotResponsesPayload } from '../src/responses-replay-compat.ts'

const encryptedBytes = 'synthetic-opaque-bytes+/=\u0000'
const summaryText = 'synthetic-private-summary'
const callId = 'synthetic-call'

function events(terminalEncryption: boolean): Response {
  const reasoning = {
    type: 'reasoning', id: 'synthetic-private-reasoning', status: 'completed',
    summary: [{ type: 'summary_text', text: summaryText }],
  }
  const call = {
    type: 'function_call', id: 'synthetic-private-call', status: 'completed',
    call_id: callId, name: 'check', arguments: '{"value":"synthetic-private-argument"}',
  }
  const stream = [
    { type: 'response.created', response: { id: 'synthetic-private-response' } },
    { type: 'response.output_item.added', output_index: 0, item: { type: 'reasoning', id: reasoning.id } },
    { type: 'response.reasoning_summary_text.delta', output_index: 0, summary_index: 0, delta: summaryText },
    { type: 'response.output_item.done', output_index: 0, item: reasoning },
    { type: 'response.output_item.added', output_index: 1, item: { ...call, arguments: '' } },
    { type: 'response.function_call_arguments.delta', output_index: 1, delta: call.arguments },
    { type: 'response.output_item.done', output_index: 1, item: call },
    { type: 'response.completed', response: {
      status: 'completed',
      output: [{ ...reasoning, ...terminalEncryption ? { encrypted_content: encryptedBytes } : {} }, call],
      usage: { input_tokens: 1, output_tokens: 2 },
    } },
  ]
  return new Response(stream.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), {
    headers: { 'content-type': 'text/event-stream' },
  })
}

describe('pinned native Responses SDK replay', () => {
  it.each([false, true])('preserves terminal backfill=%s and refuses summary-only replay before dispatch', async terminalEncryption => {
    const provider = githubCopilotProvider()
    const model = getBuiltinModels('github-copilot').find(entry => entry.api === 'openai-responses')
    if (model === undefined) throw new Error('FIXTURE_RESPONSES_MODEL_UNAVAILABLE')
    const bodies: Record<string, unknown>[] = []
    const fetch = vi.fn<NonNullable<StreamOptions['fetch']>>(async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      return events(terminalEncryption)
    })
    const run = async (context: Context) => {
      const stream = provider.streamSimple(model, normalizeContext(context), {
        apiKey: 'synthetic-token', maxRetries: 0, fetch,
        onPayload: payload => normalizeCopilotResponsesPayload(payload),
      })
      for await (const _event of stream) { /* Drain the unchanged pinned SDK. */ }
      return await stream.result()
    }
    const user = { role: 'user' as const, content: 'synthetic task', timestamp: 0 }
    const first = await run({ messages: [user] })
    expect(first.stopReason).toBe('toolUse')
    const thinking = first.content.find(block => block.type === 'thinking')
    if (thinking?.type !== 'thinking' || thinking.thinkingSignature === undefined) {
      throw new Error('FIXTURE_REASONING_SIGNATURE_UNAVAILABLE')
    }
    const signature: unknown = JSON.parse(thinking.thinkingSignature)
    expect(signature).toMatchObject({ type: 'reasoning', summary: [{ type: 'summary_text', text: summaryText }] })
    if (terminalEncryption) expect(signature).toHaveProperty('encrypted_content', encryptedBytes)
    else expect(signature).not.toHaveProperty('encrypted_content')
    const toolCall = first.content.find(block => block.type === 'toolCall')
    if (toolCall?.type !== 'toolCall') throw new Error('FIXTURE_TOOL_CALL_UNAVAILABLE')
    const context: Context = { messages: [
      user, first,
      { role: 'toolResult', toolCallId: toolCall.id, toolName: toolCall.name,
        content: [{ type: 'text', text: 'synthetic-private-result' }], isError: false, timestamp: 0 },
    ] }
    const originalHistory = JSON.stringify(context)
    const second = await run(context)
    expect(JSON.stringify(context)).toBe(originalHistory)
    if (!terminalEncryption) {
      expect(second.stopReason).toBe('error')
      expect(second.errorMessage).toContain('REASONING_WITHOUT_ENCRYPTED_CONTENT')
      expect(second.errorMessage).toContain('inputIndex=1')
      expect(second.errorMessage).not.toMatch(/synthetic-private|synthetic-opaque/)
      expect(fetch).toHaveBeenCalledTimes(1)
    } else {
      expect(second.stopReason).toBe('toolUse')
      expect(fetch).toHaveBeenCalledTimes(2)
      const input = bodies[1]!.input as Record<string, unknown>[]
      expect(input.find(item => item.type === 'reasoning')).toEqual({
        type: 'reasoning', status: 'completed',
        summary: [{ type: 'summary_text', text: summaryText }], encrypted_content: encryptedBytes,
      })
      expect(input.find(item => item.type === 'reasoning')).not.toHaveProperty('id')
      expect(input.find(item => item.type === 'function_call')).toMatchObject({ call_id: callId })
      expect(input.find(item => item.type === 'function_call_output')).toMatchObject({ call_id: callId })
    }
  })
})
