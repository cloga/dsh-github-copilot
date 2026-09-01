/**
 * Failure-safe discovery of OpenAI-compatible model catalogs. This module
 * deliberately returns data to the settings owner instead of mutating the
 * `llm-pi-ai` namespace from this plugin.
 * @module dsh-github-copilot/model-catalog
 */

/** Reasoning effort values understood by the llm-pi-ai settings model. */
export type CatalogReasoningEfforts = Readonly<Record<string, string | null>>

/** A settings-friendly interactive model entry discovered from `/v1/models`. */
export interface CatalogModel {
  readonly id: string
  readonly name: string
  readonly api?: 'openai-responses' | 'openai-completions'
  /** Every supported interactive OpenAI endpoint; `api` is the preferred one. */
  readonly apis?: readonly ('openai-responses' | 'openai-completions')[]
  readonly input: readonly ('text' | 'image')[]
  readonly contextWindow?: number
  readonly maxTokens?: number
  readonly reasoning?: boolean
  readonly reasoningEfforts?: CatalogReasoningEfforts
}

/** Options for one failure-safe catalog refresh. */
export interface ModelCatalogSyncOptions {
  /** OpenAI-compatible API root, with or without a trailing `/v1`. */
  readonly baseURL: string
  /** Static catalog retained exactly when discovery cannot produce a usable listing. */
  readonly fallback: readonly CatalogModel[]
  /** Optional request headers, such as provider-owned authorization headers. */
  readonly headers?: HeadersInit
  /** Maximum discovery round trip in milliseconds. */
  readonly timeoutMs?: number
  /** Optional caller cancellation. */
  readonly signal?: AbortSignal
  /** Fetch seam for hosts and tests. */
  readonly fetch?: typeof fetch
  /** Optional diagnostic hook; discovery still resolves to the fallback. */
  readonly onError?: (error: unknown) => void
}

const DEFAULT_DISCOVERY_TIMEOUT_MS = 5_000

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
}

function firstPositiveInteger(...values: readonly unknown[]): number | undefined {
  for (const value of values) {
    const found = positiveInteger(value)
    if (found !== undefined) return found
  }
  return undefined
}

function normalizedEndpoint(value: unknown): string | undefined {
  const endpoint = nonEmptyString(value)
  if (endpoint === undefined) return undefined
  try {
    return new URL(endpoint, 'https://catalog.invalid').pathname.replace(/^\/v1(?=\/)/u, '').replace(/\/+$/u, '')
  } catch {
    return undefined
  }
}

function apisFromEndpoints(raw: unknown): CatalogModel['apis'] | undefined {
  if (!Array.isArray(raw)) return undefined
  const endpoints = raw.map(normalizedEndpoint)
  const apis: NonNullable<CatalogModel['apis']>[number][] = []
  if (endpoints.includes('/responses')) apis.push('openai-responses')
  if (endpoints.includes('/chat/completions')) apis.push('openai-completions')
  return apis.length > 0 ? apis : undefined
}

function apiFromEndpoints(raw: unknown): CatalogModel['api'] | undefined {
  return apisFromEndpoints(raw)?.[0]
}

function hasInteractiveEndpoint(raw: unknown): boolean {
  if (!Array.isArray(raw)) return true
  return apiFromEndpoints(raw) !== undefined
}

function reasoningEfforts(raw: unknown): CatalogReasoningEfforts | undefined {
  if (!Array.isArray(raw)) return undefined
  const efforts: Record<string, string | null> = {}
  for (const value of raw) {
    if (value === 'none') efforts['off'] = null
    else if (value === 'minimal'
      || value === 'low'
      || value === 'medium'
      || value === 'high'
      || value === 'xhigh'
      || value === 'max') efforts[value] = value
  }
  return Object.keys(efforts).length > 0 ? efforts : undefined
}

function isSelectableChatModel(
  raw: Record<string, unknown>,
  capabilities: Record<string, unknown>,
  supports: Record<string, unknown>,
): boolean {
  if (raw['model_picker_enabled'] === false) return false
  if (record(raw['policy'])?.['state'] === 'disabled') return false
  const type = nonEmptyString(capabilities['type']) ?? nonEmptyString(raw['type'])
  if (type !== undefined && type !== 'chat') return false
  if (supports['tool_calls'] === false) return false
  return hasInteractiveEndpoint(raw['supported_endpoints'])
}

