import { readResponseErrorJson } from './response-error-body.ts'
import { REQUEST_BODY_TIMEOUT_MARKER } from './request-body-timeout-marker.ts'
import { formatRequestBodyEvidence, requestBodyEvidence, REQUEST_BODY_EVIDENCE_LIMITS } from './request-body-evidence.ts'
import { requestBodyComposition } from './request-body-composition.ts'
import type { RequestBodyDispatchEvidence } from './request-body-evidence.ts'
import { formatRequestUploadEvidence } from './request-upload-evidence.ts'

const observedMessage = 'Timed out reading request body. Try again, or use a smaller request size.'

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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
  return `${REQUEST_BODY_TIMEOUT_MARKER} ${size}${encoding} ${composition} ${upload} Native retry policy is unchanged. If retries exhaust, use these numbers to choose an explicit attachment/image-offload budget change or native compaction for compressible history; tool definitions and opaque replay may remain. Also check network/proxy health and GitHub service status. Composition alone does not establish a cause or supplier size limit. A larger client timeout does not change this server timeout. No history was trimmed or model switched.`
}
