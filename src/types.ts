/**
 * Provider-private wire types for the two search-capable protocols this
 * package speaks, restricted to the shapes the capability probe consumes:
 * the OpenAI Responses API `web_search_call` evidence item and the
 * Anthropic-compatible Messages API `web_search_tool_result` block. The
 * probe's verdict is structural — a reply containing the evidence item means
 * the endpoint executed native search inside the request.
 * @module dsh-github-copilot/types
 */

// ── OpenAI Responses API ────────────────────────────────────────────────────

/** A `web_search_call` output item: evidence that the server ran the tool. */
export interface WebSearchCallItem {
  readonly type: 'web_search_call'
  readonly id?: string
  readonly status?: string
  readonly action?: {
    readonly sources?: readonly ResponsesWebSearchSource[]
  }
}

/** One Responses citation or search source. */
export interface ResponsesWebSearchSource {
  readonly url?: string
  readonly title?: string
  readonly snippet?: string
  readonly published_at?: string
}

/** One annotation on generated output text. */
export interface ResponsesAnnotation extends ResponsesWebSearchSource {
  readonly type?: string
}

/** Generated output text carrying optional URL citations. */
export interface ResponsesOutputText {
  readonly type: 'output_text'
  readonly text?: string
  readonly annotations?: readonly ResponsesAnnotation[]
}

/** A generated message in a non-streamed Responses envelope. */
export interface ResponsesMessageItem {
  readonly type: 'message'
  readonly content?: readonly ResponsesOutputText[]
}

/** Any output item consumed by the probe or traditional-search bridge. */
export type ResponseOutputItem = WebSearchCallItem | ResponsesMessageItem | { readonly type: string }

/** The non-streamed Responses envelope the probe parses. */
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
}

/** A `web_search_tool_result` content block: the citeable result shape. */
export interface WebSearchToolResultBlock {
  readonly type: 'web_search_tool_result'
  readonly content?: readonly WebSearchResultItem[]
}

/** Any content block; only `web_search_tool_result` is consumed by the probe. */
export type ContentBlock = WebSearchToolResultBlock | { readonly type: string }

/** The Messages response envelope the probe parses. */
export interface AnthropicResponse {
  readonly content?: readonly ContentBlock[]
}
