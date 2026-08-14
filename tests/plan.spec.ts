/**
 * Unit tests for search-plan resolution (config pin vs current chat route)
 * and the probe state machine (auto-disable semantics).
 */

import { describe, expect, it } from 'vitest'
import { WebError } from '@deepseek-ai/dsh-web'
import { ensureV1Base, resolveCandidates, sameCandidates, SearchPlan, siblingCandidates } from '../src/plan.ts'
import type { PlanConfig, SearchProtocol } from '../src/plan.ts'
import type { ProbeOutcome } from '../src/probe.ts'
import { currentChatRoute } from '../src/current-provider.ts'
import { deepseekRoute, fakeContext, makeCandidate } from './helpers.ts'

/** A plan config with the probe left to each test. */
function planConfig(overrides: Partial<PlanConfig> = {}): PlanConfig {
  return { probe: true, probeTimeoutMs: 1000, ...overrides }
}

/** A probe stub whose verdicts are consumed in candidate order. */
function verdictProbe(...verdicts: boolean[]): (candidate: unknown) => Promise<ProbeOutcome> {
  let index = 0
  return async () => {
    const supported = verdicts[index] ?? false
    index += 1
    return { supported, detail: supported ? 'ok' : 'refused' }
  }
}

describe('ensureV1Base', () => {
  it('keeps a v1-included base unchanged', () => {
    expect(ensureV1Base('https://api.deepseek.com/anthropic/v1')).toBe('https://api.deepseek.com/anthropic/v1')
  })

  it('appends /v1 to an SDK-style root base', () => {
    expect(ensureV1Base('https://api.anthropic.com')).toBe('https://api.anthropic.com/v1')
    expect(ensureV1Base('https://gateway.example/anthropic/')).toBe('https://gateway.example/anthropic/v1')
  })
})

