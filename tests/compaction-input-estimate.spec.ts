import { describe, expect, it } from 'vitest'
import { createAssistantMessage, createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, Message, ToolSchema } from '@deepseek-ai/dsh-llm'
import { estimateCompactionInputBytes, reduceCompactionInputLimit } from '../src/compaction-input-estimate.ts'
import { summarizeOversizedManualInput } from '../src/manual-compaction-recovery.ts'

const checkpoint = [{ type: 'text' as const, text: 'Synthetic checkpoint' }]
const makeCheckpoint = (content: readonly ContentBlock[]): Message => createUserMessage({ source: { kind: 'user' }, content })

describe('compaction content planning', () => {
  it('reduces partitionable history without halving the mandatory fixed tools', () => {
    const messages = Array.from({ length: 4 }, () =>
      createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'x'.repeat(250) }] }))
    const tools: ToolSchema[] = [{ name: 'test', description: 'x'.repeat(2000), parameters: {} }]
    const input = { tools, messages }
    const original = estimateCompactionInputBytes(input)
    const fixed = estimateCompactionInputBytes({ tools, messages: [] })
    const reduced = reduceCompactionInputLimit(input, original + 100)
    expect(reduced).toBe(fixed + Math.floor((original - fixed) / 2))
    expect(reduced).toBeGreaterThan(fixed)
    expect(reduced).toBeLessThan(original)
    expect(reduceCompactionInputLimit(input, 100)).toBe(100)
  })
  it('does not serialize opaque replay or native provenance', () => {
    const message = createAssistantMessage({
      source: { provider: 'test', model: 'test', replayState: { opaque: 'x'.repeat(100000) } },
      content: [{ type: 'text', text: 'visible' }],
    })

    const plain = createAssistantMessage({
      source: { provider: 'different', model: 'different' },
      content: message.content,
    })
    expect(estimateCompactionInputBytes({ messages: [message] }))
      .toBe(estimateCompactionInputBytes({ messages: [plain] }))
    const before = JSON.stringify(message)
    estimateCompactionInputBytes({ messages: [message] })
    expect(JSON.stringify(message)).toBe(before)
  })

  it('does not retry one rejected indivisible input unchanged', () => {
    const input = { messages: [createUserMessage({
      source: { kind: 'user' }, content: [{ type: 'text', text: 'only indivisible input' }],
    })] }
    expect(() => reduceCompactionInputLimit(input, 10000)).toThrow('COPILOT_MANUAL_RECOVERY_INDIVISIBLE')
  })

  it('keeps a large balanced tool pair together when reducing the fallback budget', () => {
    const callId = ToolCallId('synthetic-call')
    const call = createAssistantMessage({
      source: { provider: 'test', model: 'test' },
      content: [{ type: 'tool-call', id: callId, name: 'test', arguments: '{}' }],
    })
    const tool: Message = {
      role: 'tool', id: call.id,
      source: { kind: 'tool', callId },
      toolCallId: callId, isError: true,
      content: [{ type: 'text', text: 'x'.repeat(2000) }],
    }
    const user = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'next' }] })
    const input = { messages: [call, tool, user] }
    expect(reduceCompactionInputLimit(input, 10000))
      .toBe(estimateCompactionInputBytes({ messages: [call, tool] }))
    expect(() => reduceCompactionInputLimit({ messages: [tool, user] }, 10000))
      .toThrow('COPILOT_MANUAL_RECOVERY_UNBALANCED')
    expect(estimateCompactionInputBytes({ messages: [tool] })).toBeGreaterThan(
      estimateCompactionInputBytes({ messages: [{ ...tool, isError: undefined }] }))
  })

  it('does not visit opaque replay accessors', () => {
    const message: Message = {
      role: 'assistant',
      id: createUserMessage({ source: { kind: 'user' }, content: [] }).id,
      source: { kind: 'model', provider: 'test', model: 'test',
        get replayState(): unknown { throw new Error('OPAQUE_REPLAY_VISITED') } },
      content: [{ type: 'text', text: 'visible' }],
    }
    expect(estimateCompactionInputBytes({ messages: [message] })).toBeGreaterThan(0)
    expect(() => JSON.stringify(message)).toThrow('OPAQUE_REPLAY_VISITED')
  })

  it('prices UTF-8 content, tools and tool-result relations', () => {
    const user = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '\u4e2d\u6587' }] })
    expect(estimateCompactionInputBytes({ messages: [user] })).toBe(Buffer.byteLength(JSON.stringify({
      messages: [{ role: 'user', content: user.content }],
    }), 'utf8'))
    const tools: ToolSchema[] = [{ name: 'test', description: 'description', parameters: { type: 'object' } }]
    expect(estimateCompactionInputBytes({ messages: [user], tools }))
      .toBeGreaterThan(estimateCompactionInputBytes({ messages: [user] }))
  })

  it('avoids metadata-driven sixteen-call exhaustion without changing dispatched messages', async () => {
    const messages = Array.from({ length: 24 }, () => createAssistantMessage({
      source: { provider: 'test', model: 'test', replayState: { opaque: 'x'.repeat(8500) } },
      content: [{ type: 'text', text: 'a'.repeat(500) }],
    }))
    const input = { messages }
    const before = JSON.stringify(input)
    const common = {
      input, inputLimit: 10000, maxCalls: 16, signal: new AbortController().signal,
      makeCheckpoint,
    }
    let oldCalls = 0
    await expect(summarizeOversizedManualInput({
      ...common, estimate: candidate => Buffer.byteLength(JSON.stringify(candidate)),
      summarize: async () => { oldCalls++; return { summary: checkpoint, provider: 'test', model: 'test' } },
    })).rejects.toThrow('COPILOT_MANUAL_RECOVERY_CALL_LIMIT')
    expect(oldCalls).toBe(16)
    let calls = 0
    await summarizeOversizedManualInput({
      ...common, makeCheckpoint,
      estimate: estimateCompactionInputBytes,
      summarize: async candidate => {
        expect(estimateCompactionInputBytes(candidate)).toBeLessThanOrEqual(10000)
        for (const message of candidate.messages) {
          const original = messages.find(row => row.id === message.id)
          if (original) expect(message).toBe(original)
        }
        calls++
        return { summary: checkpoint, provider: 'test', model: 'test' }
      },
    })
    expect(calls).toBe(2)
    expect(JSON.stringify(input)).toBe(before)
  })
})
