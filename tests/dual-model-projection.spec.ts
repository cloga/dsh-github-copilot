import { describe, expect, it } from 'vitest'
import { dualModelProjection } from '../src/dual-model-host.ts'

const descriptor = { version: 3, mode: 'continuable', provider: 'spawn', label: 'work', agentProvider: 'github-copilot-preview', agentModel: 'account-model', persona: 'executor', toolFilter: { allow: ['read'] } }
const init = () => dualModelProjection.init({ id: 'child', parentSession: 'parent', origin: 'subagent' })
const event = (data: unknown, seq = 0) => ({ type: 'subagent/descriptor', seq, data })

describe('dedicated role child projection', () => {
  it('recognizes native v3 descriptors and stores only role identity leaves', () => {
    const state = dualModelProjection.apply(init(), event(descriptor))
    expect(state.child).toEqual({ version: 3, mode: 'continuable', provider: 'spawn', agentProvider: 'github-copilot-preview', agentModel: 'account-model' })
    expect(state.invalid).toBe(false)
    expect(dualModelProjection.stateSchema.parse(state)).toEqual(state)
  })
  it('invalidates the old projected cache rather than trusting v1 child state', () => {
    expect(dualModelProjection.stateVersion).toBeGreaterThan(1)
    expect(() => dualModelProjection.stateSchema.parse({ ...init(), child: { ...descriptor, version: 1 } })).toThrow()
  })
  it.each([1, 2, 4])('preserves but refuses unverified descriptor version %s', version => {
    const original = { ...descriptor, version }
    expect(dualModelProjection.apply(init(), event(original))).toMatchObject({ child: null, invalid: true })
    expect(original.version).toBe(version)
  })
  it.each([
    { ...descriptor, label: undefined },
    { ...descriptor, toolFilter: { allow: [42] } },
    { ...descriptor, provider: 'fork' },
    { ...descriptor, agentModel: undefined },
    { ...descriptor, extra: 'untrusted' },
  ])('fails closed for malformed or unsupported current descriptors', value => {
    expect(dualModelProjection.apply(init(), event(value))).toMatchObject({ child: null, invalid: true })
  })
  it('never repairs a rejected or duplicate own-suffix descriptor with a later event', () => {
    const bad = dualModelProjection.apply(init(), event({ ...descriptor, version: 1 }))
    expect(dualModelProjection.apply(bad, event(descriptor, 1)).invalid).toBe(true)
    const good = dualModelProjection.apply(init(), event(descriptor))
    expect(dualModelProjection.apply(good, event(descriptor, 1)).invalid).toBe(true)
  })
  it('does not inherit an ancestor descriptor as child policy evidence', () => {
    const state = dualModelProjection.init({ id: 'child', parentSession: 'parent', origin: 'subagent' }, 2)
    expect(dualModelProjection.apply(state, event(descriptor, 1))).toBe(state)
    expect(dualModelProjection.apply(state, event(descriptor, 2)).child?.version).toBe(3)
  })
})
