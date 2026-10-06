import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionAccountsHost } from './session-accounts-host.ts'
import type { SessionAccountView, TurnAccountView } from './session-accounts-remote.ts'
import type { CopilotUsageView } from './copilot-usage-types.ts'
import { beginDiagnostics } from './diagnostics-host.ts'
import { diagnosticsReason, diagnosticsOutcome } from './diagnostics-types.ts'

export class SessionAccountController extends TypertRemoteService {
  constructor(ctx: Context, private readonly owner: SessionAccountsHost) { super(ctx, 'githubCopilotSessionAccount') }
  @Remote
  async get(agent: Agent): Promise<SessionAccountView> {
    const selected = this.owner.selected(agent)
    const accounts = this.ctx.get('githubCopilotAccounts')
    if (!accounts) throw new Error('COPILOT_SESSION_ACCOUNTS_UNAVAILABLE')
    const view = await accounts.host.viewForAccount(selected.accountId)
    const latest = this.owner.selected(agent)
    if (latest.accountId !== selected.accountId || latest.source !== selected.source) throw new Error('COPILOT_ACCOUNTS_CHANGED')
    const running = this.owner.turns.current(agent.session)
    return { ...selected, globalAccountId: accounts.host.capture().accountId,
      accounts: view, ...running ? { runningAccountId: running.accountId } : {} }
  }
  @Remote
  async set(agent: Agent, accountId: string | null, revision: number): Promise<SessionAccountView> {
    const operation = beginDiagnostics(this.ctx, accountId === null ? 'account-session-inherit' : 'account-session-select')
    operation?.stage('host-received')
    try {
      await this.owner.set(agent, accountId, revision, operation)
      operation?.stage('readback')
      const result = await this.get(agent)
      const reason = result.accounts.state === 'error' ? diagnosticsReason(new Error(result.accounts.diagnostic)) : 'none'
      operation?.finish(result.accounts.state === 'error' ? diagnosticsOutcome(reason) : 'success', reason)
      return result
    } catch (error) {
      const reason = diagnosticsReason(error)
      operation?.finish(diagnosticsOutcome(reason), reason)
      throw error
    }
  }
  @Remote
  async refreshIdentity(agent: Agent): Promise<SessionAccountView> {
    return this.readIdentity(agent, true)
  }
  @Remote
  async ensureIdentity(agent: Agent): Promise<SessionAccountView> {
    return this.readIdentity(agent, false)
  }
  private async readIdentity(agent: Agent, force: boolean): Promise<SessionAccountView> {
    const selected = this.owner.selected(agent)
    const accounts = this.ctx.get('githubCopilotAccounts')
    if (!accounts) throw new Error('COPILOT_SESSION_ACCOUNTS_UNAVAILABLE')
    const identity = await (force ? accounts.host.refreshIdentityFor(selected.accountId)
      : accounts.host.ensureAccountNamesFor(selected.accountId))
    const latest = await this.get(agent)
    if (latest.accountId !== selected.accountId || latest.source !== selected.source) throw new Error('COPILOT_ACCOUNTS_CHANGED')
    return { ...latest, accounts: identity }
  }
  private async readUsage(agent: Agent, force: boolean): Promise<CopilotUsageView> {
    const selection = this.owner.selected(agent)
    const service = this.ctx.get('githubCopilotUsage')
    if (!service) throw new Error('COPILOT_USAGE_REMOTE_UNAVAILABLE')
    const result = await service.forAccount(this.owner.bindingForAccount(selection.accountId), force)
    const current = this.owner.selected(agent)
    if (current.accountId !== selection.accountId || current.source !== selection.source) throw new Error('COPILOT_ACCOUNTS_CHANGED')
    return result
  }
  @Remote
  usage(agent: Agent): Promise<CopilotUsageView> { return this.readUsage(agent, false) }
  @Remote
  refreshUsage(agent: Agent): Promise<CopilotUsageView> { return this.readUsage(agent, true) }
  @Remote
  turn(agent: Agent, turn: number): TurnAccountView {
    if (!Number.isSafeInteger(turn) || turn < 0) throw new Error('COPILOT_SESSION_ACCOUNT_TURN_INVALID')
    const evidence = this.owner.turns.evidence(agent.session, turn)
    return evidence ? { state: 'recorded', ...evidence } : { state: 'unknown' }
  }
}
