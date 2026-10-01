type ReplayFailure = 'scope-mismatch' | 'unsupported' | 'invalid-payload'

const replayDiagnostics: Record<ReplayFailure, string> = {
  'scope-mismatch': 'COPILOT_RESPONSES_REPLAY_SCOPE_MISMATCH: Copilot Responses input references belong to a different connection.',
  unsupported: 'COPILOT_RESPONSES_REPLAY_UNSUPPORTED: Copilot Responses input cannot be replayed safely without connection-scoped references.',
  'invalid-payload': 'COPILOT_RESPONSES_REPLAY_INVALID_PAYLOAD: Copilot Responses payload has an invalid replay structure.',
}

type ReplayDiagnosticReason =
  | 'ITEM_REFERENCE_ONLY' | 'PREVIOUS_RESPONSE_REFERENCE' | 'INCOMPLETE_ITEM'
  | 'REASONING_WITHOUT_ENCRYPTED_CONTENT' | 'INCOMPLETE_ASSISTANT_MESSAGE'
  | 'INCOMPLETE_FUNCTION_CALL' | 'UNKNOWN_ID_BEARING_ITEM' | 'UNSUPPORTED_ID_BEARING_ITEM'

/** Structural facts only; never retain any replay item, identifier or content. */
export interface CopilotReplayDiagnostic {
  readonly reason: ReplayDiagnosticReason
  readonly inputIndex?: number
  readonly itemType?: 'message' | 'reasoning' | 'function_call' | 'function_call_output' | 'item_reference' | 'unknown'
  readonly itemStatus?: 'completed' | 'in_progress' | 'incomplete' | 'absent' | 'unknown'
  readonly hasId?: boolean
  readonly hasContent?: boolean
  readonly hasCallId?: boolean
  readonly hasName?: boolean
  readonly hasArguments?: boolean
  readonly hasEncryptedContent?: boolean
}

/** Fixed and allowlisted diagnostics only: never include provider bodies or replay content. */
export class CopilotResponsesReplayError extends Error {
  readonly diagnostic: Readonly<CopilotReplayDiagnostic> | undefined

  constructor(reason: ReplayFailure = 'unsupported', diagnostic?: CopilotReplayDiagnostic) {
    const suffix = diagnostic === undefined ? '' : ` [${diagnostic.reason}${diagnostic.inputIndex === undefined ? ''
      : `; inputIndex=${diagnostic.inputIndex}; type=${diagnostic.itemType}; status=${diagnostic.itemStatus}; hasId=${diagnostic.hasId}; hasContent=${diagnostic.hasContent}; hasCallId=${diagnostic.hasCallId}; hasName=${diagnostic.hasName}; hasArguments=${diagnostic.hasArguments}; hasEncryptedContent=${diagnostic.hasEncryptedContent}`}]`
    super(replayDiagnostics[reason] + suffix)
    this.name = 'CopilotResponsesReplayError'
    this.diagnostic = diagnostic === undefined ? undefined : Object.freeze({ ...diagnostic })
  }
}

