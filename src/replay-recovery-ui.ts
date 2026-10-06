import type { Context } from '@deepseek-ai/cordis'
import { createElement as h, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactElement } from 'react'
import { ReplayRecoveryViewSchema } from './replay-recovery-types.ts'
import type { ReplayRecoveryDuration, ReplayRecoveryView } from './replay-recovery-types.ts'
import { SessionContinuationCard } from './session-continuation-ui.ts'
import type { SessionContinuationRemote } from './session-continuation-ui.ts'
import { composerNoticeStyle, composerNoticeSurfaceStyle,
  composerNoticeParagraphStyle, composerNoticeButtonStyle } from './composer-notice-style.ts'

export interface ReplayRecoveryRemote {
  get(agentId: string): Promise<{ ok: boolean; value?: unknown }>
  setEnabled(agentId: string, revision: string, enabled: boolean): Promise<{ ok: boolean; value?: unknown }>
  authorize(agentId: string, revision: string, duration: ReplayRecoveryDuration): Promise<{ ok: boolean; value?: unknown }>
}
const noop = () => {}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
export function ReplayRecoveryCard({ sessionId, remote, continuation, locale = 'en', running = false, refreshKey = '' }: {
  sessionId: string; remote: ReplayRecoveryRemote; locale?: string; running?: boolean; refreshKey?: string
  continuation?: SessionContinuationRemote
}): ReactElement | null {
  const zh = locale.startsWith('zh')
  const [view, setView] = useState<ReplayRecoveryView>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const [dismissed, setDismissed] = useState<string>()
  const [hadEvidence, setHadEvidence] = useState(false)
  const active = useRef(running)
  active.current = running
  const pending = useRef(false)
  const refreshPending = useRef(false)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const perform = useCallback(async (): Promise<void> => {
    if (pending.current) {
      refreshPending.current = true
      return
    }
    if (active.current) return
    pending.current = true
    setBusy(true); setError(false)
    try {
      const result = await remote.get(sessionId)
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
    if (!running) void perform()
  }, [running, refreshKey, perform])
  const expiresAt = view && view.state !== 'unavailable' ? view.expiresAt : undefined
  useEffect(() => {
    if (expiresAt === undefined) return
    const timer = setTimeout(() => void perform(), Math.max(0, expiresAt - Date.now()))
    return () => clearTimeout(timer)
  }, [expiresAt, perform])
  const button = composerNoticeButtonStyle
  const disabled = busy || running
  const evidence = view && view.state !== 'unavailable' ? view : undefined
  if (!error && !evidence && !hadEvidence) return null
  if (!error && evidence && dismissed === evidence.revision) {
    return h('button', { type: 'button', style: { ...button, ...composerNoticeStyle,
      width: 'auto', alignSelf: 'center', color: button.color },
      disabled, onClick: () => setDismissed(undefined) },
      zh ? '回放恢复 · 查看' : 'Replay recovery · Review')
  }
  return h('section', { 'aria-label': zh ? '回放恢复' : 'Replay recovery',
    'data-copilot-composer-notice': 'replay', 'aria-busy': busy, style: composerNoticeSurfaceStyle },
  h('strong', { role: 'status', style: { color: 'var(--dsw-alias-label-primary, CanvasText)', fontWeight: 600 } }, evidence ? zh ? '旧推理回放被拒绝' : 'Old reasoning replay was rejected'
      : zh ? '回放恢复' : 'Replay recovery'),
  error ? h('p', { role: 'alert', style: composerNoticeParagraphStyle }, zh
    ? '无法读取或更改恢复状态。请等当前轮结束后重新读取；旧确认可能已过期。'
    : 'Recovery could not be read or changed. Wait for the active turn to end and read again; the prior confirmation may have expired.') : null,
  view?.state === 'unavailable' ? h('p', { style: composerNoticeParagraphStyle }, zh
    ? '失败证据已失效，没有当前可用的失败诊断。此状态不改变本 Session 的降级续聊策略。'
    : 'Failure evidence expired; no current failure diagnostics are available. This does not change the Session continuation policy.') : null,
  evidence ? h('div', null,
    h(SessionContinuationCard, { key: evidence.revision, sessionId, remote: continuation, locale,
      running: running || busy, recovery: true, onCancel: () => setDismissed(evidence.revision) }),
  ) : null,
  running ? h('p', { role: 'status', style: composerNoticeParagraphStyle }, zh ? '当前轮进行中，结束后自动更新。' : 'Turn in progress; status updates when it ends.') : null,
  h('details', { style: { marginTop: 8 } },
    h('summary', { style: { cursor: 'pointer' } }, zh ? '技术详情与状态' : 'Technical details and status'),
    evidence ? h('p', { style: composerNoticeParagraphStyle }, zh
      ? `${evidence.model}：${evidence.itemCount} 条已识别的旧加密推理项；不是已证明无效的项数。`
      : `${evidence.model}: ${evidence.itemCount} identified old encrypted reasoning items; not a count of proven invalid items.`) : null,
    h('button', { type: 'button', style: { ...button, marginBlock: 8 }, disabled, onClick: () => void perform() },
      busy ? zh ? '正在读取…' : 'Reading…' : zh ? '重新读取状态' : 'Read status again')))
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
function Surface({ runtime, remote, continuation, locale }: { runtime: Runtime; remote: ReplayRecoveryRemote;
  continuation?: SessionContinuationRemote; locale: Locale | undefined }): ReactElement | null {
  const valid = runtime.useSession(value => record(value) && value.sessionId === runtime.sessionId
    && value.removed === false && value.openState === 'open')
  const selected = runtime.useProjection('modelSelection')
  const running = runtime.useSession(value => !record(value) || value.running !== false)
  const lastError = runtime.useSession(value => record(value) && typeof value.lastAgentError === 'string' ? value.lastAgentError : '')
  const language = useSyncExternalStore(listener => locale?.subscribe(listener) ?? noop,
    () => locale?.getLocale().active ?? 'en', () => 'en')
  if (!valid || !record(selected) || !record(selected.next) || selected.next.provider !== 'github-copilot-preview') return null
  return h('div', null,
    h(ReplayRecoveryCard, { key: JSON.stringify([runtime.sessionId, selected.next.model]),
      sessionId: runtime.sessionId, remote, continuation, locale: language, running, refreshKey: lastError }))
}
export function registerReplayRecoveryUi(ctx: Context): () => void {
  const candidate: unknown = ctx.get('slots')
  if (!isSlots(candidate)) {
    ctx.logger.warn('COPILOT_REPLAY_RECOVERY_SLOT_UNAVAILABLE'); return noop
  }
  const slots = candidate
  let faces: { remote: ReplayRecoveryRemote; continuation: SessionContinuationRemote } | undefined
  const language: unknown = ctx.get('locale')
  const locale = isLocale(language) ? language : undefined
  const name = 'conversation.input.dock'
  return slots.inject(name, () => {
    const spec = slots.spec(name)
    if (spec?.kind !== 'list' || spec.scope !== 'session') { ctx.logger.warn('COPILOT_REPLAY_RECOVERY_SLOT_UNAVAILABLE'); return noop }
    faces ??= { remote: ctx.remote.githubCopilotReplayRecovery, continuation: ctx.remote.githubCopilotSessionContinuation }
    const { remote, continuation } = faces
    return slots.register({ name, id: 'github-copilot-replay-recovery', order: 30 }, props => {
      if (!isRuntime(props)) {
        ctx.logger.warn('COPILOT_REPLAY_RECOVERY_SESSION_UNAVAILABLE'); return null
      }
      return h(Surface, { runtime: props, remote, continuation, locale })
    })
  })
}
