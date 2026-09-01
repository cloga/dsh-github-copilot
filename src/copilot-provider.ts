/**
 * DSH `llm-pi-ai` route composition for an OpenAI-compatible GitHub Copilot
 * gateway. Core remains the owner of model selection and all normal model
 * calls; this module only turns catalog metadata into installer-ready routes.
 * @module dsh-github-copilot/copilot-provider
 */

import type { CatalogModel } from './model-catalog.ts'

export type GitHubCopilotApi = 'openai-responses' | 'openai-completions'

export const GITHUB_COPILOT_PROVIDER_ID = 'github-copilot'
export const GITHUB_COPILOT_CHAT_PROVIDER_ID = 'github-copilot-chat'
export const GITHUB_COPILOT_API_KEY_ENV = 'COPILOT_GITHUB_TOKEN'

export interface GitHubCopilotProviderRoute {
  readonly api: GitHubCopilotApi
  readonly baseURL: string
  readonly apiKeyEnv: string
  readonly models: readonly CatalogModel[]
}

export interface GitHubCopilotRouteComposition {
  readonly providers: Readonly<Record<string, GitHubCopilotProviderRoute>>
}

export interface GitHubCopilotRouteOptions {
  /** OpenAI-compatible gateway API root, normally ending in `/v1`. */
  readonly baseURL: string
  /** Models returned by catalog discovery or the installer's pinned fallback. */
  readonly models: readonly CatalogModel[]
  /** DSH credential reference, not the credential value. */
  readonly apiKeyEnv?: string
  /** Responses route id; the Chat route receives a `-chat` suffix. */
  readonly providerId?: string
}

function assertNonEmpty(value: string, field: string): void {
  if (value.trim().length === 0) throw new Error(`github-copilot: ${field} must not be empty`)
}

function normalizedBaseURL(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('github-copilot: baseURL must be an absolute URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('github-copilot: baseURL must use http or https')
  }
  return value.replace(/\/+$/u, '')
}

function modelApis(model: CatalogModel): readonly GitHubCopilotApi[] {
  if (model.apis !== undefined && model.apis.length > 0) return model.apis
  return [model.api ?? 'openai-responses']
}

/**
 * Compose the exact `llm-pi-ai.providers` fragment written by deployment
 * tooling. Models advertising both endpoints are selectable on both routes;
 * endpoint-specific models appear only on their supported route.
 */
export function composeGitHubCopilotProviderRoutes(
  options: GitHubCopilotRouteOptions,
): GitHubCopilotRouteComposition {
  const baseURL = normalizedBaseURL(options.baseURL)
  const apiKeyEnv = options.apiKeyEnv ?? GITHUB_COPILOT_API_KEY_ENV
  const providerId = options.providerId ?? GITHUB_COPILOT_PROVIDER_ID
  const chatProviderId = options.providerId === undefined
    ? GITHUB_COPILOT_CHAT_PROVIDER_ID
    : `${providerId}-chat`
  assertNonEmpty(apiKeyEnv, 'apiKeyEnv')
  assertNonEmpty(providerId, 'providerId')
  if (options.models.length === 0) throw new Error('github-copilot: at least one model is required')

  const seen = new Set<string>()
  for (const model of options.models) {
    assertNonEmpty(model.id, 'model id')
    if (seen.has(model.id)) throw new Error(`github-copilot: duplicate model id "${model.id}"`)
    seen.add(model.id)
  }

  const responses = options.models.filter(model => modelApis(model).includes('openai-responses'))
  const chat = options.models.filter(model => modelApis(model).includes('openai-completions'))
  const providers: Record<string, GitHubCopilotProviderRoute> = {}
  if (responses.length > 0) {
    providers[providerId] = {
      api: 'openai-responses',
      baseURL,
      apiKeyEnv,
      models: responses,
    }
  }
  if (chat.length > 0) {
    providers[chatProviderId] = {
      api: 'openai-completions',
      baseURL,
      apiKeyEnv,
      models: chat,
    }
  }
  if (Object.keys(providers).length === 0) {
    throw new Error('github-copilot: catalog contains no supported OpenAI models')
  }
  return { providers }
}
