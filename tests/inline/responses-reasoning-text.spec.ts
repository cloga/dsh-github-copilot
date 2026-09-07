import { describe, expect, it } from 'vitest'
import { ResponsesReasoningText } from '../../src/responses-reasoning-text.ts'

describe('public Responses reasoning projection', () => {
  it('reads no encrypted payload or replay metadata', () => {
    const item = Object.defineProperties({ type: 'reasoning', summary: [{ type: 'summary_text', text: 'Public summary.' }] }, {
      encrypted_content: { get() { throw new Error('Encrypted content must not be read') } },
      replayState: { get() { throw new Error('Replay state must not be read') } },
    })
    const text = new ResponsesReasoningText()
    expect(text.snapshot(item)).toBe('Public summary.')
    expect(text.finish()).toBe('')
    expect(text.text).toBe('Public summary.')
  })

  it('preserves repeated delta text while deduplicating cumulative snapshots', () => {
    const text = new ResponsesReasoningText()
    expect(text.update('summary', 0, 'ha', false)).toBe('ha')
    expect(text.update('summary', 0, 'ha', false)).toBe('ha')
    expect(text.update('summary', 0, 'haha', true)).toBe('')
    expect(text.update('summary', 0, 'haha', true)).toBe('')
    expect(text.text).toBe('haha')
  })

  it('keeps cleanup safe after a contradictory completed-part extension', () => {
    const text = new ResponsesReasoningText()
    text.update('summary', 0, 'First.', true)
    text.update('summary', 1, 'Second.', true)
    expect(() => text.update('summary', 0, 'First. CHANGED', true)).toThrow('COPILOT_REASONING_PART_ORDER_CONFLICT')
    expect(() => text.finish()).not.toThrow()
    expect(text.text).toBe('First.\n\nSecond.')
  })

  it('does not reinterpret unknown or encrypted fields as display text', () => {
    const text = new ResponsesReasoningText()
    expect(text.snapshot({ type: 'reasoning', text: 'not a documented public field', encrypted_content: 'synthetic', summary: [{ type: 'encrypted', text: 'synthetic' }], content: [{ type: 'output_text', text: 'wrong item type' }] })).toBe('')
    expect(text.finish()).toBe('')
    expect(text.text).toBe('')
  })
})
