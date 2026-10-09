import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { ReplayRecoveryStore } from './replay-recovery.ts'
import type { ReplayRecoveryDuration, ReplayRecoveryView } from './replay-recovery-types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    githubCopilotReplayRecovery: ReplayRecoveryController
  }
}

export class ReplayRecoveryController extends TypertRemoteService {
  constructor(ctx: Context, private readonly store: ReplayRecoveryStore,
    private readonly proof: (agent?: Agent, request?: GenerateOptions) => string | undefined, private readonly busy: WeakSet<object>) {
    super(ctx, 'githubCopilotReplayRecovery')
  }
  @Remote
  get(agent: Agent): ReplayRecoveryView { return this.store.view(agent.session, this.proof(agent)) }
  @Remote
  setEnabled(agent: Agent, revision: string, enabled: boolean): ReplayRecoveryView {
    if (this.busy.has(agent.session)) throw new Error('COPILOT_REPLAY_RECOVERY_TURN_ACTIVE')
    return this.store.setEnabled(agent.session, this.proof(agent), revision, enabled)
  }
  @Remote
  authorize(agent: Agent, revision: string, duration: ReplayRecoveryDuration): ReplayRecoveryView {
    if (this.busy.has(agent.session)) throw new Error('COPILOT_REPLAY_RECOVERY_TURN_ACTIVE')
    return this.store.authorize(agent.session, this.proof(agent), revision, duration)
  }
}

export function installReplayRecovery(ctx: Context, proof: (agent?: Agent, request?: GenerateOptions) => string | undefined): {
  prepare(request: GenerateOptions): { transform(payload: unknown): unknown; rejected(body: string | undefined): void } | undefined
  dispose(): void
} {
  const store = new ReplayRecoveryStore()
  const requests = new WeakMap<AbortSignal, { session: Agent['session']; turn: number }>()
  const currentRequests = new WeakMap<object, AbortSignal>()
  const busy = new WeakSet<object>()
  new ReplayRecoveryController(ctx, store, proof, busy)
  const removeRequest = ctx.on('agent/request', async ({ agent, turn, signal }, next) => {
    const result = await next()
    if (!signal.aborted) {
      requests.set(signal, { session: agent.session, turn })
      currentRequests.set(agent.session, signal)
      busy.add(agent.session)
    }
    return result
  })
  const removeEvents = ctx.on('session/event', (session, event) => {
    if (event.type === 'turn/end') {
      store.endTurn(session, event.data.turn)
      busy.delete(session); currentRequests.delete(session)
    }
  })
  const removeAgent = ctx.on('agent/disposed', ({ agent }) => {
    store.remove(agent.session); busy.delete(agent.session); currentRequests.delete(agent.session)
  })
  let active = true
  return {
    prepare(request) {
      if (!active || request.signal === undefined || request.signal.aborted || request.purpose !== undefined
        || request.provider !== 'github-copilot-preview') return undefined
      const binding = requests.get(request.signal)
      const currentProof = proof(undefined, request)
      if (!binding || binding.session.id !== request.sessionId || !busy.has(binding.session) || currentProof === undefined
        || currentRequests.get(binding.session) !== request.signal) return undefined
      const transform = store.prepare(binding.session, currentProof, request.model, binding.turn)
      const current = () => active && !request.signal?.aborted && proof(undefined, request) === currentProof
        && currentRequests.get(binding.session) === request.signal && busy.has(binding.session)
      return {
        transform(payload) {
          if (!current()) throw new Error('COPILOT_REPLAY_RECOVERY_REVOKED')
          return transform(payload)
        },
        rejected(body) {
          if (!current()) return
          try { store.recordFailure(binding.session, currentProof, request.model, body) }
          catch { ctx.logger.warn('[github-copilot] COPILOT_REPLAY_RECOVERY_EVIDENCE_UNAVAILABLE') }
        },
      }
    },
    dispose() { active = false; removeRequest(); removeEvents(); removeAgent(); store.clear() },
  }
}
