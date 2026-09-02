import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import {
  GITHUB_COPILOT_CREDENTIAL_KEY,
  GitHubCopilotAuthorizationController,
} from '../src/authorization-controller.ts'

interface Runtime {
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
} = {}): Runtime {
  let configured = options.configured ?? false
  let resolveAuthorization: (() => void) | undefined
  const settingsDocument: Record<string, unknown> = {
    'llm-pi-ai': { providers: { openai: { apiKeyEnv: 'OPENAI_API_KEY' } } },
  }
  const mutate = vi.fn(async (_ns: string, operations: Array<{ path: string[]; value: unknown }>) => {
    const providers = (settingsDocument['llm-pi-ai'] as { providers: Record<string, unknown> }).providers
    providers[operations[0]?.path[1] ?? ''] = operations[0]?.value
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
              availableModelIds: options.availableModelIds,
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
      expect((await harness.controller.status()).phase).toBe('signed-in')
    })
    expect(harness.mutate).toHaveBeenCalledWith('llm-pi-ai', [{
      op: 'set',
      path: ['providers', 'github-copilot'],
      value: {},
    }])
    expect(harness.settingsDocument['llm-pi-ai']).toEqual({
      providers: {
        openai: { apiKeyEnv: 'OPENAI_API_KEY' },
        'github-copilot': {},
      },
    })
  })

  it('does not replace an existing Copilot profile or unrelated provider settings', async () => {
    const harness = runtime({ configured: true })
    const section = harness.settingsDocument['llm-pi-ai'] as { providers: Record<string, unknown> }
    section.providers['github-copilot'] = { models: [{ id: 'gpt-5' }] }

    await expect(harness.controller.start()).resolves.toMatchObject({ phase: 'signed-in' })
    expect(harness.mutate).not.toHaveBeenCalled()
    expect(section.providers.openai).toEqual({ apiKeyEnv: 'OPENAI_API_KEY' })
    expect(section.providers['github-copilot']).toEqual({ models: [{ id: 'gpt-5' }] })
  })

  it('materializes the exact mixed-protocol account route without route-level connection fields', async () => {
    const harness = runtime({
      configured: true,
      availableModelIds: ['gemini-3.6-flash', 'gpt-5.6-sol'],
    })

    await expect(harness.controller.start()).resolves.toMatchObject({ phase: 'signed-in' })
    expect(harness.mutate).toHaveBeenCalledWith('llm-pi-ai', [{
      op: 'set',
      path: ['providers', 'github-copilot'],
      value: {
        models: [
          { id: 'gemini-3.6-flash', api: 'openai-completions' },
          { id: 'gpt-5.6-sol', api: 'openai-responses' },
        ],
      },
    }])
    expect(harness.settingsDocument['llm-pi-ai']).toEqual({
      providers: {
        openai: { apiKeyEnv: 'OPENAI_API_KEY' },
        'github-copilot': {
          models: [
            { id: 'gemini-3.6-flash', api: 'openai-completions' },
            { id: 'gpt-5.6-sol', api: 'openai-responses' },
          ],
        },
      },
    })
  })

  it('deduplicates account model ids while preserving their first-seen order', async () => {
    const harness = runtime({
      configured: true,
      availableModelIds: ['gpt-5.6-sol', 'gpt-5.6-sol', 'gemini-3.6-flash', 'gpt-5.6-sol'],
    })

    await expect(harness.controller.start()).resolves.toMatchObject({ phase: 'signed-in' })
    expect(harness.mutate).toHaveBeenCalledWith('llm-pi-ai', [{
      op: 'set',
      path: ['providers', 'github-copilot'],
      value: {
        models: [
          { id: 'gpt-5.6-sol', api: 'openai-responses' },
          { id: 'gemini-3.6-flash', api: 'openai-completions' },
        ],
      },
    }])
  })

  it('omits account model ids unsupported by the installed catalog', async () => {
    const harness = runtime({
      configured: true,
      availableModelIds: ['not-in-installed-catalog', 'gpt-5.6-sol'],
    })

    await expect(harness.controller.start()).resolves.toMatchObject({ phase: 'signed-in' })
    expect(harness.mutate).toHaveBeenCalledWith('llm-pi-ai', [{
      op: 'set',
      path: ['providers', 'github-copilot'],
      value: { models: [{ id: 'gpt-5.6-sol', api: 'openai-responses' }] },
    }])
  })

  it('fails loudly instead of enabling the full catalog when no installed model is available', async () => {
    const harness = runtime({
      configured: true,
      availableModelIds: ['not-in-installed-catalog'],
    })

    await expect(harness.controller.start()).rejects.toThrow(/exposes no models from the installed pi-ai catalog/)
    expect(harness.mutate).not.toHaveBeenCalled()
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
