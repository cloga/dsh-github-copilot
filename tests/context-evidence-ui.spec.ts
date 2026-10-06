// @vitest-environment jsdom
import { act, createElement as h, useSyncExternalStore } from 'react'
import type { ComponentType, ComponentProps } from 'react'
import { createRoot } from 'react-dom/client'
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { COPILOT_CONTEXT_EVIDENCE, initialContextEvidence } from '../src/context-evidence.ts'
import type { ContextEvidence } from '../src/context-evidence.ts'
import { ContextEvidenceNotice, registerContextEvidenceUi } from '../src/context-evidence-ui.ts'
import { foldContextEvidence } from '../src/context-evidence.ts'
import { COMPACTION_CONTINUATION } from '../src/session-continuation-types.ts'

const cleanups: Array<() => void> = []
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }) })
afterEach(async () => {
  await act(async () => { cleanups.splice(0).reverse().forEach(dispose => dispose()) })
  document.body.replaceChildren()
})
const route = { provider: 'github-copilot-preview', model: 'synthetic-model' }
const invalid: ContextEvidence = {
  route, sample: { tokens: 671_709, seq: 2, route }, invalid: true, reason: 'failed-zero',
}
function mount<P extends object>(component: ComponentType<P>, props: P) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  cleanups.push(() => root.unmount())
  return { container, render: async (next = props) => { await act(async () => { root.render(h(component, next)) }) } }
}
function source<T>(initial: T) {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    set(next: T) { value = next; listeners.forEach(listener => listener()) },
    use() { return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => value) },
  }
}
function fixture(spec = { kind: 'list', scope: 'session' }) {
  let component: ComponentType<Record<string, unknown>> | undefined
  let declare: (() => () => void) | undefined
  let remove: (() => void) | undefined
  const released = vi.fn()
  const continuation = { get: vi.fn(async () => ({ ok: true, value: {
    enabled: true, revision: 1, compaction: { id: 'c', state: 'completed' },
  } })), set: vi.fn() }
  const ctx = {
    get: (name: string): unknown => name === 'slots' ? ctx.slots
      : name === 'remote' ? { githubCopilotSessionContinuation: continuation } : undefined, logger: { warn: vi.fn() },
    slots: {
      spec: () => spec,
      inject: vi.fn((_name: string, callback: () => () => void) => {
        declare = callback
        return () => { remove?.() }
      }),
      register: vi.fn((_options: unknown, value: ComponentType<Record<string, unknown>>) => {
        component = value
        return released
      }),
    },
  }
  const dispose = registerContextEvidenceUi(ctx as unknown as Context)
  cleanups.push(dispose)
  return { ctx, continuation, released, component: () => component!, declare: () => { remove = declare?.() }, dispose }
}
describe('additive historical context notice', () => {
  const completed = (): ContextEvidence => [
    { seq: 1, type: 'request/header', data: { header: { config: route } } },
    { seq: 2, type: 'compaction/start', data: { compactionId: 'c' } },
    { seq: 3, type: 'user/message', data: { source: { kind: 'compact-checkpoint', compactionId: 'c' } } },
    { seq: 4, type: 'compaction/end', data: { compactionId: 'c' } },
  ].reduce(foldContextEvidence, initialContextEvidence())
  it.each(['en', 'zh-CN'])('separates native commit, subsequent success and missing sampling in %s', async locale => {
    let evidence = completed()
    const view = mount<ComponentProps<typeof ContextEvidenceNotice>>(ContextEvidenceNotice, { evidence, locale })
    await view.render()
    expect(view.container.querySelector('summary')?.textContent).toContain(locale === 'en' ? 'Compaction completed' : '压缩已完成')
    expect(view.container.textContent).toContain(locale === 'en' ? 'No subsequent normal request' : '尚无已完成的普通请求')
    evidence = foldContextEvidence(evidence, { seq: 5, type: 'step/start', data: { turn: 1, step: 1 } })
    evidence = foldContextEvidence(evidence, { seq: 6, type: 'assistant/message', data: { turn: 1, step: 1,
      message: { source: route }, stream: [{ type: 'chunk', chunk: { type: 'finish', reason: { kind: 'stop' } } }] } })
    await view.render({ evidence, locale })
    expect(view.container.querySelector('summary')?.textContent).toContain(locale === 'en' ? 'subsequent request succeeded' : '后续请求已成功')
    expect(view.container.textContent).toContain(locale === 'en' ? 'No applicable valid post-compaction' : '尚未确认仍适用的有效压缩后输入采样')
    expect(view.container.querySelector('details')?.open).toBe(false)
    expect(view.container.querySelector('[role="progressbar"]')).toBeNull()
  })
  it('keeps sampling separate from a subsequent failure and respects route applicability', async () => {
    const evidence = { ...completed(), sample: { tokens: 42, seq: 6, route }, invalid: false }
    const view = mount<ComponentProps<typeof ContextEvidenceNotice>>(ContextEvidenceNotice, { evidence })
    await view.render()
    expect(view.container.textContent).toContain('input sample is recorded')
    await view.render({ evidence: { ...evidence, invalid: true,
      compaction: evidence.compaction ? { ...evidence.compaction, request: 'failed' } : null } })
    expect(view.container.querySelector('summary')?.textContent).toContain('subsequent request failed')
    expect(view.container.textContent).not.toContain('input sample is recorded')
    await view.render({ evidence, applicable: false })
    expect(view.container.textContent).not.toContain('42 tokens')
    expect(view.container.textContent).not.toContain('input sample is recorded')
  })
  it('mounts one combined disclosure and reads native commit status without policy writes', async () => {
    const f = fixture()
    f.declare()
    const useProjection = (key: string) => key === COPILOT_CONTEXT_EVIDENCE ? completed()
      : key === COMPACTION_CONTINUATION ? { id: 'c', running: false } : { next: route }
    const useSession = <T,>(select: (value: unknown) => T): T =>
      select({ sessionId: 'a', removed: false, openState: 'open' })
    const view = mount(f.component(), { sessionId: 'a', useProjection, useSession })
    await view.render()
    expect(view.container.querySelectorAll('[data-copilot-composer-notice]')).toHaveLength(1)
    expect(view.container.querySelector('summary')?.textContent).toContain('Compaction completed')
    expect(view.container.textContent).toContain('Hidden reasoning context was omitted')
    expect(f.continuation.get).toHaveBeenCalledTimes(1)
    expect(f.continuation.get).toHaveBeenCalledWith('a')
    expect(f.continuation.set).not.toHaveBeenCalled()
  })
  it.each(['en', 'zh-CN'])('matches composer statistics typography without changing disclosure behavior in %s', async locale => {
    const view = mount<ComponentProps<typeof ContextEvidenceNotice>>(ContextEvidenceNotice, { evidence: invalid, locale })
    await view.render()
    const summary = view.container.querySelector('summary')!
    const notice = view.container.querySelector('details')!
    expect(notice.style.fontSize).toBe(summary.style.fontSize)
    expect(notice.style.lineHeight).toBe(summary.style.lineHeight)
    expect(notice.style.width).toBe('100%')
    expect(notice.style.minWidth).toBe('0')
    for (const paragraph of Array.from(view.container.querySelectorAll('p'))) {
      expect(paragraph.style.marginBlock).toBe('8px')
      expect(paragraph.style.maxWidth).toBe('38rem')
    }
    expect(summary.style.fontFamily).toBe('var(--dsw-font-family, inherit)')
    expect(summary.style.fontSize).toBe('var(--dsh-content-font-size-secondary, 13px)')
    expect(summary.style.lineHeight).toBe('calc(20px + var(--dsh-content-font-delta-secondary, 0px))')
    expect(summary.style.fontWeight).toBe('400')
    expect(summary.style.color).toBe('var(--dsw-alias-label-tertiary, GrayText)')
    expect(summary.style.cursor).toBe('pointer')
    expect(view.container.querySelector('details')!.open).toBe(false)
    await view.render({ evidence: undefined, locale })
    expect(view.container.querySelector('summary')!.style.cssText).toBe(summary.style.cssText)
    expect(view.container.textContent).toContain('COPILOT_CONTEXT_PROJECTION_UNAVAILABLE')
  })
  it.each(['en', 'zh-CN'])('labels counts as historical rather than current occupancy in %s', async locale => {
    const view = mount<ComponentProps<typeof ContextEvidenceNotice>>(ContextEvidenceNotice, { evidence: invalid, locale })
    await view.render()
    expect(view.container.textContent).toContain('671,709')
    expect(view.container.textContent).toContain(locale === 'en' ? 'Historical sample, not current occupancy' : '这是历史采样，不是当前占用')
    const disclosure = view.container.querySelector('details')!
    expect(disclosure.open).toBe(false)
    expect(view.container.querySelector('summary')).not.toBeNull()
    expect(view.container.querySelector('[role="progressbar"]')).toBeNull()
  })
  it('hides healthy samples and does not invent counts when evidence is unavailable or revoked', async () => {
    const view = mount<ComponentProps<typeof ContextEvidenceNotice>>(ContextEvidenceNotice, { evidence: initialContextEvidence() })
    await view.render()
    expect(view.container.textContent).toBe('')
    await view.render({ evidence: undefined })
    expect(view.container.textContent).toContain('COPILOT_CONTEXT_PROJECTION_UNAVAILABLE')
    expect(view.container.textContent).not.toContain('model change')
    await view.render({ evidence: invalid, applicable: false })
    expect(view.container.textContent).not.toContain('671,709')
    expect(view.container.textContent).toContain('No applicable historical input sample')
    await view.render({ evidence: { ...invalid, sample: null, reason: 'unknown' } })
    expect(view.container.textContent).toContain('evidence is incomplete')
    expect(view.container.textContent).not.toContain('failed Copilot attempt')
  })
  it('reacts to only the current open Session and pending selection, preserving the native meter', async () => {
    const f = fixture()
    f.declare()
    expect(f.ctx.slots.register).toHaveBeenCalledWith(
      { name: 'conversation.input.dock', id: 'github-copilot-context-evidence', order: 25 }, expect.any(Function),
    )
    const selection = source<unknown>({ next: route })
    const evidence = source<unknown>(invalid)
    const session = source({ sessionId: 'a', removed: false, openState: 'open' })
    const useProjection = (key: string) => key === COPILOT_CONTEXT_EVIDENCE ? evidence.use()
      : key === COMPACTION_CONTINUATION ? undefined : selection.use()
    const useSession = <T,>(select: (value: unknown) => T): T => select(session.use())
    const view = mount(f.component(), { sessionId: 'a', useProjection, useSession })
    await view.render()
    expect(view.container.textContent).toContain('671,709')
    await act(async () => { selection.set({ next: { ...route, model: 'auto' } }) })
    expect(view.container.textContent).toContain('671,709')
    await act(async () => { selection.set({ next: { ...route, model: 'different' } }) })
    expect(view.container.textContent).not.toContain('671,709')
    await act(async () => { selection.set({ next: { provider: 'other', model: 'auto' } }) })
    expect(view.container.textContent).toBe('')
    await act(async () => { selection.set({ next: route }); session.set({ sessionId: 'b', removed: false, openState: 'open' }) })
    expect(view.container.textContent).toBe('')
    await act(async () => { session.set({ sessionId: 'a', removed: false, openState: 'open' }); evidence.set({ ...invalid, unexpected: true }) })
    expect(view.container.textContent).toContain('COPILOT_CONTEXT_PROJECTION_UNAVAILABLE')
    await view.render()
    expect(f.ctx.logger.warn).toHaveBeenCalledTimes(1)
    await act(async () => { evidence.set(initialContextEvidence()) })
    expect(view.container.textContent).toBe('')
    expect(document.body.querySelector('[data-native-context]')).toBeNull()
    f.dispose()
    expect(f.released).toHaveBeenCalledTimes(1)
    cleanups.splice(cleanups.indexOf(f.dispose), 1)
  })
  it.each([{ kind: 'single', scope: 'session' }, { kind: 'list', scope: 'root' }])('rejects incompatible slot declarations', spec => {
    const f = fixture(spec)
    f.declare()
    expect(f.ctx.slots.register).not.toHaveBeenCalled()
    expect(f.ctx.logger.warn).toHaveBeenCalledWith('[github-copilot] COPILOT_CONTEXT_SLOT_UNAVAILABLE')
  })
})
