/**
 * Composition tests of the inline plugin: the narrow gate, the llm/stream
 * short-circuit registration, the prompt section, and plan rebuild
 * semantics. The runtime, credentials, and network are synthetic; proof
 * lifecycle tests enable probing only against mocked fetch responses.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, GITHUB_COPILOT_SETTINGS_NAMESPACE } from '../../src/index.ts'
import type { InlineConfig } from '../../src/config.ts'
import type { GenerateOptions, Message, StreamChunk } from '@deepseek-ai/dsh-llm'
import { markAgentLoopRequest } from '@deepseek-ai/dsh-llm'
import type { Context } from '@deepseek-ai/cordis'
import type { WebFetchProvider, WebSearchProvider } from '@deepseek-ai/dsh-web'

vi.mock('@deepseek-ai/dsh-settings', () => ({ installSettingsSection: undefined }))

interface FakeRuntime {
  ctx: Context
  listener: ((request: GenerateOptions, next: () => unknown) => unknown) | undefined
  sectionNames: string[]
  settingsDocument: Record<string, unknown>
  /** The registered prompt section object (name + dynamic text provider). */
  promptSection: { name: string; text: () => string } | undefined
  searchProviders: WebSearchProvider[]
  fetchProviders: WebFetchProvider[]
  credentialResolve: ReturnType<typeof vi.fn>
  credentialRead: ReturnType<typeof vi.fn>
  settingsGet: ReturnType<typeof vi.fn>
  settingsMutate: ReturnType<typeof vi.fn>
  emitCredentialUpdate(key: string): void
  credentialListenerCount(): number
  dispose(): void
  installedSettingsSections: string[]
  /** Commit a change to one settings namespace, as the settings service would. */
  triggerSettingsChange(ns: string): void
}

const config: InlineConfig = {
  enabled: true,
  providers: [],
  includeSources: true,
  stripServerTools: true,
  idleTimeoutMs: 300_000,
  probe: false,
  probeTimeoutMs: 30_000,
}

interface FakeSettings {
  settings: unknown
  get: ReturnType<typeof vi.fn>
  mutate: ReturnType<typeof vi.fn>
  installedSections: string[]
  triggerChange(ns: string): void
}

function fakeSettings(document: Record<string, unknown>): FakeSettings {
  const watchers = new Map<string, () => void>()
  const installedSections: string[] = []
  const settings = {
    get: vi.fn((ns: unknown) => document[String(ns)]),
    describe: () => Object.entries(document).map(([ns, value]) => ({ ns, revision: 0, user: value, value })),
    mutate: vi.fn(async () => undefined),
    register: (ns: unknown, schema: (value: unknown) => unknown, options?: { base?: unknown }) => {
      const namespace = String(ns)
      return {
        // Re-resolve on every read so a mutated document is visible to the
        // source thunk after a committed change.
        get: () => {
          const base = options?.base
          const saved = document[namespace]
          if (base !== undefined && (typeof base !== 'object' || base === null || Array.isArray(base))) {
            throw new Error('fake settings base must be a record')
          }
          if (saved !== undefined && (typeof saved !== 'object' || saved === null || Array.isArray(saved))) {
            throw new Error('fake settings document must be a record')
          }
          return schema({ ...base, ...saved })
        },
        watch: (callback: () => void) => {
          watchers.set(namespace, callback)
          return () => { watchers.delete(namespace) }
        },
        update: async () => undefined,
        replace: async () => undefined,
      }
    },
    installSection: (
      _owner: Context,
      ns: unknown,
      schema: (value: unknown) => unknown,
      entry: unknown,
      hooks: { setSource(source: () => unknown): void; onChange(): void },
    ) => {
      installedSections.push(String(ns))
      const scope = settings.register(ns, schema, { base: entry })
      hooks.setSource(scope.get)
      hooks.onChange()
      scope.watch(hooks.onChange)
    },
  }
  return { settings, get: settings.get, mutate: settings.mutate, installedSections, triggerChange: (ns) => watchers.get(ns)?.() }
}

/** Mutable default-model selection; `current: null` simulates an unsettled
 * boot or a transient route gap. */
type SelectionRef = { current: { provider: string; model: string } | null }

/** Later Core file blocks are deliberately absent from the rc.2 development types. */
function compatibilityFileBlock(attachment: {
  attachmentId: string
  name: string
  bytes: number
}): Message['content'][number] {
  return { type: 'file', attachment } as unknown as Message['content'][number]
}

