// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TurnSelectionCard } from '../src/turn-selection-card.ts'
import { AUTO_MODEL_ATTRIBUTION_KEY, installAutoModelPresentation } from '../src/auto-model-presentation.ts'
import { TURN_MODEL_PROVENANCE_KEY } from '../src/turn-model-provenance.ts'
import type { ComponentType } from 'react'
import type { TurnSelection } from '../src/turn-selection.ts'
const cleanups: Array<() => void> = []
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }) })
afterEach(async () => { await act(async () => cleanups.splice(0).forEach(fn => fn())); document.body.replaceChildren() })
async function mount(selection: TurnSelection, locale = 'en') {
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container); cleanups.push(() => root.unmount())
  await act(async () => root.render(createElement(TurnSelectionCard, { selection, locale })))
  return container
}
const auto = { mode: 'auto', preference: 'intelligence', reason: 'large-structured-turn', candidateCount: 3 } as const
it('shows only mode, then opens truthful reasons with focus, Escape and outside dismissal', async () => {
  const container = await mount(auto)
  expect(container.textContent).toBe('Auto (intelligence)ⓘ')
  const trigger = container.querySelector('button')!
  await act(async () => trigger.click())
  expect(container.textContent).toContain('Large structured turn')
  expect(container.textContent).toContain('not execution proof')
  expect(document.activeElement?.textContent).toBe('Close')
  expect(container.querySelector<HTMLElement>('[role=dialog]')!.style.maxWidth).toBe('calc(100vw - 24px)')
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
  expect(document.activeElement).toBe(trigger)
  expect(container.querySelector('[role=dialog]')).toBeNull()
  await act(async () => trigger.click())
  await act(async () => document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })))
  expect(container.querySelector('[role=dialog]')).toBeNull()
})
it('localizes known manual and unknown separately without fabricating a reason', async () => {
  expect((await mount({ mode: 'manual' }, 'zh-CN')).textContent).toBe('手动')
  const unknown = await mount({ mode: 'unknown' }, 'zh-CN')
  expect(unknown.textContent).toBe('选择方式未知')
  expect(unknown.querySelector('button')).toBeNull()
})
it('dismisses the nonmodal disclosure when keyboard focus leaves it', async () => {
  const container = await mount(auto)
  await act(async () => container.querySelector('button')!.click())
  const outside = document.createElement('button'); document.body.append(outside)
  await act(async () => outside.focus())
  expect(container.querySelector('[role=dialog]')).toBeNull()
  expect(document.activeElement).toBe(outside)
})
it('ignores stale Session responses and diagnoses errors without inferring manual', async () => {
  let component: ComponentType<Record<string, unknown>> | undefined
  let resolveOld!: (value: { ok: boolean; value: TurnSelection }) => void
  const diagnostic = vi.fn()
  const get = vi.fn((id: string) => id === 'old'
    ? new Promise<{ ok: boolean; value: TurnSelection }>(resolve => { resolveOld = resolve })
    : Promise.resolve({ ok: false }))
  cleanups.push(installAutoModelPresentation({ diagnostic,
    remote: { githubCopilotTurnSelection: { get } },
    uiConversation: { events: { register: () => () => {} } },
    slots: { spec: () => ({ kind: 'list', scope: 'session' }), inject: (_: string, setup: () => () => void) => setup(),
      register: (_: unknown, value: ComponentType<Record<string, unknown>>) => { component = value; return () => {} } },
  }))
  const provenance = { ended: true, incomplete: false, routes: [{ provider: 'github-copilot-preview', model: 'fixture' }] }
  const turn = { turn: 1, data: { source: (key: string) => ({
    getSnapshot: () => key === TURN_MODEL_PROVENANCE_KEY ? provenance : undefined, subscribe: () => () => {},
  }) } }
  const snapshot = { nodes: new Map([['tail', { kind: 'turn-tail', data: { closing: { finalNode: { messageId: 'reply' } } }, location: { turn } }]]) }
  const props = { messageId: 'reply', useChat: (selector: (value: unknown) => unknown) => selector(snapshot) }
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container); cleanups.push(() => root.unmount())
  await act(async () => root.render(createElement(component!, { ...props, sessionId: 'old' })))
  await act(async () => root.render(createElement(component!, { ...props, sessionId: 'new' })))
  await act(async () => resolveOld({ ok: true, value: auto }))
  expect(container.textContent).toBe('Selection unknown')
  expect(diagnostic).toHaveBeenCalledWith('COPILOT_TURN_SELECTION_READ_FAILED')
})
it.each(['map', 'native-store'] as const)('reads exact completed turn evidence through %s and exposes reasons without repeating the model', async storeKind => {
  let component: ComponentType<Record<string, unknown>> | undefined
  const get = vi.fn(async () => ({ ok: true, value: auto }))
  const diagnostic = vi.fn()
  cleanups.push(installAutoModelPresentation({ diagnostic,
    remote: { githubCopilotTurnSelection: { get } },
    uiConversation: { events: { register: () => () => {} } },
    slots: { spec: () => ({ kind: 'list', scope: 'session' }), inject: (_: string, setup: () => () => void) => setup(),
      register: (options: { name: string }, value: ComponentType<Record<string, unknown>>) => {
        expect(options.name).toBe('conversation.chat.assistant-actions'); component = value; return () => {}
      } },
  }))
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container); cleanups.push(() => root.unmount())
  const values: Record<string, unknown> = {
    [TURN_MODEL_PROVENANCE_KEY]: { ended: true, incomplete: false, routes: [{ provider: 'github-copilot-preview', model: 'actual-model' }] },
    [AUTO_MODEL_ATTRIBUTION_KEY]: undefined,
  }
  const turn = { turn: 7, data: { source: (key: string) => ({ getSnapshot: () => values[key], subscribe: () => () => {} }) } }
  const tail = { kind: 'turn-tail', data: { closing: { finalNode: { messageId: 'reply' } } }, location: { turn } }
  // Official ChatNodeStore is a class whose values() returns an array, not a Map.
  class NativeNodeStore {
    constructor(private readonly nodes: readonly unknown[]) {}
    values() { return this.nodes }
  }
  const snapshot = { nodes: storeKind === 'map' ? new Map([['tail', tail]]) : new NativeNodeStore([
    { kind: 'assistant-step' },
    { ...tail, data: { closing: null } },
    { ...tail, data: { closing: { finalNode: { messageId: 'another-reply' } } } },
    tail,
  ]) }
  const props = { sessionId: 'session-a', messageId: 'reply', useChat: (selector: (value: unknown) => unknown) => selector(snapshot) }
  await act(async () => root.render(createElement(component!, props)))
  expect(container.textContent).toBe('Auto (intelligence)ⓘ')
  expect(get).toHaveBeenCalledExactlyOnceWith('session-a', 7)
  expect(container.textContent).not.toContain('actual-model')
  expect(container.querySelector('span')!.style.order).toBe('1')
  expect(container.querySelector('span')!.style.flexWrap).toBe('wrap')
  await act(async () => container.querySelector('button')!.click())
  expect(container.querySelector('[role=dialog]')?.textContent).toContain('Large structured turn')
  expect(container.querySelector('[role=dialog]')?.textContent).toContain('3 eligible models')
  await act(async () => root.render(createElement(component!, { ...props, unrelatedPicker: 'different-model' })))
  expect(get).toHaveBeenCalledTimes(1)
  expect(diagnostic).not.toHaveBeenCalled()
})
it.each([
  { nodes: undefined },
  { nodes: { values: [] } },
  { nodes: { values: () => null } },
])('diagnoses an unavailable node collection without reading another turn', async snapshot => {
  let component: ComponentType<Record<string, unknown>> | undefined
  const diagnostic = vi.fn()
  const get = vi.fn()
  cleanups.push(installAutoModelPresentation({
    diagnostic, remote: { githubCopilotTurnSelection: { get } },
    uiConversation: { events: { register: () => () => {} } },
    slots: {
      spec: () => ({ kind: 'list', scope: 'session' }),
      inject: (_: string, setup: () => () => void) => setup(),
      register: (_: unknown, value: ComponentType<Record<string, unknown>>) => { component = value; return () => {} },
    },
  }))
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container); cleanups.push(() => root.unmount())
  const props = { sessionId: 'session-a', messageId: 'reply', useChat: (select: (snapshot: unknown) => unknown) => select(snapshot) }
  await act(async () => root.render(createElement(component!, props)))
  await act(async () => root.render(createElement(component!, { ...props })))
  expect(container.textContent).toBe('')
  expect(get).not.toHaveBeenCalled()
  expect(diagnostic).toHaveBeenCalledExactlyOnceWith('COPILOT_TURN_SELECTION_CHAT_NODES_UNAVAILABLE')
})
