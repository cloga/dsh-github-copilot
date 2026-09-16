import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { TypertRegistry } from '@deepseek-ai/dsh-typert-registry'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import { TypertGatewayService } from '@deepseek-ai/dsh-api-gateway'
import GitHubCopilotDualModel, { DUAL_MODEL_NAMESPACE } from '../../lib/types/dual-model-host.js'
import { GitHubCopilotAuthorizationController } from '../../lib/index.js'

// Postbuild Node tests deliberately bypass Vitest's protocol alias and its no-op
// Remote decorator. Drive the public Fetch handler, not a mocked rpc.call.
const configuration = { enabled: false, plannerModel: '', executorModel: '' }
const createInput = { requestId: '00000000-0000-4000-8000-000000000001', workspaceId: 'workspace-1', expectedRevision: 0 }

async function fixture(t, setup = () => {}) {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  new TypertRegistry(ctx)
  const connection = new HostConnectionService(ctx, [], {})
  new TypertGatewayService(ctx, { websocketHeartbeatIntervalMs: 30000 })
  setup(ctx)
  new GitHubCopilotAuthorizationController(ctx)
  const roles = ctx.plugin(GitHubCopilotDualModel)
  // Cordis dependency injections settle without a server, credentials or timers.
  await Promise.resolve(); await Promise.resolve()
  const handler = connection.createSharedFetchHandler('/api')
  let sequence = 0
  async function call(endpoint, args = {}) {
    const rpcId = `fixture-${++sequence}`
    const response = await handler.fetch(new Request(`http://fixture.invalid/api/${endpoint}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId, method: endpoint, payload: { args } }),
    }))
    const text = await response.text()
    assert.equal(response.status, 200, `${endpoint}: HTTP ${response.status}: ${text}`)
    const envelope = JSON.parse(text)
    assert.equal(envelope.type, 'server-response')
    assert.equal(envelope.rpcId, rpcId)
    return envelope.result
  }
  async function absent(method) {
    const endpoint = `githubCopilotDualModel/${method}`
    const response = await handler.fetch(new Request(`http://fixture.invalid/api/${endpoint}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: `fixture-${++sequence}`, method: endpoint, payload: { args: {} } }),
    }))
    assert.equal(response.status, 404, endpoint)
  }
  return { ctx, roles, call, absent }
}

function domainError(result, reason) {
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'copilot/dual-model')
  assert.equal(result.error.details.reason, reason)
}

test('built Host exposes roles through the real Gateway without optional capabilities', async t => {
  const f = await fixture(t)
  const result = await f.call('githubCopilotDualModel/view')
  assert.equal(result.ok, true)
  assert.deepEqual(result.value, { supported: false, diagnostic: 'DUAL_MODEL_UNSUPPORTED', writable: false, revision: null, configuration, models: [], workspaces: [] })
  domainError(await f.call('githubCopilotDualModel/save', { input: { configuration, expectedRevision: 0 } }), 'DUAL_MODEL_UNSUPPORTED')
  domainError(await f.call('githubCopilotDualModel/create', { input: createInput }), 'DUAL_MODEL_UNSUPPORTED')
  assert.equal((await f.call('githubCopilot/migrationStatus')).ok, true)
})

test('Host validates nested inputs even when Gateway uses SRC JSON fallback', async t => {
  const f = await fixture(t)
  for (const input of [
    { configuration: { ...configuration, injected: true }, expectedRevision: 0 },
    { configuration: { ...configuration, enabled: 'yes' }, expectedRevision: 0 },
    { configuration, expectedRevision: -1 },
    { configuration, expectedRevision: 0.5 },
  ]) domainError(await f.call('githubCopilotDualModel/save', { input }), 'DUAL_MODEL_INVALID_REQUEST')
  for (const input of [
    { ...createInput, requestId: 'not-a-uuid' },
    { ...createInput, workspaceId: '' },
    { ...createInput, expectedRevision: -1 },
    { ...createInput, unexpected: true },
  ]) domainError(await f.call('githubCopilotDualModel/create', { input }), 'DUAL_MODEL_INVALID_REQUEST')
  const wrongArgument = await f.call('githubCopilotDualModel/save', { request: { configuration, expectedRevision: 0 } })
  assert.equal(wrongArgument.ok, false)
  assert.equal(wrongArgument.error.code, 'gateway/arguments-invalid')
})

