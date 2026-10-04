import { readResponseErrorJson } from './response-error-body.ts'
import { requestBodyEvidence } from './request-body-evidence.ts'

type ReplayFailure = 'scope-mismatch' | 'unsupported' | 'invalid-payload'

const replayDiagnostics: Record<ReplayFailure, string> = {
  'scope-mismatch': 'COPILOT_RESPONSES_REPLAY_SCOPE_MISMATCH: Copilot Responses input references belong to a different connection.',
  unsupported: 'COPILOT_RESPONSES_REPLAY_UNSUPPORTED: Copilot Responses input cannot be replayed safely without connection-scoped references.',
  'invalid-payload': 'COPILOT_RESPONSES_REPLAY_INVALID_PAYLOAD: Copilot Responses payload has an invalid replay structure.',
}

interface ReplayDispatch {
  readonly body?: string
  readonly sessionHeader?: boolean
  readonly clientRequestHeader?: boolean
}

/** Fixed diagnostics and bounded counts only; never retain request or replay content. */
export class CopilotResponsesReplayError extends Error {
  constructor(reason: ReplayFailure = 'unsupported', dispatch?: ReplayDispatch) {
    super(replayDiagnostics[reason] + (reason === 'scope-mismatch' && dispatch !== undefined
      ? ` ${replayDispatchEvidence(dispatch)}` : ''))
    this.name = 'CopilotResponsesReplayError'
  }
}

