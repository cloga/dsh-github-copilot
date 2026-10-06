import { Context, Service } from '@deepseek-ai/cordis'
import { expect, it, vi } from 'vitest'
import { installDiagnosticsClient, updateDiagnosticsClient, createClientDiagnosticsScope,
  clientDiagnosticsReportingFailed } from '../src/diagnostics-client.ts'
import { emptyDiagnostics } from '../src/diagnostics-collector.ts'
import type { DiagnosticsRemote } from '../src/diagnostics-card.ts'
import type { DiagnosticsView } from '../src/diagnostics-types.ts'

class TestRemote extends Service {
  constructor(ctx: Context, readonly githubCopilotDiagnostics: DiagnosticsRemote) { super(ctx, 'remote') }
}
const view = (epoch: number): DiagnosticsView => ({ enabled: true, state: 'ready', diagnostic: 'none',
  dirty: false, snapshot: { ...emptyDiagnostics(), epoch } })

it('rejects stale status responses and settles an unmounted Checking operation once', async () => {
  const ctx = new Context()
  let release!: (value: Awaited<ReturnType<DiagnosticsRemote['get']>>) => void
  const status = new Promise<Awaited<ReturnType<DiagnosticsRemote['get']>>>(resolve => { release = resolve })
  const report = vi.fn<DiagnosticsRemote['recordClient']>(async () => ({ ok: true, value: view(5) }))
  new TestRemote(ctx, { get: () => status, recordClient: report, clear: vi.fn(), setEnabled: vi.fn() })
  const dispose = installDiagnosticsClient(ctx)
  try {
    updateDiagnosticsClient(view(5))
    release({ ok: true, value: { ...view(0), enabled: false } })
    await Promise.resolve()
    const scope = createClientDiagnosticsScope()
    const operation = scope.begin('identity-read')
    expect(operation).toBeDefined()
    scope.close()
    operation?.finish('success')
    await dispose()
    const rows = report.mock.calls.flatMap(([batch]) => batch.rows)
    expect(rows.filter(row => row.metric === 'started')).toHaveLength(1)
    expect(rows.filter(row => row.metric === 'interrupted')).toHaveLength(1)
    expect(rows.some(row => row.metric === 'success')).toBe(false)
    expect(report.mock.calls.every(([batch]) => batch.epoch === 5)).toBe(true)
  } finally { await dispose(); await ctx.fiber.dispose() }
})

it('does not resend uncertain rows and exposes acknowledgement gaps on the next report', async () => {
  const ctx = new Context()
  const report = vi.fn<DiagnosticsRemote['recordClient']>()
    .mockRejectedValueOnce(new Error('synthetic-private-error'))
    .mockResolvedValue({ ok: true, value: view(2) })
  new TestRemote(ctx, { get: async () => ({ ok: true, value: view(2) }), recordClient: report,
    clear: vi.fn(), setEnabled: vi.fn() })
  const dispose = installDiagnosticsClient(ctx)
  try {
    updateDiagnosticsClient(view(2))
    const scope = createClientDiagnosticsScope()
    scope.begin('identity-read')
    await Promise.resolve(); await Promise.resolve()
    expect(clientDiagnosticsReportingFailed()).toBe(true)
    scope.close()
    await dispose()
    expect(report.mock.calls.flatMap(([batch]) => batch.rows).filter(row => row.metric === 'started')).toHaveLength(1)
    expect(report.mock.calls.some(([batch]) => (batch.unconfirmed ?? 0) > 0)).toBe(true)
    expect(JSON.stringify(report.mock.calls)).not.toContain('synthetic-private-error')
  } finally { await dispose(); await ctx.fiber.dispose() }
})
