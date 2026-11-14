import '@earendil-works/pi-ai/api/openai-responses'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionController } from '@deepseek-ai/dsh-api-session-controller'
import { LlmAdapter, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import * as JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import type { SubagentRunEndInfo } from '@deepseek-ai/dsh-subagent'
import * as Spawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import * as ToolSubagent from '@deepseek-ai/dsh-tool-subagent'
import SubagentModelSelectionConfig from '@deepseek-ai/dsh-tool-subagent/model-selection-settings'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import * as GitHubCopilotPlugin from '../../src/index.ts'
import {
  GITHUB_COPILOT_CREDENTIAL_KEY as KEY,
  GITHUB_COPILOT_PREVIEW_PROVIDER_ID as PREVIEW,
} from '../../src/copilot-identity.ts'

const MODELS = ['fixture-child-a', 'fixture-child-b']
const NEW_MODEL = 'fixture-child-added-later'
const PARENT = 'fixture-parent'
const MISSING = 'fixture-missing'
const SECOND = '22222222-2222-4222-8222-222222222222'
const SECOND_KEY = `github-copilot/account-${SECOND}`

function response(model: string) {
  const item = { type: 'message', id: `message-${model}`, role: 'assistant',
    content: [{ type: 'output_text', text: `finished ${model}` }] }
  const event = (type: string, data: object) => `data: ${JSON.stringify({ type, ...data })}\n\n`
  return new Response([
    event('response.created', { response: { id: `response-${model}` } }),
    event('response.output_item.added', { output_index: 0, item }),
    event('response.output_text.delta', { output_index: 0, delta: `finished ${model}` }),
    event('response.output_item.done', { output_index: 0, item }),
    event('response.completed', { response: { status: 'completed', output: [item],
      usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 } } }),
  ].join(''), { headers: { 'content-type': 'text/event-stream' } })
}