function replayDispatchEvidence(dispatch: ReplayDispatch): string {
  const presence = (value: boolean | undefined) => value === undefined ? 'unavailable' : value ? 'present' : 'absent'
  const headers = `sessionHeader=${presence(dispatch.sessionHeader)}, clientRequestHeader=${presence(dispatch.clientRequestHeader)}.`
  const evidence = requestBodyEvidence(dispatch.body, 'openai-responses')
  const unavailable = (state: string) => `Replay structure unavailable (${state}); no zero counts inferred. ${headers}`
  if (evidence.state !== 'complete' || dispatch.body === undefined) return unavailable(evidence.state)
  // The shared span validator bounds bytes, depth and work and rejects duplicate keys.
  const payload: unknown = JSON.parse(dispatch.body)
  if (!isRecord(payload) || !Array.isArray(payload.input) || !payload.input.every(isRecord)) {
    return unavailable('unsupported-shape')
  }
  let directIds = 0, references = 0, encryptedReasoning = 0, otherItems = 0
  for (const item of payload.input) {
    if (Object.hasOwn(item, 'id')) directIds++
    if (item.type === 'item_reference') references++
    if (item.type === 'reasoning' && typeof item.encrypted_content === 'string' && item.encrypted_content.length > 0) encryptedReasoning++
    const known = typeof item.type === 'string'
      && ['message', 'reasoning', 'function_call', 'function_call_output', 'item_reference'].includes(item.type)
    const message = item.type === undefined && typeof item.role === 'string'
      && ['user', 'system', 'developer', 'assistant'].includes(item.role)
    if (!known && !message) otherItems++
  }
  const previous = payload.previous_response_id
  const previousResponse = previous === undefined || previous === null || previous === '' ? 'absent'
    : typeof previous === 'string' ? 'present' : 'invalid'
  const store = payload.store === undefined ? 'absent' : typeof payload.store === 'boolean' ? String(payload.store) : 'invalid'
  return `Dispatched Responses structure: items=${payload.input.length}, directIds=${directIds}, references=${references}, encryptedReasoning=${encryptedReasoning}, otherItems=${otherItems}; previousResponse=${previousResponse}, store=${store}; ${headers} Counts do not identify the rejected item or prove opaque replay is portable. History, authorization and native retry policy are unchanged.`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function nonemptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function emptyReasoningShell(item: Record<string, unknown>): boolean {
  return item.type === 'reasoning' && nonemptyString(item.id)
    && (item.status === undefined || item.status === 'completed')
    && Array.isArray(item.summary) && item.summary.length === 0
    && (item.content === undefined || Array.isArray(item.content) && item.content.length === 0)
    && item.encrypted_content === undefined
    && Object.keys(item).every(key => ['type', 'id', 'status', 'summary', 'content', 'encrypted_content'].includes(key))
}

function normalizeItem(item: unknown): Record<string, unknown> | undefined {
  if (!isRecord(item)) throw new CopilotResponsesReplayError('invalid-payload')
  if (item.type === 'item_reference') throw new CopilotResponsesReplayError()
  // A completed, explicitly empty SDK reasoning signature carries no replay content.
  // Unknown fields, partial signatures and any opaque/text content remain fail-closed.
  if (emptyReasoningShell(item)) return undefined

  // These are ordinary instructions, not assistant output replay. Native validation owns them.
  if ((item.type === 'message' || item.type === undefined)
    && (item.role === 'user' || item.role === 'system' || item.role === 'developer')) return item

  // An undefined optional property is absent on the JSON wire. Do not invent a general
  // Responses validator for ID-free items, including future native input variants.
  if (!Object.hasOwn(item, 'id') || item.id === undefined) return item
  if (!nonemptyString(item.id)) throw new CopilotResponsesReplayError('invalid-payload')

  const complete = item.status === undefined || item.status === 'completed'
  const selfContained = complete && (
    (item.type === 'message' && item.role === 'assistant' && Array.isArray(item.content))
    || (item.type === 'function_call' && nonemptyString(item.call_id)
      && nonemptyString(item.name) && typeof item.arguments === 'string')
    || (item.type === 'reasoning' && nonemptyString(item.encrypted_content))
  )
  if (!selfContained) throw new CopilotResponsesReplayError()

  // Only this direct connection-scoped ID changes. Nested content, call pairing,
  // phase and opaque reasoning data retain their exact values and references.
  const normalized = { ...item }
  delete normalized.id
  return normalized
}

/** Normalize only the outgoing managed Responses payload, never stored history/context. */
export function normalizeCopilotResponsesPayload(payload: unknown): unknown {
  try {
    if (!isRecord(payload) || (typeof payload.input !== 'string' && !Array.isArray(payload.input))) {
      throw new CopilotResponsesReplayError('invalid-payload')
    }
    if (payload.previous_response_id !== undefined && payload.previous_response_id !== null
      && payload.previous_response_id !== '') {
      throw new CopilotResponsesReplayError(typeof payload.previous_response_id === 'string' ? 'unsupported' : 'invalid-payload')
    }
    if (typeof payload.input === 'string') return payload

    let changed = false
    const input: Record<string, unknown>[] = []
    for (const item of payload.input) {
      const normalized = normalizeItem(item)
      changed ||= normalized !== item
      if (normalized !== undefined) input.push(normalized)
    }
    return changed ? { ...payload, input } : payload
  } catch (error) {
    if (error instanceof CopilotResponsesReplayError) throw error
    // Unknown input objects may throw from property access; do not expose that content.
    throw new CopilotResponsesReplayError('invalid-payload')
  }
}

interface RetrySnapshot {
  readonly raw: Record<string, unknown>
  readonly normalized: string
  readonly context: string
  readonly signal: AbortSignal
  readonly sessionId: string
  readonly modelId: string
  readonly at: number
}

const retryLifetimeMs = 60_000
const maxRetryBytes = 2 * 1024 * 1024

function cacheBytes(value: unknown): string | undefined {
  let json: string | undefined
  try { json = JSON.stringify(value) } catch { return undefined }
  if (json === undefined || Buffer.byteLength(json, 'utf8') > maxRetryBytes) return undefined
  return json
}

/** A single lease can admit one HTTP-verified retry at a time; it never reads durable history. */
export class ResponsesRetryReplay {
  private snapshot: RetrySnapshot | undefined
  private active = 0
  private disposed = false

  dispose(): void { this.disposed = true; this.snapshot = undefined }
  belongsTo(sessionId: string): boolean { return this.snapshot?.sessionId === sessionId }

  begin(context: unknown, signal?: AbortSignal, sessionId?: string, modelId?: string): ResponsesRetryAttempt {
    const contextBytes = cacheBytes(context)
    const overlapping = this.active++ !== 0
    if (overlapping) this.snapshot = undefined
    const previous = this.snapshot
    if (previous !== undefined && (signal !== previous.signal || signal?.aborted
      || previous.sessionId !== sessionId || previous.modelId !== modelId
      || previous.context !== contextBytes || Date.now() - previous.at >= retryLifetimeMs)) this.snapshot = undefined
    const eligible = contextBytes !== undefined && !overlapping && !this.disposed && !signal?.aborted && this.snapshot
    let candidate: RetrySnapshot | undefined
    let payloadBytes: string | undefined
    let finished = false
    let observed = false
    return {
      normalize: payload => {
        if (this.disposed || signal?.aborted) throw new CopilotResponsesReplayError()
        const rawBytes = cacheBytes(payload)
        let normalized: unknown
        let reused = false
        try {
          normalized = normalizeCopilotResponsesPayload(payload)
        } catch (error) {
          if (!(error instanceof CopilotResponsesReplayError) || !eligible || !isRecord(payload)
            || !Array.isArray(payload.input) || !isRecord(eligible.raw) || !Array.isArray(eligible.raw.input)) {
            this.snapshot = undefined
            throw error
          }
          try {
            const prior = eligible.raw.input
            if (payload.input.length !== prior.length) throw error
            let references = 0
            const restored = payload.input.map((item, index) => {
              if (!isRecord(item) || !Object.hasOwn(item, 'id')) return item
              const original = prior[index]
              if (!isRecord(original) || !nonemptyString(item.id) || original.id !== item.id
                || !['reasoning', 'message', 'function_call'].includes(String(original.type))
                || normalizeItem(original) === original) throw error
              if (item.type === 'item_reference') {
                if (Object.keys(item).length !== 2) throw error
              } else {
                if (item.type !== original.type || Object.keys(item).length >= Object.keys(original).length
                  || Object.entries(item).some(([key, value]) => !Object.hasOwn(original, key)
                    || cacheBytes(value) !== cacheBytes(original[key]))) throw error
              }
              references++
              return original
            })
            if (references === 0 || cacheBytes({ ...payload, input: restored }) !== cacheBytes(eligible.raw)) throw error
          } catch {
            this.snapshot = undefined
            throw error
          }
          normalized = JSON.parse(eligible.normalized) as unknown
          reused = true
        }
        payloadBytes = cacheBytes(normalized)
        candidate = signal === undefined || !sessionId || !modelId || contextBytes === undefined || rawBytes === undefined || payloadBytes === undefined
          ? undefined : { raw: JSON.parse(rawBytes) as Record<string, unknown>, normalized: payloadBytes,
          context: contextBytes, signal, sessionId, modelId, at: Date.now() }
        // Keep the full original request, not a reference-only retry, for a subsequent 408.
        if (reused && eligible) candidate = { ...eligible, at: Date.now() }
        return normalized
      },
      observe: (body, status) => {
        observed = true
        this.snapshot = !this.disposed && !signal?.aborted && this.active === 1 && !overlapping && status === 408
          && candidate !== undefined && body === payloadBytes ? candidate : undefined
      },
      finish: () => {
        if (finished) return
        finished = true
        this.active--
        if (!observed || signal?.aborted || this.disposed || overlapping) this.snapshot = undefined
      },
    }
  }
}

export interface ResponsesRetryAttempt {
  normalize(payload: unknown): unknown
  observe(body: string | undefined, status: number): void
  finish(): void
}

// Exact uncoded provider messages observed in real failures. Do not infer scope
// rejection from arbitrary connection/auth text or expand this into a broad regex.
const scopeMessages = new Set([
  'input item ID does not belong to this connection',
  'input item does not belong to this connection',
])
function isScopeError(body: unknown): boolean {
  if (!isRecord(body)) return false
  const error = Object.hasOwn(body, 'error') ? body.error : body
  if (!isRecord(error) || typeof error.message !== 'string' || !scopeMessages.has(error.message)) return false
  // This exception is for the observed uncoded scope error, not an authentication
  // code/type with coincidentally matching text or a contradictory outer message.
  return (!Object.hasOwn(body, 'message') || body.message === error.message)
    && [body.code, body.type, error.code, error.type]
      .every(value => value === undefined || value === null || value === '')
}

/** Observe a cloned, bounded 401 body; every unknown result retains native auth behavior. */
export async function isCopilotInputItemScopeError(response: Response, signal?: AbortSignal): Promise<boolean> {
  if (response.status !== 401 || signal?.aborted) return false
  const body = await readResponseErrorJson(response, signal)
  return !signal?.aborted && isScopeError(body)
}
