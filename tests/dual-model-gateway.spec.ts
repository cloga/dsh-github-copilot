// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import * as Cordis from '@deepseek-ai/cordis'
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { afterEach, describe, expect, it, vi } from 'vitest'
import contribution from '../src/dual-model-remote.ts'
import type { DualModelView } from '../src/dual-model-types.ts'

// Node resolution deliberately bypasses the unit-suite's Typert stub alias.
// Both error ownership and Client rebuilding use the unchanged installed package.
const { RemoteError, remoteErrorOf } = createRequire(import.meta.url)('@deepseek-ai/dsh-typert-protocol') as typeof import('@deepseek-ai/dsh-typert-protocol')

interface Handoff {
  id: string
  factory(require: (specifier: string) => unknown): Record<string, unknown>
}
interface ModuleLoaderWindow { __ModuleLoader__?: { load(value: Handoff): void } }
interface WireResult { ok: boolean; value?: unknown; error?: unknown }
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  delete (window as ModuleLoaderWindow).__ModuleLoader__
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

const requestId = 'a813e2a1-3a88-4e10-9cde-e8880e69abf0'
const configuration = { enabled: true, plannerModel: 'account-planner', executorModel: 'account-executor' }
const validView: DualModelView = {
  supported: true, writable: true, revision: 7, configuration,
  models: [{ id: 'account-planner', name: 'Account planner' }, { id: 'account-executor', name: 'Account executor' }],
  workspaces: [{ id: 'workspace-a', name: 'Workspace A' }],
}
const saveInput = { configuration, expectedRevision: 7 }
const createInput = { requestId, workspaceId: 'workspace-a', expectedRevision: 7 }

