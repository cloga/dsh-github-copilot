import { createElement as h, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import type { TurnUsageDiagnostic } from './turn-usage-evidence.ts'

export function TurnUsageNotice({ diagnostic, locale = 'en' }: {
  readonly diagnostic: TurnUsageDiagnostic
  readonly locale?: string
}): ReactElement {
  const zh = locale.startsWith('zh')
  const id = useId()
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ left: 12, top: 12 })
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const close = useRef<HTMLButtonElement>(null)
  const label = zh ? '本轮用量统计不完整' : 'Turn Usage incomplete'
  const timeouts = diagnostic.requestBodyTimeouts ?? 0
  const unknown = diagnostic.unreportedAttempts - timeouts
  useLayoutEffect(() => {
    if (!open) return
    panel.current?.showPopover?.()
    const place = () => {
      const a = trigger.current?.getBoundingClientRect(), b = panel.current?.getBoundingClientRect()
      if (a && b) setPosition({
        left: Math.max(12, Math.min(a.left, innerWidth - b.width - 12)),
        top: Math.max(12, Math.min(a.top - b.height - 8, innerHeight - b.height - 12)),
      })
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
    document.addEventListener('pointerdown', outside)
    document.addEventListener('focusin', outside)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('focusin', outside)
      document.removeEventListener('keydown', key)
    }
  }, [open])
  const button = { font: 'inherit', color: 'inherit', background: 'transparent',
    border: '1px solid var(--dsw-alias-border-main, GrayText)', borderRadius: 6, cursor: 'pointer' }
  return h('span', { style: {
    order: 2, display: 'inline-flex', minWidth: 0, maxWidth: '100%',
    fontSize: 'var(--dsh-content-font-size-secondary, 13px)', color: 'var(--dsw-alias-label-tertiary, GrayText)',
  } },
  h('button', { ref: trigger, type: 'button', style: { ...button, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
    title: label, 'aria-expanded': open, 'aria-controls': open ? id : undefined, 'aria-haspopup': 'dialog',
    onClick: () => setOpen(value => !value) }, label),
  open ? h('div', { ref: panel, id, popover: 'manual', role: 'dialog', 'aria-label': label,
    style: {
      position: 'fixed', inset: 'auto', ...position, margin: 0, zIndex: 1000,
      width: 340, maxWidth: 'calc(100vw - 24px)', maxHeight: `calc(100dvh - ${position.top + 12}px)`,
      boxSizing: 'border-box', overflowY: 'auto', overflowWrap: 'anywhere', padding: 16, borderRadius: 12,
      border: button.border, background: 'var(--dsw-alias-bg-layer-2, Canvas)',
      color: 'var(--dsw-alias-label-primary, CanvasText)', lineHeight: 1.6,
    },
  },
  h('strong', null, label),
  h('p', null, zh
    ? '本轮没有可确认的完整用量总计。回复成功，也不代表每次尝试都记录了用量。'
    : 'A complete usage total is unavailable for this turn. A successful reply does not mean every attempt reported usage.'),
  diagnostic.localPreDispatchBlocks > 0 ? h('p', null, zh
    ? `记录中有 ${diagnostic.localPreDispatchBlocks} 次插件发出前的本地输入预算拦截，未记录供应商用量。后续压缩恢复不会补齐这些尝试的用量。`
    : `The history records ${diagnostic.localPreDispatchBlocks} local input-budget ${diagnostic.localPreDispatchBlocks === 1 ? 'block' : 'blocks'} before provider dispatch, with no reported provider usage. Subsequent compaction recovery does not fill in those attempts' usage.`) : null,
  timeouts > 0 ? h('p', null, zh
    ? `${timeouts} 次缺失用量的记录带有已记录的 HTTP 408 请求体读取超时诊断；这不是上下文窗口溢出，也不能据此判断是否计费。`
    : `${timeouts} ${timeouts === 1 ? 'attempt without usage has' : 'attempts without usage have'} a recorded HTTP 408 request-body timeout diagnosis. This is not context-window overflow and does not establish billing.`) : null,
  diagnostic.timeoutDetails?.length ? h('ul', { style: { paddingInlineStart: 20 } },
    ...diagnostic.timeoutDetails.map((detail, index) => h('li', { key: index },
      zh
        ? `${detail.step === undefined ? '步骤未知' : `步骤 ${detail.step}`} · ${detail.seq === undefined ? '记录编号未知' : `记录 ${detail.seq}`}：${detail.recovered ? '已记录同一步骤重试成功；但失败尝试的用量仍缺失。' : '没有足够证据确认这次尝试后重试成功。'}`
        : `${detail.step === undefined ? 'Step unknown' : `Step ${detail.step}`} · ${detail.seq === undefined ? 'Record unknown' : `record ${detail.seq}`}: ${detail.recovered ? 'A same-step retry completed successfully; the failed attempt’s usage is still missing.' : 'A successful retry after this attempt is not established.'}`)),
  ) : null,
  timeouts > (diagnostic.timeoutDetails?.length ?? 0) ? h('p', null, zh
    ? '这里只展示最多 8 条超时记录的定位信息；计数包含其余记录。'
    : 'Details are limited to 8 timeout records; the count includes the remaining records.') : null,
  unknown > 0 ? h('p', null, zh
    ? `另有 ${unknown} 次完成或失败记录未带用量样本，原因未知；不能据此判断请求是否发出或计费。`
    : `${unknown} other ${unknown === 1 ? 'settlement has' : 'settlements have'} no reported usage sample and an unknown cause; this does not establish whether a request was sent or billed.`) : null,
  diagnostic.incompleteHistory ? h('p', null, zh
    ? '本页未保留完整轮次证据；以上记录可能不完整。'
    : 'Complete turn evidence is not retained on this page; these records may be incomplete.') : null,
  diagnostic.localPreDispatchBlocks === 0 && diagnostic.unreportedAttempts === 0 ? h('p', null, zh
    ? '现有证据无法确定原因；缺失的生命周期或无效用量也会使原生统计不可用。'
    : 'The available evidence does not identify a cause; missing lifecycle boundaries or invalid usage can also make native accounting unavailable.') : null,
  h('p', null, zh
    ? '这是只读说明，不是零用量、部分合计或当前上下文占用。原生 Usage、用量记录与压缩恢复均保持不变。'
    : 'This read-only explanation is not zero usage, a partial total or current context occupancy. Native Usage, usage records and compaction recovery remain unchanged.'),
  h('button', { ref: close, type: 'button', style: button,
    onClick: () => { setOpen(false); trigger.current?.focus() } }, zh ? '关闭' : 'Close')) : null)
}
