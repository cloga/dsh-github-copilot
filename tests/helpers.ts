/**
 * Shared test fixtures: a minimal `Context` fake covering exactly the
 * `ctx.get` reads the plugin performs, and candidate/route factories.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CurrentChatRoute } from '../src/current-provider.ts'
import type { SearchPlanCandidate } from '../src/plan.ts'

/** The services `currentChatRoute` reads, faked per test. */
export interface FakeServices {
  agentDefaultModel?: { currentSelection(): { provider: string; model: string } | undefined }
  settings?: { get(namespace: unknown): unknown }
}

/** Build a context whose `ctx.get` serves the given fakes. */
export function fakeContext(services: FakeServices): Context {
  const store = new Map<string, unknown>()
  if (services.agentDefaultModel !== undefined) store.set('agentDefaultModel', services.agentDefaultModel)
  if (services.settings !== undefined) store.set('settings', services.settings)
  return {
    get: (name: string) => store.get(name),
  } as unknown as Context
}

/** A deepseek-style chat route, the fixture most plan tests share. */
export function deepseekRoute(overrides: Partial<CurrentChatRoute> = {}): CurrentChatRoute {
  return {
    provider: 'deepseek',
    model: 'deepseek-v4-flash',
    api: 'openai-completions',
    baseURL: 'https://api.deepseek.com',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    ...overrides,
  }
}

/** A candidate for one protocol with defaulted facts. */
export function makeCandidate(protocol: SearchPlanCandidate['protocol'], overrides: Partial<SearchPlanCandidate> = {}): SearchPlanCandidate {
  return {
    protocol,
    baseURL: protocol === 'anthropic-messages' ? 'https://api.deepseek.com/anthropic/v1' : 'https://api.deepseek.com',
    model: 'deepseek-v4-flash',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    apiVersion: '2023-06-01',
    ...protocol === 'openai-responses' ? { webSearchToolType: 'web_search' } : {},
    ...overrides,
  }
}
