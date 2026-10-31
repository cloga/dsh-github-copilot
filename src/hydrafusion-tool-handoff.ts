import { freezeMessage } from '@deepseek-ai/dsh-llm'
import type { ToolCallBlock, ToolCallId, ToolResultMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent, SessionId, SessionSeq } from '@deepseek-ai/dsh-session'

export interface HydraFusionNativeTurn {
  readonly sessionId: SessionId
  readonly turn: number
  readonly signal: AbortSignal
}

export interface HydraFusionNativeToolReply {
  readonly sessionId: SessionId
  readonly turn: number
  readonly callSeq: SessionSeq
  readonly resultSeq: SessionSeq
  readonly message: ToolResultMessage
}

export interface HydraFusionToolFlushResult {
  readonly status: 'complete' | 'pending'
  readonly pendingCalls: number
}

/**
 * Plugin-internal transport contract, NOT an SDK RPC or handler signature.
 * A submission acknowledges only that write; requestStop is not root idle.
 */
export interface HydraFusionToolTransport {
  submitResult(reply: HydraFusionNativeToolReply, signal: AbortSignal): Promise<void>
  requestStop(): Promise<void>
  whenIdle(): Promise<void>
}

interface PendingCall {
  block?: ToolCallBlock
  callSeq?: SessionSeq
  step?: number
  reply?: HydraFusionNativeToolReply
  stage: 'projected' | 'called' | 'ready' | 'sending' | 'acknowledged'
}

type Lifecycle = 'active' | 'stopping' | 'idle' | 'blocked'
type NativeToolEvent = SessionEvent<'tool/call' | 'tool/result'>
const MAX_CALLS = 128

/**
 * Passive, unregistered native-side prototype. It never executes tools or
 * writes history/Usage. Only the native driver may execute projected blocks.
 * Callers supply live native events, not reconstructed history, and a lease
 * check that fences the captured account/turn after every asynchronous write.
 *
 * The owner must await flush and reject a pending result at a native
 * step/stopping boundary, and explicitly await stopAndDrain on cancellation,
 * failure and teardown. Completion here covers only recorded tool handoff,
 * not external runtime idle. No live route uses this class.
 */
export class HydraFusionToolHandoff {
  private readonly scope: HydraFusionNativeTurn
  private readonly calls = new Map<ToolCallId, PendingCall>()
  private lifecycle: Lifecycle = 'active'
  private lastSeq = -1
  private acknowledged = 0
  private flushing: Promise<void> | undefined
  private stopping: Promise<void> | undefined

  constructor(
    scope: HydraFusionNativeTurn,
    private readonly assertCurrent: () => void,
    private readonly transport: HydraFusionToolTransport,
  ) {
    if (!scope.sessionId || !Number.isSafeInteger(scope.turn) || scope.turn < 0 || scope.signal.aborted) {
      throw new Error('FUSION_TOOL_SCOPE_INVALID')
    }
    this.scope = Object.freeze({ ...scope })
    assertCurrent()
  }

  project(scope: HydraFusionNativeTurn, pending: Omit<ToolCallBlock, 'type'>): ToolCallBlock {
    this.assertLive(scope)
    if (typeof pending.id !== 'string' || !pending.id || typeof pending.name !== 'string'
      || !pending.name || typeof pending.arguments !== 'string') {
      throw new Error('FUSION_TOOL_CALL_INVALID')
    }
    if (this.calls.has(pending.id)) throw new Error('FUSION_TOOL_DUPLICATE')
    if (this.calls.size >= MAX_CALLS) throw new Error('FUSION_TOOL_CALL_LIMIT')
    const block: ToolCallBlock = Object.freeze({
      type: 'tool-call', id: pending.id, name: pending.name, arguments: pending.arguments,
    })
    this.calls.set(block.id, { block, stage: 'projected' })
    return block
  }

