import { expect, it } from 'vitest'
import { SESSION_CONTINUATION_LIMITS, SessionContinuationTurn } from '../src/session-continuation.ts'
import { SessionContinuationPreferencesSchema } from '../src/session-continuation-types.ts'
import { normalizeCopilotResponsesPayload, ResponsesRetryReplay } from '../src/responses-replay-compat.ts'

const reasoning = (account: string) => ({ type: 'reasoning', encrypted_content: `synthetic-${account}`, summary: [] })
const call = { type: 'function_call', call_id: 'paired', name: 'check', arguments: '{}' }
const result = { type: 'function_call_output', call_id: 'paired', output: 'synthetic' }
it('does not traverse or serialize ordinary contents when a request exceeds 16 MiB', async () => {
  const filter = new SessionContinuationTurn()
  const output = { ...result, output: 'x'.repeat(17 * 1024 * 1024) }
  const image = { type: 'message', content: [{ type: 'input_image', image_url: 'synthetic' }] }
  const tools = { toJSON() { throw new Error('must not serialize tools') } }
  const payload = { input: [reasoning('old'), call, output, image], tools }
  const transformed = await filter.transform(payload)
  expect(transformed).toEqual({ ...payload, input: [call, output, image] })
  expect((transformed as typeof payload).input[1]).toBe(output)
  expect((transformed as typeof payload).input[2]).toBe(image)
  expect((transformed as typeof payload).tools).toBe(tools)
})
it('omits large historical ciphertext without a whole-request byte cap', async () => {
  const filter = new SessionContinuationTurn()
  const old = { ...reasoning('old'), encrypted_content: 'x'.repeat(17 * 1024 * 1024) }
  expect(await filter.transform({ input: [old, call, result] })).toEqual({ input: [call, result] })
  const fresh = reasoning('new')
  expect(await filter.transform({ input: [old, fresh] })).toEqual({ input: [fresh] })
})
it('does not inspect nested ordinary input fields', async () => {
  const nested = Object.defineProperty({}, 'body', { enumerable: true, get() { throw new Error('must not traverse') } })
  const output = { ...result, output: nested }
  const payload = { input: [output] }
  expect(await new SessionContinuationTurn().transform(payload)).toBe(payload)
})
it('continues A-B-B-A by omitting pre-turn reasoning while retaining new tool-loop reasoning', async () => {
  const history = [reasoning('A'), call, result]
  const original = JSON.stringify(history)
  for (const account of ['B1', 'B2', 'A2']) {
    const turn = new SessionContinuationTurn()
    const payload = { input: [...history], store: false }
    expect(await turn.transform(payload)).toEqual({ ...payload, input: [call, result] })
    const fresh = reasoning(account)
    expect(await turn.transform({ ...payload, input: [...history, fresh] })).toEqual({ ...payload, input: [call, result, fresh] })
    expect(await turn.transform(payload)).toEqual({ ...payload, input: [call, result] })
    history.push(fresh)
  }
  expect(JSON.stringify(history.slice(0, 3))).toBe(original)
})
it('fails closed for partial reasoning and invalid persistent policy', async () => {
  const filter = new SessionContinuationTurn()
  await expect(filter.transform({ input: [reasoning('old'), { ...reasoning('A'), status: 'in_progress' }] }))
    .rejects.toThrow('UNSUPPORTED_REASONING')
  expect(filter.initialized).toBe(false)
  expect(SessionContinuationPreferencesSchema.safeParse([{ sessionId: 's', version: 2, consentedAt: 1 }]).success).toBe(false)
  const row = { sessionId: 's', version: 1, consentedAt: 1 }
  expect(SessionContinuationPreferencesSchema.safeParse([row, row]).success).toBe(false)
})
it('does not replay baseline ciphertext after its ID or embedded summary changes', async () => {
  const filter = new SessionContinuationTurn()
  const original = { ...reasoning('A'), id: 'old', summary: [{ type: 'summary_text', text: 'prior' }] }
  expect(await filter.transform({ input: [original] })).toEqual({ input: [] })
  const changed = { ...original, id: 'restored', summary: [{ type: 'summary_text', text: 'changed' }] }
  const fresh = reasoning('B')
  expect(await filter.transform({ input: [changed, call, result, fresh] })).toEqual({ input: [call, result, fresh] })
  expect(original.summary[0]!.text).toBe('prior')
})
it('retains exact final filtered bytes for a native reference-only 408 retry', async () => {
  const retry = new ResponsesRetryReplay(), filter = new SessionContinuationTurn()
  const signal = new AbortController().signal
  const raw = { input: [{ ...reasoning('A'), id: 'old' }, { ...call, id: 'fc_old' }, result] }
  const attempt = retry.begin('synthetic-context', signal, 's', 'm')
  const transformed = await attempt.normalize(raw, payload => filter.transform(payload))
  attempt.observe(JSON.stringify(transformed), 408)
  attempt.finish()
  const next = retry.begin('synthetic-context', signal, 's', 'm')
  const references = { input: [{ type: 'item_reference', id: 'old' }, { type: 'item_reference', id: 'fc_old' }, result] }
  expect(() => normalizeCopilotResponsesPayload(references)).toThrow()
  expect(await next.normalize(references, payload => filter.transform(payload))).toEqual(transformed)
  next.finish()
})
it('yields during ciphertext hashing and rejects revocation without establishing a baseline', async () => {
  const filter = new SessionContinuationTurn()
  let current = true, checks = 0
  const processing = filter.transform({ input: [{ ...reasoning('old'), encrypted_content: 'x'.repeat(17 * 1024 * 1024) }] }, () => {
    if (++checks === 3) setImmediate(() => { current = false })
    if (!current) throw new Error('revoked')
  })
  await expect(processing).rejects.toThrow('revoked')
  expect(checks).toBeGreaterThanOrEqual(4)
  expect(filter.initialized).toBe(false)
  expect(await filter.transform({ input: [reasoning('new')] })).toEqual({ input: [] })
})
it('bounds reasoning work and duplicate item counts without partially committing a baseline', async () => {
  const filter = new SessionContinuationTurn()
  await expect(filter.transform({ input: Array.from({ length: SESSION_CONTINUATION_LIMITS.items + 1 }, () => reasoning('same')) }))
    .rejects.toThrow('ITEM_LIMIT')
  expect(filter.initialized).toBe(false)
  await expect(filter.transform({ input: [{ ...reasoning('old'),
    encrypted_content: 'x'.repeat(SESSION_CONTINUATION_LIMITS.ciphertextCodeUnits + 1) }] }))
    .rejects.toThrow('REASONING_WORK_LIMIT')
  expect(filter.initialized).toBe(false)
  await expect(filter.transform({ input: Array(SESSION_CONTINUATION_LIMITS.inputItems + 1).fill(result) }))
    .rejects.toThrow('INVALID_PAYLOAD')
})
it('does not replace an admitted baseline on cancellation or overlapping processing', async () => {
  const filter = new SessionContinuationTurn()
  await filter.transform({ input: [reasoning('old')] })
  const pending = filter.transform({ input: [reasoning('fresh')] })
  await expect(filter.transform({ input: [reasoning('other')] })).rejects.toThrow('PROCESSING_OVERLAP')
  expect(await pending).toEqual({ input: [reasoning('fresh')] })
  await expect(filter.transform({ input: [reasoning('fresh')] }, () => { throw new Error('cancelled') })).rejects.toThrow('cancelled')
  expect(await filter.transform({ input: [reasoning('old'), reasoning('fresh')] })).toEqual({ input: [reasoning('fresh')] })
})
it.each(['abort', 'dispose', 'finish'] as const)('rejects late asynchronous retry-byte evidence after %s', async action => {
  const retry = new ResponsesRetryReplay()
  const controller = new AbortController()
  const attempt = retry.begin('context', controller.signal, 's', 'm')
  const deferred = Promise.withResolvers<unknown>()
  const pending = attempt.normalize({ input: [reasoning('old')] }, () => deferred.promise)
  if (action === 'abort') controller.abort()
  else if (action === 'dispose') retry.dispose()
  else attempt.finish()
  deferred.resolve({ input: [] })
  await expect(pending).rejects.toThrow()
  attempt.finish()
  expect(retry.belongsTo('s')).toBe(false)
})
