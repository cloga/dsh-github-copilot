import { Context, Service } from '@deepseek-ai/cordis'
import type { ReactElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as client from '../src/client.ts'

// Execute the actual Client apply() with real Cordis dependency tracing. Only
// Remote transport and public slot declarations are synthetic; no live account,
// browser, settings writes or Session creation is involved.
const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })
class NamedService extends Service {
  constructor(ctx: Context, name: string) { super(ctx, name) }
}
interface Seat {
  name: string
  id?: string
  key?: string
  label?: string
}
interface Registration extends Seat {
  render: (props: Record<string, unknown>) => ReactElement | null
}
const footerSlot = 'settings.models.footer'
const sectionSlot = 'settings.section'
const providerSlot = 'settings.models.provider-card'
const usageSlot = 'conversation.composer.dock'

async function fixture(footer: boolean, legacyRemote: boolean) {
  const root = new Context()
  contexts.push(root)
  const registrations = new Map<string, Registration>()
  const attempts: Seat[] = []
  const watchers = new Set<{ name: string; activate: () => void; deactivate: () => void }>()
  const declared = new Set([sectionSlot, providerSlot, usageSlot, ...footer ? [footerSlot] : []])
  const legacyCalls = { view: vi.fn(), save: vi.fn(), create: vi.fn() }
  const disposeRemote = vi.fn()
  class Remote extends NamedService {
    constructor(ctx: Context) { super(ctx, 'remote') }
    async $mount() { return this.ctx.effect(() => disposeRemote) }
    $on() { return () => {} }
  }
  class LegacyRoles extends NamedService {
    constructor(ctx: Context) { super(ctx, 'remote.githubCopilotDualModel') }
    view = legacyCalls.view
    save = legacyCalls.save
    create = legacyCalls.create
  }
  class UsageRemote extends NamedService {
    constructor(ctx: Context) { super(ctx, 'remote.githubCopilotUsage') }
    get = vi.fn()
    refresh = vi.fn()
  }
  class Slots extends NamedService {
    constructor(ctx: Context) { super(ctx, 'slots') }
    spec(name: string) {
      return { kind: name === providerSlot ? 'keyed' : 'list', scope: name === usageSlot ? 'session' : 'root' }
    }
    inject(name: string, callback: () => () => void) {
      return this.ctx.effect(() => {
        let cleanup: (() => void) | undefined
        const watcher = {
          name,
          activate: () => { cleanup ??= callback() },
          deactivate: () => { cleanup?.(); cleanup = undefined },
        }
        watchers.add(watcher)
        if (declared.has(name)) watcher.activate()
        return () => { watcher.deactivate(); watchers.delete(watcher) }
      })
    }
    register(seat: Seat, render: Registration['render']) {
      return this.ctx.effect(() => {
        const key = `${seat.name}:${seat.id ?? seat.key}`
        if (registrations.has(key)) throw new Error(`Duplicate slot registration: ${key}`)
        attempts.push({ ...seat })
        registrations.set(key, { ...seat, render })
        return () => { registrations.delete(key) }
      })
    }
  }
  await root.plugin({ apply(ctx) {
    new Remote(ctx)
    new Slots(ctx)
    new NamedService(ctx, 'remote.githubCopilot')
    new NamedService(ctx, 'remote.settings')
    new NamedService(ctx, 'remote.githubCopilotSearchRouting')
    new UsageRemote(ctx)
  } })
  const addLegacyRemote = () => root.plugin({ apply(ctx) { new LegacyRoles(ctx) } })
  if (legacyRemote) await addLegacyRemote()
  const mounted = root.plugin({ inject: client.inject, apply: client.apply })
  await mounted
  await vi.waitFor(() => expect(registrations.has(`${usageSlot}:github-copilot-usage`)).toBe(true))
  const setFooter = (enabled: boolean) => {
    if (enabled) declared.add(footerSlot)
    else declared.delete(footerSlot)
    for (const watcher of watchers) {
      if (watcher.name === footerSlot) {
        if (enabled) watcher.activate()
        else watcher.deactivate()
      }
    }
  }
  return { mounted, registrations, attempts, legacyCalls, disposeRemote, watchers, addLegacyRemote, setFooter }
}
type Fixture = Awaited<ReturnType<typeof fixture>>

function expectOnlyRetainedUi(f: Fixture, footer: boolean) {
  const settingsSlot = footer ? footerSlot : sectionSlot
  const accountId = footer ? 'github-copilot-preview' : 'github-copilot'
  expect([...f.registrations.keys()].sort()).toEqual([
    `${providerSlot}:llm-pi-ai`, `${settingsSlot}:${accountId}`,
    `${settingsSlot}:github-copilot-search-routing`, `${usageSlot}:github-copilot-usage`,
  ].sort())
  // Adjacent positive assertions rule out an unactivated Client or empty registry.
  const account = f.registrations.get(`${settingsSlot}:${accountId}`)!.render({})!
  expect(account.type).toBe(client.GitHubCopilotAccountSurface)
  const search = f.registrations.get(`${settingsSlot}:github-copilot-search-routing`)!.render({})!
  expect(search.type).toBe(client.WebSearchRoutingCard)
  const provider = f.registrations.get(`${providerSlot}:llm-pi-ai`)!.render({
    provider: { provider: 'github-copilot', settingsNs: 'llm-pi-ai' }, configured: true,
  })!
  expect(provider.type).toBe(client.GitHubCopilotAccountSurface)
  expect(provider.props.eligible).toBe(true)
  expect(f.registrations.get(`${usageSlot}:github-copilot-usage`)!.render({
    sessionId: 'existing-session', useSession: () => undefined, useProjection: () => undefined,
  })).not.toBeNull()
  // Inspect every attempted registration, not only the final active map: a
  // transient role footer/legacy section must not be hidden by later disposal.
  expect(f.attempts.some(seat => seat.id === 'github-copilot-dual-model')).toBe(false)
  expect(f.attempts.some(seat => /model roles|模型分工/i.test(seat.label ?? ''))).toBe(false)
  for (const call of Object.values(f.legacyCalls)) expect(call).not.toHaveBeenCalled()
}

describe('Client model-role retirement', () => {
  it('does not export the obsolete role card while preserving search and usage components', () => {
    expect(client).not.toHaveProperty('DualModelCard')
    expect(client.WebSearchRoutingCard).toBeTypeOf('function')
    expect(client.CopilotUsageCard).toBeTypeOf('function')
  })

  it.each([
    { footer: true, legacyRemote: true }, { footer: false, legacyRemote: true },
    { footer: true, legacyRemote: false }, { footer: false, legacyRemote: false },
  ])('never registers role entrypoints (footer=$footer, legacyRemote=$legacyRemote)', async ({ footer, legacyRemote }) => {
    const f = await fixture(footer, legacyRemote)
    expectOnlyRetainedUi(f, footer)
    f.setFooter(!footer)
    expectOnlyRetainedUi(f, !footer)
    f.setFooter(footer)
    expectOnlyRetainedUi(f, footer)
    await f.mounted.dispose()
    expect(f.registrations.size).toBe(0)
    expect(f.watchers.size).toBe(0)
    expect(f.disposeRemote).toHaveBeenCalledOnce()
  })

  it('does not resurrect a role entry when a retained legacy Remote arrives later', async () => {
    const f = await fixture(false, false)
    expectOnlyRetainedUi(f, false)
    const legacy = f.addLegacyRemote()
    await legacy
    f.setFooter(true)
    expectOnlyRetainedUi(f, true)
    await legacy.dispose()
    f.setFooter(false)
    expectOnlyRetainedUi(f, false)
  })
})
