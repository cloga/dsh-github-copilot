import { createRequire } from 'node:module'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { agentEvents, installModelSelection } from '@deepseek-ai/dsh-agent'
import type { Agent, ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import { describe, expect, it, vi } from 'vitest'
import { currentChatRoute } from '../src/current-provider.ts'
import { GITHUB_COPILOT_PREVIEW_PROVIDER_ID as provider } from '../src/copilot-identity.ts'

// Use the unchanged public Session artifact owned by the installed Agent peer.
const agentRequire = createRequire(createRequire(import.meta.url).resolve('@deepseek-ai/dsh-agent'))
const { Session } = agentRequire('@deepseek-ai/dsh-session') as {
  Session: { create(id: Agent['id']): Agent['session'] }
}

function agentWithHeader(selection: { provider: string; model: string }): Agent {
  return { options: { provider: 'activation-C', model: 'C' },
    session: { requestHeader: () => ({ config: selection }) } } as Agent
}

function runtime(model: string, facts: unknown) {
  const ctx = new Context()
  const routeFacts = vi.fn(() => facts)
  const getView = vi.fn(() => ({ provider }))
  ctx.get = ((name: string) => {
    if (name === 'agents') return { currentInitiator: () => agentWithHeader({ provider, model }) }
    if (name === 'githubCopilotPreview') return { getView, routeFacts }
    if (name === 'settings') throw new Error('managed route does not use canonical settings')
    return undefined
  }) as typeof ctx.get
  return { ctx, routeFacts }
}

describe('managed account route facts', () => {
  it.each(['openai-responses', 'openai-completions', 'anthropic-messages'])('uses the owning account snapshot for an arbitrary new model on %s', api => {
    const fixture = runtime('future-lab-r17', { api, baseURL: 'https://api.individual.githubcopilot.com' })
    expect(currentChatRoute(fixture.ctx)).toEqual({ provider, model: 'future-lab-r17', api, baseURL: 'https://api.individual.githubcopilot.com' })
    expect(fixture.routeFacts).toHaveBeenCalledExactlyOnceWith('future-lab-r17')
  })
  it('does not fall back to the local GPT-6 catalog when account evidence expires', () => {
    const fixture = runtime('gpt-6-astra', undefined)
    expect(currentChatRoute(fixture.ctx)).toEqual({ provider, model: 'gpt-6-astra' })
  })
  it('copies only protocol and endpoint leaves without exposing private snapshot fields', () => {
    const facts = Object.defineProperty({ api: 'openai-responses', baseURL: 'https://api.business.githubcopilot.com' }, 'accountKey', {
      get() { throw new Error('private snapshot was read') },
    })
    const fixture = runtime('future-model', facts)
    expect(currentChatRoute(fixture.ctx)).toEqual({ provider, model: 'future-model', api: 'openai-responses', baseURL: 'https://api.business.githubcopilot.com' })
  })
  it('honors canonical route protocol instead of unsupported model-entry precedence', () => {
    const ctx = new Context()
    ctx.get = ((name: string) => {
      if (name === 'agents') return { currentInitiator: () => agentWithHeader({ provider: 'github-copilot', model: 'future-model' }) }
      if (name === 'settings') return { get: () => ({ providers: { 'github-copilot': {
        api: 'openai-completions', baseURL: 'https://api.individual.githubcopilot.com',
        models: [{ id: 'future-model', api: 'openai-responses', apis: ['openai-responses'] }],
      } } }) }
      return undefined
    }) as typeof ctx.get
    expect(currentChatRoute(ctx)).toEqual({ provider: 'github-copilot', model: 'future-model',
      api: 'openai-completions', baseURL: 'https://api.individual.githubcopilot.com' })
  })
  it('does not claim an unmounted route belongs to the plugin', () => {
    const ctx = new Context()
    ctx.get = ((name: string) => name === 'agents'
      ? { currentInitiator: () => agentWithHeader({ provider, model: 'future-model' }) } : undefined) as typeof ctx.get
    expect(currentChatRoute(ctx)).toBeUndefined()
  })
})

describe('initiating Session route selection', () => {
  it.each([undefined, {}, { currentInitiator: () => undefined },
    { currentInitiator: () => ({ options: { provider: 'github-copilot', model: 'gpt-5.4' } }) },
    { currentInitiator: () => ({ session: { requestHeader: () => undefined } }) },
  ])('never substitutes the global default or activation options for absent request evidence (%j)', agents => {
    const ctx = new Context()
    const currentSelection = vi.fn(() => ({ provider: 'github-copilot', model: 'gpt-5.4' }))
    ctx.get = ((name: string) => name === 'agents' ? agents
      : name === 'agentDefaultModel' ? { currentSelection } : undefined) as typeof ctx.get
    expect(currentChatRoute(ctx)).toBeUndefined()
    expect(currentChatRoute(ctx, { provider: 'github-copilot', model: 'gpt-5.4' }))
      .toMatchObject({ provider: 'github-copilot', model: 'gpt-5.4', api: 'openai-responses' })
    expect(currentSelection).not.toHaveBeenCalled()
  })

  it.skipIf(typeof AgentRegistry.prototype.withInitiator !== 'function')(
    'uses real installModelSelection request headers across concurrent initiators despite stale activation options', async () => {
      const root = new Context()
      const fiber = await root.plugin(AgentRegistry)
      const agents = root.agents
      const ctx = new Context()
      const defaultRead = vi.fn(() => ({ provider: 'github-copilot', model: 'global-C' }))
      ctx.get = ((name: string) => name === 'agents' ? agents
        : name === 'agentDefaultModel' ? { currentSelection: defaultRead } : undefined) as typeof ctx.get
      const aCtx = new Context(), bCtx = new Context()
      const seed = { provider: 'seed-C', model: 'seed-C' }
      const a = { options: seed, session: Session.create('selection-A' as Agent['id']) } as Agent
      const b = { options: seed, session: Session.create('selection-B' as Agent['id']) } as Agent
      const refA: ModelSelectionRef = { current: { provider: 'github-copilot', model: 'gpt-5.4' }, assembled: undefined }
      const refB: ModelSelectionRef = { current: { provider: 'anthropic', model: 'claude-sonnet-4' }, assembled: undefined }
      const disposeA = installModelSelection(aCtx, refA), disposeB = installModelSelection(bCtx, refB)
      const run = (owner: Agent, ownerCtx: Context) => agents.withInitiator(owner, async () => {
        const input = { sections: [], contexts: [], tools: [], variables: {} }
        await ownerCtx.waterfall('system-prompt/assemble', input, {}, async () => input)
        const config = await agentEvents(ownerCtx, owner).waterfall('agent/request',
          { turn: 1, step: 0, signal: new AbortController().signal }, async () => seed)
        owner.session.append('request/header', { header: { config }, reason: 'initial' })
        await Promise.resolve()
        return currentChatRoute(ctx)
      })
      try {
        expect(agents.withInitiator(a, () => currentChatRoute(ctx))).toBeUndefined()
        const [routeA, routeB] = await Promise.all([run(a, aCtx), run(b, bCtx)])
        expect(routeA).toMatchObject({ provider: 'github-copilot', model: 'gpt-5.4' })
        expect(routeB).toMatchObject({ provider: 'anthropic', model: 'claude-sonnet-4' })
        expect(a.options).toBe(seed)
        expect(b.options).toBe(seed)
        refA.current = { provider: 'github-copilot', model: 'gpt-4.1' }
        // A pending next-step switch cannot change the route of tools from the prior request.
        expect(agents.withInitiator(a, () => currentChatRoute(ctx))?.model).toBe('gpt-5.4')
        expect((await run(a, aCtx))?.model).toBe('gpt-4.1')
        expect(routeA?.model).toBe('gpt-5.4')
        expect(agents.withInitiator(a, () => currentChatRoute(ctx, { provider: 'github-copilot', model: 'gpt-5.6-sol' }))?.model).toBe('gpt-5.6-sol')
        expect(currentChatRoute(ctx)).toBeUndefined()
        expect(defaultRead).not.toHaveBeenCalled()
      } finally {
        disposeA(); disposeB()
        await aCtx.fiber.dispose(); await bCtx.fiber.dispose(); await fiber.dispose()
      }
    },
  )
})
