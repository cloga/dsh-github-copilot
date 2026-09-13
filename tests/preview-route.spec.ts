import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { BlockAssembler, createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, Message } from '@deepseek-ai/dsh-llm'
import * as CorePiAi from '@deepseek-ai/dsh-llm-pi-ai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import previewPlugin from '../src/preview-route.ts'
import type { PreviewRouteConfig } from '../src/preview-route.ts'
import { GITHUB_COPILOT_CREDENTIAL_KEY as KEY, GITHUB_COPILOT_PREVIEW_PROVIDER_ID as PREVIEW, GITHUB_COPILOT_PREVIEW_MODEL_ID as MODEL } from '../src/copilot-identity.ts'

interface RecordValue { kind: 'grant'; payload: Record<string, unknown> }
const contexts: Context[] = []
function grant(overrides: Record<string, unknown> = {}): RecordValue {
  return { kind: 'grant', payload: { type: 'oauth', refresh: 'synthetic-account-a', access: 'synthetic-current-access',
    expires: Date.now() + 3_600_000, availableModelIds: [MODEL, 'gemini-3.5-flash', 'claude-sonnet-4.5'], ...overrides } }
}
async function runtime(initial: RecordValue | undefined = grant(), config: PreviewRouteConfig = {}) {
  const ctx = new Context()
  contexts.push(ctx)
  let current: RecordValue | undefined = initial
  let queue = Promise.resolve()
  const reads = vi.fn(async (key: string) => { expect(key).toBe(KEY); return current })
  const modify = vi.fn((key: string, change: (value: RecordValue | undefined) => Promise<RecordValue | undefined>) => {
    expect(key).toBe(KEY)
    const work = queue.then(async () => {
      const previous = JSON.stringify(current)
      const next = await change(current)
      // The public Host contract uses undefined to decline a write, not delete.
      if (next !== undefined) current = next
      if (JSON.stringify(current) !== previous) ctx.emit('credentials/record-updated', KEY as never)
      return current
    })
    queue = work.then(() => undefined, () => undefined)
    return work
  })
  await ctx.plugin({ apply(owner: Context) {
    owner.provide('credentials', {
      readRecord: reads,
      modifyRecord: modify,
      listRecords: async () => current ? [{ key: KEY, kind: 'grant' }] : [],
      deleteRecord: async (key: string) => { expect(key).toBe(KEY); current = undefined; ctx.emit('credentials/record-updated', KEY as never) },
    } as unknown as Context['credentials'])
  } })
  await ctx.plugin(LlmRuntime)
  const registration = vi.spyOn(ctx.llm, 'registerAdapter')
  const fiber = ctx.plugin(previewPlugin, config)
  await fiber
  await ctx.get('githubCopilotPreview')!.refresh()
  const adapter = registration.mock.calls[0]![1]
  // The fixture must exercise the adapter imported by this selected dependency
  // closure, not a second package merely named as the target version.
  expect(adapter).toBeInstanceOf(CorePiAi.PiAiAdapter)
  registration.mockRestore()
  return { ctx, fiber, reads, modify, adapter, current: () => current,
    replace(value: RecordValue | undefined) { current = value; ctx.emit('credentials/record-updated', KEY as never) },
  }
}
function event(type: string, data: Record<string, unknown>) { return `data: ${JSON.stringify({ type, ...data })}\n\n` }
function response(tool = false) {
  const reasoning = { type: 'reasoning', id: 'rs_synthetic', summary: [{ type: 'summary_text', text: 'Public summary.' }], encrypted_content: 'synthetic-opaque-replay' }
  const output = tool ? { type: 'function_call', id: 'fc_synthetic', call_id: 'call_synthetic', name: 'echo', arguments: '{"value":"hi"}' }
    : { type: 'message', id: 'msg_synthetic', role: 'assistant', content: [{ type: 'output_text', text: 'hello' }] }
  return new Response([
    event('response.created', { response: { id: 'resp_synthetic' } }),
    event('response.output_item.added', { output_index: 0, item: { type: 'reasoning', id: reasoning.id } }),
    event('response.reasoning_summary_text.delta', { output_index: 0, delta: 'Public summary.', summary_index: 0 }),
    event('response.output_item.done', { output_index: 0, item: reasoning }),
    event('response.output_item.added', { output_index: 1, item: output }),
    ...(tool ? [event('response.function_call_arguments.delta', { output_index: 1, delta: '{"value":"hi"}' })]
      : [event('response.output_text.delta', { output_index: 1, delta: 'hello' })]),
    event('response.output_item.done', { output_index: 1, item: output }),
    event('response.completed', { response: { status: 'completed', output: [reasoning, output], usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 } } }),
  ].join(''), { headers: { 'content-type': 'text/event-stream' } })
}
async function call(ctx: Context, options: Partial<GenerateOptions> = {}) {
  const model = options.model ?? MODEL
  const prepared = await ctx.llm.prepareCall({ provider: PREVIEW, model,
    ...options.reasoningEffort === undefined ? {} : { reasoningEffort: options.reasoningEffort } })
  const assembler = new BlockAssembler()
  const input: GenerateOptions = { ...prepared.config,
    messages: [createUserMessage({ content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } })], ...options }
  for await (const chunk of prepared.stream(input)) assembler.push(chunk)
  return { assembler, message: assembler.message({ kind: 'model', provider: PREVIEW, model,
    ...assembler.replayState === undefined ? {} : { replayState: assembler.replayState } }) }
}

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

function catalogItem(id: string, endpoint = '/responses', overrides: Record<string, unknown> = {}) {
  return { id, name: id, model_picker_enabled: true, policy: { state: 'enabled' }, supported_endpoints: [endpoint],
    capabilities: { supports: { streaming: true, tool_calls: true, vision: true, reasoning_effort: ['low', 'medium', 'high', 'xhigh', 'max'] },
      limits: { max_context_window_tokens: 1_050_000, max_prompt_tokens: 900_000, max_output_tokens: 128_000 } }, ...overrides }
}

