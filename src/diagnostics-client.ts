import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from './diagnostics-remote.ts'
import type { DiagnosticsHandle } from './diagnostics-collector.ts'
import { diagnosticsBucket, DiagnosticsViewSchema } from './diagnostics-types.ts'
import type { DiagnosticsOperation, DiagnosticsOutcome, DiagnosticsReason, DiagnosticsRow, DiagnosticsStage,
  DiagnosticsView } from './diagnostics-types.ts'
import packageJson from '#package.json'

interface Live { operation: DiagnosticsOperation; stage: DiagnosticsStage; start: number; epoch: number }
interface Owner {
  active: boolean; view?: DiagnosticsView; live: Set<Live>; rows: DiagnosticsRow[]; dropped: number; unconfirmed: number
  reportFailure: boolean; flush(): Promise<void>
}
let owner: Owner | undefined
export function updateDiagnosticsClient(view: DiagnosticsView): void {
  const current = owner
  if (!current) return
  if (current.view && (view.snapshot.epoch < current.view.snapshot.epoch
    || view.snapshot.epoch === current.view.snapshot.epoch && view.snapshot.updatedAt < current.view.snapshot.updatedAt)) return
  if (current.view?.snapshot.epoch !== view.snapshot.epoch || !view.enabled) {
    current.rows = []
    current.live.clear()
    current.dropped = 0
    current.unconfirmed = 0
  }
  current.view = view
}
export function clientDiagnosticsReportingFailed(): boolean { return owner?.reportFailure === true }
function append(current: Owner, live: Live, metric: DiagnosticsRow['metric'], reason: DiagnosticsReason): void {
  if (current.rows.length >= 128) { current.dropped = Math.min(Number.MAX_SAFE_INTEGER, current.dropped + 1); current.reportFailure = true; return }
  current.rows.push({ hour: Math.floor(Date.now() / 3_600_000) * 3_600_000, version: packageJson.version,
    layer: 'client', operation: live.operation, stage: live.stage, metric, reason,
    bucket: diagnosticsBucket(Math.max(0, performance.now() - live.start)), count: 1 })
}
export function beginClientDiagnostics(operation: DiagnosticsOperation): DiagnosticsHandle | undefined {
  const current = owner
  if (!current?.active || !current.view?.enabled || current.view.state !== 'ready') return undefined
  if (current.live.size >= 128) { current.dropped = Math.min(Number.MAX_SAFE_INTEGER, current.dropped + 1); current.reportFailure = true; return undefined }
  const live: Live = { operation, stage: 'rpc-invoked', start: performance.now(), epoch: current.view.snapshot.epoch }
  current.live.add(live)
  append(current, live, 'started', 'none')
  void current.flush()
  const valid = () => current.live.has(live) && current.view?.snapshot.epoch === live.epoch
  return {
    stage: stage => { if (valid()) { live.stage = stage; append(current, live, 'stage', 'none') } },
    finish: (outcome: DiagnosticsOutcome, reason: DiagnosticsReason = 'none') => {
      if (!valid()) return
      current.live.delete(live)
      append(current, live, outcome, reason)
      void current.flush()
    },
  }
}
export function createClientDiagnosticsScope() {
  const handles = new Set<DiagnosticsHandle>()
  return {
    begin(operation: DiagnosticsOperation): DiagnosticsHandle | undefined {
      const observed = beginClientDiagnostics(operation)
      if (!observed) return
      const handle: DiagnosticsHandle = {
        stage: stage => observed.stage(stage),
        finish: (outcome, reason) => { handles.delete(handle); observed.finish(outcome, reason) },
      }
      handles.add(handle)
      return handle
    },
    close(): void { for (const handle of handles) handle.finish('interrupted', 'unknown') },
  }
}
/** Bounded additive reporting, no retry after an uncertain RPC result. */
export function installDiagnosticsClient(ctx: Context): () => Promise<void> {
  const remote = ctx.remote.githubCopilotDiagnostics
  let writing: Promise<void> | undefined
  const current: Owner = {
    active: true, live: new Set(), rows: [], dropped: 0, unconfirmed: 0, reportFailure: false,
    async flush() {
      if (writing || !current.view || current.rows.length === 0 && !current.dropped && !current.unconfirmed) return
      const rows = current.rows.splice(0, 128)
      const dropped = current.dropped, unconfirmed = current.unconfirmed
      current.dropped = 0; current.unconfirmed = 0
      const epoch = current.view.snapshot.epoch
      const failed = () => {
        current.reportFailure = true
        if (current.view?.snapshot.epoch === epoch)
          current.unconfirmed = Math.min(Number.MAX_SAFE_INTEGER, current.unconfirmed + rows.length + dropped + unconfirmed)
        ctx.logger.warn('[github-copilot] COPILOT_DIAGNOSTICS_CLIENT_REPORT_FAILED')
      }
      writing = (async () => {
        try {
          const result = await remote.recordClient({ epoch, rows, dropped, unconfirmed })
          const parsed = result.ok ? DiagnosticsViewSchema.safeParse(result.value) : undefined
          if (!parsed?.success) { failed(); return }
          if (parsed.data.diagnostic === 'client-report-revoked')
            ctx.logger.warn('[github-copilot] COPILOT_DIAGNOSTICS_CLIENT_REPORT_REVOKED')
          if (current.active && owner === current) updateDiagnosticsClient(parsed.data)
        } catch {
          failed()
        } finally { writing = undefined }
      })()
      await writing
    },
  }
  owner = current
  const refresh = async () => {
    try {
      const result = await remote.get()
      const parsed = result.ok ? DiagnosticsViewSchema.safeParse(result.value) : undefined
      if (owner === current && current.active) {
        if (parsed?.success) updateDiagnosticsClient(parsed.data)
        else current.reportFailure = true
      }
    } catch {
      current.reportFailure = true
      ctx.logger.warn('[github-copilot] COPILOT_DIAGNOSTICS_CLIENT_STATUS_FAILED')
    }
  }
  void refresh()
  const timer = setInterval(() => {
    for (const live of current.live) append(current, live, 'pending-sample', 'none')
    void current.flush(); void refresh()
  }, 10_000)
  return async () => {
    clearInterval(timer)
    for (const live of current.live) append(current, live, 'interrupted', 'unknown')
    current.live.clear()
    await writing
    await current.flush()
    current.active = false
    if (owner === current) owner = undefined
  }
}
