import { channel } from 'node:diagnostics_channel'
import { createServer } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { createRequestUploadObserver, formatRequestUploadEvidence } from '../src/request-upload-evidence.ts'

const publish = (name: string, value: unknown): void => channel(`undici:${name}`).publish(value)

describe('request-scoped numeric-only native upload evidence', () => {
  it('separates unavailable native events from missing body-write completion and never infers receipt', async () => {
    const observer = createRequestUploadObserver()
    try {
      const response = new Response('PRIVATE_RESPONSE')
      expect(await observer.run(async () => response)).toBe(response)
      expect(observer.snapshot()).toEqual({ state: 'unavailable' })
      expect(formatRequestUploadEvidence(observer.snapshot())).toContain('unavailable')
      const request = { body: 'PRIVATE_BODY', headers: 'PRIVATE_HEADER' }
      await observer.run(async () => {
        publish('request:create', { request })
        publish('request:headers', { request })
      })
      const evidence = observer.snapshot()
      expect(evidence).toMatchObject({ state: 'observed', bodyWrite: 'not-observed', alpn: 'unavailable' })
      const formatted = formatRequestUploadEvidence(evidence)
      expect(formatted).toContain('not proof of incomplete upload')
      expect(formatted).toContain('not upload duration, kernel ACK, supplier receipt or execution')
      expect(JSON.stringify(evidence) + formatted).not.toContain('PRIVATE')
    } finally { observer.close() }
  })

  it('observes H2 through the connected channel without depending on H1-only sendHeaders', async () => {
    const clock = vi.spyOn(performance, 'now')
    clock.mockReturnValue(100)
    const observer = createRequestUploadObserver(), request = {}
    try {
      await observer.run(async () => {
        publish('request:create', { request })
        publish('client:connected', { socket: { encrypted: true, alpnProtocol: 'h2', writableLength: 0, private: 'PRIVATE_SOCKET' } })
        clock.mockReturnValue(200.4)
        publish('request:bodySent', { request })
        clock.mockReturnValue(450.6)
        publish('request:headers', { request })
      })
      expect(observer.snapshot()).toEqual({ state: 'observed', bodyWrite: 'observed',
        bodyWriteCompleteMs: 100, nativeResponseHeadersMs: 351, alpn: 'h2', nodeWritableBufferBytes: 0 })
      const formatted = formatRequestUploadEvidence(observer.snapshot())
      expect(formatted).toContain('local body-write complete at 100 ms')
      expect(formatted).toContain('native response headers at 351 ms')
      expect(formatted).not.toContain('PRIVATE')
    } finally { observer.close(); clock.mockRestore() }
  })

  it('keeps simultaneous scopes independent and ignores foreign broadcasts', async () => {
    const first = createRequestUploadObserver(), second = createRequestUploadObserver()
    const a = {}, b = {}
    try {
      publish('request:create', { request: {} })
      await Promise.all([
        first.run(async () => { publish('request:create', { request: a }); await Promise.resolve(); publish('request:bodySent', { request: a }) }),
        second.run(async () => { publish('request:create', { request: b }); await Promise.resolve(); publish('request:headers', { request: b }) }),
      ])
      expect(first.snapshot()).toMatchObject({ state: 'observed', bodyWrite: 'observed' })
      expect(second.snapshot()).toMatchObject({ state: 'observed', bodyWrite: 'not-observed' })
    } finally { first.close(); second.close() }
  })

  it('does not guess a socket when multiple connections occur inside one request scope', async () => {
    const observer = createRequestUploadObserver(), request = {}
    try {
      await observer.run(async () => {
        publish('request:create', { request })
        publish('client:connected', { socket: { encrypted: true, alpnProtocol: 'h2', writableLength: 0 } })
        publish('client:connected', { socket: { encrypted: true, alpnProtocol: 'http/1.1', writableLength: 12 } })
        publish('request:bodySent', { request })
      })
      expect(observer.snapshot()).toMatchObject({ state: 'observed', bodyWrite: 'observed', alpn: 'unavailable' })
      expect(observer.snapshot()).not.toHaveProperty('nodeWritableBufferBytes')
    } finally { observer.close() }
  })

  it('prefers a request-bound socket and retains only the finished numeric snapshot after close', async () => {
    const observer = createRequestUploadObserver(), request = {}, socket = { encrypted: true, alpnProtocol: 'http/1.1', writableLength: 9 }
    try {
      await observer.run(async () => {
        publish('request:create', { request })
        publish('client:sendHeaders', { request, socket })
        publish('client:connected', { socket: { encrypted: true, alpnProtocol: 'h2', writableLength: 0 } })
        publish('request:bodySent', { request })
      })
      const evidence = observer.snapshot()
      expect(evidence).toMatchObject({ state: 'observed', alpn: 'http/1.1', nodeWritableBufferBytes: 9 })
      observer.close()
      socket.writableLength = 99
      publish('client:sendHeaders', { request, socket: { encrypted: true, alpnProtocol: 'h2' } })
      publish('request:headers', { request })
      expect(observer.snapshot()).toEqual(evidence)
    } finally { observer.close() }
  })

  it('fails explicitly ambiguous or work-limited instead of combining redirects or nested requests', async () => {
    for (const requestCount of [2, 9]) {
      const observer = createRequestUploadObserver()
      try {
        await observer.run(async () => {
          for (let index = 0; index < requestCount; index++) {
            const request = {}
            publish('request:create', { request })
            publish('request:bodySent', { request })
          }
        })
        expect(observer.snapshot()).toEqual(requestCount === 2 ? { state: 'ambiguous', requestCount } : { state: 'work-limit' })
      } finally { observer.close() }
    }
  })

  it('disposes subscriptions on close, preserves errors and snapshots, and rejects reuse', async () => {
    const observer = createRequestUploadObserver(), failure = new Error('SYNTHETIC_NATIVE_FAILURE')
    try {
      await expect(observer.run(async () => { throw failure })).rejects.toBe(failure)
      observer.close()
      observer.close()
      publish('request:create', { request: {} })
      expect(observer.snapshot()).toEqual({ state: 'unavailable' })
      expect(() => observer.run(async () => undefined)).toThrow('COPILOT_UPLOAD_OBSERVER_CLOSED')
    } finally { observer.close() }
  })

  it('ignores duplicate create/completion events and invalid public socket counters', async () => {
    const observer = createRequestUploadObserver(), request = {}
    try {
      await observer.run(async () => {
        publish('request:create', { request })
        publish('request:create', { request })
        publish('client:sendHeaders', { request, socket: { encrypted: false, alpnProtocol: 'h2', writableLength: NaN } })
        publish('request:bodySent', { request })
        publish('request:bodySent', { request })
        publish('request:headers', { request })
      })
      expect(observer.snapshot()).toMatchObject({ state: 'observed', bodyWrite: 'observed', alpn: 'unavailable' })
      expect(observer.snapshot()).not.toHaveProperty('nodeWritableBufferBytes')
      expect(formatRequestUploadEvidence(observer.snapshot())).toContain('Node writable-buffer count unavailable')
    } finally { observer.close() }
  })

  it('observes real Node Fetch without changing body, signal, Response, or installing a dispatcher', async () => {
    const received: Buffer[] = []
    const server = createServer(async (request, response) => {
      for await (const chunk of request) received.push(Buffer.from(chunk))
      response.writeHead(200, { 'content-type': 'text/plain' })
      response.end('native-response')
    })
    const observer = createRequestUploadObserver(), controller = new AbortController()
    const body = '{"synthetic":"' + 'a'.repeat(128 * 1024) + '"}'
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    try {
      const address = server.address()
      if (address === null || typeof address === 'string') throw new Error('LOCAL_SERVER_ADDRESS')
      const response = await observer.run(() => fetch(`http://127.0.0.1:${address.port}`, {
        method: 'POST', body, signal: controller.signal,
      }))
      expect(await response.text()).toBe('native-response')
      expect(Buffer.concat(received).toString()).toBe(body)
      expect(controller.signal.aborted).toBe(false)
      expect(observer.snapshot()).toMatchObject({ state: 'observed', bodyWrite: 'observed', alpn: 'unavailable' })
    } finally {
      observer.close()
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    }
  })

  it('preserves real Fetch cancellation and closes before any later native event', async () => {
    const controller = new AbortController(), failure = new Error('SYNTHETIC_ABORT')
    const server = createServer(async (request) => {
      for await (const _chunk of request) { /* Consume only synthetic local bytes. */ }
      controller.abort(failure)
    })
    const observer = createRequestUploadObserver()
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    try {
      const address = server.address()
      if (address === null || typeof address === 'string') throw new Error('LOCAL_SERVER_ADDRESS')
      await expect(observer.run(() => fetch(`http://127.0.0.1:${address.port}`, {
        method: 'POST', body: 'synthetic', signal: controller.signal,
      })).finally(() => observer.close())).rejects.toBe(failure)
      const evidence = observer.snapshot()
      expect(evidence).toMatchObject({ state: 'observed', bodyWrite: 'observed' })
      publish('request:create', { request: {} })
      expect(observer.snapshot()).toEqual(evidence)
    } finally {
      observer.close()
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    }
  })
})
