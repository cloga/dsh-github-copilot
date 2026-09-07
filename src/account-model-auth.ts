import { createHash } from 'node:crypto'
import { createModels } from '@earendil-works/pi-ai'
import type { CredentialStore, OAuthAuth } from '@earendil-works/pi-ai'
import { githubCopilotProvider } from '@earendil-works/pi-ai/providers/github-copilot'
import { normalizeGitHubCopilotOAuthCredential } from './copilot-grant.ts'
import type { GitHubCopilotOAuthCredential } from './copilot-grant.ts'
import { trustedGitHubCopilotBaseUrl } from './copilot-auth.ts'
import { GITHUB_COPILOT_PROVIDER_ID } from './copilot-identity.ts'
import type { AccountModelAuth, AccountModelSourceDependencies } from './account-model-source.ts'

/** An opaque, process-local account key. Never a substitute for request credentials. */
export function copilotAccountKey(grant: GitHubCopilotOAuthCredential): string {
  return createHash('sha256').update(`${grant.refresh.length}:`).update(grant.refresh)
    .update(grant.enterpriseUrl ?? '').digest('hex')
}

/** Compare normalized permission snapshots without retaining model credentials. */
export function copilotEntitlementKey(grant: Pick<GitHubCopilotOAuthCredential, 'availableModelIds'>): string {
  const ids = grant.availableModelIds
  const normalized = ids === undefined ? 'missing' : JSON.stringify([...new Set(ids)].sort())
  return createHash('sha256').update(normalized).digest('hex')
}

function authEntitlementKey(auth: AccountModelAuth): string {
  return copilotEntitlementKey({ ...auth.availableModelIds === undefined ? {} : { availableModelIds: [...auth.availableModelIds] } })
}

function active(signal: AbortSignal): void {
  if (signal.aborted) throw new Error('COPILOT_ACCOUNT_AUTH_ABORTED')
}

/**
 * Bind model discovery to the existing native OAuth lifecycle. No model catalog,
 * login, environment fallback or separate credential record is introduced here.
 */