function catalogResponse(items = [catalogItem(MODEL)]) { return new Response(JSON.stringify({ data: items }), { headers: { 'content-type': 'application/json' } }) }

let discoveryRequests: string[] = []
function stubFetch(handler: (input: unknown, init?: RequestInit) => Promise<Response>, customDiscovery = false): void {
  vi.stubGlobal('fetch', async (input: unknown, init?: RequestInit) => {
    if (String(input).endsWith('/models') && !customDiscovery) {
      discoveryRequests.push(String(input))
      return catalogResponse()
    }
    return handler(input, init)
  })
}
beforeEach(() => { discoveryRequests = []; stubFetch(async () => { throw new Error('Unexpected synthetic model request') }) })

describe('plugin-owned account Copilot route', () => {
  it('does not republish unchanged directories or fetch models during repeated snapshot reads', async () => {
    const harness = await runtime()
    const service = harness.ctx.get('githubCopilotPreview')!
    await service.discover()
    const updated = vi.fn()
    harness.ctx.on('llm/adapters-updated', updated)
    harness.modify.mockClear()
    for (let index = 0; index < 50; index++) {
      await service.refresh()
      service.getView()
      await harness.ctx.llm.listModels(PREVIEW)
    }
    expect(discoveryRequests).toHaveLength(1)
    expect(updated).not.toHaveBeenCalled()
    expect(harness.modify).not.toHaveBeenCalled()
    harness.replace(grant({ refresh: 'synthetic-account-b' }))
    await service.refresh()
    expect(service.getView().available).toBe(false)
    expect(updated).toHaveBeenCalled()
  })
  it('discovers mixed and unseen account models without model-name routing rules', async () => {
    const items = [catalogItem(MODEL), catalogItem('gemini-3.8-flash', '/chat/completions'),
      catalogItem('gpt-5.6-sol-fast'), catalogItem('future-lab-r17', '/v1/messages'),
      catalogItem('disabled-lab', '/responses', { policy: { state: 'disabled' } })]
    const fetch = vi.fn(async () => catalogResponse(items))
    stubFetch(fetch, true)
    const harness = await runtime()
    await expect(harness.ctx.llm.listModels(PREVIEW)).resolves.toEqual([])
    expect(fetch).not.toHaveBeenCalled()
    const service = harness.ctx.get('githubCopilotPreview')!
    const discovered = await service.discover()
    expect(discovered.models.map(model => [model.id, model.api])).toEqual([
      [MODEL, 'openai-responses'], ['gemini-3.8-flash', 'openai-completions'],
      ['gpt-5.6-sol-fast', 'openai-responses'], ['future-lab-r17', 'anthropic-messages'],
    ])
    expect(discovered.rejected).toContainEqual(expect.objectContaining({ id: 'disabled-lab' }))
    expect((await harness.ctx.llm.listModels(PREVIEW)).map(model => model.id)).toEqual(items.slice(0, 4).map(item => item.id))
    await service.refresh()
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(service.getView())).not.toMatch(/synthetic-current-access|synthetic-account-a|accountKey/)
  })

  it.each([
    ['/responses', 'openai-responses'], ['/chat/completions', 'openai-completions'], ['/v1/messages', 'anthropic-messages'],
  ])('prepares an arbitrary new ID and uses the native %s transport', async (endpoint, api) => {
    const id = 'future-lab-r17'
    const items = [catalogItem(id, endpoint, { capabilities: { supports: { streaming: true, tool_calls: true, vision: false },
      limits: { max_context_window_tokens: 64000, max_prompt_tokens: 48000, max_output_tokens: 8000 } } })]
    const calls: Array<{ url: string; body?: Record<string, unknown>; headers: Headers }> = []
    stubFetch(async (input, init) => {
      const url = String(input)
      calls.push({ url, ...init?.body === undefined ? {} : { body: JSON.parse(String(init.body)) }, headers: new Headers(init?.headers) })
      if (url.endsWith('/models')) return catalogResponse(items)
      if (api === 'openai-responses') return response()
      if (api === 'openai-completions') return new Response([
        `data: ${JSON.stringify({ id: 'chat_synthetic', object: 'chat.completion.chunk', created: 1, model: id, choices: [{ index: 0, delta: { role: 'assistant', content: 'hello' }, finish_reason: null }] })}\n\n`,
        `data: ${JSON.stringify({ id: 'chat_synthetic', object: 'chat.completion.chunk', created: 1, model: id, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\n`,
        'data: [DONE]\n\n',
      ].join(''), { headers: { 'content-type': 'text/event-stream' } })
      const packet = (type: string, body: Record<string, unknown>) => `event: ${type}\ndata: ${JSON.stringify({ type, ...body })}\n\n`
      return new Response([
        packet('message_start', { message: { id: 'msg_synthetic', type: 'message', role: 'assistant', model: id, content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 0 } } }),
        packet('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }),
        packet('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'hello' } }),
        packet('content_block_stop', { index: 0 }),
        packet('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } }),
        packet('message_stop', {}),
      ].join(''), { headers: { 'content-type': 'text/event-stream' } })
    }, true)
    const harness = await runtime(grant({ availableModelIds: [] }))
    const result = await call(harness.ctx, { model: id })
    expect(result.assembler.finish).toEqual({ kind: 'stop' })
    expect(result.message.content).toContainEqual({ type: 'text', text: 'hello' })
    expect(result.message.source).toMatchObject({ provider: PREVIEW, model: id })
    expect(calls).toHaveLength(2)
    const wireURL = new URL(calls[1]!.url)
    expect(wireURL.origin).toBe('https://api.individual.githubcopilot.com')
    expect(wireURL.pathname).toBe(endpoint)
    expect(wireURL.search).toBe(api === 'anthropic-messages' ? '?beta=true' : '')
    expect(calls[1]?.body?.model).toBe(id)
    expect(calls[1]?.headers.get('authorization')).toBe('Bearer synthetic-current-access')
    expect(harness.ctx.get('githubCopilotPreview')!.routeFacts(id)).toEqual({ api, baseURL: 'https://api.individual.githubcopilot.com' })
  })

  it('resolves Host-only search auth from the live generic snapshot without exposing it in status', async () => {
    const id = 'future-search-model'
    const fetch = vi.fn(async () => catalogResponse([catalogItem(id)]))
    stubFetch(fetch, true)
    const harness = await runtime(grant({ availableModelIds: [] }))
    const service = harness.ctx.get('githubCopilotPreview')!
    expect(service.routeFacts(id)).toBeUndefined()
    await expect(service.resolveRequestAuth(id)).resolves.toMatchObject({ apiKey: 'synthetic-current-access', baseURL: 'https://api.individual.githubcopilot.com',
      headers: { 'Copilot-Integration-Id': 'vscode-chat' } })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(service.getView())).not.toContain('synthetic-current-access')
    await expect(service.resolveRequestAuth('not-advertised')).rejects.toThrow(/ENTITLED/)
    expect(fetch).toHaveBeenCalledTimes(1)
    harness.replace(grant({ refresh: 'synthetic-other-account', access: 'synthetic-other-access' }))
    expect(service.routeFacts(id)).toBeUndefined()
    await service.refresh()
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('reports unsupported reasoning and unenforced input budgets without hiding a usable default model', async () => {
    const item = catalogItem('future-budget-model', '/responses', { capabilities: {
      supports: { streaming: true, tool_calls: true, vision: false, reasoning_effort: ['turbo'] },
      limits: { max_context_window_tokens: 64000, max_prompt_tokens: 32000, max_output_tokens: 8000 },
    } })
    stubFetch(async input => String(input).endsWith('/models') ? catalogResponse([item]) : response(), true)
    const harness = await runtime(grant({ availableModelIds: [] }))
    const view = await harness.ctx.get('githubCopilotPreview')!.discover()
    expect(view).toMatchObject({ available: true, rejected: [], warnings: [
      { id: item.id, code: 'INPUT_LIMIT_NOT_ENFORCED_BY_CORE' },
      { id: item.id, code: 'REASONING_EFFORTS_UNSUPPORTED' },
    ] })
    expect((await call(harness.ctx, { model: item.id })).assembler.finish).toEqual({ kind: 'stop' })
  })

  it('rejects explicitly requested off when a model has no advertised reasoning controls but keeps its default usable', async () => {
    const item = catalogItem('future-no-thinking', '/responses', { capabilities: {
      supports: { streaming: true, tool_calls: true, vision: false },
      limits: { max_context_window_tokens: 64000, max_prompt_tokens: 64000, max_output_tokens: 8000 },
    } })
    let modelRequests = 0
    stubFetch(async input => {
      if (String(input).endsWith('/models')) return catalogResponse([item])
      modelRequests++
      return response()
    }, true)
    const harness = await runtime(grant({ availableModelIds: [] }))
    await expect(call(harness.ctx, { model: item.id, reasoningEffort: ReasoningEffortId('off') })).rejects.toThrow(/does not support reasoning effort/)
    const prepared = await harness.adapter.prepareCall(PREVIEW, item.id)
    const direct = async () => {
      for await (const _chunk of prepared.stream({ provider: PREVIEW, model: item.id, messages: [], reasoningEffort: ReasoningEffortId('off') })) { /* consume public adapter boundary */ }
    }
    await expect(direct()).rejects.toThrow('COPILOT_PREVIEW_REASONING_UNSUPPORTED')
    expect(modelRequests).toBe(0)
    expect((await call(harness.ctx, { model: item.id })).assembler.finish).toEqual({ kind: 'stop' })
    expect(modelRequests).toBe(1)
  })

  it('requires rediscovery when an already prepared token rotates without a credential notification', async () => {
    const harness = await runtime()
    const prepared = await harness.ctx.llm.prepareCall({ provider: PREVIEW, model: MODEL })
    harness.current()!.payload.access = 'synthetic-rotated-without-event'
    const fetch = vi.fn(async () => response())
    stubFetch(fetch)
    const assembler = new BlockAssembler()
    for await (const chunk of prepared.stream({ ...prepared.config, messages: [] })) assembler.push(chunk)
    expect(assembler.finish.kind).toBe('error')
    expect(fetch).not.toHaveBeenCalled()
    expect((await call(harness.ctx)).assembler.finish).toEqual({ kind: 'stop' })
    expect(discoveryRequests).toHaveLength(2)
  })

  it('rejects silent same-token entitlement removal before dispatch and requires rediscovery', async () => {
    const harness = await runtime()
    const prepared = await harness.ctx.llm.prepareCall({ provider: PREVIEW, model: MODEL })
    harness.current()!.payload.availableModelIds = []
    const fetch = vi.fn(async () => response())
    stubFetch(fetch)
    const assembler = new BlockAssembler()
    for await (const chunk of prepared.stream({ ...prepared.config, messages: [] })) assembler.push(chunk)
    expect(assembler.finish.kind).toBe('error')
    expect(fetch).not.toHaveBeenCalled()
    expect(harness.ctx.get('githubCopilotPreview')!.routeFacts(MODEL)).toBeUndefined()
    expect((await call(harness.ctx)).assembler.finish).toEqual({ kind: 'stop' })
    expect(discoveryRequests).toHaveLength(2)
  })

  it.each(['refresh', 'list', 'search'] as const)('invalidates silent entitlement changes through read-only or search checks: %s', async check => {
    const harness = await runtime()
    const service = harness.ctx.get('githubCopilotPreview')!
    await service.discover()
    harness.current()!.payload.availableModelIds = []
    if (check === 'refresh') await service.refresh()
    else if (check === 'list') await expect(harness.ctx.llm.listModels(PREVIEW)).resolves.toEqual([])
    else {
      stubFetch(async () => new Response('not reachable', { status: 503 }), true)
      await expect(service.resolveRequestAuth(MODEL)).rejects.toThrow(/MODEL_SOURCE|METADATA_STALE/)
    }
    expect(service.routeFacts(MODEL)).toBeUndefined()
    expect(service.getView().available).toBe(false)
  })

  it('invalidates prepared model metadata on an explicit force-discovery without changing the selected ID', async () => {
    const harness = await runtime()
    const prepared = await harness.ctx.llm.prepareCall({ provider: PREVIEW, model: MODEL })
    await harness.ctx.get('githubCopilotPreview')!.discover({ force: true })
    const fetch = vi.fn(async () => response())
    stubFetch(fetch)
    const assembler = new BlockAssembler()
    for await (const chunk of prepared.stream({ ...prepared.config, messages: [] })) assembler.push(chunk)
    expect(assembler.finish.kind).toBe('error')
    expect(fetch).not.toHaveBeenCalled()
    expect((await call(harness.ctx)).assembler.finish).toEqual({ kind: 'stop' })
  })

  it('does not serve expired catalog facts or prepared model snapshots', async () => {
    const clock = vi.spyOn(Date, 'now')
    const start = Date.now()
    clock.mockReturnValue(start)
    try {
      const harness = await runtime()
      const prepared = await harness.ctx.llm.prepareCall({ provider: PREVIEW, model: MODEL })
      clock.mockReturnValue(start + 300_001)
      expect(harness.ctx.get('githubCopilotPreview')!.routeFacts(MODEL)).toBeUndefined()
      expect(harness.ctx.get('githubCopilotPreview')!.getView().state).toBe('stale')
      const fetch = vi.fn(async () => response())
      stubFetch(fetch)
      const assembler = new BlockAssembler()
      for await (const chunk of prepared.stream({ ...prepared.config, messages: [] })) assembler.push(chunk)
      expect(assembler.finish.kind).toBe('error')
      expect(fetch).not.toHaveBeenCalled()
    } finally { clock.mockRestore() }
  })

  it('uses unmodified stock LlmRuntime preparation and leaves canonical model registration alone', async () => {
    const harness = await runtime()
    await harness.ctx.plugin(CorePiAi, { providers: { 'github-copilot': { models: [
      { id: 'gemini-3.5-flash' }, { id: 'claude-sonnet-4.5' },
    ] } } })
    expect(harness.ctx.llm.listProviders().map(item => item.id)).toEqual([PREVIEW, 'github-copilot'])
    const info = await harness.ctx.llm.resolveModelInfo(PREVIEW, MODEL)
    expect(info).toMatchObject({ id: MODEL, provider: PREVIEW, context: { contextWindow: 1_050_000 } })
    expect(info.reasoning?.efforts.map(item => item.id)).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
    await expect(harness.ctx.llm.prepareCall({ provider: 'github-copilot', model: 'gemini-3.5-flash' })).resolves.toBeDefined()
    await expect(harness.ctx.llm.prepareCall({ provider: 'github-copilot', model: 'claude-sonnet-4.5' })).resolves.toBeDefined()
    await expect(harness.ctx.llm.prepareCall({ provider: PREVIEW, model: 'gpt-5.4' })).rejects.toThrow(/PREVIEW_MODEL/)
  })

  it('sends native Responses with alias identity and no accidental default effort none', async () => {
    const fetch = vi.fn(async (_input: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      expect(body.model).toBe(MODEL)
      expect(body.reasoning).toBeUndefined()
      const headers = new Headers(init?.headers)
      expect(headers.get('authorization')).toBe('Bearer synthetic-current-access')
      expect(headers.get('x-initiator')).toBe('user')
      expect(headers.get('openai-intent')).toBe('conversation-edits')
      expect(headers.get('copilot-integration-id')).toBe('vscode-chat')
      return response()
    })
    stubFetch(fetch)
    const harness = await runtime()
    const result = await call(harness.ctx)
    expect(fetch.mock.calls[0]?.[0]).toBe('https://api.individual.githubcopilot.com/responses')
    expect(result.assembler.finish).toEqual({ kind: 'stop' })
    expect(result.message.source).toMatchObject({ kind: 'model', provider: PREVIEW, model: MODEL })
    expect(result.message.content).toContainEqual({ type: 'reasoning', text: 'Public summary.' })
  })

  it.each(['high', 'max'])('preserves the native enabled reasoning setting %s and summary request', async effort => {
    const fetch = vi.fn(async (_input: unknown, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body)).reasoning).toEqual({ effort, summary: 'auto' })
      return response()
    })
    stubFetch(fetch)
    const harness = await runtime()
    expect((await call(harness.ctx, { reasoningEffort: ReasoningEffortId(effort) })).assembler.finish).toEqual({ kind: 'stop' })
  })

  it('replays opaque reasoning and tool-call identities through the native adapter on a second turn', async () => {
    const requests: Array<Record<string, unknown>> = []
    stubFetch(vi.fn(async (_input: unknown, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)))
      return response(requests.length === 1)
    }))
    const harness = await runtime()
    const first = await call(harness.ctx, { tools: [{ name: 'echo', description: 'echo', parameters: { type: 'object', properties: { value: { type: 'string' } } } }] })
    expect(first.assembler.finish).toEqual({ kind: 'tool-calls' })
    expect(first.message.source).toMatchObject({ replayState: { response: { provider: PREVIEW, model: MODEL } } })
    const tool = first.message.content.find(block => block.type === 'tool-call')!
    if (tool.type !== 'tool-call') throw new Error('expected native tool call')
    const second = await call(harness.ctx, { messages: [first.message, {
      id: 'synthetic-tool' as Message['id'], role: 'user', source: { kind: 'tool', callId: tool.id },
      content: [{ type: 'tool-result', toolCallId: tool.id, content: [{ type: 'text', text: 'hi' }], isError: false }],
    }] })
    expect(second.assembler.finish).toEqual({ kind: 'stop' })
    expect(requests[1]?.input).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'reasoning', encrypted_content: 'synthetic-opaque-replay' }),
      expect.objectContaining({ type: 'function_call', call_id: 'call_synthetic' }),
      expect.objectContaining({ type: 'function_call_output', call_id: 'call_synthetic' }),
    ]))
    expect(second.message.content.every(block => block.type !== 'text' || !block.text.includes('synthetic-opaque-replay'))).toBe(true)
  })

  it('keeps registration stable but refuses missing OAuth or server-revoked entitlement before model requests', async () => {
    const fetch = vi.fn(async (input: unknown) => {
      if (String(input).endsWith('/models')) return catalogResponse([catalogItem(MODEL, '/responses', { policy: { state: 'disabled' } })])
      throw new Error('model must not run')
    })
    stubFetch(fetch, true)
    const harness = await runtime(grant({ availableModelIds: [] }))
    expect(harness.ctx.llm.listProviders().some(item => item.id === PREVIEW)).toBe(true)
    await expect(harness.ctx.llm.listModels(PREVIEW)).resolves.toEqual([])
    await expect(harness.ctx.llm.prepareCall({ provider: PREVIEW, model: MODEL })).rejects.toThrow(/ENTITLED/)
    expect(fetch).toHaveBeenCalledTimes(1)
    harness.replace(undefined)
    vi.stubEnv('COPILOT_GITHUB_TOKEN', 'ambient-must-not-be-used')
    await expect(harness.ctx.llm.prepareCall({ provider: PREVIEW, model: MODEL })).rejects.toThrow(/OAUTH|CREDENTIAL/)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('refreshes the shared grant without aborting its own first model request', async () => {
    const fresh = 'tid=synthetic;proxy-ep=proxy.individual.githubcopilot.com;'
    const urls: string[] = []
    stubFetch(vi.fn(async (input: unknown) => {
      const url = String(input)
      urls.push(url)
      if (url.endsWith('/copilot_internal/v2/token')) return new Response(JSON.stringify({ token: fresh, expires_at: Math.floor(Date.now() / 1000) + 3600 }))
      if (url.endsWith('/models')) return catalogResponse()
      if (url.endsWith('/responses')) return response()
      throw new Error('unexpected synthetic URL')
    }), true)
    const harness = await runtime(grant({ expires: 0 }))
    const result = await call(harness.ctx)
    expect(result.assembler.finish).toEqual({ kind: 'stop' })
    expect(harness.modify).toHaveBeenCalledTimes(1)
    expect(harness.current()?.payload.access).toBe(fresh)
    expect(urls.filter(url => url.endsWith('/copilot_internal/v2/token'))).toHaveLength(1)
    expect(urls.filter(url => url.endsWith('/responses'))).toHaveLength(1)
  })

  it('serializes canonical and preview refresh through the same credential key', async () => {
    const fresh = 'tid=shared;proxy-ep=proxy.individual.githubcopilot.com;'
    let releaseToken: (() => void) | undefined
    let tokenRequests = 0
    let modelRequests = 0
    stubFetch(vi.fn(async (input: unknown) => {
      const url = String(input)
      if (url.endsWith('/copilot_internal/v2/token')) {
        tokenRequests++
        await new Promise<void>(resolve => { releaseToken = resolve })
        return new Response(JSON.stringify({ token: fresh, expires_at: Math.floor(Date.now() / 1000) + 3600 }))
      }
      if (url.endsWith('/models')) return catalogResponse([MODEL, 'gpt-5.4'].map(id => catalogItem(id)))
      if (url.endsWith('/responses')) { modelRequests++; return response() }
      throw new Error('unexpected synthetic URL')
    }), true)
    const harness = await runtime(grant({ expires: 0, availableModelIds: [MODEL, 'gpt-5.4'] }))
    await harness.ctx.plugin(CorePiAi, { providers: { 'github-copilot': { models: [{ id: 'gpt-5.4' }] } } })
    const preview = call(harness.ctx)
    const canonical = (async () => {
      const prepared = await harness.ctx.llm.prepareCall({ provider: 'github-copilot', model: 'gpt-5.4' })
      const assembler = new BlockAssembler()
      for await (const chunk of prepared.stream({ ...prepared.config, messages: [] })) assembler.push(chunk)
      return assembler
    })()
    await vi.waitFor(() => expect(harness.modify.mock.calls.length).toBeGreaterThanOrEqual(2))
    releaseToken!()
    const [previewResult, canonicalResult] = await Promise.all([preview, canonical])
    expect(previewResult.assembler.finish).toEqual({ kind: 'stop' })
    expect(canonicalResult.finish).toEqual({ kind: 'stop' })
    expect(tokenRequests).toBe(1)
    expect(modelRequests).toBe(2)
    expect(harness.modify.mock.calls.every(([key]) => key === KEY)).toBe(true)
    expect(harness.current()?.payload.access).toBe(fresh)
  })

  it('persists refreshed revocation but sends no model request after entitlement is removed', async () => {
    const urls: string[] = []
    stubFetch(vi.fn(async (input: unknown) => {
      const url = String(input)
      urls.push(url)
      if (url.endsWith('/copilot_internal/v2/token')) return new Response(JSON.stringify({ token: 'synthetic-refreshed', expires_at: Math.floor(Date.now() / 1000) + 3600 }))
      if (url.endsWith('/models')) return new Response(JSON.stringify({ data: [] }))
      throw new Error('model request must not run')
    }), true)
    const harness = await runtime(grant({ expires: 0 }))
    await expect(call(harness.ctx)).rejects.toThrow(/ENTITLED/)
    expect(harness.current()?.payload.availableModelIds).toEqual([])
    expect(urls.some(url => url.endsWith('/responses'))).toBe(false)
    await expect(harness.ctx.llm.prepareCall({ provider: PREVIEW, model: MODEL })).rejects.toThrow(/ENTITLED/)
  })

  it('persists token-refresh revocation after preparation but never authorizes it from the earlier live catalog', async () => {
    const harness = await runtime()
    const prepared = await harness.ctx.llm.prepareCall({ provider: PREVIEW, model: MODEL })
    harness.current()!.payload.expires = 0
    const urls: string[] = []
    stubFetch(async input => {
      const url = String(input)
      urls.push(url)
      if (url.endsWith('/copilot_internal/v2/token')) return new Response(JSON.stringify({ token: 'synthetic-revoked-token', expires_at: Math.floor(Date.now() / 1000) + 3600 }))
      if (url.endsWith('/models')) return catalogResponse([])
      throw new Error('revoked model must not run')
    }, true)
    const assembler = new BlockAssembler()
    for await (const chunk of prepared.stream({ ...prepared.config, messages: [] })) assembler.push(chunk)
    expect(assembler.finish.kind).toBe('error')
    expect(harness.current()?.payload.access).toBe('synthetic-revoked-token')
    expect(harness.current()?.payload.availableModelIds).toEqual([])
    expect(urls.some(url => url.includes('/responses'))).toBe(false)
    expect(harness.ctx.get('githubCopilotPreview')!.routeFacts(MODEL)).toBeUndefined()
    await expect(call(harness.ctx)).rejects.toThrow(/ENTITLED/)
  })

  it('does not publish cached availability after an explicit discovery failure', async () => {
    const harness = await runtime()
    const service = harness.ctx.get('githubCopilotPreview')!
    expect((await service.discover()).available).toBe(true)
    stubFetch(async () => new Response('PRIVATE_ERROR_BODY', { status: 503 }), true)
    const failed = await service.discover({ force: true })
    expect(failed).toMatchObject({ state: 'error', available: false, error: 'COPILOT_MODEL_SOURCE_HTTP_ERROR', models: [] })
    expect(service.routeFacts(MODEL)).toBeUndefined()
    expect(JSON.stringify(failed)).not.toContain('PRIVATE_ERROR_BODY')
  })

  it('rejects a previously prepared account snapshot after a credential switch', async () => {
    const harness = await runtime()
    const prepared = await harness.ctx.llm.prepareCall({ provider: PREVIEW, model: MODEL })
    harness.replace(grant({ refresh: 'synthetic-account-b', access: 'synthetic-access-b' }))
    const fetch = vi.fn(async (_input: unknown) => response())
    stubFetch(fetch)
    const assembler = new BlockAssembler()
    for await (const chunk of prepared.stream({ ...prepared.config, messages: [] })) assembler.push(chunk)
    expect(assembler.finish.kind).not.toBe('stop')
    expect(fetch).not.toHaveBeenCalled()
    expect((await call(harness.ctx)).assembler.finish).toEqual({ kind: 'stop' })
  })

  it('rejects an account switch while the final pre-wire grant read is pending', async () => {
    const harness = await runtime()
    const prepared = await harness.ctx.llm.prepareCall({ provider: PREVIEW, model: MODEL })
    const old = harness.current()
    let finishRead: ((value: RecordValue | undefined) => void) | undefined
    let count = 0
    harness.reads.mockImplementation(async (key: string) => {
      expect(key).toBe(KEY)
      count++
      if (count === 2) return await new Promise<RecordValue | undefined>(resolve => { finishRead = resolve })
      return harness.current()
    })
    const fetch = vi.fn(async (_input: unknown) => response())
    stubFetch(fetch)
    const assembler = new BlockAssembler()
    const done = (async () => { for await (const chunk of prepared.stream({ ...prepared.config, messages: [] })) assembler.push(chunk) })()
    await vi.waitFor(() => expect(finishRead).toBeDefined())
    harness.replace(grant({ refresh: 'synthetic-account-b', access: 'synthetic-access-b' }))
    finishRead!(old)
    await done
    expect(assembler.finish.kind).not.toBe('stop')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('uses the credential-derived Enterprise endpoint without losing preview identity', async () => {
    const fetch = vi.fn(async (_input: unknown) => response())
    stubFetch(fetch)
    const harness = await runtime(grant({ enterpriseUrl: 'company.ghe.com' }))
    expect((await call(harness.ctx)).assembler.finish).toEqual({ kind: 'stop' })
    expect(fetch.mock.calls[0]?.[0]).toBe('https://copilot-api.company.ghe.com/responses')
  })

  it('rejects an untrusted credential-derived endpoint without disclosing its value', async () => {
    const fetch = vi.fn(async (_input: unknown) => response())
    stubFetch(fetch)
    const harness = await runtime(grant({ access: 'tid=synthetic;proxy-ep=private.invalid;' }))
    await expect(call(harness.ctx)).rejects.toThrow('COPILOT_MODEL_SOURCE_AUTH_FAILED')
    expect(harness.ctx.get('githubCopilotPreview')!.getView().error).toBe('COPILOT_MODEL_SOURCE_AUTH_FAILED')
    expect(JSON.stringify(harness.ctx.get('githubCopilotPreview')!.getView())).not.toContain('private.invalid')
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([true, false])('uses native attachment projection and execution-world mapping when available: %s', async mapped => {
    const harness = await runtime()
    const data = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/+8AAAAASUVORK5CYII=', 'base64')
    type ImageRef = Extract<Message['content'][number], { type: 'image' }>['attachment']
    const attachment: ImageRef = { attachmentId: 'synthetic-image' as ImageRef['attachmentId'], mediaType: 'image/png', bytes: data.length, width: 1, height: 1 }
    const readImageRequest = vi.fn(async () => ({ variantId: 'synthetic-version', attachment,
      data, mediaType: 'image/png', bytes: data.length, width: 1, height: 1, depth: 'uchar', space: 'srgb', hasAlpha: true }))
    await harness.ctx.plugin({ apply(owner: Context) {
      owner.provide('attachments', { imageLimits: { maxImageBytes: 1_000_000, maxImagesPerMessage: 4, maxMessageImageBytes: 4_000_000,
        maxImagePixels: 1_000_000, maxImageDimension: 4096, mediaTypes: ['image/png'] }, readImageRequest,
        readImage: async () => ({ ref: attachment, data }),
        imageHostPath: () => 'C:/private-host/normalized.png',
      } as unknown as Context['attachments'])
      if (mapped) owner.provide('fs', {
        processPathFromHostPath: (hostPath: string) => {
          expect(hostPath).toBe('C:/private-host/normalized.png')
          return '/execution-world/normalized.png'
        },
      })
    } })
    const fetch = vi.fn(async (_input: unknown, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('copilot-vision-request')).toBe('true')
      const body = JSON.parse(String(init?.body))
      expect(body.input[0].content).toContainEqual(expect.objectContaining({ type: 'input_image', image_url: `data:image/png;base64,${data.toString('base64')}` }))
      const text = body.input[0].content.filter((part: { type: string }) => part.type === 'input_text')
        .map((part: { text: string }) => part.text).join('\n')
      expect(text).not.toContain('private-host')
      if (mapped) expect(text).toContain('/execution-world/normalized.png')
      else expect(text).not.toContain('/execution-world/')
      return response()
    })
    stubFetch(fetch)
    const result = await call(harness.ctx, { messages: [createUserMessage({ content: [
      { type: 'text', text: 'Describe the fixture.' }, { type: 'image', attachment },
    ], source: { kind: 'user' } })] })
    expect(result.assembler.finish).toEqual({ kind: 'stop' })
    expect(readImageRequest).toHaveBeenCalledTimes(1)
    expect(attachment.attachmentId).toBe('synthetic-image')
  })

  it('keeps the mapped read-only path when Core offloads an image to fit its request budget', async () => {
    const harness = await runtime(grant(), { maxRequestImageBytes: 1 })
    const data = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a/+8AAAAASUVORK5CYII=', 'base64')
    type ImageRef = Extract<Message['content'][number], { type: 'image' }>['attachment']
    const attachment: ImageRef = { attachmentId: 'synthetic-offload' as ImageRef['attachmentId'], mediaType: 'image/png', bytes: data.length, width: 1, height: 1 }
    await harness.ctx.plugin({ apply(owner: Context) {
      owner.provide('attachments', {
        imageLimits: { maxImageBytes: 1_000_000, maxImagesPerMessage: 4, maxMessageImageBytes: 4_000_000, maxImagePixels: 1_000_000, maxImageDimension: 4096, mediaTypes: ['image/png'] },
        imageHostPath: () => 'C:/private-host/offloaded.png',
        readImageRequest: async () => ({ variantId: 'synthetic-offload-version', attachment, data,
          mediaType: 'image/png', bytes: data.length, width: 1, height: 1, depth: 'uchar', space: 'srgb', hasAlpha: true }),
      } as unknown as Context['attachments'])
      owner.provide('fs', { processPathFromHostPath: () => '/execution-world/offloaded.png' })
    } })
    stubFetch(vi.fn(async (_input: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      const serialized = JSON.stringify(body.input)
      expect(serialized).toContain('image omitted to fit request image limits')
      expect(serialized).toContain('/execution-world/offloaded.png')
      expect(serialized).not.toContain('private-host')
      expect(serialized).not.toContain('data:image/')
      return response()
    }))
    const result = await call(harness.ctx, { messages: [createUserMessage({
      content: [{ type: 'image', attachment }], source: { kind: 'user' },
    })] })
    expect(result.assembler.finish).toEqual({ kind: 'stop' })
  })

  it('cancels an in-flight SDK request on disposal without deleting the shared grant', async () => {
    const harness = await runtime()
    let wireSignal: AbortSignal | undefined
    const fetch = vi.fn(async (_input: unknown, init?: RequestInit) => {
      wireSignal = init?.signal ?? undefined
      return await new Promise<Response>((_resolve, reject) => {
        wireSignal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
      })
    })
    stubFetch(fetch)
    const result = call(harness.ctx)
    await vi.waitFor(() => expect(wireSignal).toBeDefined())
    await harness.fiber.dispose()
    expect(wireSignal!.aborted).toBe(true)
    expect((await result).assembler.finish.kind).not.toBe('stop')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(harness.current()).toBeDefined()
  })

  it('cancels a model request when the canonical credential record changes', async () => {
    const harness = await runtime()
    let wireSignal: AbortSignal | undefined
    stubFetch(vi.fn(async (_input: unknown, init?: RequestInit) => {
      wireSignal = init?.signal ?? undefined
      return await new Promise<Response>((_resolve, reject) => {
        wireSignal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
      })
    }))
    const result = call(harness.ctx)
    await vi.waitFor(() => expect(wireSignal).toBeDefined())
    harness.replace(grant({ refresh: 'synthetic-account-b', access: 'synthetic-access-b' }))
    expect(wireSignal!.aborted).toBe(true)
    expect((await result).assembler.finish.kind).not.toBe('stop')
    expect(harness.current()?.payload.refresh).toBe('synthetic-account-b')
  })

  it('allows Core retry middleware to re-dispatch the same prepared adapter snapshot', async () => {
    const harness = await runtime()
    let requests = 0
    stubFetch(vi.fn(async () => ++requests === 1 ? new Response('{}', { status: 503 }) : response()))
    harness.ctx.on('llm/stream', (_options, next) => (async function* () {
      const first = []
      for await (const chunk of next()) first.push(chunk)
      if (first.some(chunk => chunk.type === 'finish' && chunk.reason.kind === 'error')) yield* next()
      else yield* first
    })())
    expect((await call(harness.ctx)).assembler.finish).toEqual({ kind: 'stop' })
    expect(requests).toBe(2)
  })

  it('does not let a retry cross to another account after its first attempt', async () => {
    const harness = await runtime()
    let requests = 0
    stubFetch(vi.fn(async () => { requests++; return new Response('{}', { status: 503 }) }))
    harness.ctx.on('llm/stream', (_options, next) => (async function* () {
      for await (const _chunk of next()) { /* discard the failed first attempt */ }
      harness.replace(grant({ refresh: 'synthetic-account-b', access: 'synthetic-access-b' }))
      yield* next()
    })())
    const result = await call(harness.ctx)
    expect(result.assembler.finish.kind).not.toBe('stop')
    expect(JSON.stringify(result.assembler.finish)).toContain('COPILOT_PREVIEW_ACCOUNT_CHANGED')
    expect(requests).toBe(1)
  })

  it('detaches nested retry policy configuration from external mutation', async () => {
    const config: PreviewRouteConfig = { retryPolicy: { mode: 'normal', maxRetries: 2,
      retryableCodes: ['RATE_LIMITED'], backoff: { initialDelayMs: 25, maxDelayMs: 50, jitterRatio: 0 } } }
    const harness = await runtime(grant(), config)
    const before = harness.ctx.llm.providerRetryPolicy(PREVIEW)
    if (config.retryPolicy?.mode !== 'normal') throw new Error('fixture policy missing')
    config.retryPolicy.maxRetries = 99
    config.retryPolicy.retryableCodes!.push('OTHER')
    config.retryPolicy.backoff!.initialDelayMs = 999
    expect(harness.ctx.llm.providerRetryPolicy(PREVIEW)).toEqual(before)
    expect(before).toMatchObject({ maxRetries: 2, initialDelayMs: 25, retryableCodes: ['RATE_LIMITED'] })
    expect(Object.isFrozen(before)).toBe(true)
    if (before.mode === 'normal') expect(Object.isFrozen(before.retryableCodes)).toBe(true)
  })

  it('captures immutable profile defaults and rejects old prepared calls after remount', async () => {
    const config: PreviewRouteConfig = { reasoning: 'low' }
    const harness = await runtime(grant(), config)
    const old = await harness.ctx.llm.prepareCall({ provider: PREVIEW, model: MODEL })
    config.reasoning = 'max'
    const efforts: unknown[] = []
    const fetch = vi.fn(async (_input: unknown, init?: RequestInit) => {
      efforts.push(JSON.parse(String(init?.body)).reasoning?.effort)
      return response()
    })
    stubFetch(fetch)
    expect((await call(harness.ctx)).assembler.finish).toEqual({ kind: 'stop' })
    await harness.fiber.dispose()
    await harness.ctx.plugin(previewPlugin, { reasoning: 'max' })
    const dropped = new BlockAssembler()
    for await (const chunk of old.stream({ ...old.config, messages: [] })) dropped.push(chunk)
    expect(dropped.finish.kind).not.toBe('stop')
    expect((await call(harness.ctx)).assembler.finish).toEqual({ kind: 'stop' })
    expect(efforts).toEqual(['low', 'max'])
  })

  it('does not invalidate preview preparation for unrelated credential updates', async () => {
    const harness = await runtime()
    const prepared = await harness.ctx.llm.prepareCall({ provider: PREVIEW, model: MODEL })
    harness.ctx.emit('credentials/record-updated', 'other-provider/key' as never)
    const fetch = vi.fn(async () => response())
    stubFetch(fetch)
    const assembler = new BlockAssembler()
    for await (const chunk of prepared.stream({ ...prepared.config, messages: [] })) assembler.push(chunk)
    expect(assembler.finish).toEqual({ kind: 'stop' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('does not disclose a native refresh exception body', async () => {
    stubFetch(vi.fn(async () => { throw new Error('PRIVATE_REFRESH_BODY') }))
    const harness = await runtime(grant({ expires: 0 }))
    await expect(call(harness.ctx)).rejects.toThrow('COPILOT_MODEL_SOURCE_AUTH_FAILED')
    expect(JSON.stringify(harness.ctx.get('githubCopilotPreview')!.getView())).not.toContain('PRIVATE_REFRESH_BODY')
    expect(harness.ctx.get('githubCopilotPreview')!.getView().error).toBe('COPILOT_MODEL_SOURCE_AUTH_FAILED')
  })

  it('refuses a duplicate route through the public registry without taking over the existing adapter', async () => {
    const harness = await runtime()
    const service = harness.ctx.get('githubCopilotPreview')
    await expect(harness.ctx.plugin({ name: 'duplicate-preview-test', inject: ['llm', 'credentials'],
      apply(owner: Context) { previewPlugin.apply(owner) },
    })).rejects.toThrow(/already registered|DUPLICATE_ADAPTER/)
    expect(harness.ctx.get('githubCopilotPreview')).toBe(service)
    expect(harness.ctx.llm.listProviders().filter(provider => provider.id === PREVIEW)).toHaveLength(1)
    await expect(harness.ctx.llm.prepareCall({ provider: PREVIEW, model: MODEL })).resolves.toBeDefined()
  })

  it('rejects endpoint and API-key configuration instead of turning preview into a generic route', async () => {
    const harness = await runtime()
    await harness.fiber.dispose()
    await expect(harness.ctx.plugin({ name: 'unsafe-preview-config-test', inject: ['llm', 'credentials'],
      apply(owner: Context) { previewPlugin.apply(owner, { apiKeyEnv: 'DO_NOT_USE', baseURL: 'https://private.invalid' } as never) },
    })).rejects.toThrow('COPILOT_PREVIEW_CONFIG_UNSUPPORTED')
    expect(harness.ctx.llm.listProviders().some(provider => provider.id === PREVIEW)).toBe(false)
    expect(harness.ctx.get('githubCopilotPreview')).toBeUndefined()
    expect(harness.current()).toBeDefined()
  })

  it('withdraws only its own route and refuses an already-prepared call after disposal', async () => {
    const harness = await runtime()
    await harness.ctx.plugin(CorePiAi, { providers: { 'github-copilot': { models: [{ id: 'gemini-3.5-flash' }] } } })
    const prepared = await harness.ctx.llm.prepareCall({ provider: PREVIEW, model: MODEL })
    const service = harness.ctx.get('githubCopilotPreview')!
    await harness.fiber.dispose()
    expect(harness.ctx.llm.listProviders().map(item => item.id)).toEqual(['github-copilot'])
    expect(harness.ctx.get('githubCopilotPreview')).toBeUndefined()
    await expect(service.refresh()).rejects.toThrow(/DISPOSED/)
    const fetch = vi.fn(async (_input: unknown) => response())
    stubFetch(fetch)
    const assembler = new BlockAssembler()
    for await (const chunk of prepared.stream({ ...prepared.config, messages: [] })) assembler.push(chunk)
    expect(assembler.finish.kind).not.toBe('stop')
    expect(fetch).not.toHaveBeenCalled()
    expect(harness.current()).toBeDefined()
  })
})
