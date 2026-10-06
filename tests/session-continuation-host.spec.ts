import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import { scopeTarget } from '@deepseek-ai/dsh-scope'
import { expect, it, vi } from 'vitest'
import { installSessionContinuation } from '../src/session-continuation-host.ts'

async function checkPersistence() {
  const ctx = new Context()
  let revision = 1
  const value: Record<string, unknown> = { enabled: true, excludedModelIds: ['preserved'] }
  const mutate = vi.fn(async (_namespace, operations, expected) => {
    expect(expected).toBe(revision)
    expect(['sessionContinuation', 'continuationDefaultHistory']).toContain(operations[0].path[0])
    value[operations[0].path[0]] = operations[0].value
    revision++
  })

  ctx.provide('settings', { describe: () => [{ ns: 'github-copilot', value, revision }], mutate })
  const session = { id: 'synthetic-session' as NonNullable<GenerateOptions['sessionId']> }
  const agent = { ctx, session } as unknown as Agent
  const scope = scopeTarget(agent, agent)
  let owner = installSessionContinuation(ctx)
  await owner.ready
  const body = { input: [{ type: 'reasoning', encrypted_content: 'synthetic', summary: [] }] }
  const request = (signal: AbortSignal): GenerateOptions => ({
    provider: 'github-copilot-preview', model: 'synthetic-model', sessionId: session.id, signal, messages: [],
  })
  try {
    expect((await ctx.githubCopilotSessionContinuation.get(agent)).enabled).toBe(false)
    await expect(ctx.githubCopilotSessionContinuation.set(agent, 0, true)).rejects.toThrow('CONFLICT')
    await ctx.githubCopilotSessionContinuation.set(agent, revision, true)
    expect(value.excludedModelIds).toEqual(['preserved'])
    const first = new AbortController()
    await ctx.waterfall(scope, 'agent/request', { agent, turn: 1, step: 1, signal: first.signal },
      async () => ({ provider: 'github-copilot-preview', model: 'synthetic-model' }))
    const prepared = owner.prepare(request(first.signal))!
    expect(await prepared(body)).toEqual({ input: [] })
    await ctx.githubCopilotSessionContinuation.set(agent, revision, false)
    expect(await ctx.githubCopilotSessionContinuation.get(agent)).toMatchObject({ enabled: false, activeTurnEnabled: true })
    expect(await prepared(body)).toEqual({ input: [] })
    const inFlight = prepared({ input: [{ ...body.input[0], encrypted_content: 'x'.repeat(17 * 1024 * 1024) }] })
    ctx.emit('session/event', agent.session, { type: 'turn/end', data: { turn: 1 } } as never)
    await expect(inFlight).rejects.toThrow('REVOKED')
    await expect(prepared(body)).rejects.toThrow('REVOKED')
    const second = new AbortController()
    await ctx.waterfall(scope, 'agent/request', { agent, turn: 2, step: 1, signal: second.signal },
      async () => ({ provider: 'github-copilot-preview', model: 'synthetic-model' }))
    expect(owner.prepare(request(second.signal))).toBeUndefined()
    ctx.emit('session/event', agent.session, { type: 'turn/end', data: { turn: 2 } } as never)
    await ctx.githubCopilotSessionContinuation.set(agent, revision, true)
    owner.dispose()
    const restarted = new Context()
    restarted.provide('settings', { describe: () => [{ ns: 'github-copilot', value, revision }], mutate })
    const restartedOwner = installSessionContinuation(restarted)
    try {
      expect((await restarted.githubCopilotSessionContinuation.get(agent)).enabled).toBe(true)
      expect((await restarted.githubCopilotSessionContinuation.get({ session: { id: 'fork' } } as Agent)).enabled).toBe(false)
    } finally { restartedOwner.dispose(); await restarted.fiber.dispose() }
  } finally { owner.dispose(); await ctx.fiber.dispose() }
}

