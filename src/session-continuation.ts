import { createHash } from 'node:crypto'
import { setImmediate } from 'node:timers/promises'

export const SESSION_CONTINUATION_LIMITS = Object.freeze({
  items: 4096, inputItems: 65536, ciphertextCodeUnits: 64 * 1024 * 1024, chunkCodeUnits: 64 * 1024,
})
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** One admitted turn; fingerprints never become durable history or account provenance. */
export class SessionContinuationTurn {
  private baseline: ReadonlySet<string> | undefined
  private processing = false
  get initialized(): boolean { return this.baseline !== undefined }
  async transform(payload: unknown, assertCurrent: () => void = () => {}): Promise<unknown> {
    assertCurrent()
    if (this.processing) throw new Error('COPILOT_CONTINUATION_PROCESSING_OVERLAP')
    if (!record(payload) || !Array.isArray(payload.input) || payload.input.length > SESSION_CONTINUATION_LIMITS.inputItems) {
      throw new Error('COPILOT_CONTINUATION_INVALID_PAYLOAD')
    }
    this.processing = true
    try {
      const hashes = new Map<number, string>()
      let codeUnits = 0
      for (let index = 0; index < payload.input.length; index++) {
        if (index % 256 === 0) { await setImmediate(); assertCurrent() }
        const item: unknown = payload.input[index]
        if (!record(item)) throw new Error('COPILOT_CONTINUATION_INVALID_PAYLOAD')
        if (item.type !== 'reasoning') continue
        const ciphertext = item.encrypted_content
        if (typeof ciphertext !== 'string' || !ciphertext
          || item.status !== undefined && item.status !== 'completed') {
          throw new Error('COPILOT_CONTINUATION_UNSUPPORTED_REASONING')
        }
        if (hashes.size >= SESSION_CONTINUATION_LIMITS.items) throw new Error('COPILOT_CONTINUATION_ITEM_LIMIT')
        codeUnits += ciphertext.length
        if (codeUnits > SESSION_CONTINUATION_LIMITS.ciphertextCodeUnits) throw new Error('COPILOT_CONTINUATION_REASONING_WORK_LIMIT')
        const hash = createHash('sha256')
        for (let start = 0; start < ciphertext.length;) {
          let end = Math.min(start + SESSION_CONTINUATION_LIMITS.chunkCodeUnits, ciphertext.length)
          // Preserve the whole-string UTF-8 digest at a surrogate-pair boundary.
          const last = ciphertext.charCodeAt(end - 1)
          if (end < ciphertext.length && last >= 0xd800 && last <= 0xdbff) end--
          hash.update(ciphertext.slice(start, end))
          start = end
          await setImmediate()
          assertCurrent()
        }
        hashes.set(index, hash.digest('hex'))
      }
      const baseline = this.baseline ?? new Set(hashes.values())
      const input = payload.input.filter((_, index) => !hashes.has(index) || !baseline.has(hashes.get(index)!))
      const result = input.length === payload.input.length ? payload : { ...payload, input }
      assertCurrent()
      this.baseline ??= baseline
      return result
    } finally {
      this.processing = false
    }
  }
}
