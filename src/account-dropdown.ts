import { createElement as h, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, ReactElement, RefObject } from 'react'

export interface AccountDropdownOption {
  id: string
  label: string
  selected: boolean
  disabled?: boolean
}

export function AccountDropdown(props: {
  label: string
  open: boolean
  disabled?: boolean
  busy?: boolean
  options: AccountDropdownOption[]
  onOpenChange(open: boolean): void
  onSelect(id: string): void
  triggerStyle: CSSProperties
  triggerRef?: RefObject<HTMLButtonElement | null>
  footer?: ReactElement | null
  listAttribute: 'data-copilot-saved-accounts' | 'data-copilot-account-options'
  maxHeight?: number
}): ReactElement {
  const id = useId()
  const localTrigger = useRef<HTMLButtonElement>(null)
  const trigger = props.triggerRef ?? localTrigger
  const menu = useRef<HTMLDivElement>(null)
  const [placement, setPlacement] = useState({ left: 12, top: 12, maxHeight: 300 })
  const change = useRef(props.onOpenChange)
  change.current = props.onOpenChange
  useLayoutEffect(() => {
    if (!props.open) return
    menu.current?.showPopover?.()
    const place = () => {
      const anchor = trigger.current?.getBoundingClientRect()
      if (!anchor) return
      const width = Math.min(300, window.innerWidth - 24)
      const height = Math.min(menu.current?.scrollHeight ?? 300, 330)
      const below = window.innerHeight - anchor.bottom - 20
      const above = anchor.top - 20
      const upwards = below < height && above > below
      const maxHeight = Math.max(60, Math.min(330, upwards ? above : below))
      setPlacement({ left: Math.max(12, Math.min(anchor.right - width, window.innerWidth - width - 12)),
        top: upwards ? Math.max(12, anchor.top - Math.min(height, maxHeight) - 8) : anchor.bottom + 8,
        maxHeight })
    }
    place()
    const selected = menu.current?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]:not(:disabled)')
    ;(selected ?? menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)'))?.focus()
    window.addEventListener('resize', place)
    const scroll = (event: Event) => {
      if (event.target instanceof Node && menu.current?.contains(event.target)) return
      place()
    }
    window.addEventListener('scroll', scroll, true)
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', scroll, true) }
  }, [props.open, trigger])
  useEffect(() => {
    if (!props.open) return
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !menu.current?.contains(event.target) && !trigger.current?.contains(event.target)) {
        change.current(false)
      }
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [props.open, trigger])
  return h('div', { 'data-copilot-account-dropdown': '', style: { position: 'relative', minWidth: 0, flexShrink: 0 } },
    h('style', null, `
      [data-copilot-account-dropdown] > button::after { content: ' ▾'; padding-left: 6px; font-size: 11px }
      [data-copilot-dropdown-option]::before { content: ''; width: 16px; flex-shrink: 0 }
      [data-copilot-dropdown-option][aria-pressed=true]::before { content: '✓' }
      [data-copilot-dropdown-option]:hover { background: var(--dsw-alias-bg-layer-2, ButtonFace) !important }
      [data-copilot-account-dropdown] button:focus-visible { outline: 2px solid var(--dsw-alias-label-primary, CanvasText); outline-offset: -2px }
    `),
    h('button', { ref: trigger, type: 'button', style: { ...props.triggerStyle, whiteSpace: 'nowrap' }, disabled: props.disabled,
      'aria-label': props.label,
      'aria-expanded': props.open, 'aria-controls': props.open ? id : undefined,
      onClick: () => props.onOpenChange(!props.open) }, props.label),
    props.open ? h('div', { ref: menu, id, popover: 'manual', role: 'group', 'aria-label': props.label,
      'aria-busy': props.busy, 'data-copilot-account-selector': '',
      style: { position: 'fixed', inset: 'auto', margin: 0, ...placement, zIndex: 1100,
        width: 300, maxWidth: 'calc(100vw - 24px)', boxSizing: 'border-box', overflowY: 'auto',
        padding: 5, border: '1px solid var(--dsw-alias-border-main, GrayText)', borderRadius: 10,
        background: 'linear-gradient(var(--dsw-specific-menu, Canvas), var(--dsw-specific-menu, Canvas)), Canvas',
        color: 'var(--dsw-alias-label-primary, CanvasText)',
        colorScheme: 'inherit', font: 'inherit', boxShadow: '0 10px 28px rgb(0 0 0 / 24%)' },
      onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
        const buttons = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])
        if (event.key === 'Escape') {
          event.preventDefault(); event.stopPropagation(); props.onOpenChange(false); trigger.current?.focus()
        } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault()
          const current = document.activeElement instanceof HTMLButtonElement ? buttons.indexOf(document.activeElement) : -1
          const index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
            : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
          buttons[index]?.focus()
        } else if (event.key === 'Tab') {
          trigger.current?.focus()
          props.onOpenChange(false)
        }
      } },
      h('div', { [props.listAttribute]: '', style: { display: 'grid', maxHeight: props.maxHeight ?? 240,
        overflowY: 'auto', overscrollBehavior: 'contain' } },
        ...props.options.map(option => h('button', { key: option.id, type: 'button',
          'data-copilot-dropdown-option': '', 'data-copilot-saved-account': option.id,
          'aria-label': option.label,
          'aria-pressed': option.selected, disabled: props.busy || option.disabled,
          style: { font: 'inherit', color: 'inherit', colorScheme: 'inherit', display: 'flex', alignItems: 'center',
            gap: 8, border: 0, borderRadius: 5, padding: '10px 8px', minHeight: 42,
            textAlign: 'left', overflowWrap: 'anywhere', cursor: 'pointer', background: 'transparent' },
          onClick: () => props.onSelect(option.id) }, option.label))),
      props.footer ? h('div', { style: { borderTop: '1px solid var(--dsw-alias-border-main, GrayText)',
        marginTop: 5, padding: '6px 4px' } }, props.footer) : null) : null)
}
