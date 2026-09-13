import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { WebError } from '@deepseek-ai/dsh-web'
import type { WebSearchProvider } from '@deepseek-ai/dsh-web'
import type { Config as DeepSeekConfig, DeepSeekSearchProviderOptions } from '@deepseek-ai/dsh-web-search-deepseek'
import { describeSearchBackend, DescribedSearchFallbackError } from './search-backend.ts'
import type { SearchBackend } from './search-backend.ts'

class InvalidFallbackBase extends WebError {
  constructor() {
    super('DeepSeek fallback requires an HTTP(S) API base URL without userinfo, query or fragment', 'WEB_PROVIDER_UNAVAILABLE')
  }
}

class InvalidFallbackProof extends WebError {
  constructor() {
    super('web search owner or account proof invalidated before fallback dispatch', 'WEB_PROVIDER_UNAVAILABLE')
  }
}

/**
 * Compose a known official fallback only when permitted. The public native class
 * owns transport, redirects and parsing. A per-operation instance keeps backend
 * disclosure aligned with that operation's options even during concurrent calls.
 * canContinue must be the initiating router's captured operation-local guard.
 */
export async function createDeepSeekSearchFallback(
  ctx: Context, owner: Agent | undefined, canContinue: () => boolean,
): Promise<WebSearchProvider> {
  const native = await import('@deepseek-ai/dsh-web-search-deepseek').catch(() => {
    throw new WebError('the installed Core does not expose the official DeepSeek fallback provider', 'WEB_PROVIDER_UNAVAILABLE')
  })
  const { launchEnvironmentOf } = await import('@deepseek-ai/dsh-launch-environment').catch(() => {
    throw new WebError('the official launch-environment API required by DeepSeek fallback is unavailable', 'WEB_PROVIDER_UNAVAILABLE')
  })
  const resolveOptions = (signal?: AbortSignal): DeepSeekSearchProviderOptions => {
    const config = (ctx.get('settings')?.get(native.WEB_SEARCH_DEEPSEEK_SETTINGS_NAMESPACE as SettingsNamespace) ?? {}) as DeepSeekConfig
    const environment = launchEnvironmentOf(ctx)
    const baseURL = config.baseURL ?? environment.get('DEEPSEEK_SEARCH_BASE_URL')?.value ?? native.DEEPSEEK_DEFAULT_BASE_URL
    // Native request recording includes the full base. Refuse URL credentials,
    // query or fragment before auth/logging; never echo or rewrite unsafe input.
    const parsed = URL.canParse(baseURL) ? new URL(baseURL) : undefined
    if (parsed === undefined || !['http:', 'https:'].includes(parsed.protocol)
      || parsed.username.length > 0 || parsed.password.length > 0
      || parsed.href.includes('?') || parsed.href.includes('#')) throw new InvalidFallbackBase()
    const apiKeyEnv = credentialRef(config.apiKeyEnv ?? 'DEEPSEEK_API_KEY')
    return {
      ...config.apiKey === undefined || config.apiKey.length === 0 ? {} : { apiKey: config.apiKey },
      apiKeyEnv,
      resolveApiKey: async () => {
        const credentials = ctx.get('credentials')
        if (credentials !== undefined) return (await credentials.resolve(apiKeyEnv))?.value
        const ambient = environment.get(apiKeyEnv)?.value
        return ambient === undefined || ambient.length === 0 ? undefined : ambient
      },
      baseURL,
      model: config.model ?? native.DEEPSEEK_DEFAULT_MODEL,
      apiVersion: config.apiVersion ?? native.DEEPSEEK_DEFAULT_API_VERSION,
      maxTokens: config.maxTokens ?? native.DEEPSEEK_DEFAULT_MAX_TOKENS,
      maxUses: config.maxUses ?? native.DEEPSEEK_DEFAULT_MAX_USES,
      recordRequest: request => {
        // The public native provider calls this after awaited auth (including
        // literal keys), synchronously before fetch. Check before recording too:
        // rejecting only after native.search returns would already incur charges.
        if (signal?.aborted === true) throw new WebError('web search aborted', 'WEB_ABORTED')
        if (!canContinue()) throw new InvalidFallbackProof()
        owner?.session.append('web/deepseek-search-llm-request', request)
      },
    }
  }
  const availability = new native.DeepSeekSearchProvider(resolveOptions)
  return {
    id: native.DEEPSEEK_PROVIDER_ID,
    available: () => {
      try { return availability.available() }
      catch (error) {
        if (error instanceof InvalidFallbackBase) throw error
        throw new WebError('the configured DeepSeek fallback options are unavailable', 'WEB_PROVIDER_UNAVAILABLE')
      }
    },
    search: async (request, signal) => {
      let backend: SearchBackend | undefined
      const operation = new native.DeepSeekSearchProvider(() => {
        const options = resolveOptions(signal)
        const parsed = new URL(options.baseURL)
        backend = {
          provider: native.DEEPSEEK_PROVIDER_ID,
          origin: parsed.origin,
          model: options.model,
          customEndpoint: parsed.href.replace(/\/+$/, '') !== new URL(native.DEEPSEEK_DEFAULT_BASE_URL).href.replace(/\/+$/, ''),
        }
        return options
      })
      try {
        const result = await operation.search(request, signal)
        if (backend === undefined) throw new DescribedSearchFallbackError(undefined)
        return { ...result, content: `${describeSearchBackend(backend)}\n\n${result.content ?? ''}`.trimEnd() }
      } catch (error) {
        if (error instanceof InvalidFallbackBase || error instanceof InvalidFallbackProof
          || error instanceof WebError && error.code === 'WEB_ABORTED') throw error
        throw new DescribedSearchFallbackError(backend, error instanceof WebError ? error.code : 'WEB_PROVIDER_ERROR')
      }
    },
  }
}
