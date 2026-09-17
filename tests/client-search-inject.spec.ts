import { Context, Service } from '@deepseek-ai/cordis'
import type { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { apply, inject, WebSearchRoutingCard } from '../src/client.ts'

// Actual Cordis dependency tracing and the actual Client apply/render callback.
// Only the Remote transport and slot declarations are synthetic: no browser,
// live Host, credentials, settings writes, model discovery or search requests.
class NamedService extends Service {
  constructor(ctx: Context, name: string) { super(ctx, name) }
}

async function fixture(footer: boolean, routingAvailable = true) {
  const root = new Context()
  const registrations = new Map<string, { name: string; render: () => ReactElement }>()
  let remoteDisposals = 0
  class Remote extends NamedService {
    constructor(ctx: Context) { super(ctx, 'remote') }
    async $mount() { return this.ctx.effect(() => () => { remoteDisposals++ }) }
    $on() { return () => {} }
  }
  class Slots extends NamedService {
    constructor(ctx: Context) { super(ctx, 'slots') }
    spec() { return { kind: 'list', scope: 'root' } }
    inject(name: string, callback: () => () => void) {
      if (name === 'settings.section' || (footer && name === 'settings.models.footer')) return this.ctx.effect(callback)
      return () => {}
    }
    register(options: { name: string; id: string }, render: () => ReactElement) {
      return this.ctx.effect(() => {
        registrations.set(options.id, { name: options.name, render })
        return () => { registrations.delete(options.id) }
      })
    }
  }
  await root.plugin({ apply(ctx) {
    new Remote(ctx)
    new Slots(ctx)
    new NamedService(ctx, 'remote.githubCopilot')
    new NamedService(ctx, 'remote.settings')
  } })
  const addRouting = () => root.plugin({ apply(ctx) { new NamedService(ctx, 'remote.githubCopilotSearchRouting') } })
  if (routingAvailable) await addRouting()
  const client = root.plugin({ inject, apply })
  await client
  return { root, client, registrations, addRouting, remoteDisposals: () => remoteDisposals }
}

const searchId = 'github-copilot-search-routing'

describe('search UI traced Remote dependency', () => {
  it.each([true, false])('renders the actual search callback with footer=%s', async footer => {
    const f = await fixture(footer)
    try {
      await vi.waitFor(() => expect(f.registrations.has(searchId)).toBe(true))
      const registration = f.registrations.get(searchId)!
      expect(registration.name).toBe(footer ? 'settings.models.footer' : 'settings.section')
      // Reading all three props crosses Cordis namespace tracing. Omitting the
      // routing grant throws here even though the parent declares remote.
      const element = registration.render()
      expect(element.type).toBe(WebSearchRoutingCard)
      expect(element.props.settings.name).toBe('remote.settings')
      expect(element.props.copilot.name).toBe('remote.githubCopilot')
      expect(element.props.routing.name).toBe('remote.githubCopilotSearchRouting')
      await f.client.dispose()
      expect(f.registrations.size).toBe(0)
      expect(f.remoteDisposals()).toBe(1)
    } finally { await f.root.fiber.dispose() }
  })

  it('keeps account UI active while routing waits, and removes search UI on service loss', async () => {
    const f = await fixture(true, false)
    try {
      expect(f.registrations.has('github-copilot-preview')).toBe(true)
      expect(f.registrations.has(searchId)).toBe(false)
      const routing = f.addRouting()
      await routing
      await vi.waitFor(() => expect(f.registrations.has(searchId)).toBe(true))
      expect(f.registrations.get(searchId)!.render().props.routing.name).toBe('remote.githubCopilotSearchRouting')
      await routing.dispose()
      await vi.waitFor(() => expect(f.registrations.has(searchId)).toBe(false))
      expect(f.registrations.has('github-copilot-preview')).toBe(true)
    } finally { await f.root.fiber.dispose() }
  })
})
