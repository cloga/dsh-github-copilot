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
import * as WebDelegate from '../src/web-delegate.ts'
import { routeSessionSearch } from '../src/search-routing.ts'
import { currentSearchInitiator, currentSearchSelection } from '../src/current-provider.ts'

const cleanup: Array<() => Promise<void> | void> = []
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose() })
const answer: WebSearchResult = { content: 'upstream answer', sources: [{ url: 'https://example.com/1' }, { url: 'https://example.com/2' }, { url: 'https://example.com/3' }], truncated: false }

function owner(provider: string, id: string): Agent {
  // Minimal Session projection; this suite executes real tool/web/scope services, not the Agent loop.
  return { id, session: { requestHeader: () => ({ config: { provider, model: `${id}-model` } }) } } as unknown as Agent
}

async function harness(fallback: 'none' | 'deepseek' = 'none') {
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
  const fetch = vi.fn(async () => ({ url: 'https://example.com', statusCode: 200, contentType: 'text/plain', body: { kind: 'text' as const, content: 'native fetch' }, truncated: false }))
  const providerFiber = ctx.plugin({
    name: 'official-provider-test-double', inject: ['web'],
    apply(c) {
      c.web.registerSearchProvider({ id: 'configured-provider', available: () => true, search })
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
        search: async (request, signal, delegate) => (await routeSessionSearch(request, signal, {
          selection: currentSearchSelection(currentSearchInitiator(c)), managedOwned: false,
          fallback, copilot, delegate, resolveDeepSeek: async () => deepseek, canContinue: () => true,
        })).result,
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
  return { ctx, tools, agents, a, b, d, run, copilot, deepseek, search, fetch, providerFiber, routedFiber, router, original: isolated.get('web')! }
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

  it('fails closed for Copilot while the router is absent, without breaking other routes', async () => {
    const h = await harness()
    await h.router.dispose()
    expect((await h.run(h.a, { queries: ['not ready'] })).isError).toBe(true)
    expect(h.search).not.toHaveBeenCalled()
    expect((await h.run(h.b, { queries: ['native still available'] })).isError).toBe(false)
  })
})
