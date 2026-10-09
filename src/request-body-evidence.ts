import type { RequestUploadEvidence } from './request-upload-evidence.ts'
import type { RequestCompressionEvidence } from './responses-request-compression.ts'

export type RequestBodyProtocol = 'openai-responses' | 'openai-completions' | 'anthropic-messages'
export const REQUEST_BODY_EVIDENCE_LIMITS = Object.freeze({
  bytes: 16 * 1024 * 1024,
  values: 65_536,
  tokens: 131_072,
  depth: 64,
  keyCharacters: 128,
})

export type RequestBodyEvidence = {
  readonly state: 'complete'
  readonly totalBytes: number
  readonly conversationBytes: number
  readonly toolSchemaBytes: number
  readonly systemBytes: number
  readonly otherBytes: number
  /** Disjoint subsets of conversationBytes, not additional payload bytes. */
  readonly imageBlockBytes: number
  readonly opaqueReplayBytes: number
  readonly remainingConversationBytes: number
} | {
  readonly state: 'unavailable' | 'size-limit' | 'work-limit' | 'invalid-json' | 'unsupported-shape' | 'cancelled' | 'time-limit'
  readonly totalBytes?: number
}

export interface RequestBodyDispatchEvidence {
  readonly protocol: RequestBodyProtocol
  readonly composition?: Promise<RequestBodyEvidence>
  /** Fetch invocation to response headers, not upload duration or clone-observation time. */
  readonly responseHeadersMs: number
  readonly upload?: RequestUploadEvidence
  readonly compression?: RequestCompressionEvidence
}

export function formatRequestBodyEvidence(
  evidence: RequestBodyEvidence,
  responseHeadersMs?: number,
  compression?: RequestCompressionEvidence,
): string {
  const elapsed = responseHeadersMs === undefined ? undefined : Math.round(responseHeadersMs)
  const timing = responseHeadersMs !== undefined && responseHeadersMs >= 0
    && elapsed !== undefined && Number.isSafeInteger(elapsed)
    ? `Fetch-to-response-headers: ${elapsed} ms (round trip, not upload duration).`
    : 'Fetch-to-response-headers timing unavailable.'
  if (evidence.state !== 'complete') return `Composition unavailable (${evidence.state}); no partial totals inferred. ${timing}`
  const label = compression?.encoding === 'gzip'
    ? 'Original JSON composition (UTF-8 bytes, not gzip wire bytes)'
    : 'Composition (wire UTF-8 bytes)'
  return `${label}: conversation ${evidence.conversationBytes}, tool definitions ${evidence.toolSchemaBytes}, top-level system/instructions ${evidence.systemBytes}, other/framing ${evidence.otherBytes}. Within conversation (disjoint subsets): image blocks ${evidence.imageBlockBytes}, opaque replay ${evidence.opaqueReplayBytes}, remaining ${evidence.remainingConversationBytes} (text/tool history, framing and unrecognized fields). Image blocks include URLs/references, not decoded image sizes; unknown encodings stay in remaining/other. ${timing}`
}

