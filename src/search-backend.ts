import { WebError } from '@deepseek-ai/dsh-web'

/** Safe request-option leaves; never includes auth, URL path/query or opaque provider state. */
export interface SearchBackend {
  readonly provider: 'deepseek-official'
  readonly origin: string
  readonly model: string
  readonly customEndpoint: boolean
}

/** Bounded metadata included in the same query's successful or failed fallback notice. */
export function describeSearchBackend(backend: SearchBackend): string {
  const origin = backend.origin.slice(0, 512) + (backend.origin.length > 512 ? ' (truncated)' : '')
  const model = JSON.stringify(backend.model.slice(0, 256)) + (backend.model.length > 256 ? ' (truncated)' : '')
  return `Fallback backend: adapter=${backend.provider}; origin=${origin}; model=${model}; endpoint=${backend.customEndpoint ? 'custom' : 'default'}.`
}

/** Known sanitized failure, distinct from arbitrary native provider exception messages. */
export class DescribedSearchFallbackError extends WebError {
  constructor(readonly backend: SearchBackend | undefined, code: WebError['code'] = 'WEB_PROVIDER_ERROR') {
    super('the configured DeepSeek fallback failed', code)
  }
}
