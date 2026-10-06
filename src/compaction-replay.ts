import type { Context } from '@deepseek-ai/cordis'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { SessionContinuationTurn } from './session-continuation.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { githubCopilotCompactionReplay: CompactionReplayRecovery }
}

interface Authorization {
  readonly sessionId: SessionId
  readonly model: string
}

/** Explicit manual consent lasts only for the native summarizer hook's exact signal. */
export class CompactionReplayRecovery {
  private readonly operations = new Map<AbortSignal, Authorization>()
  private closed = false

  async run<T>(sessionId: SessionId, model: string, signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
    if (this.closed) throw new Error('COPILOT_COMPACTION_REPLAY_UNAVAILABLE')
    signal.throwIfAborted()
    if (this.operations.has(signal)) throw new Error('COPILOT_COMPACTION_REPLAY_OVERLAP')
    if (this.operations.size >= 64) throw new Error('COPILOT_COMPACTION_REPLAY_LIMIT')
    const authorization = { sessionId, model }
    this.operations.set(signal, authorization)
    try { return await operation() }
    finally { this.operations.delete(signal) }
  }

  prepare(request: GenerateOptions): ((payload: unknown) => Promise<unknown>) | undefined {
    if (request.provider !== 'github-copilot-preview' || request.purpose !== 'compaction' || !request.signal) return undefined
    const signal = request.signal
    const authorization = this.operations.get(signal)
    if (!authorization || request.sessionId !== authorization.sessionId || request.model !== authorization.model) return undefined
    const assertCurrent = () => {
      if (this.closed || signal.aborted || this.operations.get(signal) !== authorization)
        throw new Error('COPILOT_COMPACTION_REPLAY_REVOKED')
    }
    // Every segment contains historical input; new intermediate checkpoints are visible text.
    return payload => new SessionContinuationTurn().transform(payload, assertCurrent)
  }

  dispose(): void { this.closed = true; this.operations.clear() }
}

export function installCompactionReplay(ctx: Context): CompactionReplayRecovery {
  const recovery = new CompactionReplayRecovery()
  ctx.provide('githubCopilotCompactionReplay', recovery)
  ctx.effect(() => () => recovery.dispose())
  return recovery
}