function buildRuntime(
  overrides: Partial<FakeRuntime> = {},
  selectionRef: SelectionRef = { current: { provider: 'github-copilot', model: 'gpt-5.4' } },
  extraSettings: Record<string, unknown> = {},
): FakeRuntime {
  let listener: FakeRuntime['listener']
  const listeners = new Map<string, (request: GenerateOptions, next: () => unknown) => unknown>()
  const sectionNames: string[] = []
  const searchProviders: WebSearchProvider[] = []
  const fetchProviders: WebFetchProvider[] = []
  const credentialResolve = vi.fn(async () => ({ value: 'secret' }))
  const credentialRead = vi.fn<() => Promise<unknown>>(async () => ({
    kind: 'grant',
    payload: {
      type: 'oauth', refresh: 'github-device-grant', access: 'copilot-api-token',
      expires: Date.now() + 86_400_000, availableModelIds: ['gpt-5.4'],
    },
  }))
  const credentialListeners = new Set<(key: string) => void>()
  const disposers: (() => void)[] = []
  let promptSection: FakeRuntime['promptSection']
  const settingsDocument: Record<string, unknown> = {
    [GITHUB_COPILOT_SETTINGS_NAMESPACE]: {},
    // The chat route profile: currentChatRoute() reads `llm-pi-ai` providers.
    'llm-pi-ai': { providers: { 'github-copilot': {} } },
    ...extraSettings,
  }
  const fake = fakeSettings(settingsDocument)
  const store = new Map<string, unknown>([
    ['settings', fake.settings],
    // Mutable selection so route-switch tests can move between providers; a
    // null ref simulates a boot where the default-model service has not
    // settled a selection yet (route facts undetectable), read live so a
    // test can create and close a route gap mid-run.
    ['agentDefaultModel', {
      currentSelection: () => selectionRef.current === null
        ? undefined
        : { provider: selectionRef.current.provider, model: selectionRef.current.model },
    }],
    // Credentials seam so resolveApiKey never falls back to the process env.
    ['authorization', {
      describe: () => undefined,
      begin: async () => ({ status: 'cancelled' as const }),
      cancel: () => undefined,
    }],
    ['credentials', {
      resolve: credentialResolve,
      describeRecord: async () => ({ configured: false, writable: true }),
      readRecord: credentialRead,
      listRecords: async () => [{ key: 'llm-pi-ai/github-copilot', kind: 'grant' }],
      modifyRecord: async (_key: string, mutate: (current: unknown) => Promise<unknown>) => mutate({
        kind: 'grant',
        payload: {
          type: 'oauth',
          refresh: 'github-device-grant',
          access: 'copilot-api-token',
          expires: Date.now() + 86_400_000,
          availableModelIds: ['gpt-5.4'],
        },
      }),
      deleteRecord: async () => undefined,
    }],
    ['web', {
      registerSearchProvider: (provider: WebSearchProvider) => {
        searchProviders.push(provider)
        return () => undefined
      },
      registerFetchProvider: (provider: WebFetchProvider) => {
        fetchProviders.push(provider)
        return () => undefined
      },
    }],
  ])
  const ctx = {
    get: (name: string) => store.get(name),
    // The settings seam reads `ctx.fiber.state` to skip change callbacks
    // while a fiber is unloading; a live fiber is what this fake is.
    fiber: { state: 1 },
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
    plugin: () => undefined,
    on: (event: string, handler: (request: GenerateOptions, next: () => unknown) => unknown) => {
      if (event === 'credentials/record-updated') {
        const credentialHandler = handler as unknown as (key: string) => void
        credentialListeners.add(credentialHandler)
        const dispose = () => { credentialListeners.delete(credentialHandler) }
        disposers.push(dispose)
        return dispose
      }
      if (event === 'llm/stream') listener = handler
      listeners.set(event, handler)
      const dispose = () => { listeners.delete(event) }
      disposers.push(dispose)
      return dispose
    },
    waterfall: (_self: unknown, event: string, payload: GenerateOptions, next: () => unknown) => {
      const handler = listeners.get(event)
      return handler === undefined ? next() : handler(payload, next)
    },
    systemPrompt: {
      section: (section: { name: string; text?: () => string }) => {
        sectionNames.push(section.name)
        promptSection = section as { name: string; text: () => string }
        return () => undefined
      },
    },
    inject: (_servicesToInject: string[], callback: (sctx: Context) => void) => {
      callback(ctx as unknown as Context)
    },
    effect: (callback: () => unknown) => {
      const disposer = callback()
      const dispose = () => { if (typeof disposer === 'function') disposer() }
      disposers.push(dispose)
      return dispose
    },
  }
  // Attach store entries as context properties so injected service contexts
  // expose the same property API as the Harness runtime.
  for (const [name, service] of store) (ctx as Record<string, unknown>)[name] = service
  // `listener` must be a live binding: it is assigned by ctx.on when apply
  // runs, after this object is constructed, so a snapshot would stay undefined.
  return {
    ctx: ctx as unknown as Context,
    get listener() { return listener },
    sectionNames,
    searchProviders,
    fetchProviders,
    credentialResolve,
    credentialRead,
    settingsGet: fake.get,
    settingsMutate: fake.mutate,
    emitCredentialUpdate: key => { for (const handler of credentialListeners) handler(key) },
    credentialListenerCount: () => credentialListeners.size,
    dispose: () => { for (const dispose of disposers.splice(0).reverse()) dispose() },
    installedSettingsSections: fake.installedSections,
    settingsDocument,
    get promptSection() { return promptSection },
    triggerSettingsChange: (ns) => fake.triggerChange(ns),
    ...overrides,
  }
}

