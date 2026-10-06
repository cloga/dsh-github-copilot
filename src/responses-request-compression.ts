import { constants, gzip } from 'node:zlib'

const MINIMUM_BODY_BYTES = 256 * 1024
const MAXIMUM_WORK_BYTES = 32 * 1024 * 1024
const MINIMUM_SAVINGS_BYTES = 4 * 1024

export type ResponsesCompressionSkipReason =
  | 'disabled'
  | 'unsupported-protocol'
  | 'custom-fetch'
  | 'untrusted-origin'
  | 'unsupported-request'
  | 'unsupported-body'
  | 'unsupported-content-type'
  | 'existing-encoding'
  | 'transfer-encoding'
  | 'invalid-content-length'
  | 'below-minimum'
  | 'work-limit'
  | 'not-beneficial'
  | 'compression-failed'
  | 'aborted'

export type RequestCompressionEvidence = {
  readonly encoding: 'identity'
  readonly reason: ResponsesCompressionSkipReason
  readonly originalBytes?: number
} | {
  readonly encoding: 'gzip'
  readonly reason: 'compressed'
  readonly originalBytes: number
  readonly wireBytes: number
}

type PreparedRequest = {
  readonly input: RequestInfo | URL
  readonly init: RequestInit | undefined
  readonly evidence: RequestCompressionEvidence
}
export type PreparedResponsesRequest = (PreparedRequest & {
  readonly applied: false
  readonly reason: ResponsesCompressionSkipReason
  readonly originalBytes?: number
}) | (PreparedRequest & {
  readonly applied: true
  readonly evidence: Extract<RequestCompressionEvidence, { encoding: 'gzip' }>
  readonly originalBytes: number
  readonly wireBytes: number
})

function skipped(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  reason: ResponsesCompressionSkipReason,
  originalBytes?: number,
): PreparedResponsesRequest {
  return { input, init, applied: false, reason,
    evidence: { encoding: 'identity', reason, ...originalBytes === undefined ? {} : { originalBytes } },
    ...originalBytes === undefined ? {} : { originalBytes } }
}

function requestUrl(input: RequestInfo | URL): URL | undefined {
  try {
    return new URL(input instanceof Request ? input.url : input.toString())
  } catch {
    return undefined
  }
}

function compress(bytes: Uint8Array): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    gzip(bytes, { level: constants.Z_BEST_SPEED }, (error, result) => {
      if (error !== null) reject(error)
      else resolve(result)
    })
  })
}

export function satisfiesCompressionSavings(originalBytes: number, wireBytes: number): boolean {
  const savings = originalBytes - wireBytes
  return savings >= MINIMUM_SAVINGS_BYTES && savings * 100 >= originalBytes * 5
}

/** Prepares one dispatch without changing the native request when compression is ineligible. */
export async function prepareResponsesRequest(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  accountBaseUrl: string,
  enabled: boolean,
  customFetch: boolean,
  signal?: AbortSignal,
  api = 'openai-responses',
): Promise<PreparedResponsesRequest> {
  if (!enabled) return skipped(input, init, 'disabled')
  if (api !== 'openai-responses') return skipped(input, init, 'unsupported-protocol')
  if (customFetch) return skipped(input, init, 'custom-fetch')

  const url = requestUrl(input)
  let trustedOrigin: string
  try {
    const accountUrl = new URL(accountBaseUrl)
    if (accountUrl.protocol !== 'https:' || accountUrl.username !== '' || accountUrl.password !== ''
      || accountUrl.port !== '' || accountUrl.pathname !== '/' || accountUrl.search !== '' || accountUrl.hash !== '') {
      return skipped(input, init, 'untrusted-origin')
    }
    if (!/^api(?:\.[a-z0-9-]+)*\.githubcopilot\.com$/u.test(accountUrl.hostname)) {
      return skipped(input, init, 'untrusted-origin')
    }
    trustedOrigin = accountUrl.origin
  } catch {
    return skipped(input, init, 'untrusted-origin')
  }
  if (url === undefined || url.protocol !== 'https:' || url.origin !== trustedOrigin
    || !/^api(?:\.[a-z0-9-]+)*\.githubcopilot\.com$/u.test(url.hostname)
    || url.username !== '' || url.password !== '' || url.port !== ''
    || url.pathname !== '/responses' || url.search !== '' || url.hash !== '') {
    return skipped(input, init, 'untrusted-origin')
  }

  const request = input instanceof Request ? input : undefined
  const method = init?.method ?? request?.method ?? 'GET'
  if (method.toUpperCase() !== 'POST') return skipped(input, init, 'unsupported-request')
  if (typeof init?.body !== 'string') return skipped(input, init, 'unsupported-body')

  let headers: Headers
  try {
    headers = new Headers(init.headers ?? request?.headers)
  } catch {
    return skipped(input, init, 'unsupported-request')
  }
  if (headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
    return skipped(input, init, 'unsupported-content-type')
  }
  if (headers.has('content-encoding')) return skipped(input, init, 'existing-encoding')
  if (headers.has('transfer-encoding')) return skipped(input, init, 'transfer-encoding')

  const body = init.body
  if (body.length > MAXIMUM_WORK_BYTES) return skipped(input, init, 'work-limit')
  if (body.length < Math.ceil(MINIMUM_BODY_BYTES / 3)) return skipped(input, init, 'below-minimum')
  const originalBytes = Buffer.byteLength(body, 'utf8')
  if (originalBytes > MAXIMUM_WORK_BYTES) return skipped(input, init, 'work-limit', originalBytes)
  if (originalBytes < MINIMUM_BODY_BYTES) return skipped(input, init, 'below-minimum', originalBytes)

  const contentLength = headers.get('content-length')
  if (contentLength !== null) {
    const parsedLength = /^\d+$/u.test(contentLength) ? Number(contentLength) : Number.NaN
    if (!Number.isSafeInteger(parsedLength) || parsedLength !== originalBytes) {
      return skipped(input, init, 'invalid-content-length', originalBytes)
    }
  }

  if (signal?.aborted) return skipped(input, init, 'aborted', originalBytes)

  let compressed: Buffer
  try {
    compressed = await compress(Buffer.from(body, 'utf8'))
  } catch {
    return skipped(input, init, 'compression-failed', originalBytes)
  }
  if (signal?.aborted) return skipped(input, init, 'aborted', originalBytes)
  const wireBytes = compressed.byteLength
  if (!satisfiesCompressionSavings(originalBytes, wireBytes)) {
    return skipped(input, init, 'not-beneficial', originalBytes)
  }

  headers.set('content-encoding', 'gzip')
  headers.set('content-length', String(wireBytes))
  return {
    input,
    init: { ...init, body: new Uint8Array(compressed), headers },
    applied: true,
    evidence: { encoding: 'gzip', reason: 'compressed', originalBytes, wireBytes },
    originalBytes,
    wireBytes,
  }
}
