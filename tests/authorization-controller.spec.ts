import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  GITHUB_COPILOT_CREDENTIAL_KEY,
  GitHubCopilotAuthorizationController,
  ensureGitHubCopilotProviderProfile,
  inspectGitHubCopilotProviderProfile,
} from '../src/authorization-controller.ts'
import { encodeBackup, leavesOf, ROUTE_OWNERSHIP_EPOCH } from '../src/route-ownership.ts'

interface Runtime {
  readonly ctx: Context
  readonly controller: GitHubCopilotAuthorizationController
  readonly settingsDocument: Record<string, unknown>
  readonly mutate: ReturnType<typeof vi.fn>
  readonly deleteRecord: ReturnType<typeof vi.fn>
  readonly begin: ReturnType<typeof vi.fn>
  readonly readRecord: ReturnType<typeof vi.fn>
  readonly describeSettings: ReturnType<typeof vi.fn>
  authorize(): void
}

function runtime(options: {
  configured?: boolean
  withFlow?: boolean
  availableModelIds?: readonly string[]
  providerProfile?: unknown
  beginFailure?: Error
  beforeMutate?: (namespace: string, operations: readonly { op: 'set' | 'unset' }[]) => void
  readFailure?: boolean
} = {}): Runtime {
  let configured = options.configured ?? false
  let resolveAuthorization: (() => void) | undefined
  const settingsDocument: Record<string, unknown> = {
    'github-copilot': {},
    'llm-pi-ai': {
      providers: {
        openai: { apiKeyEnv: 'OPENAI_API_KEY' },
        ...options.providerProfile === undefined
          ? {}
          : { 'github-copilot': options.providerProfile },
      },
    },
  }
  const revisions = new Map<string, number>()
  const describeSettings = vi.fn(() => Object.entries(settingsDocument).map(([ns, value]) => ({
    ns, revision: revisions.get(ns) ?? 0, user: value, value,
  })))
  const mutate = vi.fn(async (ns: string, operations: Array<
    | { op: 'set'; path: string[]; value: unknown }
    | { op: 'unset'; path: string[] }
  >, expectedRevision?: number) => {
    options.beforeMutate?.(ns, operations)
    if (expectedRevision !== undefined && expectedRevision !== (revisions.get(ns) ?? 0)) {
      throw new Error('settings revision conflict')
    }
    for (const operation of operations) {
      let target = settingsDocument[ns] as Record<string, unknown>
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
      if (leaf !== undefined) {
        if (operation.op === 'unset') delete target[leaf]
        else target[leaf] = operation.value
      }
    }
    revisions.set(ns, (revisions.get(ns) ?? 0) + 1)
  })
  const readRecord = vi.fn(async () => {
    if (options.readFailure) throw new Error('SYNTHETIC_PRIVATE_ERROR')
    return configured ? {
      kind: 'grant',
      payload: {
        type: 'oauth', refresh: 'github-device-grant', access: 'copilot-api-token',
        expires: Date.now() + 86_400_000,
        availableModelIds: options.availableModelIds ?? ['gpt-5.4'],
      },
    } : undefined
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
      readRecord,
      deleteRecord,
    }],
    ['settings', {
      get: (namespace: string) => settingsDocument[namespace],
      describe: describeSettings,
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
    readRecord,
    describeSettings,
    authorize: () => {
      resolveAuthorization?.()
    },
  }
}

function activeTemporaryGpt6Profile(): Record<string, unknown> {
  return {
    api: 'openai-responses',
    customField: 'preserved',
    compat: { supportsStrictMode: false },
    headers: {
      'X-Custom': 'preserved',
      'User-Agent': 'GitHubCopilotChat/0.35.0',
      'Editor-Version': 'vscode/1.107.0',
      'Editor-Plugin-Version': 'copilot-chat/0.35.0',
      'Copilot-Integration-Id': 'vscode-chat',
    },
    models: [{
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
    }],
  }
}

function activeTemporaryRouteBackup(): string {
  const active = activeTemporaryGpt6Profile()
  return encodeBackup({
    version: 2, phase: 'overlay', sourceRevision: 0, sourceEpoch: ROUTE_OWNERSHIP_EPOCH, providerExisted: true,
    preimage: { models: [{ id: 'gpt-5.4', api: 'openai-responses' }] },
    postimage: leavesOf(active),
    ownedHeaders: {
      'User-Agent': 'GitHubCopilotChat/0.35.0',
      'Editor-Version': 'vscode/1.107.0',
      'Editor-Plugin-Version': 'copilot-chat/0.35.0',
      'Copilot-Integration-Id': 'vscode-chat',
    },
  })
}

afterEach(() => vi.unstubAllGlobals())

describe('GitHubCopilotAuthorizationController', () => {
  it('reads status repeatedly without repairing, authorizing or making network calls', async () => {
    const harness = runtime({ configured: true, providerProfile: {} })
    const fetchMock = vi.fn(() => { throw new Error('status must not perform network I/O') })
    vi.stubGlobal('fetch', fetchMock)
    for (let i = 0; i < 2; i++) {
      const view = await harness.controller.status()
      expect(view).toMatchObject({
        configured: true, phase: 'signed-in', route: { state: 'needs-repair' },
        catalog: { supportedModelCount: 1 },
      })
      expect(JSON.stringify(view)).not.toContain('copilot-api-token')
      expect(JSON.stringify(view)).not.toContain('github-device-grant')
    }
    expect(harness.describeSettings).toHaveBeenCalledWith({ redactSecrets: true })
    expect(harness.mutate).not.toHaveBeenCalled()
    expect(harness.begin).not.toHaveBeenCalled()
    expect(harness.deleteRecord).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('retains configured authentication when route inspection fails without leaking the failure', async () => {
    const harness = runtime({ configured: true, readFailure: true })
    const view = await harness.controller.status()
    expect(view).toMatchObject({
      configured: true, phase: 'signed-in',
      route: { state: 'error', diagnosticCode: 'ROUTE_READ_FAILED' },
    })
    expect(JSON.stringify(view)).not.toContain('SYNTHETIC_PRIVATE_ERROR')
    expect(harness.mutate).not.toHaveBeenCalled()
    expect(harness.begin).not.toHaveBeenCalled()
  })

  it('explicitly reconciles the stored snapshot without forcing sign-in or network access', async () => {
    const harness = runtime({ configured: true, providerProfile: {} })
    const fetchMock = vi.fn(() => { throw new Error('repair must not force network I/O') })
    vi.stubGlobal('fetch', fetchMock)
    await expect(harness.controller.status()).resolves.toMatchObject({ route: { state: 'needs-repair' } })
    expect(harness.mutate).not.toHaveBeenCalled()
    await expect(harness.controller.reconcile()).resolves.toMatchObject({ route: { state: 'ready' } })
    expect(harness.mutate).toHaveBeenCalled()
    harness.mutate.mockClear()
    await expect(harness.controller.status()).resolves.toMatchObject({ route: { state: 'ready' } })
    expect(harness.mutate).not.toHaveBeenCalled()
    expect(harness.begin).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports retryable repair failure separately from successful authentication', async () => {
    let fail = true
    const harness = runtime({
      configured: true, providerProfile: {},
      beforeMutate() { if (fail) throw new Error('SYNTHETIC_PRIVATE_REPAIR_ERROR') },
    })
    await expect(harness.controller.reconcile()).resolves.toMatchObject({
      phase: 'signed-in', configured: true,
      route: { state: 'needs-repair', diagnosticCode: 'RECONCILIATION_FAILED' },
    })
    expect(JSON.stringify(await harness.controller.status())).not.toContain('SYNTHETIC_PRIVATE_REPAIR_ERROR')
    fail = false
    await expect(harness.controller.reconcile()).resolves.toMatchObject({ route: { state: 'ready' } })
  })

  it('returns a read-only ownership conflict for a legacy marker and preserves it on repair', async () => {
    const harness = runtime({ configured: true, providerProfile: activeTemporaryGpt6Profile() })
    harness.settingsDocument['github-copilot'] = {
      temporaryRouteBackup: JSON.stringify({ providerExisted: true, leaves: {}, preservedHeaderNames: [] }),
    }
    await expect(harness.controller.status()).resolves.toMatchObject({
      phase: 'signed-in', route: { state: 'conflict', diagnosticCode: 'ROUTE_CONFLICT' },
    })
    await expect(harness.controller.reconcile()).resolves.toMatchObject({
      phase: 'signed-in', route: { state: 'conflict' },
    })
    expect(harness.mutate).not.toHaveBeenCalled()
  })

  it('does not reconcile while an authorization attempt is in flight', async () => {
    const harness = runtime()
    await harness.controller.start()
    await expect(harness.controller.reconcile()).resolves.toMatchObject({ inFlight: true })
    expect(harness.mutate).not.toHaveBeenCalled()
    await harness.controller.cancel()
  })
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
    }], expect.any(Number))
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
    }], expect.any(Number))
  })

  it('repairs only the model list while preserving the rest of the Copilot profile and unrelated providers', async () => {
    const harness = runtime({
      configured: true,
      providerProfile: {
        baseURL: 'https://example.invalid',
        apiKeyEnv: 'COPILOT_GITHUB_TOKEN',
        customField: 'preserved',
        compat: { supportsStrictMode: false, customCompat: 'preserved' },
        // A known model may legitimately inherit its API; use an actual stale
        // account model to exercise list repair rather than forcing needless writes.
        models: [{ id: 'gpt-5-mini' }],
      },
    })
    const section = harness.settingsDocument['llm-pi-ai'] as { providers: Record<string, unknown> }

    await expect(harness.controller.start()).resolves.toMatchObject({ phase: 'signed-in' })
    expect(harness.mutate).toHaveBeenCalledWith('llm-pi-ai', [{
      op: 'set',
      path: ['providers', 'github-copilot', 'models'],
      value: [{ id: 'gpt-5.4', api: 'openai-responses' }],
    }], expect.any(Number))
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
    }], expect.any(Number))
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
    }], expect.any(Number))
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
    }], expect.any(Number))
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
    }], expect.any(Number))
  })

  it('materializes the temporary GPT-6 Astra overlay only for an entitled account', async () => {
    const harness = runtime({
      configured: true,
      availableModelIds: ['gpt-6-astra', 'gpt-5.6-sol', 'claude-sonnet-4.5'],
      providerProfile: {
        headers: { 'X-Custom': 'preserved' },
      },
    })

    await expect(harness.controller.reconcile()).resolves.toMatchObject({
      phase: 'signed-in',
      route: { state: 'ready' },
      catalog: {
        state: 'current',
        accountModelCount: 3,
        supportedModelCount: 2,
        unknownModelIds: [],
        temporarilyUnavailableModelIds: ['claude-sonnet-4.5'],
      },
    })
    expect(harness.mutate).toHaveBeenCalledWith('github-copilot', [{
      op: 'set',
      path: ['temporaryRouteBackup'],
      value: expect.any(String),
    }], expect.any(Number))
    expect(harness.mutate).toHaveBeenCalledWith('llm-pi-ai', [{
      op: 'set',
      path: ['providers', 'github-copilot', 'api'],
      value: 'openai-responses',
    }, {
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
    }, ...Object.entries({
      'User-Agent': 'GitHubCopilotChat/0.35.0',
      'Editor-Version': 'vscode/1.107.0',
      'Editor-Plugin-Version': 'copilot-chat/0.35.0',
      'Copilot-Integration-Id': 'vscode-chat',
    }).map(([name, value]) => ({
      op: 'set', path: ['providers', 'github-copilot', 'headers', name], value,
    }))], expect.any(Number))
    expect(harness.settingsDocument['llm-pi-ai']).toMatchObject({
      providers: { 'github-copilot': { headers: { 'X-Custom': 'preserved' } } },
    })
  })

  it('preserves a prepared activation after a failed route write for review', async () => {
    let failRouteWrite = true
    const harness = runtime({
      configured: true,
      availableModelIds: ['gpt-6-astra', 'gpt-5.4'],
      providerProfile: { headers: { 'X-Custom': 'preserved' } },
      beforeMutate(namespace) {
        if (namespace === 'llm-pi-ai' && failRouteWrite) {
          failRouteWrite = false
          throw new Error('route write failed')
        }
      },
    })

    await expect(inspectGitHubCopilotProviderProfile(harness.ctx)).rejects.toThrow('route write failed')
    expect(harness.settingsDocument['github-copilot']).toMatchObject({
      temporaryRouteBackup: expect.any(String),
    })
    harness.mutate.mockClear()
    await expect(inspectGitHubCopilotProviderProfile(harness.ctx)).rejects.toThrow(/TEMPORARY_ROUTE_OWNERSHIP_CONFLICT/)
    await expect(harness.controller.status()).resolves.toMatchObject({ route: { state: 'conflict' } })
    expect(harness.mutate).not.toHaveBeenCalled()
    expect(harness.settingsDocument['llm-pi-ai']).toMatchObject({
      providers: { 'github-copilot': { headers: { 'X-Custom': 'preserved' } } },
    })
  })

  it('retries backup cleanup after route restoration commits first', async () => {
    let failBackupCleanup = true
    const harness = runtime({
      configured: true,
      availableModelIds: ['gpt-5.4'],
      providerProfile: activeTemporaryGpt6Profile(),
      beforeMutate(namespace, operations) {
        if (namespace === 'github-copilot' && operations[0]?.op === 'unset' && failBackupCleanup) {
          failBackupCleanup = false
          throw new Error('backup cleanup failed')
        }
      },
    })
    harness.settingsDocument['github-copilot'] = {
      temporaryRouteBackup: activeTemporaryRouteBackup(),
    }

    await expect(inspectGitHubCopilotProviderProfile(harness.ctx)).rejects.toThrow('backup cleanup failed')
    expect(harness.settingsDocument['llm-pi-ai']).toMatchObject({
      providers: {
        'github-copilot': {
          models: [{ id: 'gpt-5.4', api: 'openai-responses' }],
        },
      },
    })
    await expect(inspectGitHubCopilotProviderProfile(harness.ctx)).resolves.toMatchObject({ changed: true })
    expect(harness.settingsDocument['github-copilot']).toEqual({})
  })

  it('rejects malformed temporary route backup leaves before replay', async () => {
    const harness = runtime({
      configured: true,
      availableModelIds: ['gpt-5.4'],
      providerProfile: activeTemporaryGpt6Profile(),
    })
    harness.settingsDocument['github-copilot'] = {
      temporaryRouteBackup: JSON.stringify({
        version: 2, sourceRevision: 0, sourceEpoch: ROUTE_OWNERSHIP_EPOCH, providerExisted: true, phase: 'overlay',
        preimage: { headers: { Authorization: 'must-not-replay' } },
        postimage: {}, ownedHeaders: {},
      }),
    }

    await expect(inspectGitHubCopilotProviderProfile(harness.ctx)).rejects.toThrow(
      /TEMPORARY_ROUTE_INVALID_BACKUP/,
    )
    expect(harness.mutate).not.toHaveBeenCalled()
  })

  it('refuses to overwrite a conflicting user-configured route protocol for GPT-6', async () => {
    const harness = runtime({
      configured: true,
      availableModelIds: ['gpt-6-astra'],
      providerProfile: {
        api: 'anthropic-messages',
        models: [{ id: 'claude-sonnet-4.5', api: 'anthropic-messages' }],
      },
    })

    await expect(inspectGitHubCopilotProviderProfile(harness.ctx)).rejects.toThrow(
      /TEMPORARY_ROUTE_OWNERSHIP_CONFLICT/,
    )
    expect(harness.mutate).not.toHaveBeenCalled()
  })

  it('refuses to overwrite a conflicting user-configured Copilot header', async () => {
    const harness = runtime({
      configured: true,
      availableModelIds: ['gpt-6-astra'],
      providerProfile: {
        headers: { 'user-agent': 'my-client' },
      },
    })

    await expect(inspectGitHubCopilotProviderProfile(harness.ctx)).rejects.toThrow(
      /TEMPORARY_ROUTE_OWNERSHIP_CONFLICT/,
    )
    expect(harness.mutate).not.toHaveBeenCalled()
  })

  it('does not claim ownership of an existing matching route protocol', async () => {
    const harness = runtime({
      configured: true,
      availableModelIds: ['gpt-6-astra'],
      providerProfile: {
        api: 'openai-responses',
        models: [{ id: 'gpt-5.4', api: 'openai-responses' }],
      },
    })

    await expect(inspectGitHubCopilotProviderProfile(harness.ctx)).rejects.toThrow(
      /TEMPORARY_ROUTE_OWNERSHIP_CONFLICT/,
    )
    expect(harness.mutate).not.toHaveBeenCalled()
  })

  async function expectTemporaryRouteRemoved(availableModelIds: readonly string[]): Promise<void> {
    const harness = runtime({
      configured: true,
      availableModelIds,
      providerProfile: activeTemporaryGpt6Profile(),
    })
    harness.settingsDocument['github-copilot'] = {
      temporaryRouteBackup: activeTemporaryRouteBackup(),
    }

    await expect(inspectGitHubCopilotProviderProfile(harness.ctx)).resolves.toMatchObject({
      changed: true,
      catalog: { supportedModelCount: 0 },
    })
    expect(harness.mutate).toHaveBeenCalledWith('llm-pi-ai', [{
      op: 'unset',
      path: ['providers', 'github-copilot', 'api'],
    }, {
      op: 'set',
      path: ['providers', 'github-copilot', 'models'],
      value: [{ id: 'gpt-5.4', api: 'openai-responses' }],
    }, ...['User-Agent', 'Editor-Version', 'Editor-Plugin-Version', 'Copilot-Integration-Id'].map(name => ({
      op: 'unset', path: ['providers', 'github-copilot', 'headers', name],
    }))], expect.any(Number))
    expect(harness.mutate).toHaveBeenCalledWith('github-copilot', [{
      op: 'unset',
      path: ['temporaryRouteBackup'],
    }], expect.any(Number))
    expect(harness.settingsDocument['llm-pi-ai']).toEqual({
      providers: {
        openai: { apiKeyEnv: 'OPENAI_API_KEY' },
        'github-copilot': {
          customField: 'preserved',
          compat: { supportsStrictMode: false },
          headers: { 'X-Custom': 'preserved' },
          models: [{ id: 'gpt-5.4', api: 'openai-responses' }],
        },
      },
    })
  }

  it('restores the original route after an empty account model list', async () => {
    await expectTemporaryRouteRemoved([])
  })

  it('restores the original route after an unknown-only account model list', async () => {
    await expectTemporaryRouteRemoved(['future-unknown-model'])
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
    }], expect.any(Number))
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
        temporarilyUnavailableModelIds: [],
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
