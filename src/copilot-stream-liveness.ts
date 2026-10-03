export class CopilotStreamIdleError extends Error {
  constructor(readonly timeoutMs: number, stage = 'waiting for HTTP response', requestBytes?: number) {
    const size = requestBytes === undefined ? 'Request body size unavailable.'
      : `Request body: ${requestBytes} UTF-8 bytes (not context tokens).`
    super(`COPILOT_STREAM_IDLE_TIMEOUT: No HTTP response or nonempty response-body bytes for ${timeoutMs}ms while ${stage}. ${size} Native retry ownership is unchanged; no history was trimmed or model switched.`)
    this.name = 'CopilotStreamIdleError'
  }
}

/** A request-local byte-idle bound; the native adapter separately bounds semantic silence. */
export class CopilotStreamLiveness {
  private readonly controller = new AbortController()
  private timer: ReturnType<typeof setTimeout> | undefined
  private disposed = false
  private paused = false
  private stage = 'waiting for HTTP response'
  private requestBytes: number | undefined
  readonly signal: AbortSignal

  constructor(private readonly timeoutMs: number, upstream: AbortSignal) {
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647) {
      throw new Error('COPILOT_STREAM_IDLE_INTERVAL_INVALID')
    }
    this.signal = AbortSignal.any([upstream, this.controller.signal])
    this.signal.addEventListener('abort', this.dispose, { once: true })
    if (this.signal.aborted) this.dispose()
    this.pulse()
  }

  pulse(): void {
    if (this.disposed || this.paused || this.signal.aborted) return
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.controller.abort(new CopilotStreamIdleError(
      this.timeoutMs, this.stage, this.requestBytes,
    )), this.timeoutMs)
  }

  beginRequest(body?: string): void {
    this.stage = 'waiting for HTTP response'
    this.requestBytes = body === undefined ? undefined : Buffer.byteLength(body, 'utf8')
    this.pulse()
  }

  pause(): void {
    this.paused = true
    if (this.timer !== undefined) clearTimeout(this.timer)
  }

  resume(): void {
    this.paused = false
    this.pulse()
  }

  observe(response: Response): Response {
    if (!response.ok || !response.headers.get('content-type')?.toLowerCase().includes('text/event-stream') || response.body === null) {
      return response
    }
    this.stage = 'reading the SSE response body'
    this.pulse()
    const reader = response.body.getReader()
    const owner = this
    let output: ReadableStreamDefaultController<Uint8Array> | undefined
    const onAbort = () => {
      void reader.cancel(owner.signal.reason).catch(error => {
        output?.error(owner.signal.reason ?? error)
      })
    }
    this.signal.addEventListener('abort', onAbort, { once: true })
    if (this.signal.aborted) onAbort()
    return new Response(new ReadableStream<Uint8Array>({
      start(controller) { output = controller },
      async pull(controller) {
        try {
          const next = await reader.read()
          if (next.done) {
            controller.close()
            owner.signal.removeEventListener('abort', onAbort)
            reader.releaseLock()
            owner.dispose()
          } else {
            if (next.value.byteLength > 0) owner.pulse()
            controller.enqueue(next.value)
          }
        } catch (error) {
          owner.dispose()
          owner.signal.removeEventListener('abort', onAbort)
          reader.releaseLock()
          controller.error(error)
        }
      },
      async cancel(reason) {
        owner.dispose()
        owner.signal.removeEventListener('abort', onAbort)
        try { await reader.cancel(reason) } finally { reader.releaseLock() }
      },
    }), { status: response.status, statusText: response.statusText, headers: response.headers })
  }

  dispose = (): void => {
    if (this.disposed) return
    this.disposed = true
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.signal.removeEventListener('abort', this.dispose)
  }
}
