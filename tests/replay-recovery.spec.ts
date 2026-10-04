import { describe, expect, it } from 'vitest'
import { ReplayRecoveryStore } from '../src/replay-recovery.ts'

const item = (value: string) => ({ type: 'reasoning', encrypted_content: value, summary: [] })
const payload = (...input: unknown[]) => ({ input, store: false })
describe('explicit replay recovery', () => {
  it('keeps default replay and requires a revision-bound confirmation', () => {
    const store = new ReplayRecoveryStore(), owner = {}, body = payload(item('synthetic-a'))
    store.recordFailure(owner, 'proof', 'model', JSON.stringify(body))
    expect(store.prepare(owner, 'proof', 'model')(body)).toBe(body)
    expect(() => store.setEnabled(owner, 'proof', 'stale', true)).toThrow('STALE_EVIDENCE')
    const view = store.view(owner, 'proof')
    if (view.state === 'unavailable') throw new Error('missing evidence')
    store.setEnabled(owner, 'proof', view.revision, true)
    expect(store.prepare(owner, 'proof', 'model')(body)).toEqual(payload())
  })
  it('preserves source, fresh reasoning, tools, other models and other owners', () => {
    const store = new ReplayRecoveryStore(), owner = {}, old = item('synthetic-old'), fresh = item('synthetic-fresh')
    const tool = { type: 'function_call', call_id: 'synthetic', arguments: '{}', name: 'test' }
    const body = payload(old, tool, fresh), before = JSON.stringify(body)
    store.recordFailure(owner, 'proof', 'model', JSON.stringify(payload(old)))
    const view = store.view(owner, 'proof')
    if (view.state === 'unavailable') throw new Error('missing evidence')
    store.setEnabled(owner, 'proof', view.revision, true)
    expect(store.prepare(owner, 'proof', 'model')(body)).toEqual(payload(tool, fresh))
    expect(JSON.stringify(body)).toBe(before)
    expect(store.prepare({}, 'proof', 'model')(body)).toBe(body)
    expect(store.prepare(owner, 'proof', 'other')(body)).toBe(body)
  })
  it('captures consent at request preparation and revokes on proof changes', () => {
    const store = new ReplayRecoveryStore(), owner = {}, body = payload(item('synthetic'))
    store.recordFailure(owner, 'proof', 'model', JSON.stringify(body))
    const prepared = store.prepare(owner, 'proof', 'model'), view = store.view(owner, 'proof')
    if (view.state === 'unavailable') throw new Error('missing evidence')
    store.setEnabled(owner, 'proof', view.revision, true)
    expect(prepared(body)).toBe(body)
    const admitted = store.prepare(owner, 'proof', 'model')
    store.setEnabled(owner, 'proof', view.revision, false)
    expect(admitted(body)).toEqual(payload())
    expect(store.prepare(owner, 'proof', 'model')(body)).toBe(body)
    store.view(owner, 'new-proof')
    expect(() => admitted(body)).toThrow('REVOKED')
  })
  it('bounds lifetime, item counts and parser work without exposing fingerprints', () => {
    let now = 0
    const store = new ReplayRecoveryStore(() => now), owner = {}
    store.recordFailure(owner, 'proof', 'model', JSON.stringify(payload(item('synthetic-secret'))))
    expect(Object.keys(store.view(owner, 'proof')).sort()).toEqual(['itemCount', 'model', 'revision', 'state'])
    expect(JSON.stringify(store.view(owner, 'proof'))).not.toContain('synthetic-secret')
    now = 3_600_000
    expect(store.view(owner, 'proof')).toEqual({ state: 'unavailable' })
    expect(() => store.recordFailure(owner, 'proof', 'model', '{"input":[],"input":[]}')).toThrow('EVIDENCE_UNAVAILABLE')
    expect(() => store.recordFailure(owner, 'proof', 'model', JSON.stringify(payload(
      ...Array.from({ length: 513 }, (_, index) => item(`synthetic-${index}`)),
    )))).toThrow('EVIDENCE_LIMIT')
  })
})
