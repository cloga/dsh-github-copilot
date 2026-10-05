// @vitest-environment jsdom
import { act, createElement as h, useSyncExternalStore } from 'react'
import type { ComponentType, ComponentProps } from 'react'
import { createRoot } from 'react-dom/client'
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { COPILOT_CONTEXT_EVIDENCE, initialContextEvidence } from '../src/context-evidence.ts'
import type { ContextEvidence } from '../src/context-evidence.ts'
import { ContextEvidenceNotice, registerContextEvidenceUi } from '../src/context-evidence-ui.ts'

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
  const ctx = {
    get: (name: string): unknown => name === 'slots' ? ctx.slots : undefined, logger: { warn: vi.fn() },
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
  return { ctx, released, component: () => component!, declare: () => { remove = declare?.() }, dispose }
}
describe('additive historical context notice', () => {
  it.each(['en', 'zh-CN'])('matches composer statistics typography without changing disclosure behavior in %s', async locale => {
    const view = mount<ComponentProps<typeof ContextEvidenceNotice>>(ContextEvidenceNotice, { evidence: invalid, locale })
    await view.render()
    const summary = view.container.querySelector('summary')!
    const notice = view.container.querySelector('details')!
    expect(notice.style.fontSize).toBe(summary.style.fontSize)
    expect(notice.style.lineHeight).toBe(summary.style.lineHeight)
    expect(notice.style.width).toBe('100%')
    expect(notice.style.minWidth).toBe('0')
    for (const paragraph of view.container.querySelectorAll('p')) {
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
    const useProjection = (key: string) => key === COPILOT_CONTEXT_EVIDENCE ? evidence.use() : selection.use()
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
