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
import { markAgentLoopRequest, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { agentEvents, installModelSelection } from '@deepseek-ai/dsh-agent'
import { createRequire } from 'node:module'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { WebFetchProvider, WebSearchProvider } from '@deepseek-ai/dsh-web'
import { GITHUB_COPILOT_PREVIEW_MODEL_ID, GITHUB_COPILOT_PREVIEW_PROVIDER_ID } from '../../src/copilot-identity.ts'

vi.mock('@deepseek-ai/dsh-settings', () => ({ installSettingsSection: undefined }))

interface FakeRuntime {
  ctx: Context
  listener: ((request: GenerateOptions, next: () => unknown) => unknown) | undefined
  sectionNames: string[]
  settingsDocument: Record<string, unknown>
  /** The registered prompt section object (name + dynamic text provider). */
  promptSection: { name: string; text: () => string } | undefined
  promptText(variables: Record<string, string | undefined>): Promise<string>
  searchProviders: WebSearchProvider[]
  fetchProviders: WebFetchProvider[]
  credentialResolve: ReturnType<typeof vi.fn>
  credentialRead: ReturnType<typeof vi.fn>
  settingsGet: ReturnType<typeof vi.fn>
  settingsMutate: ReturnType<typeof vi.fn>
  emitCredentialUpdate(key: string): void
  emitAgentDisposed(agent: Agent): void
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

/** Mutable synthetic Agent selection; `current: null` means no initiator. */
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
  mountedPreview?: unknown,
  registry?: unknown,
  assemblyEvents?: Context,
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
  const initiatingAgent = { session: { requestHeader: () => selectionRef.current === null ? undefined : { config: selectionRef.current }, append: vi.fn() } }
  const store = new Map<string, unknown>([
    ['agents', registry ?? { currentInitiator: () => selectionRef.current === null ? undefined : initiatingAgent }],
    ['settings', fake.settings],
    ['githubCopilotPreview', mountedPreview],
    // Keep the legacy global service present, but search must not consult it.
    // Tests supplying a real registry give this default an unrelated C route.
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
    provide: (name: string, value: unknown) => {
      if (store.has(name)) throw new Error(`duplicate synthetic service: ${name}`)
      store.set(name, value)
      const dispose = () => { store.delete(name) }
      disposers.push(dispose)
      return dispose
    },
    // The settings seam reads `ctx.fiber.state` to skip change callbacks
    // while a fiber is unloading; a live fiber is what this fake is.
    fiber: { state: 1 },
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
    plugin: () => undefined,
    on: (event: string, handler: (request: GenerateOptions, next: () => unknown) => unknown, options?: { prepend?: boolean }) => {
      if (event === 'system-prompt/assemble' && assemblyEvents !== undefined) {
        return assemblyEvents.on(event, (assembly, context, next) => {
          const invoke = handler as unknown as (input: typeof assembly, metadata: object, delegate: typeof next) => Promise<typeof assembly>
          return invoke(assembly, context, next)
        }, options)
      }
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
    emitAgentDisposed: agent => {
      const handler = listeners.get('agent/disposed') as unknown as ((payload: { agent: Agent }) => void) | undefined
      handler?.({ agent })
    },
    credentialListenerCount: () => credentialListeners.size,
    dispose: () => { for (const dispose of disposers.splice(0).reverse()) dispose() },
    installedSettingsSections: fake.installedSections,
    settingsDocument,
    get promptSection() { return promptSection },
    promptText: async variables => {
      const assembly = { sections: [{ name: 'tool:github-copilot', text: '' }], contexts: [], tools: [], variables }
      const handler = listeners.get('system-prompt/assemble') as unknown as
        (input: typeof assembly, context: object, next: () => Promise<typeof assembly>) => Promise<typeof assembly>
      return (await handler(assembly, {}, async () => assembly)).sections[0]?.text ?? ''
    },
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

function testAgent(headerConfig: Agent['options']): Agent {
  // Synthetic mutable header source for lifecycle tests; the real selection
  // waterfall and detached Session fold are exercised separately below.
  return { options: headerConfig, session: { requestHeader: () => ({ config: headerConfig }) } } as Agent
}

describe.skipIf(typeof AgentRegistry.prototype.withInitiator !== 'function')('real initiating Agent search isolation', () => {
  it.each([
    ['inline', 'headers'], ['inline', 'body'], ['web', 'headers'], ['web', 'body'],
  ] as const)('disposes only A during final %s HTTP %s while B completes without cross-cancellation', async (surface, phase) => {
    const root = new Context()
    const fiber = await root.plugin(AgentRegistry)
    const agents = root.agents
    const a = testAgent({ provider: 'github-copilot', model: 'gpt-5.4' })
    const b = testAgent({ provider: 'github-copilot', model: 'gpt-5.6-sol' })
    const runtime = buildRuntime({}, undefined, {}, undefined, agents)
    runtime.credentialRead.mockImplementation(async () => ({ kind: 'grant', payload: {
      type: 'oauth', refresh: 'synthetic-refresh', access: 'synthetic-access',
      expires: Date.now() + 86_400_000, availableModelIds: ['gpt-5.4', 'gpt-5.6-sol'],
    } }))
    const releases = new Map<string, () => void>()
    const signals = new Map<string, AbortSignal>()
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      if (String(init?.body).includes('Probe web search capability.')) {
        return new Response(JSON.stringify({ output: [{ type: 'web_search_call' }] }))
      }
      const model = (JSON.parse(String(init?.body)) as { model: string }).model
      const signal = init?.signal as AbortSignal
      signals.set(model, signal)
      const output = surface === 'web'
        ? JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: model }] }] })
        : [
          { type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'm' } },
          { type: 'response.output_text.delta', output_index: 0, delta: model },
          { type: 'response.completed', response: { status: 'completed' } },
        ].map(event => `data: ${JSON.stringify(event)}\n\n`).join('')
      if (phase === 'headers') return new Promise<Response>((resolve, reject) => {
        const onAbort = () => reject(new DOMException('aborted', 'AbortError'))
        signal.addEventListener('abort', onAbort, { once: true })
        releases.set(model, () => {
          signal.removeEventListener('abort', onAbort)
          resolve(new Response(output))
        })
      })
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          const onAbort = () => controller.error(new DOMException('aborted', 'AbortError'))
          signal.addEventListener('abort', onAbort, { once: true })
          releases.set(model, () => {
            signal.removeEventListener('abort', onAbort)
            controller.enqueue(new TextEncoder().encode(output))
            controller.close()
          })
        },
      }))
    })
    vi.stubGlobal('fetch', fetchMock)
    apply(runtime.ctx, { ...config, probe: true })
    await flushStartup()
    const run = (agent: Agent) => agents.withInitiator(agent, () => surface === 'web'
      ? runtime.searchProviders[0]!.search({ query: 'news' })
      : drain(runtime.listener?.(request({ model: agent.options.model }), () => undefined) as AsyncIterable<StreamChunk>))
    try {
      const pendingA = run(a)
      const failureA = surface === 'web' ? expect(pendingA).rejects.toMatchObject({ code: 'WEB_PROVIDER_UNAVAILABLE' }) : undefined
      const pendingB = run(b)
      await vi.waitFor(() => expect(releases.size).toBe(2))
      // Both capability probes have completed; these are the actual search HTTP calls.
      expect(fetchMock).toHaveBeenCalledTimes(4)
      runtime.emitAgentDisposed(a)
      expect(signals.get('gpt-5.4')?.aborted).toBe(true)
      expect(signals.get('gpt-5.6-sol')?.aborted).toBe(false)
      if (failureA !== undefined) await failureA
      else {
        const chunks = await pendingA as StreamChunk[]
        expect(chunks.some(chunk => chunk.type === 'text-delta' || chunk.type === 'reasoning-delta')).toBe(false)
        expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'aborted' } })
      }
      releases.get('gpt-5.6-sol')!()
      const resultB = await pendingB
      if (surface === 'web') expect(resultB).toMatchObject({ content: 'gpt-5.6-sol' })
      else expect(resultB).toContainEqual(expect.objectContaining({ type: 'text-delta', text: 'gpt-5.6-sol' }))
      expect(fetchMock).toHaveBeenCalledTimes(4)
    } finally { runtime.dispose(); await fiber.dispose() }
  })

  it.each(['before', 'after'] as const)('suppresses stale prompt guidance when model-selection mounts %s the plugin', async order => {
    const root = new Context()
    const fiber = await root.plugin(AgentRegistry)
    const agents = root.agents
    const owner = testAgent({ provider: 'github-copilot', model: 'gpt-5.4' })
    const events = new Context()
    const selection = { current: { provider: 'other-provider', model: 'pending-B' }, assembled: undefined }
    let disposeSelection: () => void = () => undefined
    if (order === 'before') disposeSelection = installModelSelection(events, selection)
    const runtime = buildRuntime({}, undefined, {}, undefined, agents, events)
    const fetchMock = searchFetch()
    vi.stubGlobal('fetch', fetchMock)
    apply(runtime.ctx, { ...config, probe: true })
    if (order === 'after') disposeSelection = installModelSelection(events, selection)
    const assemble = () => agents.withInitiator(owner, async () => {
      const input = { sections: [{ name: 'tool:github-copilot', text: '' }], contexts: [], tools: [],
        variables: { provider: 'github-copilot', model: 'gpt-5.4' } }
      return events.waterfall('system-prompt/assemble', input, {}, async () => input)
    })
    try {
      await agents.withInitiator(owner, () => search(runtime, 'inline'))
      const pending = await assemble()
      expect(pending.variables).toMatchObject({ provider: 'other-provider', model: 'pending-B' })
      expect(pending.sections[0]?.text).toBe('')
      selection.current = { provider: 'github-copilot', model: 'gpt-5.4' }
      expect((await assemble()).sections[0]?.text).toContain('web_search')
    } finally { runtime.dispose(); disposeSelection(); await events.fiber.dispose(); await fiber.dispose() }
  })

  it('routes concurrent hosted tools from real model-selection request headers rather than activation seeds', async () => {
    const root = new Context()
    const fiber = await root.plugin(AgentRegistry)
    const agents = root.agents
    const requireAgent = createRequire(createRequire(import.meta.url).resolve('@deepseek-ai/dsh-agent'))
    const { Session } = requireAgent('@deepseek-ai/dsh-session') as { Session: { create(id: Agent['id']): Agent['session'] } }
    const seed = { provider: 'activation-C', model: 'seed-C' }
    const a = { options: seed, session: Session.create('search-header-A' as Agent['id']) } as Agent
    const b = { options: seed, session: Session.create('search-header-B' as Agent['id']) } as Agent
    const aCtx = new Context(), bCtx = new Context()
    const selectionA = { current: { provider: 'github-copilot', model: 'gpt-5.4' }, assembled: undefined }
    const selectionB = { current: { provider: GITHUB_COPILOT_PREVIEW_PROVIDER_ID, model: 'future-B' }, assembled: undefined }
    const disposeA = installModelSelection(aCtx, selectionA), disposeB = installModelSelection(bCtx, selectionB)
    const baseURL = 'https://api.business.githubcopilot.com'
    const runtime = buildRuntime({}, { current: { provider: 'other-C', model: 'global-C' } }, {}, {
      getView: () => ({ provider: GITHUB_COPILOT_PREVIEW_PROVIDER_ID, configured: true }),
      routeFacts: () => ({ api: 'openai-responses', baseURL }),
      discover: async () => undefined,
      resolveRequestAuth: async () => ({ apiKey: 'synthetic-B', baseURL }),
    }, agents)
    const fetchMock = searchFetch()
    vi.stubGlobal('fetch', fetchMock)
    apply(runtime.ctx, { ...config, probe: true })
    const run = (owner: Agent, ownerCtx: Context) => agents.withInitiator(owner, async () => {
      const assembly = { sections: [], contexts: [], tools: [], variables: {} }
      await ownerCtx.waterfall('system-prompt/assemble', assembly, {}, async () => assembly)
      const selected = await agentEvents(ownerCtx, owner).waterfall('agent/request',
        { turn: 1, step: 0, signal: new AbortController().signal }, async () => seed)
      owner.session.append('request/header', { header: { config: selected }, reason: 'initial' })
      return search(runtime, 'web')
    })
    try {
      expect(agents.withInitiator(a, () => runtime.searchProviders[0]?.available())).toBe(false)
      await Promise.all([run(a, aCtx), run(b, bCtx)])
      expect(a.options).toBe(seed)
      expect(b.options).toBe(seed)
      expect(fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)).model).sort())
        .toEqual(['future-B', 'future-B', 'gpt-5.4', 'gpt-5.4'])
      expect(proofCount(fetchMock)).toBe(2)
      selectionA.current = { provider: 'github-copilot', model: 'gpt-4.1' }
      // Pending selection leaves the current tool-request route intact.
      await agents.withInitiator(a, () => search(runtime, 'web'))
      expect(proofCount(fetchMock)).toBe(2)
      await expect(run(a, aCtx)).rejects.toMatchObject({ code: 'WEB_PROVIDER_UNAVAILABLE' })
    } finally {
      runtime.dispose(); disposeA(); disposeB()
      await aCtx.fiber.dispose(); await bCtx.fiber.dispose(); await fiber.dispose()
    }
  })

  it('keeps concurrent A/B routes and proofs separate from global C and later selections', async () => {
    const root = new Context()
    const fiber = await root.plugin(AgentRegistry)
    const agents = root.agents
    const a = testAgent({ provider: 'github-copilot', model: 'gpt-5.4' })
    const b = testAgent({ provider: GITHUB_COPILOT_PREVIEW_PROVIDER_ID, model: 'future-B' })
    const global: SelectionRef = { current: { provider: 'other-C', model: 'global-C' } }
    const baseURL = 'https://api.business.githubcopilot.com'
    const discover = vi.fn(async (_options?: { force?: boolean; signal?: AbortSignal }) => undefined)
    const resolveRequestAuth = vi.fn(async (_model: string, _signal?: AbortSignal) => ({ apiKey: 'synthetic-B', baseURL }))
    const runtime = buildRuntime({}, global, {}, {
      getView: () => ({ provider: GITHUB_COPILOT_PREVIEW_PROVIDER_ID, configured: true }),
      routeFacts: () => ({ api: 'openai-responses', baseURL }), discover, resolveRequestAuth,
    }, agents)
    const fetchMock = searchFetch()
    const release: (() => void)[] = []
    const normal = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (url, init) => {
      if (String(init?.body).includes('Probe web search capability.') && release.length < 2) {
        await new Promise<void>(resolve => { release.push(resolve) })
      }
      return normal(url, init)
    })
    vi.stubGlobal('fetch', fetchMock)
    apply(runtime.ctx, { ...config, probe: true })
    await flushStartup()
    const run = (agent: Agent) => agents.withInitiator(agent, () => search(runtime, 'web'))
    try {
      expect(runtime.searchProviders[0]?.available()).toBe(false)
      const pending = [run(a), run(b)]
      await vi.waitFor(() => expect(release).toHaveLength(2))
      a.options.model = 'gpt-4.1'
      global.current = { provider: 'other-D', model: 'global-D' }
      expect(agents.withInitiator(a, () => runtime.searchProviders[0]?.available())).toBe(false)
      expect(agents.withInitiator(b, () => runtime.searchProviders[0]?.available())).toBe(true)
      for (const [, init] of fetchMock.mock.calls) expect(init?.signal?.aborted).toBe(false)
      release.forEach(resolve => resolve())
      await Promise.all(pending)
      expect(proofCount(fetchMock)).toBe(2)
      expect(fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)).model).sort())
        .toEqual(['future-B', 'future-B', 'gpt-5.4', 'gpt-5.4'])
      await run(b)
      expect(proofCount(fetchMock)).toBe(2)
      // A new owner with B's exact selection cannot reuse B's successful plan.
      const anotherB = testAgent({ ...b.options })
      await run(anotherB)
      expect(proofCount(fetchMock)).toBe(3)
      b.options.model = 'future-B2'
      await run(b)
      expect(proofCount(fetchMock)).toBe(4)
      b.options.model = 'future-B'
      await run(b)
      expect(proofCount(fetchMock)).toBe(5)
      expect(resolveRequestAuth.mock.calls.every(call => String(call[0]).startsWith('future-B'))).toBe(true)
      expect(discover.mock.calls.every(call => (call[0] as { force: boolean }).force === false)).toBe(true)
    } finally {
      release.forEach(resolve => resolve())
      runtime.dispose()
      await fiber.dispose()
    }
  })

  it('disposes only A probes, rejects retained A entry points and never revives plans for a replacement Agent', async () => {
    const root = new Context()
    const fiber = await root.plugin(AgentRegistry)
    const agents = root.agents
    const a = testAgent({ provider: 'github-copilot', model: 'gpt-5.4' })
    const b = testAgent({ provider: 'github-copilot', model: 'gpt-5.4' })
    const runtime = buildRuntime({}, undefined, {}, undefined, agents)
    const fetchMock = searchFetch()
    const normal = fetchMock.getMockImplementation()!
    const release: (() => void)[] = []
    fetchMock.mockImplementation(async (url, init) => {
      if (String(init?.body).includes('Probe web search capability.') && release.length < 2) {
        await new Promise<void>(resolve => { release.push(resolve) })
      }
      return normal(url, init)
    })
    vi.stubGlobal('fetch', fetchMock)
    apply(runtime.ctx, { ...config, probe: true })
    const run = (agent: Agent) => agents.withInitiator(agent, () => search(runtime, 'web'))
    try {
      const pendingA = expect(run(a)).rejects.toMatchObject({ code: 'WEB_PROVIDER_UNAVAILABLE' })
      const pendingB = run(b)
      await vi.waitFor(() => expect(release).toHaveLength(2))
      runtime.emitAgentDisposed(a)
      expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true)
      expect(fetchMock.mock.calls[1]?.[1]?.signal?.aborted).toBe(false)
      await pendingA
      release.forEach(resolve => resolve())
      await pendingB
      const before = fetchMock.mock.calls.length
      await expect(run(a)).rejects.toMatchObject({ code: 'WEB_PROVIDER_UNAVAILABLE' })
      expect(agents.withInitiator(a, () => runtime.promptSection?.text())).toBe('')
      expect(fetchMock).toHaveBeenCalledTimes(before)
      await run(b)
      expect(proofCount(fetchMock)).toBe(2)
      await run(testAgent({ ...a.options }))
      expect(proofCount(fetchMock)).toBe(3)
    } finally {
      release.forEach(resolve => resolve())
      runtime.dispose()
      await fiber.dispose()
    }
  })

  it('isolates inline prompts and enforces whitelist per caller rather than global defaults', async () => {
    const root = new Context()
    const fiber = await root.plugin(AgentRegistry)
    const agents = root.agents
    const a = testAgent({ provider: 'github-copilot', model: 'gpt-5.4' })
    const b = testAgent({ provider: 'other-provider', model: 'other-model' })
    const runtime = buildRuntime({}, { current: { provider: 'other-C', model: 'C' } }, {}, undefined, agents)
    const fetchMock = searchFetch()
    vi.stubGlobal('fetch', fetchMock)
    apply(runtime.ctx, { ...config, probe: true, providers: ['github-copilot'] })
    try {
      await agents.withInitiator(a, () => search(runtime, 'inline'))
      expect(await agents.withInitiator(a, () => runtime.promptText(a.options as Record<string, string>))).toContain('web_search')
      expect(await agents.withInitiator(b, () => runtime.promptText(b.options as Record<string, string>))).toBe('')
      // Header A still records Copilot, but a newly assembled pending B route
      // cannot inherit A's old successful proof or its guidance.
      expect(await agents.withInitiator(a, () => runtime.promptText(b.options as Record<string, string>))).toBe('')
      expect(await agents.withInitiator(a, () => runtime.promptText({}))).toBe('')
      expect(agents.withInitiator(b, () => runtime.searchProviders[0]?.available())).toBe(false)
      expect(runtime.promptSection?.text()).toBe('')
      const before = fetchMock.mock.calls.length
      await expect(agents.withInitiator(b, () => search(runtime, 'web'))).rejects.toMatchObject({ code: 'WEB_PROVIDER_UNAVAILABLE' })
      expect(fetchMock).toHaveBeenCalledTimes(before)
      runtime.emitAgentDisposed(a)
      expect(agents.withInitiator(a, () => runtime.promptSection?.text())).toBe('')
    } finally { runtime.dispose(); await fiber.dispose() }
  })
})

