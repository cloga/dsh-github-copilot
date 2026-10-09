import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { DiagnosticsController } from '../src/diagnostics-host.ts'
import { emptyDiagnostics } from '../src/diagnostics-collector.ts'

async function fixture(storage = true, commit = true) {
  const ctx = new Context()
  let revision = 0
  let value = { diagnosticsEnabled: false, autoAllocationDiagnosticsEnabled: false,
    requestDiagnosticsEnabled: false, unrelated: 'preserved' }
  const mutate = vi.fn(async (ns: string, operations: readonly { path: readonly string[]; value: boolean }[], expected: number) => {
    expect(ns).toBe('github-copilot')
    expect(expected).toBe(revision)
    expect(operations).toHaveLength(1)
    expect(operations[0]!.path).toEqual(['requestDiagnosticsEnabled'])
    if (commit) {
      value = { ...value, requestDiagnosticsEnabled: operations[0]!.value }
      revision++
    }
  })
  ctx.provide('settings', { describe: () => [{ ns: 'github-copilot', value, revision }], mutate })
  ctx.provide('profileContext', { name: 'synthetic' })
  const set = vi.fn(async () => {})
  if (storage) ctx.provide('storageDomain', { open: async () => ({
    global: { get: () => emptyDiagnostics(), set }, close: async () => {},
  }) })
  let controller!: DiagnosticsController
  await ctx.plugin({ apply(scope) { controller = new DiagnosticsController(scope) } })
  if (storage) await vi.waitFor(() => expect(controller.get().state).toBe('ready'))
  return { ctx, controller, mutate, set, value: () => value }
}
describe('request diagnostics consent and durability boundary', () => {
  it('CAS-mutates only the new leaf with exact readback and independent collection', async () => {
    const f = await fixture()
    try {
      expect(f.controller.get().requestEnabled).toBe(false)
      await expect(f.controller.setRequestEnabled(true)).resolves.toMatchObject({
        requestEnabled: true, enabled: false, autoAllocationEnabled: false,
      })
      expect(f.controller.collector.isRequestEnabled()).toBe(true)
      expect(f.value()).toMatchObject({ unrelated: 'preserved', diagnosticsEnabled: false,
        autoAllocationDiagnosticsEnabled: false, requestDiagnosticsEnabled: true })
      await f.controller.setRequestEnabled(false)
      expect(f.controller.collector.isRequestEnabled()).toBe(false)
      expect(f.mutate).toHaveBeenCalledTimes(2)
    } finally { await f.ctx.fiber.dispose() }
  })
  it('rejects unavailable storage and uncertain commits without pretending consent succeeded', async () => {
    for (const storage of [false, true]) {
      const f = await fixture(storage, false)
      try {
        await expect(f.controller.setRequestEnabled(true)).rejects.toThrow(storage
          ? 'COPILOT_DIAGNOSTICS_SETTINGS_COMMIT_UNCERTAIN' : 'COPILOT_DIAGNOSTICS_STORAGE_UNAVAILABLE')
        expect(f.controller.get().requestEnabled).toBe(false)
        expect(f.controller.collector.isRequestEnabled()).toBe(false)
        expect(f.mutate).toHaveBeenCalledTimes(storage ? 1 : 0)
      } finally { await f.ctx.fiber.dispose() }
    }
  })
})