  record(scope: HydraFusionNativeTurn, event: NativeToolEvent): void {
    this.assertLive(scope)
    if (event.data.turn !== this.scope.turn) throw new Error('FUSION_TOOL_SCOPE_MISMATCH')
    if (event.seq <= this.lastSeq) throw new Error('FUSION_TOOL_EVENT_REPLAY')
    if (event.type === 'tool/call') {
      const call = this.calls.get(event.data.callId)
      if (!call || call.stage !== 'projected' || !call.block || call.block.name !== event.data.name
        || call.block.arguments !== event.data.arguments) throw new Error('FUSION_TOOL_CALL_MISMATCH')
      call.callSeq = event.seq
      call.step = event.data.step
      call.block = undefined
      call.stage = 'called'
    } else {
      const message = event.data.message
      const call = this.calls.get(message.toolCallId)
      if (!call || call.stage !== 'called' || call.callSeq === undefined
        || call.step !== event.data.step || message.source.callId !== message.toolCallId
        || event.surfaceOp !== 'append' || event.sourceEventSeqs?.length !== 1
        || event.sourceEventSeqs[0] !== call.callSeq) throw new Error('FUSION_TOOL_RESULT_MISMATCH')
      call.reply = Object.freeze({
        sessionId: this.scope.sessionId, turn: this.scope.turn,
        callSeq: call.callSeq, resultSeq: event.seq, message: freezeMessage(message),
      })
      call.stage = 'ready'
    }
    this.lastSeq = event.seq
  }

  async flush(scope: HydraFusionNativeTurn): Promise<HydraFusionToolFlushResult> {
    this.assertLive(scope)
    // Joining an old scan is insufficient: new results may arrive after it
    // returns but before its flight is cleared. Each caller must rescan.
    while (this.flushing) {
      await this.flushing
      this.assertLive(scope)
    }
    const flight = Promise.resolve().then(() => this.sendResults(scope))
    this.flushing = flight
    try {
      await flight
      this.assertLive(scope)
      const pendingCalls = this.calls.size - this.acknowledged
      return { status: pendingCalls === 0 ? 'complete' : 'pending', pendingCalls }
    } finally {
      if (this.flushing === flight) this.flushing = undefined
    }
  }

  stopAndDrain(): Promise<void> {
    if (this.stopping) return this.stopping
    this.lifecycle = 'stopping'
    const writing = this.flushing
    this.stopping = (async () => {
      const request = Promise.resolve().then(() => this.transport.requestStop())
      const quiescence = request.then(
        () => this.transport.whenIdle(),
        () => this.transport.whenIdle(),
      )
      const [stop, idle] = await Promise.allSettled([
        request,
        quiescence,
        // A failed write still belongs to its flush caller; drain waits for its
        // settlement without turning an uncertain write into an acknowledged one.
        writing,
      ])
      this.calls.clear()
      const failures = [stop, idle].flatMap(result => result.status === 'rejected' ? [result.reason] : [])
      if (failures.length > 0) {
        this.lifecycle = 'blocked'
        throw new AggregateError(failures, 'FUSION_TOOL_DRAIN_FAILED')
      }
      this.lifecycle = 'idle'
    })()
    return this.stopping
  }

  snapshot(): { readonly lifecycle: Lifecycle; readonly acknowledged: number } {
    return {
      lifecycle: this.lifecycle === 'active' && this.scope.signal.aborted ? 'stopping' : this.lifecycle,
      acknowledged: this.acknowledged,
    }
  }

  private assertLive(scope: HydraFusionNativeTurn): void {
    if (this.lifecycle !== 'active' || this.scope.signal.aborted) throw new Error('FUSION_TOOL_NOT_ACTIVE')
    if (scope.sessionId !== this.scope.sessionId || scope.turn !== this.scope.turn
      || scope.signal !== this.scope.signal) throw new Error('FUSION_TOOL_SCOPE_MISMATCH')
    this.assertCurrent()
  }

  private async sendResults(scope: HydraFusionNativeTurn): Promise<void> {
    try {
      for (const call of this.calls.values()) {
        if (call.stage === 'acknowledged') continue
        if (call.stage !== 'ready' || call.reply === undefined) return
        this.assertLive(scope)
        call.stage = 'sending'
        await this.transport.submitResult(call.reply, this.scope.signal)
        this.assertLive(scope)
        call.reply = undefined
        call.stage = 'acknowledged'
        this.acknowledged++
      }
    } catch (error) {
      if (this.lifecycle === 'active') this.lifecycle = 'blocked'
      throw error
    }
  }
}
