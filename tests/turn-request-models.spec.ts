import { describe, expect, it } from 'vitest'
import { foldTurnRequestModels as fold, turnRequestModelsDefinition as definition } from '../src/turn-request-models.ts'
const event = (type: string, data: object) => ({ type, data })
const header = (model = 'fixture-request') => event('request/header', {
  header: { config: { provider: 'github-copilot-preview', model } }, reason: 'change',
})
describe('same-turn public request configuration evidence', () => {
  it('captures only headers inside a recorded step, never inherits adjacent or current selections', () => {
    let state = definition.init()
    for (const value of [header('prior'), event('turn/start', { turn: 1 }), header('outside'),
      event('step/start', { turn: 1, step: 1 }), header(), header(),
      event('assistant/attempt', { turn: 1, step: 1 }), event('step/end', { turn: 1, step: 1 }),
      header('after-step'), event('turn/end', { turn: 1 }), header('after-turn'),
      event('turn/start', { turn: 2 }), event('step/start', { turn: 2, step: 2 }),
      event('model/selection', { provider: 'other', model: 'picker' }), event('turn/end', { turn: 2 })]) state = fold(state, value)
    expect(state.turns).toEqual([
      { turn: 1, routes: [{ provider: 'github-copilot-preview', model: 'fixture-request' }], incomplete: false },
      { turn: 2, routes: [], incomplete: false },
    ])
  })
  it('fails closed for paged, mismatched, malformed and overflowing evidence', () => {
    expect(fold(definition.init(), header()).turns).toEqual([])
    let state = fold(definition.init(), event('turn/start', { turn: 3 }))
    state = fold(state, event('step/start', { turn: 2, step: 1 }))
    expect(fold(state, header()).turns[0].routes).toEqual([])
    state = fold(definition.init(), event('turn/start', { turn: 3 }))
    state = fold(state, event('step/start', { turn: 3, step: 1 }))
    state = fold(state, header())
    state = fold(state, header(' '))
    expect(fold(state, header('later')).turns[0]).toEqual({ turn: 3, routes: [], incomplete: true })
    state = fold(definition.init(), event('turn/start', { turn: 1 }))
    state = fold(state, event('step/start', { turn: 1, step: 1 }))
    for (let i = 0; i < 33; i++) state = fold(state, header(`fixture-${i}`))
    expect(state.turns[0]).toEqual({ turn: 1, routes: [], incomplete: true })
  })
  it('keeps multiple models/providers without reading header tools, history or replay', () => {
    const config = { provider: 'other', model: 'fixture-b' }
    const snapshot = { config }
    Object.defineProperty(snapshot, 'tools', { get() { throw new Error('No tool reads') } })
    let state = fold(definition.init(), event('turn/start', { turn: 1 }))
    state = fold(state, event('step/start', { turn: 1, step: 1 }))
    state = fold(state, header())
    state = fold(state, event('request/header', { header: snapshot, reason: 'change' }))
    expect(state.turns[0].routes).toHaveLength(2)
  })
})
