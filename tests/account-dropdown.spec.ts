// @vitest-environment jsdom
import { act, createElement as h, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { AccountDropdown } from '../src/account-dropdown.ts'

const cleanups: Array<() => void> = []
afterEach(async () => {
  await act(async () => cleanups.splice(0).forEach(dispose => dispose()))
  document.body.replaceChildren()
  vi.restoreAllMocks()
})
async function fixture() {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const select = vi.fn()
  function Surface() {
    const [open, setOpen] = useState(false)
    return h(AccountDropdown, { label: 'Switch', open, onOpenChange: setOpen, triggerStyle: {},
      onSelect: id => { select(id); setOpen(false) }, listAttribute: 'data-copilot-saved-accounts',
      options: Array.from({ length: 24 }, (_, i) => ({ id: String(i), label: `@account-${i}`, selected: i === 3, disabled: i === 5 })),
      footer: h('button', { type: 'button' }, 'Add account') })
  }
  const node = document.createElement('div'); document.body.append(node)
  const root = createRoot(node); cleanups.push(() => root.unmount())
  await act(async () => root.render(h(Surface)))
  const trigger = node.querySelector<HTMLButtonElement>('button')!
  await act(async () => trigger.click())
  return { node, trigger, select }
}
it('keeps every account in a bounded anchored list without a search or repeated switch action', async () => {
  const { node, select } = await fixture()
  expect(node.querySelector('input')).toBeNull()
  const list = node.querySelector<HTMLElement>('[data-copilot-saved-accounts]')!
  expect(list.querySelectorAll('button')).toHaveLength(24)
  expect(list.style.maxHeight).toBe('240px')
  expect(list.style.overflowY).toBe('auto')
  expect(node.querySelector<HTMLElement>('[data-copilot-account-selector]')?.style.position).toBe('fixed')
  const selected = list.querySelector<HTMLButtonElement>('[aria-pressed=true]')!
  expect(selected.textContent).toBe('@account-3')
  expect(document.activeElement).toBe(selected)
  await act(async () => selected.click())
  expect(select).toHaveBeenCalledExactlyOnceWith('3')
  expect(node.querySelector('[data-copilot-account-selector]')).toBeNull()
})
it('supports arrows, Home, End and Escape without closing the containing Chat panel', async () => {
  const { node, trigger } = await fixture()
  const key = async (value: string) => {
    await act(async () => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true })))
  }
  await key('ArrowDown')
  expect(document.activeElement?.textContent).toBe('@account-4')
  await key('ArrowDown')
  expect(document.activeElement?.textContent).toBe('@account-6')
  await key('End')
  expect(document.activeElement?.textContent).toBe('Add account')
  await key('Home')
  expect(document.activeElement?.textContent).toBe('@account-0')
  const parent = vi.fn(); document.addEventListener('keydown', parent)
  await key('Escape')
  document.removeEventListener('keydown', parent)
  expect(parent).not.toHaveBeenCalled()
  expect(document.activeElement).toBe(trigger)
  expect(trigger.getAttribute('aria-expanded')).toBe('false')
})
it('dismisses on outside pointer interaction without making an account write', async () => {
  const { node, select } = await fixture()
  await act(async () => document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })))
  expect(node.querySelector('[data-copilot-account-selector]')).toBeNull()
  expect(select).not.toHaveBeenCalled()
})