describe('managed search metadata entry', () => {
  it('ensures cold metadata only on actual search and captures selection before discovery awaits', async () => {
    const selection: SelectionRef = { current: { provider: GITHUB_COPILOT_PREVIEW_PROVIDER_ID, model: 'cold-A' } }
    const baseURL = 'https://api.business.githubcopilot.com'
    let fresh = false
    let release!: () => void
    const discover = vi.fn(async () => { await new Promise<void>(resolve => { release = resolve }); fresh = true })
    const resolveRequestAuth = vi.fn(async () => ({ apiKey: 'synthetic', baseURL }))
    const runtime = buildRuntime({}, selection, {}, {
      getView: () => ({ provider: GITHUB_COPILOT_PREVIEW_PROVIDER_ID, configured: true }),
      routeFacts: () => fresh ? { api: 'openai-responses', baseURL } : undefined,
      discover, resolveRequestAuth,
    })
    const fetchMock = searchFetch()
    vi.stubGlobal('fetch', fetchMock)
    apply(runtime.ctx, { ...config, probe: true })
    await flushStartup()
    expect(runtime.searchProviders[0]?.available()).toBe(true)
    expect(discover).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    const pending = search(runtime, 'web')
    expect(discover).toHaveBeenCalledWith({ force: false, signal: expect.any(AbortSignal) })
    selection.current = { provider: 'other-provider', model: 'later-B' }
    release()
    await pending
    expect(proofCount(fetchMock)).toBe(1)
    for (const [, init] of fetchMock.mock.calls) expect(JSON.parse(String(init?.body)).model).toBe('cold-A')
    runtime.dispose()
  })

  it.each(['openai-completions', 'anthropic-messages'])('never guesses Responses when refreshed model uses %s', async api => {
    const baseURL = 'https://api.business.githubcopilot.com'
    let fresh = false
    const runtime = buildRuntime({}, { current: { provider: GITHUB_COPILOT_PREVIEW_PROVIDER_ID, model: 'cold-model' } }, {}, {
      getView: () => ({ provider: GITHUB_COPILOT_PREVIEW_PROVIDER_ID, configured: true }),
      routeFacts: () => fresh ? { api, baseURL } : undefined,
      discover: async () => { fresh = true },
      resolveRequestAuth: vi.fn(),
    })
    const fetchMock = searchFetch()
    vi.stubGlobal('fetch', fetchMock)
    apply(runtime.ctx, { ...config, probe: true })
    await expect(search(runtime, 'web')).rejects.toMatchObject({ code: 'WEB_PROVIDER_UNAVAILABLE' })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(runtime.searchProviders[0]?.available()).toBe(false)
    runtime.dispose()
  })

  it.each(['dispose', 'credential', 'caller'] as const)('does not start late probes after %s invalidates pending metadata discovery', async action => {
    const baseURL = 'https://api.business.githubcopilot.com'
    let fresh = false
    let release!: () => void
    let discoverySignal: AbortSignal | undefined
    const runtime = buildRuntime({}, { current: { provider: GITHUB_COPILOT_PREVIEW_PROVIDER_ID, model: 'cold-A' } }, {}, {
      getView: () => ({ provider: GITHUB_COPILOT_PREVIEW_PROVIDER_ID, configured: true }),
      routeFacts: () => fresh ? { api: 'openai-responses', baseURL } : undefined,
      discover: async (options: { signal?: AbortSignal }) => {
        discoverySignal = options.signal
        await new Promise<void>(resolve => { release = resolve })
        fresh = true
      },
      resolveRequestAuth: vi.fn(async () => ({ apiKey: 'synthetic', baseURL })),
    })
    const fetchMock = searchFetch()
    vi.stubGlobal('fetch', fetchMock)
    apply(runtime.ctx, { ...config, probe: true })
    const controller = new AbortController()
    const pending = runtime.searchProviders[0]!.search({ query: 'news' }, controller.signal)
    const failed = expect(pending).rejects.toMatchObject({ code: action === 'caller' ? 'WEB_ABORTED' : 'WEB_PROVIDER_UNAVAILABLE' })
    if (action === 'dispose') runtime.dispose()
    else if (action === 'credential') runtime.emitCredentialUpdate(credentialKey)
    else controller.abort()
    expect(discoverySignal?.aborted).toBe(true)
    release()
    await failed
    await flushStartup()
    expect(fetchMock).not.toHaveBeenCalled()
    runtime.dispose()
  })

  it('fails safely when older Core lacks the public initiator capability', async () => {
    const runtime = buildRuntime({}, undefined, {}, undefined, {})
    const fetchMock = searchFetch()
    vi.stubGlobal('fetch', fetchMock)
    apply(runtime.ctx, { ...config, probe: true })
    expect(runtime.searchProviders[0]?.available()).toBe(false)
    await expect(search(runtime, 'web')).rejects.toThrow('agents.currentInitiator()')
    expect(fetchMock).not.toHaveBeenCalled()
    await search(runtime, 'inline')
    expect(proofCount(fetchMock)).toBe(1)
    runtime.dispose()
  })
})

