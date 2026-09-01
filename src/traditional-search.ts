/**
 * Traditional `ctx.web` search provider backed by a verified OpenAI Responses
 * candidate. This is intentionally search-only: URL fetching remains owned by
 * dedicated anonymous fetch providers.
 * @module dsh-github-copilot/traditional-search
 */

import { attributionHeaders } from '@deepseek-ai/dsh-llm'
import { WebError } from '@deepseek-ai/dsh-web'
import type { WebSearchProvider, WebSearchRequest, WebSearchResult, WebSearchSource } from '@deepseek-ai/dsh-web'
import type { InlineConfig } from './config.ts'
import { abortable, isAbortError, readBounded } from './http.ts'
import { WEB_SEARCH_TOOL_TYPE } from './plan.ts'
import type { SearchPlan, SearchPlanCandidate } from './plan.ts'
import type { InlineHooks } from './wire.ts'
import type {
  ResponsesAnnotation,
  ResponsesMessageItem,
  ResponsesResponse,
  ResponsesWebSearchSource,
  WebSearchCallItem,
} from './types.ts'

/** Stable provider id selected through `web.searchProvider`. */
export const GITHUB_COPILOT_HOSTED_SEARCH_PROVIDER_ID = 'github-copilot-hosted'

/** @deprecated Use {@link GITHUB_COPILOT_HOSTED_SEARCH_PROVIDER_ID}. */
export const COPILOT_HOSTED_SEARCH_PROVIDER_ID = GITHUB_COPILOT_HOSTED_SEARCH_PROVIDER_ID

/** Build the search-only provider registered with `ctx.web`. */
export function createTraditionalSearchProvider(
  available: () => boolean,
  plan: () => SearchPlan,
  hooks: InlineHooks,
  config: () => InlineConfig,
): WebSearchProvider {
  return {
    id: GITHUB_COPILOT_HOSTED_SEARCH_PROVIDER_ID,
    available,
    search: (request, signal) => {
      if (signal?.aborted === true) return Promise.reject(aborted())
      if (!available()) {
        return Promise.reject(new WebError('the github-copilot-hosted search provider is unavailable for the current route', 'WEB_PROVIDER_UNAVAILABLE'))
      }
      return searchResponses(request, signal, plan(), hooks, config())
    },
  }
}

/** Execute one bounded native-search Responses request and normalize its result. */
async function searchResponses(
  request: WebSearchRequest,
  signal: AbortSignal | undefined,
  plan: SearchPlan,
  hooks: InlineHooks,
  config: InlineConfig,
): Promise<WebSearchResult> {
  if (isAborted(signal)) throw aborted()
  const timeout = AbortSignal.timeout(config.idleTimeoutMs)
  const combined = signal === undefined ? timeout : AbortSignal.any([signal, timeout])
  let candidate: SearchPlanCandidate
  try {
    candidate = await abortable(plan.settle(), combined)
  } catch (error) {
    if (signal?.aborted === true) throw aborted()
    if (timeout.aborted || isAbortError(error)) {
      throw new WebError('web search timed out', 'WEB_PROVIDER_ERROR')
    }
    // Probe diagnostics may include an upstream response body. Keep that
    // detail inside the plan/logger boundary rather than exposing it through
    // the public ctx.web error.
    throw new WebError('the native search capability probe did not find a usable Responses provider', 'WEB_PROVIDER_UNAVAILABLE')
  }
  if (candidate.protocol !== 'openai-responses') {
    throw new WebError('the verified search candidate does not support the Responses bridge', 'WEB_PROVIDER_UNAVAILABLE')
  }

  let apiKey: string | undefined
  try {
    apiKey = await abortable(hooks.resolveApiKey(candidate.apiKeyEnv), combined)
  } catch (error) {
    throw translateError(error, signal, timeout)
  }
  if (apiKey === undefined || apiKey.length === 0) {
    throw new WebError(`no API key for "${candidate.apiKeyEnv}"`, 'WEB_PROVIDER_UNAVAILABLE')
  }

  const endpoint = `${candidate.baseURL.replace(/\/+$/, '')}/responses`
  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      redirect: 'error',
      signal: combined,
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
        accept: 'application/json',
        ...attributionHeaders(),
      },
      body: JSON.stringify({
        model: candidate.model,
        input: [{ role: 'user', content: [{ type: 'input_text', text: request.query }] }],
        tools: [{ type: candidate.webSearchToolType ?? WEB_SEARCH_TOOL_TYPE }],
        tool_choice: candidate.webSearchToolType === WEB_SEARCH_TOOL_TYPE
          || candidate.webSearchToolType === undefined
          ? 'required'
          : { type: candidate.webSearchToolType },
        include: ['web_search_call.action.sources'],
        stream: false,
      }),
    })
  } catch (error) {
    throw translateError(error, signal, timeout)
  }

  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    // Provider bodies are deliberately not surfaced: a gateway may echo
    // credentials or request headers in diagnostics.
    throw new WebError(`Responses API error (HTTP ${response.status})`, 'WEB_PROVIDER_ERROR')
  }

  let body: ResponsesResponse
  try {
    body = JSON.parse(await readBounded(response, endpoint)) as ResponsesResponse
  } catch (error) {
    if (isAborted(signal) || timeout.aborted || isAbortError(error)) {
      throw translateError(error, signal, timeout)
    }
    throw new WebError('Responses API returned an invalid search result', 'WEB_PROVIDER_ERROR')
  }

  const content: string[] = []
  const sources = new Map<string, WebSearchSource>()
  for (const item of body.output ?? []) {
    if (item.type === 'web_search_call') {
      for (const source of (item as WebSearchCallItem).action?.sources ?? []) addSource(sources, source)
      continue
    }
    if (item.type !== 'message') continue
    for (const part of (item as ResponsesMessageItem).content ?? []) {
      if (typeof part.text === 'string' && part.text.length > 0) content.push(part.text)
      for (const annotation of part.annotations ?? []) addSource(sources, annotation)
    }
  }

  return {
    ...(content.length > 0 ? { content: content.join('\n') } : {}),
    sources: [...sources.values()],
    truncated: false,
  }
}

/** Add one valid source, merging richer duplicate metadata without inventing it. */
function addSource(
  sources: Map<string, WebSearchSource>,
  source: ResponsesWebSearchSource | ResponsesAnnotation,
): void {
  if (typeof source.url !== 'string' || source.url.length === 0) return
  const existing = sources.get(source.url)
  sources.set(source.url, {
    url: source.url,
    ...existing?.title !== undefined ? { title: existing.title } : typeof source.title === 'string' ? { title: source.title } : {},
    ...existing?.snippet !== undefined ? { snippet: existing.snippet } : typeof source.snippet === 'string' ? { snippet: source.snippet } : {},
    ...existing?.publishedAt !== undefined
      ? { publishedAt: existing.publishedAt }
      : typeof source.published_at === 'string' ? { publishedAt: source.published_at } : {},
  })
}

/** Translate cancellation/timeout/transport failures into the web seam taxonomy. */
function translateError(error: unknown, caller: AbortSignal | undefined, timeout: AbortSignal): WebError {
  if (isAborted(caller)) return aborted()
  if (timeout.aborted || isAbortError(error)) {
    return new WebError('web search timed out', 'WEB_PROVIDER_ERROR', { cause: error })
  }
  if (error instanceof WebError) return error
  return new WebError('web search provider request failed', 'WEB_PROVIDER_ERROR', { cause: error })
}

function aborted(): WebError {
  return new WebError('web search aborted', 'WEB_ABORTED')
}

/** Read the signal live after awaits without preserving an earlier narrowing. */
function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true
}
