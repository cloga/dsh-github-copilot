import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-compaction'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { SessionContinuationTurn } from './session-continuation.ts'
import { COMPACTION_CONTINUATION, CompactionContinuationLifecycleSchema } from './session-continuation-types.ts'
import type { CompactionContinuationStatus, CompactionContinuationLifecycle } from './session-continuation-types.ts'

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap { githubCopilotCompactionLifecycle: CompactionContinuationLifecycle }
  interface SessionProjectionStateMap { githubCopilotCompactionLifecycle: CompactionContinuationLifecycle }
}
type Definition = Omit<ProjectionDefinition<typeof COMPACTION_CONTINUATION>, 'stateSchema' | 'wire'> & {
  stateSchema: typeof CompactionContinuationLifecycleSchema
  wire: Omit<NonNullable<ProjectionDefinition<typeof COMPACTION_CONTINUATION>['wire']>, 'viewSchema'> & {
    viewSchema: typeof CompactionContinuationLifecycleSchema
  }
}
export const compactionContinuationDefinition = {
  key: COMPACTION_CONTINUATION, stateVersion: 1, stateSchema: CompactionContinuationLifecycleSchema,
  init: (): CompactionContinuationLifecycle => ({ id: null, running: false }),
  apply(state, event) {
    if (event.type === 'compaction/start') return { id: event.data.compactionId, running: true }
    if (event.type === 'compaction/end' && event.data.compactionId === state.id) return { ...state, running: false }
    return state
  },
  wire: { viewSchema: CompactionContinuationLifecycleSchema, view: (state: CompactionContinuationLifecycle) => state },
} satisfies Definition
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
interface Operation {
  readonly session: Agent['session']
  readonly id: string
  enabled?: boolean
  model?: string
  signal?: AbortSignal
  replaced: boolean
}
/** Native brackets authorize scope, never loss; the existing Session policy authorizes loss. */
export function installCompactionContinuation(ctx: Context, enabled: (agent: Agent) => boolean) {
  const operations = new Map<string, Operation>()
  const statuses = new Map<string, CompactionContinuationStatus>()
  let disposed = false
  const removeProjection = ctx.inject(['sessionProjections'], scope => {
    const registry: unknown = scope.get('sessionProjections')
    if (!record(registry) || typeof registry.register !== 'function') throw new Error('COPILOT_CONTINUATION_COMPACTION_PROJECTION_UNAVAILABLE')
    const remove: unknown = registry.register(compactionContinuationDefinition)
    if (typeof remove !== 'function') throw new Error('COPILOT_CONTINUATION_COMPACTION_PROJECTION_DISPOSER_UNAVAILABLE')
    return () => { remove() }
  })
  const removeEvents = ctx.on('session/event', (session, event) => {
    if (event.type === 'compaction/start') {
      if (operations.size >= 64 || operations.has(session.id)) {
        ctx.logger.warn('COPILOT_CONTINUATION_COMPACTION_LIMIT')
        return
      }
      operations.set(session.id, { session, id: event.data.compactionId, replaced: false })
      statuses.delete(session.id)
    }
    const operation = operations.get(session.id)
    if (!operation || operation.session !== session) return
    if (event.type === 'user/message' && event.data.source.kind === 'compact-checkpoint'
      && event.data.source.compactionId === operation.id) operation.replaced = true
    if (event.type !== 'compaction/end' || event.data.compactionId !== operation.id) return
    if (operation.enabled) statuses.set(session.id, { id: operation.id,
      state: event.data.error === undefined && operation.replaced ? 'completed' : operation.signal?.aborted ? 'cancelled' : 'failed' })
    else if (operation.enabled === false && typeof event.data.error === 'string'
      && /(?:^|[^A-Z_])COPILOT_RESPONSES_REPLAY_SCOPE_MISMATCH(?:$|[^A-Z_])/.test(event.data.error)) {
      statuses.set(session.id, { id: operation.id, state: 'blocked' })
    }
    operations.delete(session.id)
    while (statuses.size > 128) statuses.delete(statuses.keys().next().value!)
  })
  const removeAgent = ctx.on('agent/disposed', ({ agent }) => {
    operations.delete(agent.session.id); statuses.delete(agent.session.id)
  })
  return {
    status(agent: Agent) {
      const operation = operations.get(agent.session.id)
      return operation?.enabled ? { id: operation.id, state: 'running' as const } : statuses.get(agent.session.id)
    },
    prepare(request: GenerateOptions): ((payload: unknown) => Promise<unknown>) | undefined {
      if (request.provider !== 'github-copilot-preview' || request.purpose !== 'compaction') return undefined
      if (!request.sessionId || !request.signal) throw new Error('COPILOT_CONTINUATION_COMPACTION_SCOPE_UNAVAILABLE')
      const operation = operations.get(request.sessionId)
      if (!operation) throw new Error('COPILOT_CONTINUATION_COMPACTION_BOUNDARY_UNAVAILABLE')
      const agent = ctx.get('agents')?.get(request.sessionId)
      if (!agent || agent.session !== operation.session) throw new Error('COPILOT_CONTINUATION_COMPACTION_AGENT_UNAVAILABLE')
      const initiator = ctx.get('agents')?.currentInitiator()
      if (initiator && initiator !== agent) throw new Error('COPILOT_CONTINUATION_COMPACTION_SCOPE_MISMATCH')
      operation.enabled ??= enabled(agent)
      if (!operation.enabled) return undefined
      if (operation.model !== undefined && operation.model !== request.model)
        throw new Error('COPILOT_CONTINUATION_COMPACTION_MODEL_CHANGED')
      operation.model = request.model
      operation.signal = request.signal
      const assertCurrent = () => {
        if (disposed || request.signal!.aborted || operation.signal !== request.signal
          || operations.get(request.sessionId!) !== operation)
          throw new Error('COPILOT_CONTINUATION_REVOKED')
      }
      // Each native segment's reasoning is historical; checkpoints are visible text.
      return payload => new SessionContinuationTurn().transform(payload, assertCurrent)
    },
    dispose() { disposed = true; removeEvents(); removeAgent(); void removeProjection.dispose(); operations.clear(); statuses.clear() },
  }
}