describe('Responses reasoning composition', () => {
  it('keeps preview conversations on their registered native adapter before any probe', () => {
    const runtime = buildRuntime({}, { current: { provider: GITHUB_COPILOT_PREVIEW_PROVIDER_ID, model: GITHUB_COPILOT_PREVIEW_MODEL_ID } }, {},
      { getView: () => ({ provider: GITHUB_COPILOT_PREVIEW_PROVIDER_ID }) })
    apply(runtime.ctx, config)
    const fetchMock = vi.fn(async () => { throw new Error('custom wire must not run') })
    vi.stubGlobal('fetch', fetchMock)
    const next = vi.fn(() => 'registered-preview-adapter')
    const prepared = request({ provider: GITHUB_COPILOT_PREVIEW_PROVIDER_ID, model: GITHUB_COPILOT_PREVIEW_MODEL_ID })
    expect(runtime.listener?.(prepared, next)).toBe('registered-preview-adapter')
    expect(next).toHaveBeenCalledTimes(1)
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('delegates native effort selection to Core when its catalog service is absent', () => {
    const runtime = buildRuntime()
    apply(runtime.ctx, config)
    const fetchMock = vi.fn(async () => { throw new Error('no probe or custom model request') })
    vi.stubGlobal('fetch', fetchMock)
    const next = vi.fn(() => 'native-effort')
    expect(runtime.listener?.(request({ reasoningEffort: ReasoningEffortId('high') }), next)).toBe('native-effort')
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('transmits the selected effort and preserves the returned public summary', async () => {
    const runtime = buildRuntime({}, undefined, {
      'llm-pi-ai': { providers: { 'github-copilot': { reasoning: 'low', models: [
        { id: 'gpt-5.4', api: 'openai-responses', reasoningEfforts: { low: 'low', high: 'high' } },
      ] } } },
    })
    const events = [
      { type: 'response.output_item.added', output_index: 0, item: { type: 'reasoning', id: 'rs_synthetic' } },
      { type: 'response.reasoning_summary_text.delta', output_index: 0, summary_index: 0, delta: 'Synthetic public summary.' },
      { type: 'response.output_item.done', output_index: 0, item: { type: 'reasoning', id: 'rs_synthetic', summary: [{ type: 'summary_text', text: 'Synthetic public summary.' }] } },
      { type: 'response.output_item.added', output_index: 1, item: { type: 'message', id: 'msg_synthetic' } },
      { type: 'response.output_text.delta', output_index: 1, delta: 'Synthetic answer.' },
      { type: 'response.completed', response: { status: 'completed' } },
    ]
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body)).reasoning).toEqual({ effort: 'high', summary: 'auto' })
      return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''))
    })
    vi.stubGlobal('fetch', fetchMock)
    apply(runtime.ctx, config)
    await flushStartup()
    const chunks = await drain(runtime.listener?.(request({ reasoningEffort: ReasoningEffortId('high') }), () => undefined) as AsyncIterable<StreamChunk>)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(chunks).toContainEqual(expect.objectContaining({ type: 'reasoning-delta', text: 'Synthetic public summary.' }))
    expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'stop' } })
  })
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