it('routes concurrently authorized native children to their selected Copilot models and efforts', async () => {
  expect(process.env.DSH_CORE_EVIDENCE).toBe('tagged-source-runtime')
  expect(process.env.DSH_PUBLISHED_CORE_RELEASE).toBe('0.2.2-rc.3')
  const directory = await mkdtemp(join(tmpdir(), 'copilot-subagent-fixture-'))
  const ctx = new Context()
  const release = Promise.withResolvers<void>()
  let advertisedModels = MODELS
  const wire: Array<{ model: string; reasoning?: { effort?: string } }> = []
  const authorizations: Array<string | null> = []
  const signals: Array<AbortSignal | null | undefined> = []
  const completed: SubagentRunEndInfo[] = []
  const failures: Array<{ code: string; message: string }> = []
  const turnEnds: unknown[] = []
  const agentErrors: string[] = []
  ctx.on('subagent/end', info => { completed.push(info) })
  ctx.on('agent/error', ({ error }) => { agentErrors.push(String(error)) })
  ctx.on('session/event', (session, event) => {
    if (session.id !== 'copilot-subagent-parent' && event.type === 'turn/end') turnEnds.push(event.data)
  })
  ctx.on('agent/request-error', async ({ failure }, next) => {
    failures.push({ code: failure.code, message: failure.message })
    return next()
  })
  vi.stubGlobal('fetch', async (input: unknown, init?: RequestInit) => {
    if (String(input).endsWith('/user')) {
      const second = new Headers(init?.headers).get('authorization') === 'token synthetic-refresh-second'
      return Response.json({ login: second ? 'fixture-second' : 'fixture-first', id: second ? 2 : 1 })
    }
    if (String(input).endsWith('/models')) return Response.json({ data: advertisedModels.map(id => ({
      id, name: id, model_picker_enabled: true, policy: { state: 'enabled' },
      supported_endpoints: ['/responses'],
      capabilities: {
        supports: { streaming: true, tool_calls: true, vision: false, reasoning_effort: ['low', 'high'] },
        limits: { max_context_window_tokens: 128_000, max_prompt_tokens: 96_000, max_output_tokens: 4_096 },
      },
    })) })
    if (!String(input).endsWith('/responses')) throw new Error('unexpected fixture request')
    const body = JSON.parse(String(init?.body)) as typeof wire[number]
    wire.push(body)
    authorizations.push(new Headers(init?.headers).get('authorization'))
    signals.push(init?.signal)
    await release.promise
    return response(body.model)
  })

  try {
    const grant = { kind: 'grant', payload: { type: 'oauth', refresh: 'synthetic-refresh',
      access: 'synthetic-access', expires: Date.now() + 3_600_000, availableModelIds: [...MODELS, NEW_MODEL] } }
    const secondGrant = { kind: 'grant', payload: { ...grant.payload, refresh: 'synthetic-refresh-second',
      access: 'synthetic-access-second' } }
    const records = new Map([[KEY, grant], [SECOND_KEY, secondGrant]])
    const registration = () => ctx.effect(() => () => {})
    ctx.provide('typert', {
      resources: { register: registration },
      lookups: { configure: registration, register: registration },
      contexts: { configureHost: registration, registerHost: registration },
    })
    ctx.provide('fileUploads', { registerAgentResolver: registration })
    ctx.provide('credentials', {
      describeRecord: async (key: string) => ({ configured: records.has(key), writable: true }),
      readRecord: async (key: string) => records.get(key),
      listRecords: async () => [...records.keys()].map(key => ({ key, kind: 'grant' })),
      deleteRecord: async () => { throw new Error('unexpected fixture credential deletion') },
      modifyRecord: async () => { throw new Error('valid synthetic credential must not refresh') },
    })
    const settings = {
      'github-copilot': {
        activeAccountId: 'canonical',
        continuationDefaultHistory: [{ enabled: true, changedAt: 1 }],
      },
      'llm-pi-ai': { providers: {} },
    }
    let accountSettingsRevision = 0
    ctx.provide('settings', {
      describe: () => Object.entries(settings).map(([ns, value]) => ({
        ns, revision: ns === 'github-copilot' ? accountSettingsRevision : 0, value, user: value,
      })),
      mutate: async () => { throw new Error('unexpected fixture settings mutation') },
    })
    ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: PARENT, model: PARENT }) })
    await mountAgentLoopTestDependencies(ctx, { workingDirectory: true })
    ctx.provide('tokenMeter', { estimateMessage: () => 1, measure: () => ({ totalTokens: 1 }) })
    await ctx.plugin(GitHubCopilotPlugin, {
      enabled: true, providers: [], includeSources: true, stripServerTools: true,
      idleTimeoutMs: 300_000, probe: false, probeTimeoutMs: 30_000,
    })
    await vi.waitFor(() => {
      expect(ctx.get('githubCopilotSessionAccounts')).toBeDefined()
      expect(ctx.get('githubCopilotPreview')).toBeDefined()
    })
    await ctx.get('githubCopilotPreview')!.refresh()
    ctx.llm.registerAdapter([PARENT], new class extends LlmAdapter {
      async *stream(_options: GenerateOptions): AsyncGenerator<StreamChunk> {
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text: 'Parent received child result.' }
        yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Parent received child result.' } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      }
    })
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(JsonlSessionPersistence, { root: join(directory, 'sessions'), compression: 'none' })
    await ctx.plugin(SubagentRuntime)
    await ctx.plugin(Spawn, { providerName: 'spawn' })
    await ctx.plugin(ToolSubagent, { provider: 'spawn', modelSelection: true, modelDiscovery: true })
    const allowedModels = [...MODELS, NEW_MODEL, MISSING].map(model => ({ provider: PREVIEW, model }))
    await ctx.plugin(SubagentModelSelectionConfig, { enabled: true, allowedModels })

    const controller = new SessionController(ctx, { nativeOpen: false }, { canOpenPath: () => false })
    const catalog = await controller.modelCatalog()
    const models = catalog.groups.find(group => group.id === PREVIEW)?.models
    expect(models?.map(model => model.id)).toEqual(MODELS)
    expect(models?.map(model => model.reasoning?.efforts.map(effort => effort.id))).toEqual([
      ['low', 'high'], ['low', 'high'],
    ])
    const { agent: parent } = await ctx.agents.create({
      sessionId: SessionId('copilot-subagent-parent'),
      agentOptions: { provider: PARENT, model: PARENT },
    })
    expect(parent.session.snapshotEvents()).toContainEqual(expect.objectContaining({
      type: 'subagent/model-selection-policy', data: { allowedModels },
    }))

    const discovery = await ctx.agents.withInitiator(parent, () => ctx.tools.execute({
      agent: parent,
      signal: new AbortController().signal,
      calls: [{ type: 'tool-call', id: ToolCallId('discover'), name: 'list_subagent_models',
        arguments: JSON.stringify({ provider: PREVIEW }) }],
    }))
    const discoveryResult = discovery.results[0]?.result
    expect(discoveryResult?.isError).toBe(false)
    const discoveryText = discoveryResult?.content.filter(block => block.type === 'text')
      .map(block => block.text).join('')
    for (const model of MODELS) expect(discoveryText).toContain(`${PREVIEW}/${model}`)
    expect(discoveryText).not.toContain(NEW_MODEL)
    expect(discoveryText).not.toContain(MISSING)

    const call = async (id: string, model: string, effort: string) => {
      const batch = await ctx.agents.withInitiator(parent, () => ctx.tools.execute({
        agent: parent,
        signal: new AbortController().signal,
        calls: [{ type: 'tool-call', id: ToolCallId(id), name: 'subagent',
          arguments: JSON.stringify({ description: 'fixture child', prompt: `Handle ${id}.`,
            provider: PREVIEW, model, reasoning_effort: effort }) }],
      }))
      if (batch.results.length !== 1) throw new Error('expected one native subagent result')
      return batch.results[0]!.result
    }

    const [first, second] = await Promise.all([
      call('first', MODELS[0]!, 'low'),
      call('second', MODELS[1]!, 'high'),
    ])
    expect(first.isError).toBe(false)
    expect(second.isError).toBe(false)
    await vi.waitFor(() => expect(wire, JSON.stringify({ failures, completed, turnEnds, agentErrors })).toHaveLength(2), { timeout: 15_000 })
    expect(wire.map(body => [body.model, body.reasoning?.effort]).sort()).toEqual([
      [MODELS[0], 'low'], [MODELS[1], 'high'],
    ])
    expect(authorizations).toEqual(['Bearer synthetic-access', 'Bearer synthetic-access'])
    const children = ctx.agents.list().filter(agent => agent.session.header.parentSession === parent.session.id)
    expect(children).toHaveLength(2)
    const accounts = ctx.get('githubCopilotSessionAccounts')!
    for (const child of children) {
      expect(accounts.turns.current(child.session)).toMatchObject({ accountId: 'canonical', source: 'global' })
    }
    settings['github-copilot'].activeAccountId = SECOND
    ctx.emit('settings/document-updated', 'github-copilot' as SettingsNamespace, ++accountSettingsRevision)
    expect(signals.every(signal => signal && !signal.aborted)).toBe(true)
    const third = await call('third', MODELS[0]!, 'high')
    expect(third.isError).toBe(false)
    await vi.waitFor(() => expect(wire).toHaveLength(3), { timeout: 15_000 })
    expect(wire[2]).toMatchObject({ model: MODELS[0], reasoning: { effort: 'high' } })
    expect(authorizations).toEqual(['Bearer synthetic-access', 'Bearer synthetic-access', 'Bearer synthetic-access-second'])
    expect(signals.every(signal => signal && !signal.aborted)).toBe(true)
    const laterChildren = ctx.agents.list().filter(agent => agent.session.header.parentSession === parent.session.id)
    expect(laterChildren).toHaveLength(3)
    expect(laterChildren.map(child => accounts.turns.current(child.session)?.accountId).sort())
      .toEqual([SECOND, 'canonical', 'canonical'].sort())
    release.resolve()
    do { await parent.whenIdle() } while (await ctx.subagents.waitForTreeWork(parent))
    expect(completed).toHaveLength(3)
    expect(completed.every(info => info.stopReason === 'completed')).toBe(true)
    const output = completed.flatMap(info => info.lastAssistantMessage ?? [])
      .filter(block => block.type === 'text').map(block => block.text)
    for (const model of MODELS) expect(output).toContain(`finished ${model}`)

    advertisedModels = [...MODELS, NEW_MODEL]
    const refreshed = await ctx.get('githubCopilotPreview')!.discover({ force: true })
    expect(refreshed.state).toBe('ready')
    const refreshedCatalog = await controller.modelCatalog()
    const newEntry = refreshedCatalog.groups.find(group => group.id === PREVIEW)?.models.find(model => model.id === NEW_MODEL)
    expect(newEntry?.reasoning?.efforts.map(effort => effort.id)).toEqual(['low', 'high'])
    const refreshedDiscovery = await ctx.agents.withInitiator(parent, () => ctx.tools.execute({
      agent: parent, signal: new AbortController().signal,
      calls: [{ type: 'tool-call', id: ToolCallId('discover-refreshed'), name: 'list_subagent_models',
        arguments: JSON.stringify({ provider: PREVIEW }) }],
    }))
    expect(refreshedDiscovery.results[0]!.result.isError).toBe(false)
    expect(refreshedDiscovery.results[0]!.result.content.filter(block => block.type === 'text').map(block => block.text).join(''))
      .toContain(`${PREVIEW}/${NEW_MODEL}`)
    const newChild = await call('newly-discovered', NEW_MODEL, 'high')
    expect(newChild.isError).toBe(false)
    do { await parent.whenIdle() } while (await ctx.subagents.waitForTreeWork(parent))
    expect(wire).toHaveLength(4)
    expect(wire[3]).toMatchObject({ model: NEW_MODEL, reasoning: { effort: 'high' } })
    expect(authorizations[3]).toBe('Bearer synthetic-access-second')
    expect(completed).toHaveLength(4)
    expect(completed[3]?.stopReason).toBe('completed')
    expect(completed[3]?.lastAssistantMessage).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'text', text: `finished ${NEW_MODEL}` }),
    ]))

    const missing = await call('missing', MISSING, 'low')
    const unauthorized = await call('unauthorized', 'fixture-unauthorized', 'low')
    const unsupported = await call('unsupported', MODELS[0]!, 'unsupported-effort')
    expect(missing.isError).toBe(true)
    expect(unauthorized.isError).toBe(true)
    expect(unauthorized.content.filter(block => block.type === 'text').map(block => block.text).join(''))
      .toContain('is not allowed for this Session')
    expect(unsupported.isError).toBe(true)
    expect(wire).toHaveLength(4)
  } finally {
    release.resolve()
    try { await ctx.fiber.dispose() }
    finally {
      try { await rm(directory, { recursive: true, force: true }) }
      finally { vi.unstubAllGlobals() }
    }
  }
}, 30_000)
