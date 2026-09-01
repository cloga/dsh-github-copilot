import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/client.ts'

describe('GitHub Copilot Models client', () => {
  it('mounts its Remote contribution and registers the llm-pi-ai provider-card seat', async () => {
    const disposeRemote = vi.fn(async () => undefined)
    const disposeUi = vi.fn(async () => undefined)
    const register = vi.fn(() => () => undefined)
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
        inject: (_name, callback) => callback(),
        register,
      },
      inject,
    }

    const dispose = await apply(ctx as never)

    expect(ctx.remote.$mount).toHaveBeenCalledWith(expect.objectContaining({
      package: 'dsh-github-copilot',
    }))
    expect(register).toHaveBeenCalledWith(
      { name: 'settings.models.provider-card', key: 'llm-pi-ai' },
      expect.any(Function),
    )

    await dispose()
    expect(disposeUi).toHaveBeenCalled()
    expect(disposeRemote).toHaveBeenCalled()
  })
})
