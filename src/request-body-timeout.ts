import { readResponseErrorJson } from './response-error-body.ts'
import { REQUEST_BODY_TIMEOUT_MARKER } from './request-body-timeout-marker.ts'
import { formatRequestBodyEvidence, requestBodyEvidence } from './request-body-evidence.ts'
import type { RequestBodyDispatchEvidence, RequestBodyEvidence } from './request-body-evidence.ts'

const observedMessage = 'Timed out reading request body. Try again, or use a smaller request size.'

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function correlation(response: Response, dispatch?: RequestBodyDispatchEvidence): string {
  const model = dispatch?.modelId
  const safeModel = model !== undefined && model.length <= 200 && /^[A-Za-z0-9]/u.test(model)
    && !/[^A-Za-z0-9._:/-]/u.test(model)
    ? model : 'unavailable'
  const time = dispatch?.observedAtMs
  const observed = time !== undefined && Number.isSafeInteger(time) && time >= 0 && time <= 253402300799999
    ? new Date(time).toISOString() : 'unavailable'
  const ids: string[] = []
  for (const [name, pattern] of [
    ['x-request-id', /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu],
    ['x-github-request-id', /^[0-9a-f]{1,16}(?::[0-9a-f]{1,16}){4}$/iu],
  ] as const) {
    const value = response.headers.get(name)
    if (value !== null && value.length <= 84 && pattern.test(value)) ids.push(`${name}=${value}`)
  }
  return `Model: ${safeModel}; protocol: ${dispatch?.protocol ?? 'unavailable'}. Observed at: ${observed} (response headers, UTC). Supplier request IDs: ${ids.length ? ids.join(', ') : 'unavailable (missing or unrecognized format)'}.`
}

/** Verified provider evidence, not guessed capabilities, token limits or network cause. */
export async function requestBodyTimeoutDiagnostic(
  response: Response, body?: string, signal?: AbortSignal, dispatch?: RequestBodyDispatchEvidence,
): Promise<string | undefined> {
  if (response.status !== 408 || signal?.aborted) return undefined
  const value = await readResponseErrorJson(response, signal)
  if (signal?.aborted || !record(value)) return undefined
  const error = Object.hasOwn(value, 'error') ? value.error : value
  if (!record(error) || error.code !== 'user_request_timeout' || error.message !== observedMessage
    || value.code !== undefined && value.code !== error.code
    || value.message !== undefined && value.message !== error.message) return undefined
  const size = body === undefined ? 'Request body size unavailable.'
    : `Request body: ${Buffer.byteLength(body, 'utf8')} UTF-8 bytes (not context tokens).`
  const evidence: RequestBodyEvidence = dispatch === undefined ? { state: 'unavailable' } : requestBodyEvidence(body, dispatch.protocol)
  const composition = formatRequestBodyEvidence(evidence, dispatch?.responseHeadersMs)
  const recovery = evidence.state === 'complete' && evidence.imageBlockBytes > 0
    ? 'Consider an explicit attachment/image-offload budget change only for identified image blocks, or native compaction for compressible history.'
    : evidence.state === 'complete'
      ? 'No image blocks were identified; reducing an image budget is not indicated by this evidence. Consider native compaction only for compressible history.'
      : 'Composition is unavailable; do not choose a payload reduction from missing evidence.'
  return `${REQUEST_BODY_TIMEOUT_MARKER} ${correlation(response, dispatch)} ${size} ${composition} Native retry policy is unchanged. If retries exhaust, retry later explicitly and retain the model/time/request IDs for comparison or supplier support. ${recovery} Tool definitions and opaque replay may remain. Also check network/proxy health and GitHub service status. Composition alone does not establish a cause or supplier size limit. A larger client timeout does not change this server timeout. No history was trimmed or model switched.`
}
