import { createElement as h, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import type { TurnSelection } from './turn-selection.ts'

export function TurnSelectionCard({ selection, locale = 'en', incomplete = false, readState = 'ready', retry }: {
  selection: TurnSelection; locale?: string; incomplete?: boolean
  readState?: 'loading' | 'ready' | 'failed'; retry?: () => void
}): ReactElement {
  const zh = locale.startsWith('zh')
  const id = useId()
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ left: 12, top: 12 })
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const close = useRef<HTMLButtonElement>(null)
  useLayoutEffect(() => {
    if (!open) return
    panel.current?.showPopover?.()
    const place = () => {
      const a = trigger.current?.getBoundingClientRect(), b = panel.current?.getBoundingClientRect()
      if (a && b) setPosition({ left: Math.max(12, Math.min(a.left, innerWidth - b.width - 12)),
        top: Math.max(12, Math.min(a.top - b.height - 8, innerHeight - b.height - 12)) })
    }
    place()
    close.current?.focus()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true) }
  }, [open])
  useEffect(() => {
    if (!open) return
    const outside = (event: Event) => {
      if (event.target instanceof Node && !panel.current?.contains(event.target) && !trigger.current?.contains(event.target)) setOpen(false)
    }
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setOpen(false); trigger.current?.focus() }
    }
    document.addEventListener('pointerdown', outside); document.addEventListener('focusin', outside); document.addEventListener('keydown', key)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', outside); document.removeEventListener('keydown', key) }
  }, [open])
  const label = selection.mode === 'auto' ? `Auto (${selection.preference})`
    : selection.mode === 'manual' ? zh ? '手动' : 'Manual' : zh ? '选择方式未知' : 'Selection unknown'
  const reason = selection.mode !== 'auto' ? '' : {
    'short-text-turn': zh ? '短文本轮次' : 'Short text turn',
    'standard-turn': zh ? '常规轮次' : 'Standard turn',
    'large-structured-turn': zh ? '较大结构化轮次' : 'Large structured turn',
    'image-capability': zh ? '需要图片能力' : 'Image capability required',
  }[selection.reason]
  const button = { font: 'inherit', color: 'inherit', background: 'transparent', border: '1px solid var(--dsw-alias-border-main, GrayText)', borderRadius: 6, cursor: 'pointer' }
  return h('span', { style: { order: 1, display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', gap: 4,
    minWidth: 0, maxWidth: '100%', fontSize: 'var(--dsh-content-font-size-secondary, 13px)', color: 'var(--dsw-alias-label-tertiary, GrayText)' } },
  h('span', { role: readState === 'ready' ? undefined : 'status',
    title: readState === 'ready' && selection.mode === 'unknown' ? zh ? '本轮选择记录未保留；不从当前选择推断历史。' : 'No retained selection evidence; the current picker is not historical evidence.' : undefined },
  readState === 'loading' ? zh ? '正在读取选择记录…' : 'Loading selection…'
    : readState === 'failed' ? zh ? '选择记录读取失败' : 'Selection unavailable' : label),
  readState === 'failed' && retry ? h('button', { type: 'button', style: button, onClick: retry }, zh ? '重试' : 'Retry') : null,
  readState === 'ready' && (selection.mode === 'auto' || incomplete) ? h('button', { ref: trigger, type: 'button', style: { ...button, width: 24, height: 24, flexShrink: 0 },
    'aria-label': zh ? '本轮选择记录' : 'Turn selection evidence', 'aria-expanded': open, 'aria-controls': open ? id : undefined,
    'aria-haspopup': 'dialog', onClick: () => setOpen(value => !value) }, 'ⓘ') : null,
  open ? h('div', { ref: panel, id, popover: 'manual', role: 'dialog', 'aria-label': zh ? '本轮选择记录' : 'Turn selection evidence',
    style: { position: 'fixed', inset: 'auto', ...position, margin: 0, zIndex: 1000, width: 300, maxWidth: 'calc(100vw - 24px)',
      maxHeight: `calc(100dvh - ${position.top + 12}px)`, overflowY: 'auto', overflowWrap: 'anywhere', boxSizing: 'border-box',
      padding: 16, borderRadius: 12, border: button.border, background: 'var(--dsw-alias-bg-layer-2, Canvas)',
      color: 'var(--dsw-alias-label-primary, CanvasText)', lineHeight: 1.6 } },
    h('strong', null, zh ? '本轮选择记录' : 'Turn selection evidence'),
    selection.mode === 'auto' ? h('p', null, `${reason}. `,
      zh ? `容量偏好：${selection.preference}。` : `Capacity preference: ${selection.preference}. `,
      zh ? `从 ${selection.candidateCount} 个合格模型中选择。` : `Selected from ${selection.candidateCount} eligible models.`,
      selection.fittingCandidateCount === undefined ? '' : zh ? `其中 ${selection.fittingCandidateCount} 个可容纳估算输入。` : ` ${selection.fittingCandidateCount} fit the estimated input.`) : null,
    incomplete ? h('p', null, zh ? '模型归属不完整：部分尝试或历史未记录模型。原生 Usage 保持不变。' : 'Model attribution is incomplete: some attempts or history have no recorded model. Native Usage is unchanged.') : null,
    h('p', null, zh ? '此记录说明选择方式，不证明执行；实际模型以原生 Usage 为准。' : 'Selection evidence is not execution proof; see native Usage for recorded models.'),
    h('button', { ref: close, type: 'button', style: button, onClick: () => { setOpen(false); trigger.current?.focus() } }, zh ? '关闭' : 'Close'),
  ) : null)
}
