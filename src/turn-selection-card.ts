import { createElement as h, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import type { TurnSelection } from './turn-selection.ts'
import { selectionExplanation } from './auto-selection-explanation.ts'
import type { TurnAccountView } from './session-accounts-remote.ts'

export function TurnSelectionCard({ selection, locale = 'en', incomplete = false, readState = 'ready', retry,
  account, accountFailed = false, retryAccount }: {
  selection: TurnSelection; locale?: string; incomplete?: boolean
  readState?: 'loading' | 'ready' | 'failed'; retry?: () => void
  account?: TurnAccountView; accountFailed?: boolean; retryAccount?: () => void
}): ReactElement {
  const zh = locale.startsWith('zh')
  const id = useId()
  const [open, setOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
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
  }, [open, accountOpen])
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
  const explanation = selection.mode === 'auto' && selection.explanation !== undefined
    ? selectionExplanation(selection.explanation, locale) : undefined
  const button = { font: 'inherit', color: 'inherit', background: 'transparent', border: '1px solid var(--dsw-alias-border-main, GrayText)', borderRadius: 6, cursor: 'pointer' }
  return h('span', { style: { order: 1, display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', gap: 4,
    minWidth: 0, maxWidth: '100%', fontSize: 'var(--dsh-content-font-size-secondary, 13px)', color: 'var(--dsw-alias-label-tertiary, GrayText)' } },
  account === undefined && !accountFailed ? null : h('button', { ref: accountOpen ? trigger : undefined,
    type: 'button', style: { ...button, border: 0, padding: '1px 5px' }, 'aria-haspopup': 'dialog',
    'aria-expanded': open && accountOpen, onClick: () => { setAccountOpen(true); setOpen(true) } },
    accountFailed ? zh ? '账号记录读取失败' : 'Account unavailable'
      : account?.state === 'recorded'
        ? `Account · ${account.identity ? '@' + account.identity.login : account.accountId === 'canonical' ? 'Canonical' : account.accountId.slice(0, 8)}`
        : zh ? 'Account · 未知' : 'Account · unknown'),
  h('span', { role: readState === 'ready' ? undefined : 'status',
    title: readState === 'ready' && selection.mode === 'unknown' ? zh ? '本轮选择记录未保留；不从当前选择推断历史。' : 'No retained selection evidence; the current picker is not historical evidence.' : undefined },
  readState === 'loading' ? zh ? '正在读取选择记录…' : 'Loading selection…'
    : readState === 'failed' ? zh ? '选择记录读取失败' : 'Selection unavailable' : label),
  readState === 'failed' && retry ? h('button', { type: 'button', style: button, onClick: retry }, zh ? '重试' : 'Retry') : null,
  readState === 'ready' && (selection.mode === 'auto' || incomplete) ? h('button', { ref: accountOpen ? undefined : trigger, type: 'button', style: { ...button, width: 24, height: 24, flexShrink: 0 },
    'aria-label': zh ? '为什么本轮选择这个模型' : 'Why this model was selected', 'aria-expanded': open, 'aria-controls': open ? id : undefined,
    'aria-haspopup': 'dialog', onClick: () => { setAccountOpen(false); setOpen(value => !value) } }, 'ⓘ') : null,
  open ? h('div', { ref: panel, id, popover: 'manual', role: 'dialog', 'aria-label': accountOpen ? zh ? '本轮账号' : 'Turn account' : zh ? '本轮选择记录' : 'Turn selection evidence',
    style: { position: 'fixed', inset: 'auto', ...position, margin: 0, zIndex: 1000, width: 300, maxWidth: 'calc(100vw - 24px)',
      maxHeight: `calc(100dvh - ${position.top + 12}px)`, overflowY: 'auto', overflowWrap: 'anywhere', boxSizing: 'border-box',
      padding: 16, borderRadius: 12, border: button.border, background: 'var(--dsw-alias-bg-layer-2, Canvas)',
      color: 'var(--dsw-alias-label-primary, CanvasText)', lineHeight: 1.6 } },
    h('strong', null, accountOpen ? zh ? '本轮账号' : 'Turn account' : zh ? '为什么本轮选择这个模型' : 'Why this model was selected'),
    accountOpen ? h('div', null,
      h('p', null, accountFailed ? zh ? '无法读取本轮账号记录，不等同于没有记录。' : 'Could not read account evidence; this is not proof of missing evidence.'
        : account?.state === 'recorded' ? `${zh ? '账号' : 'Account'}: ${account.identity ? '@' + account.identity.login : account.accountId}`
          : zh ? '本轮没有保留账号证据，不从当前账号选择推断历史。' : 'No retained account evidence; the current account selection cannot reconstruct history.'),
      account?.state === 'recorded' ? h('p', null, account.source === 'global'
        ? zh ? '本轮发送时跟随全局默认，账号已锁定。' : 'Inherited the global default at turn admission; account was frozen.'
        : zh ? '本轮使用 Session 指定账号，账号已锁定。' : 'Used the Session override; account was frozen.') : null,
      h('p', null, zh ? '这是有原生流返回的请求账号记录，不是单轮费用或子 Agent 的账号汇总。仅保留在 Host 生命周期内；重启后缺失显示未知。'
        : 'Account evidence from a native stream delivery, not turn billing or subagent attribution. Retained for the Host lifetime only; missing evidence after restart is unknown.'),
      accountFailed && retryAccount ? h('button', { type: 'button', style: button, onClick: retryAccount }, zh ? '重试' : 'Retry') : null)
      : selection.mode === 'auto' ? explanation === undefined
      ? h('p', null, zh ? '本轮未保留详细选模原因；不使用当前设置反推历史。' : 'Detailed selection reasons were not retained for this turn; today’s settings cannot reconstruct them.')
      : h('div', null, h('p', null, explanation.conclusion), h('p', null, explanation.choice),
        h('details', null, h('summary', null, zh ? '查看判断依据' : 'Assessment details'),
          h('p', null, explanation.assessment),
          h('p', null, zh ? `${selection.candidateCount} 个合格候选；${selection.fittingCandidateCount ?? '未知'} 个可容纳估算输入。`
            : `${selection.candidateCount} eligible candidates; ${selection.fittingCandidateCount ?? 'unknown'} fit the estimated input.`),
          explanation.diagnostic ? h('p', null, explanation.diagnostic) : null,
          explanation.semantic ? h('p', null, explanation.semantic) : null,
          h('p', null, zh ? '分类来自供应方；不保证实际速度、费用或任务质量。' : 'Supplier categories do not guarantee actual speed, cost or task quality.'))) : null,
    !accountOpen && incomplete ? h('p', null, zh ? '模型归属不完整：部分尝试或历史未记录模型。原生 Usage 保持不变。' : 'Model attribution is incomplete: some attempts or history have no recorded model. Native Usage is unchanged.') : null,
    accountOpen ? null : h('p', null, zh ? '此记录说明选择方式，不证明执行；实际模型以原生 Usage 为准。' : 'Selection evidence is not execution proof; see native Usage for recorded models.'),
    h('button', { ref: close, type: 'button', style: button, onClick: () => { setOpen(false); trigger.current?.focus() } }, zh ? '关闭' : 'Close'),
  ) : null)
}