function request(overrides: Partial<GenerateOptions> = {}): GenerateOptions {
  return markAgentLoopRequest({
    provider: 'github-copilot',
    model: 'gpt-5.4',
    messages: [{ id: 'u1' as Message['id'], role: 'user', content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } }],
    ...overrides,
  })
}

async function drain(stream: AsyncIterable<StreamChunk> | undefined): Promise<StreamChunk[]> {
  if (stream === undefined) return []
  const chunks: StreamChunk[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

const credentialKey = 'llm-pi-ai/github-copilot'

/** Synthetic proof and search replies: never reaches provider transport. */
function searchFetch() {
  return vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { stream?: boolean }
    return body.stream === true
      ? new Response('event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":1,"output_tokens":1}}}\n\n')
      : new Response(JSON.stringify({ output: [{ type: 'web_search_call' }] }))
  })
}

function proofCount(fetchMock: ReturnType<typeof searchFetch>): number {
  return fetchMock.mock.calls.filter(([, init]) => String(init?.body).includes('Probe web search capability.')).length
}

async function search(runtime: FakeRuntime, surface: 'inline' | 'web'): Promise<unknown> {
  return surface === 'inline'
    ? drain(runtime.listener?.(request(), () => undefined) as AsyncIterable<StreamChunk> | undefined)
    : runtime.searchProviders[0]!.search({ query: 'news' })
}

// Inline failures become terminal chunks; ctx.web failures reject.
async function failedSearch(runtime: FakeRuntime, surface: 'inline' | 'web'): Promise<void> {
  if (surface === 'web') await expect(search(runtime, surface)).rejects.toMatchObject({ code: 'WEB_PROVIDER_UNAVAILABLE' })
  else await search(runtime, surface)
}