describe('session search router Host integration', () => {
  it('requires user-facing fallback disclosure only for routed Copilot prompt assemblies', async () => {
    const runtime = buildRuntime()
    runtime.ctx.provide('githubCopilotOriginalWeb', {})
    apply(runtime.ctx, config)
    const text = await runtime.promptText({ provider: 'github-copilot', model: 'gpt-5.4' })
    expect(text).toContain('explicitly tell the user the actual search backend')
    expect(text).toContain('does not need per-search confirmation')
    expect(text).not.toContain('runs natively on the model provider')
    expect(await runtime.promptText({ provider: 'deepseek-official', model: 'deepseek-v4-flash' })).toBe('')
    expect(await runtime.promptText({ provider: 'another-provider', model: 'any' })).toBe('')
  })

  it('does not advertise paid fallback when the user disabled it', async () => {
    const runtime = buildRuntime()
    runtime.ctx.provide('githubCopilotOriginalWeb', {})
    apply(runtime.ctx, { ...config, searchFallback: 'none' })
    const text = await runtime.promptText({ provider: 'github-copilot', model: 'gpt-5.4' })
    expect(text).toContain('fallback is disabled')
    expect(text).not.toContain('does not need per-search confirmation')
  })

  it.each(['deepseek-official', 'another-provider'])('delegates %s without any hosted-search request', async provider => {
    const runtime = buildRuntime({}, { current: { provider, model: 'selected' } })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    apply(runtime.ctx, config)
    const expected = { sources: [], truncated: false }
    const delegate = vi.fn(async () => expected)
    const query = { query: 'native', maxResults: 2 }
    const signal = new AbortController().signal
    const result = await runtime.ctx.get('githubCopilotSearchRouter')!.search(query, signal, delegate)
    expect(result).toBe(expected)
    expect(delegate).toHaveBeenCalledExactlyOnceWith(query, signal)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(runtime.credentialResolve).not.toHaveBeenCalled()
  })

  it('keeps allowlist-excluded Copilot sessions on the existing path without fallback spending', async () => {
    const runtime = buildRuntime()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    apply(runtime.ctx, { ...config, providers: ['another-provider'], searchFallback: 'deepseek' })
    const expected = { sources: [], truncated: false }
    const delegate = vi.fn(async () => expected)
    expect(await runtime.ctx.get('githubCopilotSearchRouter')!.search({ query: 'excluded route' }, undefined, delegate)).toBe(expected)
    expect(delegate).toHaveBeenCalledOnce()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(runtime.credentialResolve).not.toHaveBeenCalled()
  })

  it('uses the managed model primary path without spending DeepSeek fallback tokens', async () => {
    const baseURL = 'https://api.business.githubcopilot.com'
    const resolveRequestAuth = vi.fn(async () => ({ apiKey: 'synthetic-managed', baseURL }))
    const runtime = buildRuntime({}, { current: { provider: GITHUB_COPILOT_PREVIEW_PROVIDER_ID, model: 'account-model' } }, {}, {
      getView: () => ({ provider: GITHUB_COPILOT_PREVIEW_PROVIDER_ID }),
      routeFacts: () => ({ api: 'openai-responses', baseURL }), resolveRequestAuth,
      discover: vi.fn(async () => undefined),
    })
    const fetchMock = vi.fn(async (_input: unknown, _init?: RequestInit) => new Response(JSON.stringify({ output: [
      { type: 'web_search_call' },
      { type: 'message', content: [{ type: 'output_text', text: 'Copilot search response' }] },
    ] })))
    vi.stubGlobal('fetch', fetchMock)
    apply(runtime.ctx, config)
    const delegate = vi.fn()
    const result = await runtime.ctx.get('githubCopilotSearchRouter')!.search({ query: 'primary' }, undefined, delegate)
    expect(result.content).toContain('Copilot search response')
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${baseURL}/responses`)
    expect(resolveRequestAuth).toHaveBeenCalledWith('account-model', expect.any(AbortSignal))
    expect(runtime.credentialResolve).not.toHaveBeenCalled()
    expect(delegate).not.toHaveBeenCalled()
  })

  it('automatically discloses native DeepSeek fallback for an unsupported managed search protocol', async () => {
    const runtime = buildRuntime({}, { current: { provider: GITHUB_COPILOT_PREVIEW_PROVIDER_ID, model: 'chat-only' } }, {
      'web-search-deepseek': { baseURL: 'https://deepseek-search.test/v1', model: 'synthetic-search-model', apiKeyEnv: 'SYNTHETIC_KEY' },
    }, {
      getView: () => ({ provider: GITHUB_COPILOT_PREVIEW_PROVIDER_ID }),
      routeFacts: () => ({ api: 'openai-completions', baseURL: 'https://api.business.githubcopilot.com' }),
    })
    const fetchMock = vi.fn(async (_input: unknown, _init?: RequestInit) => new Response(JSON.stringify({ content: [{
      type: 'web_search_tool_result', tool_use_id: 'search', content: [{ type: 'web_search_result', url: 'https://example.com/fallback', title: 'Fallback' }],
    }] })))
    vi.stubGlobal('fetch', fetchMock)
    apply(runtime.ctx, config)
    const delegate = vi.fn()
    const result = await runtime.ctx.get('githubCopilotSearchRouter')!.search({ query: 'fallback' }, undefined, delegate)
    expect(result.content).toContain('deepseek-official')
    expect(result.content).toContain('DeepSeek API charges')
    expect(result.content).toContain('origin=https://deepseek-search.test')
    expect(result.content).toContain('model="synthetic-search-model"')
    expect(result.content).toContain('endpoint=custom')
    expect(result.sources).toMatchObject([{ url: 'https://example.com/fallback' }])
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://deepseek-search.test/v1/messages')
    expect(runtime.credentialResolve).toHaveBeenCalledWith('SYNTHETIC_KEY')
    expect(delegate).not.toHaveBeenCalled()
  })

  it('honors the explicit no-fallback and routing-disable settings', async () => {
    const runtime = buildRuntime({}, { current: { provider: GITHUB_COPILOT_PREVIEW_PROVIDER_ID, model: 'chat-only' } }, {}, {
      getView: () => ({ provider: GITHUB_COPILOT_PREVIEW_PROVIDER_ID }),
      routeFacts: () => ({ api: 'openai-completions', baseURL: 'https://api.business.githubcopilot.com' }),
    })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    apply(runtime.ctx, { ...config, searchFallback: 'none' })
    const delegate = vi.fn(async () => ({ sources: [], truncated: false }))
    const router = runtime.ctx.get('githubCopilotSearchRouter')!
    await expect(router.search({ query: 'no fallback' }, undefined, delegate)).rejects.toMatchObject({ code: 'WEB_PROVIDER_UNAVAILABLE' })
    expect(fetchMock).not.toHaveBeenCalled()
    runtime.settingsDocument[GITHUB_COPILOT_SETTINGS_NAMESPACE] = { routeWebSearch: false }
    runtime.triggerSettingsChange(GITHUB_COPILOT_SETTINGS_NAMESPACE)
    await router.search({ query: 'routing disabled' }, undefined, delegate)
    expect(delegate).toHaveBeenCalledOnce()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not fallback after credential invalidation during primary auth', async () => {
    const baseURL = 'https://api.business.githubcopilot.com'
    let notify!: () => void
    const runtime = buildRuntime({}, { current: { provider: GITHUB_COPILOT_PREVIEW_PROVIDER_ID, model: 'account-model' } }, {}, {
      getView: () => ({ provider: GITHUB_COPILOT_PREVIEW_PROVIDER_ID }),
      routeFacts: () => ({ api: 'openai-responses', baseURL }),
      resolveRequestAuth: async () => { notify(); return { apiKey: 'synthetic-managed', baseURL } },
      discover: vi.fn(async () => undefined),
    })
    notify = () => runtime.emitCredentialUpdate(credentialKey)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    apply(runtime.ctx, { ...config, searchFallback: 'deepseek' })
    await expect(runtime.ctx.get('githubCopilotSearchRouter')!.search({ query: 'cancelled account' }, undefined, vi.fn())).rejects.toMatchObject({ code: 'WEB_ABORTED' })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(runtime.credentialResolve).not.toHaveBeenCalled()
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
    runtime.listener?.(request({ model: 'unknown-no-protocol' }), next)
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

  it('uses managed account authorization for a new model without static catalog membership', async () => {
    const baseURL = 'https://api.business.githubcopilot.com'
    const resolveRequestAuth = vi.fn(async () => ({ apiKey: 'managed-synthetic-access', baseURL }))
    const runtime = buildRuntime({}, { current: { provider: GITHUB_COPILOT_PREVIEW_PROVIDER_ID, model: 'future-lab-r17' } }, {}, {
      getView: () => ({ provider: GITHUB_COPILOT_PREVIEW_PROVIDER_ID }),
      routeFacts: () => ({ api: 'openai-responses', baseURL }), resolveRequestAuth,
      discover: vi.fn(async () => undefined),
    })
    const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer managed-synthetic-access')
      return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'Synthetic search result.' }] }] }))
    })
    vi.stubGlobal('fetch', fetchMock)
    apply(runtime.ctx, { ...config, providers: [], probe: false })
    const attachReads = runtime.credentialRead.mock.calls.length
    expect(runtime.searchProviders[0]?.available()).toBe(true)
    await runtime.searchProviders[0]!.search({ query: 'synthetic query' })
    expect(resolveRequestAuth).toHaveBeenCalledWith('future-lab-r17', expect.any(AbortSignal))
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${baseURL}/responses`)
    expect(runtime.credentialRead).toHaveBeenCalledTimes(attachReads)
  })

  it('refuses a managed search whose metadata changes during auth resolution', async () => {
    let api = 'openai-responses'
    const baseURL = 'https://api.individual.githubcopilot.com'
    const runtime = buildRuntime({}, { current: { provider: GITHUB_COPILOT_PREVIEW_PROVIDER_ID, model: 'future-lab-r17' } }, {}, {
      getView: () => ({ provider: GITHUB_COPILOT_PREVIEW_PROVIDER_ID }), routeFacts: () => ({ api, baseURL }),
      discover: vi.fn(async () => undefined),
      resolveRequestAuth: async () => { api = 'openai-completions'; return { apiKey: 'synthetic', baseURL } },
    })
    const fetchMock = vi.fn(async () => { throw new Error('stale protocol must not be sent') })
    vi.stubGlobal('fetch', fetchMock)
    apply(runtime.ctx, { ...config, providers: [], probe: false })
    await expect(runtime.searchProviders[0]!.search({ query: 'synthetic query' })).rejects.toThrow()
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

  it.each(['Synthetic public reasoning summary.', ''])('delegates reasoning history to Core before probing: %j', (text) => {
    const runtime = buildRuntime()
    apply(runtime.ctx, config)
    const fetchMock = vi.fn(async () => { throw new Error('custom wire must not run') })
    vi.stubGlobal('fetch', fetchMock)
    const withReasoning = request({ messages: [{
      id: 'assistant-with-summary' as Message['id'], role: 'assistant',
      source: { kind: 'model', provider: 'github-copilot', model: 'gpt-5.4' },
      content: [{ type: 'reasoning', text }, { type: 'text', text: 'Synthetic answer.' }],
    }] })
    const originalMessages = withReasoning.messages
    const next = vi.fn(() => {
      expect(withReasoning.messages).toBe(originalMessages)
      expect(withReasoning.messages[0]?.content[0]).toEqual({ type: 'reasoning', text })
      return 'core-replay'
    })
    expect(runtime.listener?.(withReasoning, next)).toBe('core-replay')
    expect(next).toHaveBeenCalledTimes(1)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('delegates opaque assistant replay state without serializing its fields', () => {
    const runtime = buildRuntime()
    apply(runtime.ctx, config)
    const fetchMock = vi.fn(async () => { throw new Error('custom wire must not run') })
    vi.stubGlobal('fetch', fetchMock)
    const replay = Object.defineProperty({}, 'encrypted', { enumerable: true, get() { throw new Error('do not inspect replay payload') } })
    const withReplay = request({ messages: [{
      id: 'assistant-with-replay' as Message['id'], role: 'assistant',
      source: { kind: 'model', provider: 'github-copilot', model: 'gpt-5.4', replayState: replay },
      content: [{ type: 'text', text: 'Synthetic answer.' }],
    }] })
    const next = vi.fn(() => 'core-replay')
    expect(runtime.listener?.(withReplay, next)).toBe('core-replay')
    expect(next).toHaveBeenCalledTimes(1)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([0, 1])('delegates Anthropic in-band system authority before probing at position %s', position => {
    const model = 'claude-sonnet-4.5'
    const runtime = buildRuntime({}, { current: { provider: 'github-copilot', model } })
    apply(runtime.ctx, { ...config, probe: true })
    const fetchMock = vi.fn(async () => { throw new Error('custom wire must not run') })
    vi.stubGlobal('fetch', fetchMock)
    // rc1 development types predate the in-band system role; preserve its newer
    // shape without importing an unpublished Core type or changing old peers.
    const system = { id: 'system-fixture', role: 'system', content: [{ type: 'text', text: 'System authority.' }],
      source: { kind: 'system' } } as unknown as Message
    const messages = [...request().messages]
    messages.splice(position, 0, system)
    const input = request({ model, messages })
    const next = vi.fn(() => 'core-system')
    expect(runtime.listener?.(input, next)).toBe('core-system')
    expect(next).toHaveBeenCalledTimes(1)
    expect(input.messages).toBe(messages)
    expect(input.messages[position]).toBe(system)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(runtime.credentialResolve).not.toHaveBeenCalled()
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

  it('captures an explicit request model instead of substituting a changed Session selection', async () => {
    const selection: SelectionRef = { current: { provider: 'github-copilot', model: 'gpt-4.1' } }
    const runtime = buildRuntime({}, selection)
    apply(runtime.ctx, { ...config, probe: true })
    const fetchMock = searchFetch()
    vi.stubGlobal('fetch', fetchMock)
    const next = vi.fn(() => undefined)
    const original = request({ model: 'gpt-5.4' })
    const messages = original.messages
    const stream = runtime.listener?.(original, next) as AsyncIterable<StreamChunk>
    selection.current = { provider: 'other-route', model: 'model-C' }
    await drain(stream)
    expect(original.messages).toBe(messages)
    expect(next).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    for (const [, init] of fetchMock.mock.calls) expect(JSON.parse(String(init?.body)).model).toBe('gpt-5.4')
    expect(runtime.promptSection?.text()).toBe('')
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

  it('allows explicit inline requests without an initiator but never guesses a traditional search route', async () => {
    const fetchMock = searchFetch()
    vi.stubGlobal('fetch', fetchMock)
    const runtime = buildRuntime({}, { current: null })
    apply(runtime.ctx, { ...config, probe: true })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(runtime.searchProviders[0]?.available()).toBe(false)
    await expect(runtime.searchProviders[0]!.search({ query: 'news' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_UNAVAILABLE' })
    await search(runtime, 'inline')
    await search(runtime, 'inline')
    // Explicit agentless calls have operation-local plans, never a shared fallback cache.
    expect(proofCount(fetchMock)).toBe(2)
    expect(runtime.promptSection?.text()).toBe('')
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
    expect(await runtime.promptText({ provider: 'github-copilot', model: 'gpt-5.4' })).toContain('web_search')
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
