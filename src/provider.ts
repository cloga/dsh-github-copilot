/**
 * The `ctx.web` search provider: one provider id, two wire protocols. Each
 * operation snapshots the current plan and its credential, so a settings
 * change between searches can never split an operation across two sections;
 * `available()` delegates to the plan so the auto-disable decision is
 * visible to the seam's provider selection.
 * @module dsh-web-search-provider/provider
 */

import type { WebSearchProvider, WebSearchRequest, WebSearchResult } from '@deepseek-ai/dsh-web'
import type { SearchLlmRequest } from './types.ts'
import { runResponsesSearch } from './responses.ts'
import { runAnthropicSearch } from './anthropic.ts'
import type { SearchPlan } from './plan.ts'

/** Stable id this provider registers under in the web seam. */
export const WEB_SEARCH_PROVIDER_ID = 'web-search-provider'

/** The plugin-level hooks one operation resolves its request through. */
export interface NativeSearchProviderHooks {
  /** Literal API key for the current section; when present it wins over the reference. */
  readonly apiKeyOf: () => string | undefined
  /** Resolve one credential reference through the credentials seam. */
  readonly resolveApiKey: (apiKeyEnv: string) => Promise<string | undefined>
  /**
   * Record the exact secret-free request immediately before dispatch. A
   * throw prevents dispatch so model-visible auxiliary input cannot escape
   * logging.
   */
  readonly recordRequest?: (request: SearchLlmRequest) => void
}

/**
 * The native search provider. Registered once; the plan it serves is a thunk
 * because the settings section can change between searches, and re-registering
 * the provider to carry a new plan would make the seam's selection observable
 * to the user as a flicker.
 */
export class NativeSearchProvider implements WebSearchProvider {
  readonly id = WEB_SEARCH_PROVIDER_ID

  /**
   * @param planOf - the plan for the NEXT operation, snapshotted at entry.
   * @param hooks - credential and request-recording hooks.
   */
  constructor(
    private readonly planOf: () => SearchPlan,
    private readonly hooks: NativeSearchProviderHooks,
  ) {}

  available(): boolean {
    return this.planOf().available()
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const plan = this.planOf()
    const candidate = await plan.settle()
    const apiKey = this.hooks.apiKeyOf()
    if (candidate.protocol === 'openai-responses') {
      return runResponsesSearch(
        {
          baseURL: candidate.baseURL,
          model: candidate.model,
          ...apiKey !== undefined ? { apiKey } : {},
          resolveApiKey: () => this.hooks.resolveApiKey(candidate.apiKeyEnv),
          apiKeyEnv: candidate.apiKeyEnv,
          maxOutputTokens: candidate.maxOutputTokens,
          ...this.hooks.recordRequest === undefined ? {} : { recordRequest: this.hooks.recordRequest },
        },
        { action: 'search', text: request.query },
        signal,
      )
    }
    return runAnthropicSearch(
      {
        baseURL: candidate.baseURL,
        model: candidate.model,
        apiVersion: candidate.apiVersion,
        maxTokens: candidate.maxTokens,
        maxUses: candidate.maxUses,
        ...apiKey !== undefined ? { apiKey } : {},
        resolveApiKey: () => this.hooks.resolveApiKey(candidate.apiKeyEnv),
        apiKeyEnv: candidate.apiKeyEnv,
        ...this.hooks.recordRequest === undefined ? {} : { recordRequest: this.hooks.recordRequest },
      },
      request.query,
      signal,
    )
  }
}
