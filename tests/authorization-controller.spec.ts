import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  GITHUB_COPILOT_CREDENTIAL_KEY,
  GitHubCopilotAuthorizationController,
  ensureGitHubCopilotProviderProfile,
  inspectGitHubCopilotProviderProfile,
  describeGitHubCopilotProviderProfile,
} from '../src/authorization-controller.ts'
import { encodeBackup, leavesOf, ROUTE_OWNERSHIP_EPOCH } from '../src/route-ownership.ts'

const catalogDrift = vi.hoisted(() => ({ wrongGpt6Api: false }))
vi.mock('@earendil-works/pi-ai/providers/all', async (importOriginal) => {
  const original = await importOriginal<typeof import('@earendil-works/pi-ai/providers/all')>()
  return { ...original, getBuiltinModels(provider: Parameters<typeof original.getBuiltinModels>[0]) {
    const native = original.getBuiltinModels(provider).filter(model => provider !== 'github-copilot' || model.id !== 'claude-sonnet-4.5')
    return provider !== 'github-copilot' || !catalogDrift.wrongGpt6Api ? native : [...native, {
      ...native[0]!, id: 'gpt-6-astra', name: 'GPT-6 Astra', api: 'openai-completions' as const,
    }]
  } }
})

interface Runtime {
  readonly ctx: Context
  readonly controller: GitHubCopilotAuthorizationController
  readonly services: Map<string, unknown>
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
    services,
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

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); catalogDrift.wrongGpt6Api = false })

