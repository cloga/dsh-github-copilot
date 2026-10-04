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
    ctx.emit('session/event', agent.session, { type: 'turn/end' } as never)
    expect(service.setEnabled(agent, view.revision, true).state).toBe('enabled')
    const second = new AbortController()
    await ctx.waterfall(scope, 'agent/request', { agent, turn: 2, step: 1, signal: second.signal },
      async () => ({ provider: request.provider, model: request.model }))
    const next = owner.prepare({ ...request, signal: second.signal })!
    expect(next.transform(body)).toEqual({ ...body, input: [] })
    dispatch.rejected(JSON.stringify({ input: [{ type: 'reasoning', encrypted_content: 'late' }] }))
    expect(service.get(agent)).toMatchObject({ state: 'enabled', revision: view.revision })
    proof = undefined
    expect(() => next.transform(body)).toThrow('REVOKED')
    expect(service.get(agent)).toEqual({ state: 'unavailable' })
  } finally { owner.dispose(); await ctx.fiber.dispose() }
})
