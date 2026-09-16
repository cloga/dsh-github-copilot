/** Optional plugin-owned planner/executor sessions; no Core/default-model mutation. */
import { createHash } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import * as dshScope from '@deepseek-ai/dsh-scope'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import z from '@deepseek-ai/schemastery'
import { z as json } from 'zod'
import type {} from './dual-model-remote.ts'
import type { GitHubCopilotPreview } from './preview-route.ts'
import { GITHUB_COPILOT_PREVIEW_PROVIDER_ID as PROVIDER } from './copilot-identity.ts'
import type { DualModelConfig, DualModelView, DualModelSaveRequest, DualModelCreateRequest, DualModelCreateResult } from './dual-model-types.ts'

export const DUAL_MODEL_NAMESPACE = 'github-copilot-dual-model'
export const DUAL_MODEL_POLICY_EVENT = 'github-copilot/dual-model-policy'
export const DUAL_MODEL_PROJECTION = 'githubCopilotDualModelPolicy'
export const DUAL_MODEL_EXECUTE_TOOL = 'copilot_execute'
const DEFAULT_CONFIG: DualModelConfig = Object.freeze({ enabled: false, plannerModel: '', executorModel: '' })
const configSchema = z.object({ enabled: z.boolean().default(false), plannerModel: z.string().default(''), executorModel: z.string().default('') })
const ConfigJson = json.object({ enabled: json.boolean(), plannerModel: json.string().max(512), executorModel: json.string().max(512) }).strict()
const RevisionJson = json.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const CreateJson = json.object({ requestId: json.string().uuid(), workspaceId: json.string().min(1).max(512), expectedRevision: RevisionJson }).strict()
const SaveJson = json.object({ configuration: ConfigJson, expectedRevision: RevisionJson }).strict()
const CatalogEntryJson = json.object({ id: json.string().min(1).max(512), name: json.string().min(1).max(1024) }).strict()
const ExecuteJson = json.object({ description: json.string().min(1).max(160), prompt: json.string().min(1).max(100_000) }).strict()
const PolicyJson = json.object({ version: json.literal(1), rootSessionId: json.string(), requestId: json.string(), workspaceId: json.string(), settingsRevision: json.number().int().nonnegative(), cwd: json.string(), agentPreset: json.string(), provider: json.literal(PROVIDER), plannerModel: json.string().min(1), executorModel: json.string().min(1), executorTools: json.array(json.string()), plannerTools: json.array(json.string()) }).strict()
type Policy = json.infer<typeof PolicyJson>