function mergeDiscoveredModel(raw: Record<string, unknown>, fallback: CatalogModel | undefined): CatalogModel | undefined {
  const id = nonEmptyString(raw['id'])
  if (id === undefined) return undefined
  const capabilities = record(raw['capabilities']) ?? {}
  const supports = record(capabilities['supports']) ?? {}
  if (!isSelectableChatModel(raw, capabilities, supports)) return undefined

  const limits = record(capabilities['limits']) ?? {}
  const efforts = reasoningEfforts(supports['reasoning_effort'])
  const visionDeclared = supports['vision'] === true
    || supports['vision'] === false
    || record(limits['vision']) !== undefined
  const contextWindow = firstPositiveInteger(
    limits['max_context_window_tokens'],
    capabilities['context_window'],
    raw['context_window'],
  )
  const maxTokens = firstPositiveInteger(
    limits['max_output_tokens'],
    capabilities['max_output_tokens'],
    raw['max_output_tokens'],
  )
  const api = apiFromEndpoints(raw['supported_endpoints'])
  const apis = apisFromEndpoints(raw['supported_endpoints'])
  const reasoning = efforts !== undefined
    ? true
    : typeof supports['reasoning'] === 'boolean' ? supports['reasoning'] : undefined
  const base = reasoning === false && fallback !== undefined
    ? (({ reasoningEfforts: _reasoningEfforts, ...rest }) => rest)(fallback)
    : fallback

  return {
    ...base,
    id,
    name: nonEmptyString(raw['name']) ?? fallback?.name ?? id,
    input: visionDeclared
      ? supports['vision'] === true || record(limits['vision']) !== undefined ? ['text', 'image'] : ['text']
      : fallback?.input ?? ['text'],
    ...api === undefined ? {} : { api },
    ...apis === undefined || apis.length < 2 ? {} : { apis },
    ...contextWindow === undefined ? {} : { contextWindow },
    ...maxTokens === undefined ? {} : { maxTokens },
    ...reasoning === undefined ? {} : { reasoning },
    ...efforts === undefined ? {} : { reasoningEfforts: efforts },
  }
}

/**
 * Parse a standard OpenAI model listing, enriching matching static entries and
 * excluding models only when optional metadata explicitly marks them unsuitable
 * for interactive tool-using chat.
 */
export function modelsFromOpenAICompatibleListing(
  body: unknown,
  fallback: readonly CatalogModel[] = [],
): readonly CatalogModel[] {
  const data = record(body)?.['data']
  if (!Array.isArray(data)) throw new Error('model discovery returned no data array')
  const fallbackById = new Map(fallback.map(model => [model.id, model]))
  const models = data.flatMap((value) => {
    const raw = record(value)
    if (raw === undefined) return []
    const model = mergeDiscoveredModel(raw, fallbackById.get(nonEmptyString(raw['id']) ?? ''))
    return model === undefined ? [] : [model]
  })
  if (models.length === 0) throw new Error('model discovery found no selectable chat models')
  return models
}

/** Resolve the `/v1/models` URL without duplicating an existing v1 segment. */
export function modelCatalogURL(baseURL: string): string {
  const trimmed = baseURL.replace(/\/+$/u, '')
  return /\/v1$/u.test(trimmed) ? `${trimmed}/models` : `${trimmed}/v1/models`
}

/**
 * Fetch and parse an OpenAI-compatible catalog. Network, HTTP, JSON, and
 * validation failures all preserve the caller's static fallback.
 */
export async function synchronizeOpenAICompatibleModelCatalog(
  options: ModelCatalogSyncOptions,
): Promise<readonly CatalogModel[]> {
  const request = options.fetch ?? fetch
  const timeout = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_DISCOVERY_TIMEOUT_MS)
  const signal = options.signal === undefined ? timeout : AbortSignal.any([options.signal, timeout])
  const url = modelCatalogURL(options.baseURL)
  try {
    const headers = new Headers(options.headers)
    if (!headers.has('accept')) headers.set('accept', 'application/json')
    const response = await request(url, {
      method: 'GET',
      headers,
      redirect: 'error',
      signal,
    })
    if (!response.ok) throw new Error(`${url} answered ${response.status}`)
    return modelsFromOpenAICompatibleListing(await response.json(), options.fallback)
  } catch (error) {
    options.onError?.(error)
    return options.fallback
  }
}

/** Package-identity alias for parsing a GitHub Copilot gateway listing. */
export const modelsFromGitHubCopilotListing = modelsFromOpenAICompatibleListing

/** Package-identity alias for resolving the GitHub Copilot catalog endpoint. */
export const githubCopilotModelCatalogURL = modelCatalogURL

/** Package-identity wrapper for failure-safe GitHub Copilot catalog refresh. */
export async function synchronizeGitHubCopilotModelCatalog(
  options: ModelCatalogSyncOptions,
): Promise<readonly CatalogModel[]> {
  return synchronizeOpenAICompatibleModelCatalog(options)
}
