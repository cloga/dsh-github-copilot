/** Actual tagged Core gateways with in-process transport; no live profile or network. */
import { Context } from '@deepseek-ai/cordis'
import * as Gateway from '@deepseek-ai/dsh-api-gateway/client'
import { TypertGatewayService } from '@deepseek-ai/dsh-api-gateway'
import { TypertRegistry } from '@deepseek-ai/dsh-typert-registry'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import { TurnSelectionController } from '../../src/turn-selection-host.ts'
import { TurnSelectionStore } from '../../src/turn-selection.ts'
import { it, expect, vi } from 'vitest'
import remote from '../../src/remote.ts'
import selectionRemote from '../../src/turn-selection-remote.ts'
import recoveryRemote from '../../src/replay-recovery-remote.ts'
import { ReplayRecoveryController } from '../../src/replay-recovery-host.ts'
import { ReplayRecoveryStore } from '../../src/replay-recovery.ts'
import { name, version } from '#package.json' with { type: 'json' }
import sessionAccountRemote from '../../src/session-accounts-remote.ts'
import { SessionAccountController } from '../../src/session-accounts-controller.ts'
import { SessionAccountsHost } from '../../src/session-accounts-host.ts'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { CopilotAccountsHost } from '../../src/copilot-accounts-host.ts'

