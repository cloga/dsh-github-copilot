import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { AgentRegistry } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createScope } from '@deepseek-ai/dsh-scope'
import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { applyWebSearchTool } from '@deepseek-ai/dsh-tool-web'
import { WebError, WebRuntime } from '@deepseek-ai/dsh-web'
import type { WebSearchProvider, WebSearchResult } from '@deepseek-ai/dsh-web'
import CopilotRoutedWeb from '../src/routed-web.ts'
import type { CapturedSearchProvider } from '../src/routed-web.ts'
import * as WebDelegate from '../src/web-delegate.ts'
import { routeSessionSearch } from '../src/search-routing.ts'
import { routeSearchTools } from '../src/search-tool-routing.ts'
import { currentSearchInitiator, currentSearchSelection } from '../src/current-provider.ts'

const cleanup: Array<() => Promise<void> | void> = []
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose() })
const answer: WebSearchResult = { content: 'upstream answer', sources: [{ url: 'https://example.com/1' }, { url: 'https://example.com/2' }, { url: 'https://example.com/3' }], truncated: false }

function owner(provider: string, id: string): Agent {
  // Minimal Session projection; this suite executes real tool/web/scope services, not the Agent loop.
  return { id, session: { requestHeader: () => ({ config: { provider, model: `${id}-model` } }) } } as unknown as Agent
}

async function harness(fallback: 'none' | 'deepseek' = 'none', selectedProvider?: string, captured = false) {
  const ctx = new Context()
  const root = ctx.plugin({
    name: 'routed-web-test-root',
    apply(c) {
      new AgentRegistry(c)
      c.plugin(SystemPrompt, {})
    },
  })
  cleanup.push(root.dispose)
  await root
  const toolFiber = ctx.plugin(ToolRuntime, { mode: 'native' })
  cleanup.push(toolFiber.dispose)
  await toolFiber
  const isolated = ctx.isolate('web', Symbol('original-web'))
  const originalFiber = isolated.plugin(WebRuntime, { searchProvider: 'configured-provider', fetchProvider: 'configured-fetch' })
  cleanup.push(originalFiber.dispose)
  await originalFiber
  const delegateFiber = isolated.plugin(WebDelegate)
  cleanup.push(delegateFiber.dispose)
  await delegateFiber
  const routedFiber = ctx.plugin(CopilotRoutedWeb)
  cleanup.push(routedFiber.dispose)
  await routedFiber
  const search = vi.fn(async () => answer)
  const alternateSearch = vi.fn(async () => ({ ...answer, content: 'alternate answer' }))
  const fetch = vi.fn(async () => ({ url: 'https://example.com', statusCode: 200, contentType: 'text/plain', body: { kind: 'text' as const, content: 'native fetch' }, truncated: false }))
  const providerFiber = ctx.plugin({
    name: 'official-provider-test-double', inject: ['web'],
    apply(c) {
      c.web.registerSearchProvider({ id: 'configured-provider', available: () => true, search })
      c.web.registerSearchProvider({ id: 'alternate-provider', available: () => true, search: alternateSearch })
      c.web.registerFetchProvider({ id: 'configured-fetch', available: () => true, fetch })
    },
  })
  cleanup.push(providerFiber.dispose)
  await providerFiber
  const copilot: WebSearchProvider = { id: 'github-copilot-hosted', available: () => true, search: vi.fn(async () => answer) }
  const deepseek: WebSearchProvider = { id: 'deepseek-official', available: () => true, search: vi.fn(async () => answer) }
  const router = ctx.plugin({
    name: 'synthetic-account-router',
    apply(c) {
      c.provide('githubCopilotSearchRouter', {
        search: async (request, signal, delegate, selectProvider, captureSearchProvider) => {
          if (captured) {
            if (captureSearchProvider === undefined) throw new Error('missing captureSearchProvider seam')
            const primary = captureSearchProvider('alternate-provider')
            const final = captureSearchProvider('configured-provider')
            const signals = [signal, primary?.signal, final?.signal].filter((item): item is AbortSignal => item !== undefined)
            return routeSearchTools(request, AbortSignal.any(signals), {
              primary, fallback: final,
              canContinue: () => primary?.current() !== false && final?.current() !== false,
            })
          }
          if (selectedProvider !== undefined) {
            if (selectProvider === undefined) throw new Error('missing exact-provider dispatcher')
            return selectProvider(selectedProvider, request, signal)
          }
          return (await routeSessionSearch(request, signal, {
            selection: currentSearchSelection(currentSearchInitiator(c)), managedOwned: false,
            fallback, copilot, delegate, resolveDeepSeek: async () => deepseek, canContinue: () => true,
          })).result
        },
      })
    },
  })
  cleanup.push(router.dispose)
  await router
  const a = owner('github-copilot', 'A')
  const b = owner('deepseek-official', 'B')
  const d = owner('another-provider', 'D')
  const consumer = ctx.plugin({
    name: 'official-consumer-test-composition', inject: ['tools', 'web', 'systemPrompt'],
    apply(c) {
      for (const agent of [a, b, d]) {
        const scope = createScope(c, agent)
        cleanup.push(scope.dispose)
        applyWebSearchTool(scope.ctx, 2, 2, 60000, false)
      }
    },
  })
  cleanup.push(consumer.dispose)
  await consumer
  const tools = ctx.get('tools')!
  const agents = ctx.get('agents')!
  let call = 0
  const run = (agent: Agent, args: unknown, signal = new AbortController().signal) => agents.withInitiator(agent, () => tools.execute({ callId: `call-${++call}` as ToolCallId, name: 'web_search', arguments: args, agent, signal }))
  return { ctx, tools, agents, a, b, d, run, copilot, deepseek, search, alternateSearch, fetch, providerFiber, routedFiber, router, original: isolated.get('web')! }
}

