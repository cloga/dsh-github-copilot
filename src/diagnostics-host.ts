import { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-storage-domain'
import type { Domain, DomainGlobalSpec } from '@deepseek-ai/dsh-storage-domain'
import type {} from '@deepseek-ai/dsh-app-boot'
import { DiagnosticsCollector, emptyDiagnostics } from './diagnostics-collector.ts'
import { DiagnosticsSnapshotSchema, diagnosticsReason, diagnosticsOutcome } from './diagnostics-types.ts'
import type { DiagnosticsHandle } from './diagnostics-collector.ts'
import type { DiagnosticsOperation, DiagnosticsSnapshot, DiagnosticsView } from './diagnostics-types.ts'
import { onSettingsNamespaceUpdated } from './settings-reader.ts'
import { ClientDiagnosticsBatchSchema } from './diagnostics-remote.ts'
import type { ClientDiagnosticsBatch } from './diagnostics-remote.ts'
import packageJson from '#package.json' with { type: 'json' }

const diagnosticsStorageGlobal: DomainGlobalSpec<DiagnosticsSnapshot> = {
  schema: DiagnosticsSnapshotSchema,
  initial: emptyDiagnostics(),
}
export const diagnosticsDomain = {
  name: 'github_copilot_diagnostics', version: 1, tables: {},
  global: diagnosticsStorageGlobal,
}
export function diagnosticsDomainForProfile(profileId: string): typeof diagnosticsDomain {
  if (!/^[a-zA-Z0-9_-]{1,48}$/.test(profileId)) throw new Error('COPILOT_DIAGNOSTICS_PROFILE_UNAVAILABLE')
  // The default public JSON backend is home-wide, not profile-local.
  return { ...diagnosticsDomain, name: `github_copilot_diagnostics_${Buffer.from(profileId).toString('hex')}` }
}
declare module '@deepseek-ai/cordis' {
  interface Context { githubCopilotDiagnostics: DiagnosticsController }
}
export function beginDiagnostics(ctx: Context, operation: DiagnosticsOperation): DiagnosticsHandle | undefined {
  return ctx.get('githubCopilotDiagnostics')?.collector.begin(operation)
}
/** Keeps diagnostics durability failures separate from observed business failures. */
export class DiagnosticsController extends TypertRemoteService {
  readonly collector: DiagnosticsCollector
  private domain: Domain<typeof diagnosticsDomain> | undefined
  private state: DiagnosticsView['state'] = 'unavailable'
  private problem: DiagnosticsView['diagnostic'] = 'storage-unavailable'
  private enabled = false
  private autoAllocationEnabled = false
  private requestEnabled = false
  private dirty = false
  private persistedAt: number | undefined
  private revision = 0
  private writing: Promise<void> | undefined
  private closed = false
  private settingsBusy = false
  private readonly brackets = new Map<object, { id: string; committed: boolean; cancelled: boolean; operation: DiagnosticsHandle }>()
  constructor(ctx: Context) {
    super(ctx, 'githubCopilotDiagnostics')
    this.collector = new DiagnosticsCollector(packageJson.version, 'host', () => {
      this.dirty = true
      this.revision++
    })
    const readEnabled = () => {
      const settings = ctx.get('settings')
      const value = settings?.describe({ redactSecrets: true }).find(row => row.ns === 'github-copilot')?.value
      this.enabled = typeof value === 'object' && value !== null && 'diagnosticsEnabled' in value
        && value.diagnosticsEnabled === true
      this.autoAllocationEnabled = typeof value === 'object' && value !== null
        && 'autoAllocationDiagnosticsEnabled' in value && value.autoAllocationDiagnosticsEnabled === true
      this.requestEnabled = typeof value === 'object' && value !== null
        && 'requestDiagnosticsEnabled' in value && value.requestDiagnosticsEnabled === true
      this.collector.setEnabled(this.enabled && this.state === 'ready')
      this.collector.setAutoAllocationEnabled(this.autoAllocationEnabled && this.state === 'ready')
      this.collector.setRequestEnabled(this.requestEnabled && this.state === 'ready')
      if (!this.enabled) this.brackets.clear()
    }
    ctx.inject(['settings'], scope => {
      readEnabled()
      const dispose = onSettingsNamespaceUpdated(scope, ns => { if (ns === 'github-copilot') readEnabled() })
      scope.effect(() => dispose)
    })
    ctx.inject(['storageDomain'], async scope => {
      this.state = 'loading'
      try {
        const profile = scope.get('profileContext')
        if (!profile) throw new Error('COPILOT_DIAGNOSTICS_PROFILE_UNAVAILABLE')
        const domain = await scope.storageDomain.open(diagnosticsDomainForProfile(profile.name))
        if (this.closed) { await domain.close(); return }
        this.domain = domain
        this.collector.restore(domain.global.get())
        this.state = 'ready'; this.problem = 'none'
        readEnabled()
        await this.flush()
      } catch (error) {
        this.state = 'error'
        this.problem = error instanceof Error && error.message === 'COPILOT_DIAGNOSTICS_PROFILE_UNAVAILABLE'
          ? 'profile-unavailable' : typeof error === 'object' && error !== null && 'code' in error
          && (error.code === 'invalid-record' || error.code === 'malformed-medium' || error.code === 'version-mismatch')
          ? 'storage-invalid' : 'storage-unavailable'
        this.collector.setEnabled(false)
        this.collector.setAutoAllocationEnabled(false)
        this.collector.setRequestEnabled(false)
        ctx.logger.warn('[github-copilot] COPILOT_DIAGNOSTICS_STORAGE_UNAVAILABLE')
      }
      if (this.closed) return
      const timer = setInterval(() => { void this.flush().catch(() => {
        ctx.logger.warn('[github-copilot] COPILOT_DIAGNOSTICS_STORAGE_WRITE_FAILED')
      }) }, 10_000)
      timer.unref()
      scope.effect(() => async () => {
        clearInterval(timer)
        this.collector.close()
        try { await this.flush() } finally {
          await this.domain?.close(); this.domain = undefined
          this.state = 'unavailable'; this.problem = 'storage-unavailable'
        }
      })
    })
    ctx.on('session/event', (session, event) => {
      if (event.type === 'compaction/start') {
        if (!this.enabled || this.state !== 'ready') return
        if (this.brackets.has(session) || this.brackets.size >= 128) {
          this.collector.noteDropped()
          return
        }
        this.brackets.set(session, { id: event.data.compactionId, committed: false, cancelled: false,
          operation: this.collector.begin('compaction') })
      }
      const bracket = this.brackets.get(session)
      if (!bracket) return
      if (event.type === 'user/message' && event.data.source.kind === 'compact-checkpoint'
        && event.data.source.compactionId === bracket.id) {
        bracket.committed = true
        bracket.operation.stage('checkpoint-committed')
      }
      if (event.type !== 'compaction/end' || event.data.compactionId !== bracket.id) return
      bracket.operation.stage('ended')
      if (bracket.cancelled) bracket.operation.finish('cancelled')
      else if (event.data.error === undefined) bracket.operation.finish(bracket.committed ? 'success' : 'unknown')
      else {
        const reason = diagnosticsReason(new Error(event.data.error))
        bracket.operation.finish(diagnosticsOutcome(reason), reason)
      }
      this.brackets.delete(session)
    })
    ctx.on('agent/disposed', ({ agent }) => {
      this.brackets.get(agent.session)?.operation.finish('interrupted', 'unknown')
      this.brackets.delete(agent.session)
    })
    ctx.effect(() => async () => {
      this.collector.close()
      this.brackets.clear()
      try { await this.flush() } finally { this.closed = true }
    })
  }
  async flush(): Promise<void> {
    if (this.writing) { await this.writing; if (this.dirty) return this.flush(); return }
    if (!this.domain || !this.dirty || this.closed) return
    const domain = this.domain
    const revision = this.revision
    const snapshot = this.collector.snapshot()
    this.writing = domain.global.set(snapshot).then(() => {
      this.persistedAt = snapshot.updatedAt
      this.dirty = this.revision !== revision
      this.state = 'ready'; this.problem = 'none'
    }, () => {
      this.problem = 'storage-write-failed'
      throw new Error('COPILOT_DIAGNOSTICS_STORAGE_WRITE_FAILED')
    }).finally(() => { this.writing = undefined })
    await this.writing
  }
  markCompactionCancelled(session: object): void {
    const bracket = this.brackets.get(session)
    if (bracket) bracket.cancelled = true
  }
  @Remote
  get(): DiagnosticsView {
    return { enabled: this.enabled, autoAllocationEnabled: this.autoAllocationEnabled, requestEnabled: this.requestEnabled,
      state: this.state, diagnostic: this.problem,
      ...(this.persistedAt === undefined ? {} : { persistedAt: this.persistedAt }),
      dirty: this.dirty, snapshot: this.collector.snapshot() }
  }
  @Remote
  async setRequestEnabled(enabled: boolean): Promise<DiagnosticsView> {
    if (typeof enabled !== 'boolean') throw new Error('COPILOT_DIAGNOSTICS_INVALID_CONTROL')
    if (this.settingsBusy) throw new Error('COPILOT_DIAGNOSTICS_CONTROL_BUSY')
    if (enabled && !this.domain) throw new Error('COPILOT_DIAGNOSTICS_STORAGE_UNAVAILABLE')
    this.settingsBusy = true
    try {
      const settings = this.ctx.get('settings')
      const row = settings?.describe({ redactSecrets: true }).find(item => item.ns === 'github-copilot')
      if (!settings || !row) throw new Error('COPILOT_DIAGNOSTICS_SETTINGS_UNAVAILABLE')
      await settings.mutate('github-copilot', [{
        op: 'set', path: ['requestDiagnosticsEnabled'], value: enabled,
      }], row.revision)
      const saved = settings.describe({ redactSecrets: true }).find(item => item.ns === 'github-copilot')?.value
      if (typeof saved !== 'object' || saved === null || !('requestDiagnosticsEnabled' in saved)
        || saved.requestDiagnosticsEnabled !== enabled) throw new Error('COPILOT_DIAGNOSTICS_SETTINGS_COMMIT_UNCERTAIN')
      this.requestEnabled = enabled
      this.collector.setRequestEnabled(enabled && this.state === 'ready')
      await this.flush()
      return this.get()
    } finally { this.settingsBusy = false }
  }
  @Remote
  async setEnabled(enabled: boolean): Promise<DiagnosticsView> {
    if (typeof enabled !== 'boolean') throw new Error('COPILOT_DIAGNOSTICS_INVALID_CONTROL')
    if (this.settingsBusy) throw new Error('COPILOT_DIAGNOSTICS_CONTROL_BUSY')
    if (enabled && !this.domain) throw new Error('COPILOT_DIAGNOSTICS_STORAGE_UNAVAILABLE')
    if (enabled) this.collector.assertCanEnable()
    this.settingsBusy = true
    try {
      const settings = this.ctx.get('settings')
      const row = settings?.describe({ redactSecrets: true }).find(item => item.ns === 'github-copilot')
      if (!settings || !row) throw new Error('COPILOT_DIAGNOSTICS_SETTINGS_UNAVAILABLE')
      await settings.mutate('github-copilot', [{ op: 'set', path: ['diagnosticsEnabled'], value: enabled }], row.revision)
      const saved = settings.describe({ redactSecrets: true }).find(item => item.ns === 'github-copilot')?.value
      if (typeof saved !== 'object' || saved === null || !('diagnosticsEnabled' in saved) || saved.diagnosticsEnabled !== enabled)
        throw new Error('COPILOT_DIAGNOSTICS_SETTINGS_COMMIT_UNCERTAIN')
      this.enabled = enabled
      this.collector.setEnabled(enabled)
      await this.flush()
      return this.get()
    } finally { this.settingsBusy = false }
  }
  @Remote
  async setAutoAllocationEnabled(enabled: boolean): Promise<DiagnosticsView> {
    if (typeof enabled !== 'boolean') throw new Error('COPILOT_DIAGNOSTICS_INVALID_CONTROL')
    if (this.settingsBusy) throw new Error('COPILOT_DIAGNOSTICS_CONTROL_BUSY')
    if (enabled && !this.domain) throw new Error('COPILOT_DIAGNOSTICS_STORAGE_UNAVAILABLE')
    this.settingsBusy = true
    try {
      const settings = this.ctx.get('settings')
      const row = settings?.describe({ redactSecrets: true }).find(item => item.ns === 'github-copilot')
      if (!settings || !row) throw new Error('COPILOT_DIAGNOSTICS_SETTINGS_UNAVAILABLE')
      await settings.mutate('github-copilot', [{
        op: 'set', path: ['autoAllocationDiagnosticsEnabled'], value: enabled,
      }], row.revision)
      const saved = settings.describe({ redactSecrets: true }).find(item => item.ns === 'github-copilot')?.value
      if (typeof saved !== 'object' || saved === null || !('autoAllocationDiagnosticsEnabled' in saved)
        || saved.autoAllocationDiagnosticsEnabled !== enabled)
        throw new Error('COPILOT_DIAGNOSTICS_SETTINGS_COMMIT_UNCERTAIN')
      this.autoAllocationEnabled = enabled
      this.collector.setAutoAllocationEnabled(enabled && this.state === 'ready')
      await this.flush()
      return this.get()
    } finally { this.settingsBusy = false }
  }
  @Remote
  async clear(): Promise<DiagnosticsView> {
    if (!this.domain) throw new Error('COPILOT_DIAGNOSTICS_STORAGE_UNAVAILABLE')
    this.collector.clear()
    await this.flush()
    return this.get()
  }
  @Remote
  async recordClient(batch: ClientDiagnosticsBatch): Promise<DiagnosticsView> {
    const parsed = ClientDiagnosticsBatchSchema.safeParse(batch)
    if (!parsed.success) throw new Error('COPILOT_DIAGNOSTICS_INVALID_CLIENT_REPORT')
    if (!this.enabled || !this.domain || parsed.data.epoch !== this.collector.snapshot().epoch)
      return { ...this.get(), diagnostic: 'client-report-revoked' }
    this.collector.mergeClient(parsed.data.rows)
    this.collector.noteClientGaps(parsed.data.dropped ?? 0, parsed.data.unconfirmed ?? 0)
    return this.get()
  }
}
