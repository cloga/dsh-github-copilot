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
  type OAuthAuth,
} from '@earendil-works/pi-ai'
import { githubCopilotProvider } from '@earendil-works/pi-ai/providers/github-copilot'
import { GITHUB_COPILOT_CREDENTIAL_KEY, GITHUB_COPILOT_PROVIDER_ID, GITHUB_COPILOT_PREVIEW_PROVIDER_ID } from './copilot-identity.ts'
import { normalizeGitHubCopilotOAuthCredential } from './copilot-grant.ts'
import type { GitHubCopilotOAuthCredential } from './copilot-grant.ts'
import { readCopilotCatalog } from './model-protocol.ts'
import type { CopilotAccountBinding } from './copilot-accounts-types.ts'
import type {} from './copilot-accounts-host.ts'
import { readSettingsNamespace } from './settings-reader.ts'
import type { CredentialChangeReason } from './request-diagnostics.ts'

export { normalizeGitHubCopilotOAuthCredential } from './copilot-grant.ts'

const nativeRefreshResults = new WeakSet<object>()
const nativeRefreshRejections = new WeakMap<object, CredentialChangeReason>()
interface RefreshWrite {
  notifications: number
  qualification: CredentialChangeReason
  reason: CredentialChangeReason
  settle(valid: boolean): void
  readonly committed: Promise<boolean>
}
const refreshWrites = new WeakMap<object, Map<string, RefreshWrite>>()

/** Only a validated native OAuth refresh may certify its exact returned object. */
export async function certifyCopilotNativeRefresh(
  previous: GitHubCopilotOAuthCredential,
  result: GitHubCopilotOAuthCredential,
  derive: OAuthAuth['toAuth'],
  signal?: AbortSignal,
): Promise<void> {
  const ids = (grant: GitHubCopilotOAuthCredential) => grant.availableModelIds === undefined
    ? undefined : JSON.stringify([...grant.availableModelIds].sort())
  const reject = (reason: CredentialChangeReason) => { nativeRefreshRejections.set(result, reason) }
  if (previous.refresh !== result.refresh) return reject('account-changed')
  if (previous.enterpriseUrl !== result.enterpriseUrl) return reject('endpoint-changed')
  if (ids(previous) !== ids(result)) return reject('entitlements-changed')
  if (result.expires <= Date.now()) return reject('expired')
  const before = await derive(previous)
  const after = await derive(result)
  signal?.throwIfAborted()
  if (before.apiKey === previous.access && after.apiKey === result.access
    && trustedGitHubCopilotBaseUrl(before.baseUrl, previous) === trustedGitHubCopilotBaseUrl(after.baseUrl, result)) {
    nativeRefreshResults.add(result)
  } else reject(before.apiKey !== previous.access || after.apiKey !== result.access ? 'auth-mismatch' : 'endpoint-changed')
}

/** Consume exactly one notification from the serialized, certified write. */
export function observeCopilotNativeRefresh(ctx: Context, key: string,
  diagnostic?: (phase: 'notification' | 'commit', reason: CredentialChangeReason) => void): Promise<boolean> | undefined {
  const service = ctx.get('credentials')
  const write = service === undefined ? undefined : refreshWrites.get(service)?.get(key)
  if (!write) { diagnostic?.('notification', 'unknown-source'); return undefined }
  if (++write.notifications !== 1) {
    write.reason = 'duplicate-notification'
    write.settle(false)
    diagnostic?.('notification', write.reason)
    return undefined
  }
  diagnostic?.('notification', write.qualification)
  if (write.qualification !== 'qualified') return undefined
  if (diagnostic) void write.committed.then(() => diagnostic('commit', write.reason))
  return write.committed
}

