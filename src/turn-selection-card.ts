import { createElement as h, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import type { TurnSelection } from './turn-selection.ts'
import { selectionExplanation } from './auto-selection-explanation.ts'
import type { TurnAccountView } from './session-accounts-remote.ts'
import type { RecordedModel } from './turn-model-provenance.ts'

export interface TurnModelEvidence {
  readonly kind: 'recorded' | 'requested' | 'unknown'
  readonly routes: readonly RecordedModel[]
  readonly incomplete: boolean
}

function turnAccountLabel(account: TurnAccountView, zh: boolean): string {
  if (account.state !== 'recorded' || account.identity === undefined) return zh ? '身份暂不可用' : 'identity unavailable'
  return `@${account.identity.login}`
}

export function TurnSelectionCard({ selection, locale = 'en', incomplete = false, readState = 'ready', retry,
  account, accountFailed = false, retryAccount, models, modelsFailed = false, retryModels, allocationEvidence }: {
  selection: TurnSelection; locale?: string; incomplete?: boolean
  readState?: 'loading' | 'ready' | 'failed'; retry?: () => void
  account?: TurnAccountView; accountFailed?: boolean; retryAccount?: () => void
  models?: TurnModelEvidence; modelsFailed?: boolean; retryModels?: () => void
  allocationEvidence?: ReactElement
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
  }, [open, accountOpen, models?.kind, models?.routes.length, modelsFailed, selection.mode])
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
        ? `${zh ? '账号' : 'Account'} · ${turnAccountLabel(account, zh)}`
        : zh ? 'Account · 未知' : 'Account · unknown'),
  h('span', { role: readState === 'ready' ? undefined : 'status',
    title: readState === 'ready' && selection.mode === 'unknown' ? zh ? '本轮选择记录未保留；不从当前选择推断历史。' : 'No retained selection evidence; the current picker is not historical evidence.' : undefined },
  readState === 'loading' ? zh ? '正在读取选择记录…' : 'Loading selection…'
    : readState === 'failed' ? zh ? '选择记录读取失败' : 'Selection unavailable' : label),
  readState === 'failed' && retry ? h('button', { type: 'button', style: button, onClick: retry }, zh ? '重试' : 'Retry') : null,
  (readState === 'ready' && (selection.mode === 'auto' || incomplete) || models !== undefined || modelsFailed) ? h('button', { ref: accountOpen ? undefined : trigger, type: 'button', style: { ...button, width: 24, height: 24, flexShrink: 0 },
    'aria-label': zh ? '查看本轮模型与选择记录' : 'View turn model and selection evidence', 'aria-expanded': open && !accountOpen, 'aria-controls': open && !accountOpen ? id : undefined,
    'aria-haspopup': 'dialog', onClick: () => { setAccountOpen(false); setOpen(value => !value) } }, 'ⓘ') : null,
  open ? h('div', { ref: panel, id, popover: 'manual', role: 'dialog', 'aria-label': accountOpen ? zh ? '本轮账号' : 'Turn account' : zh ? '本轮模型与选择记录' : 'Turn model and selection evidence',
    style: { position: 'fixed', inset: 'auto', ...position, margin: 0, zIndex: 1000, width: 390, maxWidth: 'calc(100vw - 24px)',
      maxHeight: `calc(100dvh - ${position.top + 12}px)`, overflowY: 'auto', overflowWrap: 'anywhere', boxSizing: 'border-box',
      padding: 16, borderRadius: 12, border: button.border, background: 'var(--dsw-alias-bg-layer-2, Canvas)',
      color: 'var(--dsw-alias-label-primary, CanvasText)', lineHeight: 1.6 } },
    h('strong', null, accountOpen ? zh ? '本轮账号' : 'Turn account' : zh ? '本轮模型与选择记录' : 'Turn model and selection evidence'),
    !accountOpen && models !== undefined ? h('section', { 'aria-label': zh ? '模型证据' : 'Model evidence' },
      h('p', { style: { fontWeight: 600, marginBottom: 6 } }, models.kind === 'recorded' ? zh ? '已记录模型' : 'Recorded models'
        : models.kind === 'requested' ? zh ? '请求模型' : 'Requested model' : zh ? '模型记录不可用' : 'Model evidence unavailable'),
      models.routes.length ? h('ul', { style: { listStyle: 'none', padding: 0, margin: 0 } },
        ...models.routes.map(value => h('li', { key: JSON.stringify([value.provider, value.model]), style: { marginBottom: 12 } },
          h('div', { style: { fontSize: 16 } }, value.model),
          h('div', { style: { fontSize: 12 } }, value.provider))))
        : h('p', null, zh ? '未知' : 'Unknown'),
      models.kind === 'recorded' && models.incomplete ? h('p', null, zh ? '失败尝试或缺失历史的模型归属不完整。'
        : 'Model attribution is incomplete for failed attempts or missing history.') : null,
      h('p', null, models.kind === 'recorded' ? zh ? '来自本轮成功消息的模型记录；不能证明所有失败尝试都使用了这些模型。'
        : 'From this turn’s successful message sources; this does not prove which models all failed attempts used.'
        : models.kind === 'requested' ? zh ? '来自本轮已记录步骤内的请求配置，仅证明请求模型，不证明发送、成功执行或计费用量归属。'
          : 'From request configuration inside a recorded step of this turn; not proof of dispatch, successful execution or billing attribution.'
          : zh ? '没有可靠的本轮模型证据；不从当前选择、全局默认或相邻轮次倒推。'
            : 'No reliable model evidence for this turn; the current picker, global default and adjacent turns cannot reconstruct it.'),
      modelsFailed ? h('p', { role: 'status' }, zh ? '部分模型证据读取失败，不等同于没有记录。'
        : 'Some model evidence could not be read; this is not proof of missing evidence.') : null,
      modelsFailed && retryModels ? h('button', { type: 'button', style: button, onClick: retryModels }, zh ? '重试' : 'Retry') : null,
    ) : null,
    accountOpen ? h('div', null,
      h('p', null, accountFailed ? zh ? '无法读取本轮账号记录，不等同于没有记录。' : 'Could not read account evidence; this is not proof of missing evidence.'
        : account?.state === 'recorded' ? `${zh ? '账号' : 'Account'}: ${turnAccountLabel(account, zh)}`
          : zh ? '本轮没有保留账号证据，不从当前账号选择推断历史。' : 'No retained account evidence; the current account selection cannot reconstruct history.'),
      account?.state === 'recorded' ? h('p', null, account.source === 'global'
        ? zh ? '本轮发送时跟随全局默认，账号已锁定。' : 'Inherited the global default at turn admission; account was frozen.'
        : zh ? '本轮使用 Session 指定账号，账号已锁定。' : 'Used the Session override; account was frozen.') : null,
      h('p', null, zh ? '这是有原生流返回的请求账号记录，不是单轮费用或子 Agent 的账号汇总。仅保留在 Host 生命周期内；重启后缺失显示未知。'
        : 'Account evidence from a native stream delivery, not turn billing or subagent attribution. Retained for the Host lifetime only; missing evidence after restart is unknown.'),
      accountFailed && retryAccount ? h('button', { type: 'button', style: button, onClick: retryAccount }, zh ? '重试' : 'Retry') : null)
      : h('details', { style: { borderTop: button.border, marginTop: 18, paddingTop: 12 } },
      h('summary', { style: { cursor: 'pointer' } }, zh ? '为什么选择此模型' : 'Why this model was selected'),
      selection.mode === 'auto' ? explanation === undefined
      ? h('p', null, zh ? '本轮未保留详细选模原因；不使用当前设置反推历史。' : 'Detailed selection reasons were not retained for this turn; today’s settings cannot reconstruct them.')
      : h('div', null, h('p', null, explanation.conclusion), h('p', null, explanation.choice),
        h('details', null, h('summary', null, zh ? '查看判断依据' : 'Assessment details'),
          h('p', null, explanation.assessment),
          h('p', null, zh ? `${selection.candidateCount} 个合格候选；${selection.fittingCandidateCount ?? '未知'} 个可容纳估算输入。`
            : `${selection.candidateCount} eligible candidates; ${selection.fittingCandidateCount ?? 'unknown'} fit the estimated input.`),
          explanation.diagnostic ? h('p', null, explanation.diagnostic) : null,
          explanation.semantic ? h('p', null, explanation.semantic) : null,
          h('p', null, zh ? '分类来自供应方；不保证实际速度、费用或任务质量。' : 'Supplier categories do not guarantee actual speed, cost or task quality.')))
        : h('p', null, selection.mode === 'manual' ? zh ? '本轮捕获了明确的手动选择；选择记录不是执行证明。'
          : 'An explicit manual selection was captured for this turn; selection is not execution proof.'
          : zh ? '本轮选择记录未保留；不使用当前设置反推历史。' : 'Selection evidence was not retained; today’s settings cannot reconstruct it.')),
    !accountOpen && incomplete && models === undefined ? h('p', null, zh ? '模型归属不完整：部分尝试或历史未记录模型。原生 Usage 保持不变。' : 'Model attribution is incomplete: some attempts or history have no recorded model. Native Usage is unchanged.') : null,
    !accountOpen ? allocationEvidence : null,
    accountOpen ? null : h('p', null, zh ? '模型记录与计费归属不同。选择记录不是执行证明；原生 Usage、失败状态和重试保持不变。'
      : 'Model evidence is not billing attribution. Selection is not execution proof; native Usage is unchanged, as are failures and retries.'),
    h('button', { ref: close, type: 'button', style: button, onClick: () => { setOpen(false); trigger.current?.focus() } }, zh ? '关闭' : 'Close'),
  ) : null)
}
