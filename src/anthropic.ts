/**
 * Anthropic-compatible Messages API adapter: one Messages model call per
 * search with the native `web_search_20250305` server tool enabled. Each
 * search costs a model turn but returns structured result blocks; absence of
 * those blocks is an error rather than a prose-scraping fallback. The wire
 * format deliberately mirrors `dsh-web-search-deepseek`'s proven mapping.
 * @module dsh-web-search-provider/anthropic
 */

import { WebError } from '@deepseek-ai/dsh-web'
import type { WebSearchResult, WebSearchSource } from '@deepseek-ai/dsh-web'
import type { SearchLlmRequest, AnthropicResponse, ContentBlock, TextBlock, WebSearchToolResultBlock } from './types.ts'
import { abortable, isAbortError, providerErrorMessage, readBounded, searchAborted, throwIfSearchAborted } from './http.ts'

/** Path appended to the configured base URL to reach the Messages API. */
const MESSAGES_ENDPOINT = '/messages'

/** Default `anthropic-version` header value. */
export const DEFAULT_API_VERSION = '2023-06-01'

/** Default upper bound on generated tokens for the Messages request. */
export const DEFAULT_MAX_TOKENS = 4096

/** Default maximum `web_search` server-tool uses per request. */
export const DEFAULT_MAX_USES = 5

/** Attribution header value sent on every request. Bump with the package version. */
const USER_AGENT = 'dsh-web-search-provider/0.1.0'

/** Resolved endpoint facts one search operation runs with. */
export interface AnthropicSearchOptions {
  /** Endpoint base; `/messages` is appended. */
  readonly baseURL: string
  /** Anthropic-format model name. */
  readonly model: string
  /** `anthropic-version` header value. */
  readonly apiVersion: string
  /** Upper bound on generated tokens for the Messages request. */
  readonly maxTokens: number
  /** Maximum `web_search` server-tool uses per request. */
  readonly maxUses: number
  /** Literal API key; when present it wins over {@link resolveApiKey}. */
  readonly apiKey?: string
  /** Resolve the current API key for one operation. */
  readonly resolveApiKey?: () => Promise<string | undefined>
  /** Credential reference named by missing-credential diagnostics. */
  readonly apiKeyEnv?: string
  /**
   * Record the exact secret-free request immediately before dispatch. A
   * throw prevents dispatch so model-visible auxiliary input cannot escape
   * logging.
   */
  readonly recordRequest?: (request: SearchLlmRequest) => void
}

/**
 * Build the exact Messages request body for one search.
 * @param options - resolved endpoint facts.
 * @param query - the search query.
 * @returns the JSON body to POST.
 */
export function buildAnthropicSearchBody(options: AnthropicSearchOptions, query: string): unknown {
  return {
    model: options.model,
    max_tokens: options.maxTokens,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Perform a web search for the query: ${query}`,
          },
        ],
      },
    ],
    tools: [
      {
        type: 'web_search_20250305',
        name: 'web_search',
        max_uses: options.maxUses,
      },
    ],
  }
}

/**
 * Build a `url → cited_text` map from every `text` block's `citations[]`.
 * This is the snippet source: Anthropic `web_search_result` items carry
 * `url`/`title`/`page_age` but typically no inline snippet — the excerpt
 * lives in a separate `text` block's citation, keyed by `url` (first
 * occurrence wins).
 * @param blocks - the response's content blocks; non-`text` blocks are skipped.
 * @returns the `url → cited_text` map (empty when no citations are present).
 */
export function citationSnippets(blocks: readonly ContentBlock[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const block of blocks) {
    if (block.type !== 'text') continue
    for (const cite of (block as TextBlock).citations ?? []) {
      if (cite.url != null && cite.url.length > 0 && cite.cited_text != null && cite.cited_text.length > 0 && !map.has(cite.url)) {
        map.set(cite.url, cite.cited_text)
      }
    }
  }
  return map
}

/**
 * Map a Messages response to a normalized search result. Walks
 * `web_search_tool_result` blocks for citeable `web_search_result` items,
 * joins each to its citation excerpt as `snippet`, and dedupes by `url` (a
 * `max_uses > 1` request can surface the same URL across searches). The web
 * seam owns the final `maxResults` truncation, so `truncated` is always
 * `false` here.
 * @param response - the parsed Messages response body.
 * @returns the normalized result with deduped, snippet-joined sources.
 * @throws WebError `WEB_PROVIDER_ERROR` when native search produced no
 *   result block.
 */
export function mapAnthropicResponse(response: AnthropicResponse): WebSearchResult {
  const blocks = response.content ?? []
  const resultBlocks = blocks.filter((block): block is WebSearchToolResultBlock => block.type === 'web_search_tool_result')
  if (resultBlocks.length === 0) {
    throw new WebError(
      'the provider returned no web_search_tool_result blocks; the request may not have triggered native web search',
      'WEB_PROVIDER_ERROR',
    )
  }
  const snippets = citationSnippets(blocks)
  const seen = new Set<string>()
  const sources: WebSearchSource[] = []
  for (const block of resultBlocks) {
    for (const item of block.content ?? []) {
      if (item.type !== 'web_search_result' || item.url.length === 0 || seen.has(item.url)) continue
      seen.add(item.url)
      const snippet = snippets.get(item.url)
      sources.push({
        url: item.url,
        ...item.title != null && item.title.length > 0 ? { title: item.title } : {},
        ...snippet != null && snippet.length > 0 ? { snippet } : {},
        ...item.page_age != null && item.page_age.length > 0 ? { publishedAt: item.page_age } : {},
      })
    }
  }
  return {
    sources,
    truncated: false,
  }
}

/**
 * Run one search through the Messages API. The credential is resolved once
 * per operation, the request is recorded before dispatch, and redirects are
 * rejected so credentials never follow a `Location`.
 * @param options - resolved endpoint facts.
 * @param query - the search query.
 * @param signal - optional cancellation signal forwarded to `fetch`.
 * @returns the normalized search result.
 * @throws WebError with `WEB_PROVIDER_ERROR` for provider failures and
 *   `WEB_ABORTED` for caller cancellation.
 */
export async function runAnthropicSearch(
  options: AnthropicSearchOptions,
  query: string,
  signal?: AbortSignal,
): Promise<WebSearchResult> {
  const apiKey = await resolveAnthropicApiKey(options, signal)
  throwIfSearchAborted(signal)
  const endpoint = `${options.baseURL.replace(/\/+$/, '')}${MESSAGES_ENDPOINT}`
  const body = buildAnthropicSearchBody(options, query)
  options.recordRequest?.({ protocol: 'anthropic-messages', endpoint, apiVersion: options.apiVersion, body })
  throwIfSearchAborted(signal)
  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      redirect: 'error',
      headers: {
        'x-api-key': apiKey,
        authorization: `Bearer ${apiKey}`,
        'anthropic-version': options.apiVersion,
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
    let message = `Messages API error (HTTP ${response.status})`
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
    return mapAnthropicResponse(JSON.parse(bodyText) as AnthropicResponse)
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
export async function resolveAnthropicApiKey(options: AnthropicSearchOptions, signal?: AbortSignal): Promise<string> {
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
