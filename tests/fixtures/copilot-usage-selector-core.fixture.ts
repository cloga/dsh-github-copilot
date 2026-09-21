// @vitest-environment jsdom
// Run by verify-tagged-core.mjs on unchanged 0.1.6-alpha.1/alpha.2 only.
// Public ui-renderer/client apply -> SlotRegistry.installScope -> SessionProvider
// -> bindings.observableHook -> bindSnapshotSelector -> uSES-with-selector.
// No copied hook, private import, or selector-ignoring useSession substitute.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import * as UiRenderer from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { ScopedStandardSourceBinding, SlotScopeAdapter } from '@deepseek-ai/dsh-client-ui-renderer/client'
import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const dock = 'conversation.composer.dock'
function source<T>(initial: T) {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => value,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    set(next: T) { value = next; for (const listener of listeners) listener() },
    subscribers: () => listeners.size,
  }
}

function builtClient() {
  let handoff: { id: string; factory(require: (id: string) => unknown): { inject: string[]; apply: (ctx: Context) => Promise<() => Promise<void>> } } | undefined
  // Same ModuleLoader handoff used by tests/client-bundle.spec.ts, real React.
  // Optional explicit archived artifact supports reproducing the released red baseline.
  const target = window as Window & { __ModuleLoader__?: unknown }
  const previous = target.__ModuleLoader__
  target.__ModuleLoader__ = { load(value: NonNullable<typeof handoff>) { handoff = value } }
  try {
    new Function('window', readFileSync(resolve(process.env.DSH_COPILOT_CLIENT_ARTIFACT ?? 'lib/client.js'), 'utf8'))(window)
  } finally {
    if (previous === undefined) delete target.__ModuleLoader__
    else target.__ModuleLoader__ = previous
  }
  expect(handoff?.id).toBe('dsh-github-copilot')
  return handoff!.factory(id => {
    if (id === 'react') return React
    throw new Error(`Unexpected built Client external: ${id}`)
  })
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('built usage Client under the pinned Core selector and Slot error boundary', () => {
  it.each(['github-copilot', 'github-copilot-preview'])('renders and reacts to the owning Session on %s', async provider => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const network = vi.fn(() => { throw new Error('No network is allowed in the usage selector fixture') })
    vi.stubGlobal('fetch', network)
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const ctx = new Context()
    const quota = vi.fn(async () => ({ ok: true, value: {
      state: 'ready', billing: 'credits', budget: 'individual', used: 7, remaining: 13, limit: 20, observedAt: 1,
    } }))
    const refresh = vi.fn(async () => { throw new Error('No forced quota refresh expected') })
    // Transport registration only; there are no auth/model/credential methods.
    // The sole business Remote supplied by this fixture is synthetic quota data.
    class RemoteRoot extends Service {
      constructor(context: Context) { super(context, 'remote') }
      async $mount() { return async () => {} }
      $on() { return () => {} }
    }
    class AccountNamespace extends Service {
      constructor(context: Context) { super(context, 'remote.githubCopilot') }
    }
    class UsageRemote extends Service {
      constructor(context: Context) { super(context, 'remote.githubCopilotUsage') }
      get = quota
      refresh = refresh
    }
    const session = source({ sessionId: 'usage-session', removed: false, openState: 'open' })
    const selection = (route: string) => ({ provider: route, model: 'synthetic-account-model' })
    const projection = source({ lastUsed: selection('other-provider'), next: selection(provider) })
    const container = document.createElement('div')
    document.body.append(container)
    let unmount = () => {}
    let disposeClient: (() => Promise<void>) | undefined
    try {
      await ctx.plugin({ inject: UiRenderer.inject, apply: UiRenderer.apply })
      await ctx.plugin({ apply(context) { new RemoteRoot(context); new AccountNamespace(context); new UsageRemote(context) } })
      const slots = ctx.get('slots')!
      const binding: ScopedStandardSourceBinding = {
        key: 'usage-session', ctx,
        hooks: { session },
        keyedHooks: { projection: key => key === 'modelSelection' ? projection : undefined },
        props: { sessionId: 'usage-session' },
      }
      const current = source(binding)
      // alpha.1 resolves keys; alpha.2 resolves explicit target observables.
      // Both consume the same synthetic data, never a synthetic React hook.
      const renderArea: NonNullable<SlotScopeAdapter['renderArea']> = (_binding, props) => props.children as React.ReactNode
      const adapter = {
        current,
        resolve: (key: string) => key === binding.key ? binding : undefined,
        bindingSource: () => current,
        renderArea,
      }
      slots.installScope('session', adapter)
      // Fixture owns the root/dock declaration. Core owns every hook and entry
      // boundary, including abdication after a selector TypeError in alpha.32.
      slots.register({ name: 'root', children: { [dock]: { kind: 'list', scope: 'session' } } },
        ({ renderSlot, SessionProvider }) => React.createElement(SessionProvider, {},
          React.createElement('div', {}, renderSlot(dock, {}),
            React.createElement('span', { 'data-native-context': true }, 'Context 34%'))))
      const client = ctx.plugin(builtClient())
      await client
      disposeClient = async () => { await client.dispose() }
      expect(slots.entriesOfSlot(dock)).toHaveLength(1)
      await React.act(async () => { unmount = ctx.get('uiRenderer')!.mount(container) })
      expect(errors).not.toHaveBeenCalled()
      expect(container.querySelector('[data-copilot-usage-trigger]')).not.toBeNull()
      expect(container.textContent).toContain('7 used')
      expect(quota).toHaveBeenCalledTimes(1)
      const native = container.querySelector('[data-native-context]')
      expect(native).not.toBeNull()
      expect(session.subscribers()).toBeGreaterThan(0)

      // Session notifications must flow through Core's selector subscription.
      await React.act(async () => { session.set({ sessionId: 'usage-session', removed: true, openState: 'open' }) })
      expect(container.querySelector('[data-copilot-usage-trigger]')).toBeNull()
      await React.act(async () => { session.set({ sessionId: 'usage-session', removed: false, openState: 'open' }) })
      expect(container.querySelector('[data-copilot-usage-trigger]')).not.toBeNull()
      expect(quota).toHaveBeenCalledTimes(2)
      await React.act(async () => { projection.set({ lastUsed: selection(provider), next: selection('other-provider') }) })
      expect(container.querySelector('[data-copilot-usage-trigger]')).toBeNull()
      expect(quota).toHaveBeenCalledTimes(2)
      expect(container.querySelector('[data-native-context]')).toBe(native)
      expect(errors).not.toHaveBeenCalled()
      expect(refresh).not.toHaveBeenCalled()
      expect(network).not.toHaveBeenCalled()
      await React.act(async () => { await disposeClient!() })
      disposeClient = undefined
      expect(slots.entriesOfSlot(dock)).toHaveLength(0)
      expect(session.subscribers()).toBe(0)
    } finally {
      await React.act(async () => { unmount(); await disposeClient?.(); await ctx.fiber.dispose() })
      container.remove()
    }
  })
})
