import { describe, expect, it } from 'vitest'
import {
  NO_DEFAULT_SEARCH_PROVIDER,
  WEB_SEARCH_ROUTING_SETTINGS_NAMESPACE,
  WebSearchRoutingConfigSchema,
  normalizeWebSearchRouting,
} from '../src/web-search-routing-config.ts'
import type { WebSearchRoutingConfig } from '../src/web-search-routing-config.ts'
import { normalizeWebSearchRouting as normalizeClientPolicy } from '../src/search-routing-policy.ts'

describe('web search routing settings', () => {
  it('reexports the same Client-safe policy normalizer used by both settings surfaces', () => {
    expect(normalizeWebSearchRouting).toBe(normalizeClientPolicy)
  })

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

  it('keeps the primary optional in schema defaults for legacy settings', () => {
    expect(WebSearchRoutingConfigSchema({})).not.toHaveProperty('searchProvider')
    expect(WebSearchRoutingConfigSchema({ searchProvider: 'future-search', defaultSearchProvider: 'exa' }))
      .toMatchObject({ searchProvider: 'future-search', defaultSearchProvider: 'exa' })
  })

  it.each([
    [{}, { primaryProvider: 'auto', defaultProvider: 'deepseek-official', legacy: true }],
    [{ searchMode: 'auto', defaultSearchProvider: 'future-search' }, { primaryProvider: 'auto', defaultProvider: 'future-search', legacy: true }],
    [{ searchMode: 'fixed', defaultSearchProvider: 'future-search' }, { primaryProvider: 'future-search', defaultProvider: 'future-search', legacy: true }],
    [{ searchMode: 'fixed', defaultSearchProvider: 'none' }, { primaryProvider: 'none', defaultProvider: 'none', legacy: true }],
    [{ searchMode: 'auto', defaultSearchProvider: 'none' }, { primaryProvider: 'auto', defaultProvider: 'none', legacy: true }],
    [{ searchMode: 'fixed', searchProvider: 'auto', defaultSearchProvider: 'exa' }, { primaryProvider: 'auto', defaultProvider: 'exa', legacy: false }],
    [{ searchMode: 'auto', searchProvider: 'future-search', defaultSearchProvider: 'exa' }, { primaryProvider: 'future-search', defaultProvider: 'exa', legacy: false }],
    [{ searchProvider: 'none', defaultSearchProvider: 'exa' }, { primaryProvider: 'none', defaultProvider: 'exa', legacy: false }],
    [{ searchProvider: '  MiXeD-id  ', defaultSearchProvider: '  Other-id  ' }, { primaryProvider: 'MiXeD-id', defaultProvider: 'Other-id', legacy: false }],
    [{ searchProvider: ' ', defaultSearchProvider: '' }, { primaryProvider: 'auto', defaultProvider: 'deepseek-official', legacy: false }],
  ] satisfies Array<[WebSearchRoutingConfig, { primaryProvider: string; defaultProvider: string; legacy: boolean }]>)('normalizes %j without changing saved settings', (configuration, expected) => {
    const frozen = Object.freeze({ ...configuration })
    expect(normalizeWebSearchRouting(frozen)).toEqual(expected)
    expect(frozen).toEqual(configuration)
  })

  it('rejects invalid routing modes and non-string provider ids', () => {
    expect(() => WebSearchRoutingConfigSchema({ searchMode: 'round-robin' } as unknown as WebSearchRoutingConfig)).toThrow()
    expect(() => WebSearchRoutingConfigSchema({ defaultSearchProvider: 42 } as unknown as WebSearchRoutingConfig)).toThrow()
    expect(() => WebSearchRoutingConfigSchema({ searchProvider: 42 } as unknown as WebSearchRoutingConfig)).toThrow()
  })
})
