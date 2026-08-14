/**
 * Capability probe: one bounded request per candidate protocol that forces
 * the server-side web tool to run and checks the reply for the structured
 * evidence that it did. A protocol claim is trusted only after this passes —
 * several "Responses-compatible" gateways accept the `web_search` tool field
 * and silently ignore it (DeepSeek documents that unknown tool types are
 * ignored), which is exactly the failure mode static protocol detection
 * cannot see. The probe is what makes the auto-disable decision honest.
 * @module dsh-web-search-provider/probe
 */

import { WebError } from '@deepseek-ai/dsh-web'
import type { SearchPlanCandidate } from './plan.ts'
import type { AnthropicResponse, ResponsesResponse } from './types.ts'
import { isAbortError, providerErrorMessage, readBounded } from './http.ts'

/** Attribution header value sent on probe requests. Bump with the package version. */
const USER_AGENT = 'dsh-web-search-provider/0.1.0'

/** Upper bound on generated tokens for a probe reply; the verdict needs none of it. */
const PROBE_MAX_TOKENS = 64

/** The outcome of probing one candidate. */
export interface ProbeOutcome {
  readonly supported: boolean
  /** Why the candidate failed, for the auto-disable diagnostic. */
  readonly detail: string
}

/**
 * Probe one candidate protocol with a single bounded request. The verdict is
 * structural: a Responses reply must contain a `web_search_call` item and a
 * Messages reply must contain a `web_search_tool_result` block; anything else
 * — HTTP error, unparseable body, silent tool ignore — is "not supported".
 * @param candidate - the resolved endpoint facts to verify.
 * @param resolveApiKey - resolves the candidate's credential reference.
 * @param timeoutMs - bound on the whole probe.
 * @returns the verdict and a diagnostic detail.
 */
export async function probeCandidate(
  candidate: SearchPlanCandidate,
  resolveApiKey: (apiKeyEnv: string) => Promise<string | undefined>,
  timeoutMs: number,
): Promise<ProbeOutcome> {
  const signal = AbortSignal.timeout(timeoutMs)
  try {
    const apiKey = await resolveApiKey(candidate.apiKeyEnv)
    if (apiKey === undefined || apiKey.length === 0) {
      return {
        supported: false,
        detail: `no API key for "${candidate.apiKeyEnv}"`,
      }
    }
    return candidate.protocol === 'openai-responses'
      ? await probeResponses(candidate, apiKey, signal)
      : await probeAnthropic(candidate, apiKey, signal)
  } catch (error) {
    if (error instanceof WebError) {
      return { supported: false, detail: error.message }
    }
    return { supported: false, detail: `probe failed: ${String(error)}` }
  }
}

/** Probe the Responses endpoint: force `web_search` and require a call item. */
async function probeResponses(candidate: SearchPlanCandidate, apiKey: string, signal: AbortSignal): Promise<ProbeOutcome> {
  const endpoint = `${candidate.baseURL.replace(/\/+$/, '')}/responses`
  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      redirect: 'error',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
        accept: 'application/json',
        'user-agent': USER_AGENT,
      },
      body: JSON.stringify({
        model: candidate.model,
        input: [{ role: 'user', content: [{ type: 'input_text', text: 'Probe web search capability.' }] }],
        tools: [{ type: 'web_search' }],
        tool_choice: { type: 'web_search' },
        stream: false,
        max_output_tokens: PROBE_MAX_TOKENS,
      }),
      signal,
    })
  } catch (error) {
    if (isAbortError(error)) return { supported: false, detail: 'probe timed out or was aborted' }
    return { supported: false, detail: `probe request failed: ${String(error)}` }
  }
  if (!response.ok) {
    let detail = `HTTP ${response.status}`
    try {
      const message = providerErrorMessage(JSON.parse(await readBounded(response, endpoint)))
      if (message !== undefined && message.length > 0) detail = message
    } catch {
      // The error body is best-effort; the status alone already names the failure.
    }
    return { supported: false, detail }
  }
  let body: ResponsesResponse
  try {
    body = JSON.parse(await readBounded(response, endpoint)) as ResponsesResponse
  } catch (error) {
    return { supported: false, detail: `unparseable probe reply: ${String(error)}` }
  }
  const ranSearch = (body.output ?? []).some(item => item.type === 'web_search_call')
  return ranSearch
    ? { supported: true, detail: 'native web search answered the probe' }
    : { supported: false, detail: 'the endpoint accepted the request but executed no web_search_call; the web_search tool may be ignored' }
}

/** Probe the Messages endpoint: enable `web_search_20250305` and require a result block. */
async function probeAnthropic(candidate: SearchPlanCandidate, apiKey: string, signal: AbortSignal): Promise<ProbeOutcome> {
  const endpoint = `${candidate.baseURL.replace(/\/+$/, '')}/messages`
  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      redirect: 'error',
      headers: {
        'x-api-key': apiKey,
        authorization: `Bearer ${apiKey}`,
        'anthropic-version': candidate.apiVersion,
        'content-type': 'application/json',
        accept: 'application/json',
        'user-agent': USER_AGENT,
      },
      body: JSON.stringify({
        model: candidate.model,
        max_tokens: PROBE_MAX_TOKENS,
        messages: [{ role: 'user', content: [{ type: 'text', text: 'Probe web search capability.' }] }],
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 1 }],
      }),
      signal,
    })
  } catch (error) {
    if (isAbortError(error)) return { supported: false, detail: 'probe timed out or was aborted' }
    return { supported: false, detail: `probe request failed: ${String(error)}` }
  }
  if (!response.ok) {
    let detail = `HTTP ${response.status}`
    try {
      const message = providerErrorMessage(JSON.parse(await readBounded(response, endpoint)))
      if (message !== undefined && message.length > 0) detail = message
    } catch {
      // The error body is best-effort; the status alone already names the failure.
    }
    return { supported: false, detail }
  }
  let body: AnthropicResponse
  try {
    body = JSON.parse(await readBounded(response, endpoint)) as AnthropicResponse
  } catch (error) {
    return { supported: false, detail: `unparseable probe reply: ${String(error)}` }
  }
  const ranSearch = (body.content ?? []).some(block => block.type === 'web_search_tool_result')
  return ranSearch
    ? { supported: true, detail: 'native web search answered the probe' }
    : { supported: false, detail: 'the endpoint accepted the request but returned no web_search_tool_result; the web_search tool may be ignored' }
}
