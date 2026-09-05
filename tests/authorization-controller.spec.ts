import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import {
  GITHUB_COPILOT_CREDENTIAL_KEY,
  GitHubCopilotAuthorizationController,
  ensureGitHubCopilotProviderProfile,
  inspectGitHubCopilotProviderProfile,
} from '../src/authorization-controller.ts'

interface Runtime {
  readonly ctx: Context
  readonly controller: GitHubCopilotAuthorizationController
  readonly settingsDocument: Record<string, unknown>
  readonly mutate: ReturnType<typeof vi.fn>
  readonly deleteRecord: ReturnType<typeof vi.fn>
  readonly begin: ReturnType<typeof vi.fn>
  authorize(): void
}

function runtime(options: {
  configured?: boolean
  withFlow?: boolean
  availableModelIds?: readonly string[]
  providerProfile?: unknown
  beginFailure?: Error
} = {}): Runtime {
  let configured = options.configured ?? false
  let resolveAuthorization: (() => void) | undefined
  const settingsDocument: Record<string, unknown> = {
    'llm-pi-ai': {
      providers: {
        openai: { apiKeyEnv: 'OPENAI_API_KEY' },
        ...options.providerProfile === undefined
          ? {}
          : { 'github-copilot': options.providerProfile },
      },
    },
  }
  const mutate = vi.fn(async (_ns: string, operations: Array<{ path: string[]; value: unknown }>) => {
    for (const operation of operations) {
      let target = settingsDocument['llm-pi-ai'] as Record<string, unknown>
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
  const deleteRecord = vi.fn(async () => { configured = false })
  const begin = vi.fn(async (request: {
    interaction: {
      notify(notice: object): void
      prompt(prompt: { kind: string; message: string }): Promise<string>
    }
  }) => {
    expect(await request.interaction.prompt({
      kind: 'text',
      message: 'GitHub Enterprise URL/domain (blank for github.com)',
    })).toBe('')
    request.interaction.notify({
      message: 'Enter this code on GitHub.',
      url: 'https://github.com/login/device',
      code: 'ABCD-EFGH',
    })
    if (options.beginFailure !== undefined) throw options.beginFailure
    await new Promise<void>((resolve) => { resolveAuthorization = resolve })
    configured = true
    resolveAuthorization = undefined
    return { status: 'authorized' as const }
  })
  const authorization = {
    describe: () => options.withFlow === false ? undefined : ({
      methods: [{ id: 'oauth', label: 'Sign in with GitHub' }],
      inFlight: resolveAuthorization !== undefined,
    }),
    begin,
    cancel: vi.fn(() => {
      resolveAuthorization?.()
    }),
  }
  const services = new Map<string, unknown>([
    ['authorization', authorization],
    ['credentials', {
      describeRecord: async () => ({ configured, writable: true }),
      readRecord: async () => configured
        ? {
            kind: 'grant',
            payload: {
              type: 'oauth',
              refresh: 'github-device-grant',
              access: 'copilot-api-token',
              expires: Date.now() + 86_400_000,
              availableModelIds: options.availableModelIds ?? ['gpt-5.4'],
            },
          }
        : undefined,
      deleteRecord,
    }],
    ['settings', {
      get: (namespace: string) => settingsDocument[namespace],
      mutate,
    }],
  ])
  const ctx = new Context()
  ctx.get = ((name: string) => services.get(name)) as typeof ctx.get
  ctx.logger.error = vi.fn()
  const controller = new GitHubCopilotAuthorizationController(ctx)
  return {
    ctx,
    controller,
    settingsDocument,
    mutate,
    deleteRecord,
    begin,
    authorize: () => {
      resolveAuthorization?.()
    },
  }
}

describe('GitHubCopilotAuthorizationController', () => {
  it('signs in through the built-in flow and adds only the reference-free Copilot profile', async () => {
    const harness = runtime()
    const started = await harness.controller.start()

    expect(started.phase).toBe('authorizing')
    expect(started.notices).toEqual([{
      message: 'Enter this code on GitHub.',
      url: 'https://github.com/login/device',
      code: 'ABCD-EFGH',
    }])

    harness.authorize()
    await vi.waitFor(async () => {
      expect(await harness.controller.status()).toMatchObject({
        phase: 'signed-in',
        notices: [],
      })
    })
    expect(harness.mutate).toHaveBeenCalledWith('llm-pi-ai', [{
      op: 'set',
      path: ['providers', 'github-copilot', 'models'],
      value: [{ id: 'gpt-5.4', api: 'openai-responses' }],
    }, {
      op: 'set',
      path: ['providers', 'github-copilot', 'compat', 'supportsStrictMode'],
      value: false,
    }])
    expect(harness.settingsDocument['llm-pi-ai']).toEqual({
      providers: {
        openai: { apiKeyEnv: 'OPENAI_API_KEY' },
        'github-copilot': {
          compat: { supportsStrictMode: false },
          models: [{ id: 'gpt-5.4', api: 'openai-responses' }],
        },
      },
    })
  })

  it('clears the one-time device code immediately when sign-in is cancelled', async () => {
    const harness = runtime()
    await expect(harness.controller.start()).resolves.toMatchObject({
      phase: 'authorizing',
      notices: [expect.objectContaining({ code: 'ABCD-EFGH' })],
    })

    await expect(harness.controller.cancel()).resolves.toMatchObject({ notices: [] })
  })

  it('clears the one-time device code when authorization fails', async () => {
    const harness = runtime({ beginFailure: new Error('network unavailable') })
    await harness.controller.start()

    await vi.waitFor(async () => {
      expect(await harness.controller.status()).toMatchObject({
        phase: 'error',
        notices: [],
        error: 'network unavailable',
      })
    })
  })

  it('repairs a pre-existing grant with an empty Copilot route', async () => {
    const harness = runtime({ configured: true, providerProfile: {} })

    await expect(harness.controller.start()).resolves.toMatchObject({ phase: 'signed-in' })
    expect(harness.mutate).toHaveBeenCalledWith('llm-pi-ai', [{
      op: 'set',
      path: ['providers', 'github-copilot', 'models'],
      value: [{ id: 'gpt-5.4', api: 'openai-responses' }],
    }, {
      op: 'set',
      path: ['providers', 'github-copilot', 'compat', 'supportsStrictMode'],
      value: false,
    }])
  })

  it('repairs only the model list while preserving the rest of the Copilot profile and unrelated providers', async () => {
    const harness = runtime({
      configured: true,
      providerProfile: {
        baseURL: 'https://example.invalid',
        apiKeyEnv: 'COPILOT_GITHUB_TOKEN',
        customField: 'preserved',
        compat: { supportsStrictMode: false, customCompat: 'preserved' },
        models: [{ id: 'gpt-5.4' }],
      },
    })
    const section = harness.settingsDocument['llm-pi-ai'] as { providers: Record<string, unknown> }

    await expect(harness.controller.start()).resolves.toMatchObject({ phase: 'signed-in' })
    expect(harness.mutate).toHaveBeenCalledWith('llm-pi-ai', [{
      op: 'set',
      path: ['providers', 'github-copilot', 'models'],
      value: [{ id: 'gpt-5.4', api: 'openai-responses' }],
    }])
    expect(section.providers.openai).toEqual({ apiKeyEnv: 'OPENAI_API_KEY' })
    expect(section.providers['github-copilot']).toEqual({
      baseURL: 'https://example.invalid',
      apiKeyEnv: 'COPILOT_GITHUB_TOKEN',
      customField: 'preserved',
      compat: { supportsStrictMode: false, customCompat: 'preserved' },
      models: [{ id: 'gpt-5.4', api: 'openai-responses' }],
    })
  })

  it('repairs a Copilot route that still enables strict tool schemas', async () => {
    const harness = runtime({
      configured: true,
      providerProfile: {
        customField: 'preserved',
        compat: { supportsStrictMode: true },
        models: [{ id: 'gpt-5.4', api: 'openai-responses' }],
      },
    })

    await expect(ensureGitHubCopilotProviderProfile(harness.ctx)).resolves.toBe(true)
    expect(harness.mutate).toHaveBeenCalledWith('llm-pi-ai', [{
      op: 'set',
      path: ['providers', 'github-copilot', 'compat', 'supportsStrictMode'],
      value: false,
    }])
    expect(harness.settingsDocument['llm-pi-ai']).toMatchObject({
      providers: {
        'github-copilot': {
          customField: 'preserved',
          compat: { supportsStrictMode: false },
        },
      },
    })
  })

  it('preserves route-level connection fields when the owned leaves already match', async () => {
    const harness = runtime({
      configured: true,
      providerProfile: {
        baseURL: 'https://example.invalid',
        apiKeyEnv: 'COPILOT_GITHUB_TOKEN',
        compat: { supportsStrictMode: false },
        models: [{ id: 'gpt-5.4', api: 'openai-responses' }],
      },
    })

    await expect(ensureGitHubCopilotProviderProfile(harness.ctx)).resolves.toBe(false)
    expect(harness.mutate).not.toHaveBeenCalled()
  })

  it('is idempotent when the existing resolved Copilot route matches the account catalog', async () => {
    const harness = runtime({
      configured: true,
      providerProfile: {
        customField: 'preserved',
        compat: {
          supportsStrictMode: false,
          chatTemplateKwargs: {},
          chatTemplateArgs: {},
        },
        models: [{
          id: 'gpt-5.4',
          api: 'openai-responses',
          input: ['text', 'image'],
          compat: { supportsStrictMode: false },
        }],
        modelOverrides: {},
        defaultContextWindow: 200_000,
        headers: {},
      },
    })

    await expect(ensureGitHubCopilotProviderProfile(harness.ctx)).resolves.toBe(false)
    await expect(harness.controller.start()).resolves.toMatchObject({ phase: 'signed-in' })
    expect(harness.mutate).not.toHaveBeenCalled()
    expect(harness.settingsDocument['llm-pi-ai']).toMatchObject({
      providers: {
        'github-copilot': {
          customField: 'preserved',
          compat: {
            supportsStrictMode: false,
            chatTemplateKwargs: {},
            chatTemplateArgs: {},
          },
          models: [{
            id: 'gpt-5.4',
            api: 'openai-responses',
            input: ['text', 'image'],
            compat: { supportsStrictMode: false },
          }],
          modelOverrides: {},
          defaultContextWindow: 200_000,
          headers: {},
        },
      },
    })
  })

  it('materializes the exact mixed-protocol account route without route-level connection fields', async () => {
    const harness = runtime({
      configured: true,
      availableModelIds: ['gemini-3.6-flash', 'gpt-5.6-sol'],
    })

    await expect(harness.controller.start()).resolves.toMatchObject({ phase: 'signed-in' })
    expect(harness.mutate).toHaveBeenCalledWith('llm-pi-ai', [{
      op: 'set',
      path: ['providers', 'github-copilot', 'models'],
      value: [
        { id: 'gemini-3.6-flash', api: 'openai-completions' },
        { id: 'gpt-5.6-sol', api: 'openai-responses' },
      ],
    }, {
      op: 'set',
      path: ['providers', 'github-copilot', 'compat', 'supportsStrictMode'],
      value: false,
    }])
    expect(harness.settingsDocument['llm-pi-ai']).toEqual({
      providers: {
        openai: { apiKeyEnv: 'OPENAI_API_KEY' },
        'github-copilot': {
          compat: { supportsStrictMode: false },
          models: [
            { id: 'gemini-3.6-flash', api: 'openai-completions' },
            { id: 'gpt-5.6-sol', api: 'openai-responses' },
          ],
        },
      },
    })
  })

  it('materializes Anthropic and OpenAI models under the route compatibility override', async () => {
    const harness = runtime({
      configured: true,
      availableModelIds: ['claude-sonnet-4.5', 'gpt-5.4'],
    })

    await expect(harness.controller.start()).resolves.toMatchObject({ phase: 'signed-in' })
    expect(harness.mutate).toHaveBeenCalledWith('llm-pi-ai', [{
      op: 'set',
      path: ['providers', 'github-copilot', 'models'],
      value: [
        { id: 'claude-sonnet-4.5', api: 'anthropic-messages' },
        { id: 'gpt-5.4', api: 'openai-responses' },
      ],
    }, {
      op: 'set',
      path: ['providers', 'github-copilot', 'compat', 'supportsStrictMode'],
      value: false,
    }])
  })

  it('deduplicates account model ids while preserving their first-seen order', async () => {
    const harness = runtime({
      configured: true,
      availableModelIds: ['gpt-5.6-sol', 'gpt-5.6-sol', 'gemini-3.6-flash', 'gpt-5.6-sol'],
    })

    await expect(harness.controller.start()).resolves.toMatchObject({ phase: 'signed-in' })
    expect(harness.mutate).toHaveBeenCalledWith('llm-pi-ai', [{
      op: 'set',
      path: ['providers', 'github-copilot', 'models'],
      value: [
        { id: 'gpt-5.6-sol', api: 'openai-responses' },
        { id: 'gemini-3.6-flash', api: 'openai-completions' },
      ],
    }, {
      op: 'set',
      path: ['providers', 'github-copilot', 'compat', 'supportsStrictMode'],
      value: false,
    }])
  })

  it('materializes the temporary GPT-6 Astra overlay only for an entitled account', async () => {
    const harness = runtime({
      configured: true,
      availableModelIds: ['gpt-6-astra', 'gpt-5.6-sol'],
      providerProfile: {
        headers: { 'X-Custom': 'preserved' },
      },
    })

    await expect(harness.controller.status()).resolves.toMatchObject({
      phase: 'signed-in',
      catalog: {
        state: 'current',
        accountModelCount: 2,
        supportedModelCount: 2,
        unknownModelIds: [],
      },
    })
    expect(harness.mutate).toHaveBeenCalledWith('llm-pi-ai', [{
      op: 'set',
      path: ['providers', 'github-copilot', 'models'],
      value: [
        {
          id: 'gpt-6-astra',
          name: 'GPT-6 Astra',
          api: 'openai-responses',
          contextWindow: 1_050_000,
          maxTokens: 128_000,
          input: ['text', 'image'],
          reasoningEfforts: {
            off: null,
            low: 'low',
            medium: 'medium',
            high: 'high',
            xhigh: 'xhigh',
            max: 'max',
          },
        },
        { id: 'gpt-5.6-sol', api: 'openai-responses' },
      ],
    }, {
      op: 'set',
      path: ['providers', 'github-copilot', 'compat', 'supportsStrictMode'],
      value: false,
    }, {
      op: 'set',
      path: ['providers', 'github-copilot', 'headers'],
      value: {
        'X-Custom': 'preserved',
        'User-Agent': 'GitHubCopilotChat/0.35.0',
        'Editor-Version': 'vscode/1.107.0',
        'Editor-Plugin-Version': 'copilot-chat/0.35.0',
        'Copilot-Integration-Id': 'vscode-chat',
      },
    }])
  })

  it('reports account model ids unsupported by the installed catalog', async () => {
    const harness = runtime({
      configured: true,
      availableModelIds: ['not-in-installed-catalog', 'gpt-5.6-sol'],
    })

    await expect(harness.controller.start()).resolves.toMatchObject({
      phase: 'signed-in',
      catalog: {
        state: 'partially-outdated',
        accountModelCount: 2,
        supportedModelCount: 1,
        unknownModelIds: ['not-in-installed-catalog'],
      },
    })
    expect(harness.mutate).toHaveBeenCalledWith('llm-pi-ai', [{
      op: 'set',
      path: ['providers', 'github-copilot', 'models'],
      value: [{ id: 'gpt-5.6-sol', api: 'openai-responses' }],
    }, {
      op: 'set',
      path: ['providers', 'github-copilot', 'compat', 'supportsStrictMode'],
      value: false,
    }])
  })

  it('reports an outdated catalog without replacing a previously usable model list', async () => {
    const harness = runtime({
      configured: true,
      availableModelIds: ['not-in-installed-catalog'],
      providerProfile: {
        compat: { supportsStrictMode: false },
        models: [{ id: 'gpt-5.4', api: 'openai-responses' }],
      },
    })

    await expect(inspectGitHubCopilotProviderProfile(harness.ctx)).resolves.toEqual({
      changed: false,
      catalog: {
        state: 'outdated',
        accountModelCount: 1,
        supportedModelCount: 0,
        unknownModelIds: ['not-in-installed-catalog'],
      },
    })
    await expect(harness.controller.status()).resolves.toMatchObject({
      phase: 'signed-in',
      catalog: { state: 'outdated' },
    })
    expect(harness.mutate).not.toHaveBeenCalled()
    expect(harness.settingsDocument['llm-pi-ai']).toMatchObject({
      providers: {
        'github-copilot': {
          models: [{ id: 'gpt-5.4', api: 'openai-responses' }],
        },
      },
    })
  })

  it('signs out by deleting only the llm-pi-ai Copilot record and keeps the route profile', async () => {
    const harness = runtime({ configured: true })
    const section = harness.settingsDocument['llm-pi-ai'] as { providers: Record<string, unknown> }
    section.providers['github-copilot'] = {}

    await expect(harness.controller.signOut()).resolves.toMatchObject({ phase: 'signed-out' })
    expect(harness.deleteRecord).toHaveBeenCalledWith(GITHUB_COPILOT_CREDENTIAL_KEY)
    expect(harness.mutate).not.toHaveBeenCalled()
    expect(section.providers['github-copilot']).toEqual({})
  })

  it('fails loudly when DSH did not register the expected authorization flow', async () => {
    const harness = runtime({ withFlow: false })
    await expect(harness.controller.start()).rejects.toThrow(
      /did not register the GitHub Copilot authorization flow/,
    )
  })
})
