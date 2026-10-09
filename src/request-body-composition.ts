import { setImmediate as yieldToHost } from 'node:timers/promises'
import { REQUEST_BODY_EVIDENCE_LIMITS } from './request-body-evidence.ts'
import type { RequestBodyEvidence, RequestBodyProtocol } from './request-body-evidence.ts'

export const REQUEST_BODY_COMPOSITION_LIMITS = Object.freeze({
  ...REQUEST_BODY_EVIDENCE_LIMITS,
  bytes: 32 * 1024 * 1024,
  sliceCharacters: 65536,
  elapsedMs: 2000,
  concurrent: 4,
})
type Location = 'root' | 'conversation' | 'content' | 'other'
type State = 'invalid-json' | 'work-limit' | 'cancelled' | 'time-limit'
type Span = {
  kind: 'object' | 'array' | 'string' | 'scalar'
  start: number
  end: number
  text?: string
  type?: string
  strings?: Set<string>
  image: number
  replay: number
}
class ScanError extends Error {
  constructor(readonly state: State) { super(state) }
}
let activeScans = 0

/** Only bounded keys/discriminators are decoded; payload values never form an object graph. */
export async function requestBodyComposition(
  payload: string | undefined, protocol: RequestBodyProtocol,
  options: { signal?: AbortSignal; isCurrent?: () => boolean } = {},
): Promise<RequestBodyEvidence> {
  if (payload === undefined) return { state: 'unavailable' }
  const body = payload
  const totalBytes = Buffer.byteLength(body, 'utf8')
  if (totalBytes > REQUEST_BODY_COMPOSITION_LIMITS.bytes) return { state: 'size-limit', totalBytes }
  if (activeScans >= REQUEST_BODY_COMPOSITION_LIMITS.concurrent) return { state: 'work-limit', totalBytes }
  activeScans++
  const startedAt = performance.now()
  let position = 0, nextYield = 0, values = 0, tokens = 0
  let conversationBytes = 0, toolSchemaBytes = 0, systemBytes = 0, imageBlockBytes = 0, opaqueReplayBytes = 0
  let conversationArray = false
  const conversationKey = protocol === 'openai-responses' ? 'input' : 'messages'
  const systemKey = protocol === 'openai-responses' ? 'instructions' : protocol === 'anthropic-messages' ? 'system' : undefined
  const check = () => {
    if (options.signal?.aborted || options.isCurrent?.() === false) throw new ScanError('cancelled')
    if (performance.now() - startedAt >= REQUEST_BODY_COMPOSITION_LIMITS.elapsedMs) throw new ScanError('time-limit')
  }
  function* checkpoint(): Generator<void> {
    if (position >= nextYield) {
      nextYield = position + REQUEST_BODY_COMPOSITION_LIMITS.sliceCharacters
      yield
      check()
    }
  }
  const bytes = (span: Span) => Buffer.byteLength(body.slice(span.start, span.end), 'utf8')
  const blank = (code: number) => code === 32 || code === 9 || code === 10 || code === 13
  function* whitespace(): Generator<void> {
    while (blank(body.charCodeAt(position))) {
      position++
      if (position >= nextYield) yield* checkpoint()
    }
  }
  function* string(decode: boolean, key = false): Generator<void, Span> {
    if (++tokens > REQUEST_BODY_COMPOSITION_LIMITS.tokens) throw new ScanError('work-limit')
    const start = position++
    while (position < body.length) {
      if (position >= nextYield) yield* checkpoint()
      const code = body.charCodeAt(position++)
      if (code === 34) {
        if (key && position - start > REQUEST_BODY_COMPOSITION_LIMITS.keyCharacters) throw new ScanError('work-limit')
        const span: Span = { kind: 'string', start, end: position, image: 0, replay: 0 }
        if (decode && position - start <= REQUEST_BODY_COMPOSITION_LIMITS.keyCharacters) {
          span.text = JSON.parse(body.slice(start, position))
        }
        return span
      }
      if (code < 32) throw new ScanError('invalid-json')
      if (code === 92) {
        const escaped = body[position++]
        if (escaped === 'u') {
          if (!/^[a-fA-F0-9]{4}$/.test(body.slice(position, position + 4))) throw new ScanError('invalid-json')
          position += 4
        } else if (escaped === undefined || !'"\\/bfnrt'.includes(escaped)) throw new ScanError('invalid-json')
      }
      if (key && position - start > REQUEST_BODY_COMPOSITION_LIMITS.keyCharacters) throw new ScanError('work-limit')
    }
    throw new ScanError('invalid-json')
  }
  function* visit(depth: number, location: Location, decode = false): Generator<void, Span> {
    yield* checkpoint()
    if (++values > REQUEST_BODY_COMPOSITION_LIMITS.values || ++tokens > REQUEST_BODY_COMPOSITION_LIMITS.tokens
      || depth > REQUEST_BODY_COMPOSITION_LIMITS.depth) throw new ScanError('work-limit')
    yield* whitespace()
    const start = position, character = body[position]
    if (character === '"') return yield* string(decode)
    if (character === '[') {
      position++
      const result: Span = { kind: 'array', start, end: 0, image: 0, replay: 0 }
      yield* whitespace()
      if (body[position] !== ']') {
        while (true) {
          const child = yield* visit(depth + 1, location)
          result.image += child.image; result.replay += child.replay
          yield* whitespace()
          if (body[position] === ']') break
          if (body[position++] !== ',') throw new ScanError('invalid-json')
        }
      }
      position++; result.end = position
      return result
    }
    if (character === '{') {
      position++
      const result: Span = { kind: 'object', start, end: 0, image: 0, replay: 0, strings: new Set() }
      const seen = new Set<string>()
      let source: Span | undefined, imageUrl: Span | undefined, output: Span | undefined
      let encrypted = 0, signature = 0, redacted = 0
      yield* whitespace()
      if (body[position] !== '}') {
        while (true) {
          if (body[position] !== '"') throw new ScanError('invalid-json')
          const key = (yield* string(true, true)).text!
          if (seen.has(key)) throw new ScanError('invalid-json')
          seen.add(key)
          yield* whitespace()
          if (body[position++] !== ':') throw new ScanError('invalid-json')
          const content = (location === 'conversation' || location === 'content') && key === 'content'
          // A late type discriminator is applied only after the object has been fully validated.
          const possibleOutput = protocol === 'openai-responses' && location === 'conversation' && key === 'output'
          const child = yield* visit(depth + 1, depth === 0 && key === conversationKey ? 'conversation'
            : content || possibleOutput ? 'content' : 'other', key === 'type')
          if (key === 'type') result.type = child.text
          if (child.kind === 'string' && ['data', 'url', 'image_url', 'file_id'].includes(key)) result.strings!.add(key)
          if (key === 'source') source = child
          if (key === 'image_url') imageUrl = child
          if (content && child.kind === 'array') { result.image += child.image; result.replay += child.replay }
          if (possibleOutput && child.kind === 'array') output = child
          if (child.kind === 'string') {
            if (location === 'conversation' && key === 'encrypted_content') encrypted = bytes(child)
            if (location === 'content' && key === 'signature') signature = bytes(child)
            if (location === 'content' && key === 'data') redacted = bytes(child)
          }
          if (depth === 0) {
            if (key === conversationKey) {
              conversationArray = child.kind === 'array'
              if (conversationArray) {
                conversationBytes = bytes(child); imageBlockBytes = child.image; opaqueReplayBytes = child.replay
              }
            } else if (child.kind === 'array' && (key === 'tools' || protocol === 'openai-completions' && key === 'functions')) {
              toolSchemaBytes += bytes(child)
            } else if (key === systemKey && (child.kind === 'string' || child.kind === 'array')) systemBytes += bytes(child)
          }
          yield* whitespace()
          if (body[position] === '}') break
          if (body[position++] !== ',') throw new ScanError('invalid-json')
          yield* whitespace()
        }
      }
      position++; result.end = position
      if (output && result.type === 'function_call_output') {
        result.image += output.image; result.replay += output.replay
      }
      const image = location === 'content' && (protocol === 'openai-responses'
        ? result.type === 'input_image' && (result.strings!.has('image_url') || result.strings!.has('file_id'))
        : protocol === 'openai-completions' ? result.type === 'image_url' && imageUrl?.strings?.has('url')
          : result.type === 'image' && source?.kind === 'object'
            && (source.type === 'base64' && source.strings?.has('data') || source.type === 'url' && source.strings?.has('url')))
      if (image) { result.image = bytes(result); result.replay = 0 }
      else if (protocol === 'openai-responses' && location === 'conversation' && result.type === 'reasoning') result.replay += encrypted
      else if (protocol === 'anthropic-messages' && location === 'content') {
        if (result.type === 'thinking') result.replay += signature
        if (result.type === 'redacted_thinking') result.replay += redacted
      }
      return result
    }
    const literal = ['true', 'false', 'null'].find(value => body.startsWith(value, position))
    if (literal) position += literal.length
    else {
      const numberStart = position
      while (position < body.length && /[0-9eE+.-]/.test(body[position]!)) {
        if (++position - numberStart > 128) throw new ScanError('work-limit')
      }
      if (!/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(body.slice(numberStart, position))) {
        throw new ScanError('invalid-json')
      }
    }
    return { kind: 'scalar', start, end: position, image: 0, replay: 0 }
  }
  function* scan(): Generator<void, RequestBodyEvidence> {
    const root = yield* visit(0, 'root')
    yield* whitespace()
    if (position !== body.length) throw new ScanError('invalid-json')
    if (root.kind !== 'object' || !conversationArray) return { state: 'unsupported-shape', totalBytes }
    const otherBytes = totalBytes - conversationBytes - toolSchemaBytes - systemBytes
    const remainingConversationBytes = conversationBytes - imageBlockBytes - opaqueReplayBytes
    if (otherBytes < 0 || remainingConversationBytes < 0) throw new ScanError('invalid-json')
    return { state: 'complete', totalBytes, conversationBytes, toolSchemaBytes, systemBytes, otherBytes,
      imageBlockBytes, opaqueReplayBytes, remainingConversationBytes }
  }
  try {
    const scanner = scan()
    while (true) {
      const next = scanner.next()
      if (next.done) { check(); return next.value }
      await yieldToHost()
    }
  } catch (error) {
    if (!(error instanceof ScanError)) throw error
    return { state: error.state, totalBytes }
  } finally { activeScans-- }
}
