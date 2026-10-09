// @vitest-environment jsdom
import { webcrypto } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import vm from 'node:vm'
import * as Cordis from '@deepseek-ai/cordis'
import { Context } from '@deepseek-ai/cordis'
import { TypertGatewayService } from '@deepseek-ai/dsh-api-gateway'
import { TypertRegistry } from '@deepseek-ai/dsh-typert-registry'
import * as HostConnection from '@deepseek-ai/dsh-client-connection'
import Storage from '@deepseek-ai/dsh-storage'
import * as DomainPlugin from '@deepseek-ai/dsh-storage-domain'
import * as JsonPlugin from '@deepseek-ai/dsh-storage-json'
import type { CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { expect, it, vi } from 'vitest'
import { DiagnosticsController } from '../../src/diagnostics-host.ts'
import contribution from '../../src/diagnostics-remote.ts'

async function loadClientGateway(): Promise<{ apply(ctx: Context): void }> {
  if (process.env.DSH_CORE_EVIDENCE === 'tagged-source-runtime') {
    return import('@deepseek-ai/dsh-api-gateway/client')
  }
  // Published Client entries register a factory, rather than exporting Node ESM.
  // Capture the unchanged artifact in a fixture-owned realm, not a live loader.
  const require = createRequire(import.meta.url)
  let registration: unknown
  vm.runInNewContext(await readFile(require.resolve('@deepseek-ai/dsh-api-gateway/client'), 'utf8'), {
    window: { crypto: webcrypto, __ModuleLoader__: { load(value: unknown) { registration = value } } },
    crypto: webcrypto, AbortController, AbortSignal, Error, TextEncoder, TextDecoder, URL, console, performance,
    setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
  })
  if (typeof registration !== 'object' || registration === null
    || !('id' in registration) || registration.id !== '@deepseek-ai/dsh-api-gateway'
    || !('factory' in registration) || typeof registration.factory !== 'function') {
    throw new Error('Published Client gateway registration is unavailable')
  }
  const exports: unknown = registration.factory((specifier: string) => {
    if (specifier === '@deepseek-ai/cordis') return Cordis
    throw new Error(`Unexpected published Client gateway external: ${specifier}`)
  })
  if (typeof exports !== 'object' || exports === null
    || !('apply' in exports) || typeof exports.apply !== 'function') {
    throw new Error('Published Client gateway apply export is unavailable')
  }
  const apply = exports.apply
  return { apply(ctx) { apply(ctx) } }
}

it('binds diagnostics through actual strict Client and Host gateways with durable enable and clear fences', async () => {
  expect(['tagged-source-runtime', 'published-artifact-runtime']).toContain(process.env.DSH_CORE_EVIDENCE)
  const Gateway = await loadClientGateway()
  const path = await mkdtemp(join(tmpdir(), 'copilot-diagnostics-gateway-'))
  const host = new Context(), client = new Context()
  try {
    host.provide('profileContext', { name: 'synthetic', startedBundles: [], dir: path,
      patchPath: join(path, 'cordis.patch.yml'), installAnchor: join(path, 'package.json'),
      cwd: path, home: path, overlays: [], telemetryDisabledEnv: undefined })
    const registry = new TypertRegistry(host)
    registry.register({ package: contribution.package, face: 'host', schemas: [],
      model: { services: [], events: [], objects: [] }, invocations: contribution.descriptors })
    let revision = 0, enabled = false, autoEnabled = false, requestEnabled = false
    host.provide('settings', {
      describe: () => [{ ns: 'github-copilot', revision, value: {
        diagnosticsEnabled: enabled, autoAllocationDiagnosticsEnabled: autoEnabled,
        requestDiagnosticsEnabled: requestEnabled,
      } }],
      mutate: vi.fn(async (ns: string, operations: readonly { path: readonly string[]; value: boolean }[], expected: number) => {
        expect(ns).toBe('github-copilot'); expect(expected).toBe(revision)
        if (operations[0]?.path[0] === 'diagnosticsEnabled') enabled = operations[0]!.value
        else if (operations[0]?.path[0] === 'autoAllocationDiagnosticsEnabled') autoEnabled = operations[0]!.value
        else if (operations[0]?.path[0] === 'requestDiagnosticsEnabled') requestEnabled = operations[0]!.value
        else throw new Error('UNEXPECTED_DIAGNOSTICS_SETTING')
        revision++
      }),
    })
    let browserRecord: CredentialRecord | undefined
    host.provide('credentials', {
      readRecord: async () => browserRecord,
      modifyRecord: async (_key: string, mutate: (value: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>) => {
        browserRecord = await mutate(browserRecord); return browserRecord
      },
    })
    await HostConnection.apply(host, {})
    new TypertGatewayService(host, { websocketHeartbeatIntervalMs: 30000 })
    const handler = host.connection.createSharedFetchHandler('/api')
    let sequence = 0
    client.provide('typert', { remotes: { register: () => () => {} }, contexts: { getClient: () => undefined } })
    client.provide('connection', {
      rpc: { call: async (_path: string, method: string, payload: unknown) => {
        const response = await handler.fetch(new Request(`http://fixture.invalid/api/${method}`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'client-request', rpcId: `diagnostic-${++sequence}`, method, payload }),
        }))
        return (await response.json()).result
      }, open: vi.fn() },
      registerGenerationSource: () => () => {}, start: () => ({ stop() {} }), generation: { getSnapshot: () => undefined },
    })
    Gateway.apply(client)
    await client.remote.$mount(contribution)
    await host.plugin(Storage)
    await host.plugin(JsonPlugin, { root: path })
    await host.plugin(DomainPlugin, { backend: 'json' })
    let diagnostics!: DiagnosticsController
    await host.plugin({ apply(ctx) { diagnostics = new DiagnosticsController(ctx) } })
    await vi.waitFor(() => expect(diagnostics.get().state).toBe('ready'))
    const remote = client.remote.githubCopilotDiagnostics
    await expect(remote.get()).resolves.toMatchObject({ ok: true, value: {
      enabled: false, autoAllocationEnabled: false, requestEnabled: false, state: 'ready',
    } })
    await expect(remote.setRequestEnabled(true)).resolves.toMatchObject({ ok: true, value: {
      enabled: false, autoAllocationEnabled: false, requestEnabled: true,
    } })
    const request = diagnostics.collector.beginRequest({
      streamId: '12345678-1234-4234-8234-123456789abc', dispatchIndex: 1,
      model: 'fixture-model', protocol: 'openai-responses',
      composition: { state: 'size-limit', totalBytes: 21355789 }, encoding: 'identity', wireBytes: 21355789,
    })!
    request.headers(408, 61375)
    request.finish('http-error', 'request-body-timeout')
    request.composition!({ state: 'complete', totalBytes: 21355789, conversationBytes: 21355770,
      toolSchemaBytes: 0, systemBytes: 0, otherBytes: 19, imageBlockBytes: 0, opaqueReplayBytes: 0,
      remainingConversationBytes: 21355770 })
    await diagnostics.flush()
    expect(diagnostics.get().snapshot.requests?.rows).toMatchObject([{ httpStatus: 408, reason: 'request-body-timeout' }])
    await expect(remote.get()).resolves.toMatchObject({ ok: true, value: { snapshot: { requests: {
      rows: [{ composition: { state: 'complete', totalBytes: 21355789, conversationBytes: 21355770 } }],
    } } } })
    await expect(remote.setRequestEnabled(false)).resolves.toMatchObject({ ok: true, value: { requestEnabled: false } })
    await expect(remote.setEnabled(true)).resolves.toMatchObject({ ok: true, value: { enabled: true, dirty: false } })
    await expect(remote.setAutoAllocationEnabled(true)).resolves.toMatchObject({
      ok: true, value: { enabled: true, autoAllocationEnabled: true, dirty: false },
    })
    const operation = diagnostics.collector.begin('account-global-switch')
    operation.stage('cas')
    await diagnostics.flush()
    expect(diagnostics.get().snapshot.pending[0]?.stage).toBe('cas')
    const epoch = diagnostics.get().snapshot.epoch
    await expect(remote.clear()).resolves.toMatchObject({ ok: true, value: { dirty: false, snapshot: { epoch: epoch + 1 } } })
    operation.finish('success')
    expect(diagnostics.get().snapshot.rows).toEqual([])
    await remote.recordClient({ epoch, rows: [{ hour: Math.floor(Date.now() / 3600000) * 3600000,
      version: '0.4.0-alpha.123', layer: 'client', operation: 'identity-read', stage: 'admitted',
      metric: 'started', reason: 'none', bucket: 0, count: 1 }] })
    expect(diagnostics.get().snapshot.rows).toEqual([])
    // Synthetic public envelopes exercise the observer, not a live compaction transaction.
    const session = {}
    host.emit('session/event', session, { type: 'compaction/start', data: { compactionId: 'synthetic-no-checkpoint' } })
    host.emit('session/event', session, { type: 'compaction/end', data: { compactionId: 'synthetic-no-checkpoint' } })
    host.emit('session/event', session, { type: 'compaction/start', data: { compactionId: 'synthetic-commit' } })
    host.emit('session/event', session, { type: 'user/message', data: {
      source: { kind: 'compact-checkpoint', compactionId: 'wrong-bracket' } } })
    expect(diagnostics.get().snapshot.rows.some(row => row.stage === 'checkpoint-committed')).toBe(false)
    host.emit('session/event', session, { type: 'user/message', data: {
      source: { kind: 'compact-checkpoint', compactionId: 'synthetic-commit' } } })
    host.emit('session/event', session, { type: 'compaction/end', data: { compactionId: 'synthetic-commit' } })
    host.emit('session/event', session, { type: 'compaction/start', data: { compactionId: 'synthetic-cancel' } })
    diagnostics.markCompactionCancelled(session)
    host.emit('session/event', session, { type: 'compaction/end', data: {
      compactionId: 'synthetic-cancel', error: 'synthetic-sensitive-error' } })
    const rows = diagnostics.get().snapshot.rows.filter(row => row.operation === 'compaction')
    expect(rows.some(row => row.metric === 'unknown')).toBe(true)
    expect(rows.some(row => row.metric === 'success')).toBe(true)
    expect(rows.some(row => row.metric === 'cancelled')).toBe(true)
    expect(rows.some(row => row.metric === 'no-op')).toBe(false)
    expect(JSON.stringify(diagnostics.get())).not.toContain('synthetic-sensitive-error')
    await expect(remote.setEnabled(false)).resolves.toMatchObject({ ok: true, value: { enabled: false } })
    diagnostics.collector.restore({ ...diagnostics.get().snapshot, epoch: Number.MAX_SAFE_INTEGER })
    const beforeLimit = revision
    await expect(remote.setEnabled(true)).resolves.toMatchObject({ ok: false })
    expect(revision).toBe(beforeLimit)
    expect(enabled).toBe(false)
  } finally {
    await client.fiber.dispose()
    await host.fiber.dispose()
    await rm(path, { recursive: true, force: true })
  }
})
