import type { Context } from '@deepseek-ai/cordis'
import { createElement as h, useEffect, useSyncExternalStore } from 'react'
import type { ReactElement } from 'react'
import { autoModelPreference } from './copilot-identity.ts'
import { COPILOT_CONTEXT_EVIDENCE, ContextEvidenceSchema } from './context-evidence.ts'
import type { ContextEvidence } from './context-evidence.ts'
import { composerNoticeStyle, composerNoticeParagraphStyle } from './composer-notice-style.ts'
import { CompactionContinuationNotice } from './compaction-continuation-ui.ts'
import { COMPACTION_CONTINUATION, CompactionContinuationLifecycleSchema } from './session-continuation-types.ts'
import type { CompactionContinuationStatus } from './session-continuation-types.ts'
import type { SessionContinuationRemote } from './session-continuation-ui.ts'

const slot = 'conversation.input.dock'
const noop = () => {}
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
function isContinuationRemote(value: unknown): value is SessionContinuationRemote {
  return record(value) && typeof value.get === 'function' && typeof value.set === 'function'
}
const copy = {
  en: {
    title: 'Context unknown · native 0% is not an empty-context reading',
    explanation: 'A failed Copilot attempt reported zero usage. The native 0% is not evidence of an empty context.',
    sample: 'Last valid input sample (including cache)',
    historical: 'Historical sample, not current occupancy. No percentage is inferred.',
    revoked: 'No applicable historical input sample is available. Model changes, compaction and incomplete history invalidate earlier samples.',
    missing: 'COPILOT_CONTEXT_PROJECTION_UNAVAILABLE: historical context evidence is unavailable.',
    unknown: 'Context sampling evidence is incomplete. No current occupancy can be inferred.',
    completed: 'Compaction completed · context occupancy awaiting confirmation',
    completedSucceeded: 'Compaction completed · subsequent request succeeded · context occupancy awaiting confirmation',
    completedFailed: 'Compaction completed · subsequent request failed · context occupancy awaiting confirmation',
    completedCancelled: 'Compaction completed · subsequent request cancelled · context occupancy awaiting confirmation',
    running: 'Compacting with visible history; hidden reasoning context may be lost.',
    failed: 'Visible-history compaction failed; no recovery summary commit is confirmed. Check the native failure.',
    cancelled: 'Visible-history compaction cancelled; no recovery summary commit is confirmed.',
    nativeRunning: 'Compacting context · context occupancy awaiting confirmation',
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
    unsampled: 'No applicable valid post-compaction input sample is confirmed. Request success alone does not establish occupancy.',
    zero: 'Native 0% does not prove an empty context. No replacement percentage is estimated.',
  },
  zh: {
    title: '上下文未知 · 原生 0% 不代表上下文为空',
    explanation: '失败的 Copilot 请求记录了零用量。原生 0% 不代表上下文为空。',
    sample: '最后有效输入采样（含缓存）',
    historical: '这是历史采样，不是当前占用；不会据此推算百分比。',
    revoked: '没有仍适用的历史输入采样。模型切换、压缩或历史证据不完整会使旧采样失效。',
    missing: 'COPILOT_CONTEXT_PROJECTION_UNAVAILABLE：无法获取历史上下文证据。',
    unknown: '上下文采样证据不完整，无法据此推断当前占用。',
    completed: '压缩已完成 · 当前上下文占用待确认',
    completedSucceeded: '压缩已完成 · 后续请求已成功 · 上下文占用待确认',
    completedFailed: '压缩已完成 · 后续请求失败 · 上下文占用待确认',
    completedCancelled: '压缩已完成 · 后续请求已取消 · 上下文占用待确认',
    running: '正在使用可见历史降级压缩，隐藏推理上下文可能丢失。',
    failed: '可见历史压缩失败；未确认提交恢复摘要。请查看原生失败原因。',
    cancelled: '可见历史压缩已取消；未确认提交恢复摘要。',
    nativeRunning: '正在压缩上下文 · 当前上下文占用待确认',
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
    unsampled: '尚未确认仍适用的有效压缩后输入采样；请求成功不能单独证明占用。',
    zero: '原生 0% 不代表上下文为空；不会用另一个估算百分比替代。',
  },
} as const

