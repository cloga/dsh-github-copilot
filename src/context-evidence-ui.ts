import type { Context } from '@deepseek-ai/cordis'
import { createElement as h, useEffect, useSyncExternalStore } from 'react'
import type { ReactElement } from 'react'
import { autoModelPreference } from './copilot-identity.ts'
import { COPILOT_CONTEXT_EVIDENCE, ContextEvidenceSchema } from './context-evidence.ts'
import type { ContextEvidence } from './context-evidence.ts'

const slot = 'conversation.composer.dock'
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
const copy = {
  en: {
    title: 'Context reading unavailable',
    explanation: 'A failed Copilot attempt reported zero usage. The native 0% is not evidence of an empty context.',
    sample: 'Last valid input sample (including cache)',
    historical: 'Historical sample, not current occupancy. No percentage is inferred.',
    revoked: 'No applicable historical input sample is available. Model changes, compaction and incomplete history invalidate earlier samples.',
    missing: 'COPILOT_CONTEXT_PROJECTION_UNAVAILABLE: historical context evidence is unavailable.',
    unknown: 'Context sampling evidence is incomplete. No current occupancy can be inferred.',
  },
  zh: {
    title: '上下文读数暂不可用',
    explanation: '失败的 Copilot 请求记录了零用量。原生 0% 不代表上下文为空。',
    sample: '最后有效输入采样（含缓存）',
    historical: '这是历史采样，不是当前占用；不会据此推算百分比。',
    revoked: '没有仍适用的历史输入采样。模型切换、压缩或历史证据不完整会使旧采样失效。',
    missing: 'COPILOT_CONTEXT_PROJECTION_UNAVAILABLE：无法获取历史上下文证据。',
    unknown: '上下文采样证据不完整，无法据此推断当前占用。',
  },
} as const

export function ContextEvidenceNotice({ evidence, locale = 'en', applicable = true }: {
  evidence: ContextEvidence | undefined; locale?: string; applicable?: boolean
}): ReactElement | null {
  if (evidence !== undefined && !evidence.invalid) return null
  const text = locale.startsWith('zh') ? copy.zh : copy.en
  const sample = applicable ? evidence?.sample : null
  return h('details', { style: { maxWidth: 'min(100%, 38rem)', fontSize: 'inherit', overflowWrap: 'anywhere' } },
    h('summary', { style: { cursor: 'pointer' } }, text.title),
    h('p', { style: { marginBlock: '0.5rem' } }, evidence === undefined ? text.missing
      : evidence.reason === 'unknown' ? text.unknown : text.explanation),
    sample ? h('p', { style: { marginBlock: '0.5rem' } },
      `${text.sample}: ${new Intl.NumberFormat(locale.startsWith('zh') ? 'zh-CN' : 'en-US').format(sample.tokens)} tokens`) : null,
    evidence === undefined ? null : h('p', { style: { marginBlock: '0.5rem' } }, sample ? text.historical : text.revoked))
}

function Surface({ runtime, locale, diagnostic }: {
  runtime: Runtime; locale: Locale | undefined; diagnostic(code: string): void
}): ReactElement | null {
  const valid = runtime.useSession(value => record(value) && value.sessionId === runtime.sessionId
    && value.removed === false && value.openState === 'open')
  const selection = runtime.useProjection('modelSelection')
  const raw = runtime.useProjection(COPILOT_CONTEXT_EVIDENCE)
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
  return h(ContextEvidenceNotice, { evidence, locale: language, applicable })
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
  return slots.inject(slot, () => {
    const spec = slots.spec(slot)
    if (spec?.kind !== 'list' || spec.scope !== 'session') {
      diagnostic('COPILOT_CONTEXT_SLOT_UNAVAILABLE')
      return noop
    }
    return slots.register({ name: slot, id: 'github-copilot-context-evidence', order: 25 }, props => {
      if (!isRuntime(props)) { diagnostic('COPILOT_CONTEXT_SESSION_RUNTIME_UNAVAILABLE'); return null }
      return h(Surface, { runtime: props, locale, diagnostic })
    })
  })
}
