import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import { scopeTarget } from '@deepseek-ai/dsh-scope'
import { expect, it } from 'vitest'
import { installReplayRecovery, ReplayRecoveryController } from '../src/replay-recovery-host.ts'

it('requires the native initiating session and signal, rejects active-turn writes and revokes late requests', async () => {
  const ctx = new Context()
  const agent = { ctx, session: { id: 'synthetic-session' } } as unknown as Agent
  const scope = scopeTarget(agent, agent)
  let proof: string | undefined = 'synthetic-proof'
  const owner = installReplayRecovery(ctx, () => proof)
  const service = ctx.githubCopilotReplayRecovery
  expect(service).toBeInstanceOf(ReplayRecoveryController)
  const first = new AbortController()
  const request: GenerateOptions = { provider: 'github-copilot-preview', model: 'synthetic-model',
    sessionId: agent.session.id, signal: first.signal, messages: [] }
  const body = { input: [{ type: 'reasoning', encrypted_content: 'synthetic-opaque', summary: [] }], store: false }
  try {
    expect(owner.prepare(request)).toBeUndefined()
    await ctx.waterfall(scope, 'agent/request', { agent, turn: 1, step: 1, signal: first.signal },
      async () => ({ provider: request.provider, model: request.model }))
    const dispatch = owner.prepare(request)!
    expect(dispatch.transform(body)).toBe(body)
    expect(owner.prepare({ ...request, sessionId: 'other' as Agent['session']['id'] })).toBeUndefined()
    expect(owner.prepare({ ...request, purpose: 'compaction' })).toBeUndefined()
    dispatch.rejected(JSON.stringify(body))
    const view = service.get(agent)
    if (view.state === 'unavailable') throw new Error('expected evidence')
    expect(() => service.setEnabled(agent, view.revision, true)).toThrow('TURN_ACTIVE')
    expect(() => service.authorize(agent, view.revision, 'next-turn')).toThrow('TURN_ACTIVE')
    ctx.emit('session/event', agent.session, { type: 'turn/end', data: { turn: 1 } } as never)
    expect(service.authorize(agent, view.revision, 'next-turn')).toMatchObject({ state: 'enabled', duration: 'next-turn' })
    const second = new AbortController()
    await ctx.waterfall(scope, 'agent/request', { agent, turn: 2, step: 1, signal: second.signal },
      async () => ({ provider: request.provider, model: request.model }))
    const next = owner.prepare({ ...request, signal: second.signal })!
    expect(next.transform(body)).toEqual({ ...body, input: [] })
    expect(owner.prepare(request)).toBeUndefined()
    const step = new AbortController()
    await ctx.waterfall(scope, 'agent/request', { agent, turn: 2, step: 2, signal: step.signal },
      async () => ({ provider: request.provider, model: request.model }))
    expect(owner.prepare({ ...request, signal: step.signal })!.transform(body)).toEqual({ ...body, input: [] })
    expect(() => next.transform(body)).toThrow('REVOKED')
    ctx.emit('session/event', agent.session, { type: 'turn/end', data: { turn: 2 } } as never)
    expect(service.get(agent).state).toBe('available')
    const third = new AbortController()
    await ctx.waterfall(scope, 'agent/request', { agent, turn: 3, step: 1, signal: third.signal },
      async () => ({ provider: request.provider, model: request.model }))
    expect(owner.prepare({ ...request, signal: third.signal })!.transform(body)).toBe(body)
    dispatch.rejected(JSON.stringify({ input: [{ type: 'reasoning', encrypted_content: 'late' }] }))
    expect(service.get(agent)).toMatchObject({ state: 'available', revision: view.revision })
    ctx.emit(scope, 'agent/disposed', { agent })
    expect(service.get(agent)).toEqual({ state: 'unavailable' })
    expect(() => next.transform(body)).toThrow('REVOKED')
    proof = undefined
    expect(() => next.transform(body)).toThrow('REVOKED')
    expect(service.get(agent)).toEqual({ state: 'unavailable' })
  } finally { owner.dispose(); await ctx.fiber.dispose() }
})
