import '@earendil-works/pi-ai/api/openai-responses'
import { Context } from '@deepseek-ai/cordis'
import Agents from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { createUserMessage, LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import Projections from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import Tools, { defineTool } from '@deepseek-ai/dsh-tools'
import { afterEach, expect, it, vi } from 'vitest'
import previewPlugin from '../../src/preview-route.ts'
import {
  GITHUB_COPILOT_CREDENTIAL_KEY as KEY,
  GITHUB_COPILOT_PREVIEW_PROVIDER_ID as PREVIEW,
} from '../../src/copilot-identity.ts'

const MODEL = 'fixture-tool-model'
const OTHER = 'fixture-other'
const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  vi.unstubAllGlobals()
})

function response(tool: boolean) {
  const item = tool
    ? { type: 'function_call', id: 'fc_fixture', call_id: 'call_fixture', name: 'conditional_echo', arguments: '{"value":"hi"}' }
    : { type: 'message', id: 'msg_fixture', role: 'assistant', content: [{ type: 'output_text', text: 'hello' }] }
  const event = (type: string, data: object) => `data: ${JSON.stringify({ type, ...data })}\n\n`
  return new Response([
    event('response.created', { response: { id: 'resp_fixture' } }),
    event('response.output_item.added', { output_index: 0, item }),
    tool ? event('response.function_call_arguments.delta', { output_index: 0, delta: '{"value":"hi"}' })
      : event('response.output_text.delta', { output_index: 0, delta: 'hello' }),
    event('response.output_item.done', { output_index: 0, item }),
    event('response.completed', { response: { status: 'completed', output: [item],
      usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 } } }),
  ].join(''), { headers: { 'content-type': 'text/event-stream' } })
}

it('preserves frozen native requests and conditional tool execution while adapting managed wire schemas', async () => {
  expect(process.env.DSH_CORE_EVIDENCE).toBe('tagged-source-runtime')
  expect(process.env.DSH_PUBLISHED_CORE_RELEASE).toBe('0.2.2-rc.3')
  const ctx = new Context()
  contexts.push(ctx)
  const wire: Array<{ tools?: Array<{ name: string; parameters: { properties?: Record<string, unknown> } }> }> = []
  vi.stubGlobal('fetch', async (input: unknown, init?: RequestInit) => {
    if (String(input).endsWith('/models')) return Response.json({ data: [{
      id: MODEL, name: MODEL, model_picker_enabled: true, policy: { state: 'enabled' },
      supported_endpoints: ['/responses'],
      capabilities: {
        supports: { streaming: true, tool_calls: true, vision: false, reasoning_effort: ['low'] },
        limits: { max_context_window_tokens: 128_000, max_prompt_tokens: 96_000, max_output_tokens: 4_096 },
      },
    }] })
    wire.push(JSON.parse(String(init?.body)) as typeof wire[number])
    return response(wire.length === 1)
  })
  const grant = { kind: 'grant', payload: { type: 'oauth', refresh: 'synthetic-refresh', access: 'synthetic-access',
    expires: Date.now() + 3_600_000, availableModelIds: [MODEL] } }
  ctx.provide('credentials', {
    readRecord: async (key: string) => { expect(key).toBe(KEY); return grant },
    listRecords: async () => [{ key: KEY, kind: 'grant' }],
    deleteRecord: async () => { throw new Error('unexpected fixture credential deletion') },
    modifyRecord: async () => { throw new Error('valid synthetic credential must not refresh') },
  })
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(previewPlugin, {})
  await ctx.get('githubCopilotPreview')!.refresh()
  let otherRequest: GenerateOptions | undefined
  ctx.llm.registerAdapter([OTHER], new class extends LlmAdapter {
    async *stream(options: GenerateOptions): AsyncGenerator<StreamChunk> {
      otherRequest = options
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'other' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'other' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  })
  await ctx.plugin(SessionStore)
  await ctx.plugin(Projections)
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(Tools, {})
  await ctx.plugin(NativeToolExecutor)
  await ctx.plugin(Agents)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.provide('tokenMeter', { estimateMessage: () => 1, measure: () => ({ totalTokens: 1 }) })
  const execute = vi.fn(async () => 'ok')
  const parameters = {
    value: { type: 'string' as const },
    sandbox_permissions: { type: 'string' as const },
    justification: { type: 'string' as const },
  }
  ctx.tools.register(defineTool({
    name: 'common', description: 'Unconditional synthetic tool.', parameters,
    output: { schema: { type: 'string' }, render: (_args, text) => [{ type: 'text', text }] },
    execute: async () => 'ok',
  }))
  const condition = vi.fn(({ modelSelection }: { modelSelection: { provider: string } }) => modelSelection.provider === PREVIEW)
  ctx.tools.register(defineTool({
    name: 'conditional_echo', description: 'Conditional synthetic tool.', parameters,
    output: { schema: { type: 'string' }, render: (_args, text) => [{ type: 'text', text }] },
    execute,
  }), { when: condition })
  const observed: GenerateOptions[] = []
  ctx.on('llm/stream', (options, next) => {
    expect(Object.isFrozen(options)).toBe(true)
    observed.push(options)
    return next()
  })
  const send = async (id: string, provider: string) => {
    const { agent } = await ctx.agents.create({ sessionId: SessionId(id), agentOptions: { provider, model: MODEL } })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Continue.' }], source: { kind: 'user' } }))
    await agent.whenIdle()
    return agent
  }
  const managed = await send('fixture-tool-managed', PREVIEW)
  await send('fixture-tool-other', OTHER)

  expect(execute).toHaveBeenCalledOnce()
  expect(condition).toHaveBeenCalled()
  expect(wire).toHaveLength(2)
  const sentEcho = wire[0]?.tools?.find(tool => tool.name === 'conditional_echo')
  expect(sentEcho?.parameters.properties).toEqual({ value: { type: 'string' } })
  const original = observed.find(request => request.provider === PREVIEW)
  expect(original?.tools?.find(tool => tool.name === 'conditional_echo')?.parameters.properties)
    .toHaveProperty('sandbox_permissions')
  expect(managed.session.requestHeader()?.tools?.find(tool => tool.name === 'conditional_echo')?.parameters.properties)
    .toHaveProperty('justification')
  expect(otherRequest?.tools?.find(tool => tool.name === 'common')?.parameters.properties)
    .toHaveProperty('sandbox_permissions')
  expect(otherRequest?.tools?.some(tool => tool.name === 'conditional_echo')).toBe(false)
})
