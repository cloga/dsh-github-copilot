import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { composeEntries, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { AgentRegistry } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AuthorizationService from '@deepseek-ai/dsh-authorization'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { createScope } from '@deepseek-ai/dsh-scope'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import { applyWebSearchTool } from '@deepseek-ai/dsh-tool-web'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import { WebRuntime } from '@deepseek-ai/dsh-web'
import * as Copilot from '../src/index.ts'
import { GITHUB_COPILOT_PREVIEW_PROVIDER_ID } from '../src/copilot-identity.ts'
import type { InlineConfig } from '../src/config.ts'

const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

const config: InlineConfig = {
  enabled: true, providers: [], includeSources: true, stripServerTools: true,
  idleTimeoutMs: 300_000, probe: true, probeTimeoutMs: 30_000,
}

describe('native web ownership', () => {
  it('leaves the configured native web entry unchanged in the plugin overlay', () => {
    const web = { id: 'web', name: '@deepseek-ai/dsh-web', config: { searchProvider: 'native', fetchProvider: 'http' } }
    const result = composeEntries([
      [{ insert: [web] }],
      loadOverlayPatches('fixture', join(process.cwd(), 'cordis.patch.yml')),
    ])
    expect(result.find(entry => entry.id === 'web')).toEqual(web)
    expect(result.filter(entry => entry.id?.startsWith('github-copilot')).map(entry => entry.id))
      .toEqual(['github-copilot'])
  })

  it('preserves implicit native search selection before, during and after plugin activation', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    const mutate = vi.fn(async () => { throw new Error('unexpected fixture settings mutation') })
    await ctx.plugin({ apply(owner) {
      new AgentRegistry(owner)
      owner.plugin(SystemPrompt, {})
      owner.provide('credentials', {
        describeRecord: async () => ({ configured: false, writable: true }),
        readRecord: async () => undefined,
        listRecords: async () => [],
        modifyRecord: async () => { throw new Error('unexpected fixture credential mutation') },
        deleteRecord: async () => { throw new Error('unexpected fixture credential deletion') },
      })
      owner.provide('settings', {
        get: (namespace: string) => namespace === 'github-copilot' ? {} : undefined,
        describe: () => [{ ns: 'github-copilot', revision: 1, value: {} }],
        mutate,
      })
      owner.provide('agentDefaultModel', {
        currentSelection: () => ({ provider: 'github-copilot', model: 'native-model' }),
      })
    } })
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(AuthorizationService)
    await ctx.plugin(WebRuntime, { searchProvider: undefined, fetchProvider: undefined })
    const result = { content: 'native answer', sources: [], truncated: false }
    const search = vi.fn(async () => result)
    await ctx.plugin({ inject: ['web'], apply(owner) {
      owner.web.registerSearchProvider({ id: 'native', available: () => true, search })
    } })
    const request = { query: 'current information' }
    await expect(ctx.web.search(request)).resolves.toEqual(result)

    const plugin = ctx.plugin(Copilot, config)
    await plugin
    await vi.waitFor(() => expect(ctx.get('githubCopilotAuthorization')).toBeDefined())
    await expect(ctx.web.search(request)).resolves.toEqual(result)
    await plugin.dispose()
    await expect(ctx.web.search(request)).resolves.toEqual(result)

    expect(search).toHaveBeenCalledTimes(3)
    expect(mutate).not.toHaveBeenCalled()
  })

  it('keeps native web tool execution for a Copilot Agent before and after plugin disposal', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin({ apply(owner) {
      new AgentRegistry(owner)
      owner.plugin(SystemPrompt, {})
      owner.provide('credentials', {
        describeRecord: async () => ({ configured: false, writable: true }),
        readRecord: async () => undefined,
        listRecords: async () => [],
        modifyRecord: async () => undefined,
        deleteRecord: async () => undefined,
      })
      owner.provide('settings', {
        get: (namespace: string) => namespace === 'github-copilot' ? {} : undefined,
        describe: () => [{ ns: 'github-copilot', revision: 1, value: {} }],
        mutate: async () => undefined,
      })
      owner.provide('agentDefaultModel', {
        currentSelection: () => ({ provider: GITHUB_COPILOT_PREVIEW_PROVIDER_ID, model: 'account-model' }),
      })
    } })
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(AuthorizationService)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(NativeToolExecutor)
    await ctx.plugin(WebRuntime, { searchProvider: 'native', fetchProvider: undefined })
    const search = vi.fn(async () => ({ content: 'native answer', sources: [], truncated: false }))
    await ctx.plugin({ inject: ['web'], apply(owner) {
      owner.web.registerSearchProvider({ id: 'native', available: () => true, search })
    } })
    const session = Session.create(SessionId('copilot-agent'))
    session.append('request/header', { header: {
      config: { provider: GITHUB_COPILOT_PREVIEW_PROVIDER_ID, model: 'account-model' },
    }, reason: 'initial' })
    const agent = {
      id: 'copilot-agent',
      session,
    } as unknown as Agent
    const scope = createScope(ctx, agent)
    await ctx.plugin({ inject: ['tools', 'web', 'systemPrompt'], apply(owner) {
      const toolScope = createScope(owner, agent)
      applyWebSearchTool(toolScope.ctx, 2, 2, 800, 60_000, false)
      return () => toolScope.dispose()
    } })
    const plugin = ctx.plugin(Copilot, config)
    await plugin
    await vi.waitFor(() => expect(ctx.get('githubCopilotAuthorization')).toBeDefined())
    await expect(ctx.web.searchReady(GITHUB_COPILOT_PREVIEW_PROVIDER_ID)).resolves.toBe(true)
    expect(ctx.get('githubCopilotSearchRouter')).toBeUndefined()
    const next = vi.fn(async () => ({ kind: 'enter' as const, messages: [] }))
    await expect(Reflect.apply(ctx.waterfall, ctx, [scope, 'agent/pre-step', {
      agent, turn: 1, step: 1, messages: [], signal: new AbortController().signal,
    }, next])).resolves.toEqual({ kind: 'enter', messages: [] })
    expect(next).toHaveBeenCalledOnce()
    const accounts = ctx.get('githubCopilotSessionAccounts')
    expect(accounts?.turns.current(agent.session)).toBeUndefined()
    const signal = new AbortController().signal
    await expect(Reflect.apply(ctx.waterfall, ctx, [scope, 'agent/pre-step', {
      agent, turn: 1, step: 1, messages: [], signal,
      modelSelection: { provider: GITHUB_COPILOT_PREVIEW_PROVIDER_ID, model: 'account-model' },
    }, next])).resolves.toEqual({ kind: 'enter', messages: [] })
    expect(accounts?.requestBinding(signal).accountId).toBe('canonical')
    await expect(Reflect.apply(ctx.waterfall, ctx, [scope, 'agent/pre-step', {
      agent, turn: 1, step: 1, messages: [], signal, modelSelection: null,
    }, next])).rejects.toThrow('COPILOT_PRE_STEP_MODEL_SELECTION_INVALID')
    await expect(Reflect.apply(ctx.waterfall, ctx, [scope, 'agent/pre-step', {
      agent, turn: 1, step: 1, messages: [], signal,
      modelSelection: { provider: GITHUB_COPILOT_PREVIEW_PROVIDER_ID, model: '' },
    }, next])).rejects.toThrow('COPILOT_PRE_STEP_MODEL_SELECTION_INVALID')
    expect(next).toHaveBeenCalledTimes(2)
    const run = (callId: string) => ctx.agents.withInitiator(agent, async () => {
      const requestSignal = new AbortController().signal
      const toolSet = await ctx.tools.resolve({ agent, signal: requestSignal, modelSelection: agent.session.requestHeader()!.config })
      try {
        const batch = await ctx.tools.execute({ agent, signal: requestSignal, toolSet,
          calls: [{ type: 'tool-call', id: ToolCallId(callId), name: 'web_search',
            arguments: JSON.stringify({ queries: ['current information'] }) }] })
        if (batch.results.length !== 1) throw new Error('expected one native web result')
        return batch.results[0]!.result
      } finally { toolSet.dispose() }
    })
    const before = await run('before-dispose')
    expect(before.isError, JSON.stringify(before)).toBe(false)
    await plugin.dispose()
    await expect(ctx.web.searchReady(GITHUB_COPILOT_PREVIEW_PROVIDER_ID)).resolves.toBe(true)
    const after = await run('after-dispose')
    expect(after.isError, JSON.stringify(after)).toBe(false)
    expect(search).toHaveBeenCalledTimes(2)
    await scope.dispose()
  })
})
