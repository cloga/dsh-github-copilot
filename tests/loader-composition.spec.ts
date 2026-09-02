import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AuthorizationService from '@deepseek-ai/dsh-authorization'
import * as GitHubCopilotPlugin from '../src/index.ts'
import type { InlineConfig } from '../src/config.ts'

const config: InlineConfig = {
  enabled: true,
  providers: [],
  includeSources: true,
  stripServerTools: true,
  idleTimeoutMs: 300_000,
  probe: false,
  probeTimeoutMs: 30_000,
}

const disposers: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.allSettled(disposers.splice(0).reverse().map(dispose => dispose()))
})

function credentialService(configured = false) {
  return {
    resolve: async () => ({ value: 'unused' }),
    describeRecord: async () => ({ configured, writable: true }),
    readRecord: async () => configured
      ? {
          kind: 'grant',
          payload: {
            type: 'oauth',
            refresh: 'github-device-grant',
            access: 'copilot-api-token',
            expires: Date.now() + 86_400_000,
            availableModelIds: ['gemini-3.6-flash', 'gpt-5.6-sol'],
          },
        }
      : undefined,
    listRecords: async () => configured
      ? [{ key: 'llm-pi-ai/github-copilot', kind: 'grant' }]
      : [],
    modifyRecord: async (_key: string, mutate: (current: unknown) => unknown) => mutate(undefined),
    deleteRecord: async () => undefined,
  }
}

async function mountProfile(
  ctx: Context,
  providesAuthorization = false,
  configured = false,
): Promise<{
  readonly settingsDocument: {
    readonly 'github-copilot': Record<string, unknown>
    readonly 'llm-pi-ai': { readonly providers: Record<string, unknown> }
  }
  readonly mutate: ReturnType<typeof vi.fn>
}> {
  const settingsDocument = {
    'github-copilot': {},
    'llm-pi-ai': { providers: { 'github-copilot': {} } },
  }
  const mutate = vi.fn(async (_namespace: string, operations: Array<{ path: string[]; value: unknown }>) => {
    settingsDocument['llm-pi-ai'].providers[operations[0]?.path[1] ?? ''] = operations[0]?.value
  })
  const fiber = ctx.plugin({
    name: providesAuthorization ? 'alpha3-web-profile' : 'rc2-web-profile',
    apply(profileCtx) {
      profileCtx.provide('credentials', credentialService(configured))
      profileCtx.provide('llm', {})
      profileCtx.provide('systemPrompt', { section: () => () => undefined })
      profileCtx.provide('settings', {
        get: (namespace: unknown) => settingsDocument[String(namespace) as keyof typeof settingsDocument],
        mutate,
        installSection: (
          _owner: Context,
          _namespace: unknown,
          _schema: unknown,
          entry: InlineConfig,
          hooks: { setSource(source: () => InlineConfig): void; onChange(): void },
        ) => {
          hooks.setSource(() => entry)
          hooks.onChange()
        },
      })
      profileCtx.provide('web', {
        registerSearchProvider: () => () => undefined,
        registerFetchProvider: () => () => undefined,
      })
      profileCtx.provide('agentDefaultModel', {
        currentSelection: () => ({ provider: 'github-copilot', model: 'gpt-5.4' }),
      })
      if (providesAuthorization) profileCtx.plugin(AuthorizationService)
    },
  })
  disposers.push(fiber.dispose)
  await fiber
  if (providesAuthorization) {
    await vi.waitFor(() => {
      expect(ctx.get('authorization') !== undefined).toBe(true)
    })
  }
  return { settingsDocument, mutate }
}

async function mountIntegration(ctx: Context): Promise<void> {
  const fiber = ctx.plugin(GitHubCopilotPlugin, config)
  disposers.push(fiber.dispose)
  await fiber
  await vi.waitFor(() => {
    expect(ctx.get('githubCopilotAuthorization')).toBeDefined()
  })
}

describe('loader composition', () => {
  it('bootstraps authorization in the rc.2 web profile before activating the integration', async () => {
    const ctx = new Context()
    await mountProfile(ctx)

    expect(ctx.get('authorization')).toBeUndefined()
    await mountIntegration(ctx)

    expect(ctx.get('authorization') !== undefined).toBe(true)
    expect(ctx.registry.get(AuthorizationService)?.fibers).toHaveLength(1)
  })

  it('reuses the alpha.5 authorization service without duplicate registration', async () => {
    const ctx = new Context()
    await mountProfile(ctx, true)
    const authorizationFiberUid = ctx.registry.get(AuthorizationService)?.fibers[0]?.uid

    await mountIntegration(ctx)

    expect(ctx.registry.get(AuthorizationService)?.fibers).toHaveLength(1)
    expect(ctx.registry.get(AuthorizationService)?.fibers[0]?.uid).toBe(authorizationFiberUid)
  })

  it('repairs an existing valid Copilot grant during Host startup', async () => {
    const ctx = new Context()
    const harness = await mountProfile(ctx, true, true)

    await mountIntegration(ctx)

    await vi.waitFor(() => {
      expect(harness.settingsDocument['llm-pi-ai'].providers['github-copilot']).toEqual({
        compat: { supportsStrictMode: false },
        models: [
          { id: 'gemini-3.6-flash', api: 'openai-completions' },
          { id: 'gpt-5.6-sol', api: 'openai-responses' },
        ],
      })
    })
    expect(harness.mutate).toHaveBeenCalledTimes(1)
  })
})
