import { createElement as h, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import { CopilotUsageViewSchema } from './copilot-usage-remote.ts'
import { externalLinkTarget } from './external-link.ts'
import type { CopilotUsageView } from './copilot-usage-types.ts'

/** Client-only face: no credentials, provider transport or billing arithmetic. */
export interface CopilotUsageRemote {
  get(): Promise<{ ok: true; value: CopilotUsageView } | { ok: false; error: unknown }>
  refresh(): Promise<{ ok: true; value: CopilotUsageView } | { ok: false; error: unknown }>
}
export interface CopilotUsageCardProps {
  remote?: CopilotUsageRemote
  /** Changes revoke every in-flight read, including switches between Copilot routes. */
  contextKey: string
  locale?: string
}

const copy = {
  en: {
    credits: 'Credits', requests: 'Premium requests', unknown: 'Copilot usage',
    title: 'Copilot credits', account: 'Account-wide · across Copilot apps',
    used: 'used', left: 'left', usedLabel: 'Used this cycle', remaining: 'Remaining',
    unavailable: 'Not available', loading: 'Loading…', stale: 'Last known',
    individual: 'Cycle budget', pooled: 'Shared budget · no personal balance available',
    budgetUnknown: 'Budget unavailable', session: 'This session',
    sessionExplanation: 'The native adapter does not expose per-session billing usage. Token counts are not billing amounts.',
    close: 'Close usage details', refresh: 'Refresh', refreshing: 'Refreshing…',
    error: 'Could not refresh usage. Try again.', unavailableExplanation: 'Account usage is currently unavailable.',
    signedOut: 'Sign in to Copilot in Models to view account usage.',
    lastUpdated: 'Last updated', reset: 'Resets', progress: 'Cycle budget used',
    plan: 'View usage and plan', manual: 'If the browser does not open, copy this address:',
    rounding: 'Amounts rounded for display. GitHub billing is authoritative.', low: 'Low remaining budget',
    missing: 'COPILOT_USAGE_REMOTE_UNAVAILABLE · Account usage is unavailable in this deployment.',
  },
  zh: {
    credits: '额度', requests: '高级请求', unknown: 'Copilot 用量',
    title: 'Copilot 额度', account: '账号范围 · 所有 Copilot 应用',
    used: '已用', left: '剩余', usedLabel: '本周期已用', remaining: '剩余',
    unavailable: '暂不可用', loading: '正在加载…', stale: '上次已知数据',
    individual: '周期额度', pooled: '共享额度 · 无个人余额信息',
    budgetUnknown: '额度上限暂不可用', session: '本会话',
    sessionExplanation: '原生适配器未提供单个会话的计费用量。Token 数量不等于计费额度。',
    close: '关闭用量详情', refresh: '刷新', refreshing: '正在刷新…',
    error: '无法刷新用量，请重试。', unavailableExplanation: '当前无法获取账号用量。',
    signedOut: '请在模型设置中登录 Copilot，以查看账号用量。',
    lastUpdated: '更新于', reset: '重置时间', progress: '本周期已用比例',
    plan: '查看用量与套餐', manual: '若浏览器未打开，请复制此地址：',
    rounding: '显示数值经过四舍五入，账单以 GitHub 为准。', low: '剩余额度较低',
    missing: 'COPILOT_USAGE_REMOTE_UNAVAILABLE · 当前部署无法提供账号用量。',
  },
} as const

const secondary = 'var(--dsw-alias-label-secondary, GrayText)'
const border = '1px solid var(--dsw-alias-border-main, color-mix(in srgb, currentColor 20%, transparent))'
const button: CSSProperties = {
  font: 'inherit', color: 'inherit', cursor: 'pointer', border, borderRadius: 8,
  background: 'var(--dsw-alias-bg-layer-1, Canvas)', padding: '5px 9px',
}
const muted: CSSProperties = { color: secondary, fontSize: 12, lineHeight: 1.5, margin: 0 }
const row: CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }
const separator: CSSProperties = { borderTop: border, paddingTop: 12 }

function amount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}
function dateLabel(value: number | undefined, locale: string): string | undefined {
  if (!amount(value)) return undefined
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return undefined
  return date.toLocaleString(locale)
}

