import type { SearchPlanCandidate } from './plan.ts'

export interface ResolvedRequestAuth {
  readonly apiKey: string
  readonly baseURL?: string
  readonly headers?: Readonly<Record<string, string | null>>
}

export function normalizeRequestAuth(auth: string | ResolvedRequestAuth | undefined): ResolvedRequestAuth | undefined {
  return typeof auth === 'string' ? { apiKey: auth } : auth
}

export function applyRequestAuth(
  candidate: SearchPlanCandidate,
  auth: ResolvedRequestAuth,
): SearchPlanCandidate {
  return {
    ...candidate,
    ...auth.baseURL === undefined
      ? {}
      : {
          baseURL: candidate.protocol === 'anthropic-messages'
            ? `${auth.baseURL.replace(/\/+$/, '').replace(/\/v1$/u, '')}/v1`
            : auth.baseURL,
        },
    ...auth.headers === undefined
      ? {}
      : { headers: { ...candidate.headers, ...auth.headers } },
  }
}

/** Materialize pi-ai catalog headers and Copilot's per-request metadata. */
export function providerRequestHeaders(
  candidate: SearchPlanCandidate,
  initiator: 'agent' | 'user',
): Readonly<Record<string, string>> {
  const headers: Record<string, string> = {}
  for (const [name, value] of Object.entries(candidate.headers ?? {})) {
    if (value !== null) headers[name] = value
  }
  try {
    const hostname = new URL(candidate.baseURL).hostname.toLowerCase()
    if (hostname.endsWith('.githubcopilot.com') || hostname.startsWith('copilot-api.')) {
      headers['X-Initiator'] = initiator
      headers['Openai-Intent'] = 'conversation-edits'
    }
  } catch {
    // URL validation belongs to plan construction; preserve the original error path.
  }
  return headers
}
