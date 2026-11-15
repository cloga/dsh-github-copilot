import type { Context } from '@deepseek-ai/cordis'
import { createGitHubCopilotCredentialStore } from './copilot-auth.ts'
import { GITHUB_COPILOT_CREDENTIAL_KEY, GITHUB_COPILOT_PROVIDER_ID } from './copilot-identity.ts'
import { captureNativeCopilot } from './native-copilot-access.ts'
import type { NativeCopilotSnapshot } from './native-copilot-access.ts'
import { SessionAccountTurns, parseSessionAccounts, resolveSessionAccount, SESSION_ACCOUNTS_MAX } from './session-accounts.ts'
import type { SessionAccountSelection, TurnAccountEvidence } from './session-accounts.ts'
import type { CopilotAccountBinding, CopilotAccountLease } from './copilot-accounts-types.ts'
import { readSettingsNamespace } from './settings-reader.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { githubCopilotSessionAccounts: SessionAccountsHost }
}
interface SessionOwner { readonly session: { readonly id: string } }
interface NativeTurnEvidence {
  readonly session: SessionOwner['session']
  readonly turn: number
  readonly signal: AbortSignal
  readonly accountId: string
  readonly accountKey: string
  readonly model: string
  valid: boolean
  delivered: boolean
  ownsAdmission: boolean
  route?: NativeCopilotSnapshot
}

