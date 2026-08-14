/**
 * OpenAI Responses API adapter: one `web_search` server-tool request per
 * operation, executed server-side (search, open_page, find_in_page all run on
 * the provider). The endpoint is `POST {baseURL}/responses`; the reply's
 * `web_search_call` items are the evidence that native search ran, and the
 * `message` item carries the answer text with citeable URL annotations.
 * @module dsh-web-search-provider/responses
 */

import { WebError } from '@deepseek-ai/dsh-web'
import type { WebSearchResult, WebSearchSource } from '@deepseek-ai/dsh-web'
import type { SearchLlmRequest, ResponsesResponse, ResponseOutputItem, WebSearchCallItem, ResponseMessageItem, UrlAnnotation } from './types.ts'
import { abortable, isAbortError, providerErrorMessage, readBounded, searchAborted, throwIfSearchAborted } from './http.ts'

/** Path appended to the configured base URL to reach the Responses API. */
const RESPONSES_ENDPOINT = '/responses'

/**
 * The server-tool type sent on every Responses request. The unversioned
 * `web_search` spelling is dropped by gateway-style endpoints that parse
 * tools as function-like entries keyed by `name` (OpenCode Zen/Go ignores a
 * nameless `web_search` and answers from memory); `web_search_2025_08_26` is
 * documented by OpenAI and DeepSeek, executes without extra fields, and is
 * what the capability probe verifies before any search is served.
 */
export const RESPONSES_WEB_SEARCH_TOOL_TYPE = 'web_search_2025_08_26'

/** Attribution header value sent on every request. Bump with the package version. */
const USER_AGENT = 'dsh-web-search-provider/0.1.1'

/**
 * The three server-side web actions this adapter can ask for. `search` is the
 * seam's `web_search`; `open_page` and `find_in_page` are the browsing
 * follow-ups the Responses API executes without the harness fetching
 * anything itself.
 */
export type WebSearchAction = 'search' | 'open_page' | 'find_in_page'

/** Resolved endpoint facts one search operation runs with. */
export interface ResponsesSearchOptions {
  /** Endpoint base; `/responses` is appended. */
  readonly baseURL: string
  /** Responses-format model name. */
  readonly model: string
  /** Literal API key; when present it wins over {@link resolveApiKey}. */
  readonly apiKey?: string
  /** Resolve the current API key for one operation. */
  readonly resolveApiKey?: () => Promise<string | undefined>
  /** Credential reference named by missing-credential diagnostics. */
  readonly apiKeyEnv?: string
  /** Upper bound on generated tokens (visible output plus reasoning). */
  readonly maxOutputTokens: number
  /**
   * Record the exact secret-free request immediately before dispatch. A
   * throw prevents dispatch so model-visible auxiliary input cannot escape
   * logging.
   */
  readonly recordRequest?: (request: SearchLlmRequest) => void
}

/** What one operation asks the server-side web tool to do. */
export interface ResponsesSearchInput {
  /** Which server-side action to force through `tool_choice`. */
  readonly action: WebSearchAction
  /** The instruction text sent as the user message. */
  readonly text: string
}

/**
 * The instruction sent for an `open_page` operation. The URL is embedded in
 * the user text because `tool_choice` can only name the tool, not the action;
 * the model then issues exactly the requested `open_page` call.
 * @param url - the page the operation asks the server to open.
 * @returns the user-message instruction.
 */
export function openPageInstruction(url: string): string {
  return `Open the page at ${url} and report its content. Do not perform a new web search.`
}

/**
 * The instruction sent for a `find_in_page` operation, with the pattern
 * quoted so arbitrary text (spaces, quotes) survives into the instruction.
 * @param url - the page the server must have loaded.
 * @param pattern - the text to search for within the page.
 * @returns the user-message instruction.
 */
export function findInPageInstruction(url: string, pattern: string): string {
  return `Search within the page at ${url} for the pattern ${JSON.stringify(pattern)} and report the matching passages. Do not perform a new web search.`
}

/**
 * Build the exact request body for one operation. `tool_choice` pins the
 * server-side tool so the provider must execute it rather than answering
 * from memory; without the pin a model could skip the web entirely.
 * @param options - resolved endpoint facts.
 * @param input - the requested action and instruction.
 * @returns the JSON body to POST.
 */
export function buildResponsesSearchBody(options: ResponsesSearchOptions, input: ResponsesSearchInput): unknown {
  return {
    model: options.model,
    input: [
      {
        role: 'user',
        content: [{ type: 'input_text', text: input.text }],
      },
    ],
    tools: [{ type: RESPONSES_WEB_SEARCH_TOOL_TYPE }],
    tool_choice: { type: RESPONSES_WEB_SEARCH_TOOL_TYPE },
    stream: false,
    max_output_tokens: options.maxOutputTokens,
  }
}

/** Narrow one output item to a `web_search_call`, or `undefined`. */
function isWebSearchCall(item: ResponseOutputItem): item is WebSearchCallItem {
  return item.type === 'web_search_call'
}

/** Narrow one output item to a `message`, or `undefined`. */
function isResponseMessage(item: ResponseOutputItem): item is ResponseMessageItem {
  return item.type === 'message'
}

/**
 * Collect the cited sources from every message content part. The annotation
 * vocabulary varies by vendor (OpenAI `url_citation`; DeepSeek and gateways
 * also emit `web_search`/`search_result`), so all three shapes are read and
 * deduplicated by URL — the first occurrence wins.
 * @param output - the response's output items.
 * @returns the citeable sources in encounter order.
 */
