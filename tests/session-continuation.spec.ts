import { expect, it } from 'vitest'
import { SessionContinuationTurn } from '../src/session-continuation.ts'
import { SessionContinuationPreferencesSchema } from '../src/session-continuation-types.ts'
import { normalizeCopilotResponsesPayload, ResponsesRetryReplay } from '../src/responses-replay-compat.ts'

const reasoning = (account: string) => ({ type: 'reasoning', encrypted_content: `synthetic-${account}`, summary: [] })
const call = { type: 'function_call', call_id: 'paired', name: 'check', arguments: '{}' }
const result = { type: 'function_call_output', call_id: 'paired', output: 'synthetic' }
it('continues A-B-B-A by omitting pre-turn reasoning while retaining new tool-loop reasoning', () => {
  const history = [reasoning('A'), call, result]
  const original = JSON.stringify(history)
  for (const account of ['B1', 'B2', 'A2']) {
    const turn = new SessionContinuationTurn()
    const payload = { input: [...history], store: false }
    expect(turn.transform(payload)).toEqual({ ...payload, input: [call, result] })
    const fresh = reasoning(account)
    expect(turn.transform({ ...payload, input: [...history, fresh] })).toEqual({ ...payload, input: [call, result, fresh] })
    expect(turn.transform(payload)).toEqual({ ...payload, input: [call, result] })
    history.push(fresh)
  }
  expect(JSON.stringify(history.slice(0, 3))).toBe(original)
})
it('fails closed for partial reasoning and invalid persistent policy', () => {
  expect(() => new SessionContinuationTurn().transform({ input: [{ ...reasoning('A'), status: 'in_progress' }] }))
    .toThrow('UNSUPPORTED_REASONING')
  expect(SessionContinuationPreferencesSchema.safeParse([{ sessionId: 's', version: 2, consentedAt: 1 }]).success).toBe(false)
  const row = { sessionId: 's', version: 1, consentedAt: 1 }
  expect(SessionContinuationPreferencesSchema.safeParse([row, row]).success).toBe(false)
})
it('does not replay baseline ciphertext after its ID or embedded summary changes', () => {
  const filter = new SessionContinuationTurn()
  const original = { ...reasoning('A'), id: 'old', summary: [{ type: 'summary_text', text: 'prior' }] }
  expect(filter.transform({ input: [original] })).toEqual({ input: [] })
  const changed = { ...original, id: 'restored', summary: [{ type: 'summary_text', text: 'changed' }] }
  const fresh = reasoning('B')
  expect(filter.transform({ input: [changed, call, result, fresh] })).toEqual({ input: [call, result, fresh] })
  expect(original.summary[0]!.text).toBe('prior')
})
it('retains exact final filtered bytes for a native reference-only 408 retry', () => {
  const retry = new ResponsesRetryReplay(), filter = new SessionContinuationTurn()
  const signal = new AbortController().signal
  const raw = { input: [{ ...reasoning('A'), id: 'old' }, { ...call, id: 'fc_old' }, result] }
  const attempt = retry.begin('synthetic-context', signal, 's', 'm')
  const transformed = attempt.normalize(raw, payload => filter.transform(payload))
  attempt.observe(JSON.stringify(transformed), 408)
  attempt.finish()
  const next = retry.begin('synthetic-context', signal, 's', 'm')
  const references = { input: [{ type: 'item_reference', id: 'old' }, { type: 'item_reference', id: 'fc_old' }, result] }
  expect(() => normalizeCopilotResponsesPayload(references)).toThrow()
  expect(next.normalize(references, payload => filter.transform(payload))).toEqual(transformed)
  next.finish()
})