/** Host-only routing owner; credentials remain in the existing account service. */
export class SessionAccountsHost {
  private readonly history = new Map<object, Map<number, TurnAccountEvidence>>()
  readonly turns = new SessionAccountTurns(this.history)
  private readonly nativeAccountTurns = new SessionAccountTurns(this.history)
  private readonly leases = new Map<object, CopilotAccountLease>()
  private readonly nativeTurns = new Map<object, NativeTurnEvidence>()
  private readonly nativeSignals = new WeakMap<AbortSignal, NativeTurnEvidence>()
  constructor(private readonly ctx: Context) {}
  selected(agent: SessionOwner): SessionAccountSelection {
    const settings = readSettingsNamespace(this.ctx, 'github-copilot')
    if (typeof settings !== 'object' || settings === null) throw new Error('COPILOT_SESSION_ACCOUNTS_SETTINGS_UNAVAILABLE')
    const preferences = parseSessionAccounts('sessionAccounts' in settings ? settings.sessionAccounts : undefined)
    const global = this.ctx.get('githubCopilotAccounts')?.host.capture().accountId
    if (!global) throw new Error('COPILOT_SESSION_ACCOUNTS_UNAVAILABLE')
    return resolveSessionAccount(agent.session.id, preferences, global)
  }
  admit(agent: SessionOwner, turn: number, signal: AbortSignal): CopilotAccountBinding {
    const existing = this.turns.current(agent.session)
    const selected = existing ?? this.selected(agent)
    if (existing) {
      const admission = this.turns.admit(agent.session, turn, signal, selected)
      return this.bindingForAccount(admission.accountId)
    }
    if (this.leases.size >= SESSION_ACCOUNTS_MAX) throw new Error('COPILOT_SESSION_ACCOUNTS_LIMIT')
    const lease = this.ctx.get('githubCopilotAccounts')?.host.acquire(undefined, true, selected.accountId)
    if (!lease) throw new Error('COPILOT_SESSION_ACCOUNTS_UNAVAILABLE')
    try {
      this.turns.admit(agent.session, turn, signal, selected)
      this.leases.set(agent.session, lease)
      this.captureIdentity(signal, selected.accountId)
      return lease.binding
    } catch (error) { lease.release(); throw error }
  }
  admitNative(agent: SessionOwner, turn: number, signal: AbortSignal, accountId: string, model: string): void {
    let binding: CopilotAccountBinding
    try { binding = this.bindingForAccount(accountId) } catch {
      this.ctx.logger.warn('[github-copilot] %s', 'COPILOT_NATIVE_ACCOUNT_EVIDENCE_UNAVAILABLE')
      return
    }
    const existing = this.nativeTurns.get(agent.session)
    if (existing) {
      if (existing.turn === turn && existing.signal === signal && existing.accountId === binding.accountId) return
      this.ctx.logger.warn('[github-copilot] %s', 'COPILOT_NATIVE_ACCOUNT_TURN_CONFLICT')
      return
    }
    if (this.nativeSignals.has(signal)) {
      this.ctx.logger.warn('[github-copilot] %s', 'COPILOT_NATIVE_ACCOUNT_EVIDENCE_SIGNAL_CONFLICT')
      return
    }
    if (this.nativeTurns.size >= SESSION_ACCOUNTS_MAX) {
      this.ctx.logger.warn('[github-copilot] %s', 'COPILOT_NATIVE_ACCOUNT_EVIDENCE_LIMIT')
      return
    }
    const evidence: NativeTurnEvidence = { session: agent.session, turn, signal, accountId: binding.accountId,
      accountKey: binding.key, model, valid: true, delivered: false, ownsAdmission: false }
    this.nativeTurns.set(agent.session, evidence)
    this.nativeSignals.set(signal, evidence)
    void this.qualifyNative(evidence)
  }
  private nativeCurrent(evidence: NativeTurnEvidence): boolean {
    return evidence.valid && !evidence.signal.aborted && this.nativeTurns.get(evidence.session) === evidence
      && this.nativeSignals.get(evidence.signal) === evidence
  }
  private invalidateNative(evidence: NativeTurnEvidence): void {
    evidence.valid = false
    if (evidence.ownsAdmission) this.nativeAccountTurns.end(evidence.session, evidence.turn)
  }
  private async qualifyNative(evidence: NativeTurnEvidence): Promise<void> {
    try {
      const accounts = this.ctx.get('githubCopilotAccounts')
      if (!accounts) throw new Error('COPILOT_SESSION_ACCOUNTS_UNAVAILABLE')
      const [route, credential, matches] = await Promise.all([
        captureNativeCopilot(this.ctx),
        createGitHubCopilotCredentialStore(this.ctx).read(GITHUB_COPILOT_PROVIDER_ID),
        accounts.host.nativeCredentialMatches(evidence.accountId),
      ])
      if (!this.nativeCurrent(evidence)) return
      if (!matches) {
        this.invalidateNative(evidence)
        this.ctx.logger.warn('[github-copilot] %s', 'COPILOT_NATIVE_ACCOUNT_EVIDENCE_MISMATCH')
        return
      }
      if (!route || !route.models.has(evidence.model) || credential?.type !== 'oauth') {
        this.invalidateNative(evidence)
        this.ctx.logger.warn('[github-copilot] %s', 'COPILOT_NATIVE_ACCOUNT_EVIDENCE_UNPROVEN')
        return
      }
      route.assertCurrent()
      this.nativeAccountTurns.admit(evidence.session, evidence.turn, evidence.signal,
        { accountId: evidence.accountId, source: 'global' })
      evidence.ownsAdmission = true
      evidence.route = route
      this.captureIdentity(evidence.signal, evidence.accountId, () => this.nativeCurrent(evidence), this.nativeAccountTurns)
      this.recordNativeEvidence(evidence)
    } catch {
      if (this.nativeCurrent(evidence)) {
        this.invalidateNative(evidence)
        this.ctx.logger.warn('[github-copilot] %s', 'COPILOT_NATIVE_ACCOUNT_EVIDENCE_UNAVAILABLE')
      }
    }
  }
  private recordNativeEvidence(evidence: NativeTurnEvidence): void {
    if (!this.nativeCurrent(evidence) || !evidence.delivered || !evidence.route
      || this.nativeAccountTurns.forSignal(evidence.signal)?.turn !== evidence.turn) return
    try {
      evidence.route.assertCurrent()
      this.nativeAccountTurns.recordSignal(evidence.signal,
        this.ctx.get('githubCopilotAccounts')?.host.cachedIdentity(evidence.accountId))
    } catch {
      this.invalidateNative(evidence)
      this.ctx.logger.warn('[github-copilot] %s', 'COPILOT_NATIVE_ACCOUNT_EVIDENCE_UNAVAILABLE')
    }
  }
  recordNativeRequest(signal: AbortSignal, sessionId: string, model: string): void {
    const evidence = this.nativeSignals.get(signal)
    if (!evidence || !this.nativeCurrent(evidence) || evidence.session.id !== sessionId || evidence.model !== model) return
    evidence.delivered = true
    this.recordNativeEvidence(evidence)
  }
  credentialChanged(key: string): void {
    for (const evidence of this.nativeTurns.values()) {
      if (evidence.valid && (key === GITHUB_COPILOT_CREDENTIAL_KEY || key === evidence.accountKey)) {
        this.invalidateNative(evidence)
      }
    }
  }
  end(session: object, turn: number): void {
    const native = this.nativeTurns.get(session)
    if (native?.turn === turn) {
      this.invalidateNative(native)
      this.nativeSignals.delete(native.signal)
      this.nativeTurns.delete(session)
    }
    if (this.turns.current(session)?.turn !== turn) return
    this.leases.get(session)?.release()
    this.leases.delete(session)
    this.turns.end(session, turn)
  }
  remove(session: object): void {
    const native = this.nativeTurns.get(session)
    if (native) {
      this.invalidateNative(native)
      this.nativeSignals.delete(native.signal)
      this.nativeTurns.delete(session)
    }
    this.nativeAccountTurns.remove(session)
    this.leases.get(session)?.release()
    this.leases.delete(session)
    this.turns.remove(session)
  }
  dispose(): void {
    for (const native of this.nativeTurns.values()) {
      this.invalidateNative(native)
      this.nativeSignals.delete(native.signal)
    }
    this.nativeTurns.clear()
    this.nativeAccountTurns.clear()
    for (const lease of this.leases.values()) lease.release()
    this.leases.clear()
    this.turns.clear()
  }
  bindingForAccount(accountId: string): CopilotAccountBinding {
    const accounts = this.ctx.get('githubCopilotAccounts')
    if (!accounts) throw new Error('COPILOT_SESSION_ACCOUNTS_UNAVAILABLE')
    return accounts.host.captureAccount(accountId)
  }
  private captureIdentity(
    signal: AbortSignal, accountId: string, eligible: () => boolean = () => true, turns = this.turns,
  ): void {
    const accounts = this.ctx.get('githubCopilotAccounts')
    if (!accounts) throw new Error('COPILOT_SESSION_ACCOUNTS_UNAVAILABLE')
    const cached = accounts.host.cachedIdentity(accountId)
    if (cached) {
      if (eligible()) turns.captureIdentity(signal, cached)
      return
    }
    const admission = turns.forSignal(signal)
    // Non-forcing, account-bound lookup never delays native model delivery.
    void accounts.host.ensureIdentityFor(accountId).then(view => {
      if (turns.forSignal(signal) !== admission || signal.aborted || !eligible()) return
      if (view.state === 'error') {
        this.ctx.logger.warn('[github-copilot] %s', view.diagnostic ?? 'COPILOT_ACCOUNTS_IDENTITY_UNAVAILABLE')
        return
      }
      const identity = accounts.host.cachedIdentity(accountId)
      if (identity) turns.captureIdentity(signal, identity)
    }, () => {
      if (turns.forSignal(signal) === admission && !signal.aborted && eligible()) {
        this.ctx.logger.warn('[github-copilot] COPILOT_ACCOUNTS_IDENTITY_UNAVAILABLE')
      }
    })
  }
  recordRequest(signal?: AbortSignal): void {
    const admission = signal === undefined ? undefined : this.turns.forSignal(signal)
    if (admission && signal) this.turns.recordSignal(signal,
      this.ctx.get('githubCopilotAccounts')?.host.cachedIdentity(admission.accountId))
  }
  requestBinding(signal?: AbortSignal): CopilotAccountBinding {
    const exact = signal === undefined ? undefined : this.turns.forSignal(signal)
    if (exact) return this.bindingForAccount(exact.accountId)
    const agents = this.ctx.get('agents')
    const agent = typeof agents?.currentInitiator === 'function' ? agents.currentInitiator() : undefined
    if (agent) {
      const admitted = this.turns.current(agent.session)
      if (admitted) return this.bindingForAccount(admitted.accountId)
      return this.bindingForAccount(this.selected(agent).accountId)
    }
    const binding = this.ctx.get('githubCopilotAccounts')?.host.capture()
    if (!binding) throw new Error('COPILOT_SESSION_ACCOUNTS_UNAVAILABLE')
    return this.bindingForAccount(binding.accountId)
  }
  async set(agent: SessionOwner, accountId: string | null, revision: number,
    observed?: import('./diagnostics-collector.ts').DiagnosticsHandle): Promise<void> {
    const accounts = this.ctx.get('githubCopilotAccounts')
    if (!accounts) throw new Error('COPILOT_SESSION_ACCOUNTS_UNAVAILABLE')
    if (accountId !== null) {
      observed?.stage('identity-validation')
      const binding = this.bindingForAccount(accountId)
      await accounts.host.validateAccount(binding)
    }
    const settings = this.ctx.get('settings')
    if (!settings) throw new Error('COPILOT_SESSION_ACCOUNTS_SETTINGS_UNAVAILABLE')
    const descriptor = settings.describe({ redactSecrets: true }).find(row => row.ns === 'github-copilot')
    if (!descriptor || descriptor.revision !== revision) throw new Error('COPILOT_ACCOUNTS_CONFLICT')
    const value: unknown = descriptor.value
    const previous = parseSessionAccounts(typeof value === 'object' && value !== null && 'sessionAccounts' in value ? value.sessionAccounts : undefined)
    const next = previous.filter(row => row.sessionId !== agent.session.id)
    if (accountId !== null) next.push({ sessionId: agent.session.id, accountId })
    if (next.length > SESSION_ACCOUNTS_MAX) throw new Error('COPILOT_SESSION_ACCOUNTS_LIMIT')
    observed?.stage('cas')
    await settings.mutate('github-copilot', [{ op: 'set', path: ['sessionAccounts'], value: next }], revision)
    observed?.stage('readback')
    const actual = this.selected(agent)
    if (actual.source !== (accountId === null ? 'global' : 'session')
      || accountId !== null && actual.accountId !== accountId) throw new Error('COPILOT_SESSION_ACCOUNTS_COMMIT_UNCERTAIN')
  }
}
