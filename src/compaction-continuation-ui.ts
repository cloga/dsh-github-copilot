import { createElement as h, useEffect, useState, useSyncExternalStore } from 'react'
import type { ReactElement } from 'react'
import type { SessionContinuationRemote } from './session-continuation-ui.ts'
import { SessionContinuationCard } from './session-continuation-ui.ts'
import { CompactionContinuationLifecycleSchema, SessionContinuationViewSchema } from './session-continuation-types.ts'
import type { CompactionContinuationStatus } from './session-continuation-types.ts'
import { composerNoticeParagraphStyle, composerNoticeSurfaceStyle, composerNoticeQuietButtonStyle } from './composer-notice-style.ts'

type NoticeState = CompactionContinuationStatus['state'] | 'unavailable'
const successLifetimeMs = 8000
/** Presentation only, retained across incidental mounts by the Client slot registration. */
export class CompactionNoticePresentation {
  private entries = new Map<string, { dismissed: boolean; expiresAt?: number }>()
  private listeners = new Set<() => void>()
  private version = 0
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  snapshot = () => this.version
  private key(sessionId: string, id: string, state: NoticeState) { return JSON.stringify([sessionId, id, state]) }
  private remember(key: string, entry: { dismissed: boolean; expiresAt?: number }) {
    this.entries.set(key, entry)
    while (this.entries.size > 128) this.entries.delete(this.entries.keys().next().value!)
  }
  observe(sessionId: string, id: string, state: NoticeState) {
    const key = this.key(sessionId, id, state)
    if (state === 'completed' && !this.entries.has(key))
      this.remember(key, { dismissed: false, expiresAt: Date.now() + successLifetimeMs })
  }
  remaining(sessionId: string, id: string) {
    const expiresAt = this.entries.get(this.key(sessionId, id, 'completed'))?.expiresAt
    return expiresAt === undefined ? undefined : Math.max(0, expiresAt - Date.now())
  }
  visible(sessionId: string, id: string, state: NoticeState) {
    if (state === 'running') return true
    const entry = this.entries.get(this.key(sessionId, id, state))
    return !entry?.dismissed && (entry?.expiresAt === undefined || entry.expiresAt > Date.now())
  }
  dismiss(sessionId: string, id: string, state: NoticeState) {
    if (state === 'running') return
    const key = this.key(sessionId, id, state)
    this.remember(key, { ...this.entries.get(key), dismissed: true })
    this.version++
    for (const listener of this.listeners) listener()
  }
  dispose() { this.entries.clear(); this.listeners.clear() }
}

