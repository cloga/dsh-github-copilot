import { describe, expect, it, vi } from 'vitest'
import { stream } from '@earendil-works/pi-ai/api/openai-responses'
import type { Context, Model } from '@earendil-works/pi-ai'
import { normalizeContext } from '@earendil-works/pi-ai/utils/transcript'
import { normalizeCopilotResponsesPayload } from '../src/responses-replay-compat.ts'

const model: Model<'openai-responses'> = {
  id: 'synthetic-replay-model', name: 'Synthetic replay model', provider: 'github-copilot-preview',
  api: 'openai-responses', baseUrl: 'https://api.individual.githubcopilot.com', reasoning: true,
  input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 65536, maxTokens: 8192,
}

function events(terminalEncryption: boolean): Response {
  const reasoning = { type: 'reasoning', id: 'rs_synthetic', status: 'completed',
    summary: [{ type: 'summary_text', text: 'Public synthetic summary.' }] }
  const message = { type: 'message', id: 'msg_synthetic', role: 'assistant', status: 'completed',
    content: [{ type: 'output_text', text: 'Done.', annotations: [] }] }
  const output = [terminalEncryption ? { ...reasoning, encrypted_content: 'synthetic-opaque-exact' } : reasoning, message]
  return new Response([
    { type: 'response.output_item.done', output_index: 0, item: reasoning },
    { type: 'response.output_item.done', output_index: 1, item: message },
    { type: 'response.completed', response: { status: 'completed', output,
      usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 } } },
  ].map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } })
}

async function invoke(context: Context, terminalEncryption: boolean) {
  const bodies: Record<string, unknown>[] = []
  const fetch = vi.fn(async (_input: unknown, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
    return events(terminalEncryption)
  })
  const payloads: unknown[] = []
  const response = stream(model, normalizeContext(context), { apiKey: 'synthetic-never-networked-key', fetch, maxRetries: 0,
    onPayload: payload => { payloads.push(payload); return normalizeCopilotResponsesPayload(payload) } })
  for await (const _event of response) { /* Real SDK decoding; fake transport only. */ }
  return { result: await response.result(), fetch, payloads, bodies }
}

describe('exact native SDK Responses replay shapes', () => {
  it('captures native summary-only reasoning and refuses the next request without dropping it', async () => {
    const first = await invoke({ messages: [{ role: 'user', content: 'Synthetic task', timestamp: 0 }] }, false)
    expect(first.result.stopReason).toBe('stop')
    expect(first.fetch).toHaveBeenCalledTimes(1)
    const thinking = first.result.content.find(block => block.type === 'thinking')
    if (thinking?.type !== 'thinking' || !thinking.thinkingSignature) throw new Error('Native reasoning signature absent')
    expect(JSON.parse(thinking.thinkingSignature)).toMatchObject({ type: 'reasoning', id: 'rs_synthetic', status: 'completed' })
    expect(JSON.parse(thinking.thinkingSignature)).not.toHaveProperty('encrypted_content')
    const before = JSON.stringify(first.result)
    const second = await invoke({ messages: [first.result, { role: 'user', content: 'Continue.', timestamp: 1 }] }, false)
    expect(second.result.stopReason).toBe('error')
    expect(second.result.errorMessage).toContain('REASONING_WITHOUT_ENCRYPTED_CONTENT')
    expect(second.fetch).not.toHaveBeenCalled()
    expect(JSON.stringify(first.result)).toBe(before)
    expect(second.payloads).toHaveLength(1)
  })

  it('uses SDK terminal encryption backfill and replays unchanged opaque bytes without direct item IDs', async () => {
    const first = await invoke({ messages: [{ role: 'user', content: 'Synthetic task', timestamp: 0 }] }, true)
    expect(first.result.stopReason).toBe('stop')
    const thinking = first.result.content.find(block => block.type === 'thinking')
    if (thinking?.type !== 'thinking' || !thinking.thinkingSignature) throw new Error('Native reasoning signature absent')
    expect(JSON.parse(thinking.thinkingSignature)).toHaveProperty('encrypted_content', 'synthetic-opaque-exact')
    const before = JSON.stringify(first.result)
    const second = await invoke({ messages: [first.result, { role: 'user', content: 'Continue.', timestamp: 1 }] }, true)
    expect(second.result.stopReason).toBe('stop')
    expect(second.fetch).toHaveBeenCalledTimes(1)
    const input = second.bodies[0]?.input as Array<Record<string, unknown>>
    expect(input.find(item => item.type === 'reasoning')).toEqual({ type: 'reasoning', status: 'completed',
      summary: [{ type: 'summary_text', text: 'Public synthetic summary.' }], encrypted_content: 'synthetic-opaque-exact' })
    expect(input.some(item => Object.hasOwn(item, 'id'))).toBe(false)
    expect(JSON.stringify(first.result)).toBe(before)
  })
})
