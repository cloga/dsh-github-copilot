import type { Context } from '@deepseek-ai/cordis'
import { createElement as h, useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactElement } from 'react'
import { ReplayRecoveryViewSchema } from './replay-recovery-types.ts'
import type { ReplayRecoveryDuration, ReplayRecoveryView } from './replay-recovery-types.ts'

export interface ReplayRecoveryRemote {
  get(agentId: string): Promise<{ ok: boolean; value?: unknown }>
  setEnabled(agentId: string, revision: string, enabled: boolean): Promise<{ ok: boolean; value?: unknown }>
  authorize(agentId: string, revision: string, duration: ReplayRecoveryDuration): Promise<{ ok: boolean; value?: unknown }>
}
const noop = () => {}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
export function ReplayRecoveryCard({ sessionId, remote, locale = 'en', running = false, refreshKey = '' }: {
  sessionId: string; remote: ReplayRecoveryRemote; locale?: string; running?: boolean; refreshKey?: string
}): ReactElement | null {
  const zh = locale.startsWith('zh')
  const durationName = useId()
  const [view, setView] = useState<ReplayRecoveryView>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [duration, setDuration] = useState<ReplayRecoveryDuration>('next-turn')
  const [dismissed, setDismissed] = useState<string>()
  const [hadEvidence, setHadEvidence] = useState(false)
  const latest = useRef(view)
  const active = useRef(running)
  latest.current = view
  active.current = running
  const pending = useRef(false)
  const refreshPending = useRef(false)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const perform = useCallback(async (authorization?: ReplayRecoveryDuration | false): Promise<void> => {
    if (pending.current) {
      if (authorization === undefined) refreshPending.current = true
      return
    }
    if (active.current) return
    pending.current = true
    setBusy(true); setError(false); setConfirm(false)
    try {
      const current = latest.current
      const result = authorization === undefined ? await remote.get(sessionId)
        : current && current.state !== 'unavailable'
          ? authorization === false ? await remote.setEnabled(sessionId, current.revision, false)
            : await remote.authorize(sessionId, current.revision, authorization)
          : undefined
      const parsed = result?.ok ? ReplayRecoveryViewSchema.safeParse(result.value) : undefined
      if (!mounted.current) return
      if (parsed?.success) {
        setView(parsed.data)
        if (parsed.data.state !== 'unavailable') setHadEvidence(true)
      }
      else { setView(undefined); setError(true) }
    } catch {
      if (mounted.current) { setView(undefined); setError(true) }
    } finally {
      pending.current = false
      if (mounted.current) {
        setBusy(false)
        if (refreshPending.current) { refreshPending.current = false; void perform() }
      }
    }
  }, [remote, sessionId])
  useEffect(() => {
    setConfirm(false)
    if (!running) void perform()
  }, [running, refreshKey, perform])
  const expiresAt = view && view.state !== 'unavailable' ? view.expiresAt : undefined
  useEffect(() => {
    if (expiresAt === undefined) return
    const timer = setTimeout(() => void perform(), Math.max(0, expiresAt - Date.now()))
    return () => clearTimeout(timer)
  }, [expiresAt, perform])
  const button = { font: 'inherit', color: 'inherit', background: 'transparent',
    border: '1px solid var(--dsw-alias-border-main, GrayText)', borderRadius: 6, padding: '6px 10px' }
  const disabled = busy || running
  const evidence = view && view.state !== 'unavailable' ? view : undefined
  if (!error && !evidence && !hadEvidence) return null
  if (!error && evidence?.state === 'available' && dismissed === evidence.revision) {
    return h('button', { type: 'button', style: button, disabled, onClick: () => setDismissed(undefined) },
      zh ? '回放恢复 · 查看' : 'Replay recovery · Review')
  }
  return h('section', { 'aria-label': zh ? '回放恢复' : 'Replay recovery',
    'aria-busy': busy, style: { maxWidth: 'min(100%, 38rem)', overflowWrap: 'anywhere', paddingBlock: 8 } },
  h('strong', { role: 'status' }, evidence?.state === 'enabled'
    ? zh ? '回放恢复已授权' : 'Replay recovery authorized'
    : evidence ? zh ? '旧推理回放被拒绝' : 'Old reasoning replay was rejected'
      : zh ? '回放恢复' : 'Replay recovery'),
  error ? h('p', { role: 'alert' }, zh
    ? '无法读取或更改恢复状态。请等当前轮结束后重新读取；旧确认可能已过期。'
    : 'Recovery could not be read or changed. Wait for the active turn to end and read again; the prior confirmation may have expired.') : null,
  view?.state === 'unavailable' ? h('p', null, zh
    ? '授权或失败证据已失效。恢复未启用；没有当前可用的失败证据。'
    : 'Authorization or failure evidence expired. Recovery is off; no current failure evidence is available.') : null,
  evidence ? h('div', null,
    h('p', null, zh ? `${evidence.model}：${evidence.itemCount} 条已识别的旧加密推理项。`
      : `${evidence.model}: ${evidence.itemCount} identified old encrypted reasoning items.`),
    evidence.state === 'enabled' ? h('p', null,
      evidence.duration === 'next-turn'
        ? zh ? '仅下一轮使用恢复，覆盖该轮的全部步骤与原生重试，轮结束即关闭。' : 'Authorized for the next matching turn only, including all its steps and native retries; turns off when that turn ends.'
        : zh ? '本会话继续使用恢复，直到关闭或验证状态失效。' : 'Authorized for this session until disabled or validation expires.',
      ' ', zh ? '尚未发送消息。请使用原生发送或重试按钮继续。' : 'No message has been sent. Use the native Send or Retry control to continue.') :
      h('p', null, zh ? '恢复未启用。确认损失后才能跳过这些旧项；不会自动重试。'
        : 'Recovery is off. Review the loss before skipping these old items; nothing is retried automatically.'),
    confirm ? h('div', null,
      h('p', null, zh
        ? '恢复会跳过已识别的旧项，包括对应隐藏推理状态及项内摘要。磁盘历史、界面可见消息及工具调用保持不变；新推理照常保留。关闭不能撤销已生成的回答。'
        : 'Recovery skips the identified old items, including their hidden reasoning state and item summaries. Stored history, displayed messages and tool calls stay unchanged; new reasoning is retained. Disabling cannot undo generated answers.'),
      h('fieldset', { disabled, style: { border: 0, padding: 0, marginBlock: 12 } },
        h('legend', null, zh ? '授权范围' : 'Authorization duration'),
        ...(['next-turn', 'session'] as const).map(value => h('label', { key: value, style: { display: 'block', paddingBlock: 6 } },
          h('input', { type: 'radio', name: durationName, value, checked: duration === value, onChange: () => setDuration(value) }),
          ' ', value === 'next-turn' ? zh ? '仅下一轮使用恢复' : 'Next matching turn only'
            : zh ? '在本会话内继续使用' : 'Continue in this session'))),
      h('p', null, zh ? '两种授权都只适用于相同模型及验证状态，最长不超过失败证据产生后一小时；Host 重启后失效。不会处理 408、额度或上下文超限。'
        : 'Both options require the same model and validation state, expire within one hour of the failure, and are lost on Host restart. Not a remedy for 408, quota or context limits.'),
      h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8 } },
        h('button', { type: 'button', style: button, disabled, onClick: () => void perform(duration) },
          zh ? '接受损失并授权' : 'Accept loss and authorize'),
        h('button', { type: 'button', style: button, disabled, onClick: () => setConfirm(false) }, zh ? '取消' : 'Cancel'))) :
      h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8 } },
        h('button', { type: 'button', style: button, disabled,
          onClick: () => evidence.state === 'enabled' ? void perform(false) : (setDuration('next-turn'), setConfirm(true)) },
        evidence.state === 'enabled' ? zh ? '关闭恢复' : 'Disable recovery' : zh ? '查看恢复选项' : 'Review recovery options'),
        evidence.state === 'available' ? h('button', { type: 'button', style: button, disabled,
          onClick: () => setDismissed(evidence.revision) }, zh ? '暂不处理' : 'Not now') : null),
  ) : null,
  running ? h('p', { role: 'status' }, zh ? '当前轮进行中，结束后自动更新。' : 'Turn in progress; status updates when it ends.') : null,
  h('button', { type: 'button', style: { ...button, marginBlock: 8 }, disabled, onClick: () => void perform() },
    busy ? zh ? '正在读取…' : 'Reading…' : zh ? '重新读取状态' : 'Read status again'))
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
  const running = runtime.useSession(value => !record(value) || value.running !== false)
  const lastError = runtime.useSession(value => record(value) && typeof value.lastAgentError === 'string' ? value.lastAgentError : '')
  const language = useSyncExternalStore(listener => locale?.subscribe(listener) ?? noop,
    () => locale?.getLocale().active ?? 'en', () => 'en')
  if (!valid || !record(selected) || !record(selected.next) || selected.next.provider !== 'github-copilot-preview') return null
  return h(ReplayRecoveryCard, { key: JSON.stringify([runtime.sessionId, selected.next.model]),
    sessionId: runtime.sessionId, remote, locale: language, running, refreshKey: lastError })
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
