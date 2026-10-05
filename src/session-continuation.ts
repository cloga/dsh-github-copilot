import { createHash } from 'node:crypto'

export const SESSION_CONTINUATION_LIMITS = Object.freeze({ items: 4096, values: 65536, depth: 64, bytes: 16 * 1024 * 1024 })
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function fingerprint(item: unknown): string | undefined {
  if (!record(item)) throw new Error('COPILOT_CONTINUATION_INVALID_PAYLOAD')
  if (item.type !== 'reasoning') return undefined
  if (typeof item.encrypted_content !== 'string' || !item.encrypted_content
    || item.status !== undefined && item.status !== 'completed') {
    throw new Error('COPILOT_CONTINUATION_UNSUPPORTED_REASONING')
  }
  return createHash('sha256').update(item.encrypted_content).digest('hex')
}

/** One admitted turn; fingerprints never become durable history or account provenance. */
export class SessionContinuationTurn {
  private baseline: ReadonlySet<string> | undefined
  get initialized(): boolean { return this.baseline !== undefined }
  transform(payload: unknown): unknown {
    if (!record(payload) || !Array.isArray(payload.input) || payload.input.length > SESSION_CONTINUATION_LIMITS.values) {
      throw new Error('COPILOT_CONTINUATION_INVALID_PAYLOAD')
    }
    const pending: { value: unknown; depth: number }[] = [{ value: payload, depth: 0 }]
    let values = 0, stringBytes = 0
    while (pending.length) {
      const { value, depth } = pending.pop()!
      if (++values > SESSION_CONTINUATION_LIMITS.values || depth > SESSION_CONTINUATION_LIMITS.depth) {
        throw new Error('COPILOT_CONTINUATION_WORK_LIMIT')
      }
      if (typeof value === 'string') stringBytes += Buffer.byteLength(value)
      else if (Array.isArray(value)) {
        if (pending.length + value.length > SESSION_CONTINUATION_LIMITS.values) throw new Error('COPILOT_CONTINUATION_WORK_LIMIT')
        for (const child of value) pending.push({ value: child, depth: depth + 1 })
      } else if (record(value)) {
        const entries = Object.entries(value)
        if (pending.length + entries.length > SESSION_CONTINUATION_LIMITS.values) throw new Error('COPILOT_CONTINUATION_WORK_LIMIT')
        for (const [key, child] of entries) {
          stringBytes += Buffer.byteLength(key)
          pending.push({ value: child, depth: depth + 1 })
        }
      }
      if (stringBytes > SESSION_CONTINUATION_LIMITS.bytes) throw new Error('COPILOT_CONTINUATION_PAYLOAD_LIMIT')
    }
    let bytes: string
    try { bytes = JSON.stringify(payload) } catch { throw new Error('COPILOT_CONTINUATION_INVALID_PAYLOAD') }
    if (Buffer.byteLength(bytes) > SESSION_CONTINUATION_LIMITS.bytes) throw new Error('COPILOT_CONTINUATION_PAYLOAD_LIMIT')
    const hashes = payload.input.map(fingerprint)
    const present = new Set(hashes.filter((value): value is string => value !== undefined))
    if (present.size > SESSION_CONTINUATION_LIMITS.items) throw new Error('COPILOT_CONTINUATION_ITEM_LIMIT')
    this.baseline ??= present
    const input = payload.input.filter((_, index) => hashes[index] === undefined || !this.baseline!.has(hashes[index]!))
    return input.length === payload.input.length ? payload : { ...payload, input }
  }
}
