/** Actual tagged Core Client gateway with synthetic RPC transport; no Host or network. */
import { Context } from '@deepseek-ai/cordis'
import * as Gateway from '@deepseek-ai/dsh-api-gateway/client'
import { it, expect, vi } from 'vitest'
import remote from '../../src/remote.ts'
import selectionRemote from '../../src/turn-selection-remote.ts'
import { name, version } from '#package.json' with { type: 'json' }

it('keeps explicit master selection reads independent of ambient Client agent scope', async () => {
  expect(process.env.DSH_CORE_EVIDENCE).toBe('tagged-source-runtime')
  const ctx = new Context()
  let bound: string | undefined = 'ambient-other-session'
  const selection = { mode: 'auto', preference: 'balance', reason: 'standard-turn', candidateCount: 2 }
  const identity = vi.fn(() => bound)
  const rpc = vi.fn(async () => ({ ok: true, value: selection }))
  try {
    ctx.provide('typert', {
      remotes: { register: () => () => {} },
      contexts: { getClient: () => ({ identity }) },
    })
    ctx.provide('connection', { rpc: { call: rpc, open: vi.fn() },
      registerGenerationSource: () => () => {}, start: () => ({ stop: () => {} }),
      generation: { getSnapshot: () => undefined } })
    Gateway.apply(ctx)
    // Reproduce the old descriptor's failure using the actual native gateway.
    const legacy = { ...selectionRemote, descriptors: selectionRemote.descriptors.map(descriptor => ({
      ...descriptor, scope: { context: 'agent' as const, wire: 'agentId' },
    })) }
    const removeLegacy = await ctx.remote.$mount(legacy)
    await expect(ctx.remote.githubCopilotTurnSelection.get('viewed-master', 7))
      .rejects.toThrow('expected 1 argument(s), got 2')
    expect(rpc).not.toHaveBeenCalled()
    await removeLegacy()

    const remove = await ctx.remote.$mount(selectionRemote)
    for (const ambient of ['ambient-other-session', undefined]) {
      bound = ambient
      await expect(ctx.remote.githubCopilotTurnSelection.get('viewed-master', 7))
        .resolves.toEqual({ ok: true, value: selection })
      expect(rpc).toHaveBeenLastCalledWith('/api', 'githubCopilotTurnSelection/get',
        { args: { agentId: 'viewed-master', turn: 7 } }, expect.any(AbortSignal))
    }
    const descriptor = selectionRemote.descriptors[0]!
    expect(descriptor.scope).toBeUndefined()
    expect(descriptor.parameters[0]).toMatchObject({ source: 'lookup', lookup: 'agent', wire: 'agentId' })
    await remove()
  } finally { await ctx.fiber.dispose() }
})

