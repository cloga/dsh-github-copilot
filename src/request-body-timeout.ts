import { readResponseErrorJson } from './response-error-body.ts'

const observedMessage = 'Timed out reading request body. Try again, or use a smaller request size.'

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Verified provider evidence, not guessed capabilities, token limits or network cause. */
export async function requestBodyTimeoutDiagnostic(
  response: Response, body?: string, signal?: AbortSignal,
): Promise<string | undefined> {
  if (response.status !== 408 || signal?.aborted) return undefined
  const value = await readResponseErrorJson(response, signal)
  if (!record(value)) return undefined
  const error = Object.hasOwn(value, 'error') ? value.error : value
  if (!record(error) || error.code !== 'user_request_timeout' || error.message !== observedMessage
    || value.code !== undefined && value.code !== error.code
    || value.message !== undefined && value.message !== error.message) return undefined
  const size = body === undefined ? 'Request body size unavailable.'
    : `Request body: ${Buffer.byteLength(body, 'utf8')} UTF-8 bytes (not context tokens).`
  return `COPILOT_REQUEST_BODY_TIMEOUT: Copilot returned HTTP 408 / user_request_timeout while reading the request body; this is not context-window overflow. ${size} Native retry policy is unchanged. If retries exhaust, explicitly compact the conversation or reduce attachments/tool output before retrying; also check network/proxy health and GitHub service status. A larger client timeout does not change this server timeout. No history was trimmed or model switched.`
}
