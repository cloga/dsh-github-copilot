/**
 * Native rc.2 Auto reviewer through the managed Copilot route.
 * Synthetic metadata, credential, verdicts and wire only; no live inference.
 */
import '@earendil-works/pi-ai/api/openai-responses'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { PluginPackages } from '@deepseek-ai/dsh-app-boot'
import * as AutoReview from '@deepseek-ai/dsh-experimental-auto-review'
import LlmRuntime, { createMessage, createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import PermissionPresetService, { AUTO_PRESET } from '@deepseek-ai/dsh-permission-presets'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import Projections from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import ApprovalService, { setApprovalPolicy } from '@deepseek-ai/dsh-user-approval'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import previewPlugin from '../../src/preview-route.ts'
import { installAutoReviewSampling } from '../../src/auto-review-sampling.ts'
import {
  GITHUB_COPILOT_CREDENTIAL_KEY as KEY,
  GITHUB_COPILOT_PREVIEW_PROVIDER_ID as PREVIEW,
} from '../../src/copilot-identity.ts'

const MODEL = 'synthetic-model'
const contexts: Context[] = []

class ReviewerFixtureLoader extends Loader {
  constructor(ctx: Context) { super(ctx, { baseUrl: import.meta.url }) }
  async import(name: string) {
    if (name !== '@deepseek-ai/dsh-experimental-auto-review') throw new Error('unexpected fixture import')
    return import('@deepseek-ai/dsh-experimental-auto-review')
  }
  write() {}
}

beforeAll(() => {
  expect(['tagged-source-runtime', 'published-artifact-runtime']).toContain(process.env.DSH_CORE_EVIDENCE)
  expect(process.env.DSH_PUBLISHED_CORE_RELEASE).toBe('0.2.0-rc.2')
})
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  vi.unstubAllGlobals()
})

type Outcome = 'allow' | 'deny' | 'malformed' | 'http-error' | 'cancel'

function reviewerResponse(outcome: Outcome): Response {
  if (outcome === 'http-error') {
    return Response.json({ error: { type: 'invalid_request_body', message: 'synthetic provider rejection' } }, { status: 400 })
  }
  const text = outcome === 'allow' ? '{"risk":"low","decision":"allow"}'
    : outcome === 'deny' ? '{"risk":"medium","decision":"deny","reason":"not authorized"}'
      : '{"risk":"low","decision":"invalid"}'
  const event = (type: string, data: object) => `data: ${JSON.stringify({ type, ...data })}\n\n`
  const item = { id: 'message_fixture', type: 'message', role: 'assistant',
    content: [{ type: 'output_text', text }] }
  return new Response([
    event('response.output_item.added', { output_index: 0, item: { ...item, content: [] } }),
    event('response.output_text.delta', { output_index: 0, delta: text }),
    event('response.output_item.done', { output_index: 0, item }),
    event('response.completed', { response: { status: 'completed', output: [item],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } }),
  ].join(''), { headers: { 'content-type': 'text/event-stream' } })
}

