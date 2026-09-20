// @vitest-environment jsdom
import { act, createElement, useSyncExternalStore } from 'react'
import * as React from 'react'
import * as Cordis from '@deepseek-ai/cordis'
import * as ReactDOM from 'react-dom'
import * as ReactDOMClient from 'react-dom/client'
import * as ReactJSX from 'react/jsx-runtime'
import * as Slots from '@deepseek-ai/dsh-client-ui-slots'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { ComponentType } from 'react'
import { Context, Service } from '@deepseek-ai/cordis'
import type { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerCopilotUsageUi } from '../src/copilot-usage-ui.ts'

const cleanups: Array<() => void> = []
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }) })
afterEach(async () => {
  await act(async () => { cleanups.splice(0).reverse().forEach(dispose => dispose()) })
  vi.restoreAllMocks()
  document.body.replaceChildren()
})
function fixture(spec = { kind: 'list', scope: 'session' }) {
  let component: ComponentType<Record<string, unknown>> | undefined
  let injection: (() => () => void) | undefined
  let release: (() => void) | undefined
  const remote = { get: vi.fn(async () => ({ ok: true, value: { state: 'ready', billing: 'credits', budget: 'individual', used: 7, remaining: 13, limit: 20, observedAt: 1 } })), refresh: vi.fn() }
  const capture = vi.fn(() => remote)
  const namespace = Object.defineProperty({}, 'githubCopilotUsage', { get: capture })
  const ctx = {
    remote: namespace, get: vi.fn(() => undefined), logger: { warn: vi.fn() },
    slots: {
      spec: vi.fn(() => spec),
      inject: vi.fn((_name: string, callback: () => () => void) => { injection = callback; return () => { release?.(); component = undefined } }),
      register: vi.fn((_options: unknown, render: ComponentType<Record<string, unknown>>) => {
        component = render
        return () => { component = undefined }
      }),
    },
  }
  const dispose = registerCopilotUsageUi(ctx as unknown as Context)
  cleanups.push(dispose)
  return { ctx, remote, capture, declare: () => { release = injection?.() }, component: () => component! }
}
function source<T>(initial: T) {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    set(next: T) { value = next; listeners.forEach(listener => listener()) },
    use: () => useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => value),
  }
}
const selected = (provider: string) => ({ provider, model: 'account-model' })

