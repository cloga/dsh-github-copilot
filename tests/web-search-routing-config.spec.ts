import { describe, expect, it } from 'vitest'
import {
  NO_DEFAULT_SEARCH_PROVIDER,
  WEB_SEARCH_ROUTING_SETTINGS_NAMESPACE,
  WebSearchRoutingConfigSchema,
} from '../src/web-search-routing-config.ts'
import type { WebSearchRoutingConfig } from '../src/web-search-routing-config.ts'

describe('web search routing settings', () => {
  it('uses auto routing with DeepSeek as the shipped default provider', () => {
    expect(WebSearchRoutingConfigSchema({})).toEqual({
      searchMode: 'auto',
      defaultSearchProvider: 'deepseek-official',
    })
    expect(WEB_SEARCH_ROUTING_SETTINGS_NAMESPACE).toBe('github-copilot-search-routing')
  })

  it('supports fixed routing, disabled fallback, and arbitrary registered provider ids', () => {
    expect(WebSearchRoutingConfigSchema({
      searchMode: 'fixed',
      defaultSearchProvider: 'github-copilot-hosted',
    })).toMatchObject({ searchMode: 'fixed', defaultSearchProvider: 'github-copilot-hosted' })
    expect(WebSearchRoutingConfigSchema({ defaultSearchProvider: NO_DEFAULT_SEARCH_PROVIDER }).defaultSearchProvider)
      .toBe('none')
    expect(WebSearchRoutingConfigSchema({ defaultSearchProvider: 'exa' }).defaultSearchProvider).toBe('exa')
  })

  it('rejects invalid routing modes and non-string provider ids', () => {
    expect(() => WebSearchRoutingConfigSchema({ searchMode: 'round-robin' } as unknown as WebSearchRoutingConfig)).toThrow()
    expect(() => WebSearchRoutingConfigSchema({ defaultSearchProvider: 42 } as unknown as WebSearchRoutingConfig)).toThrow()
  })
})
