/**
 * Text/tool serialization for the inline wire path, plus server-side web
 * search injection. Reasoning and opaque replay histories remain Core-owned;
 * this limited serializer refuses them instead of inventing Responses items.
 * @module dsh-github-copilot/serialize
 */

import type { GenerateOptions, RequestMessage, ToolSchema } from '@deepseek-ai/dsh-llm'
import { ANTHROPIC_WEB_SEARCH_TOOL_TYPE } from './plan.ts'
import type { ResponsesWebSearchToolType } from './plan.ts'
import type { InlineConfig } from './config.ts'

/** Mapped only after the selected model's native capability checks succeed. */
export interface ResponsesReasoningOptions {
  readonly effort: string
  readonly summary: 'auto'
}

/** Keep Core-owned reasoning provenance and opaque replay state out of this serializer. */
export function hasResponsesReplayContext(messages: readonly RequestMessage[]): boolean {
  return messages.some(message => message.role === 'assistant'
    && ((message.source.kind === 'model' && message.source.replayState !== undefined)
      || ('replayState' in message && message.replayState !== undefined)
      || message.content.some(block => block.type === 'reasoning')))
}

/** Thrown for content whose projection must remain with Core. */
export class UnsupportedContentError extends Error {
  constructor(detail: string) {
    super(`inline web search cannot serialize ${detail}`)
  }
}

/**
 * Stable short hash (FNV-1a variant) for synthesizing item ids.
 * @param input - any string.
 * @returns an 8-character base36 string.
 */
export function shortHash(input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36).padStart(8, '0').slice(0, 8)
}

/**
 * Split a harness call id into the Responses `call_id`/`id` pair. Harness
 * ids produced by the pi-ai adapter carry the `call_id|item_id` shape; ids
 * from other origins get a synthesized item id.
 * @param id - the harness tool-call id.
 * @returns the call id and item id.
 */
export function splitCallId(id: string): { callId: string; itemId: string } {
  const separator = id.indexOf('|')
  if (separator >= 0) return { callId: id.slice(0, separator), itemId: id.slice(separator + 1) }
  return { callId: id, itemId: `fc_${shortHash(id)}` }
}

/**
 * Concatenate the text blocks of a content array.
 * @param content - the message content blocks.
 * @returns the joined text.
 */
function isTextBlock(value: unknown): value is { readonly type: 'text'; readonly text: string } {
  return typeof value === 'object' && value !== null && 'type' in value && value.type === 'text'
    && 'text' in value && typeof value.text === 'string'
}

export function flattenText(content: readonly unknown[]): string {
  return content.filter(isTextBlock).map(block => block.text).join('')
}

interface LegacyToolResult {
  readonly type: 'tool-result'
  readonly toolCallId: string
  readonly isError?: boolean
  readonly content: readonly unknown[]
}

function legacyToolResult(value: unknown): value is LegacyToolResult {
  return typeof value === 'object' && value !== null && 'type' in value && value.type === 'tool-result'
    && 'toolCallId' in value && typeof value.toolCallId === 'string'
    && 'content' in value && Array.isArray(value.content)
}

function legacyToolResults(content: readonly unknown[]): LegacyToolResult[] {
  const results: LegacyToolResult[] = []
  for (const block of content) {
    if (legacyToolResult(block)) results.push(block)
  }
  return results
}

function responsesToolResult(
  result: { readonly toolCallId: string; readonly isError?: boolean; readonly content: readonly unknown[] },
  pairedCallIds?: ReadonlySet<string>,
): unknown[] {
  const callId = splitCallId(result.toolCallId).callId
  if (pairedCallIds !== undefined && !pairedCallIds.has(callId)) return []
  return [{
    type: 'function_call_output',
    call_id: callId,
    output: (result.isError === true ? '[Error] ' : '') + (flattenText(result.content) || '(no output)'),
  }]
}

/** Detect a grounded sandbox denial in either current tool-role or retained legacy message layout. */
export function hasToolResultText(message: RequestMessage, needle: string): boolean {
  if (message.role === 'tool') return flattenText(message.content).includes(needle)
  return message.role === 'user' && legacyToolResults(message.content)
    .some(result => flattenText(result.content).includes(needle))
}

/**
 * Serialize one dsh message into Responses input items.
 * @param message - the harness message.
 * @returns the wire input items; may be empty for content-free messages.
 * @throws UnsupportedContentError for image or Core-owned reasoning/replay content.
 */