/** Mounted only for a proven effective Copilot selection in the owning Session. */
export function CopilotUsageCard(props: CopilotUsageCardProps): ReactElement {
  const language = props.locale?.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US'
  const t = language === 'zh-CN' ? copy.zh : copy.en
  const id = useId()
  const [view, setView] = useState<CopilotUsageView>()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ left: 12, bottom: 12 })
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const lifecycle = useRef({ active: false, generation: 0, busy: false })
  const close = useCallback((restore = false) => {
    setOpen(false)
    if (restore) trigger.current?.focus()
  }, [])

  const load = useCallback(async (force: boolean) => {
    const owner = lifecycle.current
    if (!owner.active || owner.busy || props.remote === undefined || document.visibilityState === 'hidden') return
    owner.busy = true
    const generation = ++owner.generation
    const current = () => owner.active && owner.generation === generation
    setBusy(true)
    setFailed(false)
    try {
      const result = await (force ? props.remote.refresh() : props.remote.get())
      if (!current()) return
      const parsed = result.ok ? CopilotUsageViewSchema.safeParse(result.value) : undefined
      if (parsed?.success !== true) {
        // A transport error cannot prove the old snapshot belongs to this account.
        setView(undefined)
        setFailed(true)
      } else setView(parsed.data)
    } catch {
      if (current()) { setView(undefined); setFailed(true) }
    } finally {
      if (current()) { owner.busy = false; setBusy(false) }
    }
  }, [props.remote, props.contextKey])

  useEffect(() => {
    const owner = lifecycle.current
    owner.active = true
    setView(undefined)
    setFailed(false)
    setBusy(false)
    setOpen(false)
    void load(false)
    // Host get() supplies the shared 60-second TTL; the Client does not own a cache.
    const timer = props.remote === undefined ? undefined : window.setInterval(() => { void load(false) }, 60_000)
    const visible = () => { if (document.visibilityState === 'visible') void load(false) }
    document.addEventListener('visibilitychange', visible)
    return () => {
      owner.active = false
      owner.generation++
      owner.busy = false
      if (timer !== undefined) window.clearInterval(timer)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [load, props.remote])

  useLayoutEffect(() => {
    if (!open) return
    // Native top-layer placement avoids another ReactDOM bundle or private Core DOM access.
    panel.current?.showPopover?.()
    const place = () => {
      const anchor = trigger.current?.getBoundingClientRect()
      if (!anchor) return
      const width = panel.current?.getBoundingClientRect().width || 336
      setPosition({
        left: Math.max(12, Math.min(anchor.right - width, window.innerWidth - width - 12)),
        bottom: Math.max(12, Math.min(window.innerHeight - anchor.top + 8, window.innerHeight - 40)),
      })
    }
    place()
    closeButton.current?.focus()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const outside = (event: Event) => {
      const target = event.target
      if (target instanceof Node && !panel.current?.contains(target) && !trigger.current?.contains(target)) close()
    }
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close(true) }
      if (event.key === 'Tab' && panel.current?.contains(document.activeElement)) {
        const buttons = Array.from(panel.current.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],summary'))
        const target = event.shiftKey ? buttons.at(-1) : buttons[0]
        const edge = event.shiftKey ? buttons[0] : buttons.at(-1)
        if (document.activeElement === edge) { event.preventDefault(); target?.focus() }
      }
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', key)
    }
  }, [open, close])

  const available = view?.state === 'ready' || view?.state === 'stale'
  const knownUnits = view?.billing === 'credits' || view?.billing === 'requests'
  const numbers = available && knownUnits
  const used = numbers && amount(view.used) ? view.used : undefined
  const remaining = numbers && view.budget !== 'pooled' && amount(view.remaining) ? view.remaining : undefined
  const limit = numbers && view.budget === 'individual' && amount(view.limit) ? view.limit : undefined
  const percent = numbers && view.budget === 'individual' && amount(view.percentUsed) ? view.percentUsed : undefined
  const unit = view?.billing === 'credits' ? t.credits : view?.billing === 'requests' ? t.requests : t.unknown
  const format = (value: number | undefined) => value === undefined ? t.unavailable
    : value > 0 && value < 0.01 ? '<0.01' : new Intl.NumberFormat(language, { maximumFractionDigits: 2 }).format(value)
  const compact = (value: number) => value > 0 && value < 0.01 ? '<0.01'
    : new Intl.NumberFormat(language, { notation: 'compact', maximumFractionDigits: 2 }).format(value)
  const reading = [
    unit,
    ...(view?.state === 'stale' ? [t.stale] : []),
    used === undefined ? undefined : `${compact(used)} ${t.used}`,
    remaining === undefined ? undefined : `${compact(remaining)} ${t.left}`,
  ].filter(Boolean).join(' · ')
  const noAmount = used === undefined && remaining === undefined
  const observed = available ? dateLabel(view.observedAt, language) : undefined
  const reset = available ? dateLabel(view.resetAt, language) : undefined

  return h('span', { style: { display: 'inline-flex', minWidth: 0, maxWidth: '100%', fontFamily: 'var(--dsw-font-family, inherit)' } },
    h('button', {
      ref: trigger, type: 'button', 'data-copilot-usage-trigger': '',
      'aria-haspopup': 'dialog', 'aria-expanded': open, 'aria-controls': open ? id : undefined,
      onClick: () => { setOpen(value => !value) },
      style: {
        ...button, border: 'none', background: 'transparent', borderRadius: 16, padding: '3px 5px',
        fontSize: 11, minWidth: 0, lineHeight: 1.5, textAlign: 'center', overflowWrap: 'anywhere',
        color: secondary, fontVariantNumeric: 'tabular-nums',
      },
    }, `${reading}${noAmount ? ` · ${busy ? t.loading : t.unavailable}` : ''}`),
    open ? h('div', {
      id, ref: panel, role: 'dialog', 'aria-labelledby': `${id}-title`, 'aria-describedby': `${id}-scope`,
      popover: 'manual',
      style: {
        position: 'fixed', inset: 'auto', margin: 0, ...position, width: 336, maxWidth: 'calc(100vw - 24px)',
        maxHeight: `calc(100vh - ${position.bottom + 12}px)`, overflowY: 'auto', boxSizing: 'border-box',
        zIndex: 1000, padding: 16, display: 'grid', gap: 14, border, borderRadius: 14,
        color: 'var(--dsw-alias-label-primary, CanvasText)', background: 'var(--dsw-specific-menu, Canvas)',
        fontFamily: 'var(--dsw-font-family, inherit)', fontSize: 13,
        boxShadow: '0 8px 32px color-mix(in srgb, CanvasText 16%, transparent)', overflowWrap: 'anywhere',
      },
    },
    h('div', { style: row },
      h('div', null,
        h('strong', { id: `${id}-title` }, view?.billing === 'credits' ? t.title : unit),
        h('p', { id: `${id}-scope`, style: muted }, t.account)),
      h('button', { ref: closeButton, type: 'button', 'aria-label': t.close, style: button, onClick: () => { close(true) } }, '×')),
    view?.state === 'stale' ? h('p', { role: 'status', style: muted }, t.stale) : null,
    view?.diagnostic === undefined ? null : h('code', { style: muted }, view.diagnostic),
    props.remote === undefined ? h('p', { role: 'status', style: muted }, t.missing) : null,
    failed ? h('p', { role: 'alert', style: muted }, t.error) : null,
    view?.state === 'signed-out' ? h('p', { style: muted }, t.signedOut)
      : !available && !busy && props.remote !== undefined ? h('p', { style: muted }, t.unavailableExplanation) : null,
    h('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 12 } },
      h('div', null, h('p', { style: muted }, t.usedLabel), h('strong', { style: { fontSize: 22, fontVariantNumeric: 'tabular-nums' } }, format(used)), h('p', { style: muted }, unit)),
      h('div', null, h('p', { style: muted }, t.remaining), h('strong', { style: { fontSize: 22, fontVariantNumeric: 'tabular-nums' } }, format(remaining)), h('p', { style: muted }, unit))),
    percent === undefined ? null : h('div', {
      role: 'progressbar', 'aria-label': t.progress, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': percent,
      style: { height: 5, background: 'var(--dsw-alias-bg-layer-2, ButtonFace)', borderRadius: 8, overflow: 'hidden' },
    }, h('div', { style: { height: '100%', width: `${percent}%`, background: percent >= 90 ? '#d9a441' : 'var(--dsw-alias-label-primary, CanvasText)' } })),
    view?.state === 'ready' && percent !== undefined && percent >= 90 ? h('p', { role: 'status', style: muted }, t.low) : null,
    h('p', { style: muted }, available && view.budget === 'pooled' ? t.pooled : limit === undefined ? t.budgetUnknown : `${t.individual}: ${format(limit)} ${unit}`),
    numbers ? h('p', { style: muted }, t.rounding) : null,
    reset === undefined ? null : h('p', { style: muted }, `${t.reset}: ${reset}`),
    h('div', { style: separator },
      h('div', { style: row }, h('strong', null, t.session), h('span', null, t.unavailable)),
      h('p', { style: { ...muted, marginTop: 4 } }, t.sessionExplanation)),
    h('div', { style: { ...row, ...separator } },
      h('span', { style: muted }, observed === undefined ? null : `${t.lastUpdated}: ${observed}`),
      h('button', {
        type: 'button', style: { ...button, flexShrink: 0 }, disabled: busy || props.remote === undefined,
        onClick: () => { void load(true) },
      }, busy ? t.refreshing : t.refresh)),
    h('a', { href: 'https://github.com/settings/copilot', target: externalLinkTarget(), rel: 'noreferrer',
      style: { color: 'inherit', fontSize: 12 } }, t.plan),
    h('details', { style: muted }, h('summary', { style: { cursor: 'pointer' } }, t.manual),
      h('code', { style: { userSelect: 'all', overflowWrap: 'anywhere' } }, 'https://github.com/settings/copilot')),
    ) : null,
  )
}
