/**
 * Composition-level tests of `apply`: provider registration, tool
 * registration gated on the plan's protocol, and the auto-disable default.
 * The runtime is faked (web/tools/systemPrompt registries plus the optional
 * settings seam) so the wiring — not the network — is under test.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { apply } from '../src/index.ts'
import type { Config } from '../src/index.ts'
import type { WebSearchProvider } from '@deepseek-ai/dsh-web'
import type { FakeServices } from './helpers.ts'

interface FakeRuntime {
  ctx: Context
  providers: WebSearchProvider[]
  toolNames: string[]
  sectionNames: string[]
}

/** A settings service whose document serves the given namespaces. */
function fakeSettings(document: Record<string, unknown>): unknown {
  return {
    get: (ns: unknown) => document[String(ns)],
    register: (_ns: unknown, schema: (value: unknown) => unknown, options?: { base?: unknown }) => {
      const resolved = schema(options?.base ?? {})
      return {
        get: () => resolved,
        watch: () => () => undefined,
        update: async () => undefined,
        replace: async () => undefined,
      }
    },
  }
}

/** The default-model selection fakes used across tests. */
function deepseekSelection(): FakeServices['agentDefaultModel'] {
  return { currentSelection: () => ({ provider: 'deepseek', model: 'deepseek-v4-flash' }) }
}

function buildRuntime(services: FakeServices): FakeRuntime {
  const providers: WebSearchProvider[] = []
  const toolNames: string[] = []
  const sectionNames: string[] = []
  const store = new Map<string, unknown>([
    ...(services.agentDefaultModel !== undefined ? [['agentDefaultModel', services.agentDefaultModel]] : []),
    ...(services.settings !== undefined ? [['settings', services.settings]] : []),
  ])
  const ctx = {
    get: (name: string) => store.get(name),
    logger: {
      info: (..._args: unknown[]) => undefined,
      warn: (..._args: unknown[]) => undefined,
    },
    web: {
      registerSearchProvider: (provider: WebSearchProvider) => {
        providers.push(provider)
        return () => undefined
      },
    },
    tools: {
      register: (definition: ToolDefinition) => {
        toolNames.push(definition.name)
        return () => undefined
      },
    },
    systemPrompt: {
      section: (section: { name: string }) => {
        sectionNames.push(section.name)
        return () => undefined
      },
    },
    inject: (servicesToInject: string[], callback: (sctx: Context) => void) => {
      if (servicesToInject.every(name => store.has(name))) callback(ctx as unknown as Context)
    },
    effect: (callback: () => unknown) => {
      const disposer = callback()
      return typeof disposer === 'function' ? disposer : () => undefined
    },
  } as Record<string, unknown>
  // Cordis attaches injected services as context properties; consumers such
  // as installSettingsSection read them directly rather than through get().
  for (const [name, service] of store) ctx[name] = service
  return { ctx: ctx as unknown as Context, providers, toolNames, sectionNames }
}

/** The lllm-pi-ai settings document with a deepseek profile. */
function deepseekDocument(profile: Record<string, unknown>): Record<string, unknown> {
  return { 'llm-pi-ai': { providers: { deepseek: profile } } }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('apply', () => {
  it('registers the provider and no browsing tools on an anthropic route', () => {
    const runtime = buildRuntime({
      agentDefaultModel: deepseekSelection(),
      settings: fakeSettings(deepseekDocument({ api: 'anthropic-messages', apiKeyEnv: 'K' })),
    })
    apply(runtime.ctx, { probe: false } as Config)
    expect(runtime.providers.map(provider => provider.id)).toEqual(['web-search-provider'])
    expect(runtime.toolNames).toEqual([])
    expect(runtime.sectionNames).toEqual([])
  })

  it('registers the browsing tools only while the plan serves the Responses protocol', () => {
    const runtime = buildRuntime({})
    apply(runtime.ctx, { protocol: 'openai-responses', baseURL: 'https://gw.example/v1', probe: false } as Config)
    expect(runtime.toolNames.sort()).toEqual(['find_in_page', 'open_page'])
    expect(runtime.sectionNames).toEqual(['tool:web-search-provider-browse'])
    expect(runtime.providers).toHaveLength(1)
  })

  it('honors the per-tool enable flags', () => {
    const runtime = buildRuntime({})
    apply(runtime.ctx, {
      protocol: 'openai-responses',
      baseURL: 'https://gw.example/v1',
      probe: false,
      tools: { openPage: false },
    } as Config)
    expect(runtime.toolNames).toEqual(['find_in_page'])
  })

  it('auto-disables (unavailable provider, no tools) when nothing can be detected', () => {
    const runtime = buildRuntime({})
    apply(runtime.ctx, {} as Config)
    expect(runtime.providers).toHaveLength(1)
    expect(runtime.providers[0]?.available()).toBe(false)
    expect(runtime.toolNames).toEqual([])
  })

  it('serves searches through the pinned Responses protocol', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      id: 'resp-1',
      output: [
        { type: 'web_search_call', id: 'ws-1', action: { type: 'search', queries: ['q'] } },
        {
          type: 'message',
          content: [{ type: 'output_text', text: 'answer', annotations: [{ type: 'url_citation', url: 'https://x.example/1' }] }],
        },
      ],
    }), { status: 200 })))
    const runtime = buildRuntime({})
    apply(runtime.ctx, {
      protocol: 'openai-responses',
      baseURL: 'https://gw.example/v1',
      apiKey: 'key-1',
      probe: false,
    } as Config)
    const result = await runtime.providers[0]?.search({ query: 'question' })
    expect(result?.content).toBe('answer')
    expect(result?.sources).toEqual([{ url: 'https://x.example/1' }])
  })

  it('resolves the credential reference through the credentials seam', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      id: 'resp-1',
      output: [{ type: 'web_search_call', id: 'ws-1', action: { type: 'search', queries: ['q'] } }],
    }), { status: 200 })))
    const seen: string[] = []
    const runtime = buildRuntime({})
    const ctx = runtime.ctx as unknown as { get: (name: string) => unknown }
    const originalGet = ctx.get.bind(ctx)
    ctx.get = (name: string) => {
      if (name === 'credentials') {
        return { resolve: async (ref: unknown) => { seen.push(String(ref)); return { value: 'resolved-key' } } }
      }
      return originalGet(name)
    }
    apply(runtime.ctx, {
      protocol: 'openai-responses',
      baseURL: 'https://gw.example/v1',
      apiKeyEnv: 'MY_KEY',
      probe: false,
    } as Config)
    await runtime.providers[0]?.search({ query: 'question' })
    expect(seen).toEqual(['MY_KEY'])
  })
})