export function ContextEvidenceNotice({ evidence, locale = 'en', applicable = true, compactionStatus }: {
  evidence: ContextEvidence | undefined; locale?: string; applicable?: boolean
  compactionStatus?: CompactionContinuationStatus
}): ReactElement | null {
  const text = locale.startsWith('zh') ? copy.zh : copy.en
  const native = evidence?.compaction
  const status = compactionStatus ?? (native ? { id: native.id, state: native.state } : undefined)
  if (!status && evidence !== undefined && !evidence.invalid) return null
  const sample = applicable ? evidence?.sample : null
  const completed = status?.state === 'completed'
  const following = completed && applicable && native?.id === status?.id && native?.state === 'completed' ? native : undefined
  const sampled = following?.endSeq !== null && following?.endSeq !== undefined
    && sample !== null && sample !== undefined && sample.seq > following.endSeq && !evidence?.invalid
  const title = status ? completed ? following?.request === 'succeeded' ? text.completedSucceeded
    : following?.request === 'failed' ? text.completedFailed
      : following?.request === 'cancelled' ? text.completedCancelled : text.completed
    : status.state === 'running' ? compactionStatus ? text.running : text.nativeRunning
      : status.state === 'cancelled' ? text.cancelled
        : status.state === 'failed' ? compactionStatus ? text.failed : text.nativeFailed : text.nativeUnknown
    : text.title
  return h('details', { 'data-copilot-composer-notice': 'context', style: composerNoticeStyle },
    h('summary', { style: {
      cursor: 'pointer', fontFamily: 'var(--dsw-font-family, inherit)',
      fontSize: 'var(--dsh-content-font-size-secondary, 13px)', fontWeight: 400,
      lineHeight: 'calc(20px + var(--dsh-content-font-delta-secondary, 0px))',
      color: 'var(--dsw-alias-label-tertiary, GrayText)',
    } }, title),
    completed ? h('p', { role: 'status', 'aria-live': 'polite', style: composerNoticeParagraphStyle },
      following?.request === 'succeeded' ? text.succeeded
        : following?.request === 'failed' ? text.requestFailed
          : following?.request === 'cancelled' ? text.requestCancelled
            : following?.request === 'pending' ? text.requestRunning
              : following?.request === 'idle' ? text.pending : text.requestUnknown) : null,
    completed ? h('p', { style: composerNoticeParagraphStyle }, sampled ? text.sampled : text.unsampled) : null,
    compactionStatus && completed
      ? h('p', { style: composerNoticeParagraphStyle }, text.omitted) : null,
    status ? h('p', { style: composerNoticeParagraphStyle }, text.zero) : null,
    evidence === undefined || evidence.reason === 'unknown' || evidence.reason === 'failed-zero'
      ? h('p', { style: composerNoticeParagraphStyle }, evidence === undefined ? text.missing
        : evidence.reason === 'unknown' ? text.unknown : text.explanation) : null,
    sample ? h('p', { style: composerNoticeParagraphStyle },
      `${text.sample}: ${new Intl.NumberFormat(locale.startsWith('zh') ? 'zh-CN' : 'en-US').format(sample.tokens)} tokens`) : null,
    evidence === undefined ? null : h('p', { style: composerNoticeParagraphStyle }, sample ? text.historical : text.revoked))
}

function Surface({ runtime, locale, diagnostic, continuation }: {
  runtime: Runtime; locale: Locale | undefined; diagnostic(code: string): void
  continuation?: SessionContinuationRemote
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
  if (!valid || !record(selection) || !record(selection.next)) return null
  const next = selection.next
  if (next.provider !== 'github-copilot' && next.provider !== 'github-copilot-preview') return null
  const evidence = parsed.success ? parsed.data : undefined
  const route = evidence?.route
  const applicable = route !== null && route !== undefined && next.provider === route.provider
    && (next.model === route.model || typeof next.model === 'string' && autoModelPreference(next.model) !== undefined)
  const renderEvidence = (compactionStatus?: CompactionContinuationStatus) =>
    h(ContextEvidenceNotice, { evidence, locale: language, applicable, compactionStatus })
  const compact = CompactionContinuationLifecycleSchema.safeParse(lifecycle)
  return next.provider === 'github-copilot-preview' && compact.success && compact.data.id !== null
    ? h(CompactionContinuationNotice, { key: runtime.sessionId, sessionId: runtime.sessionId,
      remote: continuation, lifecycle, locale: language, renderEvidence })
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
  const remotes: unknown = ctx.get('remote')
  const candidateRemote = record(remotes) ? remotes.githubCopilotSessionContinuation : undefined
  const continuation = isContinuationRemote(candidateRemote) ? candidateRemote : undefined
  return slots.inject(slot, () => {
    const spec = slots.spec(slot)
    if (spec?.kind !== 'list' || spec.scope !== 'session') {
      diagnostic('COPILOT_CONTEXT_SLOT_UNAVAILABLE')
      return noop
    }
    return slots.register({ name: slot, id: 'github-copilot-context-evidence', order: 25 }, props => {
      if (!isRuntime(props)) { diagnostic('COPILOT_CONTEXT_SESSION_RUNTIME_UNAVAILABLE'); return null }
      return h(Surface, { runtime: props, locale, diagnostic, continuation })
    })
  })
}
