import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { isAbsolute, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import type { Agent as CoreAgent } from '@deepseek-ai/dsh-agent'
import { createScope, bindScopeParent, scopeTarget } from '@deepseek-ai/dsh-scope'
import { ToolRuntime, defineTool } from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { afterEach, describe, expect, it, vi } from 'vitest'
import GitHubCopilotDualModel, { DUAL_MODEL_NAMESPACE, DUAL_MODEL_EXECUTE_TOOL, DUAL_MODEL_POLICY_EVENT, DUAL_MODEL_PROJECTION, dualModelProjection, dualModelSessionId } from '../src/dual-model-host.ts'
import type { DualModelConfig } from '../src/dual-model-types.ts'

const require = createRequire(createRequire(import.meta.url).resolve('@deepseek-ai/dsh-agent'))
const { Session, SESSION_FORMAT_VERSION } = require('@deepseek-ai/dsh-session') as { SESSION_FORMAT_VERSION: number; Session: { create(id: CoreAgent['id'], seed?: readonly unknown[], header?: unknown, inherited?: number): CoreAgent['session'] } }
const { SessionProjectionRegistry } = require('@deepseek-ai/dsh-session-projection') as { SessionProjectionRegistry: new(ctx: Context) => { register(definition: unknown): () => void; stateOf(session: CoreAgent['session'], key: string): unknown } }
const PROVIDER = 'github-copilot-preview'
// Session validates native absolute paths. This in-memory fixture needs no disk
// directory, but its metadata must be valid on both Windows and POSIX runners.
const FIXTURE_CWD = resolve(tmpdir(), 'dsh-github-copilot-dual-model-fixture')
function operationId(label: string): string { return `00000000-0000-4000-8000-${createHash('sha256').update(label).digest('hex').slice(0, 12)}` }
const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose(); vi.restoreAllMocks() })
type FakeAgent = Pick<CoreAgent, 'id' | 'ctx' | 'session'> & { cancel: ReturnType<typeof vi.fn>; whenIdle(): Promise<void> }
type CreateInput = { sessionId: string; meta: { cwd: string; agentPreset: string; isSeeded: false }; seed: readonly { type: string; seq: number; data: unknown; ignorable?: true; time: number }[]; inheritedEventCount: number; agentOptions: { provider: string; model: string }; setup(ctx: Context, agent: FakeAgent): Promise<void> }
const names = ['read', 'write', 'edit', 'pwsh', 'subagent', 'subagent_fork', 'workflow', 'ralph', 'cordis_define', 'ask_user_question', 'todo_write', 'send_message', 'list_agents', 'interrupt_agent']

