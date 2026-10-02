// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ParentModelFollowCard, readParentFollowSettings, saveParentFollowSettings } from '../src/parent-model-follow-card.ts'
import { CopilotPluginSettingsPage } from '../src/client.ts'

const cleanups: Array<() => void> = []
afterEach(async () => { await act(async () => cleanups.splice(0).forEach(dispose => dispose())); document.body.replaceChildren() })

function fixture() {
  let value: Record<string, unknown> = { searchRouting: { searchProvider: 'auto', defaultSearchProvider: 'none' } }
  let revision = 7
  let writable = true
  const settings = {
    describe: vi.fn(async () => ({ ok: true as const, value: { writable, hasDocument: true, namespaces: [{
      ns: 'github-copilot', value, revision, schema: {}, applies: 'live' as const, secrets: [], autoGenerate: false,
    }] } })),
    mutate: vi.fn(async (ns: string, ops: Array<{ op: 'set'; path: string[]; value: unknown }>, expected?: number) => {
      if (expected !== revision) throw new Error('settings-conflict')
      for (const op of ops) {
        if (op.path.length === 1) value = { ...value, [op.path[0]!]: op.value }
      }
      return { ok: true as const, value: { ns, revision: ++revision, value, schema: {},
        applies: 'live' as const, secrets: [], autoGenerate: false } }
    }),
  }
  return { settings, external(next: Record<string, unknown>) { value = { ...value, ...next }; revision++ },
    readOnly() { writable = false } }
}

async function mount(f = fixture(), page = false) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container); cleanups.push(() => root.unmount())
  const settings = f.settings as unknown as Parameters<typeof readParentFollowSettings>[0]
  await act(async () => root.render(page
    ? createElement(CopilotPluginSettingsPage, { settings, routing: {
      providers: async () => ({ ok: true, value: { supported: true, providers: [] } }),
    } as never })
    : createElement(ParentModelFollowCard, { settings })))
  const card = () => container.querySelector<HTMLElement>('[data-dsh-parent-model-follow]')!
  const toggle = () => card().querySelector<HTMLInputElement>('input')!
  const save = () => card().querySelector<HTMLButtonElement>('button')!
  return { ...f, container, card, toggle, save }
}
async function click(element: HTMLElement) { await act(async () => element.click()) }

describe('one-switch parent model policy', () => {
  it('loads Off, saves one leaf and announces next-turn semantics without Session fields', async () => {
    const f = await mount()
    expect(f.toggle().checked).toBe(false)
    expect(f.save().disabled).toBe(true)
    expect(f.card().querySelectorAll('input')).toHaveLength(1)
    await click(f.toggle())
    expect(f.card().textContent).toContain('Unsaved change.')
    await click(f.save())
    expect(f.settings.mutate).toHaveBeenCalledWith('github-copilot',
      [{ op: 'set', path: ['followParentModel'], value: true }], 7)
    expect(f.card().textContent).toContain('Saved. Applies from each child')
    expect(f.toggle().checked).toBe(true)
  })

  it('permits unrelated revision changes but refuses changed policy', async () => {
    const f = fixture()
    const settings = f.settings as unknown as Parameters<typeof readParentFollowSettings>[0]
    const saved = await readParentFollowSettings(settings)
    f.external({ searchModel: 'preserved' })
    await saveParentFollowSettings(settings, saved, true)
    expect(f.settings.mutate.mock.calls[0]?.[2]).toBe(8)
    await expect(saveParentFollowSettings(settings, saved, false)).rejects.toThrow('changed elsewhere')
    expect(f.settings.mutate).toHaveBeenCalledTimes(1)
  })

  it('disables read-only settings and explains legacy bindings', async () => {
    const remote = fixture()
    remote.external({ parentModelFollow: [{ childSessionId: 'child', parentSessionId: 'parent' }] })
    remote.readOnly()
    const f = await mount(remote)
    expect(f.toggle().disabled).toBe(true)
    expect(f.card().textContent).toContain('read-only')
    expect(f.card().textContent).toContain('remain active even when this switch is off')
    expect(f.settings.mutate).not.toHaveBeenCalled()
  })

  it('keeps unsaved intent on a failed save and requires a reload', async () => {
    const f = await mount()
    await click(f.toggle())
    f.settings.mutate.mockRejectedValueOnce(new Error('PRIVATE_CREDENTIAL_MUST_NOT_RENDER'))
    await click(f.save())
    expect(f.toggle().checked).toBe(true)
    expect(f.save().disabled).toBe(true)
    expect(f.card().textContent).toContain('Reload')
    expect(f.card().textContent).not.toContain('PRIVATE_CREDENTIAL')
    await click(f.card().querySelectorAll<HTMLButtonElement>('button')[1]!)
    expect(f.toggle().checked).toBe(false)
  })

  it('updates search CAS after a policy save without resetting the search draft', async () => {
    const f = await mount(fixture(), true)
    const search = f.container.querySelector<HTMLSelectElement>('[data-dsh-web-search-provider]')!
    await click(f.toggle())
    await click(f.save())
    expect(search.value).toBe('none')
    await click(f.container.querySelector<HTMLButtonElement>('[data-dsh-web-search-save]')!)
    expect(f.settings.mutate.mock.calls.at(-1)?.[2]).toBe(8)
    expect(f.settings.mutate.mock.calls.at(-1)?.[1]).toEqual([
      { op: 'set', path: ['searchRouting', 'searchProvider'], value: 'auto' },
      { op: 'set', path: ['searchRouting', 'defaultSearchProvider'], value: 'none' },
    ])
  })
})
