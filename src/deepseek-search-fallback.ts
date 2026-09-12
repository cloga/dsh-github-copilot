import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { WebError } from '@deepseek-ai/dsh-web'
import type { WebSearchProvider } from '@deepseek-ai/dsh-web'
import type { Config as DeepSeekConfig } from '@deepseek-ai/dsh-web-search-deepseek'

/**
 * Construct a known official fallback only when a permitted fallback is needed.
 * The official provider owns transport, redirects, response parsing and failures.
 * Settings are read from its existing namespace; credentials stay in their owner.
 */
export async function createDeepSeekSearchFallback(ctx: Context, owner: Agent | undefined): Promise<WebSearchProvider> {
  const native = await import('@deepseek-ai/dsh-web-search-deepseek').catch(() => {
    throw new WebError('the installed Core does not expose the official DeepSeek fallback provider', 'WEB_PROVIDER_UNAVAILABLE')
  })
  const { launchEnvironmentOf } = await import('@deepseek-ai/dsh-launch-environment').catch(() => {
    throw new WebError('the official launch-environment API required by DeepSeek fallback is unavailable', 'WEB_PROVIDER_UNAVAILABLE')
  })
  return new native.DeepSeekSearchProvider(() => {
    const config = (ctx.get('settings')?.get(native.WEB_SEARCH_DEEPSEEK_SETTINGS_NAMESPACE as SettingsNamespace) ?? {}) as DeepSeekConfig
    const apiKeyEnv = credentialRef(config.apiKeyEnv ?? 'DEEPSEEK_API_KEY')
    const environment = launchEnvironmentOf(ctx)
    return {
      ...config.apiKey === undefined || config.apiKey.length === 0 ? {} : { apiKey: config.apiKey },
      apiKeyEnv,
      resolveApiKey: async () => {
        const credentials = ctx.get('credentials')
        if (credentials !== undefined) return (await credentials.resolve(apiKeyEnv))?.value
        const ambient = environment.get(apiKeyEnv)?.value
        return ambient === undefined || ambient.length === 0 ? undefined : ambient
      },
      baseURL: config.baseURL ?? environment.get('DEEPSEEK_SEARCH_BASE_URL')?.value ?? native.DEEPSEEK_DEFAULT_BASE_URL,
      model: config.model ?? native.DEEPSEEK_DEFAULT_MODEL,
      apiVersion: config.apiVersion ?? native.DEEPSEEK_DEFAULT_API_VERSION,
      maxTokens: config.maxTokens ?? native.DEEPSEEK_DEFAULT_MAX_TOKENS,
      maxUses: config.maxUses ?? native.DEEPSEEK_DEFAULT_MAX_USES,
      recordRequest: request => { owner?.session.append('web/deepseek-search-llm-request', request) },
    }
  })
}
