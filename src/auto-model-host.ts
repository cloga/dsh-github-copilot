import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { boundContextSummary, createUserMessage, LlmError } from '@deepseek-ai/dsh-llm'
import type { AccountModelDescriptor } from './account-model-catalog.ts'
import { AutoModelRoutingError, selectAutoModel } from './auto-model-routing.ts'
import type { AutoModelDecision, AutoModelRoutingContext } from './auto-model-routing.ts'
import { autoModelPreference, GITHUB_COPILOT_PREVIEW_PROVIDER_ID } from './copilot-identity.ts'
import type { AutoModelPreference } from './copilot-identity.ts'
import { DEFAULT_REQUEST_BUDGET_POLICY, resolveRequestBudgetPolicy } from './request-budget.ts'
import type { RequestBudgetPolicy } from './request-budget.ts'
import { TurnSelectionStore } from './turn-selection.ts'
import { z } from 'zod'
import {
  PARENT_MODEL_FOLLOW_PROJECTION, initialFollowState, foldFollowState, followSelection,
  resolveParentModel, ParentModelFollowError,
} from './parent-model-follow.ts'
import type { ParentModelBinding, FollowSelection, FollowSubject } from './parent-model-follow.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { githubCopilotTurnSelection: { get(agent: Agent, turn: number): ReturnType<TurnSelectionStore['get']> } }
}

export interface AutoModelHostDependencies {
  loadModels(signal: AbortSignal): Promise<readonly AccountModelDescriptor[]>
  budgetPolicy?: () => Partial<RequestBudgetPolicy>
  parentModelBindings?: () => readonly ParentModelBinding[]
}

interface CapturedTurn {
  readonly turn: number
  readonly messages: readonly unknown[]
}

interface RoutedTurn {
  readonly turn: number
  readonly decision: AutoModelDecision
  recorded: boolean
}

function failure(code: string): LlmError {
  return new LlmError(code, 'INVALID_REQUEST')
}

