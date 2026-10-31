import { ToolCallId, createToolResultMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session'
import { describe, expect, it, vi } from 'vitest'
import { HydraFusionToolHandoff } from '../src/hydrafusion-tool-handoff.ts'

function fixture(turn = 1) {
  const abort = new AbortController()
  const scope = { sessionId: SessionId('synthetic-session'), turn, signal: abort.signal }
  const assertCurrent = vi.fn()
  const transport = {
    submitResult: vi.fn(async () => {}),
    requestStop: vi.fn(async () => {}),
    whenIdle: vi.fn(async () => {}),
  }
  const bridge = new HydraFusionToolHandoff(scope, assertCurrent, transport)
  const pending = { id: ToolCallId('synthetic-call'), name: 'synthetic_tool', arguments: '{}' }
  const call: Extract<SessionEvent, { type: 'tool/call' }> = {
    type: 'tool/call', seq: SessionSeq(2), time: 0,
    data: { turn, step: 1, callId: pending.id, name: pending.name, arguments: pending.arguments },
  }
  const result: Extract<SessionEvent, { type: 'tool/result' }> = {
    type: 'tool/result', seq: SessionSeq(3), time: 0, surfaceOp: 'append', sourceEventSeqs: [call.seq],
    data: {
      turn, step: 1,
      message: createToolResultMessage({
        callId: pending.id, isError: false, content: [{ type: 'text', text: 'synthetic result' }],
      }),
    },
  }
  const record = () => {
    bridge.project(scope, pending)
    bridge.record(scope, call)
    bridge.record(scope, result)
  }
  return { abort, scope, assertCurrent, transport, bridge, pending, call, result, record }
}

describe('Fusion native tool handoff (internal transport, no SDK)', () => {
  it.each([0, Number.MAX_SAFE_INTEGER])('accepts a nonnegative safe turn boundary (%s)', async turn => {
    const f = fixture(turn)
    f.record()
    expect(await f.bridge.flush(f.scope)).toEqual({ status: 'complete', pendingCalls: 0 })
    expect(f.transport.submitResult).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: f.scope.sessionId, turn }), f.scope.signal,
    )
    await f.bridge.stopAndDrain()
  })

  it.each([-1, 0.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid turn %s', turn => {
    expect(() => fixture(turn)).toThrow('FUSION_TOOL_SCOPE_INVALID')
  })

  it('projects an opaque pending call and submits only its paired native result once', async () => {
    const f = fixture()
    expect(f.bridge.project(f.scope, f.pending)).toEqual({ type: 'tool-call', ...f.pending })
    f.bridge.record(f.scope, f.call)
    await f.bridge.flush(f.scope)
    expect(f.transport.submitResult).not.toHaveBeenCalled()
    f.bridge.record(f.scope, f.result)
    const flushed = await Promise.all([f.bridge.flush(f.scope), f.bridge.flush(f.scope)])
    expect(flushed).toEqual([
      { status: 'complete', pendingCalls: 0 },
      { status: 'complete', pendingCalls: 0 },
    ])
    await f.bridge.flush(f.scope)
    expect(f.transport.submitResult).toHaveBeenCalledTimes(1)
    expect(f.transport.submitResult).toHaveBeenCalledWith({
      sessionId: f.scope.sessionId, turn: 1, callSeq: f.call.seq, resultSeq: f.result.seq,
      message: f.result.data.message,
    }, f.abort.signal)
    expect(f.bridge.snapshot()).toMatchObject({ lifecycle: 'active', acknowledged: 1 })
  })

  it('rescans when a result arrives after the first scan but before flight cleanup', async () => {
    const f = fixture()
    f.bridge.project(f.scope, f.pending)
    f.bridge.record(f.scope, f.call)
    const first = f.bridge.flush(f.scope)
    // Run the no-result scan, before its promise adoption and flight cleanup.
    await Promise.resolve()
    f.bridge.record(f.scope, f.result)
    const second = f.bridge.flush(f.scope)
    const [, latest] = await Promise.all([first, second])
    expect(f.transport.submitResult).toHaveBeenCalledTimes(1)
    expect(latest).toEqual({ status: 'complete', pendingCalls: 0 })
    expect(f.bridge.snapshot().acknowledged).toBe(1)
  })

  it.each(['projected', 'called'])('reports incomplete handoff for a %s call', async stage => {
    const f = fixture()
    f.bridge.project(f.scope, f.pending)
    if (stage === 'called') f.bridge.record(f.scope, f.call)
    expect(await f.bridge.flush(f.scope)).toEqual({ status: 'pending', pendingCalls: 1 })
    expect(f.transport.submitResult).not.toHaveBeenCalled()
    await f.bridge.stopAndDrain()
  })

  it('fences queued rescans when cancellation follows the no-result scan', async () => {
    const f = fixture()
    f.bridge.project(f.scope, f.pending)
    f.bridge.record(f.scope, f.call)
    const first = f.bridge.flush(f.scope)
    await Promise.resolve()
    f.bridge.record(f.scope, f.result)
    const second = f.bridge.flush(f.scope)
    f.abort.abort()
    const outcomes = await Promise.allSettled([first, second])
    expect(outcomes).toEqual([
      { status: 'rejected', reason: new Error('FUSION_TOOL_NOT_ACTIVE') },
      { status: 'rejected', reason: new Error('FUSION_TOOL_NOT_ACTIVE') },
    ])
    expect(f.transport.submitResult).not.toHaveBeenCalled()
    await f.bridge.stopAndDrain()
  })

  it('propagates an uncertain write to queued flush callers without retrying it', async () => {
    const f = fixture()
    f.record()
    const failure = new Error('synthetic-uncertain-write')
    f.transport.submitResult.mockRejectedValue(failure)
    const outcomes = await Promise.allSettled([f.bridge.flush(f.scope), f.bridge.flush(f.scope)])
    expect(outcomes).toEqual([
      { status: 'rejected', reason: failure },
      { status: 'rejected', reason: failure },
    ])
    expect(f.transport.submitResult).toHaveBeenCalledTimes(1)
    expect(f.bridge.snapshot()).toEqual({ lifecycle: 'blocked', acknowledged: 0 })
    await f.bridge.stopAndDrain()
  })

  it('rejects duplicate calls, result replay and wrong call/result pairing', () => {
    const f = fixture()
    f.bridge.project(f.scope, f.pending)
    expect(() => f.bridge.project(f.scope, f.pending)).toThrow('FUSION_TOOL_DUPLICATE')
    expect(() => f.bridge.record(f.scope, f.result)).toThrow('FUSION_TOOL_RESULT_MISMATCH')
    expect(() => f.bridge.record(f.scope, {
      ...f.call, data: { ...f.call.data, name: 'another_tool' },
    })).toThrow('FUSION_TOOL_CALL_MISMATCH')
    f.bridge.record(f.scope, f.call)
    expect(() => f.bridge.record(f.scope, {
      ...f.result, sourceEventSeqs: [SessionSeq(1)],
    })).toThrow('FUSION_TOOL_RESULT_MISMATCH')
    f.bridge.record(f.scope, f.result)
    expect(() => f.bridge.record(f.scope, f.result)).toThrow('FUSION_TOOL_EVENT_REPLAY')
  })

  it('rejects wrong session, turn, signal and revoked ownership before dispatch', async () => {
    const f = fixture()
    for (const scope of [
      { ...f.scope, sessionId: SessionId('another-session') },
      { ...f.scope, turn: 2 },
      { ...f.scope, signal: new AbortController().signal },
    ]) expect(() => f.bridge.project(scope, f.pending)).toThrow('FUSION_TOOL_SCOPE_MISMATCH')
    f.record()
    f.assertCurrent.mockImplementation(() => { throw new Error('synthetic-lease-revoked') })
    await expect(f.bridge.flush(f.scope)).rejects.toThrow('synthetic-lease-revoked')
    expect(f.transport.submitResult).not.toHaveBeenCalled()
  })

  it('does not retry an uncertain transport write', async () => {
    const f = fixture()
    f.record()
    f.transport.submitResult.mockRejectedValue(new Error('synthetic-write-failure'))
    await expect(f.bridge.flush(f.scope)).rejects.toThrow('synthetic-write-failure')
    await expect(f.bridge.flush(f.scope)).rejects.toThrow('FUSION_TOOL_NOT_ACTIVE')
    expect(f.transport.submitResult).toHaveBeenCalledTimes(1)
    expect(f.bridge.snapshot().lifecycle).toBe('blocked')
    await f.bridge.stopAndDrain()
  })

  it('rechecks ownership after the transport await without publishing a late acknowledgement', async () => {
    const f = fixture()
    f.record()
    f.transport.submitResult.mockImplementation(async () => {
      f.assertCurrent.mockImplementation(() => { throw new Error('synthetic-lease-revoked') })
    })
    await expect(f.bridge.flush(f.scope)).rejects.toThrow('synthetic-lease-revoked')
    expect(f.bridge.snapshot()).toEqual({ lifecycle: 'blocked', acknowledged: 0 })
    expect(f.transport.submitResult).toHaveBeenCalledTimes(1)
    await f.bridge.stopAndDrain()
  })

  it('submits a native batch in call order once even with concurrent flush consumers', async () => {
    const f = fixture()
    const second = { ...f.pending, id: ToolCallId('second-call') }
    f.bridge.project(f.scope, f.pending)
    f.bridge.project(f.scope, second)
    f.bridge.record(f.scope, f.call)
    f.bridge.record(f.scope, {
      ...f.call, seq: SessionSeq(3), data: { ...f.call.data, callId: second.id },
    })
    f.bridge.record(f.scope, { ...f.result, seq: SessionSeq(4) })
    f.bridge.record(f.scope, {
      ...f.result, seq: SessionSeq(5), sourceEventSeqs: [SessionSeq(3)],
      data: {
        ...f.result.data,
        message: createToolResultMessage({
          callId: second.id, isError: true, content: [{ type: 'text', text: 'synthetic native failure' }],
        }),
      },
    })
    await Promise.all([f.bridge.flush(f.scope), f.bridge.flush(f.scope)])
    expect(f.transport.submitResult).toHaveBeenCalledTimes(2)
    expect(f.transport.submitResult).toHaveBeenNthCalledWith(1, expect.objectContaining({
      message: expect.objectContaining({ toolCallId: f.pending.id, isError: false }),
    }), f.scope.signal)
    expect(f.transport.submitResult).toHaveBeenNthCalledWith(2, expect.objectContaining({
      message: expect.objectContaining({ toolCallId: second.id, isError: true }),
    }), f.scope.signal)
  })

  it('bounds retained call identities and refuses new calls after drain', async () => {
    const f = fixture()
    for (let index = 0; index < 128; index++) {
      f.bridge.project(f.scope, { ...f.pending, id: ToolCallId(`synthetic-${index}`) })
    }
    expect(() => f.bridge.project(f.scope, f.pending)).toThrow('FUSION_TOOL_CALL_LIMIT')
    await f.bridge.stopAndDrain()
    expect(() => f.bridge.project(f.scope, f.pending)).toThrow('FUSION_TOOL_NOT_ACTIVE')
    expect(f.transport.submitResult).not.toHaveBeenCalled()
  })

  it('fences a late write and waits for both root idle and the outstanding write', async () => {
    const f = fixture()
    const writing = Promise.withResolvers<void>()
    const entered = Promise.withResolvers<void>()
    const idle = Promise.withResolvers<void>()
    f.transport.submitResult.mockImplementation(async () => { entered.resolve(); await writing.promise })
    f.transport.whenIdle.mockImplementation(() => idle.promise)
    f.record()
    const flush = f.bridge.flush(f.scope)
    const rejected = expect(flush).rejects.toThrow('FUSION_TOOL_NOT_ACTIVE')
    await entered.promise
    f.abort.abort()
    const drain = f.bridge.stopAndDrain()
    let drained = false
    void drain.then(() => { drained = true })
    idle.resolve()
    await Promise.resolve()
    expect(drained).toBe(false)
    expect(f.bridge.snapshot().lifecycle).toBe('stopping')
    expect(() => f.bridge.project(f.scope, { ...f.pending, id: ToolCallId('late-call') }))
      .toThrow('FUSION_TOOL_NOT_ACTIVE')
    writing.resolve()
    await rejected
    await drain
    expect(f.bridge.snapshot()).toEqual({ lifecycle: 'idle', acknowledged: 0 })
    expect(f.transport.requestStop).toHaveBeenCalledTimes(1)
  })

  it('does not equate stop acknowledgement or failed drain with idle', async () => {
    const f = fixture()
    const idle = Promise.withResolvers<void>()
    f.transport.whenIdle.mockImplementation(() => idle.promise)
    const drain = f.bridge.stopAndDrain()
    const rejected = expect(drain).rejects.toThrow('FUSION_TOOL_DRAIN_FAILED')
    await Promise.resolve()
    expect(f.bridge.snapshot().lifecycle).toBe('stopping')
    idle.reject(new Error('synthetic-idle-failure'))
    await rejected
    expect(f.bridge.snapshot().lifecycle).toBe('blocked')
    expect(f.bridge.stopAndDrain()).toBe(drain)
  })
})
