// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as Cordis from '@deepseek-ai/cordis'
import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'

const PLUGIN_ID = 'dsh-github-copilot'

interface Handoff {
  id: string
  factory: (require: (specifier: string) => unknown) => Record<string, unknown>
}

interface ModuleLoaderWindow {
  __ModuleLoader__?: {
    load(handoff: Handoff): void
  }
}

afterEach(() => {
  delete (window as ModuleLoaderWindow).__ModuleLoader__
})

describe('tsdown client artifact', () => {
  function loadGatewayArtifact(): Record<string, unknown> {
    const code = readFileSync(resolve('node_modules/@deepseek-ai/dsh-api-gateway/lib/client.js'), 'utf8')
    let handoff: Handoff | undefined
    ;(window as ModuleLoaderWindow).__ModuleLoader__ = {
      load(value) {
        handoff = value
      },
    }
    new Function(code)()
    expect(handoff?.id).toBe('@deepseek-ai/dsh-api-gateway')
    return handoff!.factory((specifier) => {
      if (specifier !== '@deepseek-ai/cordis') {
        throw new Error(`unexpected gateway require: ${specifier}`)
      }
      return Cordis
    })
  }

  function loadArtifact(react: typeof React = React): { handoff: Handoff; exports: Record<string, unknown>; requested: string[] } {
    const code = readFileSync(resolve('lib/client.js'), 'utf8')
    let handoff: Handoff | undefined
    ;(window as ModuleLoaderWindow).__ModuleLoader__ = {
      load(value) {
        handoff = value
      },
    }
    new Function(code)()
    expect(handoff).toBeDefined()

    const modules = new Map<string, unknown>([
      ['react', react],
      ['@deepseek-ai/cordis', {}],
      ['@deepseek-ai/dsh-api-remotes/client', {}],
      ['@deepseek-ai/dsh-client-ui-renderer/client', {}],
      ['@deepseek-ai/dsh-client-ui-slots', {}],
    ])
    const requested: string[] = []
    const exports = handoff!.factory((specifier) => {
      requested.push(specifier)
      if (!modules.has(specifier)) throw new Error(`unexpected require: ${specifier}`)
      return modules.get(specifier)
    })
    return { handoff: handoff!, exports, requested }
  }

  it('hands off the built client with the exact plugin id and injected require', () => {
    const { handoff, requested } = loadArtifact()

    expect(handoff.id).toBe(PLUGIN_ID)
    expect(requested).toEqual(['react'])
  })

  it('materializes the built client apply and inject exports', () => {
    const { exports } = loadArtifact()

    expect(exports.apply).toBeTypeOf('function')
    expect(exports.inject).toEqual(['remote', 'slots'])
  })

  // Deterministic committed-hook fixture for the built registration callbacks.
  // This verifies plugin lifecycle/element ownership, not Core DOM or browser paint.
  async function surfaceFixture() {
    interface Instance {
      memos: Array<{ deps: React.DependencyList; value: unknown }>
      effects: Array<{ deps: React.DependencyList | undefined; cleanup?: (() => void) | undefined }>
      pending: Array<() => void>
    }
    let current: Instance
    let memoIndex = 0, effectIndex = 0
    const hooks = {
      ...React,
      useMemo<T>(factory: () => T, deps: React.DependencyList): T {
        const index = memoIndex++, previous = current.memos[index]
        if (!previous || deps.some((value, at) => !Object.is(value, previous.deps[at]))) current.memos[index] = { deps, value: factory() }
        return current.memos[index]!.value as T
      },
      useSyncExternalStore<T>(_subscribe: unknown, snapshot: () => T): T { return snapshot() },
      useLayoutEffect(setup: React.EffectCallback, deps?: React.DependencyList) {
        const instance = current, index = effectIndex++, previous = instance.effects[index]
        if (!previous || !deps || !previous.deps || deps.some((value, at) => !Object.is(value, previous.deps?.[at]))) {
          instance.pending.push(() => {
            previous?.cleanup?.()
            const cleanup = setup()
            instance.effects[index] = { deps, cleanup: typeof cleanup === 'function' ? cleanup : undefined }
          })
        }
      },
    }
    const client = loadArtifact(hooks as typeof React)
    type Render = (props: Record<string, unknown>) => React.ReactElement
    const registrations = new Map<string, Render>()
    const injections = new Map<string, () => void>()
    const slotDisposals = new Map<string, ReturnType<typeof vi.fn>>()
    const result = { ok: true, value: { phase: 'signed-out', configured: false, writable: true, inFlight: false, notices: [] } }
    const remote = { status: vi.fn(async () => result), start: vi.fn(), cancel: vi.fn(), signOut: vi.fn(), discoverModels: vi.fn(), reconcile: vi.fn() }
    const cleanups: Array<() => void> = []
    const ctx = {
      remote: { $mount: vi.fn(async () => async () => {}), githubCopilot: remote },
      logger: { warn: vi.fn() },
      slots: {
        spec: () => ({ kind: 'list', scope: 'root' }),
        register(options: { name: string }, render: Render) {
          registrations.set(options.name, render)
          const dispose = vi.fn(() => { registrations.delete(options.name) })
          slotDisposals.set(options.name, dispose)
          return dispose
        },
        inject(name: string, setup: () => (() => void)) {
          const cleanup = setup()
          injections.set(name, cleanup)
          return cleanup
        },
      },
      inject(dependencies: string[], setup: (ctx: unknown) => (() => void)) {
        const cleanup = dependencies.includes('uiConversation') ? () => {} : setup(ctx)
        return Object.assign(Promise.resolve(), { dispose: async () => { cleanup() } })
      },
    }
    const dispose = await (client.exports.apply as (ctx: unknown) => Promise<() => Promise<void>>)(ctx)
    const instance = () => {
      const state: Instance = { memos: [], effects: [], pending: [] }
      const render = (element: React.ReactElement, commit = true): React.ReactElement | null => {
        current = state; memoIndex = 0; effectIndex = 0; state.pending = []
        const component = element.type as (props: unknown) => React.ReactElement | null
        const tree = component(element.props)
        if (commit) for (const effect of state.pending.splice(0)) effect()
        return tree
      }
      const unmount = () => { for (const effect of state.effects.splice(0)) effect.cleanup?.() }
      cleanups.push(unmount)
      return { render, unmount }
    }
    return { client, ctx, remote, registrations, injections, slotDisposals, instance,
      dispose: async () => { await dispose(); for (const cleanup of cleanups) cleanup() } }
  }

  it.each(['provider-first', 'footer-first'] as const)('embeds exactly one built account when configured, regardless of mount order: %s', async order => {
    const fixture = await surfaceFixture()
    try {
      const provider = fixture.instance(), footer = fixture.instance()
      const owner = { provider: { provider: 'github-copilot', displayName: 'GitHub Copilot', settingsNs: 'llm-pi-ai' }, configured: true, keyConfigured: false }
      const providerElement = fixture.registrations.get('settings.models.provider-card')!(owner)
      const footerElement = fixture.registrations.get('settings.models.footer')!({})
      // A render that has not committed must not claim the surface or call Remote.
      provider.render(providerElement, false)
      footer.render(footerElement, false)
      expect(fixture.remote.status).not.toHaveBeenCalled()
      if (order === 'provider-first') { provider.render(providerElement); footer.render(footerElement) }
      else { footer.render(footerElement); provider.render(providerElement) }
      const tree = provider.render(providerElement)
      expect(tree?.props['data-dsh-github-copilot-account-surface']).toBe('provider')
      expect(tree?.props.children.type).toBe(fixture.client.exports.GitHubCopilotCompactAccount)
      expect(tree?.props.children.props.embedded).toBe(true)
      expect(footer.render(footerElement)).toBeNull()
      expect(fixture.remote.status).toHaveBeenCalledOnce()
      expect(fixture.remote.start).not.toHaveBeenCalled()
      expect(fixture.remote.discoverModels).not.toHaveBeenCalled()
    } finally { await fixture.dispose() }
  })

  it('keeps fresh setup discoverable and follows configured-row arrival, eligibility changes and removal in the built client', async () => {
    const fixture = await surfaceFixture()
    try {
      const provider = fixture.instance(), footer = fixture.instance()
      const owner = { provider: { provider: 'github-copilot', displayName: 'GitHub Copilot', settingsNs: 'llm-pi-ai' }, configured: false, keyConfigured: false }
      const renderProvider = () => fixture.registrations.get('settings.models.provider-card')!(owner)
      const footerElement = fixture.registrations.get('settings.models.footer')!({})
      provider.render(renderProvider()); footer.render(footerElement)
      expect(provider.render(renderProvider())).toBeNull()
      const fallback = footer.render(footerElement)
      const account = fallback?.props.children.props.account
      expect(fallback?.props['data-dsh-github-copilot-account-surface']).toBe('footer')
      expect(fallback?.props.children.props.embedded).toBe(false)
      owner.configured = true
      provider.render(renderProvider())
      expect(provider.render(renderProvider())?.props.children.props.account).toBe(account)
      expect(footer.render(footerElement)).toBeNull()
      owner.provider.provider = 'unrelated'
      provider.render(renderProvider())
      expect(provider.render(renderProvider())).toBeNull()
      expect(footer.render(footerElement)?.props.children.props.account).toBe(account)
      owner.provider.provider = 'github-copilot'
      provider.render(renderProvider())
      provider.unmount()
      expect(footer.render(footerElement)?.props.children.props.account).toBe(account)
      expect(fixture.remote.status).toHaveBeenCalledOnce()
    } finally { await fixture.dispose() }
  })

  it('revokes built provider seats on slot withdrawal and stops the shared controller on plugin disposal', async () => {
    const fixture = await surfaceFixture()
    try {
      const provider = fixture.instance(), footer = fixture.instance()
      const owner = { provider: { provider: 'github-copilot', displayName: 'GitHub Copilot', settingsNs: 'llm-pi-ai' }, configured: true, keyConfigured: true }
      const providerElement = fixture.registrations.get('settings.models.provider-card')!(owner)
      const footerElement = fixture.registrations.get('settings.models.footer')!({})
      provider.render(providerElement); footer.render(footerElement)
      const account = provider.render(providerElement)?.props.children.props.account
      fixture.injections.get('settings.models.provider-card')!()
      expect(provider.render(providerElement)).toBeNull()
      expect(footer.render(footerElement)?.props.children.props.account).toBe(account)
      expect(fixture.remote.status).toHaveBeenCalledOnce()
      await fixture.dispose()
      expect(footer.render(footerElement)).toBeNull()
      await account.start()
      expect(fixture.remote.start).not.toHaveBeenCalled()
      expect(fixture.remote.status).toHaveBeenCalledOnce()
    } finally { await fixture.dispose() }
  })

  it('mounts strict Host result codecs through the published rc.1 client carrier', async () => {
    const gateway = loadGatewayArtifact()
    const client = loadArtifact()
    const contributions: TypertRemoteContribution[] = []
    const validView = {
      phase: 'signed-in',
      configured: true,
      writable: true,
      inFlight: false,
      notices: [{ message: 'Authorized', url: 'https://github.com/login/device', code: 'ABCD-1234' }],
    }
    // The transport receives untrusted values; the Remote codec validates them.
    const rpcCall = vi.fn(async (): Promise<{ ok: true; value: unknown }> => ({ ok: true, value: validView }))
    const ctx = new Cordis.Context()
    ctx.provide('typert', {
      remotes: {
        register(contribution: TypertRemoteContribution) {
          contributions.push(contribution)
          return async () => undefined
        },
      },
      contexts: { getClient: () => undefined },
    })
    ctx.provide('connection', {
      rpc: { call: rpcCall },
      registerGenerationSource: () => () => undefined,
      start: () => ({ stop() {} }),
      generation: { getSnapshot: () => undefined },
    })
    ctx.provide('slots', {
      inject: () => () => undefined,
      register: () => () => undefined,
    })

    expect(gateway.apply).toBeTypeOf('function')
    ;(gateway.apply as (ctx: Cordis.Context) => void)(ctx)
    const dispose = await (client.exports.apply as (
      ctx: Cordis.Context,
    ) => Promise<() => Promise<void>>)(ctx)

    expect(contributions).toHaveLength(1)
    expect(contributions[0]?.descriptors.map(descriptor => descriptor.method)).toEqual([
      'status', 'reconcile', 'discoverModels', 'start', 'cancel', 'signOut',
    ])
    for (const descriptor of contributions[0]!.descriptors) {
      expect(descriptor.invocation).toEqual({ kind: 'direct' })
      expect(descriptor.parameters).toEqual([])
      expect(descriptor.result).toMatchObject({
        mode: 'strict',
        typeSymbol: 'dsh-github-copilot#GitHubCopilotAuthorizationView',
      })
    }

    const status = await ctx.remote.githubCopilot.status()
    expect(status).toEqual({ ok: true, value: validView })
    expect(rpcCall).toHaveBeenCalledWith(
      '/api',
      'githubCopilot/status',
      { args: {} },
      expect.any(AbortSignal),
    )

    await expect(ctx.remote.githubCopilot.reconcile()).resolves.toEqual({ ok: true, value: validView })
    expect(rpcCall).toHaveBeenLastCalledWith(
      '/api',
      'githubCopilot/reconcile',
      { args: {} },
      expect.any(AbortSignal),
    )

    const statusDescriptor = contributions[0]!.descriptors.find(
      descriptor => descriptor.method === 'status',
    )!
    const resultCodec = statusDescriptor.result
    if (resultCodec.mode !== 'strict') {
      throw new Error('expected a strict result codec')
    }
    const malformedViews = [
      { ...validView, phase: 'unknown' },
      { ...validView, configured: 'yes' },
      { ...validView, notices: [{ message: 42 }] },
      { ...validView, error: null },
      { ...validView, route: { state: 'healthy' } },
      { ...validView, route: { state: 'error', diagnosticCode: 'RAW_PROVIDER_BODY' } },
      { ...validView, route: { state: 'ready', credential: 'synthetic' } },
    ]
    for (const malformed of malformedViews) {
      expect(() => resultCodec.schema.parse(malformed)).toThrow()
    }

    // rc.1 carries the Host result without revalidating it in the gateway.
    // Keep that boundary explicit: the mounted strict Host codec rejects this
    // fixture, while UI consumers must validate the leaves they display.
    rpcCall.mockResolvedValueOnce({ ok: true, value: malformedViews[0] })
    const unvalidated = await ctx.remote.githubCopilot.status()
    expect(unvalidated).toEqual({ ok: true, value: malformedViews[0] })
    expect(() => resultCodec.schema.parse(unvalidated.ok ? unvalidated.value : undefined)).toThrow()
    const validateView = client.exports.authorizationViewFrom
    expect(validateView).toBeTypeOf('function')
    expect((validateView as (value: unknown) => unknown)(unvalidated.ok ? unvalidated.value : undefined)).toBeUndefined()
    expect((validateView as (value: unknown) => unknown)(validView)).toEqual(validView)
    await dispose()
    await ctx.fiber.dispose()
  })
})
