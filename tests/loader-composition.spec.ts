import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AuthorizationService from '@deepseek-ai/dsh-authorization'
import LlmRuntime from '@deepseek-ai/dsh-llm'
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
  withWeb = true,
  nativeLlm = false,
): Promise<{
  readonly settingsDocument: {
    readonly 'github-copilot': Record<string, unknown>
    readonly 'llm-pi-ai': { readonly providers: Record<string, unknown> }
  }
  readonly mutate: ReturnType<typeof vi.fn>
}> {
  const settingsDocument = {
    'github-copilot': {},
    'llm-pi-ai': { providers: { 'github-copilot': { customField: 'preserved' } } },
  }
  const mutate = vi.fn(async (_namespace: string, operations: Array<{ path: string[]; value: unknown }>) => {
    for (const operation of operations) {
      let target = settingsDocument['llm-pi-ai'] as unknown as Record<string, unknown>
      for (const segment of operation.path.slice(0, -1)) {
        const value = target[segment]
        if (typeof value === 'object' && value !== null) {
          target = value as Record<string, unknown>
        }
        else {
          const next: Record<string, unknown> = {}
          target[segment] = next
          target = next
        }
      }
      const leaf = operation.path.at(-1)
      if (leaf !== undefined) target[leaf] = operation.value
    }
  })
  const fiber = ctx.plugin({
    name: providesAuthorization ? 'alpha3-web-profile' : 'rc2-web-profile',
    apply(profileCtx) {
      profileCtx.provide('credentials', credentialService(configured))
      if (nativeLlm) profileCtx.plugin(LlmRuntime)
      else profileCtx.provide('llm', {})
      profileCtx.provide('systemPrompt', { section: () => () => undefined })
      profileCtx.provide('settings', {
        get: (namespace: unknown) => settingsDocument[String(namespace) as keyof typeof settingsDocument],
        describe: () => Object.entries(settingsDocument).map(([ns, value]) => ({ ns, revision: 0, user: value, value })),
        mutate,
      })
      if (withWeb) {
        profileCtx.provide('web', {
          registerSearchProvider: () => () => undefined,
          registerFetchProvider: () => () => undefined,
        })
      }
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
  it('starts and disposes without an optional native reviewer package or package resolver', async () => {
    const ctx = new Context()
    await mountProfile(ctx)
    expect(ctx.get('pluginPackages')).toBeUndefined()
    const fiber = await ctx.plugin(GitHubCopilotPlugin, config)
    await vi.waitFor(() => expect(ctx.get('githubCopilotAuthorization')).toBeDefined())
    await fiber.dispose()
    expect(fiber.uid).toBeNull()
    expect(ctx.get('pluginPackages')).toBeUndefined()
  })
  it('bootstraps authorization in the rc.2 web profile before activating the integration', async () => {
    const ctx = new Context()
    await mountProfile(ctx)

    expect(ctx.get('authorization')).toBeUndefined()
    await mountIntegration(ctx)

    expect(ctx.get('authorization') !== undefined).toBe(true)
    expect(ctx.registry.get(AuthorizationService)?.fibers).toHaveLength(1)
  })

  it('reuses the rc.1 authorization service without duplicate registration', async () => {
    const ctx = new Context()
    await mountProfile(ctx, true)
    const authorizationFiberUid = Array.from(ctx.registry.get(AuthorizationService)?.fibers ?? [])[0]?.uid
    expect(authorizationFiberUid).toBeDefined()

    await mountIntegration(ctx)

    expect(ctx.registry.get(AuthorizationService)?.fibers).toHaveLength(1)
    expect(Array.from(ctx.registry.get(AuthorizationService)?.fibers ?? [])[0]?.uid).toBe(authorizationFiberUid)
  })

  it('keeps native web and the account and model owners independent as web attaches and leaves', async () => {
    const ctx = new Context()
    await mountProfile(ctx, true, false, false, true)
    const registerAdapter = vi.spyOn(ctx.llm, 'registerAdapter')
    await mountIntegration(ctx)
    await vi.waitFor(() => expect(ctx.get('githubCopilotPreview')).toBeDefined())
    expect(ctx.get('githubCopilotAccounts') !== undefined).toBe(true)
    expect(ctx.get('githubCopilotAuthorization') !== undefined).toBe(true)
    expect(ctx.get('githubCopilotSearchRouter')).toBeUndefined()
    expect(registerAdapter).toHaveBeenCalledOnce()

    const registerSearchProvider = vi.fn(() => () => undefined)
    const nativeWeb = { registerSearchProvider, registerFetchProvider: () => () => undefined }
    const web = ctx.plugin({ apply(scope) {
      scope.provide('web', nativeWeb)
    } })
    await web
    expect(typeof ctx.get('web')?.registerSearchProvider).toBe('function')
    expect(ctx.get('githubCopilotSearchRouter')).toBeUndefined()
    expect(registerSearchProvider).not.toHaveBeenCalled()
    expect(ctx.get('githubCopilotAccounts') !== undefined).toBe(true)
    expect(ctx.get('githubCopilotAuthorization') !== undefined).toBe(true)
    expect(ctx.get('githubCopilotPreview') !== undefined).toBe(true)
    expect(registerAdapter).toHaveBeenCalledOnce()

    await web.dispose()
    await vi.waitFor(() => expect(ctx.get('githubCopilotSearchRouter')).toBeUndefined())
    expect(ctx.get('githubCopilotAccounts') !== undefined).toBe(true)
    expect(ctx.get('githubCopilotAuthorization') !== undefined).toBe(true)
    expect(ctx.get('githubCopilotPreview') !== undefined).toBe(true)
    expect(registerAdapter).toHaveBeenCalledOnce()
  })

  it('does not rewrite an existing Copilot profile during Host startup', async () => {
    const ctx = new Context()
    const harness = await mountProfile(ctx, true, true)

    await mountIntegration(ctx)
    await new Promise<void>(resolve => setImmediate(resolve))

    expect(harness.settingsDocument['llm-pi-ai'].providers['github-copilot']).toEqual({ customField: 'preserved' })
    expect(harness.mutate).not.toHaveBeenCalledWith('llm-pi-ai', expect.anything(), expect.anything())
  })

  it('does not rewrite an existing provider profile when web is unavailable', async () => {
    const ctx = new Context()
    const harness = await mountProfile(ctx, true, true, false)
    await mountIntegration(ctx)
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(harness.settingsDocument['llm-pi-ai'].providers['github-copilot']).toEqual({ customField: 'preserved' })
    expect(harness.mutate).not.toHaveBeenCalledWith('llm-pi-ai', expect.anything(), expect.anything())
  })
})