describe('GitHubCopilotAuthorizationController', () => {
  it('exposes only owned model presentation leaves and never discovers during status', async () => {
    const harness = runtime({ configured: true })
    const discover = vi.fn(async () => { throw new Error('status cannot discover') })
    const view = Object.defineProperty({ state: 'ready', models: [{ id: 'future-lab-r17', name: 'Future model', api: 'openai-responses' }],
      rejected: [{ id: 'unsupported-model', code: 'UNSUPPORTED_ENDPOINTS' }], discoveredAt: 100 }, 'accountKey', {
      get() { throw new Error('private account key must not be read') },
    })
    harness.services.set('githubCopilotPreview', { getView: () => view, discover })
    await expect(harness.controller.status()).resolves.toMatchObject({ accountModels: {
      state: 'ready', models: [{ id: 'future-lab-r17', name: 'Future model', api: 'openai-responses' }], discoveredAt: 100,
    } })
    expect((await harness.controller.status()).accountModels).not.toHaveProperty('accountKey')
    expect(discover).not.toHaveBeenCalled()
    expect(harness.mutate).not.toHaveBeenCalled()
  })

  it('projects capability warnings separately without rejecting selectable models or exposing extras', async () => {
    const harness = runtime({ configured: true })
    const warning = Object.defineProperty({ id: 'future-model', code: 'INPUT_LIMIT_NOT_ENFORCED_BY_CORE' }, 'private', {
      enumerable: true, get() { throw new Error('private warning data must not be read') },
    })
    harness.services.set('githubCopilotPreview', { getView: () => ({ state: 'ready',
      models: [{ id: 'future-model', name: 'Future model', api: 'openai-responses' }], rejected: [], warnings: [warning],
    }) })
    expect((await harness.controller.status()).accountModels).toEqual({ state: 'ready',
      models: [{ id: 'future-model', name: 'Future model', api: 'openai-responses' }], rejected: [],
      warnings: [{ id: 'future-model', code: 'INPUT_LIMIT_NOT_ENFORCED_BY_CORE' }],
    })
    expect(harness.mutate).not.toHaveBeenCalled()
  })

  it('discovers account models only on an explicit action without changing selection or settings', async () => {
    const harness = runtime({ configured: true })
    const discover = vi.fn(async () => undefined)
    harness.services.set('githubCopilotPreview', { discover, getView: () => ({ state: 'ready', models: [], rejected: [] }) })
    await expect(harness.controller.discoverModels()).resolves.toMatchObject({
      configured: true, phase: 'signed-in', route: { state: 'not-configured' }, accountModels: { state: 'ready' },
    })
    expect(discover).toHaveBeenCalledExactlyOnceWith({ force: true })
    expect(harness.begin).not.toHaveBeenCalled()
    expect(harness.mutate).not.toHaveBeenCalled()
    expect(harness.deleteRecord).not.toHaveBeenCalled()
  })

  it('keeps discovery unavailable or failed separate from sign-in and sanitizes failures', async () => {
    const harness = runtime({ configured: true })
    await expect(harness.controller.discoverModels()).resolves.toMatchObject({ phase: 'signed-in', accountModels: {
      state: 'error', error: 'COPILOT_MODEL_DISCOVERY_UNAVAILABLE',
    } })
    harness.services.set('githubCopilotPreview', { getView: () => ({ state: 'idle', models: [], rejected: [] }),
      discover: async () => { throw new Error('SYNTHETIC_PRIVATE_DISCOVERY_ERROR') },
    })
    const result = await harness.controller.discoverModels()
    expect(result).toMatchObject({ phase: 'signed-in', accountModels: { error: 'COPILOT_MODEL_DISCOVERY_FAILED' } })
    expect(JSON.stringify(result)).not.toContain('SYNTHETIC_PRIVATE')
    expect(harness.mutate).not.toHaveBeenCalled()
  })

  it('does not start model discovery while signed out', async () => {
    const harness = runtime({ configured: false })
    const discover = vi.fn()
    harness.services.set('githubCopilotPreview', { discover, getView: () => ({ state: 'unconfigured', models: [], rejected: [] }) })
    await harness.controller.discoverModels()
    expect(discover).not.toHaveBeenCalled()
  })

  it('reads status repeatedly without repairing, authorizing or making network calls', async () => {
    const harness = runtime({ configured: true, providerProfile: {} })
    const fetchMock = vi.fn(() => { throw new Error('status must not perform network I/O') })
    vi.stubGlobal('fetch', fetchMock)
    for (let i = 0; i < 2; i++) {
      const view = await harness.controller.status()
      expect(view).toMatchObject({
        configured: true, phase: 'signed-in', route: { state: 'needs-repair' },
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
  it('signs in through the built-in flow without recreating a canonical profile', async () => {
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
    // Exercise the same coalesced repair helper directly: the controller's
    // reconcile method may return early while the sign-in attempt is settling.
    await expect(ensureGitHubCopilotProviderProfile(harness.ctx)).resolves.toBe(false)
    await expect(harness.controller.status()).resolves.toMatchObject({ route: { state: 'not-configured' } })
    expect(harness.mutate).not.toHaveBeenCalled()
    expect(harness.settingsDocument['llm-pi-ai']).toEqual({
      providers: { openai: { apiKeyEnv: 'OPENAI_API_KEY' } },
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
      path: ['providers', 'github-copilot', 'compat', 'supportsStrictMode'],
      value: false,
    }], expect.any(Number))
  })

  it('preserves canonical models and all unrelated profile fields instead of projecting the companion catalog', async () => {
    const profile = {
      baseURL: 'https://example.invalid', apiKeyEnv: 'COPILOT_GITHUB_TOKEN', customField: 'preserved',
      compat: { supportsStrictMode: false, customCompat: 'preserved' },
      models: [{ id: 'claude-sonnet-4.5', customCapability: 'user-owned' }, { id: 'arbitrary-core-model' }],
      headers: { 'X-Custom': 'preserved' },
    }
    const harness = runtime({ configured: true, providerProfile: profile, availableModelIds: ['gpt-5.4'] })
    const before = structuredClone(harness.settingsDocument)
    await expect(harness.controller.start()).resolves.toMatchObject({ phase: 'signed-in', route: { state: 'ready' } })
    expect(harness.mutate).not.toHaveBeenCalled()
    expect(harness.settingsDocument).toEqual(before)
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

  it('keeps a missing canonical profile intentionally absent for new account models', async () => {
    const harness = runtime({ configured: true, availableModelIds: ['gemini-3.8-flash', 'future-responses-model'] })
    await expect(harness.controller.start()).resolves.toMatchObject({
      configured: true, phase: 'signed-in', route: { state: 'not-configured' },
    })
    expect(harness.mutate).not.toHaveBeenCalled()
    expect(harness.begin).not.toHaveBeenCalled()
    expect(harness.settingsDocument['llm-pi-ai']).toEqual({ providers: {
      openai: { apiKeyEnv: 'OPENAI_API_KEY' },
    } })
  })

  it('does not recreate an absent canonical profile during status or startup and auth reconciliation helpers', async () => {
    const harness = runtime({ configured: true })
    const before = structuredClone(harness.settingsDocument)
    const fetchMock = vi.fn(() => { throw new Error('configuration planning must not perform network I/O') })
    vi.stubGlobal('fetch', fetchMock)
    await expect(describeGitHubCopilotProviderProfile(harness.ctx)).resolves.toEqual({ state: 'not-configured' })
    await expect(harness.controller.status()).resolves.toMatchObject({
      configured: true, phase: 'signed-in', route: { state: 'not-configured' },
    })
    // Host startup and token-refresh callbacks share this exported helper.
    await expect(ensureGitHubCopilotProviderProfile(harness.ctx)).resolves.toBe(false)
    await expect(ensureGitHubCopilotProviderProfile(harness.ctx)).resolves.toBe(false)
    await expect(inspectGitHubCopilotProviderProfile(harness.ctx)).resolves.toEqual({ changed: false })
    await expect(harness.controller.reconcile()).resolves.toMatchObject({ route: { state: 'not-configured' } })
    expect(harness.settingsDocument).toEqual(before)
    expect(harness.mutate).not.toHaveBeenCalled()
    expect(harness.begin).not.toHaveBeenCalled()
    expect(harness.deleteRecord).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not restore a canonical profile after its explicit removal from synthetic settings', async () => {
    const harness = runtime({ configured: true, providerProfile: { compat: { supportsStrictMode: false } } })
    const section = harness.settingsDocument['llm-pi-ai'] as { providers: Record<string, unknown> }
    delete section.providers['github-copilot']
    await expect(ensureGitHubCopilotProviderProfile(harness.ctx)).resolves.toBe(false)
    await expect(harness.controller.start()).resolves.toMatchObject({
      configured: true, phase: 'signed-in', route: { state: 'not-configured' },
    })
    expect(section.providers).not.toHaveProperty('github-copilot')
    expect(harness.mutate).not.toHaveBeenCalled()
  })

  it('keeps absent-profile legacy journal conflicts visible instead of bypassing ownership review', async () => {
    const harness = runtime({ configured: true })
    const marker = activeTemporaryRouteBackup()
    harness.settingsDocument['github-copilot'] = { temporaryRouteBackup: marker }
    await expect(harness.controller.status()).resolves.toMatchObject({
      configured: true, phase: 'signed-in', route: { state: 'conflict', diagnosticCode: 'ROUTE_CONFLICT' },
    })
    await expect(inspectGitHubCopilotProviderProfile(harness.ctx)).rejects.toThrow(/TEMPORARY_ROUTE_OWNERSHIP_CONFLICT/)
    expect(harness.settingsDocument['github-copilot']).toEqual({ temporaryRouteBackup: marker })
    expect(harness.mutate).not.toHaveBeenCalled()
  })

  it('preserves configured Anthropic and OpenAI models while repairing only strict mode', async () => {
    const models = [{ id: 'claude-sonnet-4.5', api: 'anthropic-messages' }, { id: 'gpt-5.4', api: 'openai-responses' }]
    const profile = { models, headers: { 'X-Custom': 'preserved' }, compat: { supportsStrictMode: true } }
    const harness = runtime({ configured: true, availableModelIds: ['claude-sonnet-4.5', 'gpt-5.4'], providerProfile: profile })
    await expect(harness.controller.start()).resolves.toMatchObject({ phase: 'signed-in' })
    expect(profile.models).toBe(models)
    expect(profile.models).toEqual(models)
    expect(profile.headers).toEqual({ 'X-Custom': 'preserved' })
    expect(harness.mutate).toHaveBeenCalledExactlyOnceWith('llm-pi-ai', [{
      op: 'set', path: ['providers', 'github-copilot', 'compat', 'supportsStrictMode'], value: false,
    }], 0)
  })

  it('does not reorder or replace canonical models when account IDs are duplicated or reordered', async () => {
    const profile = { compat: { supportsStrictMode: false }, models: [{ id: 'core-first' }, { id: 'core-second' }] }
    const harness = runtime({ configured: true, providerProfile: profile,
      availableModelIds: ['core-second', 'core-second', 'core-first', 'new-model'] })
    const before = structuredClone(harness.settingsDocument)
    await expect(harness.controller.start()).resolves.toMatchObject({ phase: 'signed-in' })
    expect(harness.settingsDocument).toEqual(before)
    expect(harness.mutate).not.toHaveBeenCalled()
  })

  it('keeps managed discovery independent from canonical configuration', async () => {
    const profile = { models: [{ id: 'claude-sonnet-4.5' }], compat: { supportsStrictMode: false } }
    const harness = runtime({ configured: true, providerProfile: profile, availableModelIds: ['arbitrary-new-model'] })
    harness.services.set('githubCopilotPreview', { getView: () => ({ state: 'ready',
      models: [{ id: 'arbitrary-new-model', name: 'Discovered model', api: 'openai-responses' }], rejected: [] }) })
    const view = await harness.controller.reconcile()
    expect(view).toMatchObject({ route: { state: 'ready' }, accountModels: { models: [{ id: 'arbitrary-new-model' }] } })
    expect(view).not.toHaveProperty('catalog')
    expect(profile.models).toEqual([{ id: 'claude-sonnet-4.5' }])
    expect(harness.mutate).not.toHaveBeenCalled()
  })

  it('does not judge a user route protocol using another catalog copy', async () => {
    const profile = { api: 'anthropic-messages', models: [{ id: 'claude-sonnet-4.5' }], compat: { supportsStrictMode: false } }
    const harness = runtime({ configured: true, availableModelIds: ['gpt-6-astra', 'gemini-3.6-flash'], providerProfile: profile })
    const before = structuredClone(profile)
    await expect(inspectGitHubCopilotProviderProfile(harness.ctx)).resolves.toEqual({ changed: false })
    expect(profile).toEqual(before)
    expect(harness.mutate).not.toHaveBeenCalled()
  })

  it('does not change canonical settings when account entitlement becomes empty', async () => {
    const availableModelIds = ['gpt-6-astra', 'gemini-3.6-flash']
    const profile = { models: [{ id: 'user-model', userField: 'keep' }], headers: { 'X-Custom': 'preserved' } }
    const harness = runtime({ configured: true, availableModelIds, providerProfile: profile })
    await inspectGitHubCopilotProviderProfile(harness.ctx)
    const before = structuredClone(harness.settingsDocument)
    availableModelIds.splice(0)
    harness.mutate.mockClear()
    await expect(inspectGitHubCopilotProviderProfile(harness.ctx)).resolves.toEqual({ changed: false })
    expect(harness.mutate).not.toHaveBeenCalled()
    expect(harness.settingsDocument).toEqual(before)
  })

  it('does not add or remove canonical models based on a conflicting local GPT-6 entry', async () => {
    catalogDrift.wrongGpt6Api = true
    const profile = { models: [{ id: 'claude-sonnet-4.5' }], compat: { supportsStrictMode: false } }
    const harness = runtime({ configured: true, providerProfile: profile, availableModelIds: ['gpt-6-astra', 'gemini-3.6-flash'] })
    await expect(harness.controller.reconcile()).resolves.toMatchObject({ route: { state: 'ready' } })
    expect(profile.models).toEqual([{ id: 'claude-sonnet-4.5' }])
    expect(harness.mutate).not.toHaveBeenCalled()
  })

  it('restores the owned canonical override without creating another ownership cycle', async () => {
    const harness = runtime({ configured: true,
      availableModelIds: ['gpt-6-astra', 'gpt-5.4', 'gemini-3.6-flash'],
      providerProfile: activeTemporaryGpt6Profile(),
    })
    harness.settingsDocument['github-copilot'] = { temporaryRouteBackup: activeTemporaryRouteBackup() }
    await expect(inspectGitHubCopilotProviderProfile(harness.ctx)).resolves.toMatchObject({
      changed: true,
    })
    const providers = (harness.settingsDocument['llm-pi-ai'] as { providers: Record<string, Record<string, unknown>> }).providers
    expect(providers['github-copilot']?.api).toBeUndefined()
    expect(providers['github-copilot']).toMatchObject({ customField: 'preserved', headers: { 'X-Custom': 'preserved' } })
    expect(harness.settingsDocument['github-copilot']).toEqual({})
    expect(providers['github-copilot']?.models).toEqual([
      { id: 'gpt-5.4', api: 'openai-responses' },
    ])
    harness.mutate.mockClear()
    await expect(inspectGitHubCopilotProviderProfile(harness.ctx)).resolves.toMatchObject({ changed: false })
    expect(harness.mutate).not.toHaveBeenCalled()
  })

  it('does not install global protocols or headers for new account models', async () => {
    const harness = runtime({ configured: true, availableModelIds: ['future-model-a', 'future-model-b'],
      providerProfile: { headers: { 'X-Custom': 'preserved' } } })
    const view = await harness.controller.reconcile()
    expect(view).toMatchObject({ phase: 'signed-in', route: { state: 'ready' } })
    expect(view).not.toHaveProperty('catalog')
    expect(harness.mutate).toHaveBeenCalledExactlyOnceWith('llm-pi-ai', [{
      op: 'set', path: ['providers', 'github-copilot', 'compat', 'supportsStrictMode'], value: false,
    }], 0)
    expect(harness.settingsDocument['llm-pi-ai']).toMatchObject({ providers: { 'github-copilot': {
      headers: { 'X-Custom': 'preserved' }, compat: { supportsStrictMode: false },
    } } })
    expect(harness.settingsDocument['github-copilot']).toEqual({})
  })

  it('refuses a legacy prepared activation without replaying its route write', async () => {
    const marker = activeTemporaryRouteBackup()
    const journal = JSON.parse(marker)
    const harness = runtime({ configured: true, availableModelIds: ['gpt-6-astra', 'gpt-5.4'],
      providerProfile: { ...journal.preimage, headers: { 'X-Custom': 'preserved' } },
    })
    harness.settingsDocument['github-copilot'] = { temporaryRouteBackup: marker }
    await expect(inspectGitHubCopilotProviderProfile(harness.ctx)).rejects.toThrow(/TEMPORARY_ROUTE_OWNERSHIP_CONFLICT/)
    await expect(harness.controller.status()).resolves.toMatchObject({ route: { state: 'conflict' } })
    expect(harness.mutate).not.toHaveBeenCalled()
    expect(harness.settingsDocument['github-copilot']).toEqual({ temporaryRouteBackup: marker })
    expect(harness.settingsDocument['llm-pi-ai']).toMatchObject({ providers: { 'github-copilot': { headers: { 'X-Custom': 'preserved' } } } })
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
        compat: { supportsStrictMode: false },
        api: 'anthropic-messages',
        models: [{ id: 'claude-sonnet-4.5', api: 'anthropic-messages' }],
      },
    })

    const before = structuredClone(harness.settingsDocument)
    await expect(inspectGitHubCopilotProviderProfile(harness.ctx)).resolves.toMatchObject({ changed: false })
    expect(harness.mutate).not.toHaveBeenCalled()
    expect(harness.settingsDocument).toEqual(before)
  })

  it('refuses to overwrite a conflicting user-configured Copilot header', async () => {
    const harness = runtime({
      configured: true,
      availableModelIds: ['gpt-6-astra'],
      providerProfile: {
        compat: { supportsStrictMode: false },
        headers: { 'user-agent': 'my-client' },
      },
    })

    const before = structuredClone(harness.settingsDocument)
    await expect(inspectGitHubCopilotProviderProfile(harness.ctx)).resolves.toMatchObject({ changed: false })
    expect(harness.mutate).not.toHaveBeenCalled()
    expect(harness.settingsDocument).toEqual(before)
  })

  it('does not claim ownership of an existing matching route protocol', async () => {
    const harness = runtime({
      configured: true,
      availableModelIds: ['gpt-6-astra'],
      providerProfile: {
        compat: { supportsStrictMode: false },
        api: 'openai-responses',
        models: [{ id: 'gpt-5.4', api: 'openai-responses' }],
      },
    })

    const before = structuredClone(harness.settingsDocument)
    await expect(inspectGitHubCopilotProviderProfile(harness.ctx)).resolves.toMatchObject({ changed: false })
    expect(harness.mutate).not.toHaveBeenCalled()
    expect(harness.settingsDocument).toEqual(before)
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

  it('reports managed discovery rejections without claiming the Core catalog is outdated', async () => {
    const harness = runtime({ configured: true, availableModelIds: ['unseen-model'],
      providerProfile: { compat: { supportsStrictMode: false }, models: [{ id: 'core-model' }] } })
    harness.services.set('githubCopilotPreview', { getView: () => ({ state: 'ready', models: [],
      rejected: [{ id: 'unseen-model', code: 'UNSUPPORTED_ENDPOINTS' }] }) })
    const view = await harness.controller.start()
    expect(view).toMatchObject({ phase: 'signed-in', accountModels: { rejected: [{ id: 'unseen-model', code: 'UNSUPPORTED_ENDPOINTS' }] } })
    expect(view).not.toHaveProperty('catalog')
    expect(harness.mutate).not.toHaveBeenCalled()
  })

  it('does not derive canonical readiness from local model availability', async () => {
    const harness = runtime({ configured: true, availableModelIds: ['not-in-installed-catalog'],
      providerProfile: { compat: { supportsStrictMode: false }, models: [{ id: 'claude-sonnet-4.5' }] } })
    const before = structuredClone(harness.settingsDocument)
    await expect(inspectGitHubCopilotProviderProfile(harness.ctx)).resolves.toEqual({ changed: false })
    const view = await harness.controller.status()
    expect(view).toMatchObject({ phase: 'signed-in', route: { state: 'ready' } })
    expect(view).not.toHaveProperty('catalog')
    expect(harness.settingsDocument).toEqual(before)
    expect(harness.mutate).not.toHaveBeenCalled()
  })

  it('never changes the user default selection while restoring canonical configuration', async () => {
    const harness = runtime({ configured: true, providerProfile: activeTemporaryGpt6Profile() })
    harness.settingsDocument['github-copilot'] = { temporaryRouteBackup: activeTemporaryRouteBackup() }
    const selection = { provider: 'user-selected-provider', model: 'user-selected-model' }
    harness.settingsDocument['agent-default-model'] = selection
    await inspectGitHubCopilotProviderProfile(harness.ctx)
    expect(harness.settingsDocument['agent-default-model']).toBe(selection)
    expect(selection).toEqual({ provider: 'user-selected-provider', model: 'user-selected-model' })
    expect(harness.mutate.mock.calls.every(([namespace]) => namespace === 'llm-pi-ai' || namespace === 'github-copilot')).toBe(true)
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
