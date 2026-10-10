import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json'
import { expect, it } from 'vitest'
import { diagnosticsDomain, diagnosticsDomainForProfile } from '../../src/diagnostics-host.ts'
import { DiagnosticsCollector, emptyDiagnostics } from '../../src/diagnostics-collector.ts'
import { DiagnosticsSnapshotSchema } from '../../src/diagnostics-types.ts'

it('uses the strict owned schema with the published storage validation contract', async () => {
  const schema = diagnosticsDomain.global.schema
  expect(schema).toBe(DiagnosticsSnapshotSchema)
  expect(schema.validate(emptyDiagnostics())).toBe(true)
  expect(await schema.validateAsync(emptyDiagnostics())).toBe(true)
  const invalid = { ...emptyDiagnostics(), accountId: 'synthetic-sensitive-sentinel' }
  expect(schema.validate(invalid)).toBe(false)
  expect(await schema.validateAsync(invalid)).toBe(false)
  expect(() => schema.parse(invalid)).toThrow()
})

it('persists strictly bounded aggregate snapshots across actual public JSON/domain reopen and rejects corruption', async () => {
  expect(['tagged-source-runtime', 'published-artifact-runtime']).toContain(process.env.DSH_CORE_EVIDENCE)
  const path = await mkdtemp(join(tmpdir(), 'copilot-diagnostics-'))
  const ctx = new Context()
  const backend = new JsonStorageBackend(path)
  new Storage(ctx)
  const unregister = ctx.storage.backend.register('json', backend)
  const facility = new DomainFacility(ctx, { backend: 'json' })
  ctx.provide('storageDomain', facility)
  try {
    let domain = await facility.open(diagnosticsDomain)
    const collector = new DiagnosticsCollector('0.4.0-alpha.123', 'host')
    collector.setEnabled(true)
    collector.begin('identity-read').finish('success')
    collector.begin('compaction').stage('summary-attempt')
    collector.setAutoAllocationEnabled(true)
    collector.recordAutoAllocation({
      assessment: { demand: 'unknown', source: 'semantic', signals: ['context-omitted'], diagnostic: 'context-omitted' },
      targetCategory: 'powerful', selectedCategory: 'unknown', categoryCandidateCount: 0,
      method: 'no-fit', fallback: true,
    })
    collector.setRequestEnabled(true)
    const requestStart = { streamId: '12345678-1234-4234-8234-123456789abc', dispatchIndex: 1,
      model: 'fixture-model', protocol: 'openai-responses' as const,
      composition: { state: 'size-limit' as const, totalBytes: 21355789 }, encoding: 'identity' as const, wireBytes: 21355789 }
    const observed = collector.beginRequest(requestStart)!
    observed.headers(408, 61375)
    observed.finish('http-error', 'request-body-timeout')
    observed.composition!({ state: 'complete', totalBytes: 21355789, conversationBytes: 21355770,
      toolSchemaBytes: 0, systemBytes: 0, otherBytes: 19, imageBlockBytes: 0, opaqueReplayBytes: 0,
      remainingConversationBytes: 21355770 })
    collector.beginRequest({ ...requestStart, dispatchIndex: 2 })
    collector.beginCredentialChange()!.record({
      phase: 'notification', reason: 'qualified', preparing: 0, dispatched: 1,
      alreadyAborted: 0, preserved: 1, revoked: 0,
    })
    await domain.global.set(collector.snapshot())
    await domain.close()
    domain = await facility.open(diagnosticsDomain)
    const restarted = new DiagnosticsCollector('0.4.0-alpha.123', 'host')
    restarted.restore(domain.global.get())
    expect(restarted.snapshot().rows.some(row => row.metric === 'success')).toBe(true)
    expect(restarted.snapshot().interrupted).toBe(1)
    expect(restarted.snapshot().pending).toEqual([])
    expect(restarted.snapshot().autoAllocation?.noFitRows).toMatchObject([
      { assessmentOutcome: 'context-omitted', decisions: 1 },
    ])
    expect(restarted.snapshot().requests).toMatchObject({
      pending: 0, interruptedOnReopen: 1, rows: [{ reason: 'request-body-timeout', httpStatus: 408,
        composition: { state: 'complete', totalBytes: 21355789, conversationBytes: 21355770 } }],
      credentialChanges: { pending: 0, interruptedOnReopen: 1,
        rows: [{ phase: 'notification', reason: 'qualified', preserved: 1 }] },
    })
    restarted.clear()
    await domain.global.set(restarted.snapshot())
    await domain.close()
    domain = await facility.open(diagnosticsDomain)
    expect(domain.global.get().epoch).toBe(2)
    expect(domain.global.get().rows).toEqual([])
    expect(domain.global.get().requests).toBeUndefined()
    await domain.close()
    const file = join(path, 'github_copilot_diagnostics.json')
    const original = await readFile(file, 'utf8')
    const invalid = JSON.parse(original)
    invalid.global = { ...emptyDiagnostics(), accountId: 'synthetic-sensitive-sentinel' }
    await writeFile(file, JSON.stringify(invalid))
    await expect(facility.open(diagnosticsDomain)).rejects.toMatchObject({ code: 'invalid-record' })
    expect(await readFile(file, 'utf8')).toContain('synthetic-sensitive-sentinel')
    // Corruption is not silently backed up, deleted, or made into a healthy empty report.
    expect(DiagnosticsSnapshotSchema.safeParse(invalid.global).success).toBe(false)
  } finally {
    await facility.closeAll()
    unregister()
    await backend.close()
    await ctx.fiber.dispose()
    await rm(path, { recursive: true, force: true })
  }
})

it('isolates profiles on the home-wide backend and preserves memory on a real publish failure', async () => {
  const path = await mkdtemp(join(tmpdir(), 'copilot-diagnostics-isolation-'))
  const ctx = new Context()
  const backend = new JsonStorageBackend(path)
  new Storage(ctx)
  const unregister = ctx.storage.backend.register('json', backend)
  const facility = new DomainFacility(ctx, { backend: 'json' })
  try {
    const spec = diagnosticsDomainForProfile('synthetic_a')
    const first = await facility.open(spec)
    const second = await facility.open(diagnosticsDomainForProfile('synthetic_b'))
    const collector = new DiagnosticsCollector('0.4.0-alpha.123', 'host')
    collector.setEnabled(true)
    collector.begin('identity-read').finish('success')
    const snapshot = collector.snapshot()
    await first.global.set(snapshot)
    expect(second.global.get().rows).toEqual([])
    expect(() => diagnosticsDomainForProfile('../unsafe')).toThrow('COPILOT_DIAGNOSTICS_PROFILE_UNAVAILABLE')
    const file = join(path, `${spec.name}.json`)
    await rm(file)
    await mkdir(file)
    await expect(first.global.set(emptyDiagnostics())).rejects.toThrow()
    expect(first.global.get()).toEqual(snapshot)
  } finally {
    await facility.closeAll(); unregister(); await backend.close(); await ctx.fiber.dispose()
    await rm(path, { recursive: true, force: true })
  }
})
