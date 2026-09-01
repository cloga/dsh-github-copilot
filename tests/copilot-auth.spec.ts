import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createGitHubCopilotTokenResolver } from '../src/copilot-auth.ts'
import { GITHUB_COPILOT_CREDENTIAL_KEY } from '../src/authorization-controller.ts'

interface GrantRecord {
  kind: 'grant'
  payload: Record<string, unknown>
}

function runtime(record: GrantRecord | undefined): {
  readonly resolve: (modelId: string) => Promise<string | undefined>
  readonly modifyRecord: ReturnType<typeof vi.fn>
  current(): GrantRecord | undefined
} {
  let current = record
  const modifyRecord = vi.fn(async (
    key: string,
    mutate: (value: GrantRecord | undefined) => Promise<GrantRecord | undefined>,
  ) => {
    expect(key).toBe(GITHUB_COPILOT_CREDENTIAL_KEY)
    current = await mutate(current)
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
    resolve: createGitHubCopilotTokenResolver(ctx),
    modifyRecord,
    current: () => current,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('GitHub Copilot credential adapter', () => {
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