async function checkDefaults() {
    const ctx = new Context()
    let revision = 0
    const value: Record<string, unknown> = {}
    ctx.provide('settings', { describe: () => [{ ns: 'github-copilot', value, revision }],
      mutate: async (_ns: string, operations: { path: string[]; value: unknown }[], expected: number) => {
        expect(expected).toBe(revision)
        for (const op of operations) value[op.path[0]!] = op.value
        revision++
      } })
    const owner = installSessionContinuation(ctx)
    await owner.ready
    const make = (createdAt: number, isSeeded = false) => ({ ctx, session: {
      id: `s-${createdAt}-${isSeeded}`, header: { createdAt, isSeeded },
    } }) as unknown as Agent
    try {
      const old = make(1)
      const changed = (value.continuationDefaultHistory as { changedAt: number }[])[0]!.changedAt
      const fresh = make(changed + 1), seeded = make(changed + 1, true)
      expect((await ctx.githubCopilotSessionContinuation.defaults()).enabled).toBe(true)
      expect((await ctx.githubCopilotSessionContinuation.get(old)).enabled).toBe(false)
      expect((await ctx.githubCopilotSessionContinuation.get(seeded)).enabled).toBe(false)
      expect((await ctx.githubCopilotSessionContinuation.get(fresh)).enabled).toBe(true)
      await ctx.githubCopilotSessionContinuation.setDefault(revision, false)
      expect((await ctx.githubCopilotSessionContinuation.get(fresh)).enabled).toBe(true)
      await ctx.githubCopilotSessionContinuation.set(fresh, revision, false)
      expect((await ctx.githubCopilotSessionContinuation.get(fresh)).enabled).toBe(false)
      await ctx.githubCopilotSessionContinuation.set(fresh, revision, null)
      expect(await ctx.githubCopilotSessionContinuation.get(fresh)).toMatchObject({ enabled: true, source: 'default' })
      await ctx.githubCopilotSessionContinuation.authorizeNext(old, revision, true)
      expect((await ctx.githubCopilotSessionContinuation.get(old)).nextTurnAuthorized).toBe(true)
      expect((await ctx.githubCopilotSessionContinuation.set(old, revision, false)).nextTurnAuthorized).toBe(false)
      await ctx.githubCopilotSessionContinuation.authorizeNext(old, revision, true)
      const signal = new AbortController().signal
      await ctx.waterfall(scopeTarget(old, old), 'agent/request', { agent: old, turn: 1, step: 1, signal },
        async () => ({ provider: 'github-copilot-preview', model: 'synthetic' }))
      expect(await ctx.githubCopilotSessionContinuation.get(old)).toMatchObject({
        enabled: false, nextTurnAuthorized: false, activeTurnEnabled: true,
      })
      ctx.emit('session/event', old.session, { type: 'turn/end', data: { turn: 1 } } as never)
      expect(await ctx.githubCopilotSessionContinuation.get(old)).toMatchObject({ enabled: false, nextTurnAuthorized: false })
    } finally { owner.dispose(); await ctx.fiber.dispose() }
}
it('persists exact Session consent and freezes changes through the active turn', async () => { await checkPersistence() })
it('captures birth-time defaults and consumes one-turn consent', async () => { await checkDefaults() })

it('applies persisted continuation before a native summary and reports only native replacement success', async () => {
  const ctx = new Context()
  const value = { sessionContinuation: [{ sessionId: 'summary-session', version: 1, enabled: true, consentedAt: 1 }],
    continuationDefaultHistory: [{ enabled: true, changedAt: 1 }] }
  ctx.provide('settings', { describe: () => [{ ns: 'github-copilot', value, revision: 1 }] })
  const agent = { ctx, session: { id: 'summary-session' } } as unknown as Agent
  ctx.provide('agents', { get: (id: string) => id === agent.session.id ? agent : undefined, currentInitiator: () => undefined })
  const owner = installSessionContinuation(ctx)
  await owner.ready
  const signal = new AbortController().signal
  const request: GenerateOptions = { provider: 'github-copilot-preview', model: 'fixture',
    sessionId: agent.session.id, purpose: 'compaction', signal, messages: [] }
  const visible = { type: 'message', role: 'user', content: 'synthetic-visible' }
  const body = { input: [{ type: 'reasoning', encrypted_content: 'synthetic', summary: [{ type: 'summary_text', text: 'hidden' }] }, visible] }
  try {
    ctx.emit('session/event', agent.session, { type: 'compaction/start', data: { compactionId: 'synthetic-operation', turn: null } } as never)
    const filter = owner.prepare(request)
    expect(filter).toBeTypeOf('function')
    expect(await filter!(body)).toEqual({ input: [visible] })
    expect(body.input).toHaveLength(2)
    expect(await ctx.githubCopilotSessionContinuation.get(agent)).toMatchObject({ compaction: { state: 'running' } })
    value.sessionContinuation[0]!.enabled = false
    expect(await filter!(body)).toEqual({ input: [visible] })
    ctx.emit('session/event', agent.session, { type: 'user/message', data: { source: {
      kind: 'compact-checkpoint', compactionId: 'synthetic-operation' } } } as never)
    ctx.emit('session/event', agent.session, { type: 'compaction/end', data: { compactionId: 'synthetic-operation', turn: null } } as never)
    expect(await ctx.githubCopilotSessionContinuation.get(agent)).toMatchObject({ compaction: { state: 'completed' } })
    await expect(filter!(body)).rejects.toThrow('REVOKED')
    ctx.emit('session/event', agent.session, { type: 'compaction/start', data: { compactionId: 'next', turn: null } } as never)
    expect(owner.prepare(request)).toBeUndefined()
  } finally { owner.dispose(); await ctx.fiber.dispose() }
})