export function CompactionContinuationNotice({ sessionId, remote, lifecycle, locale = 'en', renderEvidence,
  presentation: sharedPresentation }: {
  sessionId: string; remote?: SessionContinuationRemote; lifecycle: unknown; locale?: string
  presentation?: CompactionNoticePresentation
  renderEvidence?: (status?: CompactionContinuationStatus, controls?: ReactElement | null, transient?: boolean) => ReactElement | null
}) {
  const [localPresentation] = useState(() => new CompactionNoticePresentation())
  const presentation = sharedPresentation ?? localPresentation
  const version = useSyncExternalStore(presentation.subscribe, presentation.snapshot, presentation.snapshot)
  const [, refresh] = useState(0)
  const parsed = CompactionContinuationLifecycleSchema.safeParse(lifecycle)
  const id = parsed.success ? parsed.data.id : null
  const running = parsed.success && parsed.data.running
  const [result, setResult] = useState<{ sessionId: string; id: string; running: boolean;
    remote: SessionContinuationRemote | undefined; status?: CompactionContinuationStatus; error: boolean }>()
  const currentResult = result?.sessionId === sessionId && result.id === id
    && result.remote === remote && result.running === running ? result : undefined
  const status = currentResult?.status
  const error = currentResult?.error === true
  const state = error ? 'unavailable' : status?.state
  useEffect(() => () => localPresentation.dispose(), [localPresentation])
  useEffect(() => {
    let current = true
    let timer: ReturnType<typeof setTimeout> | undefined
    setResult(undefined)
    if (!id) return
    const publish = (status: CompactionContinuationStatus | undefined, error: boolean) => {
      if (!current) return
      if (status) presentation.observe(sessionId, id, status.state)
      setResult({ sessionId, id, running, remote, status, error })
    }
    if (!remote) { publish(undefined, true); return }
    const read = async () => {
      try {
        const result = await remote.get(sessionId)
        const view = result.ok ? SessionContinuationViewSchema.safeParse(result.value) : undefined
        if (!current) return
        if (!view?.success) publish(undefined, true)
        else publish(view.data.compaction?.id === id ? view.data.compaction : undefined, false)
      } catch { publish(undefined, true) }
      finally { if (current && running) timer = setTimeout(() => void read(), 1000) }
    }
    void read()
    return () => { current = false; if (timer) clearTimeout(timer) }
  }, [sessionId, remote, id, running, presentation])
  useEffect(() => {
    if (!id || state !== 'completed' || running || !presentation.visible(sessionId, id, state)) return
    const remaining = presentation.remaining(sessionId, id)
    if (remaining === undefined) return
    const timer = setTimeout(() => refresh(value => value + 1), remaining)
    return () => clearTimeout(timer)
  }, [sessionId, id, state, running, presentation, version])
  const zh = locale.startsWith('zh')
  if (!id || !state || !running && !presentation.visible(sessionId, id, state))
    return renderEvidence?.(undefined, null, false) ?? null
  const dismiss = () => { if (!running) presentation.dismiss(sessionId, id, state) }
  const close = !running && state !== 'running' ? h('button', {
    type: 'button', style: composerNoticeQuietButtonStyle, onClick: dismiss,
    'aria-label': zh ? '关闭压缩提示' : 'Close compaction notice',
  }, zh ? '关闭' : 'Close') : null
  if (status?.state === 'blocked') return h('section', {
    'data-copilot-composer-notice': 'compaction-continuation', style: composerNoticeSurfaceStyle },
    h('p', { role: 'alert', style: composerNoticeParagraphStyle }, zh
      ? '旧推理回放被拒绝，压缩未提交。开启降级可让后续聊天与压缩使用可见历史。'
      : 'Old reasoning replay was rejected; compaction did not commit. Enabling continuation lets subsequent chat and compaction use visible history.'),
    h(SessionContinuationCard, { sessionId, remote, locale, recovery: true,
      running, onCancel: dismiss }), close)
  if (renderEvidence && !error) return renderEvidence(status, close, true)
  const text = error ? zh ? '无法确认压缩降级状态；请查看原生压缩结果。' : 'Compaction recovery status is unavailable; check the native compaction result.'
    : status?.state === 'running' ? zh ? '正在使用可见历史降级压缩，隐藏推理上下文可能丢失。' : 'Compacting with visible history; hidden reasoning context may be lost.'
      : status?.state === 'completed' ? zh ? '可见历史压缩已提交；隐藏推理上下文未带入摘要。' : 'Visible-history compaction committed; hidden reasoning context was omitted from the summary.'
        : status?.state === 'cancelled' ? zh ? '可见历史压缩已取消；未确认提交恢复摘要。' : 'Visible-history compaction cancelled; no recovery summary commit is confirmed.'
          : zh ? '可见历史压缩失败；Session 尚未恢复。请查看原生失败原因。' : 'Visible-history compaction failed; the Session is not recovered. Check the native failure.'
  return h('section', { 'data-copilot-composer-notice': 'compaction-continuation',
    role: error || status?.state === 'failed' ? 'alert' : 'status', 'aria-live': 'polite',
    style: composerNoticeSurfaceStyle }, h('p', { style: composerNoticeParagraphStyle }, text),
    close, error ? renderEvidence?.(undefined, null, false) : null)
}