async function fixture() {
  const ctx = new Context(); contexts.push(ctx)
  const systemPrompt = new SystemPrompt(ctx, {})
  const tools = new ToolRuntime(ctx)
  const projections = new SessionProjectionRegistry(ctx)
  const presetKey = {}, presetScope = createScope(ctx, presetKey)
  for (const name of names) presetScope.ctx.get('tools')!.register(defineTool({ name, description: name, parameters: {},
    output: { schema: { type: 'boolean' }, render: () => [{ type: 'text', text: 'ok' }] }, execute: async () => true }))
  let configuration: DualModelConfig = { enabled: false, plannerModel: '', executorModel: '' }, revision = 0
  const settings = { writable: true, register: vi.fn(), describe: () => [{ ns: DUAL_MODEL_NAMESPACE, revision, value: configuration }],
    replace: vi.fn(async (_ns: string, value: DualModelConfig, expected: number) => {
      if (expected !== revision) throw Object.assign(new Error('never expose'), { code: 'SETTINGS_CONFLICT' })
      configuration = { ...value }; revision++
    }) }
  ctx.provide('settings', settings)
  let previewView = { provider: PROVIDER, configured: true, available: true, correctionActive: true, state: 'ready',
    models: [{ id: 'plan-A', name: 'Planner' }, { id: 'exec-B', name: 'Executor' }, { id: 'future-C', name: 'Future' }], rejected: [], warnings: [] }
  const preview = { getView: vi.fn(() => previewView), discover: vi.fn(async (_options?: { force?: boolean; signal?: AbortSignal }) => previewView) }
  ctx.provide('githubCopilotPreview', preview)
  const llm = { resolveCallConfig: vi.fn(async (route: { provider: string; model: string }) => ({ ...route })) }
  ctx.provide('llm', llm)
  const workspace = { id: 'workspace-1', title: 'Existing project', path: FIXTURE_CWD, attachSession: vi.fn(async (_id: string) => {}) }
  const workspaces = { get: vi.fn((id: string) => id === workspace.id ? workspace : undefined), list: () => [workspace] }
  ctx.provide('workspaceRegistry', workspaces)
  const presets = { resolve: vi.fn(async () => ({ id: 'default' })), standingKeyFor: vi.fn(async () => presetKey),
    mount: vi.fn(async (scope: Context, _id: string) => { const agent = [...agentsMap.values()].find(value => value.ctx === scope); if (agent) bindScopeParent(agent, presetKey) }), composedPreset: () => 'default' }
  ctx.provide('agentPresets', presets)
  const agentsMap = new Map<string, FakeAgent>(), stored = new Map<string, { session: CoreAgent['session']; options: CreateInput }>()
  const makeAgent = (id: string, session: CoreAgent['session']): FakeAgent => {
    const agent = { id: id as CoreAgent['id'], session, ctx, cancel: vi.fn(), whenIdle: async () => {} }
    agent.ctx = createScope(ctx, agent).ctx
    return agent
  }
  const publish = (agent: FakeAgent) => { ctx.emit(scopeTarget(agent as unknown as CoreAgent, agent), 'agent/created', { agent: agent as unknown as CoreAgent }) }
  const agents = { list: () => [...agentsMap.values()], get: (id: string) => agentsMap.get(id), resume: vi.fn(),
    create: vi.fn(async (options: CreateInput) => {
      const session = Session.create(options.sessionId as CoreAgent['id'], options.seed, { id: options.sessionId, version: SESSION_FORMAT_VERSION, createdAt: 1, ...options.meta }, options.inheritedEventCount)
      const agent = makeAgent(options.sessionId, session)
      agentsMap.set(options.sessionId, agent)
      try { await options.setup(agent.ctx, agent); publish(agent) }
      catch (error) { agentsMap.delete(options.sessionId); throw error }
      stored.set(options.sessionId, { session, options })
      return { agent, dispose: vi.fn(async () => { agentsMap.delete(agent.id); ctx.emit(scopeTarget(agent as unknown as CoreAgent, agent), 'agent/disposed', { agent: agent as unknown as CoreAgent }) }) }
    }) }
  ctx.provide('agents', agents)
  const persistence = { stat: vi.fn(async (id: string) => stored.has(id) ? { header: stored.get(id)!.session.header } : undefined) }
  ctx.provide('sessionPersistence', persistence)
  const inspector = { inspect: vi.fn(async (id: string) => {
    const session = stored.get(id)!.session
    return { meta: session.header, inheritedEventCount: session.inheritedEventCount, events: session.snapshotEvents() }
  }) }
  ctx.provide('sessionController', inspector)
  const flush = vi.fn(async () => true)
  ctx.provide('sessions', { flush })
  const subagents = { getProvider: vi.fn(() => ({ capabilities: { agentOptions: true, persona: true, toolFilter: true, depthLimit: true }, prepareContinuable() {} })),
    sendMessage: vi.fn(), listChildren: vi.fn(), drainContinuableDescendants: vi.fn(async () => {}),
    startContinuable: vi.fn(async (spec: { request: { parent: FakeAgent; agentOptions: { provider: string; model: string }; toolFilter: { allow: readonly string[] } } }) => {
      const id = `child-${agentsMap.size}`, parent = spec.request.parent
      const session = Session.create(id as CoreAgent['id'], undefined, { id, version: SESSION_FORMAT_VERSION, createdAt: 2, cwd: FIXTURE_CWD, parentSession: parent.id, origin: 'subagent', isSeeded: false })
      const append = session.append as (type: string, data: unknown) => unknown
      append.call(session, 'subagent/descriptor', { version: 3, mode: 'continuable', provider: 'spawn', label: 'task', agentProvider: spec.request.agentOptions.provider, agentModel: spec.request.agentOptions.model, toolFilter: spec.request.toolFilter })
      const agent = makeAgent(id, session); bindScopeParent(agent, presetKey); agentsMap.set(id, agent); publish(agent)
      return { childId: id, messageId: 'accepted' }
    }) }
  ctx.provide('subagents', subagents)
  const fiber = ctx.plugin(GitHubCopilotDualModel)
  await Promise.resolve(); await Promise.resolve()
  const service = ctx.get('githubCopilotDualModel')!
  const enable = () => service.save({ configuration: { enabled: true, plannerModel: 'plan-A', executorModel: 'exec-B' }, expectedRevision: revision })
  const create = (requestId = 'operation-one') => service.create({ requestId: operationId(requestId), workspaceId: workspace.id, expectedRevision: revision })
  const execute = async (agent: FakeAgent, name: string, args: unknown = {}) => tools.execute({ agent: agent as unknown as CoreAgent, name, arguments: args, callId: 'call' as Parameters<ToolRuntime['execute']>[0]['callId'], signal: new AbortController().signal })
  return { ctx, fiber, service, tools, systemPrompt, projections, settings, llm, preview, workspace, workspaces, presets, agents, agentsMap, stored, inspector, persistence, flush, subagents, makeAgent, publish, enable, create, execute,
    configuration: () => configuration, revision: () => revision, setPreview: (value: typeof previewView) => { previewView = value }, previewView: () => previewView }
}