// Narrow structural contracts for optional public APIs. Old supported Core packages
// need not export these newer types: capability absence disables this feature only.
interface LogEvent { readonly type: string; readonly seq: number; readonly data: unknown; readonly ignorable?: true }
interface Header { readonly id: string; readonly cwd?: string; readonly parentSession?: string; readonly origin?: string; readonly agentPreset?: string }
interface Session { readonly id: string; readonly header: Header }
interface Agent { readonly id: string; readonly ctx: Context; readonly session: Session; cancel(reason: { kind: 'disposed' }): void; whenIdle(): Promise<void> }
interface Handle { readonly agent: Agent; dispose(): Promise<void> }
interface CreateOptions { sessionId: string; agentOptions: { provider: string; model: string }; meta: { cwd: string; agentPreset: string; isSeeded: false }; inheritedEventCount: number; seed: readonly (LogEvent & { time: number })[]; signal: AbortSignal; setup(ctx: Context, agent: Agent): Promise<void> }
interface Agents { list(): Agent[]; get(id: string): Agent | undefined; create(options: CreateOptions): Promise<Handle>; resume(options: unknown): Promise<Handle> }
interface Workspace { readonly id: string; readonly title: string; readonly path: string; attachSession(id: string): Promise<void> }
interface Workspaces { list(): Workspace[]; get(id: string): Workspace | undefined }
interface Settings { readonly writable: boolean; register(ns: string, schema: unknown): unknown; describe(options: { redactSecrets: true }): readonly { ns: string; revision: number; value: unknown }[]; replace(ns: string, value: object, revision: number): Promise<void> }
interface Projections { register(definition: unknown): () => void; stateOf(session: Session, key: string): unknown }
interface Persistence { stat(id: string): Promise<unknown | undefined> }
interface Sessions { flush(session: Session): Promise<boolean> }
interface Inspector { inspect(id: string): Promise<{ meta: Header; inheritedEventCount: number; events: readonly LogEvent[] }> }
interface Presets { resolve(id?: string): Promise<{ id: string }>; mount(ctx: Context, id: string): Promise<unknown>; composedPreset(ctx: Context): string | undefined; standingKeyFor(id?: string): Promise<object> }
interface Route { readonly provider: string; readonly model: string; readonly reasoningEffort?: string }
interface Llm { resolveCallConfig(config: Route, signal?: AbortSignal): Promise<Route> }
interface ToolExec { readonly agent?: Agent; readonly name: string; readonly arguments: unknown; readonly signal: AbortSignal }
interface ToolDefinition { name: string; description: string; parameters: object; output: { schema: object; render(args: unknown, value: unknown): { type: 'text'; text: string }[] }; execute(args: unknown, exec: ToolExec): Promise<unknown> }
interface Tools { schemas(scope?: object): readonly { name: string; description: string; parameters: Record<string, unknown> }[]; register(definition: ToolDefinition): () => void; restrict(filter: { allow: readonly string[] }): () => void; guard(check: (execution: ToolExec) => string | undefined): () => void; presentAs(mode: 'native'): () => void }
interface Prompt { section(section: { name: string; order: number; text: string }): () => void }
interface Subagents { getProvider(name: string): { capabilities: { agentOptions: boolean; toolFilter: boolean; persona: boolean; depthLimit: boolean }; prepareContinuable?: unknown } | undefined; startContinuable(spec: { provider: string; label: string; request: { parent: Agent; prompt: { type: 'text'; text: string }[]; agentOptions: Route; persona: string; toolFilter: { allow: readonly string[] }; maxDepth: number }; signal: AbortSignal }): Promise<{ childId: string; messageId: string }>; sendMessage(...args: unknown[]): unknown; listChildren(...args: unknown[]): unknown; drainContinuableDescendants(roots: readonly Agent[]): Promise<void> }
interface Capabilities { agents: Agents; workspaces: Workspaces; settings: Settings; projections: Projections; persistence: Persistence; sessions: Sessions; inspector: Inspector; presets: Presets; llm: Llm; tools: Tools; subagents: Subagents; preview: GitHubCopilotPreview }
interface ChildDescriptor { readonly version: 1; readonly mode: 'continuable'; readonly provider: 'spawn'; readonly agentProvider: string; readonly agentModel: string }
interface Projection { readonly id: string; readonly parentId: string | null; readonly origin: string | null; readonly inherited: number; readonly policy: Policy | null; readonly child: ChildDescriptor | null; readonly invalid: boolean }
const ChildJson = json.object({ version: json.literal(1), mode: json.literal('continuable'), provider: json.literal('spawn'), agentProvider: json.string(), agentModel: json.string() })
const ProjectionJson = json.object({ id: json.string(), parentId: json.string().nullable(), origin: json.string().nullable(), inherited: json.number(), policy: PolicyJson.nullable(), child: ChildJson.nullable(), invalid: json.boolean() })

/** A root policy is authoritative only in its own suffix, never in a fork seed. */
export const dualModelProjection = {
  key: DUAL_MODEL_PROJECTION, stateVersion: 1, stateSchema: ProjectionJson,
  init: (header: Header, inherited = 0): Projection => ({ id: header.id, parentId: header.parentSession ?? null, origin: header.origin ?? null, inherited, policy: null, child: null, invalid: false }),
  apply: (state: Projection, event: LogEvent): Projection => {
    if (event.seq < state.inherited) return state
    if (event.type === DUAL_MODEL_POLICY_EVENT) {
      const parsed = PolicyJson.safeParse(event.data)
      if (state.policy !== null || !parsed.success || parsed.data.rootSessionId !== state.id || state.parentId !== null || event.ignorable !== true) return { ...state, invalid: true }
      return { ...state, policy: parsed.data }
    }
    if (event.type === 'subagent/descriptor' && state.origin === 'subagent') {
      const parsed = ChildJson.safeParse(event.data)
      return { ...state, child: parsed.success ? parsed.data : null }
    }
    return state
  },
}

