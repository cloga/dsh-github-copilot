/**
 * Provider-private wire types for the two search-capable protocols this
 * package speaks: the OpenAI Responses API `web_search` server tool and the
 * Anthropic-compatible Messages API `web_search_20250305` server tool.
 * Neither shape creates a dependency on `ctx.llm` — the requests are plain
 * `fetch` calls over the same credential plane `dsh-web-search-deepseek`
 * uses.
 * @module dsh-web-search-provider/types
 */

// ── OpenAI Responses API ────────────────────────────────────────────────────

/**
 * The server-side web actions the `web_search` tool can execute. A
 * `web_search_call` output item carries exactly one of these; the adapter
 * must understand all three because the model inside the search request
 * decides which to run, and each contributes to the result.
 */
export type WebSearchCallAction =
  | { readonly type: 'search'; readonly queries?: string[] | null; readonly query?: string | null }
  | { readonly type: 'open_page'; readonly url?: string | null }
  | { readonly type: 'find_in_page'; readonly url?: string | null; readonly pattern?: string | null }

/** A `web_search_call` output item: evidence that the server ran the tool. */
export interface WebSearchCallItem {
  readonly type: 'web_search_call'
  readonly id?: string
  readonly status?: string
  readonly action?: WebSearchCallAction
}

/** A citeable URL annotation on a message content part. */
export interface UrlAnnotation {
  readonly type?: string
  readonly url?: string | null
  /** Common gateway extension for the cited URL. */
  readonly link?: string | null
  readonly title?: string | null
}

/** One content part of a `message` output item. */
export interface ResponseContentPart {
  readonly type?: string
  readonly text?: string | null
  readonly annotations?: readonly UrlAnnotation[] | null
}

/** A `message` output item: the model's answer text plus cited URLs. */
export interface ResponseMessageItem {
  readonly type: 'message'
  readonly content?: readonly ResponseContentPart[]
}

/** Any output item; only `message` and `web_search_call` are consumed. */
export type ResponseOutputItem = WebSearchCallItem | ResponseMessageItem | { readonly type: string }

/** The non-streamed Responses envelope. */
export interface ResponsesResponse {
  readonly id?: string
  readonly status?: string
  readonly output?: readonly ResponseOutputItem[]
}

// ── Anthropic-compatible Messages API ───────────────────────────────────────

/** A `web_search_result` item inside a `web_search_tool_result` block. */
export interface WebSearchResultItem {
  readonly type: string
  readonly url: string
  readonly title?: string | null
  /** Provider-supplied page age/recency string (mapped to `publishedAt`). */
  readonly page_age?: string | null
}

/** A `web_search_tool_result` content block: the citeable result shape. */
export interface WebSearchToolResultBlock {
  readonly type: 'web_search_tool_result'
  readonly content?: readonly WebSearchResultItem[]
}

/** One citation location inside a `text` block (the snippet source). */
export interface CitationLocation {
  readonly type?: string
  readonly url?: string | null
  readonly cited_text?: string | null
}

/** A `text` content block: the model's prose plus per-URL citations. */
export interface TextBlock {
  readonly type: 'text'
  readonly text?: string | null
  readonly citations?: readonly CitationLocation[]
}

/** Any content block; only `web_search_tool_result` and `text` are consumed. */
export type ContentBlock = WebSearchToolResultBlock | TextBlock | { readonly type: string }

/** The Messages response envelope. */
export interface AnthropicResponse {
  readonly content?: readonly ContentBlock[]
}

// ── Session logging ─────────────────────────────────────────────────────────

/**
 * The secret-free auxiliary search request recorded immediately before
 * dispatch, mirroring `dsh-web-search-deepseek`'s `web/deepseek-search-llm-request`
 * so a native search is reconstructable from the session log. Headers and
 * credentials are excluded.
 */
export type SearchLlmRequest =
  | {
    readonly protocol: 'openai-responses'
    readonly endpoint: string
    /** The exact JSON body sent to the provider. */
    readonly body: unknown
  }
  | {
    readonly protocol: 'anthropic-messages'
    readonly endpoint: string
    /** The `anthropic-version` header value. */
    readonly apiVersion: string
    /** The exact JSON body sent to the provider. */
    readonly body: unknown
  }

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Secret-free auxiliary native-search request recorded before dispatch. */
    'web/search-native-llm-request': SearchLlmRequest
  }
}
