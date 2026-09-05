/**
 * Capability probe: one bounded operation per candidate protocol that forces
 * the server-side web tool to run and checks the reply for the structured
 * evidence that it did. A protocol claim is trusted only after this passes —
 * several "Responses-compatible" gateways accept the `web_search` tool field
 * and silently ignore it (DeepSeek documents that unknown tool types are
 * ignored), which is exactly the failure mode static protocol detection
 * cannot see. The probe is what makes the auto-disable decision honest.
 * @module dsh-github-copilot/probe
 */

import { WebError } from '@deepseek-ai/dsh-web'
import {
  ANTHROPIC_WEB_SEARCH_TOOL_TYPE,
  RESPONSES_WEB_SEARCH_TOOL_TYPE,
  WEB_SEARCH_TOOL_TYPE,
} from './plan.ts'
import type { ResponsesWebSearchToolType, SearchPlanCandidate } from './plan.ts'
import type { AnthropicResponse, ResponsesResponse } from './types.ts'
import { providerRequestHeaders } from './copilot-request.ts'
import { applyRequestAuth, normalizeRequestAuth } from './copilot-request.ts'
import type { ResolvedRequestAuth } from './copilot-request.ts'
import { isAbortError, providerErrorMessage, readBounded } from './http.ts'
import { version } from '#package.json' with { type: 'json' }

/** Attribution header value sent on probe requests; single-sourced from package.json. */
const USER_AGENT = `dsh-github-copilot/${version}`

/** Upper bound on generated tokens for a probe reply; the verdict needs none of it. */
const PROBE_MAX_TOKENS = 64

/** Complete spelling rounds allowed after structurally valid transient replies. */
const RESPONSES_PROBE_ROUNDS = 2

/** The outcome of probing one candidate. */
export interface ProbeOutcome {
  readonly supported: boolean
  /** Why the candidate failed, for the auto-disable diagnostic. */
  readonly detail: string
  /**
   * The Responses tool spelling the probe verified (openai-responses only).
   * May differ from the candidate's primary spelling when the fallback won;
   * the wire must use this verified value.
   */
  readonly webSearchToolType?: ResponsesWebSearchToolType
}

/** Upper bound on the whole probe (also the fetch signal bound), milliseconds. */
const MAX_PROBE_TIMEOUT_MS = 2_147_483_647

/**
 * Probe one candidate protocol with a bounded request sequence. The verdict is
 * structural: a Responses reply must contain a `web_search_call` item and a
 * Messages reply must contain a `web_search_tool_result` block; anything else
 * — HTTP error, unparseable body, silent tool ignore — is "not supported".
 * The timeout bounds the WHOLE probe, including credential resolution; the
 * probe never throws — every failure becomes a verdict.
 * @param candidate - the resolved endpoint facts to verify.
 * @param resolveApiKey - resolves the candidate's credential reference.
 * @param timeoutMs - bound on the whole probe.
 * @param signal - optional owner lifecycle cancellation; abort forbids later attempts.
 * @returns the verdict and a diagnostic detail.
 */
