import { describe, expect, it } from 'vitest'
import {
  AutoModelIntentSchema, autoModelIntentDefinition, foldAutoModelIntent, initialAutoModelIntent,
} from '../src/auto-model-intent.ts'

const auto = { provider: 'github-copilot-preview', model: 'auto-intelligence' }
const selection = (seq: number, data: unknown) => ({ seq, type: 'model/selection', data })

describe('explicit Auto intent projection', () => {
  it('retains explicit intent across virtual and concrete execution headers and cold replay', () => {
    const events = [
      selection(0, auto),
      { seq: 1, type: 'request/header', data: { header: { config: auto } } },
      { seq: 2, type: 'request/header', data: { header: { config: { ...auto, model: 'real-model' } } } },
      { seq: 3, type: 'turn/start', data: { turn: 2 } },
    ]
    const state = events.reduce(foldAutoModelIntent, initialAutoModelIntent())
    expect(AutoModelIntentSchema.parse(state)).toEqual({ inherited: 0, selection: auto, blocked: false })
    expect(events.reduce(autoModelIntentDefinition.apply, autoModelIntentDefinition.init({}))).toEqual(state)
  })

  it.each([
    { ...auto, model: 'explicit-fixed' },
    { provider: 'other-provider', model: 'other-model' },
    { ...auto, model: 'auto-efficiency' },
  ])('keeps the latest explicit selection %j after native pending consumption', fixed => {
    let state = foldAutoModelIntent(initialAutoModelIntent(), selection(0, auto))
    state = foldAutoModelIntent(state, selection(1, { ...fixed, reasoningEffort: 'high' }))
    state = foldAutoModelIntent(state, { seq: 2, type: 'request/header', data: { header: { config: fixed } } })
    expect(state.selection).toEqual(fixed)
    expect(state.blocked).toBe(false)
  })

  it('does not infer intent from execution or copied fork/child prefixes', () => {
    const state = foldAutoModelIntent(initialAutoModelIntent(5), selection(4, auto))
    expect(state.selection).toBeNull()
    expect(foldAutoModelIntent(state, { seq: 5, type: 'request/header', data: { header: { config: auto } } }))
      .toEqual(state)
    expect(foldAutoModelIntent(state, selection(5, auto)).selection).toEqual(auto)
  })

  it.each([null, {}, { provider: auto.provider, model: '' }, { provider: 1, model: 'auto' }])(
    'blocks malformed explicit evidence %j without guessing a route', data => {
      const state = foldAutoModelIntent(initialAutoModelIntent(), selection(0, data))
      expect(state).toMatchObject({ selection: null, blocked: true })
      expect(foldAutoModelIntent(state, selection(1, auto))).toMatchObject({ selection: auto, blocked: false })
    },
  )

  it('rejects unknown, partial and out-of-range restored states', () => {
    for (const value of [undefined, {}, { ...initialAutoModelIntent(), inherited: Number.MAX_SAFE_INTEGER + 1 },
      { ...initialAutoModelIntent(), version: 2 }]) {
      expect(AutoModelIntentSchema.safeParse(value).success).toBe(false)
    }
  })
})