export function sourcesFromAnnotations(output: readonly ResponseOutputItem[]): WebSearchSource[] {
  const seen = new Set<string>()
  const sources: WebSearchSource[] = []
  for (const item of output) {
    if (!isResponseMessage(item)) continue
    for (const part of item.content ?? []) {
      for (const annotation of part.annotations ?? []) {
        const source = sourceFromAnnotation(annotation)
        if (source === undefined || seen.has(source.url)) continue
        seen.add(source.url)
        sources.push(source)
      }
    }
  }
  return sources
}

/** Project one URL annotation into a seam source, or `undefined` when unciteable. */
function sourceFromAnnotation(annotation: UrlAnnotation): WebSearchSource | undefined {
  if (annotation.type !== 'url_citation' && annotation.type !== 'web_search' && annotation.type !== 'search_result') {
    return undefined
  }
  const url = annotation.url ?? annotation.link
  if (url == null || url.length === 0) return undefined
  return {
    url,
    ...annotation.title != null && annotation.title.length > 0 ? { title: annotation.title } : {},
  }
}

/** Concatenate the answer text of every `message` output item. */
function messageText(output: readonly ResponseOutputItem[]): string {
  let text = ''
  for (const item of output) {
    if (!isResponseMessage(item)) continue
    for (const part of item.content ?? []) {
      if ((part.type === 'output_text' || part.type === 'text') && part.text != null && part.text.length > 0) {
        text += part.text
      }
    }
  }
  return text
}

/**
 * Map a non-streamed Responses reply to the seam's normalized result. The
 * model's answer becomes `content` (as with the Perplexity provider), the
 * cited URLs become `sources`, and the presence of at least one
 * `web_search_call` item is the strict proof that the server executed the
 * tool — a reply without one means the endpoint silently ignored the tool,
 * and scraping URLs out of prose is never attempted.
 * @param response - the parsed response body.
 * @returns the normalized search result.
 * @throws WebError `WEB_PROVIDER_ERROR` when no `web_search_call` is present.
 */
export function mapResponsesSearchResult(response: ResponsesResponse): WebSearchResult {
  const output = response.output ?? []
  const calls = output.filter(isWebSearchCall)
  if (calls.length === 0) {
    throw new WebError(
      'the provider returned no web_search_call items; the endpoint may not support native web search',
      'WEB_PROVIDER_ERROR',
    )
  }
  const content = messageText(output)
  const sources = sourcesFromAnnotations(output)
  return {
    ...content.length > 0 ? { content } : {},
    sources,
    truncated: false,
  }
}

/**
 * Run one server-side web operation through the Responses API. The credential
 * is resolved once per operation, the request is recorded before dispatch,
 * and redirects are rejected so credentials never follow a `Location`.
 * @param options - resolved endpoint facts.
 * @param input - the requested action and instruction.
 * @param signal - optional cancellation signal forwarded to `fetch`.
 * @returns the normalized search result.
 * @throws WebError with `WEB_PROVIDER_ERROR` for provider failures and
 *   `WEB_ABORTED` for caller cancellation.
 */
export async function runResponsesSearch(
  options: ResponsesSearchOptions,
  input: ResponsesSearchInput,
  signal?: AbortSignal,
): Promise<WebSearchResult> {
  const apiKey = await resolveResponsesApiKey(options, signal)
  throwIfSearchAborted(signal)
  const endpoint = `${options.baseURL.replace(/\/+$/, '')}${RESPONSES_ENDPOINT}`
  const body = buildResponsesSearchBody(options, input)
  options.recordRequest?.({ protocol: 'openai-responses', endpoint, body })
  throwIfSearchAborted(signal)
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
      body: JSON.stringify(body),
      ...signal !== undefined ? { signal } : {},
    })
  } catch (error) {
    if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error)
    throw new WebError(`native search request failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
  }
  if (!response.ok) {
    let message = `Responses API error (HTTP ${response.status})`
    try {
      const detail = providerErrorMessage(JSON.parse(await readBounded(response, endpoint)))
      if (detail !== undefined && detail.length > 0) message = detail
    } catch (error) {
      if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error)
    }
    throw new WebError(message, 'WEB_PROVIDER_ERROR')
  }
  try {
    const bodyText = await readBounded(response, endpoint)
    return mapResponsesSearchResult(JSON.parse(bodyText) as ResponsesResponse)
  } catch (error) {
    if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error)
    if (error instanceof WebError) throw error
    throw new WebError(`the provider returned an unprocessable response body: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
  }
}

/**
 * Resolve one operation's credential without retaining it on the provider.
 * @param options - the operation's endpoint facts.
 * @param signal - abort signal for the surrounding search.
 * @returns the resolved key.
 * @throws WebError `WEB_PROVIDER_CREDENTIAL_MISSING` when no key is available.
 */
export async function resolveResponsesApiKey(options: ResponsesSearchOptions, signal?: AbortSignal): Promise<string> {
  throwIfSearchAborted(signal)
  if (options.apiKey !== undefined && options.apiKey.length > 0) return options.apiKey
  let resolved: string | undefined
  try {
    resolved = await abortable(options.resolveApiKey?.() ?? Promise.resolve(undefined), signal)
  } catch (error) {
    if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error)
    throw new WebError(`native search credential resolution failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
  }
  if (resolved !== undefined && resolved.length > 0) return resolved
  throw new WebError(
    `native web search has no API key for "${options.apiKeyEnv ?? 'DEEPSEEK_API_KEY'}"; store it through the credentials service, export it in the launching environment, or set a literal "apiKey" in the web-search-provider config`,
    'WEB_PROVIDER_CREDENTIAL_MISSING',
  )
}
