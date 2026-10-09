import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { createElement as h, useEffect, useSyncExternalStore } from 'react'
import type { ReactElement } from 'react'
import { autoModelPreference } from './copilot-identity.ts'
import { COPILOT_CONTEXT_EVIDENCE, ContextEvidenceSchema } from './context-evidence.ts'
import type { ContextEvidence } from './context-evidence.ts'
import {
  composerNoticeStyle, composerNoticeParagraphStyle, composerNoticeQuietButtonStyle,
} from './composer-notice-style.ts'
import { CompactionContinuationNotice, CompactionNoticePresentation } from './compaction-continuation-ui.ts'
import { COMPACTION_CONTINUATION, CompactionContinuationLifecycleSchema } from './session-continuation-types.ts'
import type { CompactionContinuationStatus } from './session-continuation-types.ts'
import type { SessionContinuationRemote } from './session-continuation-ui.ts'

const slot = 'conversation.input.dock'
const noop = () => {}
const subscribeNoop = () => noop
const zeroSnapshot = () => 0
interface Locale { getLocale(): { active: string }; subscribe(listener: () => void): () => void }
interface Runtime {
  sessionId: string
  useSession<T>(selector: (snapshot: unknown) => T): T
  useProjection(key: string): unknown
}
interface Slots {
  spec(name: string): { kind: string; scope: string } | undefined
  inject(name: string, callback: () => () => void): () => void
  register(options: { name: string; id: string; order: number }, component: (props: Record<string, unknown>) => ReactElement | null): () => void
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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
const copy = {
  en: {
    failedZeroTitle: 'Context sample unreliable · failed attempt reported zero usage',
    invalidSampleTitle: 'Context sample invalid · current occupancy is unknown',
    failedZero: 'A failed Copilot attempt recorded a zero usage sample. It is not reliable context-occupancy evidence.',
    invalidSample: 'The latest context usage sample was malformed or conflicted with the active route.',
    sample: 'Last valid input sample (including cache)',
    historical: 'Historical sample, not current occupancy. No percentage is inferred.',
    revoked: 'No applicable historical input sample is available. Model changes, compaction and incomplete history invalidate earlier samples.',
    completed: 'Compaction completed',
    completedSucceeded: 'Compaction completed · subsequent request succeeded',
    completedFailed: 'Compaction completed · subsequent request failed',
    completedCancelled: 'Compaction completed · subsequent request cancelled',
    running: 'Compacting with visible history; hidden reasoning context may be lost.',
    failed: 'Visible-history compaction failed; no recovery summary commit is confirmed. Check the native failure.',
    cancelled: 'Visible-history compaction cancelled; no recovery summary commit is confirmed.',
    nativeRunning: 'Compacting context',
    nativeFailed: 'Compaction did not complete · check the native result',
    nativeUnknown: 'Compaction commit could not be confirmed · check the native result',
    omitted: 'Hidden reasoning context was omitted from the summary. Visible messages and tool relations were preserved.',
    pending: 'No subsequent normal request has completed yet.',
    succeeded: 'Subsequent request succeeded.',
    requestFailed: 'The latest subsequent request failed; compaction success does not confirm Session recovery.',
    requestCancelled: 'The latest subsequent request was cancelled.',
    requestRunning: 'Subsequent request in progress; success is not yet confirmed.',
    requestUnknown: 'Subsequent request outcome is unconfirmed.',
    sampled: 'An applicable post-compaction input sample is recorded. It is historical evidence, not current occupancy.',
    dismiss: 'Dismiss',
    dismissLabel: 'Dismiss context sample warning',
  },
  zh: {
    failedZeroTitle: '上下文采样不可靠 · 失败请求记录了零用量',
    invalidSampleTitle: '上下文采样无效 · 当前占用未知',
    failedZero: '失败的 Copilot 请求记录了零用量采样，不能将其作为可靠的上下文占用证据。',
    invalidSample: '最近的上下文用量采样格式无效，或与当前路由冲突。',
    sample: '最后有效输入采样（含缓存）',
    historical: '这是历史采样，不是当前占用；不会据此推算百分比。',
    revoked: '没有仍适用的历史输入采样。模型切换、压缩或历史证据不完整会使旧采样失效。',
    completed: '压缩已完成',
    completedSucceeded: '压缩已完成 · 后续请求已成功',
    completedFailed: '压缩已完成 · 后续请求失败',
    completedCancelled: '压缩已完成 · 后续请求已取消',
    running: '正在使用可见历史降级压缩，隐藏推理上下文可能丢失。',
    failed: '可见历史压缩失败；未确认提交恢复摘要。请查看原生失败原因。',
    cancelled: '可见历史压缩已取消；未确认提交恢复摘要。',
    nativeRunning: '正在压缩上下文',
    nativeFailed: '压缩未完成 · 请查看原生结果',
    nativeUnknown: '无法确认压缩摘要已提交 · 请查看原生结果',
    omitted: '隐藏推理上下文未带入摘要；可见消息与工具调用关系保留。',
    pending: '压缩后尚无已完成的普通请求。',
    succeeded: '后续请求已成功。',
    requestFailed: '最近一次后续请求失败；压缩成功不代表 Session 已恢复。',
    requestCancelled: '最近一次后续请求已取消。',
    requestRunning: '后续请求进行中；尚未确认成功。',
    requestUnknown: '后续请求结果尚未确认。',
    sampled: '已记录仍适用的压缩后输入采样；这是历史证据，不是当前占用。',
    dismiss: '关闭',
    dismissLabel: '关闭上下文采样警告',
  },
} as const

export class ContextIncidentPresentation {
  private dismissed = new Map<string, true>()
  private listeners = new Set<() => void>()
  private version = 0
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  snapshot = () => this.version
  private key(sessionId: string, incident: NonNullable<ContextEvidence['incident']>) {
    return JSON.stringify([sessionId, incident.kind, incident.seq])
  }
  visible(sessionId: string, incident: NonNullable<ContextEvidence['incident']>) {
    return !this.dismissed.has(this.key(sessionId, incident))
  }
  dismiss(sessionId: string, incident: NonNullable<ContextEvidence['incident']>) {
    this.dismissed.set(this.key(sessionId, incident), true)
    while (this.dismissed.size > 128) this.dismissed.delete(this.dismissed.keys().next().value!)
    this.version++
    for (const listener of this.listeners) listener()
  }
  dispose() { this.dismissed.clear(); this.listeners.clear() }
}

export function ContextEvidenceNotice({ evidence, locale = 'en', applicable = true, compactionStatus,
  showCompactionResult = true, controls, sessionId, presentation }: {
  evidence: ContextEvidence | undefined; locale?: string; applicable?: boolean
  compactionStatus?: CompactionContinuationStatus
  showCompactionResult?: boolean; controls?: ReactElement | null
  sessionId?: string; presentation?: ContextIncidentPresentation
}): ReactElement | null {
  useSyncExternalStore(presentation?.subscribe ?? subscribeNoop,
    presentation?.snapshot ?? zeroSnapshot, presentation?.snapshot ?? zeroSnapshot)
  const text = locale.startsWith('zh') ? copy.zh : copy.en
  const native = evidence?.compaction
  const status = showCompactionResult ? compactionStatus ?? (native ? { id: native.id, state: native.state } : undefined) : undefined
  const sample = applicable ? evidence?.sample : null
  const incident = applicable ? evidence?.incident : null
  const incidentVisible = incident !== null && incident !== undefined
    && (sessionId === undefined || presentation === undefined || presentation.visible(sessionId, incident))
  const completed = status?.state === 'completed'
  const following = applicable && native?.state === 'completed'
    && (status === undefined || native.id === status.id) ? native : undefined
  const sampled = following?.endSeq !== null && following?.endSeq !== undefined
    && sample !== null && sample !== undefined && sample.tokens > 0 && sample.seq > following.endSeq && !evidence?.invalid
  if (!status && !incidentVisible) return null
  const title = status ? completed ? following?.request === 'succeeded' ? text.completedSucceeded
    : following?.request === 'failed' ? text.completedFailed
      : following?.request === 'cancelled' ? text.completedCancelled : text.completed
    : status.state === 'running' ? compactionStatus ? text.running : text.nativeRunning
      : status.state === 'cancelled' ? text.cancelled
        : status.state === 'failed' ? compactionStatus ? text.failed : text.nativeFailed : text.nativeUnknown
    : incident?.kind === 'invalid-sample' ? text.invalidSampleTitle : text.failedZeroTitle
  const dismiss = incidentVisible && sessionId !== undefined && presentation !== undefined ? h('button', {
    type: 'button', style: composerNoticeQuietButtonStyle,
    'aria-label': text.dismissLabel, onClick: () => presentation.dismiss(sessionId, incident),
  }, text.dismiss) : null
  const disclosure = h('details', { 'data-copilot-composer-notice': controls === undefined ? 'context' : undefined, style: composerNoticeStyle },
    h('summary', { style: {
      cursor: 'pointer', fontFamily: 'var(--dsw-font-family, inherit)',
      fontSize: 'var(--dsh-content-font-size-secondary, 13px)', fontWeight: 400,
      lineHeight: 'calc(20px + var(--dsh-content-font-delta-secondary, 0px))',
      color: 'var(--dsw-alias-label-tertiary, GrayText)',
    } }, title),
    completed || following ? h('p', { role: 'status', 'aria-live': 'polite', style: composerNoticeParagraphStyle },
      following?.request === 'succeeded' ? text.succeeded
        : following?.request === 'failed' ? text.requestFailed
          : following?.request === 'cancelled' ? text.requestCancelled
            : following?.request === 'pending' ? text.requestRunning
              : following?.request === 'idle' ? text.pending : text.requestUnknown) : null,
    completed && sampled ? h('p', { style: composerNoticeParagraphStyle }, text.sampled) : null,
    compactionStatus && completed
      ? h('p', { style: composerNoticeParagraphStyle }, text.omitted) : null,
    incidentVisible ? h('p', { style: composerNoticeParagraphStyle },
      incident?.kind === 'invalid-sample' ? text.invalidSample : text.failedZero) : null,
    sample && sample.tokens > 0 ? h('p', { style: composerNoticeParagraphStyle },
      `${text.sample}: ${new Intl.NumberFormat(locale.startsWith('zh') ? 'zh-CN' : 'en-US').format(sample.tokens)} tokens`) : null,
    incidentVisible ? h('p', { style: composerNoticeParagraphStyle },
      sample && sample.tokens > 0 ? text.historical : text.revoked) : null)
  const actions = controls === undefined ? dismiss : controls
  return actions === null || actions === undefined ? disclosure : h('section', {
    'data-copilot-composer-notice': 'context', style: composerNoticeStyle }, disclosure, actions, controls === undefined ? null : dismiss)
}

function Surface({ runtime, locale, diagnostic, continuation, presentation, incidentPresentation }: {
  runtime: Runtime; locale: Locale | undefined; diagnostic(code: string): void
  continuation?: SessionContinuationRemote
  presentation: CompactionNoticePresentation
  incidentPresentation: ContextIncidentPresentation
}): ReactElement | null {
  const valid = runtime.useSession(value => record(value) && value.sessionId === runtime.sessionId
    && value.removed === false && value.openState === 'open')
  const selection = runtime.useProjection('modelSelection')
  const raw = runtime.useProjection(COPILOT_CONTEXT_EVIDENCE)
  const lifecycle = runtime.useProjection(COMPACTION_CONTINUATION)
  const language = useSyncExternalStore(
    listener => locale?.subscribe(listener) ?? noop,
    () => locale?.getLocale().active ?? 'en',
    () => 'en',
  )
  const parsed = ContextEvidenceSchema.safeParse(raw)
  useEffect(() => { if (!parsed.success) diagnostic('COPILOT_CONTEXT_PROJECTION_UNAVAILABLE') }, [parsed.success, diagnostic])
  useEffect(() => {
    if (parsed.success && parsed.data.reason === 'unknown')
      diagnostic('COPILOT_CONTEXT_EVIDENCE_INCOMPLETE')
  }, [parsed.success, parsed.success ? parsed.data.reason : undefined, diagnostic])
  if (!valid || !record(selection) || !record(selection.next)) return null
  const next = selection.next
  if (next.provider !== 'github-copilot' && next.provider !== 'github-copilot-preview') return null
  const evidence = parsed.success ? parsed.data : undefined
  const route = evidence?.route
  const applicable = route !== null && route !== undefined && next.provider === route.provider
    && (next.model === route.model || typeof next.model === 'string' && autoModelPreference(next.model) !== undefined)
  const compact = CompactionContinuationLifecycleSchema.safeParse(lifecycle)
  const shown = next.provider === 'github-copilot-preview' && compact.success && compact.data.id !== null
    && evidence?.compaction && evidence.compaction.id !== compact.data.id
    ? { ...evidence, compaction: null, sample: null, invalid: false, reason: 'compaction' as const, incident: null } : evidence
  const renderEvidence = (compactionStatus?: CompactionContinuationStatus, controls?: ReactElement | null, transient = true) =>
    h(ContextEvidenceNotice, {
      evidence: shown, locale: language, applicable, compactionStatus, controls,
      showCompactionResult: transient, sessionId: runtime.sessionId, presentation: incidentPresentation,
    })
  return next.provider === 'github-copilot-preview' && compact.success && compact.data.id !== null
    ? h(CompactionContinuationNotice, { key: runtime.sessionId, sessionId: runtime.sessionId,
      remote: continuation, lifecycle, locale: language, renderEvidence, presentation })
    : renderEvidence()
}

/** Additive disclosure only: native input, context ring and billing remain untouched. */
export function registerContextEvidenceUi(ctx: Context): () => void {
  const diagnosed = new Set<string>()
  const diagnostic = (code: string) => {
    if (!diagnosed.has(code)) { diagnosed.add(code); ctx.logger.warn(`[github-copilot] ${code}`) }
  }
  const slots: unknown = ctx.get('slots')
  if (!isSlots(slots)) { diagnostic('COPILOT_CONTEXT_SLOT_UNAVAILABLE'); return noop }
  const candidate: unknown = ctx.get('locale')
  const locale = isLocale(candidate) ? candidate : undefined
  let faces: { continuation: SessionContinuationRemote } | undefined
  const presentation = new CompactionNoticePresentation()
  const incidentPresentation = new ContextIncidentPresentation()
  const remove = slots.inject(slot, () => {
    const spec = slots.spec(slot)
    if (spec?.kind !== 'list' || spec.scope !== 'session') {
      diagnostic('COPILOT_CONTEXT_SLOT_UNAVAILABLE')
      return noop
    }
    faces ??= { continuation: ctx.remote.githubCopilotSessionContinuation }
    const { continuation } = faces
    return slots.register({ name: slot, id: 'github-copilot-context-evidence', order: 25 }, props => {
      if (!isRuntime(props)) { diagnostic('COPILOT_CONTEXT_SESSION_RUNTIME_UNAVAILABLE'); return null }
      return h(Surface, {
        runtime: props, locale, diagnostic, continuation, presentation, incidentPresentation,
      })
    })
  })
  return () => { remove(); presentation.dispose(); incidentPresentation.dispose() }
}