export async function probeCandidate(
  candidate: SearchPlanCandidate,
  resolveApiKey: (candidate: SearchPlanCandidate) => Promise<string | ResolvedRequestAuth | undefined>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<ProbeOutcome> {
  const aborted = (): ProbeOutcome => ({ supported: false, detail: 'probe was aborted' })
  if (signal?.aborted === true) return aborted()
  // Clamp: `setTimeout` refuses values beyond 2^31-1; the clamp keeps an
  // absurd config from throwing.
  const bound = Math.min(Math.max(Math.trunc(timeoutMs), 1), MAX_PROBE_TIMEOUT_MS)
  const deadline = Date.now() + bound
  const cancellation = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  let onAbort: (() => void) | undefined
  const cancelled = new Promise<ProbeOutcome>((resolve) => {
    onAbort = () => {
      cancellation.abort()
      resolve(aborted())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
  try {
    return await Promise.race([
      cancelled,
      runProbe(candidate, resolveApiKey, bound, deadline, cancellation.signal),
      new Promise<ProbeOutcome>((resolve) => {
        timer = setTimeout(() => {
          cancellation.abort()
          resolve({ supported: false, detail: `probe timed out after ${bound}ms` })
        }, bound)
      }),
    ])
  } finally {
    clearTimeout(timer)
    if (onAbort !== undefined) signal?.removeEventListener('abort', onAbort)
  }
}

/** Resolve the key and probe the endpoint under the shared whole-probe deadline. */
async function runProbe(
  candidate: SearchPlanCandidate,
  resolveApiKey: (candidate: SearchPlanCandidate) => Promise<string | ResolvedRequestAuth | undefined>,
  bound: number,
  deadline: number,
  cancellation: AbortSignal,
): Promise<ProbeOutcome> {
  try {
    const auth = normalizeRequestAuth(await resolveApiKey(candidate))
    if (auth === undefined || auth.apiKey.length === 0) {
      return {
        supported: false,
        detail: `no API key for "${candidate.apiKeyEnv}"`,
      }
    }
    candidate = applyRequestAuth(candidate, auth)
    const apiKey = auth.apiKey
    // The race above returns the verdict at `bound`, but the work keeps
    // running: a key that lands late must not start a fetch after the shared
    // deadline. Every request uses the same cancellation signal and timer.
    const remaining = deadline - Date.now()
    if (cancellation.aborted || remaining <= 0) {
      return { supported: false, detail: `probe timed out after ${bound}ms` }
    }
    return candidate.protocol === 'openai-responses'
      ? await probeResponses(candidate, apiKey, cancellation)
      : await probeAnthropic(candidate, apiKey, cancellation)
  } catch (error) {
    if (error instanceof WebError) {
      return { supported: false, detail: error.message }
    }
    return { supported: false, detail: `probe failed: ${String(error)}` }
  }
}

/** The verdict of one spelling attempt; only missing structural evidence is transient. */
interface SpellingVerdict {
  readonly supported: boolean
  readonly detail: string
  readonly transient: boolean
}

/**
 * Probe the Responses endpoint with a single tool spelling: force the tool
 * (standard `required` or the gateway's object choice) and require a
 * `web_search_call` item as structural evidence.
 * @param candidate - the resolved endpoint facts.
 * @param apiKey - the resolved credential.
 * @param signal - the probe timeout signal.
 * @param spelling - the tool type spelling to exercise.
 * @returns the verdict; `transient` is true only for a valid 2xx reply that
 *   omitted the required structural evidence.
 */
async function probeResponsesSpelling(
  candidate: SearchPlanCandidate,
  apiKey: string,
  signal: AbortSignal,
  spelling: ResponsesWebSearchToolType,
): Promise<SpellingVerdict> {
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
        ...providerRequestHeaders(candidate, 'user'),
      },
      body: JSON.stringify({
        model: candidate.model,
        input: [{ role: 'user', content: [{ type: 'input_text', text: 'Probe web search capability.' }] }],
        tools: [{ type: spelling }],
        // Standard semantics force through the string choice; the versioned
        // spelling keeps the gateway's object choice.
        tool_choice: spelling === WEB_SEARCH_TOOL_TYPE ? 'required' : { type: spelling },
        stream: false,
        max_output_tokens: PROBE_MAX_TOKENS,
      }),
      signal,
    })
  } catch (error) {
    if (isAbortError(error)) return { supported: false, detail: 'probe timed out or was aborted', transient: false }
    return { supported: false, detail: `probe request failed: ${String(error)}`, transient: false }
  }

  if (!response.ok) {
    let detail = `HTTP ${response.status}`
    try {
      const message = providerErrorMessage(JSON.parse(await readBounded(response, endpoint)))
      if (message !== undefined && message.length > 0) detail = message
    } catch {
      // The error body is best-effort; the status alone already names the failure.
    }
    return { supported: false, detail, transient: false }
  }
  let body: ResponsesResponse
  try {
    const parsed = JSON.parse(await readBounded(response, endpoint)) as unknown
    if (typeof parsed !== 'object' || parsed === null || !Array.isArray((parsed as ResponsesResponse).output)) {
      return { supported: false, detail: 'malformed probe reply: expected an output array', transient: false }
    }
    body = parsed as ResponsesResponse
  } catch (error) {
    return { supported: false, detail: `unparseable probe reply: ${String(error)}`, transient: false }
  }
  const ranSearch = body.output!.some(item => item.type === 'web_search_call')
  return ranSearch
    ? { supported: true, detail: 'native web search answered the probe', transient: false }
    : {
        supported: false,
        detail: 'the endpoint accepted the request but executed no web_search_call; the web_search tool may be ignored',
        transient: true,
      }
}

/**
 * Probe the Responses endpoint in bounded rounds over both tool spellings.
 * The candidate's primary spelling goes first (standard by default, versioned
 * for OpenCode Go hosts). Only a structurally valid 2xx reply that omitted
 * `web_search_call` advances to another attempt. All other failures stop
 * immediately. Both rounds share the whole-probe deadline and signal. The
 * verified spelling is reported back for the wire to use.
 */
async function probeResponses(candidate: SearchPlanCandidate, apiKey: string, signal: AbortSignal): Promise<ProbeOutcome> {
  const primary = candidate.webSearchToolType ?? WEB_SEARCH_TOOL_TYPE
  const spellings: readonly ResponsesWebSearchToolType[] = primary === RESPONSES_WEB_SEARCH_TOOL_TYPE
    ? [RESPONSES_WEB_SEARCH_TOOL_TYPE, WEB_SEARCH_TOOL_TYPE]
    : [WEB_SEARCH_TOOL_TYPE, RESPONSES_WEB_SEARCH_TOOL_TYPE]
  let firstDetail: string | undefined
  let attempts = 0
  for (let round = 0; round < RESPONSES_PROBE_ROUNDS; round += 1) {
    for (const spelling of spellings) {
      if (signal.aborted) return { supported: false, detail: 'probe was aborted' }
      attempts += 1
      const verdict = await probeResponsesSpelling(candidate, apiKey, signal, spelling)
      if (signal.aborted) return { supported: false, detail: 'probe was aborted' }
      if (verdict.supported) {
        return { supported: true, detail: verdict.detail, webSearchToolType: spelling }
      }
      if (!verdict.transient) return { supported: false, detail: verdict.detail }
      firstDetail ??= verdict.detail
    }
  }
  return {
    supported: false,
    detail: `${firstDetail ?? 'the endpoint accepted neither web_search spelling'} after ${attempts} transient attempts`,
  }
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
        ...providerRequestHeaders(candidate, 'user'),
      },
      body: JSON.stringify({
        model: candidate.model,
        max_tokens: PROBE_MAX_TOKENS,
        messages: [{ role: 'user', content: [{ type: 'text', text: 'Probe web search capability.' }] }],
        tools: [{ type: ANTHROPIC_WEB_SEARCH_TOOL_TYPE, name: 'web_search', max_uses: 1 }],
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
