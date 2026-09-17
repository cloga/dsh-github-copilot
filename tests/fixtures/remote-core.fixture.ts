/** Actual tagged Core Client gateway with synthetic RPC transport; no Host or network. */
import { Context } from '@deepseek-ai/cordis'
import * as Gateway from '@deepseek-ai/dsh-api-gateway/client'
import { it, expect, vi } from 'vitest'
import remote from '../../src/remote.ts'
import { name, version } from '#package.json' with { type: 'json' }

it('mounts authorization, role and search-catalog Remotes on the exact target Client gateway', async () => {
  expect(process.env.DSH_CORE_EVIDENCE).toBe('tagged-source-runtime')
  expect(['0.1.5-alpha.1', '0.1.5-alpha.2', '0.1.5-rc.1', '0.1.5-rc.2', '0.1.6-alpha.1', '0.1.6-alpha.2'])
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
  const roleView = { supported: true, writable: true, revision: 2,
    configuration: { enabled: true, plannerModel: 'planner', executorModel: 'executor' },
    models: [{ id: 'planner', name: 'Planner' }, { id: 'executor', name: 'Executor' }], workspaces: [{ id: 'workspace', name: 'Workspace' }] }
  const created = { sessionId: 'synthetic-role-root' }
  const rpc = vi.fn(async (_path: string, method: string) => ({ ok: true,
    value: method.endsWith('/migrationStatus') ? migration : method === 'githubCopilotSearchRouting/providers' ? catalog
      : method === 'githubCopilotDualModel/create' ? created : method.startsWith('githubCopilotDualModel/') ? roleView : view }))
  const stop = vi.fn()
  try {
    ctx.provide('typert', { remotes: { register(value: unknown) { registered.push(value); return async () => {} } },
      contexts: { getClient: () => undefined } })
    ctx.provide('connection', { rpc: { call: rpc }, registerGenerationSource: () => () => {},
      start: () => ({ stop }), generation: { getSnapshot: () => undefined } })
    Gateway.apply(ctx)
    const dispose = await ctx.remote.$mount(remote)
    expect(registered).toEqual([remote])
    expect(remote.descriptors.map(item => item.method)).toEqual([
      'status', 'reconcile', 'discoverModels', 'ensureModels', 'start', 'cancel', 'signOut', 'migrationStatus',
      'view', 'save', 'create', 'providers',
    ])
    for (const descriptor of remote.descriptors.filter(item => item.namespace === 'githubCopilot')) {
      expect(descriptor.result.mode).toBe('strict')
      expect(descriptor.invocation).toEqual({ kind: 'direct' })
      expect(descriptor.parameters).toEqual([])
      const expected = descriptor.method === 'migrationStatus' ? migration : view
      expect(descriptor.result.schema.parse(expected)).toEqual(expected)
      expect(() => descriptor.result.schema.parse({ ...expected, credential: 'synthetic-forbidden' })).toThrow()
      const method = ctx.remote.githubCopilot[descriptor.method]
      await expect(method()).resolves.toEqual({ ok: true, value: expected })
      expect(rpc).toHaveBeenLastCalledWith('/api', `githubCopilot/${descriptor.method}`, { args: {} }, expect.any(AbortSignal))
    }
    expect(rpc).toHaveBeenCalledTimes(8)
    const catalogDescriptor = remote.descriptors.find(item => item.namespace === 'githubCopilotSearchRouting')!
    expect(catalogDescriptor).toMatchObject({
      id: 'dsh-github-copilot:githubCopilotSearchRouting.providers', service: 'githubCopilotSearchRouting',
      method: 'providers', invocation: { kind: 'direct' }, parameters: [],
      result: { mode: 'strict', typeSymbol: 'dsh-github-copilot#SearchProviderCatalog' },
    })
    expect(catalogDescriptor.result.schema.parse(catalog)).toEqual(catalog)
    expect(() => catalogDescriptor.result.schema.parse({ supported: true,
      providers: [{ id: 'synthetic-registered-search', credential: 'synthetic-forbidden' }] })).toThrow()
    await expect(ctx.remote.githubCopilotSearchRouting.providers()).resolves.toEqual({ ok: true, value: catalog })
    expect(rpc).toHaveBeenLastCalledWith('/api', 'githubCopilotSearchRouting/providers', { args: {} }, expect.any(AbortSignal))
    expect(rpc).toHaveBeenCalledTimes(9)
    await expect(ctx.remote.githubCopilotDualModel.view()).resolves.toEqual({ ok: true, value: roleView })
    await expect(ctx.remote.githubCopilotDualModel.save({ configuration: roleView.configuration, expectedRevision: 2 }))
      .resolves.toEqual({ ok: true, value: roleView })
    await expect(ctx.remote.githubCopilotDualModel.create({ requestId: '00000000-0000-4000-8000-000000000001', workspaceId: 'workspace', expectedRevision: 2 }))
      .resolves.toEqual({ ok: true, value: created })
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
        expect(codec.create()).toBe(codec.schema)
      }
    }
    await dispose()
    expect(ctx.get('remote.githubCopilot')).toBeUndefined()
    expect(ctx.get('remote.githubCopilotDualModel')).toBeUndefined()
    expect(ctx.get('remote.githubCopilotSearchRouting')).toBeUndefined()
  } finally { await ctx.fiber.dispose() }
  expect(stop).toHaveBeenCalledOnce()
})
