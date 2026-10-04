import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { TurnSelection, TurnSelectionStore } from './turn-selection.ts'

/** Public Host binding for the existing bounded, runtime-only decision store. */
export class TurnSelectionController extends TypertRemoteService {
  constructor(ctx: Context, private readonly selections: TurnSelectionStore) {
    super(ctx, 'githubCopilotTurnSelection')
  }

  @Remote
  get(agent: Agent, turn: number): TurnSelection {
    return this.selections.get(agent, turn)
  }
}
