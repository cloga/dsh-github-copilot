import { describe, expect, it } from 'vitest'
import { CopilotResponsesReplayError, normalizeCopilotResponsesPayload } from '../src/responses-replay-compat.ts'

function rejected(payload: unknown): CopilotResponsesReplayError {
  try { normalizeCopilotResponsesPayload(payload) } catch (error) {
    if (error instanceof CopilotResponsesReplayError) return error
    throw error
  }
  throw new Error('Expected replay rejection')
}

describe('safe Responses replay failure diagnostics', () => {
  it.each([
    [{ type: 'item_reference', id: 'secret-id' }, 'ITEM_REFERENCE_ONLY'],
    [{ type: 'reasoning', id: 'secret-id', summary: [{ type: 'summary_text', text: 'secret-summary' }] }, 'REASONING_WITHOUT_ENCRYPTED_CONTENT'],
    [{ type: 'reasoning', id: 'secret-id', encrypted_content: 'secret-opaque', status: 'in_progress' }, 'INCOMPLETE_ITEM'],
    [{ type: 'message', role: 'assistant', id: 'secret-id' }, 'INCOMPLETE_ASSISTANT_MESSAGE'],
    [{ type: 'function_call', id: 'secret-id', name: 'secret-tool', arguments: 'secret-args' }, 'INCOMPLETE_FUNCTION_CALL'],
    [{ type: 'secret-future-type', id: 'secret-id', status: 'secret-status' }, 'UNKNOWN_ID_BEARING_ITEM'],
    [{ type: 'function_call_output', id: 'secret-id', call_id: 'secret-call', output: 'secret-output' }, 'UNSUPPORTED_ID_BEARING_ITEM'],
  ] as const)('categorizes only structural facts: %s', (item, reason) => {
    const before = JSON.stringify(item)
    const error = rejected({ input: [{ role: 'user', content: 'secret-user' }, item] })
    expect(error.diagnostic).toMatchObject({ reason, inputIndex: 1, hasId: true })
    expect(error.message).toContain(reason)
    expect(error.message).toContain('inputIndex=1')
    expect(JSON.stringify(error.diagnostic)).not.toContain('secret')
    expect(error.message).not.toContain('secret')
    expect(Object.isFrozen(error.diagnostic)).toBe(true)
    expect(JSON.stringify(item)).toBe(before)
  })

  it('whitelists unknown type and status instead of echoing arbitrary strings', () => {
    const error = rejected({ input: [{ type: 'secret-type', status: 'secret-status', id: 'secret-id' }] })
    expect(error.diagnostic).toMatchObject({ itemType: 'unknown', itemStatus: 'unknown' })
    expect(Object.values(error.diagnostic ?? {})).not.toContain('secret-type')
    expect(Object.values(error.diagnostic ?? {})).not.toContain('secret-status')
  })

  it('describes missing replay fields without recording their values', () => {
    const error = rejected({ input: [{ type: 'reasoning', id: 'secret-id', summary: ['secret'], encrypted_content: '' }] })
    expect(error.diagnostic).toEqual({
      reason: 'REASONING_WITHOUT_ENCRYPTED_CONTENT', inputIndex: 0,
      itemType: 'reasoning', itemStatus: 'absent', hasId: true, hasContent: false,
      hasCallId: false, hasName: false, hasArguments: false, hasEncryptedContent: false,
    })
  })

  it('identifies previous response dependency without exposing the response ID', () => {
    const error = rejected({ input: [], previous_response_id: 'secret-response-id' })
    expect(error.diagnostic).toEqual({ reason: 'PREVIOUS_RESPONSE_REFERENCE' })
    expect(error.message).toContain('PREVIOUS_RESPONSE_REFERENCE')
    expect(error.message).not.toContain('secret')
  })

  it('never serializes thrown property-access content into diagnostics', () => {
    const error = rejected({ input: [{ get id() { throw new Error('secret-accessor') }, type: 'reasoning' }] })
    expect(error.message).not.toContain('secret')
    expect(JSON.stringify(error.diagnostic ?? null)).not.toContain('secret')
  })

  it('snapshots accessor values before allowlisting so changing getters cannot leak content', () => {
    let typeReads = 0
    const item = { get type() { return ++typeReads <= 6 ? 'item_reference' : 'secret-changing-type' }, id: 'secret-id' }
    const error = rejected({ input: [item] })
    expect(error.message).not.toContain('secret')
    expect(JSON.stringify(error.diagnostic)).not.toContain('secret')
    let statusReads = 0
    const reasoning = { type: 'reasoning', id: 'secret-id',
      get status() { return ++statusReads <= 3 ? 'completed' : 'secret-changing-status' } }
    const statusError = rejected({ input: [reasoning] })
    expect(statusError.message).not.toContain('secret')
    expect(JSON.stringify(statusError.diagnostic)).not.toContain('secret')
  })

  it('does not trust overridden entries indices and keeps an owned numeric input position', () => {
    const input = [{ type: 'item_reference', id: 'secret-id' }]
    Object.defineProperty(input, 'entries', { value: function* () { yield ['secret-index', input[0]] } })
    const error = rejected({ input })
    expect(error.diagnostic?.inputIndex).toBe(0)
    expect(error.message).not.toContain('secret')
  })

  it('retains safe field facts through the native message-only error projection', () => {
    const error = rejected({ input: [{ type: 'function_call', id: 'secret-id', name: 'secret-name', arguments: '{}' }] })
    const messageOnly = new Error(error.message)
    expect(messageOnly.message).toContain('hasId=true')
    expect(messageOnly.message).toContain('hasContent=false')
    expect(messageOnly.message).toContain('hasCallId=false')
    expect(messageOnly.message).toContain('hasName=true')
    expect(messageOnly.message).toContain('hasArguments=true')
    expect(messageOnly.message).toContain('hasEncryptedContent=false')
    expect(messageOnly.message).not.toContain('secret')
  })

  it('preserves existing diagnostics for errors constructed without payload context', () => {
    expect(new CopilotResponsesReplayError().diagnostic).toBeUndefined()
    expect(new CopilotResponsesReplayError().message).toBe('COPILOT_RESPONSES_REPLAY_UNSUPPORTED: Copilot Responses input cannot be replayed safely without connection-scoped references.')
  })
})
