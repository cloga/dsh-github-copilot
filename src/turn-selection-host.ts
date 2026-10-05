import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { TurnSelection, TurnSelectionStore } from './turn-selection.ts'
import { TURN_REQUEST_MODELS, installTurnRequestModels, TurnRequestModelsStateSchema } from './turn-request-models.ts'
import type { RequestedModels } from './turn-request-models.ts'

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Public Host binding for the existing bounded, runtime-only decision store. */
export class TurnSelectionController extends TypertRemoteService {
  constructor(ctx: Context, private readonly selections: TurnSelectionStore) {
    super(ctx, 'githubCopilotTurnSelection')
    installTurnRequestModels(ctx)
  }

  @Remote
  get(agent: Agent, turn: number): TurnSelection {
    return this.selections.get(agent, turn)
  }

  @Remote
  allocationSummary(agent: Agent) {
    return this.selections.allocationSummary(agent)
  }

  @Remote
  requestedModels(agent: Agent, turn: number): RequestedModels {
    if (!Number.isSafeInteger(turn) || turn < 0) throw new Error('COPILOT_TURN_SELECTION_INVALID_TURN')
    const registry: unknown = this.ctx.get('sessionProjections')
    if (!record(registry) || typeof registry.stateOf !== 'function') throw new Error('COPILOT_TURN_REQUEST_PROJECTION_UNAVAILABLE')
    const state = TurnRequestModelsStateSchema.parse(registry.stateOf(agent.session, TURN_REQUEST_MODELS))
    const row = state.turns.find(value => value.turn === turn)
    return row ? { routes: row.routes, incomplete: row.incomplete } : { routes: [], incomplete: true }
  }
}