describe('verified alpha.2 session-scoped composer usage integration', () => {
  // Read-only source evidence, commit ddefc45fbc7f8e46dd73185e68295696d1297887:
  // ui-conversation/src/client/skeleton/InputBar.tsx:484-488 places the dock
  // immediately before ContextMeter; ui-session/src/client/index.ts supplies
  // sessionId/useSession/useProjection. model-selection-projection.ts folds
  // next = pending ?? lastUsed, with lastUsed coming from request/header.
  it('registers only an additive list entry and captures one traced Remote face', () => {
    const f = fixture()
    f.declare()
    expect(f.ctx.slots.register).toHaveBeenCalledWith(
      { name: 'conversation.composer.dock', id: 'github-copilot-usage', order: 20 },
      expect.any(Function),
    )
    expect(f.capture).toHaveBeenCalledTimes(1)
    expect(f.remote.get).not.toHaveBeenCalled()
  })

  it.each([{ kind: 'single', scope: 'session' }, { kind: 'list', scope: 'root' }])('rejects incompatible slot contracts', spec => {
    const f = fixture(spec)
    f.declare()
    expect(f.ctx.slots.register).not.toHaveBeenCalled()
    expect(f.ctx.logger.warn).toHaveBeenCalledWith('[github-copilot] COPILOT_USAGE_SLOT_UNAVAILABLE')
  })

  it('follows durable next selection instead of last-used, defaults or another session', async () => {
    const f = fixture()
    f.declare()
    const projection = source<unknown>({ lastUsed: selected('github-copilot'), next: selected('other-provider') })
    const session = source({ sessionId: 'a', removed: false, openState: 'open', blank: false })
    const useProjection = vi.fn((_key: string) => projection.use())
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    cleanups.push(() => { root.unmount() })
    const render = async (id = 'a') => {
      await act(async () => { root.render(createElement(f.component(), { sessionId: id, useSession: session.use, useProjection })) })
    }
    await render()
    expect(f.remote.get).not.toHaveBeenCalled()
    expect(container.textContent).toBe('')
    await act(async () => { projection.set({ lastUsed: selected('other-provider'), next: selected('github-copilot-preview') }) })
    expect(f.remote.get).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('7 used')
    expect(useProjection).toHaveBeenCalledWith('modelSelection')
    await act(async () => { projection.set({ lastUsed: selected('github-copilot'), next: selected('other-provider') }) })
    expect(container.textContent).toBe('')
    await act(async () => { projection.set({ lastUsed: null, next: null }) })
    expect(container.textContent).toBe('')
    await act(async () => { projection.set(undefined) })
    expect(f.remote.get).toHaveBeenCalledTimes(1)
    await act(async () => { projection.set({ lastUsed: null, next: selected('github-copilot') }) })
    await render('b')
    expect(container.textContent).toBe('')
  })

  it('disables only this feature with a named missing runtime diagnostic', async () => {
    const f = fixture()
    f.declare()
    const root = createRoot(document.createElement('div'))
    cleanups.push(() => { root.unmount() })
    await act(async () => { root.render(createElement(f.component(), { sessionId: 'a' })) })
    expect(f.ctx.logger.warn).toHaveBeenCalledWith('[github-copilot] COPILOT_USAGE_SESSION_RUNTIME_UNAVAILABLE')
    expect(f.remote.get).not.toHaveBeenCalled()
  })

  it('uses real Cordis Remote tracing and reversible public SlotRegistry registration', async () => {
    const ctx = new Context()
    class RemoteRoot extends Service { constructor(context: Context) { super(context, 'remote') } }
    const get = vi.fn(async () => ({ ok: true, value: { state: 'ready', billing: 'credits', budget: 'pooled', used: 11, observedAt: 1 } }))
    class UsageRemote extends Service {
      constructor(context: Context) { super(context, 'remote.githubCopilotUsage') }
      get = get
      refresh = get
    }
    try {
      let module: { factory(require: (id: string) => unknown): { SlotRegistry: typeof SlotRegistry } } | undefined
      const carrier = { load(value: NonNullable<typeof module>) { module = value } }
      const code = readFileSync(resolve('node_modules/@deepseek-ai/dsh-client-ui-renderer/lib/client.js'), 'utf8')
      new Function('window', code)({ __ModuleLoader__: carrier })
      if (!module) throw new Error('Missing published renderer ModuleLoader carrier')
      const loaded = module.factory(id => {
        if (id === 'react') return React
        if (id === 'react-dom') return ReactDOM
        if (id === 'react-dom/client') return ReactDOMClient
        if (id === 'react/jsx-runtime') return ReactJSX
        if (id === '@deepseek-ai/dsh-client-ui-slots') return Slots
        if (id === '@deepseek-ai/cordis') return Cordis
        throw new Error(`Unexpected renderer external: ${id}`)
      })
      await ctx.plugin(loaded.SlotRegistry)
      await ctx.plugin({ apply(context) { new RemoteRoot(context); new UsageRemote(context) } })
      const slots = ctx.slots as unknown as {
        register(options: unknown, render: () => null): () => void
        entriesOfSlot(name: string): readonly { component: ComponentType<Record<string, unknown>> }[]
      }
      const undeclare = slots.register({ name: 'root', children: { 'conversation.composer.dock': { kind: 'list', scope: 'session' } } }, () => null)
      const dispose = registerCopilotUsageUi(ctx)
      await Promise.resolve()
      expect(slots.entriesOfSlot('conversation.composer.dock')).toHaveLength(1)
      const entry = slots.entriesOfSlot('conversation.composer.dock')[0]!
      const container = document.createElement('div')
      document.body.append(container)
      const root = createRoot(container)
      try {
        const props = {
          sessionId: 'current-session',
          useSession: () => ({ sessionId: 'current-session', removed: false, openState: 'open', blank: false }),
          useProjection: () => ({ lastUsed: selected('github-copilot'), next: selected('github-copilot') }),
        }
        await act(async () => {
          root.render(createElement('div', { 'data-native-dock': true },
            createElement(entry.component, props),
            createElement('span', { 'data-native-context': true }, 'Context 34%'),
          ))
        })
        expect(get).toHaveBeenCalledTimes(1)
        expect(container.textContent).toContain('11 used')
        const native = container.querySelector('[data-native-context]')!
        await act(async () => {
          root.render(createElement('div', { 'data-native-dock': true },
            createElement(entry.component, props),
            createElement('span', { 'data-native-context': true }, 'Context 34%'),
          ))
        })
        expect(get).toHaveBeenCalledTimes(1)
        expect(container.querySelector('[data-native-context]')).toBe(native)
      } finally { await act(async () => { root.unmount() }) }
      dispose()
      dispose()
      await Promise.resolve()
      expect(slots.entriesOfSlot('conversation.composer.dock')).toHaveLength(0)
      undeclare()
    } finally { await ctx.fiber.dispose() }
  })
})
