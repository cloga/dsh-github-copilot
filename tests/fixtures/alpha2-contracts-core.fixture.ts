/** Exact alpha.2 public contracts; no Core edits, disk writes or real credentials. */
import { Context } from '@deepseek-ai/cordis'
import { SessionId, SessionSeq, SessionLogOffset, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { snapshotSubagentDescriptor, foldSubagentDescriptor, SUBAGENT_DESCRIPTOR_VERSION } from '@deepseek-ai/dsh-subagent'
import { WebRuntime } from '@deepseek-ai/dsh-web'
import { TypertRegistry } from '@deepseek-ai/dsh-typert-registry'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import { TypertGatewayService } from '@deepseek-ai/dsh-api-gateway'
import GitHubCopilotDualModel from '../../src/dual-model-host.ts'
import { describe, expect, it, beforeAll } from 'vitest'
import { dualModelProjection, DUAL_MODEL_PROJECTION } from '../../src/dual-model-host.ts'
import CopilotRoutedWeb from '../../src/routed-web.ts'
import * as WebDelegate from '../../src/web-delegate.ts'
import remote from '../../src/remote.ts'

beforeAll(() => {
  expect(process.env.DSH_CORE_EVIDENCE).toBe('tagged-source-runtime')
  expect(process.env.DSH_PUBLISHED_CORE_RELEASE).toBe('0.1.6-alpha.2')
})
const header = { id: SessionId('native-child'), version: SESSION_FORMAT_VERSION, createdAt: 1, isSeeded: false,
  parentSession: SessionId('native-parent'), origin: 'subagent' }
function event(data: unknown) { return { type: 'subagent/descriptor', seq: SessionSeq(0), time: 1, data } }

describe('exact official alpha.2 role and search contracts', () => {
  it('accepts the real official v3 descriptor and refolds an obsolete cached role projection', async () => {
    const ctx = new Context()
    try {
      const projections = new SessionProjectionRegistry(ctx)
      projections.register(dualModelProjection)
      expect(SUBAGENT_DESCRIPTOR_VERSION).toBe(3)
      const descriptor = snapshotSubagentDescriptor({ mode: 'continuable', provider: 'spawn', label: 'execute',
        agentProvider: 'github-copilot-preview', agentModel: 'new-account-model', persona: 'executor', toolFilter: { allow: ['read'] } })
      const events = [event(descriptor)]
      expect(foldSubagentDescriptor(events)).toMatchObject({ version: 3, agentModel: 'new-account-model' })
      const old = { [DUAL_MODEL_PROJECTION]: { ver: 1, seq: SessionSeq(0), val: { ...dualModelProjection.init(header), child: null } } }
      expect(projections.restoreFloor(old)).toBe(0)
      const restored = projections.restore(old, events, SessionLogOffset(0), header, SessionLogOffset(0))
      expect(restored.checkpoint[DUAL_MODEL_PROJECTION]).toMatchObject({ ver: 2, val: { invalid: false, child: { version: 3, agentModel: 'new-account-model' } } })
      expect(descriptor).toHaveProperty('label', 'execute') // Projection never rewrites durable input.
    } finally { await ctx.fiber.dispose() }
  })
  it.each([1, 2, 4])('refuses unsupported child history v%s just as the official descriptor reader does', version => {
    const descriptor = { version, mode: 'continuable', provider: 'spawn', label: 'old', agentProvider: 'github-copilot-preview', agentModel: 'exec' }
    expect(foldSubagentDescriptor([event(descriptor)])).toBeUndefined()
    const state = dualModelProjection.apply(dualModelProjection.init(header), event(descriptor))
    expect(state).toMatchObject({ child: null, invalid: true })
    expect(descriptor.version).toBe(version)
  })
  it('registers all plugin descriptors in the actual strict-factory registry and rejects legacy-only codecs', async () => {
    const ctx = new Context()
    try {
      const registry = new TypertRegistry(ctx)
      const legacy = { ...remote, descriptors: remote.descriptors.map(descriptor => ({ ...descriptor,
        result: { mode: 'strict', typeSymbol: 'fixture#Legacy', schema: { parse: (value: unknown) => value } },
      })) }
      expect(() => registry.remotes.register(legacy)).toThrow('create() factory')
      const dispose = registry.remotes.register(remote)
      expect(registry.remotes.list()).toHaveLength(remote.descriptors.length)
      await dispose()
      expect(registry.remotes.list()).toHaveLength(0)
    } finally { await ctx.fiber.dispose() }
  })
  it('decodes strict role inputs through the actual Host Gateway factories and withdraws on unload', async () => {
    const ctx = new Context()
    try {
      const registry = new TypertRegistry(ctx)
      // Explicit test contribution exercises the Host strict-codec contract;
      // production source fallback still retains the service's own validation.
      registry.register({ package: remote.package, face: 'host', schemas: [],
        model: { services: [], events: [], objects: [] }, invocations: remote.descriptors })
      const connection = new HostConnectionService(ctx, [], {})
      new TypertGatewayService(ctx, { websocketHeartbeatIntervalMs: 30000 })
      const roles = await ctx.plugin(GitHubCopilotDualModel)
      const handler = connection.createSharedFetchHandler('/api')
      let sequence = 0
      async function call(method: string, args = {}) {
        const endpoint = `githubCopilotDualModel/${method}`
        const response = await handler.fetch(new Request(`http://fixture.invalid/api/${endpoint}`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'client-request', rpcId: `strict-${++sequence}`, method: endpoint, payload: { args } }),
        }))
        expect(response.status).toBe(200)
        return (await response.json()).result
      }
      expect(await call('view')).toMatchObject({ ok: true, value: { supported: false, diagnostic: 'DUAL_MODEL_RETIRED' } })
      const configuration = { enabled: false, plannerModel: '', executorModel: '' }
      expect(await call('save', { input: { configuration, expectedRevision: 0 } }))
        .toMatchObject({ ok: false, error: { code: 'copilot/dual-model', details: { reason: 'DUAL_MODEL_RETIRED' } } })
      expect(await call('save', { input: { configuration: { ...configuration, credential: 'forbidden' }, expectedRevision: 0 } }))
        .toMatchObject({ ok: false, error: { code: 'gateway/input-invalid' } })
      expect(await call('create', { input: { requestId: 'invalid', workspaceId: 'workspace', expectedRevision: 0 } }))
        .toMatchObject({ ok: false, error: { code: 'gateway/input-invalid' } })
      await roles.dispose()
      expect(ctx.get('githubCopilotDualModel')).toBeUndefined()
    } finally { await ctx.fiber.dispose() }
  })
  it('requires create factories on every exact-target strict Remote boundary', () => {
    for (const descriptor of remote.descriptors) {
      for (const codec of [descriptor.result, ...descriptor.parameters.map(value => value.codec)]) {
        expect(codec.mode).toBe('strict')
        expect(codec.create).toBeTypeOf('function')
        expect(codec.create().parse).toBeTypeOf('function')
      }
    }
  })
  it('keeps public provider registration reversible across runtime unload without changing Core', async () => {
    const ctx = new Context()
    try {
      const isolated = ctx.isolate('web', Symbol('original-web'))
      await isolated.plugin(WebRuntime, { searchProvider: 'fixture-provider' })
      await isolated.plugin(WebDelegate)
      await ctx.plugin(CopilotRoutedWeb)
      const provider = await ctx.plugin({ inject: ['web'], apply(owner) {
        owner.web.registerSearchProvider({ id: 'fixture-provider', available: () => true,
          search: async () => ({ sources: [{ url: 'https://example.com' }], truncated: false }) })
      } })
      expect((await ctx.web.search({ query: 'before unload' })).sources).toHaveLength(1)
      await provider.dispose()
      await expect(ctx.web.search({ query: 'after unload' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_CONFIGURED_MISSING' })
    } finally { await ctx.fiber.dispose() }
  })
})
