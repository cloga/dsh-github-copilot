/** Public Responses reasoning text only; encrypted replay payloads are never read. */
type Family = 'summary' | 'raw'
interface Part { text: string; done: boolean }

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function responseIndex(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

/**
 * Append-only public text for one output item. Snapshots complete streamed
 * prefixes rather than repeating them. If both public representations occur,
 * stream the first and retain the other until item end so an identical mirror
 * can be omitted without dropping a distinct public summary.
 */
export class ResponsesReasoningText {
  private family: Family | undefined
  private readonly parts = new Map<Family, Map<number, Part>>()
  private emitted = ''
  private finished = false

  get text(): string { return this.emitted }

  private render(family: Family, complete = false): string {
    const texts: string[] = []
    let expected = 0
    for (const [index, part] of [...(this.parts.get(family)?.entries() ?? [])].sort(([a], [b]) => a - b)) {
      // Later parts cannot be inserted before text already emitted for an
      // earlier unfinished part. Buffer them until its boundary or item end.
      if (!complete && index !== expected) break
      if (part.text.trim().length > 0) texts.push(part.text)
      expected++
      if (!complete && !part.done) break
    }
    return texts.join('\n\n')
  }

  update(family: Family, index: unknown, value: unknown, done: boolean): string {
    const partIndex = index === undefined ? 0 : responseIndex(index)
    if (this.finished || partIndex === undefined || typeof value !== 'string' || (value.length === 0 && !done)) return ''
    const parts = this.parts.get(family) ?? new Map<number, Part>()
    const part = parts.get(partIndex) ?? { text: '', done: false }
    if (!done && part.done) return ''
    if (done) {
      if (value.startsWith(part.text)) part.text = value
      else if (!part.text.startsWith(value)) throw new Error('COPILOT_REASONING_SNAPSHOT_CONFLICT')
      part.done = true
    } else {
      part.text += value
    }
    parts.set(partIndex, part)
    this.parts.set(family, parts)
    const text = this.render(family)
    if (text.length === 0) return ''
    this.family ??= family
    if (this.family !== family) return ''
    if (!text.startsWith(this.emitted)) throw new Error('COPILOT_REASONING_PART_ORDER_CONFLICT')
    const delta = text.slice(this.emitted.length)
    this.emitted = text
    return delta
  }

  /** Only recognized public text fields are examined; no copying of the item. */
  snapshot(item: unknown): string {
    if (!record(item) || item.type !== 'reasoning') return ''
    let delta = ''
    for (const family of ['summary', 'raw'] as const) {
      const value = family === 'summary' ? item.summary : item.content
      if (!Array.isArray(value)) continue
      for (const [index, part] of value.entries()) {
        if (!record(part) || part.type !== (family === 'summary' ? 'summary_text' : 'reasoning_text')) continue
        delta += this.update(family, index, part.text, true)
      }
    }
    return delta
  }

  /** Flush a distinct secondary representation, including on failure/abort. */
  finish(): string {
    if (this.finished) return ''
    this.family ??= (['summary', 'raw'] as const).find(family => this.render(family, true).length > 0)
    if (this.family === undefined) return ''
    const primary = this.render(this.family, true)
    // A prior update may have rejected a contradictory snapshot. Cleanup must
    // still close the already-emitted prefix without throwing a second error.
    if (!primary.startsWith(this.emitted)) { this.finished = true; return '' }
    const secondary = this.render(this.family === 'summary' ? 'raw' : 'summary', true)
    const text = secondary.trim().length === 0 || secondary.trim() === primary.trim()
      ? primary : `${primary}\n\n${secondary}`
    const delta = text.slice(this.emitted.length)
    this.emitted = text
    this.finished = true
    return delta
  }
}