export function createAccountModelAuth(
  credentials: CredentialStore,
): Pick<AccountModelSourceDependencies, 'resolveAuth' | 'assertAuthCurrent'> {
  const native = githubCopilotProvider()
  const oauth = native.auth.oauth
  if (oauth === undefined) throw new Error('COPILOT_ACCOUNT_OAUTH_UNAVAILABLE')

  const readGrant = async (signal: AbortSignal): Promise<GitHubCopilotOAuthCredential> => {
    active(signal)
    const stored = await credentials.read(GITHUB_COPILOT_PROVIDER_ID)
    active(signal)
    if (stored?.type !== 'oauth') throw new Error('COPILOT_ACCOUNT_OAUTH_REQUIRED')
    return normalizeGitHubCopilotOAuthCredential(stored)
  }
  const matches = (grant: GitHubCopilotOAuthCredential, key: string): void => {
    if (copilotAccountKey(grant) !== key) throw new Error('COPILOT_ACCOUNT_CHANGED')
  }
  const current = async (auth: AccountModelAuth, signal: AbortSignal): Promise<void> => {
    active(signal)
    const grant = await readGrant(signal)
    matches(grant, auth.accountKey)
    if (grant.access !== auth.apiKey || grant.expires <= Date.now()) throw new Error('COPILOT_ACCOUNT_TOKEN_CHANGED')
    if (copilotEntitlementKey(grant) !== authEntitlementKey(auth)) throw new Error('COPILOT_ACCOUNT_ENTITLEMENT_CHANGED')
    // The native descriptor derives the endpoint locally; this does not refresh.
    const derived = await oauth.toAuth(grant)
    active(signal)
    if (derived.apiKey !== auth.apiKey
      || trustedGitHubCopilotBaseUrl(derived.baseUrl, grant) !== auth.baseURL) {
      throw new Error('COPILOT_ACCOUNT_AUTH_CHANGED')
    }
    // Re-read after an asynchronous descriptor callback before releasing auth.
    const latest = await readGrant(signal)
    matches(latest, auth.accountKey)
    if (latest.access !== auth.apiKey || latest.expires <= Date.now()) throw new Error('COPILOT_ACCOUNT_TOKEN_CHANGED')
    if (copilotEntitlementKey(latest) !== authEntitlementKey(auth)) throw new Error('COPILOT_ACCOUNT_ENTITLEMENT_CHANGED')
  }

  return {
    async resolveAuth(signal) {
      try {
        const before = await readGrant(signal)
        const key = copilotAccountKey(before)
        const guardedOAuth: OAuthAuth = {
          ...oauth,
          login: async () => { throw new Error('COPILOT_ACCOUNT_USE_CANONICAL_SIGN_IN') },
          async refresh(credential, requestSignal) {
            active(signal)
            matches(normalizeGitHubCopilotOAuthCredential(credential), key)
            const result = normalizeGitHubCopilotOAuthCredential(await oauth.refresh(
              credential, requestSignal === undefined ? signal : AbortSignal.any([signal, requestSignal]),
            ))
            active(signal)
            matches(result, key)
            return result
          },
          async toAuth(credential) {
            active(signal)
            const grant = normalizeGitHubCopilotOAuthCredential(credential)
            matches(grant, key)
            const result = await oauth.toAuth(grant)
            active(signal)
            return { ...result, baseUrl: trustedGitHubCopilotBaseUrl(result.baseUrl, grant) }
          },
        }
        const scopedStore: CredentialStore = {
          read: async provider => {
            const value = await credentials.read(provider)
            active(signal)
            if (value?.type !== 'oauth') throw new Error('COPILOT_ACCOUNT_OAUTH_REQUIRED')
            matches(normalizeGitHubCopilotOAuthCredential(value), key)
            return value
          },
          list: () => credentials.list(),
          modify: (provider, mutate) => credentials.modify(provider, async value => {
            active(signal)
            if (value?.type !== 'oauth') throw new Error('COPILOT_ACCOUNT_OAUTH_REQUIRED')
            matches(normalizeGitHubCopilotOAuthCredential(value), key)
            const next = await mutate(value)
            active(signal)
            if (next !== undefined) matches(normalizeGitHubCopilotOAuthCredential(next), key)
            return next
          }),
          delete: async () => { throw new Error('COPILOT_ACCOUNT_DISCOVERY_CANNOT_SIGN_OUT') },
        }
        const models = createModels({ credentials: scopedStore })
        models.setProvider({ ...native, auth: { oauth: guardedOAuth } })
        const resolved = await models.getAuth(GITHUB_COPILOT_PROVIDER_ID, { signal })
        active(signal)
        if (resolved?.auth.apiKey === undefined) throw new Error('COPILOT_ACCOUNT_OAUTH_REQUIRED')
        const grant = await readGrant(signal)
        matches(grant, key)
        const auth: AccountModelAuth = {
          apiKey: resolved.auth.apiKey,
          baseURL: trustedGitHubCopilotBaseUrl(resolved.auth.baseUrl, grant),
          accountKey: key,
          ...grant.availableModelIds === undefined ? {} : { availableModelIds: Object.freeze([...grant.availableModelIds]) },
        }
        await current(auth, signal)
        return Object.freeze(auth)
      } catch {
        throw new Error(signal.aborted ? 'COPILOT_ACCOUNT_AUTH_ABORTED' : 'COPILOT_ACCOUNT_AUTH_FAILED')
      }
    },
    async assertAuthCurrent(auth, signal) {
      try { await current(auth, signal) }
      catch { throw new Error(signal.aborted ? 'COPILOT_ACCOUNT_AUTH_ABORTED' : 'COPILOT_ACCOUNT_AUTH_CHANGED') }
    },
  }
}
