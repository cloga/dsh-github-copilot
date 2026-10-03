/**
 * Native AgentLoop admission on unchanged tagged rc.2 source.
 * Synthetic account metadata, credentials, tool and wire; no live model requests.
 */
import '@earendil-works/pi-ai/api/openai-responses'
import { Context } from '@deepseek-ai/cordis'
import Agents, { installModelSelection } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import Projections from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools, { defineTool } from '@deepseek-ai/dsh-tools'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import previewPlugin, { type PreviewRouteConfig } from '../../src/preview-route.ts'
import {
  GITHUB_COPILOT_AUTO_MODEL_ID as AUTO, GITHUB_COPILOT_CREDENTIAL_KEY as KEY,
  GITHUB_COPILOT_PREVIEW_PROVIDER_ID as PREVIEW, GITHUB_COPILOT_PREVIEW_MODEL_ID as MODEL,
} from '../../src/copilot-identity.ts'

const contexts: Context[] = []
beforeAll(() => {
  expect(process.env.DSH_CORE_EVIDENCE).toBe('tagged-source-runtime')
  expect(process.env.DSH_PUBLISHED_CORE_RELEASE).toBe('0.2.0-rc.2')
})
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  vi.unstubAllGlobals()
})

function response(tool: boolean) {
  const item = tool
    ? { type: 'function_call', id: 'fc_fixture', call_id: 'call_fixture', name: 'echo', arguments: '{"value":"hi"}' }
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

describe('turn-scoped model exclusions on native Core', () => {
  it.each([MODEL, AUTO])('keeps native tool steps in an admitted turn after exclusion and enforces exclusion on the next turn (%s)', async selected => {
    const ctx = new Context()
    contexts.push(ctx)
    const settings: PreviewRouteConfig & { excludedModelIds?: string[] } = { excludedModelIds: [] }
    let calls = 0
    vi.stubGlobal('fetch', async (input: unknown) => {
      if (!String(input).endsWith('/models')) return response(++calls === 1)
      return new Response(JSON.stringify({ data: [{
        id: MODEL, name: MODEL, model_picker_enabled: true, policy: { state: 'enabled' }, supported_endpoints: ['/responses'],
        capabilities: {
          supports: { streaming: true, tool_calls: true, vision: true, reasoning_effort: ['low', 'medium', 'high'] },
          limits: { max_context_window_tokens: 1_050_000, max_prompt_tokens: 900_000, max_output_tokens: 128_000 },
        },
      }] }), { headers: { 'content-type': 'application/json' } })
    })
    const grant = { kind: 'grant', payload: { type: 'oauth', refresh: 'synthetic-refresh', access: 'synthetic-access',
      expires: Date.now() + 3_600_000, availableModelIds: [MODEL] } }
    ctx.provide('credentials', {
      readRecord: async (key: string) => { expect(key).toBe(KEY); return grant },
      listRecords: async () => [{ key: KEY, kind: 'grant' }],
      deleteRecord: async () => { throw new Error('unexpected fixture credential deletion') },
      modifyRecord: async (key: string, update: (value: typeof grant) => Promise<typeof grant | undefined>) => {
        expect(key).toBe(KEY)
        return await update(grant) ?? grant
      },
    })
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(previewPlugin, { accountModelSettings: () => settings })
    await ctx.get('githubCopilotPreview')!.refresh()
    await ctx.plugin(SessionStore)
    await ctx.plugin(Projections)
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(Tools, {})
    await ctx.plugin(Agents)
    await ctx.plugin(AgentLoop, { agents: [] })
    ctx.provide('tokenMeter', { estimateMessage: () => 1, measure: () => ({ totalTokens: 1 }) })
    const execute = vi.fn(async () => {
      settings.excludedModelIds = [MODEL]
      ctx.emit('settings/updated', 'github-copilot')
      return 'Excluded for subsequent turns.'
    })
    ctx.tools.register(defineTool({
      name: 'echo', description: 'Synthetic exclusion test.',
      parameters: { value: { type: 'string' } },
      output: { schema: { type: 'string' }, render: (_args, text) => [{ type: 'text', text }] },
      execute,
    }))
    const events: { type: string; data: unknown }[] = []
    const id = SessionId('single-model-exclusion-fixture')
    ctx.on('session/event', (session, event) => { if (session.id === id) events.push(event) })
    const { agent } = await ctx.agents.create({
      sessionId: id, agentOptions: { provider: PREVIEW, model: selected },
      setup: async owner => { installModelSelection(owner, { current: { provider: PREVIEW, model: selected }, assembled: undefined }) },
    })
    const send = async () => {
      agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Continue.' }], source: { kind: 'user' } }))
      await agent.whenIdle()
    }
    await send()
    expect(events.filter(event => event.type === 'turn/end').at(-1), JSON.stringify(events)).toMatchObject({ data: { reason: { kind: 'completed' } } })
    expect(execute).toHaveBeenCalledOnce()
    expect(calls).toBe(2)
    await send()
    expect(calls).toBe(2)
    expect(JSON.stringify(events.filter(event => event.type === 'turn/end').at(-1)))
      .toContain(selected === AUTO ? 'COPILOT_AUTO_NO_ELIGIBLE_MODEL' : 'COPILOT_PREVIEW_MODEL_EXCLUDED')
  })
})
