/**
 * Native rc.2 Auto reviewer through the managed Copilot route.
 * Synthetic metadata, credential, verdicts and wire only; no live inference.
 */
import '@earendil-works/pi-ai/api/openai-responses'
import '@earendil-works/pi-ai/api/openai-completions'
import { readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import { PluginPackages, type RuntimeResolution } from '@deepseek-ai/dsh-app-boot'
import * as AutoReview from '@deepseek-ai/dsh-experimental-auto-review'
import LlmRuntime, { createMessage, createUserMessage, LlmAdapter, ToolCallId,
  type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import PermissionPresetService, { AUTO_PRESET } from '@deepseek-ai/dsh-permission-presets'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import Projections from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import ApprovalService, { setApprovalPolicy } from '@deepseek-ai/dsh-user-approval'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import previewPlugin from '../../src/preview-route.ts'
import { installAutoReviewSampling } from '../../src/auto-review-sampling.ts'
import { CopilotAccountsHost } from '../../src/copilot-accounts-host.ts'
import { SessionAccountsHost } from '../../src/session-accounts-host.ts'
import {
  GITHUB_COPILOT_CREDENTIAL_KEY as KEY,
  GITHUB_COPILOT_PREVIEW_PROVIDER_ID as PREVIEW,
} from '../../src/copilot-identity.ts'

const MODEL = 'synthetic-model'
const contexts: Context[] = []

class ReviewerFixtureLoader extends Loader {
  constructor(ctx: Context, private fixture: { scope: ScopeCase }) { super(ctx, { baseUrl: import.meta.url }) }
  async import(name: string) {
    if (name !== '@deepseek-ai/dsh-experimental-auto-review' && name !== 'fixture-reviewer-alias') {
      throw new Error('unexpected fixture import')
    }
    if (this.fixture.scope === 'impostor') {
      return { inject: AutoReview.inject, apply: (owner: Context) => AutoReview.apply(owner) }
    }
    if (this.fixture.scope === 'descendant') {
      return { inject: AutoReview.inject, apply: async (owner: Context) => { await owner.plugin(AutoReview) } }
    }
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
type ScopeCase = 'native' | 'impostor' | 'descendant' | 'alias' | 'missing-resolution' | 'disposed'
  | 'other-protocol' | 'canonical' | 'other-provider' | 'bound-account'

function sourceResolution(): RuntimeResolution | undefined {
  if (process.env.DSH_CORE_EVIDENCE !== 'tagged-source-runtime') return undefined
  const path = process.env.DSH_TAGGED_CORE_MANIFEST
  if (path === undefined) throw new Error('missing tagged package manifest')
  const manifest: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (manifest === null || typeof manifest !== 'object' || !('packages' in manifest)
    || !Array.isArray(manifest.packages)) throw new Error('invalid tagged package manifest')
  const entries = manifest.packages.map((value: unknown) => {
    if (value === null || typeof value !== 'object' || !('name' in value) || typeof value.name !== 'string'
      || !('manifestPath' in value) || typeof value.manifestPath !== 'string'
      || !('version' in value) || typeof value.version !== 'string') throw new Error('invalid tagged package')
    return { name: value.name, packageDir: dirname(value.manifestPath), version: value.version,
      declarer: path, scope: 'installation' as const }
  })
  const profileDir = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
  return { profilesDir: dirname(profileDir), profileDir, localPackageNames: [], entries, linkedRoots: [] }
}

function reviewerResponse(outcome: Outcome, completions = false): Response {
  if (outcome === 'http-error') {
    return Response.json({ error: { type: 'invalid_request_body', message: 'synthetic provider rejection' } }, { status: 400 })
  }
  const text = outcome === 'allow' ? '{"risk":"low","decision":"allow"}'
    : outcome === 'deny' ? '{"risk":"medium","decision":"deny","reason":"not authorized"}'
      : '{"risk":"low","decision":"invalid"}'
  if (completions) {
    const chunk = (delta: object, finish_reason: string | null) => `data: ${JSON.stringify({
      id: 'fixture-completion', object: 'chat.completion.chunk',
      choices: [{ index: 0, delta, finish_reason }],
    })}\n\n`
    return new Response(chunk({ role: 'assistant', content: text }, null) + chunk({}, 'stop') + 'data: [DONE]\n\n',
      { headers: { 'content-type': 'text/event-stream' } })
  }
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

async function run(outcome: Outcome, automatic = false, thinking?: boolean, scope: ScopeCase = 'native') {
  const ctx = new Context()
  contexts.push(ctx)
  const provider = scope === 'canonical' ? 'github-copilot' : scope === 'other-provider' ? 'fixture-other' : PREVIEW
  const completions = scope === 'other-protocol'
  const second = '11111111-1111-4111-8111-111111111111'
  const controller = new AbortController()
  const wireBodies: Record<string, unknown>[] = []
  const wireTokens: (string | null)[] = []
  const readScopes: { reviewer: boolean, entry: boolean, root: boolean, service: string }[] = []
  let wireCalls = 0
  vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: RequestInit) => {
    if (String(input).endsWith('/user')) return Response.json({ login: 'fixture-user', id: 1 })
    if (String(input).endsWith('/models')) {
      return Response.json({ data: [{
        id: MODEL, name: MODEL, model_picker_enabled: true, policy: { state: 'enabled' },
        supported_endpoints: [completions ? '/chat/completions' : '/responses'],
        capabilities: {
          supports: { streaming: true, tool_calls: true, vision: false,
            ...thinking === undefined ? {} : { thinking },
            reasoning_effort: ['low', 'medium', 'high'] },
          limits: { max_context_window_tokens: 64_000, max_prompt_tokens: 48_000, max_output_tokens: 8_192 },
        },
      }] })
    }
    wireCalls += 1
    wireTokens.push(new Headers(init?.headers).get('authorization'))
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    wireBodies.push(body)
    if (body.temperature === 0.37) return reviewerResponse('allow', completions)
    if (outcome === 'cancel') {
      controller.abort(new DOMException('Synthetic review cancellation', 'AbortError'))
      throw controller.signal.reason
    }
    return reviewerResponse(outcome, completions)
  }))
  const grant = { kind: 'grant', payload: { type: 'oauth', refresh: 'synthetic-refresh', access: 'synthetic-access',
    expires: Date.now() + 3_600_000, availableModelIds: [MODEL] } }
  const records = new Map([
    [KEY, grant],
    [`github-copilot/account-${second}`, { kind: 'grant', payload: {
      type: 'oauth', refresh: 'synthetic-second-refresh', access: 'synthetic-second-access',
      expires: Date.now() + 3_600_000, availableModelIds: [MODEL],
    } }],
  ])
  ctx.provide('credentials', {
    readRecord: async (key: string) => { expect(records.has(key)).toBe(true); return records.get(key) },
    listRecords: async () => [...records.keys()].map(key => ({ key, kind: 'grant' })),
    modifyRecord: async () => { throw new Error('fixture token must not refresh') },
    deleteRecord: async () => { throw new Error('fixture credential must not be deleted') },
  })
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(AgentRegistry)
  if (scope === 'bound-account') {
    ctx.provide('settings', {
      describe: () => [{ ns: 'github-copilot', revision: 1, value: {
        activeAccountId: 'canonical', sessionAccounts: [{ sessionId: `auto-review-${outcome}`, accountId: second }],
      } }],
      mutate: async () => { throw new Error('reviewer qualification must not write settings') },
    })
    const host = new CopilotAccountsHost(ctx)
    ctx.provide('githubCopilotAccounts', { host })
    const owner = new SessionAccountsHost(ctx)
    ctx.provide('githubCopilotSessionAccounts', owner)
    ctx.effect(() => () => { owner.dispose(); host.dispose() })
  }
  if (provider !== PREVIEW) {
    ctx.llm.registerAdapter([provider], new class extends LlmAdapter {
      async *stream(options: GenerateOptions): AsyncGenerator<StreamChunk> {
        wireCalls += 1
        wireBodies.push({ temperature: options.temperature })
        const text = '{"risk":"low","decision":"allow"}'
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text }
        yield { type: 'block-end', index: 0, block: { type: 'text', text } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      }
    })
  }
  ctx.on('internal/get', (caller, name, _error, next) => {
    const native: unknown = next()
    if (name === 'llm') readScopes.push({
      reviewer: caller.fiber.runtime?.callback === AutoReview.apply,
      entry: caller.fiber.entry !== undefined,
      root: caller.fiber.entry?.fiber === caller.fiber,
      service: typeof native,
    })
    return native
  })
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
    if (scope !== 'missing-resolution') await ctx.plugin(PluginPackages, { resolution: sourceResolution() })
    await ctx.plugin(ReviewerFixtureLoader, { scope })
    const stop = ctx.effect(() => installAutoReviewSampling(ctx))
    await ctx.loader.create({ name: scope === 'alias' ? 'fixture-reviewer-alias' : '@deepseek-ai/dsh-experimental-auto-review' })
    await ctx.loader.await()
    if (scope === 'disposed') await stop()
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
      config: { provider, model: MODEL },
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
      source: { kind: 'model', provider, model: MODEL },
    }),
  }, { surfaceOp: 'append' })
  session.append('tool/call', {
    turn: 1, step: 1, callId, name: 'probe', arguments: rawArguments,
  })
  ctx.permissionPresets.set(session, AUTO_PRESET)
  setApprovalPolicy(session, 'never')
  const agent = { id: session.id, session, ctx, options: { provider, model: MODEL } } as Agent
  if (scope === 'bound-account') ctx.githubCopilotSessionAccounts.admit(agent, 1, controller.signal)
  const pending = ctx.agents.withInitiator(agent, () => ctx.tools.execute({
    signal: controller.signal, callId,
    name: 'probe', arguments: { value: outcome }, agent,
  }))
  if (automatic) {
    const ordinary = ctx.agents.withInitiator(agent, async () => {
      for await (const _chunk of ctx.llm.stream({
        provider, model: MODEL, temperature: 0.37, messages: [],
        sessionId: session.id, signal: new AbortController().signal,
      })) { /* consume */ }
    })
    await Promise.all([pending, ordinary])
  }
  const result = await pending
  return { result, executions, wireCalls, wireBodies, wireTokens, readScopes }
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
  describe('qualified native loader reviewer-only sampling', () => {
    it.each(['allow', 'deny', 'malformed', 'http-error', 'cancel'] as const)(
      'omits only the actual reviewer temperature and preserves concurrent chat for %s', async outcome => {
        const result = await run(outcome, true)
        expect(result.readScopes).toContainEqual({ reviewer: true, entry: true, root: true, service: 'object' })
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
    it('uses the native initiator and frozen Session account without a reviewer sessionId', async () => {
      const result = await run('allow', true, undefined, 'bound-account')
      expect(result.executions).toBe(1)
      expect(result.wireBodies.filter(body => body.temperature === 0.37)).toHaveLength(1)
      expect(result.wireBodies.filter(body => !Object.hasOwn(body, 'temperature'))).toHaveLength(1)
      expect(result.wireTokens).toEqual(['Bearer synthetic-second-access', 'Bearer synthetic-second-access'])
    })
    it.each(['impostor', 'descendant', 'alias', 'missing-resolution', 'disposed',
      'other-protocol', 'canonical', 'other-provider'] as const)(
      'preserves native sampling for an unqualified %s scope', async scope => {
        const result = await run('allow', true, undefined, scope)
        expect(result.wireBodies.filter(body => body.temperature === 0.37)).toHaveLength(1)
        expect(result.wireBodies.filter(body => body.temperature === 0)).toHaveLength(1)
        expect(result.wireBodies.filter(body => !Object.hasOwn(body, 'temperature'))).toHaveLength(0)
      })
  })
})
