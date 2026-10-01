import { describe, expect, it } from 'vitest'
import { turnModelProvenanceDefinition as definition } from '../src/turn-model-provenance.ts'

const event = (type: string, data: Record<string, unknown> = {}): { type: string; surfaceOp: string; data: Record<string, unknown> } => ({ type, surfaceOp: 'append', data: { turn: 3, ...data } })
const message = (provider = 'github-copilot-preview', model = 'fixture-a') => event('assistant/message', {
  message: { source: { provider, model } },
})
function fold(events: unknown[]) {
  return definition.buildLocationData({ matches: events.map(event => ({ event })) }, 'turn', null)?.value
}

describe('turn model provenance without token aggregation', () => {
  it('retains known models around zero-usage failed attempts without reading payloads', () => {
    const reply = message()
    const source = { provider: 'github-copilot-preview', model: 'fixture-a' }
    Object.defineProperty(source, 'replayState', { get() { throw new Error('Do not inspect replay') } })
    reply.data.message = { source }
    Object.defineProperty(reply.data, 'usage', { get() { throw new Error('Do not inspect usage') } })
    const value = fold([event('turn/start'), reply, event('assistant/attempt'), event('llm/retry'),
      message(), message('other-provider', 'fixture-b'), event('turn/end')])
    expect(value).toEqual({
      routes: [{ provider: 'github-copilot-preview', model: 'fixture-a' }, { provider: 'other-provider', model: 'fixture-b' }],
      incomplete: true, ended: true,
    })
  })

  it('does not infer execution or selection mode from a request header, Auto decision or current picker', () => {
    for (const type of ['request/header', 'model/selection', 'github-copilot/auto-model-decision']) {
      expect(definition.match(event(type, { provider: 'github-copilot-preview', model: 'auto' }))).toBeNull()
    }
    expect(definition.match({ ...message(), surfaceOp: 'update' })).toBeNull()
    expect(fold([event('turn/start'), event('assistant/attempt'), event('turn/end')]))
      .toEqual({ routes: [], incomplete: true, ended: true })
  })

  it('marks paged or unrecorded attribution incomplete and never inherits a previous model', () => {
    expect(fold([message(), event('turn/end')])?.incomplete).toBe(true)
    expect(fold([event('turn/start'), message(), message('', ''), event('turn/end')])?.incomplete).toBe(true)
    expect(fold([event('turn/start'), message(), event('turn/end')])?.incomplete).toBe(false)
    expect(definition.buildLocationData({ matches: [] }, 'turn', null)).toBeNull()
    expect(fold([event('turn/start'), message(), event('step/start', { step: 2 }), event('step/end', { step: 2 }), event('turn/end')])?.incomplete).toBe(true)
    expect(fold([event('turn/start'), message(), event('step/start', { step: 2 }), event('turn/end')])?.incomplete).toBe(true)
  })

  it('produces the same snapshot from live updates and historical matches and reuses unchanged data', () => {
    const events = [event('turn/start'), message(), event('assistant/attempt'), event('turn/end')]
    let state = definition.start({ matches: [] }, { event: events[0] })
    for (const event of events.slice(1)) state = definition.update({ state, matches: [] }, { event })
    const live = definition.buildLocationData({ state, matches: [] }, 'turn', null)
    expect(live?.value).toEqual(fold(events))
    expect(definition.buildLocationData({ state, matches: [] }, 'turn', live)).toBe(live)
    expect(definition.buildLocationData({ state, matches: [] }, 'step', null)).toBeNull()
  })
})