type JsonObject = { [key: string]: unknown }
type Subsets = { image: number; replay: number }
type Position = 'root' | 'conversation' | 'content' | 'other'
class EvidenceParseError extends Error {
  constructor(readonly state: 'work-limit' | 'invalid-json') { super(state) }
}
function object(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Diagnostic-only traversal of the original JSON spans; never reserializes or changes a request. */
export function requestBodyEvidence(body: string | undefined, protocol: RequestBodyProtocol): RequestBodyEvidence {
  if (body === undefined) return { state: 'unavailable' }
  const totalBytes = Buffer.byteLength(body, 'utf8')
  if (totalBytes > REQUEST_BODY_EVIDENCE_LIMITS.bytes) return { state: 'size-limit', totalBytes }
  // Bound structural allocation before the native JSON parser creates any object graph.
  let nesting = 0, tokens = 0
  for (let index = 0; index < body.length; index++) {
    const character = body[index]
    if (character === '{' || character === '[') {
      if (++nesting > REQUEST_BODY_EVIDENCE_LIMITS.depth) return { state: 'work-limit', totalBytes }
      tokens++
    } else if (character === '}' || character === ']') nesting--
    else if (character === '"') {
      tokens++
      while (++index < body.length) {
        if (body[index] === '\\') index++
        else if (body[index] === '"') break
      }
    } else if (character !== ' ' && character !== '\n' && character !== '\r' && character !== '\t'
      && character !== ':' && character !== ',') {
      tokens++
      while (index + 1 < body.length && !/[\s,\]}]/u.test(body[index + 1]!)) index++
    }
    if (tokens > REQUEST_BODY_EVIDENCE_LIMITS.tokens) return { state: 'work-limit', totalBytes }
  }
  let parsed: unknown
  try { parsed = JSON.parse(body) } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    return { state: 'invalid-json', totalBytes }
  }
  const conversationKey = protocol === 'openai-responses' ? 'input' : 'messages'
  const systemKey = protocol === 'openai-responses' ? 'instructions' : protocol === 'anthropic-messages' ? 'system' : undefined
  if (!object(parsed) || !Array.isArray(parsed[conversationKey])) return { state: 'unsupported-shape', totalBytes }
  let position = 0, values = 0, conversationBytes = 0, toolSchemaBytes = 0, systemBytes = 0
  let imageBlockBytes = 0, opaqueReplayBytes = 0
  const whitespace = () => { while (position < body.length && /\s/u.test(body[position]!)) position++ }
  const bytes = (start: number) => Buffer.byteLength(body.slice(start, position), 'utf8')
  const stringEnd = () => {
    if (body[position++] !== '"') throw new EvidenceParseError('invalid-json')
    while (position < body.length) {
      const character = body[position++]!
      if (character === '"') return
      if (character === '\\') position++
    }
    throw new EvidenceParseError('invalid-json')
  }
  const isImage = (value: JsonObject): boolean => protocol === 'anthropic-messages'
    ? value.type === 'image' && object(value.source)
      && (value.source.type === 'base64' && typeof value.source.data === 'string'
        || value.source.type === 'url' && typeof value.source.url === 'string')
    : protocol === 'openai-responses' ? value.type === 'input_image'
      && (typeof value.image_url === 'string' || typeof value.file_id === 'string')
      : value.type === 'image_url' && object(value.image_url) && typeof value.image_url.url === 'string'
  const isOpaque = (parent: JsonObject, key: string, location: Position): boolean => protocol === 'openai-responses'
    ? location === 'conversation' && parent.type === 'reasoning' && key === 'encrypted_content'
    : location === 'content' && protocol === 'anthropic-messages' && (parent.type === 'thinking' && key === 'signature'
      || parent.type === 'redacted_thinking' && key === 'data')
  const visit = (value: unknown, depth: number, location: Position): Subsets => {
    if (++values > REQUEST_BODY_EVIDENCE_LIMITS.values || depth > REQUEST_BODY_EVIDENCE_LIMITS.depth) {
      throw new EvidenceParseError('work-limit')
    }
    whitespace()
    const start = position
    let image = 0, replay = 0
    if (Array.isArray(value)) {
      if (body[position++] !== '[') throw new EvidenceParseError('invalid-json')
      for (let index = 0; index < value.length; index++) {
        if (index > 0) { whitespace(); if (body[position++] !== ',') throw new EvidenceParseError('invalid-json') }
        const child = visit(value[index], depth + 1, location)
        image += child.image; replay += child.replay
      }
      whitespace()
      if (body[position++] !== ']') throw new EvidenceParseError('invalid-json')
    } else if (object(value)) {
      if (body[position++] !== '{') throw new EvidenceParseError('invalid-json')
      const imageBlock = location === 'content' && isImage(value)
      const seen = new Set<string>()
      whitespace()
      while (body[position] !== '}') {
        if (seen.size > 0) { if (body[position++] !== ',') throw new EvidenceParseError('invalid-json'); whitespace() }
        const keyStart = position
        stringEnd()
        if (position - keyStart > REQUEST_BODY_EVIDENCE_LIMITS.keyCharacters) throw new EvidenceParseError('work-limit')
        const key: unknown = JSON.parse(body.slice(keyStart, position))
        if (typeof key !== 'string' || seen.has(key) || !Object.hasOwn(value, key)) throw new EvidenceParseError('invalid-json')
        seen.add(key)
        whitespace()
        if (body[position++] !== ':') throw new EvidenceParseError('invalid-json')
        whitespace()
        const contentArray = key === 'content' && (location === 'conversation' || location === 'content')
          || protocol === 'openai-responses' && location === 'conversation' && value.type === 'function_call_output'
            && key === 'output'
        const childLocation = imageBlock ? 'other' : depth === 0 && key === conversationKey ? 'conversation'
          : contentArray && Array.isArray(value[key])
            ? 'content' : 'other'
        const childStart = position, child = visit(value[key], depth + 1, childLocation)
        // Only counted spans need encoding work; never repeatedly encode arbitrary nested history.
        const counted = depth === 0 || isOpaque(value, key, location) && typeof value[key] === 'string'
        const childBytes = counted ? bytes(childStart) : 0
        if (depth === 0) {
          if (key === conversationKey) {
            conversationBytes = childBytes; imageBlockBytes = child.image; opaqueReplayBytes = child.replay
          } else if ((key === 'tools' || protocol === 'openai-completions' && key === 'functions')
            && Array.isArray(value[key])) toolSchemaBytes += childBytes
          else if (key === systemKey && (typeof value[key] === 'string' || Array.isArray(value[key]))) {
            systemBytes += childBytes
          }
        }
        image += child.image
        replay += isOpaque(value, key, location) && typeof value[key] === 'string' ? childBytes : child.replay
        whitespace()
      }
      position++
      // Whole image blocks include URLs/file references and JSON framing, not decoded file sizes.
      if (imageBlock) { image = bytes(start); replay = 0 }
    } else if (typeof value === 'string') {
      stringEnd()
    } else {
      while (position < body.length && !/[\s,\]}]/u.test(body[position]!)) position++
      if (position === start) throw new EvidenceParseError('invalid-json')
    }
    return { image, replay }
  }
  try {
    visit(parsed, 0, 'root')
    whitespace()
    if (position !== body.length) return { state: 'invalid-json', totalBytes }
  } catch (cause) {
    if (!(cause instanceof EvidenceParseError)) throw cause
    return { state: cause.state, totalBytes }
  }
  const otherBytes = totalBytes - conversationBytes - toolSchemaBytes - systemBytes
  const remainingConversationBytes = conversationBytes - imageBlockBytes - opaqueReplayBytes
  if (otherBytes < 0 || remainingConversationBytes < 0) return { state: 'invalid-json', totalBytes }
  return { state: 'complete', totalBytes, conversationBytes, toolSchemaBytes, systemBytes, otherBytes,
    imageBlockBytes, opaqueReplayBytes, remainingConversationBytes }
}
