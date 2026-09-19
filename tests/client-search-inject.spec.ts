// @vitest-environment jsdom
import { Context, Service } from '@deepseek-ai/cordis'
import { act } from 'react'
import type { ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { apply, inject, WebSearchRoutingCard } from '../src/client.ts'

// Actual Cordis dependency tracing and the actual Client apply/render callback.
// The mounted test uses real React DOM and Cordis tracing; Remote transport and
// slot declarations are synthetic. No live Host, credentials or network searches.
class NamedService extends Service {
  constructor(ctx: Context, name: string) { super(ctx, name) }
}

async function fixture(footer: boolean, routingAvailable = true) {
  const root = new Context()
  const registrations = new Map<string, { name: string; render: () => ReactElement }>()
  let remoteDisposals = 0
  const namespace = { ns: 'github-copilot-search-routing', revision: 4, value: { searchProvider: 'auto', defaultSearchProvider: 'none' }, schema: {}, applies: 'live', secrets: [] }
  const describeSettings = vi.fn(async () => ({ ok: true, value: { writable: true, hasDocument: true, namespaces: [namespace] } }))
  const mutateSettings = vi.fn(async () => ({ ok: true, value: { ...namespace, revision: 5 } }))
  class SettingsRemote extends NamedService {
    constructor(ctx: Context) { super(ctx, 'remote.settings') }
    describe = describeSettings
    mutate = mutateSettings
  }
  class RoutingRemote extends NamedService {
    constructor(ctx: Context) { super(ctx, 'remote.githubCopilotSearchRouting') }
    async providers() { return { ok: true, value: { supported: true, providers: [{ id: 'github-copilot-hosted' }] } } }
  }
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
    new SettingsRemote(ctx)
  } })
  const addRouting = () => root.plugin({ apply(ctx) { new RoutingRemote(ctx) } })
  if (routingAvailable) await addRouting()
  const client = root.plugin({ inject, apply })
  await client
  return { root, client, registrations, addRouting, describeSettings, mutateSettings, remoteDisposals: () => remoteDisposals }
}

const searchId = 'github-copilot-search-routing'

describe('search UI traced Remote dependency', () => {
  it.each([true, false])('renders the actual search callback with footer=%s', async footer => {
    const f = await fixture(footer)
    try {
      await vi.waitFor(() => expect(f.registrations.has(searchId)).toBe(true))
      const registration = f.registrations.get(searchId)!
      expect(registration.name).toBe(footer ? 'settings.models.footer' : 'settings.section')
      // The captured faces retain their exact Cordis namespace grants.
      const element = registration.render()
      expect(element.type).toBe(WebSearchRoutingCard)
      expect(element.props.settings.name).toBe('remote.settings')
      expect(element.props).not.toHaveProperty('copilot')
      expect(element.props.routing.name).toBe('remote.githubCopilotSearchRouting')
      expect(registration.render().props.settings).toBe(element.props.settings)
      expect(registration.render().props.routing).toBe(element.props.routing)
      await f.client.dispose()
      expect(f.registrations.size).toBe(0)
      expect(f.remoteDisposals()).toBe(1)
    } finally { await f.root.fiber.dispose() }
  })

  it.each([true, false])('keeps real mounted drafts and pending saves through parent rerenders (footer=%s)', async footer => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    const f = await fixture(footer)
    const container = document.createElement('div')
    document.body.append(container)
    const mounted = createRoot(container)
    try {
      await vi.waitFor(() => expect(f.registrations.has(searchId)).toBe(true))
      const render = f.registrations.get(searchId)!.render
      await act(async () => { mounted.render(render()) })
      const select = container.querySelector<HTMLSelectElement>('[data-dsh-web-search-mode]')!
      await act(async () => {
        select.value = 'github-copilot-hosted'
        select.dispatchEvent(new Event('change', { bubbles: true }))
      })
      await act(async () => { mounted.render(render()) })
      expect(select.value).toBe('github-copilot-hosted')
      expect(f.describeSettings).toHaveBeenCalledTimes(1)
      let finish!: () => void
      f.mutateSettings.mockImplementationOnce(() => new Promise(resolve => {
        finish = () => resolve({ ok: true, value: { ns: searchId, revision: 5,
          value: { searchProvider: 'github-copilot-hosted', defaultSearchProvider: 'none' }, schema: {}, applies: 'live', secrets: [] } })
      }))
      const save = container.querySelector<HTMLButtonElement>('[data-dsh-web-search-save]')!
      await act(async () => { save.click() })
      expect(save.disabled).toBe(true)
      await act(async () => { mounted.render(render()) })
      expect(save.disabled).toBe(true)
      await act(async () => { finish() })
      expect(container.textContent).toContain('Saved.')
      expect(select.value).toBe('github-copilot-hosted')
      expect(f.describeSettings).toHaveBeenCalledTimes(1)
      expect(f.mutateSettings).toHaveBeenCalledExactlyOnceWith(searchId, [
        { op: 'set', path: ['searchProvider'], value: 'github-copilot-hosted' },
        { op: 'set', path: ['defaultSearchProvider'], value: 'none' },
      ], 4)
      expect(container.querySelector('input')).toBeNull()
    } finally {
      await act(async () => { mounted.unmount(); await f.root.fiber.dispose() })
      container.remove()
      Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
    }
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
