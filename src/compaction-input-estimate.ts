import type { Message, ToolSchema } from '@deepseek-ai/dsh-llm'
import { createUserMessage } from '@deepseek-ai/dsh-llm'

interface CompactionPlanningInput {
  readonly messages: readonly Message[]
  readonly tools?: readonly ToolSchema[]
}

export function createCompactionTokenEstimator(meter: { estimateMessage(message: Message): number }) {
  const messages = new WeakMap<Message, number>()
  const tools = new WeakMap<readonly ToolSchema[], number>()
  const valid = (value: number): number => {
    if (!Number.isSafeInteger(value) || value < 0)
      throw new Error('COPILOT_MANUAL_RECOVERY_TOKEN_ESTIMATE_INVALID')
    return value
  }
  const price = (message: Message): number => {
    let value = messages.get(message)
    if (value === undefined) {
      value = valid(meter.estimateMessage(message))
      messages.set(message, value)
    }
    return value
  }
  return (input: CompactionPlanningInput): number => {
    let total = 0
    if (input.tools?.length) {
      let value = tools.get(input.tools)
      if (value === undefined) {
        // Price the full schema text conservatively through the same public
        // meter, without inventing a bytes-to-tokens conversion.
        value = price(createUserMessage({ source: { kind: 'user' },
          content: [{ type: 'text', text: JSON.stringify(input.tools) }] }))
        tools.set(input.tools, value)
      }
      total = value
    }
    for (const message of input.messages) total = valid(total + price(message))
    return total
  }
}

interface CompactionPlanningMessage {
  readonly role: string
  readonly content: readonly { readonly type: string; readonly id?: string }[]
  readonly toolCallId?: string
}

export function compactionSafeBoundaries(messages: readonly CompactionPlanningMessage[]): readonly number[] {
  const pending = new Set<string>()
  const boundaries = [0]
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index]!
    if (message.role === 'assistant') {
      for (const block of message.content) {
        if (block.type !== 'tool-call') continue
        if (!block.id || pending.has(block.id)) throw new Error('COPILOT_MANUAL_RECOVERY_UNBALANCED')
        pending.add(block.id)
      }
    }
    if (message.role === 'tool' && (!message.toolCallId || !pending.delete(message.toolCallId)))
      throw new Error('COPILOT_MANUAL_RECOVERY_UNBALANCED')
    if (pending.size === 0) boundaries.push(index + 1)
  }
  if (pending.size !== 0) throw new Error('COPILOT_MANUAL_RECOVERY_UNBALANCED')
  return boundaries
}

/**
 * Conservative content-byte planning, not provider-exact token accounting.
 * Native admission still checks converted replay, images and the full request.
 */
export function estimateCompactionInputBytes(input: {
  readonly messages: readonly Message[]
  readonly tools?: readonly ToolSchema[]
}): number {
  return Buffer.byteLength(JSON.stringify({
    tools: input.tools,
    messages: input.messages.map(message => ({
      role: message.role,
      content: message.content,
      ...message.role === 'tool'
        ? { toolCallId: message.toolCallId, isError: message.isError }
        : {},
    })),
  }), 'utf8')
}

export function reduceCompactionInputLimit(
  input: CompactionPlanningInput,
  inputLimit: number,
  estimate: (input: CompactionPlanningInput) => number = estimateCompactionInputBytes,
): number {
  const originalSize = estimate(input)
  const fixedSize = estimate({
    tools: input.tools,
    messages: input.messages[0]?.role === 'system' ? input.messages.slice(0, 1) : [],
  })
  const prefix = input.messages[0]?.role === 'system' ? input.messages.slice(0, 1) : []
  const messages = input.messages.slice(prefix.length)
  let start = 0
  let minimum = fixedSize
  for (const end of compactionSafeBoundaries(messages).slice(1)) {
    minimum = Math.max(minimum, estimate({
      tools: input.tools, messages: [...prefix, ...messages.slice(start, end)],
    }))
    start = end
  }
  // Keep the smallest balanced units viable, but never resubmit the rejected
  // input unchanged when only one indivisible unit remains.
  if (minimum >= originalSize) throw new Error('COPILOT_MANUAL_RECOVERY_INDIVISIBLE')
  return Math.min(inputLimit, Math.max(minimum, fixedSize + Math.floor((originalSize - fixedSize) / 2)))
}