it('mounts authorization, role and search-catalog Remotes on the exact target Client gateway', async () => {
  expect(process.env.DSH_CORE_EVIDENCE).toBe('tagged-source-runtime')
  expect(['0.1.5-alpha.1', '0.1.5-alpha.2', '0.1.5-rc.1', '0.1.5-rc.2', '0.1.6-alpha.1', '0.1.6-alpha.2', '0.2.0-rc.1', '0.2.0-rc.2'])
    .toContain(process.env.DSH_PUBLISHED_CORE_RELEASE)
  const ctx = new Context()
  const registered: unknown[] = []
  const view = { phase: 'signed-out', configured: false, writable: true, inFlight: false, notices: [] }
  const migration = {
    plugin: { name, version }, protocolVersion: 1, observedAt: 0, historyScope: 'live-agents-only',
    capabilities: { agentsList: false, sessionProjections: false, settingsCas: false, providerRegistry: false, defaultSelection: false },
    complete: { sessions: false, defaultSelection: false, routes: false },
    defaultSelection: null, sessions: [], routes: { nativeConfigured: null, nativeRegistered: null, managedRegistered: null },
  }
  const catalog = { supported: true, providers: [{ id: 'synthetic-registered-search' }] }
  const usage = { state: 'ready', billing: 'credits', budget: 'individual',
    used: 3600, remaining: 16400, limit: 20000, percentUsed: 18, observedAt: 1 }
  const roleView = { supported: false, writable: false, revision: 2, diagnostic: 'DUAL_MODEL_RETIRED',
    configuration: { enabled: true, plannerModel: 'planner', executorModel: 'executor' }, models: [], workspaces: [] }
  const recovered = { sessionId: 'synthetic-existing-role-root' }
  const retiredError = { code: 'copilot/dual-model', message: 'DUAL_MODEL_RETIRED', details: { reason: 'DUAL_MODEL_RETIRED' } }
  const rpc = vi.fn(async (_path: string, method: string) => method === 'githubCopilotDualModel/save'
    ? { ok: false, error: retiredError } : { ok: true,
      value: method.startsWith('githubCopilotUsage/') ? usage : method.endsWith('/migrationStatus') ? migration : method === 'githubCopilotSearchRouting/providers' ? catalog
        : method === 'githubCopilotDualModel/create' ? recovered : method.startsWith('githubCopilotDualModel/') ? roleView : view })
  const stop = vi.fn()
  try {
    ctx.provide('typert', { remotes: { register(value: unknown) { registered.push(value); return async () => {} } },
      contexts: { getClient: () => undefined } })
    ctx.provide('connection', { rpc: { call: rpc, open: vi.fn() }, registerGenerationSource: () => () => {},
      start: () => ({ stop }), generation: { getSnapshot: () => undefined } })
    Gateway.apply(ctx)
    const dispose = await ctx.remote.$mount(remote)
    expect(registered).toEqual([remote])
    expect(remote.descriptors.map(item => item.method)).toEqual([
      'status', 'reconcile', 'discoverModels', 'ensureModels', 'start', 'cancel', 'signOut',
      'excludeModel', 'restoreModel', 'migrationStatus',
      'view', 'save', 'create', 'providers', 'get', 'refresh', 'get',
    ])
    for (const descriptor of remote.descriptors.filter(item => item.namespace === 'githubCopilot')) {
      expect(descriptor.result.mode).toBe('strict')
      expect(descriptor.invocation).toEqual({ kind: 'direct' })
      if (descriptor.method === 'excludeModel' || descriptor.method === 'restoreModel') {
        expect(descriptor.parameters).toHaveLength(1)
        expect(descriptor.parameters[0]?.codec.create().parse('gpt-5.4')).toBe('gpt-5.4')
        expect(() => descriptor.parameters[0]?.codec.create().parse('')).toThrow()
      }
      else expect(descriptor.parameters).toEqual([])
      const expected = descriptor.method === 'migrationStatus' ? migration : view
      expect(descriptor.result.create().parse(expected)).toEqual(expected)
      expect(() => descriptor.result.create().parse({ ...expected, credential: 'synthetic-forbidden' })).toThrow()
      const method = ctx.remote.githubCopilot[descriptor.method]
      const parameterized = descriptor.method === 'excludeModel' || descriptor.method === 'restoreModel'
      await expect(parameterized ? method('gpt-5.4') : method()).resolves.toEqual({ ok: true, value: expected })
      expect(rpc).toHaveBeenLastCalledWith('/api', `githubCopilot/${descriptor.method}`,
        { args: parameterized ? { modelId: 'gpt-5.4' } : {} }, expect.any(AbortSignal))
    }
    expect(rpc).toHaveBeenCalledTimes(10)
    const catalogDescriptor = remote.descriptors.find(item => item.namespace === 'githubCopilotSearchRouting')!
    expect(catalogDescriptor).toMatchObject({
      id: 'dsh-github-copilot:githubCopilotSearchRouting.providers', service: 'githubCopilotSearchRouting',
      method: 'providers', invocation: { kind: 'direct' }, parameters: [],
      result: { mode: 'strict', typeSymbol: 'dsh-github-copilot#SearchProviderCatalog' },
    })
    expect(catalogDescriptor.result.create().parse(catalog)).toEqual(catalog)
    expect(() => catalogDescriptor.result.create().parse({ supported: true,
      providers: [{ id: 'synthetic-registered-search', credential: 'synthetic-forbidden' }] })).toThrow()
    await expect(ctx.remote.githubCopilotSearchRouting.providers()).resolves.toEqual({ ok: true, value: catalog })
    expect(rpc).toHaveBeenLastCalledWith('/api', 'githubCopilotSearchRouting/providers', { args: {} }, expect.any(AbortSignal))
    expect(rpc).toHaveBeenCalledTimes(11)
    for (const method of ['get', 'refresh'] as const) {
      await expect(ctx.remote.githubCopilotUsage[method]()).resolves.toEqual({ ok: true, value: usage })
      expect(rpc).toHaveBeenLastCalledWith('/api', `githubCopilotUsage/${method}`, { args: {} }, expect.any(AbortSignal))
    }
    const usageDescriptor = remote.descriptors.find(item => item.namespace === 'githubCopilotUsage')!
    expect(usageDescriptor.result.create().parse(usage)).toEqual(usage)
    expect(() => usageDescriptor.result.create().parse({ ...usage, credential: 'synthetic-forbidden' })).toThrow()
    await expect(ctx.remote.githubCopilotDualModel.view()).resolves.toEqual({ ok: true, value: roleView })
    await expect(ctx.remote.githubCopilotDualModel.save({ configuration: roleView.configuration, expectedRevision: 2 }))
      .resolves.toMatchObject({ ok: false, error: retiredError })
    await expect(ctx.remote.githubCopilotDualModel.create({ requestId: '00000000-0000-4000-8000-000000000001', workspaceId: 'workspace', expectedRevision: 2 }))
      .resolves.toEqual({ ok: true, value: recovered })
    const saveDescriptor = remote.descriptors.find(item => item.namespace === 'githubCopilotDualModel' && item.method === 'save')!
    expect(() => saveDescriptor.parameters[0].codec.create().parse({
      configuration: { ...roleView.configuration, token: 'synthetic-forbidden' }, expectedRevision: 2,
    })).toThrow()
    // Client owns arity/context binding; nested validation belongs to the Host gateway.
    if (process.env.DSH_PUBLISHED_CORE_RELEASE === '0.1.6-alpha.2') {
      const beforeInvalid = rpc.mock.calls.length
      await expect(Reflect.apply(ctx.remote.githubCopilotDualModel.save, undefined, [])).rejects.toThrow('expected 1 argument(s), got 0')
      expect(rpc).toHaveBeenCalledTimes(beforeInvalid)
    }
    for (const descriptor of remote.descriptors) {
      for (const codec of [descriptor.result, ...descriptor.parameters.map(parameter => parameter.codec)]) {
        expect(codec.mode).toBe('strict')
        expect(codec.create().parse).toBeTypeOf('function')
      }
    }
    await dispose()
    expect(ctx.get('remote.githubCopilot')).toBeUndefined()
    expect(ctx.get('remote.githubCopilotDualModel')).toBeUndefined()
    expect(ctx.get('remote.githubCopilotSearchRouting')).toBeUndefined()
    expect(ctx.get('remote.githubCopilotUsage')).toBeUndefined()
  } finally { await ctx.fiber.dispose() }
  expect(stop).toHaveBeenCalledOnce()
})
