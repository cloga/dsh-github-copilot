import type { Context } from '@deepseek-ai/cordis'
import { SessionAccountTurns, parseSessionAccounts, resolveSessionAccount, SESSION_ACCOUNTS_MAX } from './session-accounts.ts'
import type { SessionAccountSelection } from './session-accounts.ts'
import type { CopilotAccountBinding, CopilotAccountLease } from './copilot-accounts-types.ts'
import { readSettingsNamespace } from './settings-reader.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { githubCopilotSessionAccounts: SessionAccountsHost }
}
interface SessionOwner { readonly session: { readonly id: string } }

/** Host-only routing owner; credentials remain in the existing account service. */
export class SessionAccountsHost {
  readonly turns = new SessionAccountTurns()
  private readonly leases = new Map<object, CopilotAccountLease>()
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
      return lease.binding
    } catch (error) { lease.release(); throw error }
  }
  end(session: object, turn: number): void {
    if (this.turns.current(session)?.turn !== turn) return
    this.leases.get(session)?.release()
    this.leases.delete(session)
    this.turns.end(session, turn)
  }
  remove(session: object): void {
    this.leases.get(session)?.release()
    this.leases.delete(session)
    this.turns.remove(session)
  }
  dispose(): void {
    for (const lease of this.leases.values()) lease.release()
    this.leases.clear()
    this.turns.clear()
  }
  bindingForAccount(accountId: string): CopilotAccountBinding {
    const accounts = this.ctx.get('githubCopilotAccounts')
    if (!accounts) throw new Error('COPILOT_SESSION_ACCOUNTS_UNAVAILABLE')
    return accounts.host.captureAccount(accountId)
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
  async set(agent: SessionOwner, accountId: string | null, revision: number): Promise<void> {
    const accounts = this.ctx.get('githubCopilotAccounts')
    if (!accounts) throw new Error('COPILOT_SESSION_ACCOUNTS_UNAVAILABLE')
    if (accountId !== null) {
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
    await settings.mutate('github-copilot', [{ op: 'set', path: ['sessionAccounts'], value: next }], revision)
    const actual = this.selected(agent)
    if (actual.source !== (accountId === null ? 'global' : 'session')
      || accountId !== null && actual.accountId !== accountId) throw new Error('COPILOT_SESSION_ACCOUNTS_COMMIT_UNCERTAIN')
  }
}