export function serializeMessage(message: RequestMessage, pairedCallIds?: ReadonlySet<string>): unknown[] {
  if (hasResponsesReplayContext([message])) {
    throw new UnsupportedContentError('Core-owned reasoning or replay context')
  }
  if (message.role === 'tool') {
    return responsesToolResult(message, pairedCallIds)
  }
  if (message.role === 'user') {
    if (message.content.some(block => block.type === 'image')) {
      throw new UnsupportedContentError('image content')
    }
    const toolResults = legacyToolResults(message.content)
    if (toolResults.length > 0) return toolResults.flatMap(result => responsesToolResult(result, pairedCallIds))
    return [{ role: 'user', content: [{ type: 'input_text', text: flattenText(message.content) }] }]
  }
  if (message.role === 'system') {
    return [{ role: 'user', content: [{ type: 'input_text', text: flattenText(message.content) }] }]
  }
  if (message.role === 'developer') throw new UnsupportedContentError('Core-owned developer tool history')
  const items: unknown[] = []
  for (const block of message.content) {
    const suffix = items.length
    if (block.type === 'text') {
      items.push({
        type: 'message',
        id: `msg_${shortHash(`${message.id}:${suffix}`)}`,
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text: block.text, annotations: [] }],
      })
    } else if (block.type === 'tool-call') {
      const { callId, itemId } = splitCallId(block.id)
      if (pairedCallIds !== undefined && !pairedCallIds.has(callId)) continue
      const replayItemId = /^fc_[A-Za-z0-9_-]{1,61}$/.test(itemId) ? itemId : `fc_${shortHash(itemId)}`
      items.push({
        type: 'function_call',
        call_id: callId,
        id: replayItemId,
        name: block.name,
        arguments: block.arguments,
        status: 'completed',
      })
    }
  }
  return items
}

/**
 * Return call ids that have both an assistant function call and a user tool
 * result. Responses rejects either half when replayed alone, which can happen
 * when a prior provider/tool failure ended the step before persistence wrote
 * the matching result.
 */
export function pairedToolCallIds(messages: readonly RequestMessage[]): ReadonlySet<string> {
  const calls = new Set<string>()
  const results = new Set<string>()
  for (const message of messages) {
    if (message.role === 'tool') results.add(splitCallId(message.toolCallId).callId)
    for (const block of message.content) {
      if (block.type === 'tool-call') calls.add(splitCallId(block.id).callId)
      const candidate: unknown = block
      if (legacyToolResult(candidate)) results.add(splitCallId(candidate.toolCallId).callId)
    }
  }
  return new Set([...calls].filter(callId => results.has(callId)))
}

/** Function-tool names shadowed by server-side web tools; stripped from the wire. */
const SERVER_TOOL_FUNCTION_NAMES = ['web_search', 'open_page', 'find_in_page'] as const

/**
 * Build the wire tools array: function tools (optionally stripped of the
 * variants shadowed by server-side web tools) plus the server-side web
 * search tool in the candidate's verified spelling.
 * @param tools - the harness tool schemas.
 * @param stripServerTools - whether to drop the shadowed function variants.
 * @param webSearchToolType - the Responses spelling the probe verified.
 * @returns the wire tools array.
 */
export function wireTools(
  tools: readonly ToolSchema[] | undefined,
  stripServerTools: boolean,
  webSearchToolType: ResponsesWebSearchToolType,
): unknown[] {
  const mapped: unknown[] = (tools ?? [])
    .filter(tool => !(stripServerTools && (SERVER_TOOL_FUNCTION_NAMES as readonly string[]).includes(tool.name)))
    .map(tool => ({ type: 'function', name: tool.name, description: tool.description, parameters: tool.parameters }))
  mapped.push({ type: webSearchToolType })
  return mapped
}

/**
 * Build the complete Responses request body for one inline call.
 * @param request - the harness request.
 * @param cfg - the wire controls.
 * @param model - the model the plan resolved (config override or the loop's
 *   route model); the same model the capability probe verified.
 * @param webSearchToolType - the Responses spelling the probe verified; the
 *   wire must send exactly the spelling that passed.
 * @returns the JSON body to POST.
 */
export function buildWireBody(
  request: GenerateOptions,
  cfg: Pick<InlineConfig, 'includeSources' | 'stripServerTools'>,
  model: string,
  webSearchToolType: ResponsesWebSearchToolType,
  reasoning?: ResponsesReasoningOptions,
): unknown {
  const input: unknown[] = []
  const pairedCalls = pairedToolCallIds(request.messages)
  if (request.system !== undefined && request.system.length > 0) {
    // The OpenCode Zen/Go gateway projects a `system` role input onto the
    // model's instruction slot, which turns server-side web_search calls
    // into pass-through function_calls that never execute a search (verified
    // 5/5 with a system role vs 3/3 native execution as user input_text).
    // Send the system text as a user input_text — matching serializeMessage's
    // system-history mapping — to keep the gateway on its native path.
    input.push({ role: 'user', content: [{ type: 'input_text', text: request.system }] })
  }
  for (const message of request.messages) input.push(...serializeMessage(message, pairedCalls))
  return {
    model,
    input,
    tools: wireTools(request.tools, cfg.stripServerTools, webSearchToolType),
    ...reasoning === undefined ? {} : { reasoning: { effort: reasoning.effort, summary: reasoning.summary } },
    ...cfg.includeSources ? { include: ['web_search_call.action.sources'] } : {},
    stream: true,
    // The caller's cap is honored (never floored upward); a zero is raised
    // to 1 because providers refuse non-positive caps.
    ...request.maxTokens !== undefined ? { max_output_tokens: Math.max(1, request.maxTokens) } : {},
    ...request.temperature !== undefined ? { temperature: request.temperature } : {},
    ...request.sessionId !== undefined ? { prompt_cache_key: String(request.sessionId).slice(0, 64) } : {},
  }
}

