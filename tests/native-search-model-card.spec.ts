// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NativeSearchModelCard } from '../src/native-search-model-card.ts'

afterEach(() => { Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT') })

function fixture(initial = '') {
  let saved = initial
  let revision = 7
  const namespace = () => ({ ns: 'github-copilot', revision, value: { nativeSearchModel: saved },
    schema: {}, applies: 'live' as const, secrets: [], autoGenerate: false })
  const settings = {
    describe: vi.fn(async () => ({ ok: true as const, value: {
      writable: true, hasDocument: true, namespaces: [namespace()],
    } })),
    mutate: vi.fn(async (_namespace: string, operations: Array<{ value: unknown }>) => {
      saved = String(operations[0]!.value)
      revision++
      return { ok: true as const, value: namespace() }
    }),
  }
  const search = { models: vi.fn(async () => ({ ok: true as const,
    value: { models: [{ id: 'alpha' }, { id: 'beta' }] } })) }
  return { settings, search }
}

describe('native Copilot search model settings', () => {
  it('saves the chosen model through a single settings leaf and reads it back', async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    const remotes = fixture()
    const container = document.createElement('div')
    const root = createRoot(container)
    try {
      await act(async () => {
        root.render(createElement(NativeSearchModelCard, remotes as never))
      })
      const select = container.querySelector('select')!
      expect(Array.from(select.options).map(option => option.value)).toEqual(['', 'alpha', 'beta'])
      await act(async () => {
        select.value = 'beta'
        select.dispatchEvent(new Event('change', { bubbles: true }))
      })
      await act(async () => { container.querySelector('button[data-save]')!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
      expect(remotes.settings.mutate).toHaveBeenCalledWith('github-copilot',
        [{ op: 'set', path: ['nativeSearchModel'], value: 'beta' }], 7)
      expect(remotes.settings.describe).toHaveBeenCalledTimes(2)
      expect(container.textContent).toContain('Saved')
    } finally { await act(async () => root.unmount()) }
  })

  it('retains a saved unavailable model and allows an explicit return to automatic', async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    const remotes = fixture('missing')
    const container = document.createElement('div')
    const root = createRoot(container)
    try {
      await act(async () => { root.render(createElement(NativeSearchModelCard, remotes as never)) })
      const select = container.querySelector('select')!
      expect(select.value).toBe('missing')
      expect(container.textContent).toContain('unavailable')
      expect(remotes.settings.mutate).not.toHaveBeenCalled()
      await act(async () => {
        select.value = ''
        select.dispatchEvent(new Event('change', { bubbles: true }))
      })
      await act(async () => { container.querySelector('button[data-save]')!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
      expect(remotes.settings.mutate).toHaveBeenCalledWith('github-copilot',
        [{ op: 'set', path: ['nativeSearchModel'], value: '' }], 7)
    } finally { await act(async () => root.unmount()) }
  })

  it('does not report success when the settings revision conflicts', async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    const remotes = fixture()
    remotes.settings.mutate.mockResolvedValueOnce({ ok: false, error: { code: 'settings-conflict' } } as never)
    const container = document.createElement('div')
    const root = createRoot(container)
    try {
      await act(async () => { root.render(createElement(NativeSearchModelCard, remotes as never)) })
      const select = container.querySelector('select')!
      await act(async () => {
        select.value = 'beta'
        select.dispatchEvent(new Event('change', { bubbles: true }))
      })
      await act(async () => { container.querySelector('button[data-save]')!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
      expect(select.value).toBe('beta')
      expect(container.textContent).toContain('Could not save search model')
      expect(container.textContent).not.toContain('Saved.')
    } finally { await act(async () => root.unmount()) }
  })

  it('does not report success when the saved value cannot be confirmed', async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    const remotes = fixture()
    remotes.settings.mutate.mockImplementationOnce(async () => ({ ok: true as const, value: {
      ns: 'github-copilot', revision: 8, value: { nativeSearchModel: '' }, schema: {}, applies: 'live' as const, secrets: [], autoGenerate: false,
    } }))
    const container = document.createElement('div')
    const root = createRoot(container)
    try {
      await act(async () => { root.render(createElement(NativeSearchModelCard, remotes as never)) })
      const select = container.querySelector('select')!
      await act(async () => {
        select.value = 'beta'
        select.dispatchEvent(new Event('change', { bubbles: true }))
      })
      await act(async () => { container.querySelector('button[data-save]')!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
      expect(container.textContent).toContain('Could not confirm the saved search model')
      expect(container.textContent).not.toContain('Saved.')
      expect(container.querySelector<HTMLButtonElement>('button[data-save]')!.disabled).toBe(true)
    } finally { await act(async () => root.unmount()) }
  })
})