it.each(['source', 'strict'] as const)('binds Session account choices and historical reads through native Client and %s Host gateways', async mode => {
  const host = new Context(), client = new Context()
  const A = '11111111-1111-4111-8111-111111111111'
  const master = { id: 'account-master', session: { id: 'account-master' } }
  let revision = 1, preferences: unknown = []
  const accountHost = new CopilotAccountsHost(host, { routeDiagnostic: () => undefined })
  const owner = new SessionAccountsHost(host)
  try {
    const registry = new TypertRegistry(host)
    registry.lookups.register('agent', {
      parameter: 'agent', wire: 'agentId', hostTypeSymbol: '@deepseek-ai/dsh-agent#Agent',
      wireTypeSymbol: '@deepseek-ai/dsh-session/types#SessionId',
      resolve: id => { if (id === 'denied-master') throw new Error('Fixture access denied'); return id === master.id ? master : undefined },
    })
    if (mode === 'strict') registry.register({ package: sessionAccountRemote.package, face: 'host', schemas: [],
      model: { services: [], events: [], objects: [] }, invocations: sessionAccountRemote.descriptors })
    host.provide('settings', {
      describe: () => [{ ns: 'github-copilot', revision, value: { sessionAccounts: preferences } }],
      mutate: async (_ns: string, operations: readonly { path: string[]; value: unknown }[], expected: number) => {
        if (expected !== revision) throw new Error('Fixture CAS conflict')
        expect(operations[0]?.path).toEqual(['sessionAccounts'])
        preferences = operations[0]!.value; revision++
      },
    })
    host.provide('credentials', { listRecords: async () => [{ key: `github-copilot/account-${A}`, kind: 'grant' }] })
    host.provide('githubCopilotAccounts', { host: accountHost })
    host.provide('githubCopilotSessionAccounts', owner)
    const connection = new HostConnectionService(host, [], {})
    new TypertGatewayService(host, { websocketHeartbeatIntervalMs: 30000 })
    const handler = connection.createSharedFetchHandler('/api')
    let rpcId = 0
    client.provide('typert', { remotes: { register: () => () => {} }, contexts: { getClient: () => ({ identity: () => 'ambient-other' }) } })
    client.provide('connection', { rpc: { call: async (_path: string, method: string, payload: unknown) => {
      const response = await handler.fetch(new Request(`http://fixture.invalid/api/${method}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: `session-account-${++rpcId}`, method, payload }),
      }))
      return (await response.json()).result
    }, open: vi.fn() }, registerGenerationSource: () => () => {}, start: () => ({ stop: () => {} }),
    generation: { getSnapshot: () => undefined } })
    Gateway.apply(client)
    await client.remote.$mount(sessionAccountRemote)
    await host.plugin({ apply(ctx) { new SessionAccountController(ctx, owner) } })
    await expect(client.remote.githubCopilotSessionAccount.get(master.id)).resolves.toMatchObject({
      ok: true, value: { source: 'global', accountId: 'canonical', globalAccountId: 'canonical' },
    })
    await expect(client.remote.githubCopilotSessionAccount.set(master.id, A, 1)).resolves.toMatchObject({
      ok: true, value: { source: 'session', accountId: A, globalAccountId: 'canonical' },
    })
    const signal = new AbortController().signal
    owner.admit(master, 7, signal)
    owner.recordRequest(signal)
    owner.end(master.session, 7)
    await expect(client.remote.githubCopilotSessionAccount.set(master.id, null, 2)).resolves.toMatchObject({
      ok: true, value: { source: 'global', accountId: 'canonical' },
    })
    await expect(client.remote.githubCopilotSessionAccount.turn(master.id, 7)).resolves.toEqual({
      ok: true, value: { state: 'recorded', accountId: A, source: 'session' },
    })
    await expect(client.remote.githubCopilotSessionAccount.turn(master.id, 8)).resolves.toEqual({
      ok: true, value: { state: 'unknown' },
    })
    await expect(client.remote.githubCopilotSessionAccount.turn('missing-master', 7)).resolves.toMatchObject({
      ok: false, error: { code: 'gateway/lookup-not-found' },
    })
    await expect(client.remote.githubCopilotSessionAccount.get('denied-master')).resolves.toMatchObject({
      ok: false, error: { code: 'gateway/lookup-failed' },
    })
    if (mode === 'strict') await expect(client.remote.githubCopilotSessionAccount.set(master.id, 'bad-account', 3))
      .resolves.toMatchObject({ ok: false, error: { code: 'gateway/input-invalid' } })
  } finally { owner.dispose(); accountHost.dispose(); await client.fiber.dispose(); await host.fiber.dispose() }
})

it.each(['source', 'strict'] as const)('binds explicit replay recovery through native Client and %s Host gateways', async mode => {
  const host = new Context(), client = new Context()
  const store = new ReplayRecoveryStore(), busy = new WeakSet<object>()
  const agent = { id: 'recovery-owner', session: {} }
  try {
    const registry = new TypertRegistry(host)
    registry.lookups.register('agent', {
      parameter: 'agent', wire: 'agentId', hostTypeSymbol: '@deepseek-ai/dsh-agent#Agent',
      wireTypeSymbol: '@deepseek-ai/dsh-session/types#SessionId',
      resolve: id => id === agent.id ? agent : undefined,
    })
    if (mode === 'strict') registry.register({
      package: recoveryRemote.package, face: 'host', schemas: [],
      model: { services: [], events: [], objects: [] }, invocations: recoveryRemote.descriptors,
    })
    const connection = new HostConnectionService(host, [], {})
    new TypertGatewayService(host, { websocketHeartbeatIntervalMs: 30000 })
    const handler = connection.createSharedFetchHandler('/api')
    let sequence = 0
    client.provide('typert', { remotes: { register: () => () => {} },
      contexts: { getClient: () => ({ identity: () => 'unrelated-ambient-session' }) } })
    client.provide('connection', { rpc: { call: async (_path: string, method: string, payload: unknown) => {
      const response = await handler.fetch(new Request(`http://fixture.invalid/api/${method}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: `recovery-${++sequence}`, method, payload }),
      }))
      return (await response.json()).result
    }, open: vi.fn() }, registerGenerationSource: () => () => {}, start: () => ({ stop: () => {} }),
    generation: { getSnapshot: () => undefined } })
    Gateway.apply(client)
    await client.remote.$mount(recoveryRemote)
    new ReplayRecoveryController(host, store, () => 'proof', busy)
    store.recordFailure(agent.session, 'proof', 'synthetic-model', JSON.stringify({
      input: [{ type: 'reasoning', encrypted_content: 'synthetic-private', summary: [] }], store: false,
    }))
    const remote = client.remote.githubCopilotReplayRecovery
    const result = await remote.get(agent.id)
    expect(result).toMatchObject({ ok: true, value: { state: 'available', itemCount: 1 } })
    if (!result.ok || result.value.state === 'unavailable') throw new Error('missing recovery')
    expect(JSON.stringify(result)).not.toContain('synthetic-private')
    busy.add(agent.session)
    await expect(remote.setEnabled(agent.id, result.value.revision, true)).resolves.toMatchObject({ ok: false })
    await expect(remote.authorize(agent.id, result.value.revision, 'next-turn')).resolves.toMatchObject({ ok: false })
    busy.delete(agent.session)
    await expect(remote.setEnabled(agent.id, result.value.revision, true))
      .resolves.toMatchObject({ ok: true, value: { state: 'enabled' } })
    await expect(remote.authorize(agent.id, result.value.revision, 'next-turn'))
      .resolves.toMatchObject({ ok: true, value: { state: 'enabled', duration: 'next-turn' } })
    const payload = { input: [{ type: 'reasoning', encrypted_content: 'synthetic-private', summary: [] }], store: false }
    expect(store.prepare(agent.session, 'proof', 'synthetic-model', 7)(payload)).toEqual({ ...payload, input: [] })
    store.endTurn(agent.session, 7)
    await expect(remote.get(agent.id)).resolves.toMatchObject({ ok: true, value: { state: 'available' } })
    await expect(remote.authorize('missing', result.value.revision, 'session')).resolves.toMatchObject({ ok: false })
    await expect(remote.get('missing')).resolves.toMatchObject({ ok: false })
    await expect(remote.setEnabled(agent.id, '00000000-0000-4000-8000-000000000001', false))
      .resolves.toMatchObject({ ok: false })
    store.clear()
    await expect(remote.get(agent.id)).resolves.toEqual({ ok: true, value: { state: 'unavailable' } })
  } finally { await client.fiber.dispose(); await host.fiber.dispose() }
})

