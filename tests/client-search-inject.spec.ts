// @vitest-environment jsdom
import { Context, Service } from '@deepseek-ai/cordis'
import { act, createElement } from 'react'
import type { ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { apply, CopilotPluginSettingsPage, HostedSearchSettingsCard, inject, WebSearchRoutingCard } from '../src/client.ts'
import { emptyDiagnostics } from '../src/diagnostics-collector.ts'

// Actual Cordis dependency tracing and the actual Client apply/render callback.
// The mounted test uses real React DOM and Cordis tracing; Remote transport and
// slot declarations are synthetic. No live Host, credentials or network searches.
class NamedService extends Service {
  constructor(ctx: Context, name: string) { super(ctx, name) }
}

const copilotNamespace = { ns: 'github-copilot', revision: 7, value: {
  enabled: true, probe: true, providers: ['github-copilot'], idleTimeoutMs: 300_000,
  searchRouting: { searchProvider: 'auto', defaultSearchProvider: 'none' },
}, schema: {}, applies: 'live' as const, secrets: [], autoGenerate: false }

async function fixture(footer: boolean, routingAvailable = true, bundle = true, optionsAvailable = true) {
  const root = new Context()
  const registrations = new Map<string, { name: string; key?: string; render: (props?: { view: string }) => ReactElement | null }>()
  let remoteDisposals = 0
  const describeSettings = vi.fn(async () => ({ ok: true as const, value: { writable: true, hasDocument: true,
    namespaces: [copilotNamespace] } }))
  const mutateSettings = vi.fn(async (ns: string) => ({ ok: true as const, value: { ...copilotNamespace, ns, revision: 8, autoGenerate: false } }))
  let settingsRemote!: SettingsRemote
  class SettingsRemote extends NamedService {
    constructor(ctx: Context) { super(ctx, 'remote.settings'); settingsRemote = this }
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
    spec(name: string) { return { kind: name === 'plugins.bundle.config' ? 'keyed' : 'list', scope: 'root' } }
    inject(name: string, callback: () => () => void) {
      if ((bundle && name === 'plugins.bundle.config') || name === 'settings.section' || (footer && name === 'settings.models.footer')) return this.ctx.effect(callback)
      return () => {}
    }
    register(options: { name: string; id?: string; key?: string }, render: (props?: { view: string }) => ReactElement | null) {
      return this.ctx.effect(() => {
        const id = options.name === 'plugins.bundle.config' ? searchId : options.id!
        registrations.set(id, { name: options.name, key: options.key, render })
        return () => { registrations.delete(id) }
      })
    }
  }
  await root.plugin({ apply(ctx) {
    new Remote(ctx)
    new Slots(ctx)
    new NamedService(ctx, 'remote.githubCopilot')
    new NamedService(ctx, 'remote.githubCopilotAccounts')
    new NamedService(ctx, 'remote.githubCopilotSessionContinuation')
    new SettingsRemote(ctx)
  } })
  const addRouting = () => root.plugin({ apply(ctx) { new RoutingRemote(ctx) } })
  const addDiagnostics = () => root.plugin({ apply(ctx) {
    class DiagnosticsRemote extends NamedService {
      constructor() { super(ctx, 'remote.githubCopilotDiagnostics') }
      async get() { return { ok: true, value: { enabled: false, state: 'ready', diagnostic: 'none',
        dirty: false, snapshot: emptyDiagnostics() } } }
    }
    new DiagnosticsRemote()
  } })
  if (routingAvailable) await addRouting()
  const client = root.plugin({ inject, apply })
  await client
  return { root, client, registrations, addRouting, addDiagnostics, describeSettings, mutateSettings, settings: settingsRemote, remoteDisposals: () => remoteDisposals }
}

const searchId = 'github-copilot-search-routing'

describe('search UI traced Remote dependency', () => {
  it('mounts late diagnostics without replacing routing drafts or blocking unavailable controls', async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    const f = await fixture(true, true, true)
    const element = document.createElement('div')
    const mounted = createRoot(element)
    try {
      await act(async () => { mounted.render(f.registrations.get(searchId)!.render({ view: 'page' })) })
      expect(element.textContent).toContain('Diagnostics controls are unavailable')
      let diagnostics!: ReturnType<typeof f.addDiagnostics>
      await act(async () => { diagnostics = f.addDiagnostics(); await diagnostics })
      expect(element.textContent).toContain('Collection paused')
      await act(async () => { await diagnostics.dispose() })
      expect(element.textContent).toContain('Diagnostics controls are unavailable')
    } finally {
      await act(async () => { mounted.unmount(); await f.root.fiber.dispose() })
      Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
    }
  })
  it.each([
    { footer: true, bundle: true, seat: 'plugins.bundle.config' },
    { footer: true, bundle: false, seat: 'settings.models.footer' },
    { footer: false, bundle: false, seat: 'settings.section' },
  ])('renders the actual search callback in $seat', async ({ footer, bundle, seat }) => {
    const f = await fixture(footer, true, bundle)
    try {
      await vi.waitFor(() => expect(f.registrations.has(searchId)).toBe(true))
      const registration = f.registrations.get(searchId)!
      expect(registration.name).toBe(seat)
      if (bundle) expect(registration.key).toBe('dsh-github-copilot')
      if (bundle) expect(f.registrations.has('github-copilot-preview')).toBe(true)
      // The captured faces retain their exact Cordis namespace grants.
      const element = registration.render({ view: 'page' })!
      const card = bundle ? element : element.props.children[0]
      if (!bundle) expect(element.props.children).toHaveLength(2)
      expect(card.type).toBe(bundle ? CopilotPluginSettingsPage : WebSearchRoutingCard)
      expect(card.props.settings.name).toBe('remote.settings')
      expect(card.props).not.toHaveProperty('copilot')
      expect(card.props.routing.name).toBe('remote.githubCopilotSearchRouting')
      const next = registration.render({ view: 'page' })!
      const nextCard = bundle ? next : next.props.children[0]
      expect(nextCard.props.settings).toBe(card.props.settings)
      expect(nextCard.props.routing).toBe(card.props.routing)
      if (bundle) expect(registration.render({ view: 'summary' })).toBeNull()
      await f.client.dispose()
      expect(f.registrations.size).toBe(0)
      expect(f.remoteDisposals()).toBe(1)
    } finally { await f.root.fiber.dispose() }
  })

  it.each([true, false])('keeps real mounted drafts and pending saves through parent rerenders (bundle=%s)', async bundle => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    const f = await fixture(true, true, bundle)
    const container = document.createElement('div')
    document.body.append(container)
    const mounted = createRoot(container)
    try {
      await vi.waitFor(() => expect(f.registrations.has(searchId)).toBe(true))
      const render = () => f.registrations.get(searchId)!.render({ view: 'page' })
      await act(async () => { mounted.render(render()) })
      const select = container.querySelector<HTMLSelectElement>('[data-dsh-web-search-mode]')!
      await act(async () => {
        select.value = 'github-copilot-hosted'
        select.dispatchEvent(new Event('change', { bubbles: true }))
      })
      await act(async () => { mounted.render(render()) })
      expect(select.value).toBe('github-copilot-hosted')
      expect(f.describeSettings).toHaveBeenCalledTimes(bundle ? 2 : 1)
      let finish!: () => void
      f.mutateSettings.mockImplementationOnce(() => new Promise(resolve => {
        finish = () => resolve({ ok: true as const, value: { ns: 'github-copilot', revision: 8, autoGenerate: false,
          value: { ...copilotNamespace.value, searchRouting: { searchProvider: 'github-copilot-hosted', defaultSearchProvider: 'none' } }, schema: {}, applies: 'live' as const, secrets: [] } })
      }))
      const save = container.querySelector<HTMLButtonElement>('[data-dsh-web-search-save]')!
      await act(async () => { save.click() })
      expect(save.disabled).toBe(true)
      await act(async () => { mounted.render(render()) })
      expect(save.disabled).toBe(true)
      await act(async () => { finish() })
      expect(container.textContent).toContain('Saved.')
      expect(select.value).toBe('github-copilot-hosted')
      expect(f.describeSettings).toHaveBeenCalledTimes(bundle ? 2 : 1)
      expect(f.mutateSettings).toHaveBeenCalledExactlyOnceWith('github-copilot', [
        { op: 'set', path: ['searchRouting', 'searchProvider'], value: 'github-copilot-hosted' },
        { op: 'set', path: ['searchRouting', 'defaultSearchProvider'], value: 'none' },
      ], 7)
      expect(container.querySelectorAll('input')).toHaveLength(bundle ? 1 : 0)
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
      expect(f.registrations.get(searchId)!.render({ view: 'page' })!.props.routing.name).toBe('remote.githubCopilotSearchRouting')
      await routing.dispose()
      await vi.waitFor(() => expect(f.registrations.has(searchId)).toBe(false))
      expect(f.registrations.has('github-copilot-preview')).toBe(true)
    } finally { await f.root.fiber.dispose() }
  })

  it('saves only edited hosted-search leaves in the existing namespace without broadening the route allowlist', async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    const f = await fixture(true, true, true, true)
    const container = document.createElement('div')
    document.body.append(container)
    const mounted = createRoot(container)
    try {
      await vi.waitFor(() => expect(f.registrations.has(searchId)).toBe(true))
      await act(async () => { mounted.render(createElement(HostedSearchSettingsCard, { settings: f.settings })) })
      const probe = container.querySelector<HTMLInputElement>('[data-dsh-copilot-search-option="probe"]')!
      expect(probe.checked).toBe(true)
      expect(container.querySelector<HTMLInputElement>('[data-dsh-copilot-search-option="providers"]')!.value).toBe('github-copilot')
      await act(async () => { probe.click() })
      await act(async () => { container.querySelector<HTMLButtonElement>('[data-dsh-copilot-search-options-save]')!.click() })
      expect(f.mutateSettings).toHaveBeenCalledExactlyOnceWith('github-copilot', [
        { op: 'set', path: ['probe'], value: false },
      ], 7)
      expect(container.textContent).toContain('Saved Copilot search options.')
      const providers = container.querySelector<HTMLInputElement>('[data-dsh-copilot-search-option="providers"]')!
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(providers, 'github-copilot,github-copilot')
        providers.dispatchEvent(new Event('input', { bubbles: true }))
      })
      await act(async () => { container.querySelector<HTMLButtonElement>('[data-dsh-copilot-search-options-save]')!.click() })
      expect(container.textContent).toContain('Enter distinct route IDs')
      expect(f.mutateSettings).toHaveBeenCalledOnce()
    } finally {
      await act(async () => { mounted.unmount(); await f.root.fiber.dispose() })
      container.remove()
      Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
    }
  })

  it('preserves advanced search edits on a revision conflict without reporting success', async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    const f = await fixture(true, true, true, true)
    f.mutateSettings.mockResolvedValueOnce({ ok: false, error: { code: 'settings-conflict', message: 'PRIVATE_REMOTE_ERROR' } } as never)
    const container = document.createElement('div')
    document.body.append(container)
    const mounted = createRoot(container)
    try {
      await vi.waitFor(() => expect(f.registrations.has(searchId)).toBe(true))
      await act(async () => { mounted.render(createElement(HostedSearchSettingsCard, { settings: f.settings })) })
      const probe = container.querySelector<HTMLInputElement>('[data-dsh-copilot-search-option="probe"]')!
      await act(async () => { probe.click() })
      await act(async () => { container.querySelector<HTMLButtonElement>('[data-dsh-copilot-search-options-save]')!.click() })
      expect(probe.checked).toBe(false)
      expect(container.textContent).toContain('Search settings changed since you opened this page')
      expect(container.textContent).not.toContain('PRIVATE_REMOTE_ERROR')
      expect(container.textContent).not.toContain('Saved Copilot search options.')
      expect(f.mutateSettings).toHaveBeenCalledOnce()
    } finally {
      await act(async () => { mounted.unmount(); await f.root.fiber.dispose() })
      container.remove()
      Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
    }
  })
})
