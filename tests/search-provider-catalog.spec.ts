import { Context } from '@deepseek-ai/cordis'
import { WebRuntime } from '@deepseek-ai/dsh-web'
import { afterEach, describe, expect, it, vi } from 'vitest'
import CopilotRoutedWeb from '../src/routed-web.ts'
import SearchRoutingController from '../src/search-routing-host.ts'
import { SearchProviderCatalogSchema } from '../src/search-routing-remote.ts'

const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })
async function fixture() {
  const ctx = new Context(); contexts.push(ctx)
  const original = new WebRuntime(ctx.isolate('web'))
  ctx.provide('githubCopilotOriginalWeb', original)
  const routed = ctx.plugin(CopilotRoutedWeb); await routed
  const controller = new SearchRoutingController(ctx)
  return { ctx, original, routed, controller }
}

describe('registered search provider catalog', () => {
  it('lists only actual facade registrations without availability checks, auth or search', async () => {
    const f = await fixture()
    const available = vi.fn(() => false), search = vi.fn()
    f.original.registerSearchProvider({ id: 'hidden-original-provider', available, search })
    f.ctx.get('web')!.registerSearchProvider({ id: 'custom-search-z', available, search })
    f.ctx.get('web')!.registerSearchProvider({ id: 'custom-search-a', available, search })
    expect(f.controller.providers()).toEqual({ supported: true, providers: [{ id: 'custom-search-a' }, { id: 'custom-search-z' }] })
    expect(available).not.toHaveBeenCalled(); expect(search).not.toHaveBeenCalled()
    expect(SearchProviderCatalogSchema.safeParse(f.controller.providers()).success).toBe(true)
  })
  it('withdraws registrations with their fiber and does not erase a later registration', async () => {
    const f = await fixture()
    const first = f.ctx.plugin({ apply(c) { c.get('web')!.registerSearchProvider({ id: 'future-provider', available: () => true, search: vi.fn() }) } })
    await first
    expect(f.controller.providers().providers).toEqual([{ id: 'future-provider' }])
    await first.dispose()
    expect(f.controller.providers().providers).toEqual([])
    f.ctx.get('web')!.registerSearchProvider({ id: 'future-provider', available: () => true, search: vi.fn() })
    await first.dispose()
    expect(f.controller.providers().providers).toEqual([{ id: 'future-provider' }])
    await f.routed.dispose()
    expect(f.controller.providers()).toEqual({ supported: false, providers: [] })
  })
  it('keeps original duplicate rejection and returns detached catalog entries', async () => {
    const f = await fixture(), provider = { id: 'one', available: () => true, search: vi.fn() }
    f.ctx.get('web')!.registerSearchProvider(provider)
    expect(() => f.ctx.get('web')!.registerSearchProvider(provider)).toThrow()
    const view = f.controller.providers()
    view.providers[0]!.id = 'mutated-client-data'
    expect(f.controller.providers().providers).toEqual([{ id: 'one' }])
  })
  it('reports a missing catalog without inventing installed providers', () => {
    const ctx = new Context(); contexts.push(ctx)
    const controller = new SearchRoutingController(ctx)
    expect(controller.providers()).toEqual({ supported: false, providers: [] })
    expect(SearchProviderCatalogSchema.safeParse({ supported: true, providers: [{ id: 'x', secret: 'never' }] }).success).toBe(false)
  })
})
