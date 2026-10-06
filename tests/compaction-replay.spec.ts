import { expect, it } from 'vitest'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import { CompactionReplayRecovery } from '../src/compaction-replay.ts'

it('authorizes only the exact manual summary operation and preserves visible tool content', async () => {
  const owner = new CompactionReplayRecovery()
  const signal = new AbortController().signal
  const sessionId = 'fixture-session' as NonNullable<GenerateOptions['sessionId']>
  const request: GenerateOptions = { provider: 'github-copilot-preview', model: 'fixture',
    sessionId, purpose: 'compaction', signal, messages: [] }
  const visible = { type: 'function_call', call_id: 'fixture-call', name: 'fixture', arguments: '{}' }
  const body = { input: [{ type: 'reasoning', encrypted_content: 'fixture', summary: [] }, visible] }
  expect(owner.prepare(request)).toBeUndefined()
  let captured: ((payload: unknown) => Promise<unknown>) | undefined
  await owner.run(sessionId, 'fixture', signal, async () => {
    captured = owner.prepare(request)
    expect(await captured!(body)).toEqual({ input: [visible] })
    expect(body.input).toHaveLength(2)
    expect(owner.prepare({ ...request, purpose: undefined })).toBeUndefined()
    expect(owner.prepare({ ...request, model: 'other' })).toBeUndefined()
    expect(owner.prepare({ ...request, signal: new AbortController().signal })).toBeUndefined()
    expect(owner.prepare({ ...request, sessionId: 'other' as typeof sessionId })).toBeUndefined()
    expect(owner.prepare({ ...request, provider: 'other' })).toBeUndefined()
  })

  expect(owner.prepare(request)).toBeUndefined()
  await expect(captured!(body)).rejects.toThrow('REVOKED')
})

it('bounds concurrent authorizations and rejects overlap without revoking the original operation', async () => {
  const owner = new CompactionReplayRecovery()
  const sessionId = 'fixture' as NonNullable<GenerateOptions['sessionId']>
  const release = Promise.withResolvers<void>()
  const signals = Array.from({ length: 64 }, () => new AbortController().signal)
  const work = signals.map(signal => owner.run(sessionId, 'fixture', signal, () => release.promise))
  await expect(owner.run(sessionId, 'fixture', signals[0]!, async () => {})).rejects.toThrow('OVERLAP')
  await expect(owner.run(sessionId, 'fixture', new AbortController().signal, async () => {})).rejects.toThrow('LIMIT')
  const request: GenerateOptions = { provider: 'github-copilot-preview', model: 'fixture', sessionId,
    purpose: 'compaction', signal: signals[0]!, messages: [] }
  const transform = owner.prepare(request)!
  expect(await transform({ input: [] })).toEqual({ input: [] })
  owner.dispose()
  await expect(transform({ input: [] })).rejects.toThrow('REVOKED')
  release.resolve()
  await Promise.all(work)
})

it('revokes on cancellation, failure and teardown without authorizing retries', async () => {
  const owner = new CompactionReplayRecovery()
  const abort = new AbortController()
  const sessionId = 'fixture' as NonNullable<GenerateOptions['sessionId']>
  const request: GenerateOptions = { provider: 'github-copilot-preview', model: 'fixture',
    sessionId, purpose: 'compaction', signal: abort.signal, messages: [] }
  await expect(owner.run(sessionId, 'fixture', abort.signal, async () => {
    const transform = owner.prepare(request)!
    abort.abort()
    await expect(transform({ input: [] })).rejects.toThrow('REVOKED')
    throw new Error('fixture-failure')
  })).rejects.toThrow('fixture-failure')
  expect(owner.prepare(request)).toBeUndefined()
  owner.dispose()
  await expect(owner.run(sessionId, 'fixture', new AbortController().signal, async () => {}))
    .rejects.toThrow('UNAVAILABLE')
})
