import '@earendil-works/pi-ai/api/openai-responses'
import '@earendil-works/pi-ai/api/openai-completions'
import '@earendil-works/pi-ai/api/anthropic-messages'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import { afterEach, expect, it, vi } from 'vitest'
import { CopilotAccountsHost } from '../../src/copilot-accounts-host.ts'
import previewPlugin from '../../src/preview-route.ts'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const MODEL = 'synthetic-independent-model'
const key = (id: string) => `github-copilot/account-${id}`
afterEach(() => vi.unstubAllGlobals())

it.each(['/responses', '/chat/completions', '/v1/messages'])(
  'binds preparation and native %s dispatch to the active account without copying the canonical grant', async endpoint => {
  const ctx = new Context()
  let selected = A, revision = 1
  const records = new Map([A, B].map(id => [key(id), { kind: 'grant', payload: {
    type: 'oauth', refresh: `synthetic-github-${id}`, access: `synthetic-access-${id}`,
    expires: Date.now() + 7_200_000, availableModelIds: [MODEL],
  } }]))
  const read = vi.fn(async (key: string) => records.get(key))
  const wireTokens: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input)
    if (url === 'https://api.github.com/user') return Response.json({ login: 'synthetic-user', id: 2 })
    if (url.endsWith('/models')) return Response.json({ data: [{
      id: MODEL, name: MODEL, model_picker_enabled: true, policy: { state: 'enabled' },
      supported_endpoints: [endpoint],
      capabilities: { type: 'chat', family: 'synthetic', tokenizer: 'o200k_base',
        supports: { tool_calls: true, streaming: true, vision: false },
        limits: { max_context_window_tokens: 128000, max_prompt_tokens: 96000, max_output_tokens: 4096 } },
    }] })
    if (new URL(url).pathname.endsWith(endpoint)) {
      const headers = new Headers(init?.headers)
      wireTokens.push(headers.get('Authorization') ?? headers.get('x-api-key') ?? 'missing')
      if (endpoint === '/chat/completions') return new Response(
        `data: ${JSON.stringify({ id: 'synthetic-response', choices: [{ index: 0, delta: { content: 'hello' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\ndata: [DONE]\n\n`,
        { headers: { 'content-type': 'text/event-stream' } })
      if (endpoint === '/v1/messages') return new Response(
        `event: message_start\ndata: ${JSON.stringify({ type: 'message_start', message: { id: 'synthetic', type: 'message',
          role: 'assistant', model: MODEL, content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 0 } } })}\n\n`
        + 'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n'
        + 'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hello"}}\n\n'
        + 'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n'
        + `event: message_delta\ndata: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } })}\n\n`
        + 'event: message_stop\ndata: {"type":"message_stop"}\n\n', { headers: { 'content-type': 'text/event-stream' } })
      return new Response('data: {"type":"response.output_item.added","output_index":0,"item":{"id":"synthetic-message","type":"message","role":"assistant","content":[]}}\n\n'
        + 'data: {"type":"response.output_text.delta","output_index":0,"delta":"hello"}\n\n'
        + `data: ${JSON.stringify({ type: 'response.completed',
        response: { id: 'synthetic-response', status: 'completed', output: [],
          usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } })}\n\n`,
      { headers: { 'content-type': 'text/event-stream' } })
    }
    throw new Error('Unexpected fixture request')
  }))
  try {
    ctx.provide('credentials', { readRecord: read, listRecords: async () => [...records.keys()].map(key => ({ key, kind: 'grant' })),
      modifyRecord: async () => { throw new Error('Valid test tokens must not refresh') },
      deleteRecord: async () => { throw new Error('No fixture deletion') } })
    ctx.provide('settings', { describe: () => [{ ns: 'github-copilot', revision, value: { activeAccountId: selected } }],
      mutate: async (_namespace: string, operations: readonly { value: string }[], expected: number) => {
        expect(expected).toBe(revision)
        selected = operations[0]!.value; revision++
      } })
    const accounts = new CopilotAccountsHost(ctx, { routeDiagnostic: () => undefined })
    ctx.provide('githubCopilotAccounts', { host: accounts })
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(previewPlugin, {})
    const request = { provider: 'github-copilot-preview', model: MODEL }
    const messages = [createUserMessage({ content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } })]
    const pending = await ctx.llm.prepareCall(request)
    expect(await accounts.switchAccount(B, 1)).toMatchObject({ diagnostic: 'COPILOT_ACCOUNTS_BUSY' })
    const first = new BlockAssembler()
    let checkedStream = false
    for await (const chunk of pending.stream({ ...pending.config, messages })) {
      first.push(chunk)
      if (!checkedStream) {
        checkedStream = true
        ctx.emit('credentials/record-updated', credentialKey('github-copilot', `account-${B}`))
        expect(await accounts.switchAccount(B, 1)).toMatchObject({ diagnostic: 'COPILOT_ACCOUNTS_BUSY' })
      }
    }
    expect(first.finish).toEqual({ kind: 'stop' })
    expect(wireTokens).toEqual([expect.stringContaining(`synthetic-access-${A}`)])
    expect(await accounts.switchAccount(B, 1)).toMatchObject({ state: 'ready', activeAccountId: B })
    const current = await ctx.llm.prepareCall(request)
    const second = new BlockAssembler()
    for await (const chunk of current.stream({ ...current.config, messages })) second.push(chunk)
    expect(second.finish).toEqual({ kind: 'stop' })
    expect(wireTokens).toEqual([expect.stringContaining(`synthetic-access-${A}`), expect.stringContaining(`synthetic-access-${B}`)])
    expect(() => pending.stream({ ...pending.config, messages }))
      .toThrow('a prepared LLM call can only be dispatched once')
    expect(wireTokens).toHaveLength(2)
    expect(read.mock.calls.every(([key]) => key.startsWith('github-copilot/account-'))).toBe(true)
    accounts.dispose()
  } finally { await ctx.fiber.dispose() }
})
