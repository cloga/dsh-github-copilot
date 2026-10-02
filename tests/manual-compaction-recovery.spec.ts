import { describe, expect, it } from 'vitest'
import { summarizeOversizedManualInput } from '../src/manual-compaction-recovery.ts'

function message(role: 'user' | 'assistant' | 'tool', text: string, callId?: string) {
  return {
    role,
    content: role === 'assistant' && callId
      ? [{ type: 'tool-call' as const, id: callId, name: 'fixture', arguments: '{}' }]
      : [{ type: 'text' as const, text }],
    ...role === 'tool' ? { toolCallId: callId } : {},
  }
}

describe('explicit oversized manual summary recovery', () => {
  it('reduces an oversized balanced history with bounded complete calls and an unmarked aggregate audit', async () => {
    const calls: Array<{ messages: readonly ReturnType<typeof message>[] }> = []
    const messages = [
      message('user', 'old context '.repeat(85)),
      message('assistant', '', 'call-1'),
      message('tool', 'result '.repeat(85), 'call-1'),
      message('user', 'middle context '.repeat(85)),
      message('user', 'current context '.repeat(85)),
    ]
    const result = await summarizeOversizedManualInput({
      input: { messages },
      inputLimit: 1600,
      estimate: input => JSON.stringify(input).length,
      summarize: async input => {
        calls.push({ messages: input.messages as ReturnType<typeof message>[] })
        return {
          summary: [{ type: 'text' as const, text: `checkpoint-${calls.length}` }],
          provider: 'github-copilot-preview',
          model: 'fixture',
          maxTokens: 200,
          usage: { inputTokens: 10, outputTokens: 5 },
          rawOutput: [{ type: 'text' as const, text: `checkpoint-${calls.length}` }],
          llmStreamCall: true as const,
        }
      },
      makeCheckpoint: summary => message('user', summary.filter(block => block.type === 'text').map(block => block.text).join('\n')),
      signal: new AbortController().signal,
      maxCalls: 12,
    })
    expect(calls.length).toBeGreaterThan(1)
    expect(calls.length).toBeLessThanOrEqual(12)
    expect(calls.every(call => JSON.stringify(call.messages).length < 1600)).toBe(true)
    expect(calls.some(call => call.messages.some(item => item.role === 'assistant' && item.content[0]?.type === 'tool-call')
      && call.messages.some(item => item.role === 'tool'))).toBe(true)
    expect(result.summary).toEqual([{ type: 'text', text: `checkpoint-${calls.length}` }])
    expect(result.usage).toEqual({ inputTokens: calls.length * 10, outputTokens: calls.length * 5 })
    expect(result).not.toHaveProperty('llmStreamCall')
    expect(result).not.toHaveProperty('rawOutput')
  })

  it('rejects an indivisible span before dispatch and leaves recovery to native failure handling', async () => {
    let calls = 0
    await expect(summarizeOversizedManualInput({
      input: { messages: [message('user', 'x'.repeat(2000))] },
      inputLimit: 500,
      estimate: input => JSON.stringify(input).length,
      summarize: async () => { calls++; throw new Error('should not dispatch') },
      makeCheckpoint: summary => message('user', JSON.stringify(summary)),
      signal: new AbortController().signal,
    })).rejects.toThrow('COPILOT_MANUAL_RECOVERY_INDIVISIBLE')
    expect(calls).toBe(0)
  })

  it('rejects unmatched tool calls before dispatch instead of splitting a call and result', async () => {
    let calls = 0
    await expect(summarizeOversizedManualInput({
      input: { messages: [message('user', 'a'), message('assistant', '', 'call-1'), message('user', 'b')] },
      inputLimit: 500,
      estimate: input => JSON.stringify(input).length,
      summarize: async () => { calls++; throw new Error('should not dispatch') },
      makeCheckpoint: summary => message('user', JSON.stringify(summary)),
      signal: new AbortController().signal,
    })).rejects.toThrow('COPILOT_MANUAL_RECOVERY_UNBALANCED')
    expect(calls).toBe(0)
  })

  it('never commits a partial aggregate after cancellation or a failed merge', async () => {
    const abort = new AbortController()
    let calls = 0
    await expect(summarizeOversizedManualInput({
      input: { messages: [message('user', 'x'.repeat(350)), message('user', 'y'.repeat(350))] },
      inputLimit: 600,
      estimate: input => JSON.stringify(input).length,
      summarize: async () => {
        calls++
        if (calls === 2) abort.abort()
        return { summary: [{ type: 'text' as const, text: 'short' }], provider: 'preview', model: 'fixture' }
      },
      makeCheckpoint: summary => message('user', JSON.stringify(summary)),
      signal: abort.signal,
    })).rejects.toThrow()
    expect(calls).toBe(2)
  })

  it('stops at the explicit call bound rather than silently dropping remaining turns', async () => {
    let calls = 0
    await expect(summarizeOversizedManualInput({
      input: { messages: Array.from({ length: 4 }, (_, index) => message('user', `${index}${'x'.repeat(300)}`)) },
      inputLimit: 430,
      maxCalls: 2,
      estimate: input => JSON.stringify(input).length,
      makeCheckpoint: () => message('user', 'prior'),
      summarize: async () => {
        calls++
        return { summary: [{ type: 'text' as const, text: 'prior' }], provider: 'preview', model: 'fixture' }
      },
      signal: new AbortController().signal,
    })).rejects.toThrow('COPILOT_MANUAL_RECOVERY_CALL_LIMIT')
    expect(calls).toBe(2)
  })

  it('propagates a truncated summary instead of building a checkpoint from partial output', async () => {
    await expect(summarizeOversizedManualInput({
      input: { messages: [message('user', 'a')] },
      inputLimit: 430,
      estimate: input => JSON.stringify(input).length,
      makeCheckpoint: () => message('user', 'prior'),
      summarize: async () => { throw new Error('summarization truncated at the token cap (incomplete checkpoint)') },
      signal: new AbortController().signal,
    })).rejects.toThrow('summarization truncated at the token cap')
  })
})
