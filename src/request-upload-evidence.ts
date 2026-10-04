import { AsyncLocalStorage } from 'node:async_hooks'
import { channel } from 'node:diagnostics_channel'

export type RequestUploadEvidence = {
  readonly state: 'observed'
  readonly bodyWrite: 'observed' | 'not-observed'
  readonly bodyWriteCompleteMs?: number
  readonly nativeResponseHeadersMs?: number
  readonly alpn: 'h2' | 'http/1.1' | 'unavailable'
  readonly nodeWritableBufferBytes?: number
} | { readonly state: 'unavailable' }
  | { readonly state: 'work-limit' }
  | { readonly state: 'ambiguous'; readonly requestCount: number }

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

/** Observe public native events only; never read request fields, mutate transport or imply remote receipt. */
export function createRequestUploadObserver(): {
  run<T>(operation: () => T): T
  snapshot(): RequestUploadEvidence
  close(): void
} {
  const scope = new AsyncLocalStorage<object>(), token = {}, requests = new WeakMap<object, number>()
  let startedAt: number | undefined
  let requestCount = 0, closed = false, bodyWrite = false
  let bodyWriteCompleteMs: number | undefined, nativeResponseHeadersMs: number | undefined
  let socket: Record<string, unknown> | undefined
  let connectionAmbiguous = false, socketBoundToRequest = false
  let alpn: 'h2' | 'http/1.1' | 'unavailable' = 'unavailable', nodeWritableBufferBytes: number | undefined
  const elapsed = (): number | undefined => startedAt === undefined ? undefined
    : count(Math.round(performance.now() - startedAt))
  const request = (data: unknown): number | undefined =>
    !closed && object(data) && object(data.request) ? requests.get(data.request) : undefined
  const connected = (data: unknown, boundToRequest = false): void => {
    if (closed || !object(data) || !object(data.socket)) return
    if (!boundToRequest) {
      if (socketBoundToRequest || connectionAmbiguous) return
      if (socket !== undefined && socket !== data.socket) {
        connectionAmbiguous = true
        socket = undefined
        alpn = 'unavailable'
        nodeWritableBufferBytes = undefined
        return
      }
    }
    socketBoundToRequest = boundToRequest
    socket = data.socket
    alpn = socket.encrypted === true && (socket.alpnProtocol === 'h2' || socket.alpnProtocol === 'http/1.1')
      ? socket.alpnProtocol : 'unavailable'
  }
  const handlers: Readonly<Record<string, (data: unknown) => void>> = {
    'undici:request:create': data => {
      if (closed || scope.getStore() !== token || !object(data) || !object(data.request)) return
      if (requests.has(data.request) || requestCount > 8) return
      requestCount++
      if (requestCount <= 8) requests.set(data.request, requestCount)
    },
    'undici:client:connected': data => {
      if (scope.getStore() === token && requestCount === 1) connected(data)
    },
    'undici:client:sendHeaders': data => {
      if (request(data) === 1) connected(data, true)
    },
    'undici:request:bodySent': data => {
      if (request(data) !== 1 || bodyWrite) return
      bodyWrite = true
      bodyWriteCompleteMs = elapsed()
      nodeWritableBufferBytes = count(socket?.writableLength)
    },
    'undici:request:headers': data => {
      if (request(data) === 1 && nativeResponseHeadersMs === undefined) nativeResponseHeadersMs = elapsed()
    },
  }
  for (const [name, handler] of Object.entries(handlers)) channel(name).subscribe(handler)
  return {
    run: operation => {
      if (closed) throw new Error('COPILOT_UPLOAD_OBSERVER_CLOSED')
      startedAt ??= performance.now()
      return scope.run(token, operation)
    },
    snapshot: () => {
      if (requestCount === 0) return { state: 'unavailable' }
      if (requestCount > 8) return { state: 'work-limit' }
      if (requestCount !== 1) return { state: 'ambiguous', requestCount }
      return {
        state: 'observed', bodyWrite: bodyWrite ? 'observed' : 'not-observed', alpn,
        ...bodyWriteCompleteMs === undefined ? {} : { bodyWriteCompleteMs },
        ...nativeResponseHeadersMs === undefined ? {} : { nativeResponseHeadersMs },
        ...nodeWritableBufferBytes === undefined ? {} : { nodeWritableBufferBytes },
      }
    },
    close: () => {
      if (closed) return
      closed = true
      for (const [name, handler] of Object.entries(handlers)) channel(name).unsubscribe(handler)
      socket = undefined
      scope.disable()
    },
  }
}

export function formatRequestUploadEvidence(evidence: RequestUploadEvidence | undefined): string {
  if (evidence === undefined || evidence.state === 'unavailable') {
    return 'Client transport evidence unavailable (no matching native diagnostic events).'
  }
  if (evidence.state === 'ambiguous') {
    return `Client transport evidence unavailable (ambiguous: ${evidence.requestCount} native requests; no combined timings).`
  }
  if (evidence.state === 'work-limit') return 'Client transport evidence unavailable (work-limit; no partial timings).'
  const body = evidence.bodyWrite === 'not-observed'
    ? 'local body-write completion not observed (not proof of incomplete upload)'
    : evidence.bodyWriteCompleteMs === undefined ? 'local body-write completion observed; timing unavailable'
      : `local body-write complete at ${evidence.bodyWriteCompleteMs} ms`
  const headers = evidence.nativeResponseHeadersMs === undefined ? 'native response-header timing unavailable'
    : `native response headers at ${evidence.nativeResponseHeadersMs} ms`
  const buffer = evidence.nodeWritableBufferBytes === undefined ? 'Node writable-buffer count unavailable'
    : `Node writable buffer at local body-write completion ${evidence.nodeWritableBufferBytes} bytes`
  return `Client transport evidence: ${body}; ${headers}; TLS ALPN ${evidence.alpn}; ${buffer}. Local submission only, not upload duration, kernel ACK, supplier receipt or execution.`
}