/** Upper bound on server-side web search tool uses per request. */
const ANTHROPIC_WEB_SEARCH_MAX_USES = 5

/**
 * Build the Anthropic Messages wire tools array: function tools (optionally
 * stripped of the `web_search` variant, which shadows the server-side tool)
 * plus the server-side web search tool. Function tools carry no `type`.
 * @param tools - the harness tool schemas.
 * @param stripServerTools - whether to drop the shadowed function variants.
 * @returns the wire tools array.
 */
export function anthropicWireTools(tools: readonly ToolSchema[] | undefined, stripServerTools: boolean): unknown[] {
  const mapped: unknown[] = (tools ?? [])
    .filter(tool => !(stripServerTools && (SERVER_TOOL_FUNCTION_NAMES as readonly string[]).includes(tool.name)))
    .map(tool => ({ name: tool.name, description: tool.description, input_schema: tool.parameters }))
  mapped.push({
    type: ANTHROPIC_WEB_SEARCH_TOOL_TYPE,
    name: 'web_search',
    max_uses: ANTHROPIC_WEB_SEARCH_MAX_USES,
  })
  return mapped
}

/**
 * Serialize one dsh message into Anthropic Messages content items.
 * Assistant messages aggregate their blocks into one content array
 * (reasoning without a usable signature becomes plain text).
 * @param message - the harness message.
 * @returns the Anthropic content items for this message.
 * @throws UnsupportedContentError for image content.
 */
export function serializeAnthropicMessage(message: RequestMessage): unknown[] {
  if (message.role === 'tool') {
    return [{
      role: 'user',
      content: [{
        type: 'tool_result',
        tool_use_id: splitCallId(message.toolCallId).callId,
        content: flattenText(message.content) || '(no output)',
        ...message.isError === true ? { is_error: true } : {},
      }],
    }]
  }
  if (message.role === 'user') {
    if (message.content.some(block => block.type === 'image')) {
      throw new UnsupportedContentError('image content')
    }
    const results = legacyToolResults(message.content)
    if (results.length > 0) {
      return results.map(result => ({
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: splitCallId(result.toolCallId).callId,
          content: flattenText(result.content) || '(no output)',
          ...result.isError === true ? { is_error: true } : {},
        }],
      }))
    }
    return [{ role: 'user', content: [{ type: 'text', text: flattenText(message.content) }] }]
  }
  if (message.role === 'system') {
    return [{ role: 'user', content: [{ type: 'text', text: flattenText(message.content) }] }]
  }
  if (message.role === 'developer') throw new UnsupportedContentError('Core-owned developer tool history')
  const content: unknown[] = []
  for (const block of message.content) {
    if (block.type === 'reasoning') {
      // No usable thinking signature: emit as plain text (mirrors pi-ai's
      // default; real Anthropic endpoints reject unsigned thinking).
      content.push({ type: 'text', text: block.text })
    } else if (block.type === 'text') {
      content.push({ type: 'text', text: block.text })
    } else if (block.type === 'tool-call') {
      const { callId } = splitCallId(block.id)
      let input: unknown
      try {
        input = JSON.parse(block.arguments)
      } catch {
        input = {}
      }
      content.push({
        type: 'tool_use',
        // The tool_use id must match the id the tool_result references on
        // the next round: use the split call id (the whole id when the
        // harness id has no `|` separator, e.g. native Anthropic ids).
        id: callId,
        name: block.name,
        input,
      })
    }
  }
  return [{ role: 'assistant', content }]
}

/**
 * Build the complete Anthropic Messages request body for one inline call.
 * The system prompt goes to the top-level `system` field (unlike the
 * Responses wire, the Anthropic gateway keeps server-side web_search native
 * with a top-level system).
 * @param request - the harness request.
 * @param cfg - the wire controls.
 * @param model - the model the plan resolved (config override or the loop's
 *   route model); the same model the capability probe verified.
 * @returns the JSON body to POST.
 */
export function buildAnthropicWireBody(
  request: GenerateOptions,
  cfg: Pick<InlineConfig, 'stripServerTools'>,
  model: string,
): unknown {
  const messages: unknown[] = []
  for (const message of request.messages) messages.push(...serializeAnthropicMessage(message))
  return {
    model,
    ...request.system !== undefined && request.system.length > 0
      ? { system: [{ type: 'text', text: request.system }] }
      : {},
    messages,
    tools: anthropicWireTools(request.tools, cfg.stripServerTools),
    stream: true,
    // The caller's cap is honored (never floored upward); a zero is raised
    // to 1 because providers refuse non-positive caps.
    max_tokens: Math.max(1, request.maxTokens ?? 4096),
    ...request.temperature !== undefined ? { temperature: request.temperature } : {},
  }
}
