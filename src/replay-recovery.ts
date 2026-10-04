import { createHash, randomUUID } from 'node:crypto'
import { requestBodyEvidence } from './request-body-evidence.ts'
import type { ReplayRecoveryDuration, ReplayRecoveryView } from './replay-recovery-types.ts'

interface Evidence {
  readonly proof: string
  readonly model: string
  readonly hashes: ReadonlySet<string>
  readonly revision: string
  readonly at: number
  enabled: boolean
  duration?: ReplayRecoveryDuration
  turn?: number
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function parsed(body: string | undefined): { input: Record<string, unknown>[]; payload: Record<string, unknown> } {
  if (requestBodyEvidence(body, 'openai-responses').state !== 'complete' || body === undefined) {
    throw new Error('COPILOT_REPLAY_RECOVERY_EVIDENCE_UNAVAILABLE')
  }
  const payload: unknown = JSON.parse(body)
  if (!record(payload) || !Array.isArray(payload.input) || !payload.input.every(record)) {
    throw new Error('COPILOT_REPLAY_RECOVERY_INVALID_PAYLOAD')
  }
  return { input: payload.input, payload }
}
function hash(item: Record<string, unknown>): string | undefined {
  if (item.type !== 'reasoning' || typeof item.encrypted_content !== 'string' || !item.encrypted_content) return undefined
  if (item.status !== undefined && item.status !== 'completed') throw new Error('COPILOT_REPLAY_RECOVERY_INCOMPLETE_ITEM')
  // Fingerprint the complete serialized item, not decoded or durable replay metadata.
  return createHash('sha256').update(JSON.stringify(item)).digest('hex')
}

/** Host-lifetime opt-in only. Stores fingerprints, never request bodies or opaque replay. */
export class ReplayRecoveryStore {
  private readonly owners = new Map<object, Evidence>()
  constructor(private readonly now: () => number = Date.now) {}
  private current(owner: object, proof: string | undefined): Evidence | undefined {
    const state = this.owners.get(owner)
    if (state && (proof !== state.proof || this.now() - state.at >= 3_600_000)) {
      this.owners.delete(owner)
      return undefined
    }
    return state
  }
  view(owner: object, proof: string | undefined): ReplayRecoveryView {
    const state = this.current(owner, proof)
    return state ? { state: state.enabled ? 'enabled' : 'available', revision: state.revision,
      itemCount: state.hashes.size, model: state.model, expiresAt: state.at + 3_600_000,
      ...(state.enabled && state.duration ? { duration: state.duration } : {}) } : { state: 'unavailable' }
  }
  recordFailure(owner: object, proof: string, model: string, body: string | undefined): void {
    const hashes = new Set(parsed(body).input.map(hash).filter((value): value is string => value !== undefined))
    if (!hashes.size) return
    const previous = this.current(owner, proof)
    if (previous?.model === model) for (const value of previous.hashes) hashes.add(value)
    if (hashes.size > 512) throw new Error('COPILOT_REPLAY_RECOVERY_EVIDENCE_LIMIT')
    this.owners.set(owner, { proof, model, hashes, revision: randomUUID(), at: this.now(), enabled: false })
    if (this.owners.size > 64) this.owners.delete(this.owners.keys().next().value!)
  }
  setEnabled(owner: object, proof: string | undefined, revision: string, enabled: boolean): ReplayRecoveryView {
    if (enabled) return this.authorize(owner, proof, revision, 'session')
    const state = this.current(owner, proof)
    if (!state || revision !== state.revision) throw new Error('COPILOT_REPLAY_RECOVERY_STALE_EVIDENCE')
    state.enabled = false
    return this.view(owner, proof)
  }
  authorize(owner: object, proof: string | undefined, revision: string, duration: ReplayRecoveryDuration): ReplayRecoveryView {
    const state = this.current(owner, proof)
    if (!state || revision !== state.revision) throw new Error('COPILOT_REPLAY_RECOVERY_STALE_EVIDENCE')
    state.enabled = true
    state.duration = duration
    delete state.turn
    return this.view(owner, proof)
  }
  endTurn(owner: object, turn: number): void {
    const state = this.owners.get(owner)
    if (state?.duration === 'next-turn' && state.turn === turn) state.enabled = false
  }
  prepare(owner: object, proof: string, model: string, turn?: number): (payload: unknown) => unknown {
    const state = this.current(owner, proof)
    let admitted: ReadonlySet<string> | undefined
    if (state?.enabled && state.model === model) {
      if (state.duration !== 'next-turn') admitted = state.hashes
      else if (turn !== undefined && Number.isSafeInteger(turn) && turn >= 0) {
        state.turn ??= turn
        if (state.turn === turn) admitted = state.hashes
      }
    }
    return payload => {
      if (!admitted) return payload
      if (this.current(owner, proof) !== state) throw new Error('COPILOT_REPLAY_RECOVERY_REVOKED')
      let body: string | undefined
      try { body = JSON.stringify(payload) } catch { throw new Error('COPILOT_REPLAY_RECOVERY_INVALID_PAYLOAD') }
      const decoded = parsed(body)
      const kept = decoded.input.filter(item => {
        const value = hash(item)
        return value === undefined || !admitted.has(value)
      })
      if (kept.length === decoded.input.length) return payload
      // Operate on the caller's items; JSON validation must not clone unchanged content.
      if (!record(payload) || !Array.isArray(payload.input)) throw new Error('COPILOT_REPLAY_RECOVERY_INVALID_PAYLOAD')
      const input = payload.input.filter((_: unknown, index: number) => {
        const item = decoded.input[index]!
        const value = hash(item)
        return value === undefined || !admitted.has(value)
      })
      return { ...payload, input }
    }
  }
  remove(owner: object): void { this.owners.delete(owner) }
  clear(): void { this.owners.clear() }
}