async function decide(
  dependencies: AutoModelHostDependencies,
  signal: AbortSignal,
  messages: readonly unknown[],
  preference: AutoModelPreference,
  context?: AutoModelRoutingContext,
): Promise<AutoModelDecision> {
  try { return selectAutoModel(await dependencies.loadModels(signal), messages, preference, context) }
  catch (cause) {
    if (cause instanceof AutoModelRoutingError) throw failure(cause.code)
    throw cause
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function buildRoutingContext(
  ctx: Context,
  agent: Agent,
  turn: number,
  messages: readonly unknown[],
  budgetPolicyConfig?: Partial<RequestBudgetPolicy>,
): AutoModelRoutingContext {
  const meter: unknown = (ctx as unknown as { get(name: string): unknown }).get('tokenMeter')
  if (!record(meter) || typeof meter.estimateMessage !== 'function' || typeof meter.measure !== 'function') {
    throw failure('COPILOT_AUTO_TOKEN_METER_UNAVAILABLE')
  }
  const measured: unknown = meter.measure(agent.session)
  if (!record(measured) || typeof measured.totalTokens !== 'number'
    || !Number.isSafeInteger(measured.totalTokens) || measured.totalTokens < 0) {
    throw failure('COPILOT_AUTO_TOKEN_ESTIMATE_INVALID')
  }
  const estimate = meter.estimateMessage.bind(meter)
  const estimateMessage = (message: unknown): number => {
    const value: unknown = estimate(message)
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
      throw failure('COPILOT_AUTO_TOKEN_ESTIMATE_INVALID')
    }
    return value
  }
  const sessionId = typeof agent.session?.id === 'string' ? agent.session.id : undefined
  const compaction: unknown = (ctx as unknown as { get(name: string): unknown }).get('compaction')
  const compactionConfig = record(compaction) && record(compaction.config) ? compaction.config : undefined
  const compactionAvailable = compaction !== undefined
    && compactionConfig?.auto !== false
    && (typeof compactionConfig?.maxOverflowRetries !== 'number' || compactionConfig.maxOverflowRetries > 0)
  const hasCompactionSummary = messages.some(m =>
    record(m) && (record(m.source) && (m.source.kind === 'compaction' || m.source.kind === 'compact-checkpoint')
      || typeof m.surfaceOp === 'object'))
  const requestHeader = typeof agent.session?.requestHeader === 'function' ? agent.session.requestHeader() : undefined
  const requestedMaxTokens = requestHeader?.config.maxTokens
  const requestBudgetPolicy = budgetPolicyConfig ? resolveRequestBudgetPolicy(budgetPolicyConfig) : DEFAULT_REQUEST_BUDGET_POLICY
  return {
    estimateMessage,
    inputTokenFloor: measured.totalTokens,
    sessionId,
    turn,
    requestedMaxTokens,
    requestBudgetPolicy,
    compactionAvailable,
    hasCompactionSummary,
  }
}

function pendingAuto(ctx: Context, agent: Agent): string | undefined {
  const candidate: unknown = ctx.get('sessionProjections')
  if (!record(candidate) || typeof candidate.stateOf !== 'function') return undefined
  const state: unknown = candidate.stateOf(agent.session, 'modelSelection')
  if (!record(state) || !record(state.pending) || state.pending.provider !== GITHUB_COPILOT_PREVIEW_PROVIDER_ID) return undefined
  return typeof state.pending.model === 'string' && autoModelPreference(state.pending.model) !== undefined
    ? state.pending.model : undefined
}

function modelSelectionNotice(value: unknown): boolean {
  return record(value) && record(value.source) && value.source.kind === 'model-selection'
}

function routeLabel(provider: string, model: string, otherProvider: string): string {
  return provider === otherProvider ? model : `${provider}/${model}`
}

function actualNotice(agent: Agent, model: string) {
  const previous = agent.session.requestHeader()?.config
  if (previous === undefined || previous.provider === GITHUB_COPILOT_PREVIEW_PROVIDER_ID && previous.model === model) {
    return undefined
  }
  const from = routeLabel(previous.provider, previous.model, GITHUB_COPILOT_PREVIEW_PROVIDER_ID)
  const to = routeLabel(GITHUB_COPILOT_PREVIEW_PROVIDER_ID, model, previous.provider)
  return createUserMessage({
    content: [{
      type: 'text',
      text: `[model changed: assistant turns above this point were generated by ${from}; the session continues with ${to}]`,
    }],
    source: {
      kind: 'model-selection',
      form: 'notice',
      summary: boundContextSummary(`${from} → ${to}`),
    },
  })
}

/** Resolve virtual Auto once per Core turn before request/header persistence. */
export function installAutoModelRouting(ctx: Context, dependencies: AutoModelHostDependencies): () => void {
  type Dispose = () => void
  const selections = new TurnSelectionStore()
  ctx.provide('githubCopilotTurnSelection', { get: (agent: Agent, turn: number) => selections.get(agent, turn) })
  const captured = new WeakMap<Agent, CapturedTurn>()
  const routed = new WeakMap<Agent, RoutedTurn>()
  const agentDisposers = new WeakMap<Agent, Dispose>()
  const activeDisposers = new Set<Dispose>()
  const followed = new WeakMap<Agent, { turn: number; selection: FollowSelection | undefined }>()
  const selectionSchema = z.object({ provider: z.string().min(1), model: z.string().min(1) }).strict()
  const followSchema = z.object({
    inherited: z.number().int().nonnegative(), turn: z.number().int().nonnegative().nullable(), started: z.boolean(),
    explicit: selectionSchema.nullable(), descriptor: z.boolean(), blocked: z.boolean(),
  }).strict()
  let removeFollowProjection: Dispose | undefined
  const followIntent = (agent: Agent): FollowSelection | undefined => {
    const previous = followed.get(agent)
    if (previous) {
      const registry: unknown = ctx.get('sessionProjections')
      if (!record(registry) || typeof registry.stateOf !== 'function') throw failure('COPILOT_PARENT_MODEL_PROJECTIONS_UNAVAILABLE')
      const state = followSchema.safeParse(registry.stateOf(agent.session, PARENT_MODEL_FOLLOW_PROJECTION))
      if (!state.success) throw failure('COPILOT_PARENT_MODEL_TURN_UNAVAILABLE')
      if (state.data.turn === previous.turn) return previous.selection
    }
    const bindings = dependencies.parentModelBindings?.() ?? []
    if (!bindings.some(binding => binding.childSessionId === agent.session.id)) return undefined
    const projections: unknown = ctx.get('sessionProjections')
    if (!record(projections) || typeof projections.register !== 'function' || typeof projections.stateOf !== 'function') {
      throw failure('COPILOT_PARENT_MODEL_PROJECTIONS_UNAVAILABLE')
    }
    const stateOf = projections.stateOf
    if (!removeFollowProjection) {
      const remove: unknown = projections.register({
        key: PARENT_MODEL_FOLLOW_PROJECTION, stateVersion: 1, stateSchema: followSchema,
        init: (_header: unknown, inherited = 0) => initialFollowState(inherited),
        apply: foldFollowState,
      })
      if (typeof remove !== 'function') throw failure('COPILOT_PARENT_MODEL_PROJECTIONS_UNAVAILABLE')
      removeFollowProjection = () => { remove() }
    }
    const readSubject = (value: unknown): FollowSubject | undefined => {
      if (!record(value) || !record(value.session)) return undefined
      const session = value.session
      if (typeof session.id !== 'string' || !record(session.header) || typeof session.requestHeader !== 'function') return undefined
      const parsed = followSchema.safeParse(Reflect.apply(stateOf, projections, [session, PARENT_MODEL_FOLLOW_PROJECTION]))
      const selection: unknown = Reflect.apply(stateOf, projections, [session, 'modelSelection'])
      if (!parsed.success || !record(selection) || !Object.hasOwn(selection, 'pending')) {
        throw failure('COPILOT_PARENT_MODEL_SELECTION_UNAVAILABLE')
      }
      const pending = selection.pending === null ? null : followSelection(selection.pending)
      if (pending === undefined) throw failure('COPILOT_PARENT_MODEL_SELECTION_UNAVAILABLE')
      const header: unknown = session.requestHeader()
      return {
        id: session.id,
        parentId: typeof session.header.parentSession === 'string' ? session.header.parentSession : undefined,
        origin: typeof session.header.origin === 'string' ? session.header.origin : undefined,
        state: parsed.data, pending, recorded: record(header) ? followSelection(header.config) : undefined,
      }
    }
    const child = readSubject(agent)
    if (!child || child.state.turn === null) throw failure('COPILOT_PARENT_MODEL_TURN_UNAVAILABLE')
    // Late enrollment/activation cannot retarget an already admitted turn.
    if (child.state.started) {
      followed.set(agent, { turn: child.state.turn, selection: undefined })
      return undefined
    }
    const agents: unknown = ctx.get('agents')
    try {
      const selection = resolveParentModel(child, bindings, id => {
        if (!record(agents) || typeof agents.get !== 'function') return undefined
        return readSubject(agents.get(id))
      })
      followed.set(agent, { turn: child.state.turn, selection })
      return selection
    } catch (cause) {
      if (cause instanceof ParentModelFollowError) throw failure(cause.code)
      throw cause
    }
  }
  const effectiveAuto = (agent: Agent): string | undefined => {
    const inherited = followIntent(agent)
    if (inherited !== undefined) return autoModelPreference(inherited.model) !== undefined ? inherited.model : undefined
    return pendingAuto(ctx, agent)
  }
  const installAgent = (agent: Agent): void => {
    if (agentDisposers.has(agent)) return
    const removeAssembly = agent.ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
      const inherited = followIntent(agent)
      const assembled = await next()
      if (inherited !== undefined) return { ...assembled, variables: {
        ...assembled.variables, provider: inherited.provider, model: inherited.model,
      } }
      const pending = pendingAuto(ctx, agent)
      if (pending === undefined) return assembled
      return { ...assembled, variables: {
        ...assembled.variables, provider: GITHUB_COPILOT_PREVIEW_PROVIDER_ID, model: pending,
      } }
    }, { prepend: true })
    const removePreStep = agent.ctx.on('agent/pre-step', async ({ messages, turn, signal }, next) => {
      const result = await next()
      const entered = result.kind === 'enter' ? result.messages : messages
      captured.set(agent, { turn, messages: entered })
      const pending = effectiveAuto(agent)
      const preference = pending === undefined ? undefined : autoModelPreference(pending)
      const inherited = followIntent(agent)
      if (result.kind === 'enter' && !signal.aborted && inherited !== undefined && preference === undefined) {
        const filtered = result.messages.filter(message => !modelSelectionNotice(message))
        const notice = actualNotice(agent, inherited.model)
        return { ...result, messages: notice === undefined ? filtered : [...filtered, notice] }
      }
      if (result.kind !== 'enter' || signal.aborted || preference === undefined) return result
      let state = routed.get(agent)
      if (state?.turn !== turn) {
        const routingContext = buildRoutingContext(ctx, agent, turn, entered, dependencies.budgetPolicy?.())
        state = {
          turn,
          decision: await decide(dependencies, signal, entered, preference, routingContext),
          recorded: false,
        }
        routed.set(agent, state)
      }
      const filtered = result.messages.filter(message => !modelSelectionNotice(message))
      const notice = actualNotice(agent, state.decision.model.id)
      return notice === undefined ? { ...result, messages: filtered }
        : { ...result, messages: [...filtered, notice] }
    }, { prepend: true })
    const dispose = () => { removeAssembly(); removePreStep() }
    agentDisposers.set(agent, dispose)
    activeDisposers.add(dispose)
  }
  const removeCreated = ctx.on('agent/created', ({ agent }) => {
    installAgent(agent)
    return undefined
  })
  const removeDisposed = ctx.on('agent/disposed', ({ agent }) => {
    const dispose = agentDisposers.get(agent)
    dispose?.()
    if (dispose !== undefined) activeDisposers.delete(dispose)
    agentDisposers.delete(agent)
    captured.delete(agent)
    routed.delete(agent)
    followed.delete(agent)
    selections.remove(agent)
    return undefined
  })
  const removeRequest = ctx.on('agent/request', async ({ agent, turn, signal }, next) => {
    installAgent(agent)
    const native = await next()
    const inherited = followIntent(agent)
    const { reasoningEffort: _nativeEffort, ...withoutEffort } = native
    const resolved = inherited === undefined ? native : { ...withoutEffort, ...inherited }
    const pending = effectiveAuto(agent)
    const virtualPreference = resolved.provider === GITHUB_COPILOT_PREVIEW_PROVIDER_ID
      ? autoModelPreference(resolved.model) : undefined
    const virtual = virtualPreference !== undefined
    if (!virtual && pending === undefined) {
      routed.delete(agent)
      const projections: unknown = ctx.get('sessionProjections')
      const selection: unknown = record(projections) && typeof projections.stateOf === 'function'
        ? projections.stateOf(agent.session, 'modelSelection') : undefined
      const fixed = record(selection) && record(selection.pending) && selection.pending.provider === resolved.provider
        && selection.pending.model === resolved.model
      if (!signal.aborted && (resolved.provider === GITHUB_COPILOT_PREVIEW_PROVIDER_ID || resolved.provider === 'github-copilot')) {
        selections.record(agent, turn, { mode: fixed ? 'manual' : 'unknown' })
      }
      return resolved
    }
    if (resolved.provider !== GITHUB_COPILOT_PREVIEW_PROVIDER_ID) {
      routed.delete(agent)
      return resolved
    }
    let state = routed.get(agent)
    if (state?.turn !== turn) {
      const input = captured.get(agent)
      if (input?.turn !== turn) throw failure('COPILOT_AUTO_TURN_CONTEXT_UNAVAILABLE')
      const preference = virtualPreference ?? (pending === undefined ? undefined : autoModelPreference(pending))
      if (preference === undefined) throw failure('COPILOT_AUTO_PREFERENCE_UNAVAILABLE')
      const routingContext = buildRoutingContext(ctx, agent, turn, input.messages, dependencies.budgetPolicy?.())
      state = { turn, decision: await decide(dependencies, signal, input.messages, preference, routingContext), recorded: false }
      routed.set(agent, state)
    }
    if (!state.recorded) {
      const projections: unknown = ctx.get('sessionProjections')
      if (inherited === undefined && virtual && record(projections) && typeof projections.stateOf === 'function') {
        const selection: unknown = projections.stateOf(agent.session, 'modelSelection')
        if (record(selection) && selection.pending === null && agent.session.requestHeader() === undefined) {
          Reflect.apply(agent.session.append, agent.session, ['model/selection', {
            provider: GITHUB_COPILOT_PREVIEW_PROVIDER_ID, model: resolved.model,
          }])
        }
      }
      // rc.2 append cannot mark plugin events ignorable; keep attribution out of the log.
      state.recorded = true
    }
    if (!signal.aborted) selections.record(agent, turn, {
      mode: 'auto', preference: state.decision.preference, reason: state.decision.reason,
      candidateCount: state.decision.candidateCount, fittingCandidateCount: state.decision.fittingCandidateCount,
    })
    return { ...resolved, model: state.decision.model.id }
  }, { prepend: true })
  return () => {
    removeCreated()
    removeDisposed()
    removeRequest()
    removeFollowProjection?.()
    for (const dispose of activeDisposers) dispose()
    activeDisposers.clear()
    selections.clear()
  }
}