it.each(['source', 'strict'] as const)('reads retained selection through actual Client and %s Host gateways', async mode => {
  expect(process.env.DSH_CORE_EVIDENCE).toBe('tagged-source-runtime')
  const host = new Context(), client = new Context()
  const store = new TurnSelectionStore()
  await host.plugin(SessionStore)
  await host.plugin(SessionProjectionRegistry)
  const master = { id: 'viewed-master', session: host.sessions.create() }
  const denied = new Error('fixture access denied')
  const resolve = vi.fn((id: string) => {
    if (id === 'denied-master') throw denied
    return id === master.id ? master : undefined
  })
  try {
    const registry = new TypertRegistry(host)
    registry.lookups.register('agent', {
      parameter: 'agent', wire: 'agentId',
      hostTypeSymbol: '@deepseek-ai/dsh-agent#Agent',
      wireTypeSymbol: '@deepseek-ai/dsh-session/types#SessionId',
      resolve,
    })
    if (mode === 'strict') registry.register({
      package: selectionRemote.package, face: 'host', schemas: [],
      model: { services: [], events: [], objects: [] }, invocations: selectionRemote.descriptors,
    })
    const connection = new HostConnectionService(host, [], {})
    const gateway = new TypertGatewayService(host, { websocketHeartbeatIntervalMs: 30000 })
    const handler = connection.createSharedFetchHandler('/api')
    let rpcId = 0
    const rpc = vi.fn(async (_path: string, method: string, payload: unknown) => {
      const response = await handler.fetch(new Request(`http://fixture.invalid/api/${method}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: `selection-${++rpcId}`, method, payload }),
      }))
      if (response.status !== 200) throw new Error(`Fixture carrier HTTP ${response.status}`)
      return (await response.json()).result
    })
    client.provide('typert', {
      remotes: { register: () => () => {} },
      contexts: { getClient: () => ({ identity: () => 'ambient-other-session' }) },
    })
    client.provide('connection', { rpc: { call: rpc, open: vi.fn() },
      registerGenerationSource: () => () => {}, start: () => ({ stop: () => {} }),
      generation: { getSnapshot: () => undefined } })
    Gateway.apply(client)
    await client.remote.$mount(selectionRemote)

    const legacyRead = vi.fn(() => ({ mode: 'manual' }))
    const legacy = await host.plugin({ apply(ctx) {
      ctx.provide('githubCopilotTurnSelection', { get: legacyRead })
    } })
    await expect(gateway.invoke({ namespace: 'githubCopilotTurnSelection', method: 'get',
      args: { agentId: master.id, turn: 7 } })).rejects.toMatchObject({
      code: mode === 'strict' ? 'gateway/binding-invalid' : 'gateway/invocation-unavailable',
    })
    expect(legacyRead).not.toHaveBeenCalled()
    await legacy.dispose()

    const owner = await host.plugin({ apply(ctx) { new TurnSelectionController(ctx, store) } })
    master.session.append('turn/start', { turn: 7 })
    master.session.append('step/start', { turn: 7, step: 1 })
    master.session.append('request/header', { header: { config: { provider: 'github-copilot-preview', model: 'fixture-request' } }, reason: 'initial' })
    master.session.append('step/end', { turn: 7, step: 1 })
    master.session.append('turn/end', { turn: 7, reason: { kind: 'completed' } })
    await expect(client.remote.githubCopilotTurnSelection.requestedModels(master.id, 7))
      .resolves.toEqual({ ok: true, value: { routes: [{ provider: 'github-copilot-preview', model: 'fixture-request' }], incomplete: false } })
    await expect(client.remote.githubCopilotTurnSelection.requestedModels(master.id, 8))
      .resolves.toEqual({ ok: true, value: { routes: [], incomplete: true } })
    await expect(client.remote.githubCopilotTurnSelection.requestedModels('missing-master', 7))
      .resolves.toMatchObject({ ok: false, error: { code: 'gateway/lookup-not-found' } })
    await expect(client.remote.githubCopilotTurnSelection.requestedModels('denied-master', 7))
      .resolves.toMatchObject({ ok: false, error: { code: 'gateway/lookup-failed' } })
    const auto = { mode: 'auto', preference: 'balance', reason: 'standard-turn', candidateCount: 2 } as const
    store.record(master, 7, auto)
    store.record(master, 8, { mode: 'manual' })
    await expect(client.remote.githubCopilotTurnSelection.get(master.id, 7))
      .resolves.toEqual({ ok: true, value: auto })
    await expect(client.remote.githubCopilotTurnSelection.get(master.id, 8))
      .resolves.toEqual({ ok: true, value: { mode: 'manual' } })
    await expect(client.remote.githubCopilotTurnSelection.get(master.id, 9))
      .resolves.toEqual({ ok: true, value: { mode: 'unknown' } })
    await expect(client.remote.githubCopilotTurnSelection.get('missing-master', 7))
      .resolves.toMatchObject({ ok: false, error: { code: 'gateway/lookup-not-found' } })
    await expect(client.remote.githubCopilotTurnSelection.get('denied-master', 7))
      .resolves.toMatchObject({ ok: false, error: { code: 'gateway/lookup-failed' } })
    expect(resolve.mock.calls.some(([id]) => id === 'ambient-other-session')).toBe(false)
    store.remove(master)
    await expect(client.remote.githubCopilotTurnSelection.get(master.id, 7))
      .resolves.toEqual({ ok: true, value: { mode: 'unknown' } })
    await owner.dispose()
    await expect(client.remote.githubCopilotTurnSelection.get(master.id, 7))
      .resolves.toMatchObject({ ok: false, error: {
        code: mode === 'strict' ? 'gateway/service-unavailable' : 'gateway/internal',
      } })
  } finally { await client.fiber.dispose(); await host.fiber.dispose() }
})

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

it('mounts authorization, account, role and search-catalog Remotes on the exact target Client gateway', async () => {
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
  const accounts = {
    state: 'ready', activeAccountId: 'canonical', revision: 2, writable: true, switchable: true,
    accounts: [{ id: 'canonical', configured: true, identityState: 'ready', identity: { userId: 1, login: 'demo-user' } }],
    notices: [],
  }
  const roleView = { supported: false, writable: false, revision: 2, diagnostic: 'DUAL_MODEL_RETIRED',
    configuration: { enabled: true, plannerModel: 'planner', executorModel: 'executor' }, models: [], workspaces: [] }
  const recovered = { sessionId: 'synthetic-existing-role-root' }
  const retiredError = { code: 'copilot/dual-model', message: 'DUAL_MODEL_RETIRED', details: { reason: 'DUAL_MODEL_RETIRED' } }
  const rpc = vi.fn(async (_path: string, method: string) => method === 'githubCopilotDualModel/save'
    ? { ok: false, error: retiredError } : { ok: true,
      value: method.startsWith('githubCopilotAccounts/') ? accounts : method.startsWith('githubCopilotUsage/') ? usage : method.endsWith('/migrationStatus') ? migration : method === 'githubCopilotSearchRouting/providers' ? catalog
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
    expect(remote.descriptors.filter(item => item.namespace !== 'githubCopilotAccounts').map(item => item.method)).toEqual([
      'status', 'reconcile', 'discoverModels', 'ensureModels', 'start', 'cancel', 'signOut',
      'excludeModel', 'restoreModel', 'setModelExcluded', 'migrationStatus',
      'view', 'save', 'create', 'providers', 'get', 'refresh', 'get', 'get', 'authorize', 'setEnabled',
      'get', 'set', 'refreshIdentity', 'usage', 'refreshUsage', 'turn',
    ])
    for (const descriptor of remote.descriptors.filter(item => item.namespace === 'githubCopilot' && item.method !== 'setModelExcluded')) {
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
    const accountDescriptors = remote.descriptors.filter(item => item.namespace === 'githubCopilotAccounts')
    expect(accountDescriptors.map(item => item.method).sort()).toEqual([
      'add', 'cancel', 'get', 'reauthorize', 'refreshIdentity', 'removeAccount', 'switchAccount',
    ])
    for (const descriptor of accountDescriptors) {
      expect(descriptor.invocation).toEqual({ kind: 'direct' })
      expect(descriptor.result.create().parse(accounts)).toEqual(accounts)
      expect(() => descriptor.result.create().parse({ ...accounts, credential: 'synthetic-forbidden' })).toThrow()
      expect(() => descriptor.result.create().parse({ ...accounts, accounts: [{
        ...accounts.accounts[0], grant: 'synthetic-forbidden',
      }] })).toThrow()
      const method = ctx.remote.githubCopilotAccounts[descriptor.method]
      const parameterized = ['switchAccount', 'removeAccount', 'reauthorize'].includes(descriptor.method)
      const accountId = '00000000-0000-4000-8000-000000000001'
      if (parameterized) {
        expect(descriptor.parameters).toHaveLength(2)
        expect(descriptor.parameters[0]?.codec.create().parse(accountId)).toBe(accountId)
        expect(() => descriptor.parameters[0]?.codec.create().parse('unrecognized-account')).toThrow()
        expect(descriptor.parameters[1]?.codec.create().parse(2)).toBe(2)
        expect(() => descriptor.parameters[1]?.codec.create().parse(-1)).toThrow()
      } else expect(descriptor.parameters).toEqual([])
      await expect(parameterized ? method(accountId, 2) : method()).resolves.toEqual({ ok: true, value: accounts })
      expect(rpc).toHaveBeenLastCalledWith('/api', `githubCopilotAccounts/${descriptor.method}`,
        { args: parameterized ? { accountId, expectedRevision: 2 } : {} }, expect.any(AbortSignal))
    }
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
    const preferenceDescriptor = remote.descriptors.find(item => item.method === 'setModelExcluded')!
    const preferences = { state: 'ready', writable: true, revision: 1,
      excludedModelIds: ['gpt-5.4'], lockedModelIds: [], unavailableExcludedModelIds: [] }
    expect(preferenceDescriptor.result.create().parse(preferences)).toEqual(preferences)
    expect(() => preferenceDescriptor.result.create().parse({ ...preferences, credential: 'forbidden' })).toThrow()
    expect(preferenceDescriptor.parameters[1]?.codec.create().parse(false)).toBe(false)
    expect(() => preferenceDescriptor.parameters[1]?.codec.create().parse('false')).toThrow()
    rpc.mockResolvedValueOnce({ ok: true, value: preferences })
    await expect(ctx.remote.githubCopilot.setModelExcluded('gpt-5.4', true)).resolves.toEqual({ ok: true, value: preferences })
    expect(rpc).toHaveBeenLastCalledWith('/api', 'githubCopilot/setModelExcluded',
      { args: { modelId: 'gpt-5.4', excluded: true } }, expect.any(AbortSignal))
    await dispose()
    expect(ctx.get('remote.githubCopilot')).toBeUndefined()
    expect(ctx.get('remote.githubCopilotDualModel')).toBeUndefined()
    expect(ctx.get('remote.githubCopilotSearchRouting')).toBeUndefined()
    expect(ctx.get('remote.githubCopilotUsage')).toBeUndefined()
    expect(ctx.get('remote.githubCopilotAccounts')).toBeUndefined()
  } finally { await ctx.fiber.dispose() }
  expect(stop).toHaveBeenCalledOnce()
})
