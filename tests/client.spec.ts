import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/client.ts'

describe('GitHub Copilot Models client', () => {
  function clientContext(declaredSlots: readonly string[]) {
    const disposeRemote = vi.fn(async () => undefined)
    const disposeUi = vi.fn(async () => undefined)
    const registrations = new Map<string, ReturnType<typeof vi.fn>>()
    const injections = new Map<string, () => unknown>()
    const register = vi.fn((options: { name: string }) => {
      const dispose = vi.fn()
      registrations.set(options.name, dispose)
      return dispose
    })
    let ctx: {
      remote: {
        $mount: ReturnType<typeof vi.fn>
        githubCopilot: object
      }
      slots: {
        inject(name: string, callback: () => unknown): unknown
        register: ReturnType<typeof vi.fn>
      }
      inject: ReturnType<typeof vi.fn>
    }
    const inject = vi.fn((_services: string[], callback: (value: unknown) => void) => {
      callback(ctx)
      return Object.assign(Promise.resolve(), { dispose: disposeUi })
    })
    ctx = {
      remote: {
        $mount: vi.fn(async () => disposeRemote),
        githubCopilot: {},
      },
      slots: {
        inject: (name, callback) => {
          injections.set(name, callback)
          return declaredSlots.includes(name) ? callback() : () => undefined
        },
        register,
      },
      inject,
    }
    return { ctx, disposeRemote, disposeUi, register, registrations, injections }
  }

  it('mounts its Remote contribution and registers the alpha.3 provider-card seat', async () => {
    const { ctx, disposeRemote, disposeUi, register } = clientContext([
      'settings.models.provider-card',
      'settings.section',
    ])

    const dispose = await apply(ctx as never)

    expect(ctx.remote.$mount).toHaveBeenCalledWith(expect.objectContaining({
      package: 'dsh-github-copilot',
    }))
    expect(register).toHaveBeenCalledWith(
      { name: 'settings.models.provider-card', key: 'llm-pi-ai' },
      expect.any(Function),
    )
    expect(register).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: 'settings.section' }),
      expect.any(Function),
    )

    await dispose()
    expect(disposeUi).toHaveBeenCalled()
    expect(disposeRemote).toHaveBeenCalled()
  })

  it('registers a GitHub Copilot settings section on the rc.2 Models surface', async () => {
    const { ctx, register } = clientContext(['settings.section'])

    const dispose = await apply(ctx as never)

    expect(register).toHaveBeenCalledWith(
      {
        name: 'settings.section',
        id: 'github-copilot',
        order: 11,
        label: 'GitHub Copilot',
      },
      expect.any(Function),
    )
    expect(register).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: 'settings.models.provider-card' }),
      expect.any(Function),
    )

    await dispose()
  })

  it('replaces the rc.2 fallback when the alpha.3 provider-card slot appears', async () => {
    const { ctx, register, registrations, injections } = clientContext(['settings.section'])
    await apply(ctx as never)
    const disposeFallback = registrations.get('settings.section')

    injections.get('settings.models.provider-card')?.()

    expect(disposeFallback).toHaveBeenCalledOnce()
    expect(register).toHaveBeenCalledWith(
      { name: 'settings.models.provider-card', key: 'llm-pi-ai' },
      expect.any(Function),
    )
  })
})