/** Execute the unchanged installed Client carrier, not a mock gateway or plugin build. */
function gatewayArtifact() {
  const source = readFileSync(resolve('node_modules/@deepseek-ai/dsh-api-gateway/lib/client.js'), 'utf8')
  let handoff: Handoff | undefined
  ;(window as ModuleLoaderWindow).__ModuleLoader__ = { load(value) { handoff = value } }
  new Function(source)()
  expect(handoff?.id).toBe('@deepseek-ai/dsh-api-gateway')
  return handoff!.factory(specifier => {
    if (specifier !== '@deepseek-ai/cordis') throw new Error(`unexpected gateway import: ${specifier}`)
    return Cordis
  })
}
async function fixture() {
  const ctx = new Cordis.Context()
  const unregister = vi.fn(async () => undefined)
  const registrations: TypertRemoteContribution[] = []
  const rpcCall = vi.fn(async (_path: string, _endpoint: string, _payload: unknown, _signal: AbortSignal): Promise<WireResult> => ({ ok: true, value: validView }))
  ctx.provide('typert', {
    remotes: { register(value: TypertRemoteContribution) { registrations.push(value); return unregister } },
    contexts: { getClient: () => undefined },
  })
  ctx.provide('connection', {
    rpc: { call: rpcCall }, registerGenerationSource: () => () => undefined,
    start: () => ({ stop() {} }), generation: { getSnapshot: () => undefined },
  })
  const gateway = gatewayArtifact()
  expect(gateway.apply).toBeTypeOf('function')
  ;(gateway.apply as (ctx: Cordis.Context) => void)(ctx)
  cleanups.push(async () => { await ctx.fiber.dispose() })
  const dispose = await ctx.remote.$mount(contribution)
  const remote = ctx.remote.githubCopilotDualModel
  cleanups.push(dispose)
  return { ctx, rpcCall, registrations, unregister, remote, dispose }
}
function resultSchema(method: string) {
  const descriptor = contribution.descriptors.find(item => item.method === method)
  if (!descriptor || descriptor.result.mode !== 'strict') throw new Error('expected strict result descriptor')
  return descriptor.result.schema
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

describe('dual-model contribution through the installed rc.1 Client gateway', () => {
  it('mounts only the fixed namespace and registers the independent strict contribution', async () => {
    const f = await fixture()
    expect(f.registrations).toEqual([contribution])
    expect(contribution.package).toBe('dsh-github-copilot')
    expect(contribution.descriptors.map(item => item.method)).toEqual(['view', 'save', 'create'])
    for (const descriptor of contribution.descriptors) {
      expect(descriptor).toMatchObject({
        id: `dsh-github-copilot:githubCopilotDualModel.${descriptor.method}`,
        namespace: 'githubCopilotDualModel', service: 'githubCopilotDualModel', invocation: { kind: 'direct' },
        result: { mode: 'strict' },
      })
      expect(descriptor.scope).toBeUndefined()
    }
    expect(f.ctx.get('remote.githubCopilot')).toBeUndefined()
    expect(f.rpcCall).not.toHaveBeenCalled()
  })

  it('carries view with no arguments and keeps the published Host result codec available', async () => {
    const f = await fixture()
    const result = await f.remote.view()
    expect(result).toEqual({ ok: true, value: validView })
    expect(f.rpcCall).toHaveBeenCalledExactlyOnceWith('/api', 'githubCopilotDualModel/view', { args: {} }, expect.any(AbortSignal))
    expect(resultSchema('view').parse(result.ok ? result.value : undefined)).toEqual(validView)
  })

  it('retains legacy save encoding under input with exact model IDs and revision', async () => {
    const f = await fixture()
    const saved = { ...validView, revision: 8 }
    f.rpcCall.mockResolvedValueOnce({ ok: true, value: saved })
    const result = await f.remote.save(saveInput)
    expect(result).toEqual({ ok: true, value: saved })
    expect(resultSchema('save').parse(result.ok ? result.value : undefined)).toEqual(saved)
    expect(f.rpcCall).toHaveBeenCalledExactlyOnceWith('/api', 'githubCopilotDualModel/save', { args: { input: saveInput } }, expect.any(AbortSignal))
    const payload = f.rpcCall.mock.calls[0]![2] as { args: { input: typeof saveInput } }
    expect(payload.args.input).not.toBe(saveInput)
    expect(payload.args.input.configuration).not.toBe(configuration)
    expect(payload.args.input.configuration).toEqual(configuration)
  })

  it('carries retirement view and refusals through the unchanged strict contracts', async () => {
    const f = await fixture()
    const retired = { ...validView, supported: false, writable: false, diagnostic: 'DUAL_MODEL_RETIRED', models: [], workspaces: [] }
    f.rpcCall.mockResolvedValueOnce({ ok: true, value: retired })
    expect(await f.remote.view()).toEqual({ ok: true, value: retired })
    expect(resultSchema('view').parse(retired)).toEqual(retired)
    const reason = 'DUAL_MODEL_RETIRED'
    f.rpcCall.mockResolvedValueOnce({ ok: false, error: new RemoteError('copilot/dual-model', reason, { reason }) })
    expect(await f.remote.save(saveInput)).toMatchObject({ ok: false, error: { code: 'copilot/dual-model', details: { reason } } })
    f.rpcCall.mockResolvedValueOnce({ ok: false, error: new RemoteError('copilot/dual-model', reason, { reason, creation: 'not-created' }) })
    expect(await f.remote.create(createInput)).toMatchObject({ ok: false, error: { code: 'copilot/dual-model', details: { reason, creation: 'not-created' } } })
  })

  it('encodes create with the same UUID, explicit workspace and expected revision on a manual retry', async () => {
    const f = await fixture()
    f.rpcCall.mockResolvedValue({ ok: true, value: { sessionId: 'session-created' } })
    for (let index = 0; index < 2; index++) {
      const result = await f.remote.create(createInput)
      expect(result).toEqual({ ok: true, value: { sessionId: 'session-created' } })
      expect(resultSchema('create').parse(result.ok ? result.value : undefined)).toEqual({ sessionId: 'session-created' })
    }
    expect(f.rpcCall).toHaveBeenCalledTimes(2)
    for (const call of f.rpcCall.mock.calls) {
      expect(call).toEqual(['/api', 'githubCopilotDualModel/create', { args: { input: createInput } }, expect.any(AbortSignal)])
    }
  })

  it('retains legacy encoding of disabled configuration and revision zero', async () => {
    const f = await fixture()
    const input = { configuration: { enabled: false, plannerModel: '', executorModel: '' }, expectedRevision: 0 }
    await f.remote.save(input)
    expect(f.rpcCall).toHaveBeenCalledWith('/api', 'githubCopilotDualModel/save', { args: { input } }, expect.any(AbortSignal))
  })

  const invalidSave: Array<[string, unknown]> = [
    ['missing input', undefined],
    ['unknown top-level key', { ...saveInput, secret: 'PRIVATE_INPUT' }],
    ['unknown configuration key', { ...saveInput, configuration: { ...configuration, fallbackModel: 'PRIVATE_INPUT' } }],
    ['manual acceptance model', { ...saveInput, configuration: { ...configuration, acceptanceModel: 'PRIVATE_INPUT' } }],
    ['missing revision', { configuration }],
    ['null revision', { ...saveInput, expectedRevision: null }],
    ['negative revision', { ...saveInput, expectedRevision: -1 }],
    ['fractional revision', { ...saveInput, expectedRevision: 1.5 }],
    ['unsafe revision', { ...saveInput, expectedRevision: Number.MAX_SAFE_INTEGER + 1 }],
    ['string revision', { ...saveInput, expectedRevision: '7' }],
    ['nonboolean enabled', { ...saveInput, configuration: { ...configuration, enabled: 'true' } }],
    ['oversized model ID', { ...saveInput, configuration: { ...configuration, plannerModel: 'x'.repeat(513) } }],
    ['nonstring model ID', { ...saveInput, configuration: { ...configuration, executorModel: 123 } }],
  ]
  it.each(invalidSave)('rejects invalid save %s before any transport call', async (_label, input) => {
    const f = await fixture()
    await expect(f.remote.save(input as never)).rejects.toThrow('githubCopilotDualModel/save rejected "input"')
    expect(f.rpcCall).not.toHaveBeenCalled()
  })

  const invalidCreate: Array<[string, unknown]> = [
    ['unknown top-level key', { ...createInput, namespace: 'other-user' }],
    ['missing request ID', { workspaceId: 'workspace-a', expectedRevision: 7 }],
    ['non-UUID request ID', { ...createInput, requestId: 'request-one' }],
    ['empty request ID', { ...createInput, requestId: '' }],
    ['empty workspace ID', { ...createInput, workspaceId: '' }],
    ['oversized workspace ID', { ...createInput, workspaceId: 'x'.repeat(513) }],
    ['nonstring workspace ID', { ...createInput, workspaceId: 7 }],
    ['missing revision', { requestId, workspaceId: 'workspace-a' }],
    ['negative revision', { ...createInput, expectedRevision: -1 }],
    ['fractional revision', { ...createInput, expectedRevision: 0.5 }],
    ['unsafe revision', { ...createInput, expectedRevision: Number.MAX_SAFE_INTEGER + 1 }],
    ['infinite revision', { ...createInput, expectedRevision: Number.POSITIVE_INFINITY }],
  ]
  it.each(invalidCreate)('rejects invalid create %s before any transport call', async (_label, input) => {
    const f = await fixture()
    await expect(f.remote.create(input as never)).rejects.toThrow('githubCopilotDualModel/create rejected "input"')
    expect(f.rpcCall).not.toHaveBeenCalled()
  })

  it.each([
    ['view', [{}]], ['save', []], ['save', [saveInput, 'extra']], ['create', []], ['create', [createInput, 'extra']],
  ] as const)('enforces exact argument count for %s', async (method, args) => {
    const f = await fixture()
    const invoke = f.remote[method] as (...values: unknown[]) => Promise<unknown>
    await expect(invoke(...args)).rejects.toThrow('expected')
    expect(f.rpcCall).not.toHaveBeenCalled()
  })

  it('rebuilds the stable RemoteError code and reason but drops top-level private error fields', async () => {
    const f = await fixture()
    const reason = 'DUAL_MODEL_REVISION_CONFLICT'
    const ownerError = new RemoteError('copilot/dual-model', reason, { reason }, { cause: new Error('PRIVATE_CAUSE') })
    f.rpcCall.mockResolvedValueOnce({ ok: false, error: Object.assign(ownerError, { secret: 'PRIVATE_SECRET', headers: { authorization: 'PRIVATE_AUTH' } }) })
    const result = await f.remote.save(saveInput)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected a Remote failure')
    expect(remoteErrorOf(result.error)).toMatchObject({ code: 'copilot/dual-model', message: reason, details: { reason } })
    expect(result.error).not.toBe(ownerError)
    expect(result.error).toBeInstanceOf(Error)
    expect(result.error).not.toHaveProperty('cause')
    expect(result.error).not.toHaveProperty('secret')
    expect(result.error).not.toHaveProperty('headers')
    expect(JSON.stringify(result.error)).not.toContain('PRIVATE_')
  })

  it.each(['not-created', 'uncertain'] as const)('preserves the explicit Host creation outcome %s without inferring or rewriting it', async creation => {
    const f = await fixture()
    const reason = 'DUAL_MODEL_WORKSPACE_UNAVAILABLE'
    const ownerError = new RemoteError('copilot/dual-model', reason, { reason, creation })
    f.rpcCall.mockResolvedValueOnce({ ok: false, error: ownerError })
    const result = await f.remote.create(createInput)
    if (result.ok) throw new Error('expected a Remote failure')
    expect(result.error.code).toBe('copilot/dual-model')
    expect(result.error.details).toEqual({ reason, creation })
    expect(f.rpcCall).toHaveBeenCalledExactlyOnceWith('/api', 'githubCopilotDualModel/create',
      { args: { input: createInput } }, expect.any(AbortSignal))
  })

  it('documents unvalidated rc.1 error details without claiming Client filtering', async () => {
    const f = await fixture()
    f.rpcCall.mockResolvedValue({ ok: false, error: {
      code: 'copilot/dual-model', message: 'PRIVATE_MESSAGE',
      details: { reason: 'DUAL_MODEL_UNSUPPORTED', secret: 'PRIVATE_DETAILS' }, privateBody: 'PRIVATE_BODY',
    } })
    const result = await f.remote.view()
    if (result.ok) throw new Error('expected a Remote failure')
    // This legacy Client does not filter message/details. Host owners must emit
    // safe RemoteErrors; keeping the descriptor does not sanitize unsafe owners.
    expect(result.error.message).toBe('PRIVATE_MESSAGE')
    expect(result.error.details).toEqual({ reason: 'DUAL_MODEL_UNSUPPORTED', secret: 'PRIVATE_DETAILS' })
    expect(result.error).not.toHaveProperty('privateBody')
  })

  it.each(['view', 'save'] as const)('rejects unknown and malformed %s results in the registered Host codec', async method => {
    const f = await fixture()
    expect(f.registrations[0]).toBe(contribution)
    const codec = resultSchema(method)
    const malformed = [
      { ...validView, secret: 'PRIVATE_RESULT' },
      { ...validView, revision: -1 }, { ...validView, revision: 0.5 },
      { ...validView, revision: Number.MAX_SAFE_INTEGER + 1 },
      { ...validView, configuration: { ...configuration, acceptanceModel: 'unexpected' } },
      { ...validView, models: [{ id: '', name: 'Invalid' }] },
      { ...validView, models: [{ id: 'model', name: 'Model', grant: 'PRIVATE_GRANT' }] },
      { ...validView, workspaces: [{ id: 'workspace', name: 'Workspace', credentials: 'PRIVATE_CREDENTIAL' }] },
    ]
    for (const value of malformed) expect(() => codec.parse(value)).toThrow()
    expect(f.rpcCall).not.toHaveBeenCalled()
  })

  it('rejects invalid or extra create result fields in the registered Host codec', async () => {
    const f = await fixture()
    const codec = resultSchema('create')
    for (const result of [{ sessionId: '' }, { sessionId: 123 }, { sessionId: 'x'.repeat(513) }, { sessionId: 'session', secret: 'PRIVATE' }]) {
      expect(() => codec.parse(result)).toThrow()
    }
    expect(f.rpcCall).not.toHaveBeenCalled()
  })

  it('keeps the legacy success-carrier boundary explicit instead of claiming Client result validation', async () => {
    const f = await fixture()
    const malformed = { ...validView, secret: 'PRIVATE_RESULT' }
    f.rpcCall.mockResolvedValueOnce({ ok: true, value: malformed })
    const result = await f.remote.view()
    expect(result).toEqual({ ok: true, value: malformed })
    expect(() => resultSchema('view').parse(result.ok ? result.value : undefined)).toThrow()
    expect(f.rpcCall).toHaveBeenCalledTimes(1)
  })

  it('disposes the namespace and contribution idempotently and blocks captured methods without transport', async () => {
    const f = await fixture()
    const staleCreate = f.remote.create
    await f.dispose()
    await f.dispose()
    expect(f.unregister).toHaveBeenCalledTimes(1)
    expect(f.ctx.get('remote.githubCopilotDualModel')).toBeUndefined()
    const result = await staleCreate(createInput)
    expect(result).toMatchObject({ ok: false, error: { code: 'gateway/internal' } })
    expect(f.rpcCall).not.toHaveBeenCalled()
  })

  it('aborts the owned signal and rejects a late result after namespace disposal', async () => {
    const f = await fixture()
    const response = deferred<WireResult>()
    f.rpcCall.mockReturnValueOnce(response.promise)
    const pending = f.remote.create(createInput)
    expect(f.rpcCall).toHaveBeenCalledTimes(1)
    const signal = f.rpcCall.mock.calls[0]![3]
    expect(signal.aborted).toBe(false)
    await f.dispose()
    expect(signal.aborted).toBe(true)
    response.resolve({ ok: true, value: { sessionId: 'late-session' } })
    await expect(pending).resolves.toMatchObject({ ok: false, error: { code: 'gateway/internal' } })
    expect(f.unregister).toHaveBeenCalledTimes(1)
  })
})
