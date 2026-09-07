/**
 * Provider-side GitHub Copilot auth resolution over the same credential record
 * that DSH's built-in llm-pi-ai adapter owns.
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  createModels,
  type Credential,
  type CredentialInfo,
  type CredentialStore,
} from '@earendil-works/pi-ai'
import { githubCopilotProvider } from '@earendil-works/pi-ai/providers/github-copilot'
import { GITHUB_COPILOT_CREDENTIAL_KEY, GITHUB_COPILOT_PROVIDER_ID, GITHUB_COPILOT_PREVIEW_PROVIDER_ID } from './copilot-identity.ts'
import { normalizeGitHubCopilotOAuthCredential } from './copilot-grant.ts'
import { readCopilotCatalog } from './model-protocol.ts'

export { normalizeGitHubCopilotOAuthCredential } from './copilot-grant.ts'

interface ApiKeyRecord {
  readonly kind: 'api-key'
  readonly key?: string
  readonly env?: Readonly<Record<string, string>>
}

interface GrantRecord {
  readonly kind: 'grant'
  readonly payload: unknown
}

type CredentialRecord = ApiKeyRecord | GrantRecord

interface CredentialRecordService {
  readRecord(key: string): Promise<CredentialRecord | undefined>
  listRecords(): Promise<readonly { key: string; kind: CredentialRecord['kind'] }[]>
  modifyRecord(
    key: string,
    mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>,
  ): Promise<CredentialRecord | undefined>
  deleteRecord(key: string): Promise<void>
}

function credentialService(ctx: Context): CredentialRecordService {
  const candidate = ctx.get('credentials')
  if (typeof candidate !== 'object' || candidate === null) {
    throw new Error('github-copilot: DSH credentials service is unavailable')
  }
  for (const method of ['readRecord', 'listRecords', 'modifyRecord', 'deleteRecord']) {
    if (typeof Reflect.get(candidate, method) !== 'function') {
      throw new Error(`github-copilot: required DSH credentials API "credentials.${method}" is unavailable`)
    }
  }
  return candidate as CredentialRecordService
}

function toCredential(record: CredentialRecord | undefined): Credential | undefined {
  if (record === undefined) return undefined
  if (record.kind === 'api-key') {
    return {
      type: 'api_key',
      ...record.key === undefined ? {} : { key: record.key },
      ...record.env === undefined ? {} : { env: { ...record.env } },
    }
  }
  if (typeof record.payload !== 'object' || record.payload === null) {
    throw new Error('github-copilot: stored llm-pi-ai GitHub Copilot grant is not an object')
  }
  return normalizeGitHubCopilotOAuthCredential(record.payload)
}

function toRecord(credential: Credential): CredentialRecord {
  if (credential.type === 'api_key') {
    return {
      kind: 'api-key',
      ...credential.key === undefined ? {} : { key: credential.key },
      ...credential.env === undefined ? {} : { env: { ...credential.env } },
    }
  }
  return { kind: 'grant', payload: normalizeGitHubCopilotOAuthCredential(credential) }
}

/** Bind exactly one logical route to the canonical Host-owned credential record. */
export function createGitHubCopilotCredentialStore(
  ctx: Context,
  logicalProviderId: typeof GITHUB_COPILOT_PROVIDER_ID | typeof GITHUB_COPILOT_PREVIEW_PROVIDER_ID = GITHUB_COPILOT_PROVIDER_ID,
): CredentialStore {
  const assertProvider = (providerId: string): void => {
    if (providerId !== logicalProviderId) throw new Error('COPILOT_CREDENTIAL_PROVIDER_MISMATCH')
  }
  return {
    read: async (providerId) => {
      assertProvider(providerId)
      return toCredential(await credentialService(ctx).readRecord(GITHUB_COPILOT_CREDENTIAL_KEY))
    },
    list: async (): Promise<readonly CredentialInfo[]> => {
      const record = await credentialService(ctx).readRecord(GITHUB_COPILOT_CREDENTIAL_KEY)
      return record === undefined
        ? []
        : [{ providerId: logicalProviderId, type: record.kind === 'api-key' ? 'api_key' : 'oauth' }]
    },
    modify: async (providerId, mutate) => {
      assertProvider(providerId)
      const stored = await credentialService(ctx).modifyRecord(
        GITHUB_COPILOT_CREDENTIAL_KEY,
        async current => {
          const next = await mutate(toCredential(current))
          return next === undefined ? undefined : toRecord(next)
        },
      )
      return toCredential(stored)
    },
    delete: async (providerId) => {
      assertProvider(providerId)
      await credentialService(ctx).deleteRecord(GITHUB_COPILOT_CREDENTIAL_KEY)
    },
  }
}