const ROOT_TOOLS = [DUAL_MODEL_EXECUTE_TOOL, 'read', 'read_image', 'glob', 'grep', 'skill', 'ask_user_question', 'todo_write', 'send_message', 'list_agents', 'interrupt_agent'] as const
// An explicit end-capability allowlist, not a blanket MCP/shell/delegation wildcard.
// Shell execution is intentionally an executor capability; it is NOT a security sandbox.
const EXECUTOR_TOOLS = ['read', 'read_image', 'glob', 'grep', 'skill', 'write', 'edit', 'pwsh', 'bash', 'present', 'todo_write', 'send_message', 'list_agents', 'interrupt_agent', 'job_list', 'job_output', 'job_kill'] as const
const EXECUTOR_PERSONA = 'You are the execution agent for a dedicated Copilot planner/executor session. Implement only the delegated task. Your provider and model are fixed by the session policy. Do not create other agents, workflows, dynamic plugins, or alternate model calls. Report the changed files, verification, limitations, and actual results to your direct parent with send_message. Do not claim tests or work you did not perform.'
function roleText(policy: Policy, role: 'planner' | 'executor'): string {
  return role === 'planner' ? `You are the planning and acceptance agent. Read the current code and evidence, plan, clarify, delegate implementation through ${DUAL_MODEL_EXECUTE_TOOL}, and independently review results. Do not implement changes or run commands directly. Your planning model is ${policy.plannerModel}; execution is fixed to ${policy.executorModel}. Use the original send_message/list_agents/interrupt_agent controls to continue and inspect your execution children. Provider: ${PROVIDER}.` : EXECUTOR_PERSONA
}
type CreationOutcome = 'not-created' | 'uncertain'
function fail(reason: string, creation?: CreationOutcome): never { throw new RemoteError('copilot/dual-model', reason, { reason, ...creation === undefined ? {} : { creation } }) }
function creationOf(error: unknown): CreationOutcome {
  return ownRemoteFailure(error)?.creation ?? 'uncertain'
}
function object(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function api<T>(ctx: Context, key: string, methods: readonly string[]): T | undefined {
  const value: unknown = ctx.get(key)
  return object(value) && methods.every(method => typeof value[method] === 'function') ? value as T : undefined
}
function revision(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 }
const ERROR_REASONS = new Set(['DUAL_MODEL_UNSUPPORTED', 'DUAL_MODEL_READ_ONLY', 'DUAL_MODEL_REVISION_CONFLICT', 'DUAL_MODEL_MODEL_UNAVAILABLE', 'DUAL_MODEL_WORKSPACE_UNAVAILABLE', 'DUAL_MODEL_DISABLED', 'DUAL_MODEL_INVALID_REQUEST', 'DUAL_MODEL_REQUEST_CONFLICT', 'DUAL_MODEL_SAVE_FAILED', 'DUAL_MODEL_CREATE_UNCERTAIN', 'DUAL_MODEL_POLICY_INVALID', 'DUAL_MODEL_SELECTION_LOCKED', 'DUAL_MODEL_DELEGATION_DENIED', 'DUAL_MODEL_EXECUTION_FAILED'])
/** Remote errors cross bundle/realm boundaries; constructor identity is not a protocol. */
function ownRemoteFailure(error: unknown): { reason: string; creation?: CreationOutcome } | undefined {
  try {
    if (!object(error) || error.isDSHRemoteError !== true || error.code !== 'copilot/dual-model' || !object(error.details)) return undefined
    const reason = error.details.reason
    if (typeof reason !== 'string' || !ERROR_REASONS.has(reason)) return undefined
    const creation = error.details.creation
    return { reason, ...creation === 'not-created' || creation === 'uncertain' ? { creation } : {} }
  } catch { return undefined } // Even a foreign error's getters are untrusted.
}
function reasonOf(error: unknown, fallback: string): string {
  const own = ownRemoteFailure(error)
  if (own) return own.reason
  try { if (object(error) && error.code === 'SETTINGS_CONFLICT') return 'DUAL_MODEL_REVISION_CONFLICT' }
  catch { /* An opaque failure never contributes a Client-facing string. */ }
  return fallback
}
export function dualModelSessionId(requestId: string): string { return `copilot-dual-${createHash('sha256').update(requestId).digest('hex')}` }
function requestKey(request: DualModelCreateRequest): string { return JSON.stringify([request.requestId, request.workspaceId, request.expectedRevision]) }
function policyMatches(policy: Policy, request: DualModelCreateRequest): boolean { return policy.requestId === request.requestId && policy.workspaceId === request.workspaceId && policy.settingsRevision === request.expectedRevision }
function dedicatedAddress(agent: Agent): boolean {
  const owned = /^copilot-dual-[0-9a-f]{64}$/
  return owned.test(agent.id) || (agent.session.header.origin === 'subagent' && owned.test(agent.session.header.parentSession ?? ''))
}

declare module '@deepseek-ai/cordis' { interface Context { githubCopilotDualModel: GitHubCopilotDualModel } }

/** Always mountable; missing optional APIs produce a safe unsupported view. */
export default class GitHubCopilotDualModel extends Service {
  // A plain holder retains the plugin owner rather than Cordis' caller-traced
  // Service.ctx. Remotes must not lend their own fiber to durable root creation.
  private readonly owner: { readonly ctx: Context }
  private readonly lifetime = new AbortController()
  private readonly creates = new Map<string, { key: string; promise: Promise<DualModelCreateResult> }>()
  private readonly overlays = new Map<Agent, { dispose(): Promise<void>; policy: Policy; role: 'planner' | 'executor' }>()
  private readonly handles = new Map<string, Handle>()
  private settingsReady = false
  private projectionReady = false
  private registrationFailed = false

  constructor(ctx: Context) {
    super(ctx, 'githubCopilotDualModel')
    this.owner = { ctx }
    ctx.inject(['settings'], scope => {
      const settings = api<Settings>(scope, 'settings', ['register', 'describe', 'replace'])
      if (!settings) return
      try { settings.register(DUAL_MODEL_NAMESPACE, configSchema); this.settingsReady = true }
      catch { this.registrationFailed = true; return }
      scope.effect(() => () => { this.settingsReady = false })
    })
    ctx.inject(['sessionProjections'], scope => {
      const projections = api<Projections>(scope, 'sessionProjections', ['register', 'stateOf'])
      if (!projections) return
      try { projections.register(dualModelProjection); this.projectionReady = true }
      catch { this.registrationFailed = true; return }
      scope.effect(() => () => { this.projectionReady = false })
    })
    // Fail closed if an optional capability unloads while a dedicated session is
    // resident. These global registrations inspect exact owned addresses only.
    ctx.inject(['tools'], scope => {
      api<Tools>(scope, 'tools', ['guard'])?.guard(exec => exec.agent && dedicatedAddress(exec.agent) && !this.overlays.has(exec.agent) ? 'DUAL_MODEL_UNSUPPORTED' : undefined)
    })
    ctx.on('agent/request', async ({ agent }, next) => {
      const subject = agent as unknown as Agent
      if (dedicatedAddress(subject) && !this.overlays.has(subject)) {
        this.restore(subject)
        if (!this.overlays.has(subject)) fail('DUAL_MODEL_UNSUPPORTED')
      }
      return next()
    }, { prepend: true })
    ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
      const candidate = context.scope as unknown as Agent | undefined
      if (!candidate || !object(candidate.session) || !object(candidate.session.header) || !dedicatedAddress(candidate)) return next()
      const rehydrating = !this.overlays.has(candidate)
      if (rehydrating) this.restore(candidate)
      const installed = this.overlays.get(candidate)
      if (!installed) fail('DUAL_MODEL_UNSUPPORTED')
      const result = await next(), { policy, role } = installed
      const allowed = new Set(role === 'planner' ? policy.plannerTools : policy.executorTools)
      const sectionName = 'github-copilot:dual-model-role'
      // Rehydration during assembly happens after providers were collected. Include
      // its role immediately, not only on the next step after a tool denial.
      const schemas = rehydrating ? this.requireCapabilities().tools.schemas(candidate) : result.tools
      return { ...result, sections: result.sections.some(section => section.name === sectionName) ? result.sections : [...result.sections, { name: sectionName, text: roleText(policy, role) }],
        tools: schemas.filter(tool => allowed.has(tool.name)), variables: { ...result.variables, provider: PROVIDER, model: role === 'planner' ? policy.plannerModel : policy.executorModel } }
    }, { prepend: true })
    // Sync on rc.2 and valid as a synchronous listener in newer serial dispatch.
    // No cold synchronous log reads: the public pure projection owns replay.
    ctx.on('agent/created', ({ agent }) => this.restore(agent as unknown as Agent))
    ctx.on('agent/disposed', ({ agent }) => {
      const subject = agent as unknown as Agent
      const overlay = this.overlays.get(subject)
      this.overlays.delete(subject)
      if (this.handles.get(agent.id)?.agent === subject) this.handles.delete(agent.id)
      if (overlay) void overlay.dispose().catch(() => {})
    })
    ctx.effect(() => async () => {
      this.lifetime.abort()
      await Promise.allSettled([...this.creates.values()].map(value => value.promise))
      const roots = [...this.overlays].filter(([, value]) => value.role === 'planner').map(([agent]) => agent)
      const subagents = api<Subagents>(ctx, 'subagents', ['drainContinuableDescendants'])
      await subagents?.drainContinuableDescendants(roots).catch(() => {})
      for (const [agent] of this.overlays) agent.cancel({ kind: 'disposed' })
      await Promise.allSettled([...this.overlays.keys()].map(agent => agent.whenIdle()))
      await Promise.allSettled([...this.handles.values()].map(handle => handle.dispose()))
      await Promise.allSettled([...this.overlays.values()].map(overlay => overlay.dispose()))
      this.handles.clear(); this.overlays.clear()
    })
    // HMR: replay existing dedicated sessions without modifying their stored policy.
    for (const agent of api<Agents>(ctx, 'agents', ['list'])?.list() ?? []) {
      try { this.restore(agent) } catch { /* The request/tool gates refuse an incomplete dedicated activation. */ }
    }
  }

  private capabilities(): Capabilities | undefined {
    // Namespace import deliberately permits older modules without this optional
    // export to link; capability absence must not block ordinary Copilot login.
    if (typeof dshScope.createScope !== 'function' || this.lifetime.signal.aborted || this.registrationFailed || !this.settingsReady || !this.projectionReady) return undefined
    const agents = api<Agents>(this.owner.ctx, 'agents', ['list', 'get', 'create', 'resume'])
    const workspaces = api<Workspaces>(this.owner.ctx, 'workspaceRegistry', ['get', 'list'])
    const settings = api<Settings>(this.owner.ctx, 'settings', ['register', 'describe', 'replace'])
    const projections = api<Projections>(this.owner.ctx, 'sessionProjections', ['register', 'stateOf'])
    const persistence = api<Persistence>(this.owner.ctx, 'sessionPersistence', ['stat'])
    const sessions = api<Sessions>(this.owner.ctx, 'sessions', ['flush'])
    const inspector = api<Inspector>(this.owner.ctx, 'sessionController', ['inspect'])
    const presets = api<Presets>(this.owner.ctx, 'agentPresets', ['resolve', 'mount', 'composedPreset', 'standingKeyFor'])
    const llm = api<Llm>(this.owner.ctx, 'llm', ['resolveCallConfig'])
    const tools = api<Tools>(this.owner.ctx, 'tools', ['register', 'restrict', 'guard', 'schemas', 'presentAs'])
    const subagents = api<Subagents>(this.owner.ctx, 'subagents', ['getProvider', 'startContinuable', 'sendMessage', 'listChildren', 'drainContinuableDescendants'])
    const preview = api<GitHubCopilotPreview>(this.owner.ctx, 'githubCopilotPreview', ['getView', 'discover'])
    if (!agents || !workspaces || !settings || !projections || !persistence || !sessions || !inspector || !presets || !llm || !tools || !subagents || !preview) return undefined
    const provider = subagents.getProvider('spawn')
    if (!provider || typeof provider.prepareContinuable !== 'function' || !provider.capabilities.agentOptions || !provider.capabilities.persona || !provider.capabilities.toolFilter || !provider.capabilities.depthLimit) return undefined
    return { agents, workspaces, settings, projections, persistence, sessions, inspector, presets, llm, tools, subagents, preview }
  }
  private requireCapabilities(): Capabilities { return this.capabilities() ?? fail('DUAL_MODEL_UNSUPPORTED') }
  private configuration(): { configuration: DualModelConfig; revision: number | null } {
    const settings = api<Settings>(this.owner.ctx, 'settings', ['describe'])
    const descriptor = settings?.describe({ redactSecrets: true }).find(value => value.ns === DUAL_MODEL_NAMESPACE)
    if (!descriptor) return { configuration: DEFAULT_CONFIG, revision: null }
    const parsed = ConfigJson.safeParse(descriptor.value)
    if (!parsed.success || !revision(descriptor.revision)) return fail('DUAL_MODEL_UNSUPPORTED')
    return { configuration: parsed.data, revision: descriptor.revision }
  }
  async view(): Promise<DualModelView> {
    const empty = { supported: false, diagnostic: 'DUAL_MODEL_UNSUPPORTED', writable: false, revision: null, configuration: DEFAULT_CONFIG, models: [], workspaces: [] }
    try {
      const configuration = this.configuration(), cap = this.capabilities()
      if (!cap) return { ...empty, ...configuration }
      let models: DualModelView['models'] = [], diagnostic: string | undefined
      try {
        const preview = await cap.preview.discover({ force: false, signal: this.lifetime.signal })
        if (preview.available && preview.state === 'ready') models = json.array(CatalogEntryJson).max(512).parse(preview.models.map(({ id, name }) => ({ id, name })))
        else diagnostic = 'DUAL_MODEL_MODEL_UNAVAILABLE'
      } catch { diagnostic = 'DUAL_MODEL_MODEL_UNAVAILABLE' }
      return { supported: true, ...diagnostic === undefined ? {} : { diagnostic }, writable: cap.settings.writable === true, ...configuration,
        models, workspaces: json.array(CatalogEntryJson).max(1024).parse(cap.workspaces.list().map(workspace => ({ id: workspace.id, name: workspace.title }))) }
    } catch { return empty }
  }
  async save(input: DualModelSaveRequest): Promise<DualModelView> {
    try { return await this.saveOnce(input) }
    catch (error) { fail(reasonOf(error, 'DUAL_MODEL_SAVE_FAILED')) }
  }
  private async saveOnce(input: DualModelSaveRequest): Promise<DualModelView> {
    const parsed = SaveJson.safeParse(input)
    if (!parsed.success) fail('DUAL_MODEL_INVALID_REQUEST')
    const cap = this.requireCapabilities(), { configuration, expectedRevision } = parsed.data
    if (cap.settings.writable !== true) fail('DUAL_MODEL_READ_ONLY')
    if (this.configuration().revision !== expectedRevision) fail('DUAL_MODEL_REVISION_CONFLICT')
    if (configuration.enabled) await this.assertModels(cap, [configuration.plannerModel, configuration.executorModel])
    try { await cap.settings.replace(DUAL_MODEL_NAMESPACE, configuration, expectedRevision) }
    catch (error) { fail(reasonOf(error, 'DUAL_MODEL_SAVE_FAILED')) }
    return this.view()
  }
  create(input: DualModelCreateRequest): Promise<DualModelCreateResult> {
    const parsed = CreateJson.safeParse(input)
    if (!parsed.success) return Promise.reject(new RemoteError('copilot/dual-model', 'DUAL_MODEL_INVALID_REQUEST', { reason: 'DUAL_MODEL_INVALID_REQUEST' }))
    const request = parsed.data, id = dualModelSessionId(request.requestId), key = requestKey(request)
    const pending = this.creates.get(id)
    if (pending) return pending.key === key ? pending.promise : Promise.reject(new RemoteError('copilot/dual-model', 'DUAL_MODEL_REQUEST_CONFLICT', { reason: 'DUAL_MODEL_REQUEST_CONFLICT' }))
    const promise = this.createOnce(request, id).catch(error => fail(reasonOf(error, 'DUAL_MODEL_CREATE_UNCERTAIN'), creationOf(error)))
    this.creates.set(id, { key, promise })
    void promise.then(() => this.creates.delete(id), () => this.creates.delete(id))
    return promise
  }
  private async createOnce(request: DualModelCreateRequest, id: string): Promise<DualModelCreateResult> {
    let creation: CreationOutcome = 'uncertain'
    try {
    const cap = this.requireCapabilities()
    // Resolve the original operation BEFORE reading mutable settings/account state.
    // A disconnected successful create remains recoverable after a later config save.
    const existing = await cap.persistence.stat(id)
    if (existing !== undefined || cap.agents.get(id)) {
      const inspection = await cap.inspector.inspect(id)
      let state = dualModelProjection.init(inspection.meta, inspection.inheritedEventCount)
      for (const event of inspection.events) state = dualModelProjection.apply(state, event)
      if (state.invalid || !state.policy || !policyMatches(state.policy, request)) fail('DUAL_MODEL_REQUEST_CONFLICT')
      const workspace = this.workspace(cap, request.workspaceId)
      if (workspace.path !== state.policy.cwd) fail('DUAL_MODEL_REQUEST_CONFLICT')
      await workspace.attachSession(id)
      return { sessionId: id }
    }
    // Only this positive absence observation authorizes a Client to discard its
    // idempotency key after a subsequent preflight refusal.
    creation = 'not-created'
    const current = this.configuration()
    if (current.revision !== request.expectedRevision) fail('DUAL_MODEL_REVISION_CONFLICT')
    if (!current.configuration.enabled) fail('DUAL_MODEL_DISABLED')
    const workspace = this.workspace(cap, request.workspaceId)
    const captured = { ...current.configuration }
    await this.assertModels(cap, [captured.plannerModel, captured.executorModel])
    const preset = await cap.presets.resolve()
    const standingKey = await cap.presets.standingKeyFor(preset.id)
    const inheritedNames = new Set(cap.tools.schemas(standingKey).map(tool => tool.name))
    const executorTools = EXECUTOR_TOOLS.filter(name => inheritedNames.has(name))
    if (!executorTools.includes('send_message')) fail('DUAL_MODEL_UNSUPPORTED')
    if (this.configuration().revision !== request.expectedRevision) fail('DUAL_MODEL_REVISION_CONFLICT')
    if (cap.workspaces.get(workspace.id) !== workspace) fail('DUAL_MODEL_WORKSPACE_UNAVAILABLE')
    const policy: Policy = { version: 1, rootSessionId: id, requestId: request.requestId, workspaceId: workspace.id, settingsRevision: request.expectedRevision,
      cwd: workspace.path, agentPreset: preset.id, provider: PROVIDER, plannerModel: captured.plannerModel, executorModel: captured.executorModel,
      plannerTools: [...ROOT_TOOLS], executorTools: [...executorTools] }
    // Session.append currently cannot write the ignorable envelope. Seed the complete
    // external record through public CreateAgentOptions, with zero fork inheritance.
    // Once construction is invoked, no rejection proves that publication or
    // durable storage did not occur. Retries must retain this same identity.
    creation = 'uncertain'
    const handle = await cap.agents.create({ sessionId: id, agentOptions: { provider: PROVIDER, model: policy.plannerModel },
      meta: { cwd: policy.cwd, agentPreset: preset.id, isSeeded: false }, inheritedEventCount: 0,
      seed: [
        { type: DUAL_MODEL_POLICY_EVENT, seq: 0, time: Date.now(), ignorable: true, data: policy },
        // The public pending-selection vocabulary lets a cold blank Session and
        // its picker reconstruct this route without saving a global default.
        { type: 'model/selection', seq: 1, time: Date.now(), data: { provider: PROVIDER, model: policy.plannerModel } },
      ], signal: this.lifetime.signal,
      setup: async (agentCtx, agent) => { await cap.presets.mount(agentCtx, preset.id); this.install(agent, policy, 'planner') },
    })
    this.handles.set(id, handle)
    // Append is best-effort; Session.flush is the public durability barrier.
    if (!await cap.sessions.flush(handle.agent.session)) fail('DUAL_MODEL_CREATE_UNCERTAIN')
    await workspace.attachSession(id)
    return { sessionId: id }
    } catch (error) { fail(reasonOf(error, 'DUAL_MODEL_CREATE_UNCERTAIN'), creation) }
  }
  private workspace(cap: Capabilities, id: string): Workspace {
    const workspace = cap.workspaces.get(id)
    if (!workspace || typeof workspace.path !== 'string' || typeof workspace.attachSession !== 'function') fail('DUAL_MODEL_WORKSPACE_UNAVAILABLE')
    return workspace
  }
  private async assertModels(cap: Capabilities, models: readonly string[], signal = this.lifetime.signal): Promise<void> {
    try {
      signal.throwIfAborted()
      const preview = await cap.preview.discover({ force: false, signal })
      if (preview.provider !== PROVIDER || !preview.available || preview.state !== 'ready') fail('DUAL_MODEL_MODEL_UNAVAILABLE')
      for (const model of models) {
        if (!model || !preview.models.some(item => item.id === model)) fail('DUAL_MODEL_MODEL_UNAVAILABLE')
        const resolved = await cap.llm.resolveCallConfig({ provider: PROVIDER, model }, signal)
        if (resolved.provider !== PROVIDER || resolved.model !== model) fail('DUAL_MODEL_MODEL_UNAVAILABLE')
      }
      const now = cap.preview.getView()
      if (!now.available || now.state !== 'ready' || models.some(model => !now.models.some(item => item.id === model))) fail('DUAL_MODEL_MODEL_UNAVAILABLE')
      signal.throwIfAborted()
    } catch { fail('DUAL_MODEL_MODEL_UNAVAILABLE') }
  }
  private projection(agent: Agent): Projection | undefined {
    const projections = api<Projections>(this.owner.ctx, 'sessionProjections', ['stateOf'])
    const parsed = ProjectionJson.safeParse(projections?.stateOf(agent.session, DUAL_MODEL_PROJECTION))
    return parsed.success ? parsed.data : undefined
  }
  private restore(agent: Agent): void {
    if (this.overlays.has(agent)) return
    const state = this.projection(agent)
    if (!state) { if (dedicatedAddress(agent)) fail('DUAL_MODEL_UNSUPPORTED'); return }
    if (state.invalid) fail('DUAL_MODEL_POLICY_INVALID')
    if (state.policy) { this.install(agent, state.policy, 'planner'); return }
    if (state.origin !== 'subagent' || state.parentId === null) {
      if (dedicatedAddress(agent)) fail('DUAL_MODEL_POLICY_INVALID')
      return
    }
    const parent = api<Agents>(this.owner.ctx, 'agents', ['get'])?.get(state.parentId)
    if (!parent) { if (dedicatedAddress(agent)) fail('DUAL_MODEL_UNSUPPORTED'); return }
    const parentOverlay = this.overlays.get(parent)
    if (parentOverlay?.role === 'executor') fail('DUAL_MODEL_DELEGATION_DENIED')
    const parentPolicy = this.projection(parent)?.policy
    if (!parentPolicy) { if (dedicatedAddress(agent)) fail('DUAL_MODEL_POLICY_INVALID'); return }
    if (!state.child || state.child.agentProvider !== PROVIDER || state.child.agentModel !== parentPolicy.executorModel) fail('DUAL_MODEL_POLICY_INVALID')
    this.install(agent, parentPolicy, 'executor')
  }
  private install(agent: Agent, policy: Policy, role: 'planner' | 'executor'): void {
    if (this.overlays.has(agent)) return
    this.requireCapabilities()
    if (typeof agent.cancel !== 'function' || typeof agent.whenIdle !== 'function') fail('DUAL_MODEL_UNSUPPORTED')
    // Same exact key, no reparenting. Agent ownership keeps the guards alive
    // through factory quiescence; this service also retains and explicitly drains
    // every overlay on unload, including roots cold-resumed by another owner.
    const overlay = dshScope.createScope(agent.ctx, agent), scoped = overlay.ctx
    try {
      const tools = api<Tools>(scoped, 'tools', ['schemas', 'register', 'restrict', 'guard', 'presentAs'])
      const prompt = api<Prompt>(scoped, 'systemPrompt', ['section'])
      if (!tools || !prompt) fail('DUAL_MODEL_UNSUPPORTED')
      const allowed = new Set(role === 'planner' ? policy.plannerTools : policy.executorTools)
      const available = tools.schemas(agent).map(item => item.name)
      // Restriction filters inherited capabilities; a monotonic guard also covers
      // same-Agent registrations, PTC dispatch, and future dynamic registrations.
      tools.guard(exec => allowed.has(exec.name) ? undefined : 'DUAL_MODEL_TOOL_DENIED')
      tools.presentAs('native')
      tools.restrict({ allow: available.filter(name => allowed.has(name) && name !== DUAL_MODEL_EXECUTE_TOOL) })
      const selectedModel = role === 'planner' ? policy.plannerModel : policy.executorModel
      prompt.section({ name: 'github-copilot:dual-model-role', order: 1000,
        text: roleText(policy, role) })
      // The outer waterfall checks the effective route after Core selection.
      // An explicit picker change is refused, not silently replaced. The root's
      // model/selection seed and the child's descriptor supply their initial route.
      scoped.on('agent/request', async ({ signal }, next) => {
        await this.assertModels(this.requireCapabilities(), [selectedModel], signal)
        const resolved = await next()
        if (resolved.provider !== PROVIDER || resolved.model !== selectedModel) fail('DUAL_MODEL_SELECTION_LOCKED')
        return resolved
      }, { prepend: true })
      if (role === 'planner') tools.register({ name: DUAL_MODEL_EXECUTE_TOOL,
        description: `Delegate implementation to a continuable executor fixed to ${PROVIDER}/${policy.executorModel}. Returns a durable child ID, not completion. Continue with send_message and inspect with list_agents. No model override or recursive delegation is allowed.`,
        parameters: { type: 'object', additionalProperties: false, properties: { description: { type: 'string' }, prompt: { type: 'string' } }, required: ['description', 'prompt'] },
        output: { schema: { type: 'object', additionalProperties: false, properties: { childId: { type: 'string' }, provider: { type: 'string' }, model: { type: 'string' } }, required: ['childId', 'provider', 'model'] }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
        execute: async (input, exec) => {
          try {
          const parsed = ExecuteJson.safeParse(input)
          if (!parsed.success || exec.agent !== agent) fail('DUAL_MODEL_INVALID_REQUEST')
          const current = this.requireCapabilities()
          await this.assertModels(current, [policy.executorModel], exec.signal)
          const child = await current.subagents.startContinuable({ provider: 'spawn', label: parsed.data.description,
            request: { parent: agent, prompt: [{ type: 'text', text: parsed.data.prompt }], agentOptions: { provider: PROVIDER, model: policy.executorModel },
              persona: EXECUTOR_PERSONA, toolFilter: { allow: policy.executorTools }, maxDepth: 1 }, signal: exec.signal,
          })
          return { childId: child.childId, provider: PROVIDER, model: policy.executorModel }
          } catch (error) { fail(reasonOf(error, 'DUAL_MODEL_EXECUTION_FAILED')) }
        },
      })
      this.overlays.set(agent, { dispose: overlay.dispose, policy, role })
    } catch (error) { void overlay.dispose().catch(() => {}); throw error }
  }
}
