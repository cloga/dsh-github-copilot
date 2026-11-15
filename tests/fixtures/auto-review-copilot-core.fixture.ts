/**
 * Native DSH Auto reviewer through the managed Copilot route.
 * Synthetic metadata, credential, verdicts and wire only; no live inference.
 */
import '@earendil-works/pi-ai/api/openai-responses'
import '@earendil-works/pi-ai/api/openai-completions'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import { PluginPackages, type RuntimeResolution } from '@deepseek-ai/dsh-app-boot'
import Authorization from '@deepseek-ai/dsh-authorization'
import * as AutoReview from '@deepseek-ai/dsh-experimental-auto-review'
import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all'
import LlmRuntime, { createMessage, createUserMessage, LlmAdapter, markAgentLoopRequest, ToolCallId,
  type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import PermissionPresetService, { AUTO_PRESET } from '@deepseek-ai/dsh-permission-presets'
import { scopeTarget } from '@deepseek-ai/dsh-scope'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import Projections from '@deepseek-ai/dsh-session-projection'
import Settings from '@deepseek-ai/dsh-settings'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import Tools, { defineTool } from '@deepseek-ai/dsh-tools'
import ApprovalService, { setApprovalPolicy } from '@deepseek-ai/dsh-user-approval'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import previewPlugin from '../../src/preview-route.ts'
import { installAutoReviewSampling } from '../../src/auto-review-sampling.ts'
import { captureNativeCopilot } from '../../src/native-copilot-access.ts'
import { createNativeCopilotSearch } from '../../src/native-copilot-search.ts'
import { CopilotAccountsHost } from '../../src/copilot-accounts-host.ts'
import { SessionAccountsHost } from '../../src/session-accounts-host.ts'
import * as GitHubCopilotPlugin from '../../src/index.ts'
import {
  GITHUB_COPILOT_CREDENTIAL_KEY as KEY,
  GITHUB_COPILOT_PREVIEW_PROVIDER_ID as PREVIEW,
} from '../../src/copilot-identity.ts'

const contexts: Context[] = []

class ReviewerFixtureLoader extends Loader {
  constructor(ctx: Context, private fixture: { scope: ScopeCase }) { super(ctx, { baseUrl: import.meta.url }) }
  async import(name: string) {
    if (name === '@deepseek-ai/dsh-llm-pi-ai') {
      return process.env.DSH_CORE_EVIDENCE === 'published-artifact-runtime'
        ? super.import(name, () => []) : import('@deepseek-ai/dsh-llm-pi-ai')
    }
    if (name === '@deepseek-ai/dsh-web') {
      return process.env.DSH_CORE_EVIDENCE === 'published-artifact-runtime'
        ? super.import(name, () => []) : import('@deepseek-ai/dsh-web')
    }
    if (name === 'fixture-copilot-search-settings') {
      return { Config: GitHubCopilotPlugin.Config, apply() {} }
    }
    if (name !== '@deepseek-ai/dsh-experimental-auto-review' && name !== 'fixture-reviewer-alias') {
      throw new Error('unexpected fixture import')
    }
    if (this.fixture.scope === 'impostor') {
      return { inject: AutoReview.inject, apply: (owner: Context) => AutoReview.apply(owner) }
    }
    if (this.fixture.scope === 'descendant') {
      return { inject: AutoReview.inject, apply: async (owner: Context) => { await owner.plugin(AutoReview) } }
    }
    if (process.env.DSH_CORE_EVIDENCE === 'published-artifact-runtime') {
      return super.import('@deepseek-ai/dsh-experimental-auto-review', () => [])
    }
    return import('@deepseek-ai/dsh-experimental-auto-review')
  }
  write() {}
}

beforeAll(() => {
  expect(['tagged-source-runtime', 'published-artifact-runtime']).toContain(process.env.DSH_CORE_EVIDENCE)
  expect(['0.2.0-rc.2', '0.2.1-alpha.5', '0.2.1-rc.3', '0.2.2-rc.3']).toContain(process.env.DSH_PUBLISHED_CORE_RELEASE)
})
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  vi.unstubAllGlobals()
})

