import { createElement as h, useEffect, useState } from 'react'
import type { SessionContinuationRemote } from './session-continuation-ui.ts'
import { SessionContinuationCard } from './session-continuation-ui.ts'
import { CompactionContinuationLifecycleSchema, SessionContinuationViewSchema } from './session-continuation-types.ts'
import type { CompactionContinuationStatus } from './session-continuation-types.ts'
import { composerNoticeParagraphStyle, composerNoticeSurfaceStyle } from './composer-notice-style.ts'

export function CompactionContinuationNotice({ sessionId, remote, lifecycle, locale = 'en' }: {
  sessionId: string; remote?: SessionContinuationRemote; lifecycle: unknown; locale?: string
}) {
  const parsed = CompactionContinuationLifecycleSchema.safeParse(lifecycle)
  const id = parsed.success ? parsed.data.id : null
  const running = parsed.success && parsed.data.running
  const [status, setStatus] = useState<CompactionContinuationStatus>()
  const [error, setError] = useState(false)
  const [dismissed, setDismissed] = useState<string>()
  useEffect(() => {
    let current = true
    let timer: ReturnType<typeof setTimeout> | undefined
    setStatus(undefined); setError(false)
    if (!id || !remote) return
    const read = async () => {
      try {
        const result = await remote.get(sessionId)
        const view = result.ok ? SessionContinuationViewSchema.safeParse(result.value) : undefined
        if (!current) return
        if (!view?.success) { setError(true); setStatus(undefined) }
        else {
          setError(false)
          setStatus(view.data.compaction?.id === id ? view.data.compaction : undefined)
        }
      } catch { if (current) { setError(true); setStatus(undefined) } }
      finally { if (current && running) timer = setTimeout(() => void read(), 1000) }
    }
    void read()
    return () => { current = false; if (timer) clearTimeout(timer) }
  }, [sessionId, remote, id, running])
  const zh = locale.startsWith('zh')
  if (!status && !error) return null
  if (status?.state === 'blocked') return dismissed === status.id ? null : h('section', {
    'data-copilot-composer-notice': 'compaction-continuation', style: composerNoticeSurfaceStyle },
    h('p', { role: 'alert', style: composerNoticeParagraphStyle }, zh
      ? '旧推理回放被拒绝，压缩未提交。开启降级可让后续聊天与压缩使用可见历史。'
      : 'Old reasoning replay was rejected; compaction did not commit. Enabling continuation lets subsequent chat and compaction use visible history.'),
    h(SessionContinuationCard, { sessionId, remote, locale, recovery: true,
      onCancel: () => setDismissed(status.id) }))
  const text = error ? zh ? '无法确认压缩降级状态；请查看原生压缩结果。' : 'Compaction recovery status is unavailable; check the native compaction result.'
    : status?.state === 'running' ? zh ? '正在使用可见历史降级压缩，隐藏推理上下文可能丢失。' : 'Compacting with visible history; hidden reasoning context may be lost.'
      : status?.state === 'completed' ? zh ? '可见历史压缩已提交；隐藏推理上下文未带入摘要。' : 'Visible-history compaction committed; hidden reasoning context was omitted from the summary.'
        : status?.state === 'cancelled' ? zh ? '可见历史压缩已取消；未确认提交恢复摘要。' : 'Visible-history compaction cancelled; no recovery summary commit is confirmed.'
          : zh ? '可见历史压缩失败；Session 尚未恢复。请查看原生失败原因。' : 'Visible-history compaction failed; the Session is not recovered. Check the native failure.'
  return h('section', { 'data-copilot-composer-notice': 'compaction-continuation',
    role: error || status?.state === 'failed' ? 'alert' : 'status', 'aria-live': 'polite',
    style: composerNoticeSurfaceStyle }, h('p', { style: composerNoticeParagraphStyle }, text))
}
