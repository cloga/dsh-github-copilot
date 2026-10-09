import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { prepareResponsesRequest, satisfiesCompressionSavings } from '../src/responses-request-compression.ts'

const origin = 'https://api.individual.githubcopilot.com'
const request = `${origin}/responses`
const headers = () => new Headers({ 'content-type': 'application/json' })
const init = (body: BodyInit = JSON.stringify({ input: 'compressible '.repeat(30_000) })): RequestInit => ({
  method: 'POST', headers: headers(), body,
})
const originalInit = init()

describe('managed Responses request compression', () => {
  it('gates on explicit opt-in and caller-owned Fetch without changing original arguments', async () => {
    const disabled = await prepareResponsesRequest(request, originalInit, origin, false, false)
    expect(disabled).toMatchObject({ input: request, init: originalInit, applied: false, reason: 'disabled' })
    const custom = await prepareResponsesRequest(request, originalInit, origin, true, true)
    expect(custom).toMatchObject({ input: request, init: originalInit, applied: false, reason: 'custom-fetch' })
  })

  it('losslessly gzips eligible JSON and sets exact HTTP encoding and length without mutating headers', async () => {
    const originalBody = originalInit.body as string
    const result = await prepareResponsesRequest(request, originalInit, origin, true, false)
    expect(result.applied).toBe(true)
    if (!result.applied) throw new Error(`unexpected skip: ${result.reason}`)
    const compressed = result.init?.body
    if (!(compressed instanceof Uint8Array)) throw new Error('compressed request body is not bytes')
    expect(gunzipSync(Buffer.from(compressed)).toString('utf8')).toBe(originalBody)
    const wireHeaders = new Headers(result.init?.headers)
    expect(wireHeaders.get('content-encoding')).toBe('gzip')
    expect(wireHeaders.get('content-length')).toBe(String(result.wireBytes))
    expect(result.originalBytes).toBe(Buffer.byteLength(originalBody, 'utf8'))
    expect(originalInit.body).toBe(originalBody)
    expect(headers().has('content-encoding')).toBe(false)
    expect(new Headers(originalInit.headers).has('content-length')).toBe(false)
  })

  it.each([
    [`${origin}/responses?mode=x`, origin, 'untrusted-origin'],
    [`${origin}:8443/responses`, origin, 'untrusted-origin'],
    [`https://example.test/responses`, origin, 'untrusted-origin'],
    [`${origin}/chat/completions`, origin, 'untrusted-origin'],
  ])('does not compress an untrusted destination %s', async (url, base, reason) => {
    const result = await prepareResponsesRequest(url, originalInit, base, true, false)
    expect(result).toMatchObject({ applied: false, reason, input: url, init: originalInit })
  })

  it('requires the Responses protocol and an official Copilot HTTPS origin', async () => {
    expect(await prepareResponsesRequest(request, originalInit, origin, true, false, undefined, 'openai-completions'))
      .toMatchObject({ applied: false, reason: 'unsupported-protocol', init: originalInit })
    const enterprise = 'https://copilot-api.enterprise.example'
    expect(await prepareResponsesRequest(`${enterprise}/responses`, originalInit, enterprise, true, false))
      .toMatchObject({ applied: false, reason: 'untrusted-origin', init: originalInit })
  })

  it.each([
    ['GET', headers(), 'unsupported-request'],
    ['POST', new Headers({ 'content-type': 'text/plain' }), 'unsupported-content-type'],
    ['POST', new Headers({ 'content-type': 'application/json', 'content-encoding': 'br' }), 'existing-encoding'],
    ['POST', new Headers({ 'content-type': 'application/json', 'transfer-encoding': 'chunked' }), 'transfer-encoding'],
    ['POST', new Headers({ 'content-type': 'application/json', 'content-length': 'invalid' }), 'invalid-content-length'],
  ])('leaves %s requests with unsafe body headers unchanged', async (method, requestHeaders, reason) => {
    const original = { ...originalInit, method, headers: requestHeaders }
    const result = await prepareResponsesRequest(request, original, origin, true, false)
    expect(result).toMatchObject({ applied: false, reason, input: request, init: original })
  })

  it('keeps non-string and below-threshold bodies untouched', async () => {
    const binary = { method: 'POST', headers: headers(), body: new Uint8Array(300_000) }
    const unsupported = await prepareResponsesRequest(request, binary, origin, true, false)
    expect(unsupported).toMatchObject({ applied: false, reason: 'unsupported-body', init: binary })
    const small = { method: 'POST', headers: headers(), body: '{"input":"' + 'x'.repeat(200) + '"}' }
    const below = await prepareResponsesRequest(request, small, origin, true, false)
    expect(below).toMatchObject({ applied: false, reason: 'below-minimum', init: small })
  })

  it('skips bodies above the compression work limit', async () => {
    const oversized = { method: 'POST', headers: headers(), body: 'x'.repeat(32 * 1024 * 1024 + 1) }
    expect(await prepareResponsesRequest(request, oversized, origin, true, false))
      .toMatchObject({ applied: false, reason: 'work-limit', init: oversized })
  })

  it('requires both the absolute and proportional savings thresholds', () => {
    expect(satisfiesCompressionSavings(262_144, 258_048)).toBe(false)
    expect(satisfiesCompressionSavings(1_000_000, 996_000)).toBe(false)
    expect(satisfiesCompressionSavings(50_000, 47_500)).toBe(false)
    expect(satisfiesCompressionSavings(1_000_000, 950_000)).toBe(true)
  })

  it('abandons completed asynchronous compression when the request is aborted', async () => {
    const controller = new AbortController()
    const pending = prepareResponsesRequest(request, originalInit, origin, true, false, controller.signal)
    controller.abort()
    const result = await pending
    expect(result).toMatchObject({ applied: false, reason: 'aborted', input: request, init: originalInit })
  })
})