type Outcome = 'allow' | 'deny' | 'malformed' | 'http-error' | 'cancel'
type ScopeCase = 'native' | 'impostor' | 'descendant' | 'alias' | 'missing-resolution' | 'disposed'
  | 'other-protocol' | 'canonical' | 'other-provider' | 'bound-account'
  | 'retained-facade' | 'late-identity' | 'other-listener' | 'dispose-before-dispatch'
  | 'production' | 'production-disposed'
  | 'canonical-native' | 'canonical-native-disabled' | 'canonical-native-turn-account'
  | 'canonical-native-custom-turn-account' | 'canonical-native-reference-turn-account'

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
  const legacyCustomNative = scope === 'canonical-native-custom-turn-account'
  const customNative = legacyCustomNative || scope === 'canonical-native-reference-turn-account'
  const canonicalNative = scope === 'canonical-native' || scope === 'canonical-native-disabled'
    || scope === 'canonical-native-turn-account' || customNative
  const MODEL = customNative ? 'synthetic-configured-copilot-model' : canonicalNative
    ? getBuiltinModels('github-copilot').find(model => model.api === 'openai-responses')!.id
    : 'synthetic-model'
  if (customNative && getBuiltinModels('github-copilot').some(model => model.id === MODEL)) {
    throw new Error('fixture custom model must not occur in the native catalog')
  }
  const ctx = new Context()
  contexts.push(ctx)
  const provider = scope === 'canonical' || canonicalNative ? 'github-copilot' : scope === 'other-provider' ? 'fixture-other' : PREVIEW
  const completions = scope === 'other-protocol'
  const second = '11111111-1111-4111-8111-111111111111'
  const controller = new AbortController()
  const wireBodies: Record<string, unknown>[] = []
  const searchBodies: Record<string, unknown>[] = []
  const wireTokens: (string | null)[] = []
  const strictMode = outcome === 'deny'
  const useOverrides = outcome === 'deny' || outcome === 'http-error'
  let normalizedNativeSettings: unknown
  const readScopes: { reviewer: boolean, entry: boolean, root: boolean, service: string }[] = []
  let stopSampling: (() => void) | undefined
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
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    if (Array.isArray(body.tools) && body.tools.some(tool => tool.type === 'web_search')) {
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer synthetic-access')
      searchBodies.push(body)
      return Response.json({ output: [
        { type: 'web_search_call', status: 'completed', action: { sources: [{ type: 'url', url: 'https://example.com' }] } },
        { type: 'message', content: [{ type: 'output_text', text: 'Synthetic sourced answer.' }] },
      ] })
    }
    wireCalls += 1
    wireTokens.push(new Headers(init?.headers).get('authorization'))
    wireBodies.push(body)
    if (canonicalNative && body.temperature === 0) {
      return Response.json({ message: "Unsupported parameter: 'temperature'", code: 'invalid_request_body' }, { status: 400 })
    }
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
    describeRecord: async (key: string) => ({ configured: records.has(key), writable: true }),
    listRecords: async () => [...records.keys()].map(key => ({ key, kind: 'grant' })),
    modifyRecord: async () => { throw new Error('fixture token must not refresh') },
    deleteRecord: async () => { throw new Error('fixture credential must not be deleted') },
  })
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(AgentRegistry)
  ctx.provide('workingDirectory', { ensure: async () => process.cwd() })
  if (scope === 'bound-account') {
    ctx.provide('settings', {
      configure: () => () => {},
      describe: () => [{ ns: 'github-copilot', revision: 1, value: {
        activeAccountId: 'canonical', sessionAccounts: [{ sessionId: `auto-review-${outcome}`, accountId: second }],
      } }, { ns: 'llm-pi-ai', revision: 1, value: { providers: { 'github-copilot': {} } } }],
      mutate: async () => { throw new Error('reviewer qualification must not write settings') },
    })
    ctx.llm.registerAdapter(['github-copilot'], new class extends LlmAdapter {
      async *stream(): AsyncGenerator<StreamChunk> {
        yield { type: 'finish', reason: { kind: 'stop' } }
      }
    })
    const host = new CopilotAccountsHost(ctx)
    ctx.provide('githubCopilotAccounts', { host })
    const owner = new SessionAccountsHost(ctx)
    ctx.provide('githubCopilotSessionAccounts', owner)
    ctx.effect(() => () => { owner.dispose(); host.dispose() })
  }
  if (provider !== PREVIEW && !canonicalNative) {
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
      root: caller.fiber.entry?.fiber?.ctx.fiber === caller.fiber,
      service: typeof native,
    })
    if (name === 'llm' && caller.fiber.runtime?.callback === AutoReview.apply
      && caller.fiber.entry?.fiber?.ctx.fiber === caller.fiber && stopSampling !== undefined) {
      if (scope === 'retained-facade') stopSampling()
      if (scope === 'late-identity') queueMicrotask(stopSampling)
    }
    return native
  })
  if (scope === 'dispose-before-dispatch') {
    ctx.on('llm/stream', (options, next) => {
      if (options.temperature !== undefined) return next()
      return (async function* () {
        await Promise.resolve()
        stopSampling?.()
        yield* next()
      })()
    })
  }
  const preview = await ctx.plugin(previewPlugin, { registerLegacyProvider: true,
    chatRequestSettings: () => ({ responsesOmitTemperature: !automatic }) })
  await ctx.get('githubCopilotPreview')!.refresh()
  await ctx.plugin(SessionStore)
  await ctx.plugin(Projections)
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(Tools)
  await ctx.plugin(NativeToolExecutor)
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
    if (canonicalNative) {
      // Real Settings reads the Loader fiber's Config-normalized effective value.
      // The editor supplies read-only fixture layers only; no profile is persisted.
      ctx.provide('profileContext', { home: join(tmpdir(), `copilot-review-settings-${randomUUID()}`) })
      ctx.provide('configEditor', {
        configuration: () => [...ctx.loader.entries()].filter(entry => ['llm-pi-ai', 'web', 'github-copilot'].includes(entry.options.id))
          .map(entry => ({ entry, inherited: entry.options.config ?? {}, override: {} })),
        edit: async () => { throw new Error('native enhancement must not write settings') },
      })
      await ctx.plugin(Settings)
      await ctx.loader.create({ id: 'llm-pi-ai', name: '@deepseek-ai/dsh-llm-pi-ai', config: {
        providers: { 'github-copilot': {
          compat: { supportsStrictMode: strictMode },
          ...customNative ? { api: 'openai-responses' } : {},
          ...useOverrides
            ? { modelOverrides: { [MODEL]: { compat: { supportsStrictMode: strictMode } } } }
            : { models: [{ id: MODEL, ...legacyCustomNative ? {
              name: 'Synthetic configured model', contextWindow: 64_000, maxTokens: 8_192,
              input: ['text'], reasoningEfforts: false,
            } : {} }] },
        } },
      } })
      await ctx.loader.await()
      const directory = ctx.llm.listConfigurableProviders().find(row => row.provider === 'github-copilot')
      expect(directory).toBeDefined()
      expect(directory?.error).toBeUndefined()
      normalizedNativeSettings = ctx.settings.describe({ redactSecrets: true }).find(row => row.ns === 'llm-pi-ai')?.value
      const defaults = { chatTemplateKwargs: {}, chatTemplateArgs: {} }
      expect(normalizedNativeSettings).toMatchObject({ providers: { 'github-copilot': {
        compat: { ...defaults, supportsStrictMode: strictMode },
        models: useOverrides ? [] : [{ id: MODEL, compat: defaults }],
        modelOverrides: useOverrides ? { [MODEL]: { compat: { ...defaults, supportsStrictMode: strictMode } } } : {},
      } } })
      normalizedNativeSettings = structuredClone(normalizedNativeSettings)
      const reasons: string[] = []
      expect(await captureNativeCopilot(ctx, code => reasons.push(code)), reasons.join(',')).toBeDefined()
      if (scope === 'canonical-native' && outcome === 'allow'
        || scope === 'canonical-native-turn-account' || customNative) {
        // #480 reads the plugin namespace before choosing its automatic model.
        await ctx.loader.create({ id: 'github-copilot', name: 'fixture-copilot-search-settings', config: {} })
      }
      if (scope === 'canonical-native' && outcome === 'allow') {
        await ctx.loader.create({ id: 'web', name: '@deepseek-ai/dsh-web',
          config: { searchProvider: 'github-copilot-hosted' } })
        await ctx.loader.await()
        expect(ctx.settings.describe({ redactSecrets: true }).find(row => row.ns === 'github-copilot')?.value)
          .toMatchObject({ nativeSearchModel: '' })
        const searchProvider = createNativeCopilotSearch(ctx)
        await expect(searchProvider.models()).resolves.toEqual({ models: [{ id: MODEL }] })
        expect(searchBodies).toHaveLength(0)
        const stopSearch = ctx.web.registerSearchProvider(searchProvider)
        ctx.effect(() => stopSearch)
        const beforeReady = vi.mocked(fetch).mock.calls.length
        expect(await ctx.web.searchReady('github-copilot')).toBe(true)
        expect(vi.mocked(fetch).mock.calls).toHaveLength(beforeReady)
        await expect(ctx.web.search({ query: 'normalized native search' })).resolves.toMatchObject({
          content: 'Synthetic sourced answer.', sources: [{ url: 'https://example.com' }],
        })
        expect(searchBodies).toHaveLength(2)
        expect(JSON.stringify(searchBodies[0])).not.toContain('normalized native search')
        expect(JSON.stringify(searchBodies[1])).toContain('normalized native search')
        for (const body of searchBodies) expect(body).not.toHaveProperty('temperature')
      }
    }
    const production = scope === 'production' || scope === 'production-disposed'
      ? await ctx.plugin(GitHubCopilotPlugin, { enabled: true, providers: [], probe: false })
      : undefined
    const stop = production === undefined ? installAutoReviewSampling(ctx) : () => { void production.dispose() }
    stopSampling = stop
    if (production === undefined) ctx.effect(() => stop)
    await ctx.loader.create({ name: scope === 'alias' ? 'fixture-reviewer-alias' : '@deepseek-ai/dsh-experimental-auto-review' })
    await ctx.loader.await()
    if (scope === 'disposed') await stop()
    if (scope === 'production-disposed') await production!.dispose()
    if (scope === 'canonical-native-disabled') stop()
  } else {
    await ctx.plugin(AutoReview)
  }
  let executions = 0
  ctx.tools.register(defineTool({
    name: 'probe', description: 'Synthetic reviewer compatibility probe.',
    parameters: { value: { type: 'string' } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute() { executions += 1; return 'executed' },
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
  if (scope === 'other-listener') {
    ctx.on('tools/pre-execute', async (exec, next) => {
      const ordinary = (async () => {
        for await (const _chunk of ctx.llm.stream(Object.freeze({
          provider, model: MODEL, temperature: 0.61, messages: [],
          sessionId: session.id, signal: exec.signal,
        }))) { /* consume */ }
      })()
      const decision = next()
      await ordinary
      return decision
    }, { prepend: true })
  }
  const pending = ctx.agents.withInitiator(agent, () => ctx.tools.execute({
    signal: controller.signal, agent,
    calls: [{ type: 'tool-call', id: callId, name: 'probe', arguments: rawArguments }],
  }))
  if (automatic) {
    const ordinary = ctx.agents.withInitiator(agent, async () => {
      for await (const _chunk of ctx.llm.stream(Object.freeze({
        provider, model: MODEL, temperature: 0.37, messages: [],
        sessionId: session.id, signal: new AbortController().signal,
      }))) { /* consume */ }
    })
    await Promise.all([pending, ordinary])
  }
  const batch = await pending
  if (batch.results.length !== 1) throw new Error('expected one reviewer tool result')
  const result = batch.results[0]!.result
  if (canonicalNative) {
    expect(ctx.settings.describe({ redactSecrets: true }).find(row => row.ns === 'llm-pi-ai')?.value)
      .toEqual(normalizedNativeSettings)
  }
  return { result, executions, wireCalls, wireBodies, searchBodies, wireTokens, readScopes,
    ctx, agent, model: MODEL, preview }
}

describe('native Auto reviewer Copilot compatibility', () => {
  it.each([
    'canonical-native-turn-account',
    'canonical-native-custom-turn-account',
    'canonical-native-reference-turn-account',
  ] as const)('records %s through real Loader qualification and synthetic stream delivery', async scope => {
    const { ctx, agent, model, preview, wireTokens } = await run('allow', true, undefined, scope)
    if (scope !== 'canonical-native-turn-account') {
      expect((await captureNativeCopilot(ctx))?.models.has(model)).toBe(false)
    }
    await preview.dispose()
    const register = () => ctx.effect(() => () => {})
    ctx.provide('typert', {
      resources: { register }, lookups: { configure: register, register },
      contexts: { configureHost: register, registerHost: register },
    })
    const selection = { provider: 'github-copilot', model }
    ctx.provide('agentDefaultModel', { currentSelection: () => selection })
    await ctx.plugin(Authorization)
    const plugin = await ctx.plugin(GitHubCopilotPlugin, {
      enabled: true, providers: [], includeSources: true, stripServerTools: true,
      idleTimeoutMs: 300_000, probe: false, probeTimeoutMs: 30_000,
    })
    await vi.waitFor(() => expect(ctx.get('githubCopilotSessionAccounts')).toBeDefined())
    const owner = ctx.get('githubCopilotSessionAccounts')!
    const controller = new AbortController()
    let disposed = false
    try {
      await Reflect.apply(ctx.waterfall, ctx, [scopeTarget(agent, agent), 'agent/pre-step',
        { agent, turn: 1, step: 1, messages: [], signal: controller.signal, modelSelection: selection },
        async () => ({ kind: 'enter', messages: [] })])
      await ctx.waterfall(scopeTarget(agent, agent), 'agent/request',
        { agent, turn: 1, step: 1, signal: controller.signal }, async () => selection)
      expect(owner.turns.evidence(agent.session, 1)).toBeUndefined()
      const dispatch = async (marked: boolean, purpose?: 'auto-review') => {
        const call = await ctx.llm.prepareCall(selection)
        const options = { ...call.config, temperature: 0.37, messages: [],
          sessionId: agent.session.id, signal: controller.signal, ...purpose === undefined ? {} : { purpose } }
        let chunks = 0
        for await (const _chunk of call.stream(marked ? markAgentLoopRequest(options) : options)) chunks++
        expect(chunks).toBeGreaterThan(0)
      }
      const previousWireCalls = wireTokens.length
      await dispatch(false)
      await dispatch(true, 'auto-review')
      expect(owner.turns.evidence(agent.session, 1)).toBeUndefined()
      await dispatch(true)
      expect(wireTokens.slice(previousWireCalls)).toEqual([
        'Bearer synthetic-access', 'Bearer synthetic-access', 'Bearer synthetic-access',
      ])
      await vi.waitFor(() => expect(owner.turns.evidence(agent.session, 1))
        .toMatchObject({ accountId: 'canonical', source: 'global' }))
      ctx.emit('session/event', agent.session, { type: 'turn/end', data: { turn: 1 } } as never)
      controller.abort()
      expect(owner.turns.evidence(agent.session, 1)).toMatchObject({ accountId: 'canonical', source: 'global' })
      await plugin.dispose()
      disposed = true
      expect(owner.turns.evidence(agent.session, 1)).toBeUndefined()
    } finally {
      controller.abort()
      if (!disposed) await plugin.dispose()
    }
  })
  it.each(['allow', 'deny', 'malformed', 'http-error', 'cancel'] as const)(
    'uses the actual canonical adapter without changing the native %s boundary', async outcome => {
      const result = await run(outcome, true, undefined, 'canonical-native')
      expect(result.wireBodies.filter(body => body.temperature === 0.37)).toHaveLength(1)
      expect(result.wireBodies.filter(body => !Object.hasOwn(body, 'temperature')), JSON.stringify(result.result)).toHaveLength(1)
      expect(result.wireCalls).toBe(2)
      expect(result.executions).toBe(outcome === 'allow' ? 1 : 0)
      expect(result.result.isError).toBe(outcome !== 'allow')
    })
  it('reproduces the canonical temperature failure when the enhancement is disposed', async () => {
    const result = await run('allow', true, undefined, 'canonical-native-disabled')
    expect(result.wireBodies.filter(body => body.temperature === 0)).toHaveLength(1)
    expect(result.result.isError).toBe(true)
    expect(result.executions).toBe(0)
  })
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
    it('does not group another tool listener request into the native reviewer scope', async () => {
      const result = await run('allow', true, undefined, 'other-listener')
      expect(result.executions).toBe(1)
      expect(result.wireBodies).toHaveLength(3)
      expect(result.wireBodies.filter(body => body.temperature === 0.37)).toHaveLength(1)
      expect(result.wireBodies.filter(body => body.temperature === 0.61)).toHaveLength(1)
      expect(result.wireBodies.filter(body => !Object.hasOwn(body, 'temperature'))).toHaveLength(1)
    })
    it('revokes a delayed native reviewer dispatch without cancelling concurrent Chat', async () => {
      const result = await run('allow', true, undefined, 'dispose-before-dispatch')
      expect(result.executions).toBe(0)
      expect(result.result.isError).toBe(true)
      expect(result.wireBodies).toHaveLength(1)
      expect(result.wireBodies[0]?.temperature).toBe(0.37)
    })
    it('activates reviewer-only sampling through the actual plugin Host entry', async () => {
      const result = await run('allow', true, undefined, 'production')
      expect(result.executions).toBe(1)
      expect(result.wireBodies.filter(body => body.temperature === 0.37)).toHaveLength(1)
      expect(result.wireBodies.filter(body => !Object.hasOwn(body, 'temperature'))).toHaveLength(1)
    })
    it.each(['impostor', 'descendant', 'alias', 'missing-resolution', 'disposed',
      'other-protocol', 'canonical', 'other-provider', 'retained-facade', 'late-identity', 'production-disposed'] as const)(
      'preserves native sampling for an unqualified %s scope', async scope => {
        const result = await run('allow', true, undefined, scope)
        expect(result.wireBodies.filter(body => body.temperature === 0.37)).toHaveLength(1)
        expect(result.wireBodies.filter(body => body.temperature === 0)).toHaveLength(1)
        expect(result.wireBodies.filter(body => !Object.hasOwn(body, 'temperature'))).toHaveLength(0)
      })
  })
})