function itemDiagnostic(reason: ReplayDiagnosticReason, item: Record<string, unknown>, inputIndex: number): CopilotReplayDiagnostic {
  const type = item.type
  const status = item.status
  const itemType = type === 'message' || type === 'reasoning' || type === 'function_call'
    || type === 'function_call_output' || type === 'item_reference' ? type : 'unknown'
  const itemStatus = status === undefined ? 'absent' : status === 'completed'
    || status === 'in_progress' || status === 'incomplete' ? status : 'unknown'
  return { reason, inputIndex, itemType, itemStatus,
    hasId: Object.hasOwn(item, 'id') && item.id !== undefined,
    hasContent: Array.isArray(item.content), hasCallId: nonemptyString(item.call_id),
    hasName: nonemptyString(item.name), hasArguments: typeof item.arguments === 'string',
    hasEncryptedContent: nonemptyString(item.encrypted_content) }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function nonemptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function normalizeItem(item: unknown, inputIndex: number): Record<string, unknown> {
  if (!isRecord(item)) throw new CopilotResponsesReplayError('invalid-payload')
  if (item.type === 'item_reference') throw new CopilotResponsesReplayError('unsupported', itemDiagnostic('ITEM_REFERENCE_ONLY', item, inputIndex))

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
  if (!selfContained) {
    const reason: ReplayDiagnosticReason = !complete
      && (item.type === 'reasoning' || item.type === 'message' || item.type === 'function_call') ? 'INCOMPLETE_ITEM'
      : item.type === 'reasoning' ? 'REASONING_WITHOUT_ENCRYPTED_CONTENT'
        : item.type === 'message' ? 'INCOMPLETE_ASSISTANT_MESSAGE'
          : item.type === 'function_call' ? 'INCOMPLETE_FUNCTION_CALL'
            : item.type === 'function_call_output' ? 'UNSUPPORTED_ID_BEARING_ITEM' : 'UNKNOWN_ID_BEARING_ITEM'
    throw new CopilotResponsesReplayError('unsupported', itemDiagnostic(reason, item, inputIndex))
  }

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
      throw new CopilotResponsesReplayError(typeof payload.previous_response_id === 'string' ? 'unsupported' : 'invalid-payload',
        { reason: 'PREVIOUS_RESPONSE_REFERENCE' })
    }
    if (typeof payload.input === 'string') return payload

    let changed = false
    const input: Record<string, unknown>[] = []
    let inputIndex = 0
    for (const item of payload.input) {
      const normalized = normalizeItem(item, inputIndex++)
      changed ||= normalized !== item
      input.push(normalized)
    }
    return changed ? { ...payload, input } : payload
  } catch (error) {
    if (error instanceof CopilotResponsesReplayError) throw error
    // Unknown input objects may throw from property access; do not expose that content.
    throw new CopilotResponsesReplayError('invalid-payload')
  }
}

// Exact uncoded provider messages observed in real failures. Do not infer scope
// rejection from arbitrary connection/auth text or expand this into a broad regex.
const scopeMessages = new Set([
  'input item ID does not belong to this connection',
  'input item does not belong to this connection',
])
const maxErrorBytes = 8 * 1024
const errorReadTimeoutMs = 250

async function readScopeError(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<boolean> {
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let bytes = 0
  let chunks = 0
  let text = ''
  while (true) {
    // Empty, immediately resolved chunks can starve timers; bound work as well as bytes.
    if (chunks++ > maxErrorBytes) return false
    const chunk = await reader.read()
    if (chunk.done) break
    bytes += chunk.value.byteLength
    if (bytes > maxErrorBytes) return false
    text += decoder.decode(chunk.value, { stream: true })
  }
  text += decoder.decode()
  const body: unknown = JSON.parse(text)
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
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  let timeout: ReturnType<typeof setTimeout> | undefined
  let onAbort: (() => void) | undefined
  try {
    const clone = response.clone()
    if (!clone.body) return false
    reader = clone.body.getReader()
    const interrupted = new Promise<boolean>(resolve => {
      onAbort = () => resolve(false)
      signal?.addEventListener('abort', onAbort, { once: true })
      timeout = setTimeout(() => resolve(false), errorReadTimeoutMs)
      if (signal?.aborted) resolve(false)
    })
    const result = await Promise.race([readScopeError(reader), interrupted])
    return !signal?.aborted && result
  } catch {
    return false
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
    if (onAbort) signal?.removeEventListener('abort', onAbort)
    if (reader) {
      // A clone uses a tee: cancellation can wait for the untouched original branch
      // forever. Observe rejection but never await that promise or consume the original.
      try { void reader.cancel().catch(() => {}) } catch { /* Already closed/errored. */ }
      try { reader.releaseLock() } catch { /* A pending read may still own the lock. */ }
    }
  }
}