async function run(outcome: Outcome, automatic = false, thinking?: boolean) {
  const ctx = new Context()
  contexts.push(ctx)
  const controller = new AbortController()
  const wireBodies: Record<string, unknown>[] = []
  let wireCalls = 0
  vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: RequestInit) => {
    if (String(input).endsWith('/models')) {
      return Response.json({ data: [{
        id: MODEL, name: MODEL, model_picker_enabled: true, policy: { state: 'enabled' },
        supported_endpoints: ['/responses'],
        capabilities: {
          supports: { streaming: true, tool_calls: true, vision: false,
            ...thinking === undefined ? {} : { thinking },
            reasoning_effort: ['low', 'medium', 'high'] },
          limits: { max_context_window_tokens: 64_000, max_prompt_tokens: 48_000, max_output_tokens: 8_192 },
        },
      }] })
    }
    wireCalls += 1
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    wireBodies.push(body)
    if (body.temperature === 0.37) return reviewerResponse('allow')
    if (outcome === 'cancel') {
      controller.abort(new DOMException('Synthetic review cancellation', 'AbortError'))
      throw controller.signal.reason
    }
    return reviewerResponse(outcome)
  }))
  const grant = { kind: 'grant', payload: { type: 'oauth', refresh: 'synthetic-refresh', access: 'synthetic-access',
    expires: Date.now() + 3_600_000, availableModelIds: [MODEL] } }
  ctx.provide('credentials', {
    readRecord: async (key: string) => { expect(key).toBe(KEY); return grant },
    listRecords: async () => [{ key: KEY, kind: 'grant' }],
    modifyRecord: async () => { throw new Error('fixture token must not refresh') },
    deleteRecord: async () => { throw new Error('fixture credential must not be deleted') },
  })
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(previewPlugin, { chatRequestSettings: () => ({ responsesOmitTemperature: !automatic }) })
  await ctx.get('githubCopilotPreview')!.refresh()
  await ctx.plugin(SessionStore)
  await ctx.plugin(Projections)
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(Tools)
  ctx.provide('shell', {
    sandboxMode: 'workspace-write',
    resolve() { throw new Error('fixture must not resolve shell requests') },
    run() { throw new Error('fixture must not run shell requests') },
    start() { throw new Error('fixture must not start shell requests') },
  })
  await ctx.plugin(ApprovalService, { policy: 'ask' })
  await ctx.plugin(PermissionPresetService, {
    presets: {
      'read-only': { sandbox: 'read-only', approval: 'ask', name: 'Read only' },
      'workspace-write': { sandbox: 'workspace-write', approval: 'ask', name: 'Workspace write' },
      'danger-full-access': { sandbox: 'danger-full-access', approval: 'never', name: 'Full access' },
    },
    defaultPreset: 'workspace-write',
  })
  if (automatic) {
    await ctx.plugin(PluginPackages)
    await ctx.plugin(ReviewerFixtureLoader)
    ctx.effect(() => installAutoReviewSampling(ctx))
    await ctx.loader.create({ name: '@deepseek-ai/dsh-experimental-auto-review' })
    await ctx.loader.await()
  } else {
    await ctx.plugin(AutoReview)
  }
  let executions = 0
  ctx.tools.register(defineContentToolFixture({
    name: 'probe', description: 'Synthetic reviewer compatibility probe.',
    parameters: { value: { type: 'string' } },
    async execute() { executions += 1; return [{ type: 'text', text: 'executed' }] },
  }))
  const session = ctx.sessions.create(SessionId(`auto-review-${outcome}`), { meta: { cwd: process.cwd() } })
  session.append('request/header', {
    header: {
      config: { provider: PREVIEW, model: MODEL },
      tools: [{
        name: 'probe',
        description: 'Synthetic reviewer compatibility probe.',
        parameters: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] },
      }],
    },
    reason: 'initial',
  })
  session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'Inspect the synthetic target.' }],
    source: { kind: 'user', rpcId: `human-${outcome}` } as never,
  }), { surfaceOp: 'append' })
  const callId = ToolCallId(`call-${outcome}`)
  const rawArguments = JSON.stringify({ value: outcome })
  session.append('step/start', { turn: 1, step: 1 })
  session.append('assistant/message', {
    turn: 1,
    step: 1,
    stream: [],
    message: createMessage({
      role: 'assistant',
      content: [{ type: 'tool-call', id: callId, name: 'probe', arguments: rawArguments }],
      source: { kind: 'model', provider: PREVIEW, model: MODEL },
    }),
  }, { surfaceOp: 'append' })
  session.append('tool/call', {
    turn: 1, step: 1, callId, name: 'probe', arguments: rawArguments,
  })
  ctx.permissionPresets.set(session, AUTO_PRESET)
  setApprovalPolicy(session, 'never')
  const agent = { id: session.id, session, options: { provider: PREVIEW, model: MODEL } } as Agent
  const pending = ctx.tools.execute({
    signal: controller.signal, callId,
    name: 'probe', arguments: { value: outcome }, agent,
  })
  if (automatic) {
    const ordinary = ctx.llm.stream({
      provider: PREVIEW, model: MODEL, temperature: 0.37, messages: [],
      sessionId: session.id, signal: new AbortController().signal,
    })
    await Promise.all([pending, (async () => { for await (const _chunk of ordinary) { /* consume */ } })()])
  }
  const result = await pending
  return { result, executions, wireCalls, wireBodies }
}

describe('native Auto reviewer Copilot compatibility', () => {
  it.each(['allow', 'deny', 'malformed', 'http-error', 'cancel'] as const)(
    'omits temperature with explicit opt-in without weakening the %s verdict boundary', async outcome => {
      const result = await run(outcome)
      expect(result.wireCalls).toBe(1)
      expect(result.wireBodies).toHaveLength(1)
      expect(result.wireBodies[0]).not.toHaveProperty('temperature')
      if (outcome === 'allow') {
        expect(result.result.isError).toBe(false)
        expect(result.executions).toBe(1)
      } else {
        expect(result.result.isError).toBe(true)
        expect(result.executions).toBe(0)
      }
    })
    describe.runIf(process.env.DSH_CORE_EVIDENCE === 'published-artifact-runtime')(
      'qualified native loader reviewer-only sampling', () => {
        it.each(['allow', 'deny', 'malformed', 'http-error', 'cancel'] as const)(
          'omits only the actual reviewer temperature and preserves concurrent chat for %s', async outcome => {
            const result = await run(outcome, true)
            expect(result.wireCalls).toBe(2)
            expect(result.wireBodies.filter(body => body.temperature === 0.37)).toHaveLength(1)
            expect(result.wireBodies.filter(body => !Object.hasOwn(body, 'temperature'))).toHaveLength(1)
            expect(result.executions).toBe(outcome === 'allow' ? 1 : 0)
            expect(result.result.isError).toBe(outcome !== 'allow')
          })
        it.each([true, false, undefined])('does not use thinking=%s as reviewer identity', async thinking => {
          const result = await run('allow', true, thinking)
          expect(result.wireBodies.filter(body => body.temperature === 0.37)).toHaveLength(1)
          expect(result.wireBodies.filter(body => !Object.hasOwn(body, 'temperature'))).toHaveLength(1)
        })
      })
})
