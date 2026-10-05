import { COPILOT_ACCOUNT_ID_PATTERN } from './copilot-accounts-types.ts'
import type { CopilotAccountIdentity } from './copilot-accounts-types.ts'

export const SESSION_ACCOUNTS_MAX = 2048
export interface SessionAccountPreference { readonly sessionId: string; readonly accountId: string }
export interface SessionAccountSelection { readonly accountId: string; readonly source: 'global' | 'session' }
export interface TurnAccountEvidence extends SessionAccountSelection { readonly identity?: CopilotAccountIdentity }
interface Admission extends SessionAccountSelection { readonly turn: number; readonly signal: AbortSignal }
function invalid(): never { throw new Error('COPILOT_SESSION_ACCOUNTS_INVALID') }

export function parseSessionAccounts(value: unknown): readonly SessionAccountPreference[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > SESSION_ACCOUNTS_MAX) invalid()
  const seen = new Set<string>()
  return value.map(row => {
    if (typeof row !== 'object' || row === null || Array.isArray(row)
      || Object.keys(row).some(key => key !== 'sessionId' && key !== 'accountId')
      || typeof row.sessionId !== 'string' || !row.sessionId || row.sessionId.length > 256
      || /[\p{Cc}\p{Cf}]/u.test(row.sessionId) || seen.has(row.sessionId)
      || typeof row.accountId !== 'string' || !COPILOT_ACCOUNT_ID_PATTERN.test(row.accountId)) invalid()
    seen.add(row.sessionId)
    return Object.freeze({ sessionId: row.sessionId, accountId: row.accountId })
  })
}
export function resolveSessionAccount(
  sessionId: string, preferences: readonly SessionAccountPreference[], globalAccountId: string,
): SessionAccountSelection {
  if (!COPILOT_ACCOUNT_ID_PATTERN.test(globalAccountId)) invalid()
  const explicit = preferences.find(row => row.sessionId === sessionId)
  return Object.freeze({ accountId: explicit?.accountId ?? globalAccountId, source: explicit ? 'session' : 'global' })
}

/** Active turns are never evicted; bounded historical evidence may become unknown. */
export class SessionAccountTurns {
  private readonly active = new Map<object, Admission>()
  private readonly signals = new WeakMap<AbortSignal, { agent: object; admission: Admission }>()
  private readonly identities = new WeakMap<Admission, CopilotAccountIdentity>()
  private readonly history = new Map<object, Map<number, TurnAccountEvidence>>()
  admit(agent: object, turn: number, signal: AbortSignal, selection: SessionAccountSelection): Admission {
    if (!Number.isSafeInteger(turn) || turn < 0 || signal.aborted) throw new Error('COPILOT_SESSION_ACCOUNT_TURN_INVALID')
    const previous = this.active.get(agent)
    if (previous) {
      if (previous.turn !== turn) throw new Error('COPILOT_SESSION_ACCOUNT_TURN_UNSETTLED')
      if (previous.signal !== signal) throw new Error('COPILOT_SESSION_ACCOUNT_SIGNAL_CHANGED')
      return previous
    }
    const bound = this.signals.get(signal)
    if (bound && bound.agent !== agent) throw new Error('COPILOT_SESSION_ACCOUNT_SIGNAL_CHANGED')
    const admission = Object.freeze({ ...selection, turn, signal })
    this.active.set(agent, admission)
    this.signals.set(signal, { agent, admission })
    return admission
  }
  record(agent: object, turn: number, identity?: CopilotAccountIdentity): void {
    const admission = this.active.get(agent)
    if (!admission || admission.turn !== turn) throw new Error('COPILOT_SESSION_ACCOUNT_TURN_INVALID')
    let turns = this.history.get(agent)
    if (!turns) {
      turns = new Map()
      this.history.set(agent, turns)
      if (this.history.size > 64) this.history.delete(this.history.keys().next().value!)
    }
    if (identity) this.captureIdentity(admission.signal, identity)
    const captured = this.identities.get(admission)
    if (!turns.has(turn)) turns.set(turn, Object.freeze({ accountId: admission.accountId, source: admission.source,
      ...captured ? { identity: captured } : {} }))
    if (turns.size > 128) turns.delete(turns.keys().next().value!)
  }
  current(agent: object): Admission | undefined { return this.active.get(agent) }
  forSignal(signal: AbortSignal): Admission | undefined {
    const entry = this.signals.get(signal)
    return entry && this.active.get(entry.agent) === entry.admission ? entry.admission : undefined
  }
  evidence(agent: object, turn: number): TurnAccountEvidence | undefined { return this.history.get(agent)?.get(turn) }
  end(agent: object, turn: number): void {
    const admission = this.active.get(agent)
    if (admission?.turn !== turn) return
    this.signals.delete(admission.signal)
    this.active.delete(agent)
  }
  remove(agent: object): void {
    const admission = this.active.get(agent)
    if (admission) this.signals.delete(admission.signal)
    this.active.delete(agent)
    this.history.delete(agent)
  }
  clear(): void {
    for (const admission of this.active.values()) this.signals.delete(admission.signal)
    this.active.clear(); this.history.clear()
  }
  recordSignal(signal: AbortSignal, identity?: CopilotAccountIdentity): void {
    const entry = this.signals.get(signal)
    if (entry && this.active.get(entry.agent) === entry.admission) this.record(entry.agent, entry.admission.turn, identity)
  }
  captureIdentity(signal: AbortSignal, identity: CopilotAccountIdentity): void {
    const entry = this.signals.get(signal)
    if (!entry || signal.aborted || this.active.get(entry.agent) !== entry.admission
      || this.identities.has(entry.admission)) return
    const captured = Object.freeze({ ...identity })
    this.identities.set(entry.admission, captured)
    const turns = this.history.get(entry.agent)
    const evidence = turns?.get(entry.admission.turn)
    if (turns && evidence && !evidence.identity) {
      turns.set(entry.admission.turn, Object.freeze({ ...evidence, identity: captured }))
    }
  }
}
