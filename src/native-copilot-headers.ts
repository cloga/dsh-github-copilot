import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-llm-pi-ai'
import { githubCopilotProvider } from '@earendil-works/pi-ai/providers/github-copilot'
import { GITHUB_COPILOT_PROVIDER_ID } from './copilot-identity.ts'
import { copilotPublicHeaders } from './preview-provider.ts'

/** Supplement ID-only models through the native adapter's request-local public hook. */
export function installNativeCopilotHeaders(ctx: Context): () => void {
  const native = githubCopilotProvider()
  const endpoints = new Set(native.getModels().map(model => new URL(model.baseUrl).href))
  const publicHeaders = copilotPublicHeaders()
  const names = ['Editor-Version', 'Editor-Plugin-Version', 'Copilot-Integration-Id'] as const
  return ctx.on('llm-pi-ai/request-headers', (request, headers, next) => {
    if (request.provider !== GITHUB_COPILOT_PROVIDER_ID) return next()
    let endpoint: URL
    try { endpoint = new URL(request.baseURL) }
    catch { return next() }
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password
      || !endpoints.has(endpoint.href)) return next()
    for (const name of names) {
      if (!headers.has(name)) headers.set(name, publicHeaders[name]!)
    }
    return next()
  })
}