test('private methods stay unreachable and role disposal preserves authorization', async t => {
  const f = await fixture(t)
  assert.equal((await f.call('githubCopilotDualModel/view')).ok, true)
  await f.absent('saveOnce')
  await f.absent('capabilities')
  await f.absent('unknown')
  await f.roles.dispose()
  for (const method of ['view', 'save', 'create']) await f.absent(method)
  assert.equal((await f.call('githubCopilot/migrationStatus')).ok, true)
})

// Synthetic optional services own only in-memory state. No real settings, Agent,
// Session, workspace files, model provider, OAuth or network is used here.
function supportedServices(ctx) {
  let value = { ...configuration }, revision = 0
  const writes = [], discoveries = []
  const models = [{ id: 'plan-fixture', name: 'Planning fixture' }, { id: 'exec-fixture', name: 'Execution fixture' }]
  const preview = { provider: 'github-copilot-preview', available: true, state: 'ready', models }
  const unexpected = () => assert.fail('Gateway view/save must not create or modify a Session')
  const settings = { writable: true, register() {}, describe: () => [{ ns: DUAL_MODEL_NAMESPACE, revision, value }],
    async replace(ns, next, expected) {
      assert.equal(ns, DUAL_MODEL_NAMESPACE)
      assert.equal(expected, revision)
      writes.push({ ns, next, expected }); value = { ...next }; revision++
    } }
  ctx.provide('settings', settings)
  ctx.provide('sessionProjections', { register: () => () => {}, stateOf: unexpected })
  ctx.provide('agents', { list: () => [], get: unexpected, create: unexpected, resume: unexpected })
  ctx.provide('workspaceRegistry', { list: () => [{ id: 'workspace-1', title: 'Fixture project' }], get: unexpected })
  ctx.provide('sessionPersistence', { stat: unexpected })
  ctx.provide('sessions', { flush: unexpected })
  ctx.provide('sessionController', { inspect: unexpected })
  ctx.provide('agentPresets', { resolve: unexpected, mount: unexpected, composedPreset: unexpected, standingKeyFor: unexpected })
  ctx.provide('llm', { resolveCallConfig: async route => route })
  ctx.provide('tools', { register: unexpected, restrict: unexpected, guard: () => () => {}, schemas: unexpected, presentAs: unexpected })
  ctx.provide('subagents', { getProvider: () => ({ capabilities: { agentOptions: true, persona: true, toolFilter: true, depthLimit: true }, prepareContinuable() {} }),
    startContinuable: unexpected, sendMessage: unexpected, listChildren: unexpected, drainContinuableDescendants: async () => {} })
  ctx.provide('githubCopilotPreview', { getView: () => preview, discover: async options => { discoveries.push(options); return preview } })
  return { settings, writes, discoveries, models }
}

test('Gateway returns model/workspace choices while off and saves with namespace CAS', async t => {
  let state
  const f = await fixture(t, ctx => { state = supportedServices(ctx) })
  const view = await f.call('githubCopilotDualModel/view')
  assert.equal(view.ok, true)
  assert.deepEqual(view.value, { supported: true, writable: true, revision: 0, configuration, models: state.models, workspaces: [{ id: 'workspace-1', name: 'Fixture project' }] })
  assert.equal(state.writes.length, 0)
  const enabled = { enabled: true, plannerModel: 'plan-fixture', executorModel: 'exec-fixture' }
  const saved = await f.call('githubCopilotDualModel/save', { input: { configuration: enabled, expectedRevision: 0 } })
  assert.equal(saved.ok, true)
  assert.equal(saved.value.revision, 1)
  assert.deepEqual(saved.value.configuration, enabled)
  assert.deepEqual(state.writes, [{ ns: DUAL_MODEL_NAMESPACE, next: enabled, expected: 0 }])
  domainError(await f.call('githubCopilotDualModel/save', { input: { configuration, expectedRevision: 0 } }), 'DUAL_MODEL_REVISION_CONFLICT')
  state.settings.writable = false
  domainError(await f.call('githubCopilotDualModel/save', { input: { configuration, expectedRevision: 1 } }), 'DUAL_MODEL_READ_ONLY')
  assert.equal(state.writes.length, 1)
  assert.ok(state.discoveries.length > 0)
  assert.ok(state.discoveries.every(options => options.force === false && options.signal instanceof AbortSignal))
})
