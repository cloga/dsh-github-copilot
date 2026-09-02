import type { OAuthCredential } from '@earendil-works/pi-ai'

export interface GitHubCopilotOAuthCredential extends OAuthCredential {
  readonly enterpriseUrl?: string
  readonly availableModelIds?: readonly string[]
}

function nonEmptyOAuthString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`github-copilot: OAuth credential field "${field}" must be a non-empty string`)
  }
  return value
}

/**
 * Rebuild pi-ai's GitHub Copilot grant as the exact JSON-safe provider shape.
 * Prototype and unrelated extension members are intentionally not preserved.
 */
export function normalizeGitHubCopilotOAuthCredential(credential: unknown): GitHubCopilotOAuthCredential {
  if (typeof credential !== 'object' || credential === null) {
    throw new Error('github-copilot: OAuth credential must be an object')
  }
  if (Reflect.get(credential, 'type') !== 'oauth') {
    throw new Error('github-copilot: OAuth credential type must be "oauth"')
  }
  const refresh = nonEmptyOAuthString(Reflect.get(credential, 'refresh'), 'refresh')
  const access = nonEmptyOAuthString(Reflect.get(credential, 'access'), 'access')
  const expires = Reflect.get(credential, 'expires')
  if (typeof expires !== 'number' || !Number.isFinite(expires)) {
    throw new Error('github-copilot: OAuth credential field "expires" must be a finite number')
  }

  const enterpriseUrl = Reflect.get(credential, 'enterpriseUrl')
  if (enterpriseUrl !== undefined && (typeof enterpriseUrl !== 'string' || enterpriseUrl.trim().length === 0)) {
    throw new Error('github-copilot: OAuth credential field "enterpriseUrl" must be a non-empty string')
  }
  const availableModelIds = Reflect.get(credential, 'availableModelIds')
  if (
    availableModelIds !== undefined
    && (
      !Array.isArray(availableModelIds)
      || !availableModelIds.every(modelId => typeof modelId === 'string' && modelId.trim().length > 0)
    )
  ) {
    throw new Error(
      'github-copilot: OAuth credential field "availableModelIds" must be an array of non-empty strings',
    )
  }

  return {
    type: 'oauth',
    refresh,
    access,
    expires,
    ...enterpriseUrl === undefined ? {} : { enterpriseUrl },
    ...availableModelIds === undefined
      ? {}
      : { availableModelIds: [...new Set<string>(availableModelIds)] },
  }
}