async function flushStartup(): Promise<void> {
  // Drain the synthetic startup reconciliation independently of event-handler
  // assertions; no timer or live provider call is involved.
  for (let index = 0; index < 30; index++) await Promise.resolve()
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe.each(['inline', 'web'] as const)('%s credential proof cache lifecycle', surface => {
  it('retries a cached missing-grant failure on a same-route credential event', async () => {
    const runtime = buildRuntime()
    const originalRead = runtime.credentialRead.getMockImplementation()!
    runtime.credentialRead.mockImplementation(async () => undefined)
    const fetchMock = searchFetch()
    vi.stubGlobal('fetch', fetchMock)
    apply(runtime.ctx, { ...config, probe: true })
    await failedSearch(runtime, surface)
    expect(fetchMock).not.toHaveBeenCalled()
    runtime.credentialRead.mockImplementation(originalRead)
    runtime.emitCredentialUpdate(credentialKey)
    expect(fetchMock).not.toHaveBeenCalled()
    await search(runtime, surface)
    expect(proofCount(fetchMock)).toBe(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('evicts a successful proof for revocation/account changes and coalesces event bursts', async () => {
    const runtime = buildRuntime()
    const fetchMock = searchFetch()
    vi.stubGlobal('fetch', fetchMock)
    apply(runtime.ctx, { ...config, probe: true })
    await search(runtime, surface)
    expect(proofCount(fetchMock)).toBe(1)
    await flushStartup()
    runtime.credentialRead.mockClear()
    runtime.settingsGet.mockClear()
    runtime.settingsMutate.mockClear()
    for (let index = 0; index < 20; index++) runtime.emitCredentialUpdate(credentialKey)
    expect(runtime.credentialRead).not.toHaveBeenCalled()
    expect(runtime.settingsGet).not.toHaveBeenCalled()
    expect(runtime.settingsMutate).not.toHaveBeenCalled()
    expect(proofCount(fetchMock)).toBe(1)
    if (surface === 'inline') expect(runtime.promptSection?.text()).toBe('')
    await Promise.all([search(runtime, surface), search(runtime, surface)])
    expect(proofCount(fetchMock)).toBe(2)
    runtime.credentialRead.mockImplementation(async () => undefined)
    runtime.emitCredentialUpdate(credentialKey)
    const priorCalls = fetchMock.mock.calls.length
    await failedSearch(runtime, surface)
    expect(fetchMock).toHaveBeenCalledTimes(priorCalls)
  })

  it('ignores unrelated record updates and retains the verified proof', async () => {
    const runtime = buildRuntime()
    const fetchMock = searchFetch()
    vi.stubGlobal('fetch', fetchMock)
    apply(runtime.ctx, { ...config, probe: true })
    await search(runtime, surface)
    runtime.emitCredentialUpdate('llm-pi-ai/other-provider')
    runtime.emitCredentialUpdate('other/github-copilot')
    await search(runtime, surface)
    expect(proofCount(fetchMock)).toBe(1)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('does not reuse an in-flight proof after a credential refresh or eagerly retry it', async () => {
    const runtime = buildRuntime()
    const fetchMock = searchFetch()
    let release!: (response: Response) => void
    fetchMock.mockImplementationOnce(async () => new Promise<Response>(resolve => { release = resolve }))
    vi.stubGlobal('fetch', fetchMock)
    apply(runtime.ctx, { ...config, probe: true })
    const first = failedSearch(runtime, surface)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    for (let index = 0; index < 10; index++) runtime.emitCredentialUpdate(credentialKey)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    release(new Response(JSON.stringify({ output: [{ type: 'web_search_call' }] })))
    await first
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(proofCount(fetchMock)).toBe(1)
    if (surface === 'inline') expect(runtime.promptSection?.text()).toBe('')
    await search(runtime, surface)
    expect(proofCount(fetchMock)).toBe(2)
  })

  it('fails closed on credential refresh within the current proof without a retry loop', async () => {
    const runtime = buildRuntime()
    const fetchMock = searchFetch()
    vi.stubGlobal('fetch', fetchMock)
    apply(runtime.ctx, { ...config, probe: true })
    await flushStartup()
    const originalRead = runtime.credentialRead.getMockImplementation()!
    runtime.credentialRead.mockImplementationOnce(async () => {
      runtime.emitCredentialUpdate(credentialKey)
      return originalRead()
    })
    await failedSearch(runtime, surface)
    expect(fetchMock).not.toHaveBeenCalled()
    await search(runtime, surface)
    expect(proofCount(fetchMock)).toBe(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not start late network work when disposed during credential resolution', async () => {
    const runtime = buildRuntime()
    const fetchMock = searchFetch()
    vi.stubGlobal('fetch', fetchMock)
    apply(runtime.ctx, { ...config, probe: true })
    await flushStartup()
    const originalRead = runtime.credentialRead.getMockImplementation()!
    let release!: (value: unknown) => void
    runtime.credentialRead.mockImplementationOnce(async () => new Promise(resolve => { release = resolve }))
    const first = failedSearch(runtime, surface)
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    runtime.dispose()
    release(await originalRead())
    await first
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each(['dispose', 'credential'] as const)('aborts a pending HTTP proof on %s without fallback or search fetches', async action => {
    const runtime = buildRuntime()
    const fetchMock = searchFetch()
    let release!: (response: Response) => void
    fetchMock.mockImplementationOnce(async () => new Promise<Response>(resolve => { release = resolve }))
    vi.stubGlobal('fetch', fetchMock)
    apply(runtime.ctx, { ...config, probe: true })
    const first = failedSearch(runtime, surface)
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    if (action === 'dispose') runtime.dispose()
    else runtime.emitCredentialUpdate(credentialKey)
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true)
    await first
    // Even a transport mock that ignores abort cannot start fallback rounds.
    release(new Response(JSON.stringify({ output: [] })))
    await flushStartup()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    if (action === 'credential') {
      await search(runtime, surface)
      expect(proofCount(fetchMock)).toBe(2)
    }
  })

  it('binds the fallback-spelling candidate to its original proof generation', async () => {
    const runtime = buildRuntime()
    const fetchMock = searchFetch()
    fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify({ output: [] })))
    vi.stubGlobal('fetch', fetchMock)
    apply(runtime.ctx, { ...config, probe: true })
    await search(runtime, surface)
    expect(proofCount(fetchMock)).toBe(2)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    runtime.emitCredentialUpdate(credentialKey)
    await search(runtime, surface)
    expect(proofCount(fetchMock)).toBe(3)
  })

  it('rejects account replacement during search auth after a successful proof', async () => {
    const runtime = buildRuntime()
    const fetchMock = searchFetch()
    vi.stubGlobal('fetch', fetchMock)
    apply(runtime.ctx, { ...config, probe: true })
    await search(runtime, surface)
    const originalRead = runtime.credentialRead.getMockImplementation()!
    runtime.credentialRead.mockImplementationOnce(async () => {
      runtime.emitCredentialUpdate(credentialKey)
      return originalRead()
    })
    const result = search(runtime, surface)
    if (surface === 'web') await expect(result).rejects.toBeDefined()
    else await result
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await search(runtime, surface)
    expect(proofCount(fetchMock)).toBe(2)
  })

  it('removes its Fiber listener and makes retained entry points inert on disposal', async () => {
    const runtime = buildRuntime()
    const fetchMock = searchFetch()
    vi.stubGlobal('fetch', fetchMock)
    apply(runtime.ctx, { ...config, probe: true })
    await search(runtime, surface)
    expect(runtime.credentialListenerCount()).toBe(1)
    runtime.dispose()
    expect(runtime.credentialListenerCount()).toBe(0)
    runtime.emitCredentialUpdate(credentialKey)
    const priorCalls = fetchMock.mock.calls.length
    await failedSearch(runtime, surface)
    expect(fetchMock).toHaveBeenCalledTimes(priorCalls)
    expect(runtime.promptSection?.text()).toBe('')
  })
})

describe('github-copilot apply', () => {
  it('rejects a trust-override stream consumed after its plan generation was invalidated', async () => {
    const runtime = buildRuntime()
    const fetchMock = searchFetch()
    vi.stubGlobal('fetch', fetchMock)
    apply(runtime.ctx, config)
    const stream = runtime.listener?.(request(), () => undefined) as AsyncIterable<StreamChunk>
    runtime.emitCredentialUpdate(credentialKey)
    await drain(stream)
    expect(fetchMock).not.toHaveBeenCalled()
    await search(runtime, 'inline')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('makes no network calls at attach, availability checks, settings or credential events', async () => {
    const runtime = buildRuntime()
    const fetchMock = searchFetch()
    vi.stubGlobal('fetch', fetchMock)
    apply(runtime.ctx, { ...config, probe: true })
    await flushStartup()
    expect(runtime.searchProviders[0]?.available()).toBe(true)
    runtime.triggerSettingsChange(GITHUB_COPILOT_SETTINGS_NAMESPACE)
    runtime.emitCredentialUpdate(credentialKey)
    expect(runtime.promptSection?.text()).toBe('')
    const next = vi.fn(() => undefined)
    runtime.listener?.(request({ purpose: 'compaction' }), next)
    runtime.listener?.(request({ model: 'claude-sonnet-4.5' }), next)
    await flushStartup()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(next).toHaveBeenCalledTimes(2)
  })

  it('uses the settings provider instance API when legacy helpers are absent', () => {
    const runtime = buildRuntime()
    apply(runtime.ctx, config)
    expect(runtime.installedSettingsSections).toEqual([GITHUB_COPILOT_SETTINGS_NAMESPACE])
  })

  it('registers an llm/stream listener and the prompt section', () => {
    const runtime = buildRuntime()
    apply(runtime.ctx, config)
    expect(runtime.listener).toBeTypeOf('function')
    expect(runtime.sectionNames).toContain('tool:github-copilot')
  })

  it('registers the github-copilot-hosted traditional search provider without a fetch provider', () => {
    const runtime = buildRuntime()
    apply(runtime.ctx, config)
    expect(runtime.searchProviders.map(provider => provider.id)).toEqual(['github-copilot-hosted'])
    expect(runtime.searchProviders[0]?.available()).toBe(true)
    expect(runtime.fetchProviders).toEqual([])
  })

  it('coexists with another traditional search provider without replacing it', () => {
    const runtime = buildRuntime()
    runtime.searchProviders.push({
      id: 'existing-search',
      available: () => true,
      search: async () => ({ sources: [], truncated: false }),
    })
    apply(runtime.ctx, config)
    expect(runtime.searchProviders.map(provider => provider.id)).toEqual(['existing-search', 'github-copilot-hosted'])
  })

  it('keeps traditional search unavailable when the current route is excluded', async () => {
    const runtime = buildRuntime()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    apply(runtime.ctx, { ...config, providers: ['other-route'] })
    const provider = runtime.searchProviders[0]

    expect(provider?.available()).toBe(false)
    await expect(provider?.search({ query: 'news' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_UNAVAILABLE' })
    expect(runtime.credentialResolve).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reflects a cached failed probe and becomes ready after probing is disabled', async () => {
    const runtime = buildRuntime()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ error: { message: 'unsupported' } }),
      { status: 400 },
    )))
    apply(runtime.ctx, { ...config, probe: true })
    const provider = runtime.searchProviders[0]

    expect(provider?.available()).toBe(true)
    await expect(provider?.search({ query: 'news' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_UNAVAILABLE' })
    expect(provider?.available()).toBe(false)

    runtime.settingsDocument[GITHUB_COPILOT_SETTINGS_NAMESPACE] = {
      probe: false,
    }
    runtime.triggerSettingsChange(GITHUB_COPILOT_SETTINGS_NAMESPACE)
    expect(provider?.available()).toBe(true)
  })

  it('short-circuits agent-loop requests on the whitelisted route', async () => {
    const runtime = buildRuntime()
    apply(runtime.ctx, config)
    const next = vi.fn(() => 'next-value')
    const stream = [
      'event: response.output_item.added\ndata: {"type":"response.output_item.added","output_index":0,"item":{"type":"message","id":"msg_1"}}\n\n',
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","output_index":0,"delta":"Node 22 is current"}\n\n',
      'event: response.output_item.done\ndata: {"type":"response.output_item.done","output_index":0,"item":{"type":"message","id":"msg_1","content":[{"type":"output_text","text":"Node 22 is current"}]}}\n\n',
      'event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}}\n\n',
    ].join('')
    const fetchMock = vi.fn(async (
      _input: string | URL | Request,
      _init?: RequestInit,
    ) => new Response(stream, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const result = runtime.listener?.(request(), next)
    expect(result).not.toBe('next-value')
    const chunks = await drain(result as AsyncIterable<StreamChunk>)
    expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'stop' } })
    expect(next).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      input: unknown[]
      tools: unknown[]
    }
    expect(body.input).toContainEqual({ role: 'user', content: [{ type: 'input_text', text: 'hi' }] })
    expect(body.tools).toContainEqual({ type: 'web_search' })
  })

  it('passes non-loop requests through to next()', () => {
    const runtime = buildRuntime()
    apply(runtime.ctx, config)
    const plain = { provider: 'p', model: 'm', messages: [] }
    const next = vi.fn(() => 'next-value')
    expect(runtime.listener?.(plain as GenerateOptions, next)).toBe('next-value')
    expect(next).toHaveBeenCalledTimes(1)
  })

  it('passes compaction and title requests through to next()', () => {
    const runtime = buildRuntime()
    apply(runtime.ctx, config)
    const next = vi.fn(() => 'next-value')
    expect(runtime.listener?.(request({ purpose: 'compaction' }), next)).toBe('next-value')
    expect(runtime.listener?.(request({ purpose: 'session-title' }), next)).toBe('next-value')
    expect(next).toHaveBeenCalledTimes(2)
  })

  it('preserves image attachments when bypassing the custom wire', () => {
    const runtime = buildRuntime()
    apply(runtime.ctx, config)
    const fetchMock = vi.fn(async () => { throw new Error('custom wire must not run') })
    vi.stubGlobal('fetch', fetchMock)
    const attachment = { id: 'attachment-1', name: 'diagram.png' } as never
    const withImage = request({
      messages: [{
        id: 'u1' as Message['id'],
        role: 'user',
        content: [
          { type: 'text', text: 'What is shown here?' },
          { type: 'image', attachment },
        ],
        source: { kind: 'user' },
      }],
    })
    const originalMessages = withImage.messages
    const next = vi.fn(() => {
      expect(withImage.messages).toBe(originalMessages)
      expect(withImage.messages[0]?.content[1]).toMatchObject({ type: 'image', attachment })
      return 'next-value'
    })
    expect(runtime.listener?.(withImage, next)).toBe('next-value')
    expect(next).toHaveBeenCalledTimes(1)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('preserves a top-level user file when bypassing the custom wire', () => {
    const runtime = buildRuntime()
    apply(runtime.ctx, config)
    const fetchMock = vi.fn(async () => { throw new Error('custom wire must not run') })
    vi.stubGlobal('fetch', fetchMock)
    const attachment = { attachmentId: 'attachment-2', name: 'notes.txt', bytes: 12 }
    const withFile = request({
      messages: [{
        id: 'u1' as Message['id'],
        role: 'user',
        content: [
          { type: 'text', text: 'Summarize this file.' },
          compatibilityFileBlock(attachment),
        ],
        source: { kind: 'user' },
      }],
    })
    const originalMessages = withFile.messages
    const next = vi.fn(() => {
      expect(withFile.messages).toBe(originalMessages)
      expect(withFile.messages[0]?.content[1]).toMatchObject({ type: 'file', attachment })
      return 'next-value'
    })
    expect(runtime.listener?.(withFile, next)).toBe('next-value')
    expect(next).toHaveBeenCalledTimes(1)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('preserves a file nested in tool-result content when bypassing the custom wire', () => {
    const runtime = buildRuntime()
    apply(runtime.ctx, config)
    const fetchMock = vi.fn(async () => { throw new Error('custom wire must not run') })
    vi.stubGlobal('fetch', fetchMock)
    const attachment = { attachmentId: 'attachment-3', name: 'report.pdf', bytes: 42 }
    const withNestedFile = request({
      messages: [{
        id: 'tool-result-1' as Message['id'],
        role: 'user',
        content: [{
          type: 'tool-result',
          toolCallId: 'call-1' as never,
          content: [
            { type: 'text', text: 'Generated report.' },
            compatibilityFileBlock(attachment),
          ],
          isError: false,
        }],
        source: { kind: 'tool', callId: 'call-1' as never },
      }],
    })
    const originalMessages = withNestedFile.messages
    const next = vi.fn(() => {
      expect(withNestedFile.messages).toBe(originalMessages)
      expect(withNestedFile.messages[0]?.content[0]).toMatchObject({
        type: 'tool-result',
        content: [{ type: 'text' }, { type: 'file', attachment }],
      })
      return 'next-value'
    })
    expect(runtime.listener?.(withNestedFile, next)).toBe('next-value')
    expect(next).toHaveBeenCalledTimes(1)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('honors the enabled switch', () => {
    const runtime = buildRuntime()
    apply(runtime.ctx, { ...config, enabled: false })
    const next = vi.fn(() => 'next-value')
    expect(runtime.listener?.(request(), next)).toBe('next-value')
  })

  it('honors the provider whitelist', () => {
    const runtime = buildRuntime()
    apply(runtime.ctx, { ...config, providers: ['other-route'] })
    const next = vi.fn(() => 'next-value')
    expect(runtime.listener?.(request(), next)).toBe('next-value')
  })

  it('never serves a whitelisted provider that is not the current chat route', async () => {
    const fetchMock = vi.fn(async () => { throw new Error('should never be called') })
    vi.stubGlobal('fetch', fetchMock)
    const runtime = buildRuntime()
    // The whitelist names both routes, but the plan can only ever derive from
    // the CURRENT chat route: a request from a non-current provider must not
    // be served with the current route's endpoint facts.
    apply(runtime.ctx, { ...config, providers: ['github-copilot', 'other-route'] })
    const next = vi.fn(() => 'next-value')
    expect(runtime.listener?.(request({ provider: 'other-route' }), next)).toBe('next-value')
    expect(next).toHaveBeenCalledTimes(1)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('preserves session model overrides on the same provider without custom wire calls', async () => {
    const runtime = buildRuntime()
    apply(runtime.ctx, config)
    const fetchMock = vi.fn(async () => { throw new Error('must preserve Core transport') })
    vi.stubGlobal('fetch', fetchMock)
    // The default is gpt-5.4. Neither another Responses model nor an Anthropic
    // model may be substituted with that default, even when requests overlap.
    const requests = [request({ model: 'gpt-5-mini' }), request({ model: 'claude-sonnet-4.5' })]
    const next = vi.fn(() => 'core-result')
    const results = await Promise.all(requests.map(async original => {
      const messages = original.messages
      const result = runtime.listener?.(original, next)
      expect(original.messages).toBe(messages)
      return result
    }))
    expect(results).toEqual(['core-result', 'core-result'])
    expect(requests.map(original => original.model)).toEqual(['gpt-5-mini', 'claude-sonnet-4.5'])
    expect(next).toHaveBeenCalledTimes(2)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('serves a whitelisted provider when it is the current chat route', async () => {
    const runtime = buildRuntime()
    apply(runtime.ctx, { ...config, providers: ['github-copilot'] })
    const next = vi.fn(() => 'next-value')
    const stream = [
      'event: response.output_item.added\ndata: {"type":"response.output_item.added","output_index":0,"item":{"type":"message","id":"msg_1"}}\n\n',
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","output_index":0,"delta":"Node 22 is current"}\n\n',
      'event: response.output_item.done\ndata: {"type":"response.output_item.done","output_index":0,"item":{"type":"message","id":"msg_1","content":[{"type":"output_text","text":"Node 22 is current"}]}}\n\n',
      'event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}}\n\n',
    ].join('')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(stream, { status: 200 })))
    const result = runtime.listener?.(request(), next)
    expect(result).not.toBe('next-value')
    const chunks = await drain(result as AsyncIterable<StreamChunk>)
    expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'stop' } })
    expect(next).not.toHaveBeenCalled()
  })

  it('never probes while the plugin is disabled', async () => {
    const fetchMock = vi.fn(async () => { throw new Error('should never be called') })
    vi.stubGlobal('fetch', fetchMock)
    const runtime = buildRuntime()
    apply(runtime.ctx, { ...config, enabled: false })
    const next = vi.fn(() => 'next-value')
    expect(runtime.listener?.(request(), next)).toBe('next-value')
    expect(next).toHaveBeenCalledTimes(1)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('defers the plan to the first request when the route is unsettled at attach', async () => {
    const fetchMock = vi.fn(async () => { throw new Error('should never be called') })
    vi.stubGlobal('fetch', fetchMock)
    // No default-model selection yet: the attach-time settings change cannot
    // resolve a route, so nothing is probed and the plan waits for a request.
    const runtime = buildRuntime({}, { current: null })
    apply(runtime.ctx, { ...config, probe: true })
    const next = vi.fn(() => 'next-value')
    expect(runtime.listener?.(request(), next)).toBe('next-value')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('never probes for requests outside the gate', async () => {
    const fetchMock = vi.fn(async () => { throw new Error('should never be called') })
    vi.stubGlobal('fetch', fetchMock)
    const runtime = buildRuntime()
    apply(runtime.ctx, config)
    const next = vi.fn(() => 'next-value')
    runtime.listener?.(request({ purpose: 'compaction' }), next)
    runtime.listener?.(request({ provider: 'unrelated-route' }), next)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps the prompt section empty while the plugin cannot serve', async () => {
    const runtime = buildRuntime()
    apply(runtime.ctx, { ...config, enabled: false })
    expect(runtime.promptSection?.text()).toBe('')
  })

  it('fills the prompt section once a plan can serve', async () => {
    const runtime = buildRuntime()
    apply(runtime.ctx, config)
    expect(runtime.promptSection?.text()).toBe('')
    runtime.listener?.(request(), () => undefined)
    expect(runtime.promptSection?.text()).toContain('web_search')
  })

  it('keeps the prompt section empty while the probe has not settled', async () => {
    const probingConfig: InlineConfig = { ...config, probe: true, probeTimeoutMs: 1000 }
    const runtime = buildRuntime()
    // The probe never settles: the plan stays in `probing`, and the model
    // must not be told web_search is available before the verdict is in.
    vi.stubGlobal('fetch', vi.fn(async () => new Promise(() => undefined)))
    apply(runtime.ctx, probingConfig)
    expect(runtime.promptSection?.text()).toBe('')
  })

  it('rebuilds the plan when the chat route changes and never serves a non-Copilot route', async () => {
    const selection: SelectionRef = { current: { provider: 'github-copilot', model: 'gpt-5.4' } }
    const runtime = buildRuntime({}, selection)
    apply(runtime.ctx, config)
    const next = vi.fn(() => 'next-value')
    const stream = [
      'event: response.output_item.added\ndata: {"type":"response.output_item.added","output_index":0,"item":{"type":"message","id":"msg_1"}}\n\n',
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","output_index":0,"delta":"Node 22 is current"}\n\n',
      'event: response.output_item.done\ndata: {"type":"response.output_item.done","output_index":0,"item":{"type":"message","id":"msg_1","content":[{"type":"output_text","text":"Node 22 is current"}]}}\n\n',
      'event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}}\n\n',
    ].join('')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(stream, { status: 200 })))
    // Route A speaks openai-responses: short-circuit.
    const first = runtime.listener?.(request(), next)
    expect(first).not.toBe('next-value')
    // Switch to a non-Copilot route: the plan is rebuilt with no candidates,
    // so the request passes through.
    selection.current = { provider: 'openai', model: 'gpt-5.4' }
    const second = runtime.listener?.(request({ provider: 'openai' }), next)
    expect(second).toBe('next-value')
    expect(next).toHaveBeenCalled()
  })

  it('invalidates settings without eager probing even when candidates are identical', async () => {
    const probingConfig: InlineConfig = { ...config, probe: true, probeTimeoutMs: 30_000 }
    // A spelling-independent 401 fails the probe with exactly one request per
    // plan build, keeping the call-count assertions meaningful under the
    // two-spelling probe fallback.
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'invalid api key' } }), { status: 401 }))
    vi.stubGlobal('fetch', fetchMock)
    const runtime = buildRuntime()
    apply(runtime.ctx, probingConfig)
    expect(fetchMock).not.toHaveBeenCalled()
    await drain(runtime.listener?.(request(), () => undefined) as AsyncIterable<StreamChunk>)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    runtime.settingsDocument[GITHUB_COPILOT_SETTINGS_NAMESPACE] = { idleTimeoutMs: 600_000 }
    runtime.triggerSettingsChange(GITHUB_COPILOT_SETTINGS_NAMESPACE)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await drain(runtime.listener?.(request(), () => undefined) as AsyncIterable<StreamChunk>)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('rebuilds the plan when the probe knobs change, recovering a failed plan', async () => {
    const probingConfig: InlineConfig = { ...config, probe: true, probeTimeoutMs: 30_000 }
    // A spelling-independent 401 fails the probe with exactly one request per
    // plan build, keeping the call-count assertions meaningful under the
    // two-spelling probe fallback.
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'invalid api key' } }), { status: 401 }))
    vi.stubGlobal('fetch', fetchMock)
    const runtime = buildRuntime()
    apply(runtime.ctx, probingConfig)
    await drain(runtime.listener?.(request(), () => undefined) as AsyncIterable<StreamChunk>)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    // The first plan failed (the endpoint never confirms search); raising the
    // probe bound must rebuild and re-probe even though the candidates are
    // the same.
    runtime.settingsDocument[GITHUB_COPILOT_SETTINGS_NAMESPACE] = { probeTimeoutMs: 60_000 }
    runtime.triggerSettingsChange(GITHUB_COPILOT_SETTINGS_NAMESPACE)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await drain(runtime.listener?.(request(), () => undefined) as AsyncIterable<StreamChunk>)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
