import { describe, expect, it } from 'vitest'
import {
  ensureV1Base,
  GITHUB_COPILOT_CREDENTIAL_KEY,
  resolveCandidates,
  sameCandidates,
  SearchPlan,
  siblingCandidates,
} from '../src/plan.ts'
import type { ProbeOutcome } from '../src/probe.ts'
import { deepseekRoute, fakeContext, makeCandidate } from './helpers.ts'

const planConfig = { probe: true, probeTimeoutMs: 1_000 }

function copilotContext(model = 'gpt-5.4', profile: Record<string, unknown> = {}) {
  return fakeContext({
    agentDefaultModel: { currentSelection: () => ({ provider: 'github-copilot', model }) },
    settings: { get: () => ({ providers: { 'github-copilot': profile } }) },
  })
}

describe('Copilot candidate resolution', () => {
  it('normalizes Anthropic roots to a v1 endpoint base', () => {
    expect(ensureV1Base('https://api.individual.githubcopilot.com')).toBe(
      'https://api.individual.githubcopilot.com/v1',
    )
  })

  it('uses a Copilot Responses route without deriving gateway siblings', () => {
    expect(siblingCandidates(deepseekRoute({
      provider: 'github-copilot',
      model: 'gpt-5.4',
      api: 'openai-responses',
      baseURL: 'https://api.individual.githubcopilot.com',
    }))).toEqual([{
      protocol: 'openai-responses',
      baseURL: 'https://api.individual.githubcopilot.com',
    }])
  })

  it('refuses non-Copilot routes', () => {
    expect(siblingCandidates(deepseekRoute({ provider: 'openai' }))).toEqual([])
    expect(resolveCandidates(fakeContext({
      agentDefaultModel: { currentSelection: () => ({ provider: 'openai', model: 'gpt-5.4' }) },
      settings: { get: () => ({ providers: { openai: {} } }) },
    }), planConfig)).toEqual([])
  })

  it('inherits model, endpoint, protocol, credential record, and catalog headers', () => {
    const [candidate] = resolveCandidates(copilotContext(), planConfig)
    expect(candidate).toMatchObject({
      protocol: 'openai-responses',
      baseURL: 'https://api.individual.githubcopilot.com',
      model: 'gpt-5.4',
      apiKeyEnv: GITHUB_COPILOT_CREDENTIAL_KEY,
      webSearchToolType: 'web_search',
      headers: {
        'Copilot-Integration-Id': 'vscode-chat',
      },
    })
  })

  it('uses the temporary GPT-6 Astra Responses metadata for hosted search', () => {
    expect(resolveCandidates(copilotContext('gpt-6-astra', {
      models: [{ id: 'gpt-6-astra', api: 'openai-responses' }],
    }), planConfig)).toEqual([
      expect.objectContaining({
        protocol: 'openai-responses',
        baseURL: 'https://api.individual.githubcopilot.com',
        model: 'gpt-6-astra',
        headers: expect.objectContaining({
          'Copilot-Integration-Id': 'vscode-chat',
        }),
      }),
    ])
  })

  it('fails closed for a Copilot model whose catalog protocol cannot host search', () => {
    expect(resolveCandidates(copilotContext('gpt-4.1'), planConfig)).toEqual([])
  })

  it('excludes a model-level Completions route and admits a model-level Responses route', () => {
    const mixedRoute = {
      models: [
        { id: 'gemini-3.6-flash', api: 'openai-completions' },
        { id: 'gpt-5.6-sol', api: 'openai-responses' },
      ],
    }
    expect(resolveCandidates(copilotContext('gemini-3.6-flash', mixedRoute), planConfig)).toEqual([])
    expect(resolveCandidates(copilotContext('gpt-5.6-sol', mixedRoute), planConfig)).toEqual([
      expect.objectContaining({
        protocol: 'openai-responses',
        model: 'gpt-5.6-sol',
        webSearchToolType: 'web_search',
      }),
    ])
  })
})

describe('SearchPlan', () => {
  it('selects the first probe-supported candidate and preserves its tool spelling', async () => {
    const first = makeCandidate('openai-responses')
    const second = makeCandidate('anthropic-messages')
    const verdicts: ProbeOutcome[] = [
      { supported: false, detail: 'refused' },
      { supported: true, detail: 'ok' },
    ]
    const plan = new SearchPlan([first, second], async () => verdicts.shift()!, true)
    await expect(plan.settle()).resolves.toEqual(second)
    expect(plan.chosenCandidate()).toEqual(second)
  })

  it('surfaces a named unsupported error when no Copilot search candidate exists', async () => {
    const plan = new SearchPlan([], async () => ({ supported: false, detail: 'unused' }), true)
    await expect(plan.settle()).rejects.toEqual(expect.objectContaining({
      code: 'WEB_PROVIDER_UNAVAILABLE',
    }))
    expect(plan.failureReason()).toContain('GitHub Copilot hosted search is unavailable')
  })

  it('compares static provider headers as part of candidate identity', () => {
    const base = makeCandidate('openai-responses', { headers: { A: 'one' } })
    expect(sameCandidates([base], [{ ...base, headers: { A: 'one' } }])).toBe(true)
    expect(sameCandidates([base], [{ ...base, headers: { A: 'two' } }])).toBe(false)
  })
})
