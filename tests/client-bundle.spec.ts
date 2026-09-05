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

  function loadArtifact(): { handoff: Handoff; exports: Record<string, unknown>; requested: string[] } {
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
      ['react', React],
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

  it('applies through the rc.2 client API with strict result codecs and rejects malformed views', async () => {
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
    ctx.provide('connection', { rpc: { call: rpcCall } })
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
      'status', 'reconcile', 'start', 'cancel', 'signOut',
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

    rpcCall.mockResolvedValueOnce({ ok: true, value: malformedViews[0] })
    await expect(ctx.remote.githubCopilot.status()).resolves.toMatchObject({
      ok: false,
      error: {
        message: expect.stringContaining('githubCopilot/status rejected "result"'),
      },
    })
    await dispose()
  })
})
