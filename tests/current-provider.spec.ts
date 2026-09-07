import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { currentChatRoute } from '../src/current-provider.ts'
import { GITHUB_COPILOT_PREVIEW_PROVIDER_ID as provider } from '../src/copilot-identity.ts'

function runtime(model: string, facts: unknown) {
  const ctx = new Context()
  const routeFacts = vi.fn(() => facts)
  const getView = vi.fn(() => ({ provider }))
  ctx.get = ((name: string) => {
    if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider, model }) }
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
      if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'github-copilot', model: 'future-model' }) }
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
    ctx.get = ((name: string) => name === 'agentDefaultModel'
      ? { currentSelection: () => ({ provider, model: 'future-model' }) } : undefined) as typeof ctx.get
    expect(currentChatRoute(ctx)).toBeUndefined()
  })
})