export function captureActiveGitHubCopilotBinding(ctx: Context): CopilotAccountBinding | undefined {
  const accounts = ctx.get('githubCopilotAccounts')
  if (accounts) return accounts.host.capture()
  const settings = readSettingsNamespace(ctx, 'github-copilot')
  if (typeof settings === 'object' && settings !== null
    && 'activeAccountId' in settings && settings.activeAccountId !== undefined && settings.activeAccountId !== 'canonical') {
    throw new Error('COPILOT_ACCOUNTS_SETTINGS_UNAVAILABLE')
  }
  return undefined
}

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
  binding?: CopilotAccountBinding,
): CredentialStore {
  const key = binding?.key ?? GITHUB_COPILOT_CREDENTIAL_KEY
  const assertProvider = (providerId: string): void => {
    if (providerId !== logicalProviderId) throw new Error('COPILOT_CREDENTIAL_PROVIDER_MISMATCH')
  }
  return {
    read: async (providerId) => {
      assertProvider(providerId)
      binding?.assertCurrent()
      const value = toCredential(await credentialService(ctx).readRecord(key))
      binding?.assertCurrent()
      return value
    },
    list: async (): Promise<readonly CredentialInfo[]> => {
      binding?.assertCurrent()
      const record = (await credentialService(ctx).listRecords()).find(record => record.key === key)
      binding?.assertCurrent()
      return record === undefined
        ? []
        : [{ providerId: logicalProviderId, type: record.kind === 'api-key' ? 'api_key' : 'oauth' }]
    },
    modify: async (providerId, mutate) => {
      assertProvider(providerId)
      binding?.assertCurrent()
      const service = credentialService(ctx)
      let pending: RefreshWrite | undefined
      let expected: CredentialRecord | undefined
      let writes = refreshWrites.get(service)
      if (!writes) { writes = new Map(); refreshWrites.set(service, writes) }
      try {
        const stored = await service.modifyRecord(
          key,
          async current => {
            binding?.assertCurrent()
            const next = await mutate(toCredential(current))
            binding?.assertCurrent()
            const record = next === undefined ? undefined : toRecord(next)
            const qualified = next !== undefined && nativeRefreshResults.delete(next)
            const rejected = next === undefined ? undefined : nativeRefreshRejections.get(next)
            if (next !== undefined) nativeRefreshRejections.delete(next)
            if (qualified || rejected !== undefined && !writes.has(key)) {
              expected = record
              let settle!: (valid: boolean) => void
              const committed = new Promise<boolean>(resolve => { settle = resolve })
              pending = { notifications: 0, settle, committed,
                qualification: qualified ? 'qualified' : rejected!, reason: 'write-failed' }
              if (writes.has(key)) {
                const previous = writes.get(key)!
                previous.reason = 'write-conflict'
                previous.settle(false)
                pending.reason = 'write-conflict'
                pending.settle(false)
              } else writes.set(key, pending)
            }
            return record
          },
        )
        binding?.assertCurrent()
        const committed = pending?.qualification === 'qualified' && pending.notifications === 1 && stored?.kind === 'grant'
          && expected?.kind === 'grant'
          && JSON.stringify(normalizeGitHubCopilotOAuthCredential(stored.payload))
            === JSON.stringify(normalizeGitHubCopilotOAuthCredential(expected.payload))
        if (pending && pending.reason === 'write-failed') pending.reason = committed ? 'qualified'
          : pending.notifications === 0 ? 'missing-notification' : 'commit-mismatch'
        pending?.settle(committed)
        return toCredential(stored)
      } finally {
        pending?.settle(false)
        if (writes.get(key) === pending) writes.delete(key)
      }
    },
    delete: async (providerId) => {
      assertProvider(providerId)
      binding?.assertCurrent()
      await credentialService(ctx).deleteRecord(key)
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
  const oauth = provider.auth.oauth
  models.setProvider({ ...provider, auth: { oauth: { ...oauth,
    async refresh(credential, signal) {
      const previous = normalizeGitHubCopilotOAuthCredential(credential)
      const result = normalizeGitHubCopilotOAuthCredential(await oauth.refresh(credential, signal))
      await certifyCopilotNativeRefresh(previous, result, oauth.toAuth, signal)
      return result
    },
  } } })
  return async (modelId) => {
    const binding = captureActiveGitHubCopilotBinding(ctx)
    if (binding !== undefined && binding.accountId !== 'canonical') {
      throw new Error('COPILOT_ACCOUNTS_ROUTE_BLOCKED')
    }
    const snapshot = readCopilotCatalog(ctx)
    const installedModels = new Map(snapshot.models.map(model => [model.id, model]))
    const native = installedModels.get(modelId)
    if (native === undefined) {
      throw new Error(`github-copilot: pi-ai catalog has no GitHub Copilot model "${modelId}"`)
    }
    // Resolve OAuth only. A local model would inject headers from another pi copy.
    const resolved = await models.getAuth('github-copilot')
    binding?.assertCurrent()
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
    binding?.assertCurrent()
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
