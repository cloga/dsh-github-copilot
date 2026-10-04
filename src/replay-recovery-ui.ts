import type { Context } from '@deepseek-ai/cordis'
import { createElement as h, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactElement, SyntheticEvent } from 'react'
import { ReplayRecoveryViewSchema } from './replay-recovery-types.ts'
import type { ReplayRecoveryView } from './replay-recovery-types.ts'

export interface ReplayRecoveryRemote {
  get(agentId: string): Promise<{ ok: boolean; value?: unknown }>
  setEnabled(agentId: string, revision: string, enabled: boolean): Promise<{ ok: boolean; value?: unknown }>
}
const noop = () => {}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
export function ReplayRecoveryCard({ sessionId, remote, locale = 'en' }: {
  sessionId: string; remote: ReplayRecoveryRemote; locale?: string
}): ReactElement {
  const zh = locale.startsWith('zh')
  const [view, setView] = useState<ReplayRecoveryView>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const pending = useRef(false)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const perform = async (enabled?: boolean) => {
    if (pending.current) return
    pending.current = true
    setBusy(true); setError(false); setConfirm(false)
    try {
      const result = enabled === undefined ? await remote.get(sessionId)
        : view && view.state !== 'unavailable' ? await remote.setEnabled(sessionId, view.revision, enabled)
          : undefined
      const parsed = result?.ok ? ReplayRecoveryViewSchema.safeParse(result.value) : undefined
      if (!mounted.current) return
      if (parsed?.success) setView(parsed.data)
      else { setView(undefined); setError(true) }
    } catch {
      if (mounted.current) { setView(undefined); setError(true) }
    } finally { pending.current = false; if (mounted.current) setBusy(false) }
  }
  const button = { font: 'inherit', color: 'inherit', background: 'transparent',
    border: '1px solid var(--dsw-alias-border-main, GrayText)', borderRadius: 6, padding: '6px 10px' }
  return h('details', { style: { maxWidth: 'min(100%, 38rem)', overflowWrap: 'anywhere' },
    onToggle: (event: SyntheticEvent<HTMLDetailsElement>) => { if (event.currentTarget.open && view === undefined && !busy && !error) void perform() } },
  h('summary', { style: { cursor: 'pointer' } }, zh ? '回放恢复' : 'Replay recovery'),
  h('p', null, zh ? '仅用于 Copilot 的旧加密推理回放被拒绝。不会处理 408、额度或上下文超限。'
    : 'For rejected old Copilot encrypted reasoning only. Not a remedy for 408, quota or context limits.'),
  busy ? h('p', { role: 'status' }, zh ? '正在处理…' : 'Working…') : null,
  error ? h('p', { role: 'alert' }, zh
    ? '无法读取或更改恢复状态。请等当前轮结束后重新读取；旧确认可能已过期。'
    : 'Recovery could not be read or changed. Wait for the active turn to end and read again; the prior confirmation may have expired.') : null,
  view?.state === 'unavailable' ? h('p', null, zh
    ? '没有当前可用的失败证据。仅保留本次 Host 运行中、同一账号验证状态下最近一小时的证据。'
    : 'No current failure evidence. Evidence lasts at most one hour in this Host under the same account validation state.') : null,
  view && view.state !== 'unavailable' ? h('div', null,
    h('p', null, zh ? `${view.model}：${view.itemCount} 条旧加密推理项。${view.state === 'enabled' ? '恢复已启用。' : '默认保留完整回放。'}`
      : `${view.model}: ${view.itemCount} old encrypted reasoning items. ${view.state === 'enabled' ? 'Recovery enabled.' : 'Full replay is retained by default.'}`),
    h('p', null, zh
      ? '启用后，仅本会话后续请求跳过这些已识别的旧项，包括对应隐藏推理状态及项内摘要。磁盘历史、界面可见消息及工具调用保持不变；新推理照常保留。不会自动重试或发送消息。关闭只影响后续请求，不能撤销已生成的回答。'
      : 'Enabling skips these identified old items only on later requests in this session, including their hidden reasoning state and item summaries. Stored history, displayed messages and tool calls stay unchanged; new reasoning is retained. No retry or message is sent automatically. Disabling affects later requests and cannot undo generated answers.'),
    confirm ? h('div', null,
      h('p', null, zh ? '确认接受上述隐藏推理状态损失？' : 'Accept the hidden-reasoning loss described above?'),
      h('button', { type: 'button', style: button, disabled: busy, onClick: () => void perform(true) },
        zh ? '接受损失并启用' : 'Accept loss and enable'),
      h('button', { type: 'button', style: button, disabled: busy, onClick: () => setConfirm(false) }, zh ? '取消' : 'Cancel')) :
      h('button', { type: 'button', style: button, disabled: busy,
        onClick: () => view.state === 'enabled' ? void perform(false) : setConfirm(true) },
      view.state === 'enabled' ? zh ? '关闭恢复' : 'Disable recovery' : zh ? '查看启用确认' : 'Review activation'),
  ) : null,
  h('button', { type: 'button', style: { ...button, marginBlock: 8 }, disabled: busy, onClick: () => void perform() },
    zh ? '重新读取状态' : 'Read status again'))
}