describe('plugin-owned web facade with the real official consumer', () => {
  it('keeps the configured provider for DeepSeek and all other model routes', async () => {
    const h = await harness()
    for (const agent of [h.b, h.d]) {
      const result = await h.run(agent, { queries: ['query'] })
      expect(result.isError).toBe(false)
      expect(result.content).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'text', text: expect.stringContaining('upstream answer') })]))
    }
    expect(h.search).toHaveBeenCalledTimes(2)
    expect(h.copilot.search).not.toHaveBeenCalled()
    expect(h.deepseek.search).not.toHaveBeenCalled()
  })

  it('dispatches a router-selected provider by exact registered id', async () => {
    const h = await harness('none', 'alternate-provider')
    const result = await h.run(h.b, { queries: ['query'] })
    expect(result.isError).toBe(false)
    expect(result.content).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'text', text: expect.stringContaining('alternate answer') }),
    ]))
    expect(h.alternateSearch).toHaveBeenCalledOnce()
    expect(h.search).not.toHaveBeenCalled()
  })

  it('provides captured registration dispatch without changing source caps', async () => {
    const h = await harness('none', undefined, true)
    const result = await h.run(h.b, { queries: ['captured primary'] })
    expect(result.isError).toBe(false)
    expect(h.alternateSearch).toHaveBeenCalledOnce()
    expect(h.search).not.toHaveBeenCalled()
    expect(result).toMatchObject({ value: { sources: [{ url: 'https://example.com/1' }, { url: 'https://example.com/2' }], truncated: true } })
  })

  it.each(['success', 'failure'])('rejects captured primary %s after provider disposal without a final fallback', async outcome => {
    const h = await harness('none', undefined, true)
    let release!: () => void, started!: () => void
    const entered = new Promise<void>(resolve => { started = resolve })
    const gate = new Promise<void>(resolve => { release = resolve })
    h.alternateSearch.mockImplementation(async () => {
      started()
      await gate
      if (outcome === 'failure') throw new WebError('private upstream failure', 'WEB_PROVIDER_ERROR')
      return { ...answer, content: 'stale result' }
    })
    const pending = h.run(h.b, { queries: ['dispose captured provider'] })
    await entered
    await h.providerFiber.dispose()
    release()
    const result = await pending
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).not.toContain('stale result')
    expect(h.search).not.toHaveBeenCalled()
  })

  it('does not revive an old capture when the exact same provider object is registered again under the same id', async () => {
    const h = await harness()
    await h.router.dispose()
    const captured: CapturedSearchProvider[] = []
    const router = h.ctx.plugin({
      name: 'capture-retention-test-router',
      apply(c) {
        c.provide('githubCopilotSearchRouter', {
          search: async (request, signal, _delegate, _select, capture) => {
            const provider = capture?.('repeated-provider')
            if (provider === undefined) throw new Error('missing captured provider')
            captured.push(provider)
            return provider.search(request, signal)
          },
        })
      },
    })
    cleanup.push(router.dispose)
    await router
    const search = vi.fn(async () => answer)
    const provider = { id: 'repeated-provider', available: () => true, search }
    let unregister: (() => void) | undefined
    const first = h.ctx.plugin({ name: 'first-search-registration', inject: ['web'], apply: c => { unregister = c.web.registerSearchProvider(provider) } })
    cleanup.push(first.dispose)
    await first
    expect((await h.run(h.b, { queries: ['first'] })).isError).toBe(false)
    const old = captured[0]!
    expect(old.owns(provider)).toBe(true)
    unregister!()
    expect(old.current()).toBe(false)
    expect(old.signal.aborted).toBe(true)
    const second = h.ctx.plugin({ name: 'second-search-registration', inject: ['web'], apply: c => { c.web.registerSearchProvider(provider) } })
    cleanup.push(second.dispose)
    await second
    unregister!()
    await first.dispose()
    await expect(old.search({ query: 'retained stale capture' })).rejects.toMatchObject({ code: 'WEB_ABORTED' })
    expect(old.owns(provider)).toBe(false)
    expect((await h.run(h.b, { queries: ['second'] })).isError).toBe(false)
    expect(captured[1]?.owns(provider)).toBe(true)
    expect(h.ctx.get('githubCopilotSearchCatalog')!.list()).toContain('repeated-provider')
    expect(search).toHaveBeenCalledTimes(2)
  })

  it('routes Copilot without invoking the globally configured provider and keeps source caps', async () => {
    const h = await harness()
    const result = await h.run(h.a, { queries: ['query'] })
    expect(result.isError).toBe(false)
    expect(result).toMatchObject({ value: { sources: [{ url: 'https://example.com/1' }, { url: 'https://example.com/2' }], truncated: true } })
    expect(h.copilot.search).toHaveBeenCalledOnce()
    expect(h.search).not.toHaveBeenCalled()
  })

  it.each([{ queries: [] }, { queries: [' '] }, { queries: ['a', 'b', 'a'] }, { queries: 'wrong type' }])('retains official validation before any provider call: %j', async args => {
    const h = await harness()
    const result = await h.run(h.a, args)
    expect(result.isError).toBe(true)
    expect(h.copilot.search).not.toHaveBeenCalled()
    expect(h.search).not.toHaveBeenCalled()
    expect(h.deepseek.search).not.toHaveBeenCalled()
  })

  it('keeps official duplicate-query collapse and merged limits', async () => {
    const h = await harness()
    const result = await h.run(h.a, { queries: ['same', 'same'] })
    expect(result.isError).toBe(false)
    expect(h.copilot.search).toHaveBeenCalledOnce()
    expect(result).toMatchObject({ value: { truncated: true, sources: expect.any(Array) } })
  })

  it('retains pre-execute denial and the surrounding execution middleware', async () => {
    const h = await harness()
    const events: string[] = []
    const wrappers = h.ctx.plugin({
      name: 'native-execution-policies',
      apply(c) {
        c.on('tools/execute', async (_exec, next) => { events.push('before'); const r = await next(); events.push('after'); return r })
        c.on('tools/pre-execute', async (exec, next) => exec.agent === h.b ? { kind: 'deny', reason: 'test policy' } : next())
      },
    })
    cleanup.push(wrappers.dispose)
    await wrappers
    expect((await h.run(h.b, { queries: ['denied'] })).isError).toBe(true)
    expect(events).toEqual([])
    expect((await h.run(h.a, { queries: ['allowed'] })).isError).toBe(false)
    expect(events).toEqual(['before', 'after'])
    expect(h.search).not.toHaveBeenCalled()
  })

  it('preserves fallback provenance in canonical value, rendered content and web-card metadata', async () => {
    const h = await harness('deepseek')
    vi.mocked(h.copilot.search).mockRejectedValue(new WebError('no native search', 'WEB_PROVIDER_UNAVAILABLE'))
    const result = await h.run(h.a, { queries: ['fallback'] })
    expect(result.isError).toBe(false)
    expect(result).toMatchObject({ value: { content: expect.stringContaining('DeepSeek API charges') } })
    expect(JSON.stringify(result.content)).toContain('deepseek-official')
    expect(JSON.stringify(result.meta)).toContain('DeepSeek API charges')
    expect(h.deepseek.search).toHaveBeenCalledOnce()
    expect(h.search).not.toHaveBeenCalled()
  })

  it('keeps concurrent owner attribution and fetch on the original service', async () => {
    const h = await harness()
    const [a, b] = await Promise.all([h.run(h.a, { queries: ['A'] }), h.run(h.b, { queries: ['B'] })])
    expect(a.isError).toBe(false)
    expect(b.isError).toBe(false)
    expect(h.copilot.search).toHaveBeenCalledExactlyOnceWith({ query: 'A', maxResults: 2 }, expect.any(AbortSignal))
    expect(h.search).toHaveBeenCalledExactlyOnceWith({ query: 'B', maxResults: 2 }, expect.any(AbortSignal))
    await h.ctx.get('web')!.fetch({ url: 'https://example.com' })
    expect(h.fetch).toHaveBeenCalledOnce()
  })

  it('forwards registration ownership so disposing a provider removes it from the original service', async () => {
    const h = await harness()
    await h.providerFiber.dispose()
    const result = await h.run(h.b, { queries: ['after provider disposal'] })
    expect(result.isError).toBe(true)
    expect(h.search).not.toHaveBeenCalled()
  })

  it('does not change the official WebRuntime prototype', async () => {
    const search = WebRuntime.prototype.search
    const fetch = WebRuntime.prototype.fetch
    await harness()
    expect(WebRuntime.prototype.search).toBe(search)
    expect(WebRuntime.prototype.fetch).toBe(fetch)
  })

  it('rejects retained search, fetch and registration handles after facade disposal', async () => {
    const h = await harness()
    const retained = h.ctx.get('web')!
    await h.routedFiber.dispose()
    await expect(retained.search({ query: 'late' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_UNAVAILABLE' })
    await expect(retained.fetch({ url: 'https://example.com/late' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_UNAVAILABLE' })
    expect(() => retained.registerSearchProvider(h.deepseek)).toThrow('disposed')
    expect(h.search).not.toHaveBeenCalled()
    expect(h.fetch).not.toHaveBeenCalled()
    expect(h.copilot.search).not.toHaveBeenCalled()
  })

  it('aborts and drains an in-flight Copilot search on facade disposal without fallback', async () => {
    const h = await harness('deepseek')
    let started!: () => void
    const entered = new Promise<void>(resolve => { started = resolve })
    let drained = false
    vi.mocked(h.copilot.search).mockImplementation((_request, signal) => new Promise<WebSearchResult>((_resolve, reject) => {
      started()
      signal!.addEventListener('abort', () => {
        queueMicrotask(() => { drained = true; reject(new WebError('cancelled', 'WEB_ABORTED')) })
      }, { once: true })
    }))
    const pending = h.run(h.a, { queries: ['pending'] })
    await entered
    await h.routedFiber.dispose()
    expect(drained).toBe(true)
    expect((await pending).isError).toBe(true)
    expect(h.deepseek.search).not.toHaveBeenCalled()
    expect(h.search).not.toHaveBeenCalled()
  })

  it('fails closed for Copilot while the router is absent, without breaking other routes', async () => {
    const h = await harness()
    await h.router.dispose()
    expect((await h.run(h.a, { queries: ['not ready'] })).isError).toBe(true)
    expect(h.search).not.toHaveBeenCalled()
    expect((await h.run(h.b, { queries: ['native still available'] })).isError).toBe(false)
  })
})
