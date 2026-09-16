import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { ReactElement } from 'react'
import { registerDualModelUi } from '../src/dual-model-ui.ts'

function fixture(available = true) {
  const callbacks = new Map<string, () => (() => void)>()
  const rows = new Map<string, { name: string; render: (props: { close: () => void }) => ReactElement }>()
  const remote = { view: vi.fn(), save: vi.fn(), create: vi.fn() }
  const ctx = {
    remote: { githubCopilotDualModel: available ? remote : undefined },
    get: vi.fn(() => undefined), logger: { warn: vi.fn() },
    slots: {
      spec: vi.fn(() => ({ kind: 'list', scope: 'root' })),
      inject(name: string, callback: () => (() => void)) {
        callbacks.set(name, callback)
        return () => { callbacks.delete(name) }
      },
      register(spec: { name: string; id: string }, render: (props: { close: () => void }) => ReactElement) {
        const key = `${spec.name}:${spec.id}`
        if (rows.has(key)) throw Error('duplicate slot')
        rows.set(key, { name: spec.name, render })
        return () => { rows.delete(key) }
      },
    },
  }
  return { ctx: ctx as unknown as Context, callbacks, rows, remote, spec: ctx.slots.spec }
}

describe('optional model-role UI registration', () => {
  it('does nothing if the optional namespace is absent', () => {
    const f = fixture(false)
    const dispose = registerDualModelUi(f.ctx)
    expect(f.callbacks.size).toBe(0)
    dispose()
  })
  it('moves one card between the Models footer and the old-Core section', () => {
    const f = fixture()
    const dispose = registerDualModelUi(f.ctx)
    const unmountSection = f.callbacks.get('settings.section')!()
    expect([...f.rows.keys()]).toEqual(['settings.section:github-copilot-dual-model'])
    const unmountFooter = f.callbacks.get('settings.models.footer')!()
    expect([...f.rows.keys()]).toEqual(['settings.models.footer:github-copilot-dual-model'])
    unmountFooter()
    expect([...f.rows.keys()]).toEqual(['settings.section:github-copilot-dual-model'])
    unmountFooter()
    expect(f.rows.size).toBe(1)
    unmountSection()
    expect(f.rows.size).toBe(0)
    dispose()
    expect(f.callbacks.size).toBe(0)
  })
  it('keeps fallback when the footer contract is incompatible', () => {
    const f = fixture()
    f.spec.mockReturnValue({ kind: 'keyed', scope: 'agent' })
    const dispose = registerDualModelUi(f.ctx)
    const unmountSection = f.callbacks.get('settings.section')!()
    const unmountFooter = f.callbacks.get('settings.models.footer')!()
    expect([...f.rows.keys()]).toEqual(['settings.section:github-copilot-dual-model'])
    unmountFooter()
    unmountSection()
    dispose()
  })
  it('registration and removal never read credentials or create a session', () => {
    const f = fixture()
    const dispose = registerDualModelUi(f.ctx)
    const unmount = f.callbacks.get('settings.models.footer')!()
    expect(f.remote.view).not.toHaveBeenCalled()
    expect(f.remote.save).not.toHaveBeenCalled()
    expect(f.remote.create).not.toHaveBeenCalled()
    unmount()
    dispose()
    expect(f.rows.size).toBe(0)
  })
})