/**
 * Build one resolver whose pi-ai collection refreshes OAuth credentials inside
 * the DSH record's serialized modify operation before exposing request auth.
 */
export function createGitHubCopilotTokenResolver(
  ctx: Context,
  onCredentialChanged?: () => Promise<void>,
): (modelId: string) => Promise<GitHubCopilotRequestAuth | undefined> {
  const models = createModels({ credentials: createGitHubCopilotCredentialStore(ctx) })
  const provider = githubCopilotProvider()
  if (provider.auth.oauth === undefined) throw new Error('github-copilot: native OAuth method is unavailable')
  models.setProvider({ ...provider, auth: { oauth: provider.auth.oauth } })
  return async (modelId) => {
    const snapshot = readCopilotCatalog(ctx)
    const installedModels = new Map(snapshot.models.map(model => [model.id, model]))
    const native = installedModels.get(modelId)
    if (native === undefined) {
      throw new Error(`github-copilot: pi-ai catalog has no GitHub Copilot model "${modelId}"`)
    }
    // Resolve OAuth only. A local model would inject headers from another pi copy.
    const resolved = await models.getAuth('github-copilot')
    if (resolved === undefined) return undefined
    if (onCredentialChanged !== undefined) {
      try {
        await onCredentialChanged()
      } catch (error) {
        ctx.logger.warn('github-copilot: provider route reconciliation will retry after a later auth resolution')
        ctx.logger.warn(error)
      }
    }
    const stored = await credentialService(ctx).readRecord(GITHUB_COPILOT_CREDENTIAL_KEY)
    const available = stored?.kind === 'grant'
      && (normalizeGitHubCopilotOAuthCredential(stored.payload).availableModelIds ?? []).includes(modelId)
    if (!available) {
      throw new Error(`github-copilot: model "${modelId}" is not available for the signed-in Copilot account`)
    }
    const apiKey = resolved.auth.apiKey
    if (apiKey === undefined) return undefined
    return {
      apiKey,
      baseURL: trustedCopilotBaseUrl(
        resolved.auth.baseUrl ?? native.baseUrl,
        enterpriseDomainOf(stored),
      ),
      ...resolved.auth.headers === undefined ? {} : { headers: resolved.auth.headers },
    }
  }
}

export interface GitHubCopilotRequestAuth {
  readonly apiKey: string
  readonly baseURL: string
  readonly headers?: Readonly<Record<string, string | null>>
}

function enterpriseDomainOf(record: CredentialRecord | undefined): string | undefined {
  if (record?.kind !== 'grant' || typeof record.payload !== 'object' || record.payload === null) return undefined
  const value = Reflect.get(record.payload, 'enterpriseUrl')
  if (typeof value !== 'string' || value.trim().length === 0) return undefined
  try {
    const url = value.includes('://') ? new URL(value) : new URL(`https://${value}`)
    return url.hostname.toLowerCase()
  } catch {
    throw new Error('github-copilot: stored enterpriseUrl is invalid')
  }
}

/** Validate an OAuth-derived endpoint without disclosing its value or credential payload. */
export function trustedGitHubCopilotBaseUrl(value: string | undefined, grant: unknown): string {
  const normalized = normalizeGitHubCopilotOAuthCredential(grant)
  return trustedCopilotBaseUrl(value, enterpriseDomainOf({ kind: 'grant', payload: normalized }))
}

function trustedCopilotBaseUrl(value: string | undefined, enterpriseDomain: string | undefined): string {
  if (value === undefined) {
    throw new Error('github-copilot: pi-ai resolved no Copilot API base URL')
  }
  const url = new URL(value)
  const hostname = url.hostname.toLowerCase()
  const githubHosted = /^api(?:\.[a-z0-9-]+)+\.githubcopilot\.com$/u.test(hostname)
  const enterpriseHosted = enterpriseDomain !== undefined
    && hostname === `copilot-api.${enterpriseDomain}`
  const trusted = url.protocol === 'https:' && (githubHosted || enterpriseHosted)
  if (!trusted || url.username.length > 0 || url.password.length > 0) {
    throw new Error('github-copilot: pi-ai resolved an untrusted Copilot API base URL')
  }
  return url.origin
}