describe('optional dedicated planner/executor Host', () => {
  it('uses native absolute fixture metadata without relaxing Core path validation', () => {
    const id = 'native-path-fixture' as CoreAgent['id']
    const header = { id, version: SESSION_FORMAT_VERSION, createdAt: 1, isSeeded: false }
    expect(isAbsolute(FIXTURE_CWD)).toBe(true)
    expect(Session.create(id, undefined, { ...header, cwd: FIXTURE_CWD }).header.cwd).toBe(FIXTURE_CWD)
    expect(() => Session.create(id, undefined, { ...header, cwd: 'relative-project' })).toThrow(/cwd must be an absolute path/)
  })
  it('is unsupported without public seams and leaves ordinary login usable', async () => {
    const ctx = new Context(); contexts.push(ctx); const service = new GitHubCopilotDualModel(ctx)
    expect(await service.view()).toMatchObject({ supported: false, writable: false, configuration: { enabled: false } })
    await expect(service.create({ requestId: operationId('test'), workspaceId: 'project', expectedRevision: 0 })).rejects.toMatchObject({ details: { reason: 'DUAL_MODEL_UNSUPPORTED' } })
  })
  it('starts disabled, exposes account models and uses one namespace CAS', async () => {
    const f = await fixture()
    expect(await f.service.view()).toMatchObject({ supported: true, revision: 0, configuration: { enabled: false }, models: [{ id: 'plan-A' }, { id: 'exec-B' }, { id: 'future-C' }] })
    await expect(f.create()).rejects.toMatchObject({ details: { reason: 'DUAL_MODEL_DISABLED' } })
    await f.enable()
    expect(f.settings.replace).toHaveBeenCalledWith(DUAL_MODEL_NAMESPACE, { enabled: true, plannerModel: 'plan-A', executorModel: 'exec-B' }, 0)
    await expect(f.service.save({ configuration: f.configuration(), expectedRevision: 0 })).rejects.toMatchObject({ details: { reason: 'DUAL_MODEL_REVISION_CONFLICT' } })
  })
  it('honors read-only settings and rejects unentitled models without fallback', async () => {
    const f = await fixture(); f.settings.writable = false
    await expect(f.enable()).rejects.toMatchObject({ details: { reason: 'DUAL_MODEL_READ_ONLY' } })
    f.settings.writable = true
    await expect(f.service.save({ configuration: { enabled: true, plannerModel: 'unknown', executorModel: 'exec-B' }, expectedRevision: 0 })).rejects.toMatchObject({ details: { reason: 'DUAL_MODEL_MODEL_UNAVAILABLE' } })
    expect(f.agents.create).not.toHaveBeenCalled(); expect(f.settings.replace).not.toHaveBeenCalled()
  })
  it('seeds an immutable plugin policy before publication, flushes, and attaches only an existing workspace', async () => {
    const f = await fixture(); await f.enable(); const result = await f.create()
    const options = f.agents.create.mock.calls[0]![0]
    expect(options).toMatchObject({ sessionId: result.sessionId, agentOptions: { provider: PROVIDER, model: 'plan-A' }, meta: { isSeeded: false, cwd: FIXTURE_CWD }, inheritedEventCount: 0 })
    expect(options.seed[0]).toMatchObject({ type: DUAL_MODEL_POLICY_EVENT, ignorable: true, data: { plannerModel: 'plan-A', executorModel: 'exec-B', rootSessionId: result.sessionId } })
    expect(f.flush).toHaveBeenCalledOnce(); expect(f.workspace.attachSession).toHaveBeenCalledWith(result.sessionId)
    await f.service.save({ configuration: { enabled: true, plannerModel: 'future-C', executorModel: 'future-C' }, expectedRevision: f.revision() })
    expect(options.seed[0]!.data).toMatchObject({ plannerModel: 'plan-A', executorModel: 'exec-B' })
  })
  it('single-flights repeated creates and recovers the original operation before a later settings revision', async () => {
    const f = await fixture(); await f.enable()
    const request = { requestId: operationId('retry'), workspaceId: f.workspace.id, expectedRevision: f.revision() }
    const [a, b] = await Promise.all([f.service.create(request), f.service.create(request)])
    expect(a).toEqual(b); expect(f.agents.create).toHaveBeenCalledOnce()
    await f.service.save({ configuration: { enabled: false, plannerModel: '', executorModel: '' }, expectedRevision: f.revision() })
    expect(await f.service.create(request)).toEqual(a)
    expect(f.agents.create).toHaveBeenCalledOnce()
    await expect(f.service.create({ ...request, workspaceId: 'different' })).rejects.toMatchObject({ details: { reason: 'DUAL_MODEL_REQUEST_CONFLICT' } })
  })
  it('rejects unavailable workspace and account disappearance without creating a session', async () => {
    const f = await fixture(); await f.enable()
    await expect(f.service.create({ requestId: operationId('bad-project'), workspaceId: 'missing', expectedRevision: f.revision() })).rejects.toMatchObject({ details: { reason: 'DUAL_MODEL_WORKSPACE_UNAVAILABLE' } })
    f.setPreview({ ...f.previewView(), available: false, models: [] })
    await expect(f.create()).rejects.toMatchObject({ details: { reason: 'DUAL_MODEL_MODEL_UNAVAILABLE' } })
    expect(f.agents.create).not.toHaveBeenCalled()
  })
  it('denies direct implementation and alternate delegation, retaining genuine parent controls', async () => {
    const f = await fixture(); await f.enable(); const { sessionId } = await f.create(), agent = f.agentsMap.get(sessionId)!
    for (const name of ['write', 'pwsh', 'subagent', 'subagent_fork', 'workflow', 'ralph', 'cordis_define']) expect((await f.execute(agent, name)).isError).toBe(true)
    for (const name of ['send_message', 'list_agents', 'interrupt_agent']) expect((await f.execute(agent, name)).isError).toBe(false)
    const own = createScope(f.ctx, agent)
    own.ctx.get('tools')!.register(defineTool({ name: 'dynamic_bypass', description: 'bypass', parameters: {}, output: { schema: { type: 'boolean' }, render: () => [] }, execute: async () => true }))
    expect((await f.execute(agent, 'dynamic_bypass')).isError).toBe(true)
    const ordinary = f.makeAgent('ordinary', Session.create('ordinary' as CoreAgent['id'])); bindScopeParent(ordinary, await f.presets.standingKeyFor())
    expect((await f.execute(ordinary, 'write')).isError).toBe(false)
  })
  it.each([
    { version: 3, mode: 'continuable', provider: 'spawn', label: 'inherited model' },
    { version: 3, mode: 'continuable', provider: 'fork', label: 'forked child', agentProvider: PROVIDER, agentModel: 'exec-B' },
  ])('leaves ordinary native children unaffected by narrow role descriptor validation: $provider', async descriptor => {
    const f = await fixture()
    const parent = f.makeAgent('ordinary-parent', Session.create('ordinary-parent' as CoreAgent['id']))
    f.agentsMap.set(parent.id, parent)
    const id = `ordinary-${descriptor.provider}-child`
    const session = Session.create(id as CoreAgent['id'], undefined, {
      id, version: SESSION_FORMAT_VERSION, createdAt: 2, cwd: FIXTURE_CWD,
      parentSession: parent.id, origin: 'subagent', isSeeded: false,
    })
    const append = session.append as (type: string, data: unknown) => unknown
    append.call(session, 'subagent/descriptor', descriptor)
    const child = f.makeAgent(id, session)
    bindScopeParent(child, await f.presets.standingKeyFor())
    f.agentsMap.set(id, child)
    expect(f.projections.stateOf(session, DUAL_MODEL_PROJECTION)).toMatchObject({ invalid: true, child: null })
    expect(() => f.publish(child)).not.toThrow()
    expect((await f.execute(child, 'write')).isError).toBe(false)
    expect(f.tools.get(DUAL_MODEL_EXECUTE_TOOL, child)).toBeUndefined()
  })
  it('still rejects invalid child descriptors when their parent has a dedicated role policy', async () => {
    const f = await fixture(); await f.enable()
    const { sessionId } = await f.create()
    const id = 'invalid-dedicated-child'
    const session = Session.create(id as CoreAgent['id'], undefined, {
      id, version: SESSION_FORMAT_VERSION, createdAt: 2, cwd: FIXTURE_CWD,
      parentSession: sessionId, origin: 'subagent', isSeeded: false,
    })
    const append = session.append as (type: string, data: unknown) => unknown
    append.call(session, 'subagent/descriptor', { version: 3, mode: 'continuable', provider: 'spawn', label: 'missing model' })
    const child = f.makeAgent(id, session)
    bindScopeParent(child, await f.presets.standingKeyFor())
    expect(() => f.publish(child)).toThrow('DUAL_MODEL_POLICY_INVALID')
    expect((await f.execute(child, 'write')).isError).toBe(true)
  })
  it('fixes the native executor route, records lineage, and prevents executor delegation', async () => {
    const f = await fixture(); await f.enable(); const { sessionId } = await f.create(), parent = f.agentsMap.get(sessionId)!
    expect((await f.execute(parent, DUAL_MODEL_EXECUTE_TOOL, { description: 'Implement task', prompt: 'Do it', model: 'future-C' })).isError).toBe(true)
    const result = await f.execute(parent, DUAL_MODEL_EXECUTE_TOOL, { description: 'Implement task', prompt: 'Do it' })
    expect(result.isError).toBe(false)
    expect(f.subagents.startContinuable).toHaveBeenCalledWith(expect.objectContaining({ provider: 'spawn', request: expect.objectContaining({ parent, maxDepth: 1, agentOptions: { provider: PROVIDER, model: 'exec-B' }, toolFilter: { allow: expect.arrayContaining(['write', 'send_message']) } }) }))
    const child = [...f.agentsMap.values()].find(agent => agent.session.header.origin === 'subagent')!
    expect(child.session.header.parentSession).toBe(parent.id)
    expect(child.session.header.cwd).toBe(FIXTURE_CWD)
    expect((await f.execute(child, 'write')).isError).toBe(false)
    expect((await f.execute(child, 'subagent')).isError).toBe(true)
    expect((await f.execute(child, DUAL_MODEL_EXECUTE_TOOL, { description: 'again', prompt: 'again' })).isError).toBe(true)
  })
  it('reinstalls scoped controls on cold replay and never captures new configuration', async () => {
    const f = await fixture(); await f.enable(); const { sessionId } = await f.create()
    const original = f.agentsMap.get(sessionId)!, saved = original.session.snapshotEvents()
    f.ctx.emit(scopeTarget(original as unknown as CoreAgent, original), 'agent/disposed', { agent: original as unknown as CoreAgent }); f.agentsMap.delete(sessionId)
    await Promise.resolve()
    await f.service.save({ configuration: { enabled: true, plannerModel: 'future-C', executorModel: 'future-C' }, expectedRevision: f.revision() })
    const restoredSession = Session.create(original.id, saved, original.session.header, 0), resumed = f.makeAgent(sessionId, restoredSession)
    bindScopeParent(resumed, await f.presets.standingKeyFor()); f.agentsMap.set(sessionId, resumed); f.publish(resumed)
    expect(f.tools.get(DUAL_MODEL_EXECUTE_TOOL, resumed)?.description).toContain('/exec-B')
    expect((await f.execute(resumed, 'write')).isError).toBe(true)
    expect(f.projections.stateOf(restoredSession, DUAL_MODEL_PROJECTION)).toMatchObject({ policy: { executorModel: 'exec-B' } })
  })
  it('cleans scoped definitions on disposal without removing ordinary tools', async () => {
    const f = await fixture(); await f.enable(); const { sessionId } = await f.create(), parent = f.agentsMap.get(sessionId)!
    await f.fiber.dispose()
    expect(f.tools.get(DUAL_MODEL_EXECUTE_TOOL, parent)).toBeUndefined()
    expect(f.tools.schemas(await f.presets.standingKeyFor()).map(tool => tool.name)).toContain('write')
    expect(parent.cancel).toHaveBeenCalled()
  })
  it('checks effective request routes and refuses picker changes rather than silently overriding them', async () => {
    const f = await fixture(); await f.enable(); const { sessionId } = await f.create(), root = f.agentsMap.get(sessionId)!
    const options = f.agents.create.mock.calls[0]![0]
    expect(options.seed[1]).toMatchObject({ type: 'model/selection', data: { provider: PROVIDER, model: 'plan-A' } })
    const payload = { agent: root as unknown as CoreAgent, turn: 1, step: 1, signal: new AbortController().signal }
    const request = (model: string) => f.ctx.waterfall(scopeTarget(root as unknown as CoreAgent, root), 'agent/request', payload, async () => ({ provider: PROVIDER, model }))
    expect(await request('plan-A')).toMatchObject({ model: 'plan-A' })
    await expect(request('future-C')).rejects.toMatchObject({ details: { reason: 'DUAL_MODEL_SELECTION_LOCKED' } })
    f.setPreview({ ...f.previewView(), available: false, models: [] })
    await expect(request('plan-A')).rejects.toMatchObject({ details: { reason: 'DUAL_MODEL_MODEL_UNAVAILABLE' } })
  })
  it('forwards the service lifetime to view discovery and the step signal to route preflight', async () => {
    const f = await fixture(); await f.service.view()
    const lifetime = f.preview.discover.mock.calls.at(-1)?.[0]?.signal
    expect(lifetime).toBeInstanceOf(AbortSignal)
    await f.enable(); const { sessionId } = await f.create(), parent = f.agentsMap.get(sessionId)!
    const controller = new AbortController()
    await f.ctx.waterfall(scopeTarget(parent as unknown as CoreAgent, parent), 'agent/request',
      { agent: parent as unknown as CoreAgent, turn: 1, step: 1, signal: controller.signal }, async () => ({ provider: PROVIDER, model: 'plan-A' }))
    expect(f.preview.discover).toHaveBeenLastCalledWith({ force: false, signal: controller.signal })
    await f.fiber.dispose()
    expect(lifetime?.aborted).toBe(true)
  })
  it('cancels executor discovery without creating a child or exposing dependency errors', async () => {
    const f = await fixture(); await f.enable(); const { sessionId } = await f.create(), parent = f.agentsMap.get(sessionId)!
    const controller = new AbortController(), started = Promise.withResolvers<AbortSignal>()
    f.preview.discover.mockImplementationOnce(options => new Promise((_resolve, reject) => {
      const signal = options?.signal
      if (!signal) throw new Error('expected caller cancellation')
      signal.addEventListener('abort', () => reject(new Error('private account detail')), { once: true })
      started.resolve(signal)
    }))
    const operation = f.tools.execute({ agent: parent as unknown as CoreAgent, name: DUAL_MODEL_EXECUTE_TOOL,
      arguments: { description: 'Implement', prompt: 'Implement the task' }, callId: 'cancelled-call' as Parameters<ToolRuntime['execute']>[0]['callId'], signal: controller.signal })
    expect(await started.promise).toBe(controller.signal)
    controller.abort()
    const result = await operation
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result)).not.toContain('private account detail')
    expect(f.subagents.startContinuable).not.toHaveBeenCalled()
  })
  it('assembles planner instructions and can restore them before the first post-HMR model call', async () => {
    const f = await fixture(); await f.enable(); const { sessionId } = await f.create(), parent = f.agentsMap.get(sessionId)!
    f.ctx.emit(scopeTarget(parent as unknown as CoreAgent, parent), 'agent/disposed', { agent: parent as unknown as CoreAgent })
    await Promise.resolve(); await Promise.resolve()
    const result = await f.systemPrompt.assemble({ scope: parent })
    expect(result.variables).toMatchObject({ provider: PROVIDER, model: 'plan-A' })
    expect(result.sections.find(section => section.name === 'github-copilot:dual-model-role')?.text).toContain('independently review')
    expect(result.tools.map(tool => tool.name)).toContain(DUAL_MODEL_EXECUTE_TOOL)
    expect(result.tools.map(tool => tool.name)).not.toContain('write')
    expect((await f.execute(parent, 'read')).isError).toBe(false)
  })
  it('recovers the same durable operation after service restart and a settings change', async () => {
    const f = await fixture(); await f.enable()
    const input = { requestId: operationId('restart'), workspaceId: f.workspace.id, expectedRevision: f.revision() }
    const result = await f.service.create(input)
    await f.service.save({ configuration: { enabled: false, plannerModel: '', executorModel: '' }, expectedRevision: f.revision() })
    await f.fiber.dispose()
    f.ctx.plugin(GitHubCopilotDualModel); await Promise.resolve(); await Promise.resolve()
    expect(await f.ctx.get('githubCopilotDualModel')!.create(input)).toEqual(result)
    expect(f.agents.create).toHaveBeenCalledOnce()
  })
  it('never reports not-created for a lost response when dependencies or its existing workspace are unavailable', async () => {
    const f = await fixture(); await f.enable()
    const input = { requestId: operationId('lost-response'), workspaceId: f.workspace.id, expectedRevision: f.revision() }
    const original = await f.service.create(input)
    f.ctx.set('agents', undefined)
    await expect(f.service.create(input)).rejects.toMatchObject({ details: { reason: 'DUAL_MODEL_UNSUPPORTED', creation: 'uncertain' } })
    f.ctx.set('agents', f.agents)
    f.workspaces.get.mockReturnValueOnce(undefined)
    await expect(f.service.create(input)).rejects.toMatchObject({ details: { reason: 'DUAL_MODEL_WORKSPACE_UNAVAILABLE', creation: 'uncertain' } })
    expect(await f.service.create(input)).toEqual(original)
    expect(f.agents.create).toHaveBeenCalledOnce()
  })
  it('reports not-created only after proving absence and before construction begins', async () => {
    const f = await fixture()
    await expect(f.create()).rejects.toMatchObject({ details: { reason: 'DUAL_MODEL_DISABLED', creation: 'not-created' } })
    await f.enable()
    f.workspaces.get.mockReturnValueOnce(undefined)
    await expect(f.create()).rejects.toMatchObject({ details: { reason: 'DUAL_MODEL_WORKSPACE_UNAVAILABLE', creation: 'not-created' } })
    f.agents.create.mockRejectedValueOnce(new Error('unknown setup outcome'))
    await expect(f.create()).rejects.toMatchObject({ details: { reason: 'DUAL_MODEL_CREATE_UNCERTAIN', creation: 'uncertain' } })
  })
  it('recovers a durable create after uncertain workspace attachment without a second root', async () => {
    const f = await fixture(); await f.enable()
    f.workspace.attachSession.mockRejectedValueOnce(new Error('credential-body-must-not-escape'))
    await expect(f.create()).rejects.toMatchObject({ message: 'DUAL_MODEL_CREATE_UNCERTAIN', details: { reason: 'DUAL_MODEL_CREATE_UNCERTAIN' } })
    const result = await f.create()
    expect(result.sessionId).toBe(dualModelSessionId(operationId('operation-one')))
    expect(f.agents.create).toHaveBeenCalledOnce()
  })
  it('restores executor restrictions from cold descriptor under its unchanged parent policy', async () => {
    const f = await fixture(); await f.enable(); const { sessionId } = await f.create(), parent = f.agentsMap.get(sessionId)!
    await f.execute(parent, DUAL_MODEL_EXECUTE_TOOL, { description: 'Build', prompt: 'Implement' })
    const child = [...f.agentsMap.values()].find(agent => agent.session.header.origin === 'subagent')!, saved = child.session.snapshotEvents()
    f.ctx.emit(scopeTarget(child as unknown as CoreAgent, child), 'agent/disposed', { agent: child as unknown as CoreAgent }); f.agentsMap.delete(child.id)
    await f.service.save({ configuration: { enabled: true, plannerModel: 'future-C', executorModel: 'future-C' }, expectedRevision: f.revision() })
    const resumed = f.makeAgent(child.id, Session.create(child.id, saved, child.session.header, 0))
    bindScopeParent(resumed, await f.presets.standingKeyFor()); f.agentsMap.set(child.id, resumed); f.publish(resumed)
    expect((await f.execute(resumed, 'write')).isError).toBe(false)
    expect((await f.execute(resumed, 'workflow')).isError).toBe(true)
    const payload = { agent: resumed as unknown as CoreAgent, turn: 2, step: 1, signal: new AbortController().signal }
    const result = await f.ctx.waterfall(scopeTarget(resumed as unknown as CoreAgent, resumed), 'agent/request', payload, async () => ({ provider: PROVIDER, model: 'exec-B' }))
    expect(result.model).toBe('exec-B')
  })
  it('refuses a renamed model from the resolver and bounds credential-free DTOs', async () => {
    const f = await fixture()
    f.llm.resolveCallConfig.mockImplementation(async route => ({ ...route, model: 'other' }))
    await expect(f.enable()).rejects.toMatchObject({ details: { reason: 'DUAL_MODEL_MODEL_UNAVAILABLE' } })
    f.preview.discover.mockRejectedValueOnce(new Error('secret-never-exported'))
    expect(await f.service.view()).toMatchObject({ supported: true, diagnostic: 'DUAL_MODEL_MODEL_UNAVAILABLE', models: [] })
    f.setPreview({ ...f.previewView(), models: [{ id: 'a'.repeat(513), name: 'Invalid length' }] })
    expect(await f.service.view()).toMatchObject({ diagnostic: 'DUAL_MODEL_MODEL_UNAVAILABLE', models: [] })
  })
  it('recognizes cross-bundle Remote errors but exports only its fixed reason vocabulary', async () => {
    const f = await fixture()
    f.settings.replace.mockRejectedValueOnce({ isDSHRemoteError: true, code: 'copilot/dual-model', details: { reason: 'DUAL_MODEL_READ_ONLY' } })
    await expect(f.enable()).rejects.toMatchObject({ details: { reason: 'DUAL_MODEL_READ_ONLY' } })
    f.settings.replace.mockRejectedValueOnce({ isDSHRemoteError: true, code: 'copilot/dual-model', details: { reason: 'private account body', creation: 'not-created' } })
    await expect(f.enable()).rejects.toMatchObject({ message: 'DUAL_MODEL_SAVE_FAILED', details: { reason: 'DUAL_MODEL_SAVE_FAILED' } })
    f.settings.replace.mockRejectedValueOnce({ code: 'copilot/dual-model', details: { reason: 'DUAL_MODEL_READ_ONLY' } })
    await expect(f.enable()).rejects.toMatchObject({ details: { reason: 'DUAL_MODEL_SAVE_FAILED' } })
  })
  it('does not let dependency Remote details forge the create outcome or leak an unknown reason', async () => {
    const f = await fixture(); await f.enable()
    f.workspace.attachSession.mockRejectedValueOnce({ isDSHRemoteError: true, code: 'copilot/dual-model', details: { reason: 'DUAL_MODEL_WORKSPACE_UNAVAILABLE', creation: 'not-created' } })
    await expect(f.create()).rejects.toMatchObject({ details: { reason: 'DUAL_MODEL_WORKSPACE_UNAVAILABLE', creation: 'uncertain' } })
    f.workspace.attachSession.mockRejectedValueOnce({ isDSHRemoteError: true, code: 'copilot/dual-model', details: { reason: 'secret-body', creation: 'invalid-literal' } })
    await expect(f.create()).rejects.toMatchObject({ message: 'DUAL_MODEL_CREATE_UNCERTAIN', details: { reason: 'DUAL_MODEL_CREATE_UNCERTAIN', creation: 'uncertain' } })
    expect(f.agents.create).toHaveBeenCalledOnce()
  })
  it('fails closed on an owned address when the replay capability disappears', async () => {
    const f = await fixture(); await f.enable(); const { sessionId } = await f.create(), parent = f.agentsMap.get(sessionId)!
    f.ctx.emit(scopeTarget(parent as unknown as CoreAgent, parent), 'agent/disposed', { agent: parent as unknown as CoreAgent })
    await Promise.resolve()
    f.ctx.set('sessionProjections', undefined)
    expect((await f.execute(parent, 'write')).isError).toBe(true)
    expect(() => f.publish(parent)).toThrow('DUAL_MODEL_UNSUPPORTED')
  })
  it('ignores fork-inherited root policy and refuses an own malformed policy', () => {
    const state = dualModelProjection.init({ id: 'fork', parentSession: 'root' }, 10)
    expect(dualModelProjection.apply(state, { seq: 0, type: DUAL_MODEL_POLICY_EVENT, data: {} })).toBe(state)
    expect(dualModelProjection.apply(state, { seq: 10, type: DUAL_MODEL_POLICY_EVENT, data: {}, ignorable: true }).invalid).toBe(true)
    expect(dualModelSessionId('same')).toBe(dualModelSessionId('same'))
  })
})
