import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { expect, it } from 'vitest'
import { TURN_REQUEST_MODELS, turnRequestModelsDefinition } from '../src/turn-request-models.ts'

it('cold-folds same-turn requested models through the native public registry without changing events', async () => {
  const ctx = new Context()
  try {
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    const session = ctx.sessions.create()
    session.append('turn/start', { turn: 7 })
    session.append('step/start', { turn: 7, step: 1 })
    session.append('request/header', { header: { config: { provider: 'github-copilot-preview', model: 'fixture-request' } }, reason: 'initial' })
    session.append('step/end', { turn: 7, step: 1 })
    session.append('turn/end', { turn: 7, reason: { kind: 'completed' } })
    const original = JSON.stringify(session.snapshotEvents())
    const fiber = ctx.plugin({ apply(scope) { return scope.sessionProjections.register(turnRequestModelsDefinition) } })
    await fiber
    expect(ctx.sessionProjections.stateOf(session, TURN_REQUEST_MODELS)?.turns)
      .toEqual([{ turn: 7, routes: [{ provider: 'github-copilot-preview', model: 'fixture-request' }], incomplete: false }])
    expect(ctx.sessionProjections.checkpoint(session)[TURN_REQUEST_MODELS]?.ver).toBe(1)
    expect(JSON.stringify(session.snapshotEvents())).toBe(original)
    await fiber.dispose()
    expect(ctx.sessionProjections.stateOf(session, TURN_REQUEST_MODELS)).toBeUndefined()
  } finally { await ctx.fiber.dispose() }
})
