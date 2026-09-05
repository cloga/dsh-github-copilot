import { Context } from '@deepseek-ai/cordis'
import type { Credential } from '@earendil-works/pi-ai'
import vm from 'node:vm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createGitHubCopilotCredentialStore,
  createGitHubCopilotTokenResolver,
} from '../src/copilot-auth.ts'
import { GITHUB_COPILOT_CREDENTIAL_KEY } from '../src/authorization-controller.ts'

interface GrantRecord {
  kind: 'grant'
  payload: Record<string, unknown>
}

function strictJsonRoundTrip<T>(value: T): T {
  const inspect = (candidate: unknown): void => {
    if (
      candidate === null
      || typeof candidate === 'string'
      || typeof candidate === 'boolean'
      || (typeof candidate === 'number' && Number.isFinite(candidate))
    ) return
    if (Array.isArray(candidate)) {
      for (const entry of candidate) inspect(entry)
      return
    }
    if (
      typeof candidate !== 'object'
      || Object.getPrototypeOf(candidate) !== Object.prototype
    ) {
      throw new Error('strict JSON credential store rejected a non-JSON value')
    }
    for (const entry of Object.values(candidate)) inspect(entry)
  }
  inspect(value)
  return JSON.parse(JSON.stringify(value)) as T
}

function runtime(record: GrantRecord | undefined, onCredentialChanged?: () => Promise<void>): {
  readonly resolve: ReturnType<typeof createGitHubCopilotTokenResolver>
  readonly store: ReturnType<typeof createGitHubCopilotCredentialStore>
  readonly modifyRecord: ReturnType<typeof vi.fn>
  current(): GrantRecord | undefined
} {
  let current = record
  const modifyRecord = vi.fn(async (
    key: string,
    mutate: (value: GrantRecord | undefined) => Promise<GrantRecord | undefined>,
  ) => {
    expect(key).toBe(GITHUB_COPILOT_CREDENTIAL_KEY)
    const next = await mutate(current)
    current = next === undefined ? undefined : strictJsonRoundTrip(next)
    return current
  })
  const credentials = {
    readRecord: vi.fn(async () => current),
    listRecords: vi.fn(async () => current === undefined ? [] : [{
      key: GITHUB_COPILOT_CREDENTIAL_KEY,
      kind: current.kind,
    }]),
    modifyRecord,
    deleteRecord: vi.fn(async () => { current = undefined }),
  }
  const ctx = new Context()
  ctx.get = ((name: string) => name === 'credentials' ? credentials : undefined) as typeof ctx.get
  return {
    resolve: createGitHubCopilotTokenResolver(ctx, onCredentialChanged),
    store: createGitHubCopilotCredentialStore(ctx),
    modifyRecord,
    current: () => current,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('GitHub Copilot credential adapter', () => {
  it('normalizes cross-module OAuth grants for a strict JSON credential store', async () => {
    const credential = vm.runInNewContext(`(() => {
      const value = Object.create(null)
      Object.assign(value, {
        type: 'oauth',
        refresh: 'github-device-grant',
        access: 'opaque-copilot-token',
        expires: 123456789,
        enterpriseUrl: undefined,
        availableModelIds: ['gpt-5.4', 'gpt-5-mini', 'gpt-5.4'],
        bigintExtension: 1n,
        functionExtension() {},
        symbolExtension: Symbol('extension'),
        classExtension: new (class Extension {})(),
      })
      Object.defineProperty(value, 'unreadExtension', {
        enumerable: true,
        get() {
          throw new Error('unrelated extension was read')
        },
      })
      return value
    })()`) as Credential
    const harness = runtime(undefined)

    await expect(harness.store.modify('github-copilot', async () => credential)).resolves.toEqual({
      type: 'oauth',
      refresh: 'github-device-grant',
      access: 'opaque-copilot-token',
      expires: 123456789,
      availableModelIds: ['gpt-5.4', 'gpt-5-mini'],
    })
    expect(harness.current()).toEqual({
      kind: 'grant',
      payload: {
        type: 'oauth',
        refresh: 'github-device-grant',
        access: 'opaque-copilot-token',
        expires: 123456789,
        availableModelIds: ['gpt-5.4', 'gpt-5-mini'],
      },
    })
    expect(Object.getPrototypeOf(harness.current()?.payload)).toBe(Object.prototype)
  })

  it('rejects malformed required OAuth fields without exposing their values', async () => {
    const cases = [
      {
        credential: { type: 'api-key', refresh: 'refresh', access: 'access', expires: 1 },
        field: 'type',
      },
      {
        credential: { type: 'oauth', refresh: '   ', access: 'access', expires: 1 },
        field: 'refresh',
      },
      {
        credential: { type: 'oauth', refresh: 'refresh', access: 123n, expires: 1 },
        field: 'access',
      },
      {
        credential: { type: 'oauth', refresh: 'refresh', access: 'access' },
        field: 'expires',
      },
    ] as const

    for (const { credential, field } of cases) {
      const harness = runtime(undefined)
      const secret = 'must-not-appear'
      const malformed = { ...credential, unsupportedSecret: secret } as unknown as Credential
      let failure: Error | undefined
      try {
        await harness.store.modify('github-copilot', async () => malformed)
      } catch (error) {
        failure = error as Error
      }
      expect(failure?.message).toContain(field)
      expect(failure?.message).not.toContain(secret)
      expect(harness.current()).toBeUndefined()
    }
  })

  it('rejects nonfinite OAuth expiry timestamps', async () => {
    for (const expires of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const harness = runtime(undefined)
      await expect(harness.store.modify('github-copilot', async () => ({
        type: 'oauth',
        refresh: 'refresh',
        access: 'access',
        expires,
      }))).rejects.toThrow(/expires.*finite number/)
    }
  })

  it('rejects invalid OAuth model id collections', async () => {
    for (const availableModelIds of [
      'gpt-5.4',
      ['gpt-5.4', ''],
      ['gpt-5.4', '   '],
      ['gpt-5.4', 42],
    ]) {
      const harness = runtime(undefined)
      await expect(harness.store.modify('github-copilot', async () => ({
        type: 'oauth',
        refresh: 'refresh',
        access: 'access',
        expires: 1,
        availableModelIds,
      } as Credential))).rejects.toThrow(/availableModelIds.*array of non-empty strings/)
    }
  })

  it('requires a non-empty enterprise URL when the OAuth field is present', async () => {
    const harness = runtime(undefined)
    await expect(harness.store.modify('github-copilot', async () => ({
      type: 'oauth',
      refresh: 'refresh',
      access: 'access',
      expires: 1,
      enterpriseUrl: '',
    }))).rejects.toThrow(/enterpriseUrl.*non-empty string/)
  })

  it('refreshes the llm-pi-ai grant in-place and returns the Copilot API token', async () => {
    const freshToken = 'tid=test;exp=9999999999;proxy-ep=proxy.individual.githubcopilot.com;'
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url === 'https://api.github.com/copilot_internal/v2/token') {
        return new Response(JSON.stringify({
          token: freshToken,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
        }), { status: 200 })
      }
      if (url === 'https://api.individual.githubcopilot.com/models') {
        return new Response(JSON.stringify({
          data: [{
            id: 'gpt-5.4',
            model_picker_enabled: true,
            policy: { state: 'enabled' },
            capabilities: { supports: { tool_calls: true } },
          }],
        }), { status: 200 })
      }
      throw new Error(`unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const harness = runtime({
      kind: 'grant',
      payload: {
        type: 'oauth',
        refresh: 'github-device-grant',
        access: 'expired-copilot-token',
        expires: 0,
      },
    })

    await expect(harness.resolve('gpt-5.4')).resolves.toMatchObject({
      apiKey: freshToken,
      baseURL: 'https://api.individual.githubcopilot.com',
    })
    expect(harness.modifyRecord).toHaveBeenCalledTimes(1)
    expect(harness.current()).toMatchObject({
      kind: 'grant',
      payload: {
        type: 'oauth',
        refresh: 'github-device-grant',
        access: freshToken,
        availableModelIds: ['gpt-5.4'],
      },
    })
  })

  it('rejects models excluded by the signed-in account model list', async () => {
    const harness = runtime({
      kind: 'grant',
      payload: {
        type: 'oauth',
        refresh: 'github-device-grant',
        access: 'current-copilot-token',
        expires: Date.now() + 86_400_000,
        availableModelIds: ['gpt-5-mini'],
      },
    })

    await expect(harness.resolve('gpt-5.4')).rejects.toThrow(/not available for the signed-in Copilot account/)
  })

  it('reconciles the provider profile after every successful auth resolution', async () => {
    const onCredentialChanged = vi.fn(async () => undefined)
    const freshToken = 'tid=test;exp=9999999999;proxy-ep=proxy.individual.githubcopilot.com;'
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url === 'https://api.github.com/copilot_internal/v2/token') {
        return new Response(JSON.stringify({
          token: freshToken,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
        }), { status: 200 })
      }
      if (url === 'https://api.individual.githubcopilot.com/models') {
        return new Response(JSON.stringify({
          data: [{
            id: 'gpt-5.4',
            model_picker_enabled: true,
            policy: { state: 'enabled' },
            capabilities: { supports: { tool_calls: true } },
          }],
        }), { status: 200 })
      }
      throw new Error(`unexpected request: ${url}`)
    }))
    const harness = runtime({
      kind: 'grant',
      payload: {
        type: 'oauth',
        refresh: 'github-device-grant',
        access: 'expired-copilot-token',
        expires: 0,
        availableModelIds: ['gpt-5-mini'],
      },
    }, onCredentialChanged)

    await expect(harness.resolve('gpt-5.4')).resolves.toMatchObject({ apiKey: freshToken })
    await expect(harness.resolve('gpt-5.4')).resolves.toMatchObject({ apiKey: freshToken })
    expect(onCredentialChanged).toHaveBeenCalledTimes(2)
  })

  it('keeps auth usable and retries reconciliation after a transient failure', async () => {
    const onCredentialChanged = vi.fn()
      .mockRejectedValueOnce(new Error('settings unavailable'))
      .mockResolvedValue(undefined)
    const harness = runtime({
      kind: 'grant',
      payload: {
        type: 'oauth',
        refresh: 'github-device-grant',
        access: 'tid=test;exp=9999999999;proxy-ep=proxy.individual.githubcopilot.com;',
        expires: Date.now() + 86_400_000,
        availableModelIds: ['gpt-5.4'],
      },
    }, onCredentialChanged)

    await expect(harness.resolve('gpt-5.4')).resolves.toMatchObject({
      baseURL: 'https://api.individual.githubcopilot.com',
    })
    await expect(harness.resolve('gpt-5.4')).resolves.toMatchObject({
      baseURL: 'https://api.individual.githubcopilot.com',
    })
    expect(onCredentialChanged).toHaveBeenCalledTimes(2)
  })

  it('rechecks model availability after refreshing the credential', async () => {
    const freshToken = 'tid=test;exp=9999999999;proxy-ep=proxy.business.githubcopilot.com;'
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url === 'https://api.github.com/copilot_internal/v2/token') {
        return new Response(JSON.stringify({
          token: freshToken,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
        }), { status: 200 })
      }
      if (url === 'https://api.business.githubcopilot.com/models') {
        return new Response(JSON.stringify({
          data: [{
            id: 'gpt-5-mini',
            model_picker_enabled: true,
            policy: { state: 'enabled' },
            capabilities: { supports: { tool_calls: true } },
          }],
        }), { status: 200 })
      }
      throw new Error(`unexpected request: ${url}`)
    }))
    const harness = runtime({
      kind: 'grant',
      payload: {
        type: 'oauth',
        refresh: 'github-device-grant',
        access: 'expired-copilot-token',
        expires: 0,
        availableModelIds: ['gpt-5.4'],
      },
    })

    await expect(harness.resolve('gpt-5.4')).rejects.toThrow(/not available for the signed-in Copilot account/)
    expect(harness.current()).toMatchObject({
      payload: {
        access: freshToken,
        availableModelIds: ['gpt-5-mini'],
      },
    })
  })

  it('resolves temporary GPT-6 Astra auth only when the account exposes it', async () => {
    const harness = runtime({
      kind: 'grant',
      payload: {
        type: 'oauth',
        refresh: 'github-device-grant',
        access: 'tid=test;exp=9999999999;proxy-ep=proxy.individual.githubcopilot.com;',
        expires: Date.now() + 86_400_000,
        availableModelIds: ['gpt-6-astra'],
      },
    })

    await expect(harness.resolve('gpt-6-astra')).resolves.toMatchObject({
      baseURL: 'https://api.individual.githubcopilot.com',
    })
  })

  it('rejects temporary GPT-6 Astra when the account does not expose it', async () => {
    const harness = runtime({
      kind: 'grant',
      payload: {
        type: 'oauth',
        refresh: 'github-device-grant',
        access: 'tid=test;exp=9999999999;proxy-ep=proxy.individual.githubcopilot.com;',
        expires: Date.now() + 86_400_000,
        availableModelIds: ['gpt-5.4'],
      },
    })

    await expect(harness.resolve('gpt-6-astra')).rejects.toThrow(
      /not available for the signed-in Copilot account/,
    )
  })

  it('accepts the credential-specific endpoint for a signed-in GitHub Enterprise domain', async () => {
    const harness = runtime({
      kind: 'grant',
      payload: {
        type: 'oauth',
        refresh: 'github-device-grant',
        access: 'opaque-enterprise-token',
        expires: Date.now() + 86_400_000,
        enterpriseUrl: 'company.ghe.com',
        availableModelIds: ['gpt-5.4'],
      },
    })

    await expect(harness.resolve('gpt-5.4')).resolves.toMatchObject({
      baseURL: 'https://copilot-api.company.ghe.com',
    })
  })

  it('rejects a credential-derived endpoint outside GitHub Copilot boundaries', async () => {
    const harness = runtime({
      kind: 'grant',
      payload: {
        type: 'oauth',
        refresh: 'github-device-grant',
        access: 'tid=test;proxy-ep=proxy.evilgithubcopilot.com;',
        expires: Date.now() + 86_400_000,
        availableModelIds: ['gpt-5.4'],
      },
    })

    await expect(harness.resolve('gpt-5.4')).rejects.toThrow(/untrusted Copilot API base URL/)
  })

  it('fails loudly when the DSH credential record API is unavailable', async () => {
    const ctx = new Context()
    ctx.get = (() => undefined) as typeof ctx.get
    const resolve = createGitHubCopilotTokenResolver(ctx)

    await expect(resolve('gpt-5.4')).rejects.toThrow(/credentials service is unavailable/)
  })
})
