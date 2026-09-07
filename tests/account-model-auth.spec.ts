import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Credential, CredentialStore } from '@earendil-works/pi-ai'
import { createAccountModelAuth, copilotAccountKey } from '../src/account-model-auth.ts'
import { normalizeGitHubCopilotOAuthCredential } from '../src/copilot-grant.ts'

function grant(extra: Record<string, unknown> = {}): Credential {
  return normalizeGitHubCopilotOAuthCredential({ type: 'oauth', refresh: 'synthetic-account-a', access: 'synthetic-access',
    expires: Date.now() + 3_600_000, availableModelIds: ['future-lab-r17'], ...extra })
}
function store(initial: Credential | undefined = grant()) {
  let value: Credential | undefined = initial
  let queue = Promise.resolve()
  const credentials: CredentialStore = {
    read: vi.fn(async id => { expect(id).toBe('github-copilot'); return value }),
    list: async () => [],
    modify: vi.fn((id, mutate) => {
      expect(id).toBe('github-copilot')
      const result = queue.then(async () => { const next = await mutate(value); if (next !== undefined) value = next; return value })
      queue = result.then(() => undefined, () => undefined)
      return result
    }),
    delete: vi.fn(async () => { value = undefined }),
  }
  return { credentials, replace(next: Credential | undefined) { value = next }, current: () => value }
}
const signal = () => new AbortController().signal

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('account discovery native OAuth binding', () => {
  it('resolves provider OAuth without a model catalog entry or environment fallback', async () => {
    const memory = store()
    const fetch = vi.fn(() => { throw new Error('no network for valid synthetic grant') })
    vi.stubGlobal('fetch', fetch)
    const access = createAccountModelAuth(memory.credentials)
    const auth = await access.resolveAuth(signal())
    expect(auth).toMatchObject({ apiKey: 'synthetic-access', baseURL: 'https://api.individual.githubcopilot.com', availableModelIds: ['future-lab-r17'] })
    expect(auth.accountKey).not.toContain('synthetic')
    expect(Object.isFrozen(auth)).toBe(true)
    await access.assertAuthCurrent(auth, signal())
    expect(fetch).not.toHaveBeenCalled()
    expect(memory.credentials.delete).not.toHaveBeenCalled()
  })
  it.each([undefined, { type: 'api_key', key: 'do-not-use' } satisfies Credential])('rejects non-OAuth configuration without probing ambient credentials: %j', async initial => {
    const memory = store(); memory.replace(initial)
    vi.stubEnv('COPILOT_GITHUB_TOKEN', 'ambient-do-not-use')
    const fetch = vi.fn(() => { throw new Error('must not request') }); vi.stubGlobal('fetch', fetch)
    await expect(createAccountModelAuth(memory.credentials).resolveAuth(signal())).rejects.toThrow('COPILOT_ACCOUNT_AUTH_FAILED')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('refreshes through native Models and persists only the canonical credential', async () => {
    const memory = store(grant({ expires: 0 }))
    const urls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
      const url = String(input); urls.push(url)
      if (url.endsWith('/copilot_internal/v2/token')) return new Response(JSON.stringify({ token: 'tid=synthetic;proxy-ep=proxy.individual.githubcopilot.com;', expires_at: Math.floor(Date.now() / 1000) + 3600 }))
      if (url.endsWith('/models')) return new Response(JSON.stringify({ data: [{ id: 'fresh-unlisted-model', model_picker_enabled: true, policy: { state: 'enabled' }, capabilities: { supports: { tool_calls: true } } }] }))
      throw new Error('unexpected endpoint')
    }))
    const auth = await createAccountModelAuth(memory.credentials).resolveAuth(signal())
    expect(auth.availableModelIds).toEqual(['fresh-unlisted-model'])
    expect(auth.apiKey).toBe('tid=synthetic;proxy-ep=proxy.individual.githubcopilot.com;')
    expect(memory.credentials.modify).toHaveBeenCalled()
    expect(urls).toHaveLength(2)
  })
  it('rejects account replacement during refresh without overwriting the replacement', async () => {
    const memory = store(grant({ expires: 0 }))
    // Emulate the Host serialized mutator observing the newer account before OAuth executes.
    memory.credentials.modify = vi.fn(async (_id, mutate) => {
      memory.replace(grant({ refresh: 'synthetic-account-b', access: 'other-account-access' }))
      return mutate(memory.current())
    })
    const fetch = vi.fn(() => { throw new Error('new account must not be refreshed by old request') }); vi.stubGlobal('fetch', fetch)
    await expect(createAccountModelAuth(memory.credentials).resolveAuth(signal())).rejects.toThrow('COPILOT_ACCOUNT_AUTH_FAILED')
    expect(memory.current()).toMatchObject({ refresh: 'synthetic-account-b' })
    expect(fetch).not.toHaveBeenCalled()
  })
  it.each([
    { refresh: 'synthetic-account-b' }, { access: 'rotated-access' }, { expires: 0 },
    { enterpriseUrl: 'enterprise.example' }, { availableModelIds: [] },
  ])('rejects stale authorization after credential changes %j', async changed => {
    const memory = store(); const access = createAccountModelAuth(memory.credentials)
    const auth = await access.resolveAuth(signal())
    memory.replace(grant(changed))
    await expect(access.assertAuthCurrent(auth, signal())).rejects.toThrow('COPILOT_ACCOUNT_AUTH_CHANGED')
  })
  it('rejects sign-out and caller cancellation before credential work', async () => {
    const memory = store(); const access = createAccountModelAuth(memory.credentials)
    const auth = await access.resolveAuth(signal()); memory.replace(undefined)
    await expect(access.assertAuthCurrent(auth, signal())).rejects.toThrow('COPILOT_ACCOUNT_AUTH_CHANGED')
    const controller = new AbortController(); controller.abort('private-reason')
    await expect(access.resolveAuth(controller.signal)).rejects.toThrow('COPILOT_ACCOUNT_AUTH_ABORTED')
  })
  it('validates credential-specific Enterprise endpoints and rejects token-controlled foreign origins', async () => {
    const enterprise = store(grant({ enterpriseUrl: 'example.enterprise' }))
    const auth = await createAccountModelAuth(enterprise.credentials).resolveAuth(signal())
    expect(auth.baseURL).toBe('https://copilot-api.example.enterprise')
    const unsafe = store(grant({ access: 'tid=synthetic;proxy-ep=evil.example;' }))
    await expect(createAccountModelAuth(unsafe.credentials).resolveAuth(signal())).rejects.toThrow('COPILOT_ACCOUNT_AUTH_FAILED')
  })
  it('sanitizes credential backend failures and keeps account identity independent of token rotation', async () => {
    const memory = store(); memory.credentials.read = async () => { throw new Error('private-backend-path-and-secret') }
    await expect(createAccountModelAuth(memory.credentials).resolveAuth(signal())).rejects.toThrow(/^COPILOT_ACCOUNT_AUTH_FAILED$/)
    const a = normalizeGitHubCopilotOAuthCredential(grant())
    const b = normalizeGitHubCopilotOAuthCredential(grant({ access: 'new-access', expires: Date.now() + 7_200_000 }))
    expect(copilotAccountKey(a)).toBe(copilotAccountKey(b))
  })
})