describe('siblingCandidates', () => {
  it('asks a search-capable route on its own protocol alone', () => {
    expect(siblingCandidates(deepseekRoute({ api: 'anthropic-messages', baseURL: 'https://gw.example/anthropic/v1' })))
      .toEqual([{ protocol: 'anthropic-messages', baseURL: 'https://gw.example/anthropic/v1' }])
  })

  it('derives the DeepSeek siblings for a chat-completions route', () => {
    expect(siblingCandidates(deepseekRoute())).toEqual([
      { protocol: 'openai-responses', baseURL: 'https://api.deepseek.com' },
      { protocol: 'anthropic-messages', baseURL: 'https://api.deepseek.com/anthropic/v1' },
    ])
  })

  it('derives the DeepSeek siblings for a gateway on the official host', () => {
    expect(siblingCandidates(deepseekRoute({ provider: 'acme', baseURL: 'https://api.deepseek.com/custom' })))
      .toEqual([
        { protocol: 'openai-responses', baseURL: 'https://api.deepseek.com/custom' },
        { protocol: 'anthropic-messages', baseURL: 'https://api.deepseek.com/custom/anthropic/v1' },
      ])
  })

  it('derives the DeepSeek siblings for the legacy deepseek-official route alias', () => {
    const ctx = fakeContext({
      agentDefaultModel: { currentSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-v4-flash' }) },
      settings: { get: () => ({ providers: { 'deepseek-official': { apiKeyEnv: 'DEEPSEEK_API_KEY' } } }) },
    })
    const candidates = resolveCandidates(ctx, planConfig())
    expect(candidates.map(candidate => candidate.protocol)).toEqual(['openai-responses', 'anthropic-messages'])
    expect(candidates[0]?.baseURL).toBe('https://api.deepseek.com')
    expect(candidates[1]?.baseURL).toBe('https://api.deepseek.com/anthropic/v1')
    expect(candidates[0]?.apiKeyEnv).toBe('DEEPSEEK_API_KEY')
  })

  it('derives only the Responses sibling for an OpenAI route', () => {
    expect(siblingCandidates(deepseekRoute({ provider: 'openai', baseURL: 'https://api.openai.com/v1' })))
      .toEqual([{ protocol: 'openai-responses', baseURL: 'https://api.openai.com/v1' }])
  })

  it('yields nothing for an unknown gateway route', () => {
    expect(siblingCandidates(deepseekRoute({ provider: 'acme', baseURL: 'https://acme.example/v1' }))).toEqual([])
  })
})

describe('resolveCandidates', () => {
  it('pins a single candidate when the config names a protocol', () => {
    const ctx = fakeContext({})
    const candidates = resolveCandidates(ctx, planConfig({ protocol: 'openai-responses', baseURL: 'https://gw.example/v1', model: 'm-1', apiKeyEnv: 'K' }))
    expect(candidates).toEqual([
      makeCandidate('openai-responses', { baseURL: 'https://gw.example/v1', model: 'm-1', apiKeyEnv: 'K' }),
    ])
  })

  it('pins the anthropic protocol and normalizes its base', () => {
    const ctx = fakeContext({})
    const candidates = resolveCandidates(ctx, planConfig({ protocol: 'anthropic-messages', baseURL: 'https://api.anthropic.com' }))
    expect(candidates[0]?.baseURL).toBe('https://api.anthropic.com/v1')
  })

  it('inherits the current route when no protocol is pinned', () => {
    const ctx = fakeContext({
      agentDefaultModel: { currentSelection: () => ({ provider: 'deepseek', model: 'deepseek-v4-flash' }) },
      settings: { get: () => ({ providers: { deepseek: { apiKeyEnv: 'MY_KEY' } } }) },
    })
    const candidates = resolveCandidates(ctx, planConfig())
    expect(candidates.map(candidate => candidate.protocol)).toEqual(['openai-responses', 'anthropic-messages'])
    for (const candidate of candidates) {
      expect(candidate.model).toBe('deepseek-v4-flash')
      expect(candidate.apiKeyEnv).toBe('MY_KEY')
    }
    expect(candidates[0]?.baseURL).toBe('https://api.deepseek.com')
    expect(candidates[1]?.baseURL).toBe('https://api.deepseek.com/anthropic/v1')
  })

  it('serves an OpenAI route on the Responses protocol it already speaks', () => {
    const ctx = fakeContext({
      agentDefaultModel: { currentSelection: () => ({ provider: 'openai', model: 'gpt-5.6' }) },
      settings: { get: () => ({ providers: { openai: { api: 'openai-responses', baseURL: 'https://gw.example/v1', apiKeyEnv: 'OPENAI_API_KEY' } } }) },
    })
    const candidates = resolveCandidates(ctx, planConfig())
    expect(candidates).toHaveLength(1)
    expect(candidates[0]).toMatchObject({ protocol: 'openai-responses', baseURL: 'https://gw.example/v1' })
  })

  it('resolves an unprofilable route through the pi-ai catalog', () => {
    const ctx = fakeContext({
      agentDefaultModel: { currentSelection: () => ({ provider: 'deepseek', model: 'deepseek-v4-flash' }) },
      settings: { get: () => ({ providers: {} }) },
    })
    const route = currentChatRoute(ctx)
    // The route itself carries no key reference (that lives on the profile);
    // the catalog supplies protocol and base URL.
    expect(route).toMatchObject({ api: 'openai-completions', baseURL: 'https://api.deepseek.com' })
    expect(route?.apiKeyEnv).toBeUndefined()
  })

  it('falls back to a known credential reference for a profilable catalog route', () => {
    const ctx = fakeContext({
      agentDefaultModel: { currentSelection: () => ({ provider: 'deepseek', model: 'deepseek-v4-flash' }) },
      settings: { get: () => ({ providers: {} }) },
    })
    const candidates = resolveCandidates(ctx, planConfig())
    expect(candidates[0]?.apiKeyEnv).toBe('DEEPSEEK_API_KEY')
  })

  it('returns no candidates without a route and without a pin', () => {
    const ctx = fakeContext({})
    expect(resolveCandidates(ctx, planConfig())).toEqual([])
  })
})

describe('SearchPlan', () => {
  it('trusts the first candidate when probing is disabled', async () => {
    const plan = new SearchPlan([makeCandidate('openai-responses')], verdictProbe(false), false)
    expect(plan.available()).toBe(true)
    expect((await plan.settle()).protocol).toBe('openai-responses')
  })

  it('picks the first candidate that passes the probe', async () => {
    const candidates = [
      makeCandidate('openai-responses'),
      makeCandidate('anthropic-messages'),
    ]
    const plan = new SearchPlan(candidates, verdictProbe(false, true), true)
    expect(plan.available()).toBe(true)
    expect((await plan.settle()).protocol).toBe('anthropic-messages')
  })

  it('auto-disables when every candidate fails the probe', async () => {
    const plan = new SearchPlan([makeCandidate('openai-responses')], verdictProbe(false), true)
    // While the probe is in flight the plan still admits calls so the first
    // search can await the verdict instead of failing spuriously.
    expect(plan.available()).toBe(true)
    await plan.settled
    expect(plan.available()).toBe(false)
    await expect(plan.settle()).rejects.toMatchObject({ code: 'WEB_PROVIDER_UNAVAILABLE' })
    expect(plan.failureReason()).toContain('refused')
  })

  it('auto-disables with a named reason when no candidate exists', async () => {
    const plan = new SearchPlan([], verdictProbe(), true)
    expect(plan.available()).toBe(false)
    await expect(plan.settle()).rejects.toMatchObject({ code: 'WEB_PROVIDER_UNAVAILABLE' })
    expect(plan.failureReason()).toContain('no search-capable provider')
  })
})

describe('sameCandidates', () => {
  it('is true for identical candidate sets', () => {
    expect(sameCandidates(
      [makeCandidate('openai-responses')],
      [makeCandidate('openai-responses')],
    )).toBe(true)
  })

  it('is false when any resolved fact differs', () => {
    expect(sameCandidates(
      [makeCandidate('openai-responses')],
      [makeCandidate('openai-responses', { model: 'other' })],
    )).toBe(false)
    expect(sameCandidates(
      [makeCandidate('openai-responses')],
      [makeCandidate('anthropic-messages')],
    )).toBe(false)
  })
})
