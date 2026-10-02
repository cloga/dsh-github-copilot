import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  foldFollowState, initialFollowState, resolveParentModel,
} from '../../src/parent-model-follow.ts'

const route = model => ({ provider: 'github-copilot-preview', model })
const state = () => foldFollowState(initialFollowState(), {
  seq: 1, type: 'subagent/descriptor', data: { version: 3, provider: 'spawn', mode: 'continuable' },
})
const child = () => ({ id: 'child', parentId: 'parent', origin: 'subagent', state: state(), pending: null })
const parent = model => ({ id: 'parent', state: initialFollowState(), pending: route(model) })
const bindings = [{ childSessionId: 'child', parentSessionId: 'parent' }]

test('native children are unchanged without explicit enrollment', () => {
  assert.equal(resolveParentModel(child(), [], () => { throw new Error('must not lookup') }), undefined)
})
test('fixed and every Auto preference preserve the parent selection intent', () => {
  for (const model of ['model-a', 'model-b', 'auto', 'auto-efficiency', 'auto-intelligence']) {
    assert.deepEqual(resolveParentModel(child(), bindings, () => parent(model)), route(model))
  }
})
test('explicit same-model and different-model child selections both win', () => {
  for (const model of ['model-a', 'model-b']) {
    const c = child()
    c.state = foldFollowState(c.state, { seq: 2, type: 'model/selection', data: route(model) })
    assert.equal(resolveParentModel(c, bindings, () => parent('model-a')), undefined)
  }
})
test('pending parent intent takes priority over the last recorded concrete route', () => {
  const p = { ...parent('auto'), recorded: route('old-model') }
  assert.deepEqual(resolveParentModel(child(), bindings, () => p), route('auto'))
})
test('missing parent, missing selection and mismatched lineage fail visibly', () => {
  assert.throws(() => resolveParentModel(child(), bindings, () => undefined), /PARENT_UNAVAILABLE/)
  assert.throws(() => resolveParentModel(child(), bindings, () => ({ ...parent('x'), pending: null })), /SELECTION_UNAVAILABLE/)
  assert.throws(() => resolveParentModel(child(), [{ ...bindings[0], parentSessionId: 'wrong' }], () => parent('x')), /LINEAGE_INVALID/)
})
test('unsupported providers, ambiguous bindings and dedicated policies fail closed', () => {
  assert.throws(() => resolveParentModel(child(), bindings, () => ({ ...parent('x'), pending: { provider: 'other', model: 'x' } })), /PROVIDER_UNSUPPORTED/)
  assert.throws(() => resolveParentModel(child(), [...bindings, ...bindings], () => parent('x')), /BINDING_INVALID/)
  const c = child()
  c.state = foldFollowState(c.state, { seq: 2, type: 'github-copilot/dual-model-policy', data: {} })
  assert.throws(() => resolveParentModel(c, bindings, () => parent('x')), /CHILD_UNSUPPORTED/)
})
test('folding is restart-stable and ignores inherited selections', () => {
  const seed = { seq: 1, type: 'model/selection', data: route('copied') }
  const events = [
    seed,
    { seq: 2, type: 'subagent/descriptor', data: { version: 3, provider: 'spawn', mode: 'continuable' } },
    { seq: 3, type: 'turn/start', data: { turn: 7 } },
  ]
  const first = events.reduce(foldFollowState, initialFollowState(2))
  assert.equal(first.explicit, null)
  assert.equal(first.turn, 7)
  assert.deepEqual(events.reduce(foldFollowState, initialFollowState(2)), first)
  assert.equal(foldFollowState(first, { ...seed, seq: 4 }).explicit.model, 'copied')
})
test('admitted steps identify late enrollment and a new turn resets the boundary', () => {
  let value = foldFollowState(state(), { seq: 2, type: 'turn/start', data: { turn: 1 } })
  assert.equal(value.started, false)
  value = foldFollowState(value, { seq: 3, type: 'step/start', data: { turn: 1, step: 1 } })
  assert.equal(value.started, true)
  value = foldFollowState(value, { seq: 4, type: 'turn/start', data: { turn: 2 } })
  assert.equal(value.started, false)
})
test('nested follows use direct lineage and detect cycles', () => {
  const p = { ...child(), id: 'parent', parentId: 'root' }
  const all = [...bindings, { childSessionId: 'parent', parentSessionId: 'root' }]
  assert.deepEqual(resolveParentModel(child(), all, id => id === 'parent' ? p : { ...parent('auto'), id: 'root' }), route('auto'))
  assert.throws(() => resolveParentModel(child(), [
    ...bindings, { childSessionId: 'parent', parentSessionId: 'child' },
  ], () => ({ ...p, parentId: 'child' })), /LINEAGE_INVALID/)
})
