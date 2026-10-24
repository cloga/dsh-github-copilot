import { readResponseErrorJson } from './response-error-body.ts'
import { REQUEST_BODY_TIMEOUT_MARKER } from './request-body-timeout-marker.ts'
import { formatRequestBodyEvidence, requestBodyEvidence, REQUEST_BODY_EVIDENCE_LIMITS } from './request-body-evidence.ts'
import { requestBodyComposition } from './request-body-composition.ts'
import type { RequestBodyDispatchEvidence } from './request-body-evidence.ts'
import { formatRequestUploadEvidence } from './request-upload-evidence.ts'
import { RequestDiagnosticSchema } from './request-diagnostics.ts'

const observedMessage = 'Timed out reading request body. Try again, or use a smaller request size.'

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function correlation(response: Response, dispatch?: RequestBodyDispatchEvidence): string {
  const model = RequestDiagnosticSchema.shape.model.safeParse(dispatch?.model)
  const at = dispatch?.observedAt
  const time = at !== undefined && Number.isSafeInteger(at) && at >= 0 && at <= 8_640_000_000_000_000
    ? `response observed at ${new Date(at).toISOString()}` : 'observation time unavailable'
  const ids: string[] = []
  const formats = [
    ['x-github-request-id', /^[0-9a-f]{4,8}(?::[0-9a-f]{1,16}){4}$/i],
    ['x-request-id', /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i],
  ] as const
  for (const [header, format] of formats) {
    const value = response.headers.get(header)
    if (value !== null && value.length <= 128 && format.test(value)) ids.push(`${header}=${value}`)
  }
  return `Observed request: model ${model.success ? model.data : 'unavailable'}; protocol ${dispatch?.protocol ?? 'unavailable'}; ${time}. ${ids.length ? `Supplier request IDs: ${ids.join(', ')} (correlation only, not receipt or execution proof).` : 'Supplier request IDs unavailable (missing or unrecognized format).'}`
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
  const compression = dispatch?.compression
  const encoding = compression?.encoding === 'gzip'
    ? ` Encoded body: ${compression.wireBytes} gzip bytes (prepared HTTP body, excluding transport framing; not confirmed delivered bytes). Lossless content encoding does not reduce context tokens or prove remote receipt.`
    : compression !== undefined && compression.reason !== 'disabled'
      ? ` Request compression not applied: ${compression.reason}; original request retained.`
      : ''
  const size = body === undefined ? 'Request body size unavailable.'
    : `Request body${compression?.encoding === 'gzip' ? ' (original JSON)' : ''}: ${Buffer.byteLength(body, 'utf8')} UTF-8 bytes (not context tokens).`
  const evidence = dispatch === undefined ? { state: 'unavailable' as const }
    : dispatch.composition !== undefined ? await dispatch.composition
      : body !== undefined && Buffer.byteLength(body, 'utf8') > REQUEST_BODY_EVIDENCE_LIMITS.bytes
        ? await requestBodyComposition(body, dispatch.protocol, { signal })
        : requestBodyEvidence(body, dispatch.protocol)
  if (signal?.aborted) return undefined
  const composition = formatRequestBodyEvidence(evidence, dispatch?.responseHeadersMs, compression)
  const upload = formatRequestUploadEvidence(dispatch?.upload)
  const images = evidence.state !== 'complete'
    ? 'Image composition is unavailable; do not infer an image-budget remedy from missing evidence.'
    : evidence.imageBlockBytes > 0
      ? 'Recognized image blocks are present; an explicit attachment/image-offload budget change may reduce those bytes.'
      : 'No recognized image blocks were measured; an image-budget change is not indicated by this evidence.'
  return `${REQUEST_BODY_TIMEOUT_MARKER} ${correlation(response, dispatch)} ${size}${encoding} ${composition} ${upload} Native retry policy is unchanged. ${images} If retries exhaust, consider explicit native compaction for compressible history; tool definitions and opaque replay may remain. Also check network/proxy health and GitHub service status. Composition alone does not establish a cause or supplier size limit. A larger client timeout does not change this server timeout. No history was trimmed or model switched.`
}