interface Slots {
  spec(name: string): { kind: string; scope: string } | undefined
  inject(name: string, callback: () => () => void): () => void
  register(options: { name: string; id: string; order: number }, component: (props: Record<string, unknown>) => ReactElement | null): () => void
}
interface Locale { getLocale(): { active: string }; subscribe(listener: () => void): () => void }
interface Runtime {
  sessionId: string
  useSession<T>(selector: (snapshot: unknown) => T): T
  useProjection(key: string): unknown
}
function isSlots(value: unknown): value is Slots {
  return record(value) && typeof value.spec === 'function' && typeof value.inject === 'function' && typeof value.register === 'function'
}
function isLocale(value: unknown): value is Locale {
  return record(value) && typeof value.getLocale === 'function' && typeof value.subscribe === 'function'
}
function isRuntime(value: unknown): value is Runtime {
  return record(value) && typeof value.sessionId === 'string' && value.sessionId !== ''
    && typeof value.useSession === 'function' && typeof value.useProjection === 'function'
}
function Surface({ runtime, remote, locale }: { runtime: Runtime; remote: ReplayRecoveryRemote; locale: Locale | undefined }): ReactElement | null {
  const valid = runtime.useSession(value => record(value) && value.sessionId === runtime.sessionId
    && value.removed === false && value.openState === 'open')
  const selected = runtime.useProjection('modelSelection')
  const language = useSyncExternalStore(listener => locale?.subscribe(listener) ?? noop,
    () => locale?.getLocale().active ?? 'en', () => 'en')
  if (!valid || !record(selected) || !record(selected.next) || selected.next.provider !== 'github-copilot-preview') return null
  return h(ReplayRecoveryCard, { key: runtime.sessionId, sessionId: runtime.sessionId, remote, locale: language })
}
export function registerReplayRecoveryUi(ctx: Context): () => void {
  const candidate: unknown = ctx.get('slots')
  if (!isSlots(candidate)) {
    ctx.logger.warn('COPILOT_REPLAY_RECOVERY_SLOT_UNAVAILABLE'); return noop
  }
  const slots = candidate
  const remote = ctx.remote.githubCopilotReplayRecovery
  const language: unknown = ctx.get('locale')
  const locale = isLocale(language) ? language : undefined
  const name = 'conversation.composer.dock'
  return slots.inject(name, () => {
    const spec = slots.spec(name)
    if (spec?.kind !== 'list' || spec.scope !== 'session') { ctx.logger.warn('COPILOT_REPLAY_RECOVERY_SLOT_UNAVAILABLE'); return noop }
    return slots.register({ name, id: 'github-copilot-replay-recovery', order: 30 }, props => {
      if (!isRuntime(props)) {
        ctx.logger.warn('COPILOT_REPLAY_RECOVERY_SESSION_UNAVAILABLE'); return null
      }
      return h(Surface, { runtime: props, remote, locale })
    })
  })
}