it.each(['cancelled', 'failed', 'blocked'] as const)('retains truthful summary outcome %s and revokes the operation', async state => {
  const ctx = new Context()
  const value = { sessionContinuation: [{ sessionId: 'summary', version: 1, enabled: state !== 'blocked', consentedAt: 1 }],
    continuationDefaultHistory: [{ enabled: false, changedAt: 1 }] }
  ctx.provide('settings', { describe: () => [{ ns: 'github-copilot', value, revision: 1 }] })
  const agent = { ctx, session: { id: 'summary' } } as unknown as Agent
  ctx.provide('agents', { get: () => agent, currentInitiator: () => undefined })
  const owner = installSessionContinuation(ctx)
  await owner.ready
  const abort = new AbortController()
  const request: GenerateOptions = { provider: 'github-copilot-preview', model: 'fixture',
    sessionId: agent.session.id, purpose: 'compaction', signal: abort.signal, messages: [] }
  try {
    expect(() => owner.prepare(request)).toThrow('BOUNDARY_UNAVAILABLE')
    ctx.emit('session/event', agent.session, { type: 'compaction/start', data: { compactionId: 'op', turn: null } } as never)
    const filter = owner.prepare(request)
    if (state === 'blocked') expect(filter).toBeUndefined()
    else {
      expect(filter).toBeTypeOf('function')
      expect(() => owner.prepare({ ...request, model: 'changed' })).toThrow('MODEL_CHANGED')
      if (state === 'cancelled') abort.abort()
    }
    ctx.emit('session/event', agent.session, { type: 'compaction/end', data: { compactionId: 'op', turn: null,
      error: state === 'blocked' ? 'LlmError: COPILOT_RESPONSES_REPLAY_SCOPE_MISMATCH: synthetic' : 'synthetic failure' } } as never)
    expect(await ctx.githubCopilotSessionContinuation.get(agent)).toMatchObject({ compaction: { id: 'op', state } })
    if (filter) await expect(filter({ input: [] })).rejects.toThrow('REVOKED')
    expect(owner.prepare({ ...request, purpose: 'assessment' })).toBeUndefined()
  } finally { owner.dispose(); await ctx.fiber.dispose() }
})

it('does not inherit legacy next-turn-only consent or classify network failure as replay recovery', async () => {
  const ctx = new Context()
  const value = { continuationDefaultHistory: [{ enabled: false, changedAt: 1 }] }
  ctx.provide('settings', { describe: () => [{ ns: 'github-copilot', value, revision: 1 }] })
  const agent = { ctx, session: { id: 'legacy-once' } } as unknown as Agent
  ctx.provide('agents', { get: () => agent, currentInitiator: () => undefined })
  const owner = installSessionContinuation(ctx)
  await owner.ready
  const signal = new AbortController().signal
  try {
    await ctx.githubCopilotSessionContinuation.authorizeNext(agent, 1, true)
    await ctx.waterfall(scopeTarget(agent, agent), 'agent/request', { agent, turn: 1, step: 1, signal },
      async () => ({ provider: 'github-copilot-preview', model: 'fixture' }))
    ctx.emit('session/event', agent.session, { type: 'compaction/start', data: { compactionId: 'op', turn: 1 } } as never)
    expect(owner.prepare({ provider: 'github-copilot-preview', model: 'fixture',
      sessionId: agent.session.id, purpose: 'compaction', signal, messages: [] })).toBeUndefined()
    ctx.emit('session/event', agent.session, { type: 'compaction/end', data: {
      compactionId: 'op', turn: 1, error: 'synthetic network failure' } } as never)
    expect((await ctx.githubCopilotSessionContinuation.get(agent)).compaction).toBeUndefined()
  } finally { owner.dispose(); await ctx.fiber.dispose() }
})
