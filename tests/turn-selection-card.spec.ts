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
it('keeps recorded Account details separate from native Usage and current selection', async () => {
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container); cleanups.push(() => root.unmount())
  await act(async () => root.render(createElement(TurnSelectionCard, { selection: { mode: 'manual' },
    account: { state: 'recorded', accountId: 'canonical', source: 'global', identity: { login: 'synthetic-old', userId: 1 } } })))
  expect(container.textContent).toContain('Account · @synthetic-old')
  expect(container.querySelector('[role=dialog]')).toBeNull()
  await act(async () => container.querySelector('button')!.click())
  expect(container.querySelector('[role=dialog]')?.textContent).toContain('Inherited the global default at turn admission')
  expect(container.querySelector('[role=dialog]')?.textContent).toContain('Host lifetime only')
  expect(container.querySelector('[role=dialog]')?.textContent).not.toContain('Why this model')
})
it('distinguishes failed Account reads from unknown evidence and retries only the read', async () => {
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container); cleanups.push(() => root.unmount())
  const retryAccount = vi.fn()
  await act(async () => root.render(createElement(TurnSelectionCard, { selection: { mode: 'manual' },
    accountFailed: true, retryAccount })))
  await act(async () => container.querySelector('button')!.click())
  expect(container.querySelector('[role=dialog]')?.textContent).toContain('not proof of missing evidence')
  const retry = Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Retry')!
  await act(async () => retry.click())
  expect(retryAccount).toHaveBeenCalledOnce()
  await act(async () => root.render(createElement(TurnSelectionCard, { selection: { mode: 'manual' }, account: { state: 'unknown' } })))
  expect(container.textContent).toContain('Account · unknown')
  expect(container.querySelector('[role=dialog]')?.textContent).toContain('cannot reconstruct history')
})
it.each(['en', 'zh'])('keeps captured auxiliary timing inside progressive evidence and explains timeout fallback (%s)', async locale => {
  const container = await mount({ ...auto, explanation: {
    assessment: { demand: 'unknown', source: 'local', signals: ['insufficient-evidence'], diagnostic: 'timeout',
      semantic: { modelId: 'auxiliary-fixture', budgetMs: 8000, elapsedMs: 8002, stage: 'text-received',
        adapterStartedMs: 20, firstTextMs: 6000, outputCharacters: 10, validation: 'not-validated' } },
    targetCategory: 'powerful', selectedCategory: 'powerful', categoryCandidateCount: 2,
    method: 'equal-distribution', fallback: false,
  } }, locale)
  expect(container.textContent).not.toContain('8000')
  await act(async () => container.querySelector('button')!.click())
  expect(container.querySelector('details')?.open).toBe(false)
  expect(container.querySelector('[role=dialog]')?.textContent).toContain(locale === 'en' ? 'as a fallback' : '兜底')
  expect(container.querySelector('details')?.textContent).toContain('auxiliary-fixture')
  expect(container.querySelector('details')?.textContent).toContain('6000 ms')
  expect(container.querySelector('details')?.textContent).toContain(locale === 'en' ? 'not completed' : '未完成')
  expect(document.activeElement?.textContent).toBe(locale === 'en' ? 'Close' : '关闭')
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
  expect(container.querySelector('[role=dialog]')).toBeNull()
})
it.each(['en', 'zh'])('explains a captured task/category decision with progressive details (%s)', async locale => {
  const container = await mount({ ...auto, explanation: {
    assessment: { demand: 'simple', source: 'local', signals: ['isolated-greeting'] },
    targetCategory: 'lightweight', selectedCategory: 'lightweight', categoryCandidateCount: 1,
    method: 'only-candidate', fallback: false,
  } }, locale)
  expect(container.textContent).not.toContain('Lightweight')
  await act(async () => container.querySelector('button')!.click())
  expect(container.textContent).toContain('Lightweight')
  expect(container.textContent).toContain(locale === 'en' ? 'Only one eligible fitting candidate' : '只有一个')
  expect(container.querySelector('details')?.open).toBe(false)
  expect(container.textContent).toContain(locale === 'en' ? 'isolated greeting' : '独立问候')
  expect(container.textContent).not.toContain('Capacity preference')
})
it.each(['continuity', 'equal-distribution', 'no-fit'] as const)('shows the captured actual selection method: %s', async method => {
  const container = await mount({ ...auto, explanation: {
    assessment: { demand: 'unknown', source: 'local', signals: ['continuation'], diagnostic: 'disabled' },
    targetCategory: 'powerful', selectedCategory: 'versatile', categoryCandidateCount: method === 'no-fit' ? 0 : 2,
    method, fallback: true,
  } })
  await act(async () => container.querySelector('button')!.click())
  expect(container.textContent).toContain(method === 'continuity' ? 'Kept the previous model'
    : method === 'equal-distribution' ? 'stable equal-weight allocation' : 'No candidate fits')
  expect(container.textContent).toContain('Semantic assessment is disabled')
})
it.each([
  { selection: auto, routes: undefined, expected: 'Auto (intelligence)ⓘ' },
  { selection: { mode: 'manual' } as const, routes: undefined, expected: 'Manualⓘ' },
  { selection: { mode: 'unknown' } as const, routes: [{ provider: 'github-copilot-preview', model: 'fixture' }], expected: 'Selection unknown' },
  { selection: { mode: 'unknown' } as const, routes: [{ provider: 'other', model: 'fixture' }], expected: '' },
])('uses native completion independently of optional projections: $expected', async ({ selection, routes, expected }) => {
  let component: ComponentType<Record<string, unknown>> | undefined
  const get = vi.fn(async () => ({ ok: true, value: selection }))
  const diagnostic = vi.fn()
  cleanups.push(installAutoModelPresentation({ diagnostic, remote: { githubCopilotTurnSelection: { get } },
    slots: {
      spec: () => ({ kind: 'list', scope: 'session' }), inject: (_: string, setup: () => () => void) => setup(),
      register: (_: unknown, value: ComponentType<Record<string, unknown>>) => { component = value; return () => {} },
    },
  }))
  expect(component).toBeTypeOf('function')
  const turn = { turn: 7, data: { source: () => ({ getSnapshot: () => undefined, subscribe: () => () => {} }) } }
  const snapshot = { nodes: { values: () => [{
    kind: 'turn-tail', location: { kind: 'turn', turn },
    data: { turn: 7, seq: 12, closing: { finalNode: { messageId: 'reply' } }, tokenUsage: { routes } },
  }] } }
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container); cleanups.push(() => root.unmount())
  await act(async () => root.render(createElement(component!, {
    sessionId: 'session-a', messageId: 'reply', useChat: (select: (value: unknown) => unknown) => select(snapshot),
  })))
  expect(container.textContent).toBe(expected)
  expect(get).toHaveBeenCalledExactlyOnceWith('session-a', 7)
  expect(diagnostic).toHaveBeenCalledWith('COPILOT_TURN_SELECTION_PROVENANCE_UNAVAILABLE')
  if (expected.includes('ⓘ')) {
    await act(async () => container.querySelector('button')!.click())
    expect(container.querySelector('[role=dialog]')?.textContent).toContain('native Usage is unchanged')
    if (routes?.length) expect(container.querySelector('[role=dialog]')?.textContent).not.toContain('Recorded models')
    else expect(container.querySelector('[role=dialog]')?.textContent).toContain('Model evidence unavailable')
  }
})
it.each([
  { turn: 8, seq: 12, messageId: 'reply' },
  { turn: 7, seq: undefined, messageId: 'reply' },
  { turn: 7, seq: -1, messageId: 'reply' },
  { turn: 7, seq: 12, messageId: 'another-reply' },
])('rejects missing or mismatched native completion without optional projections: %j', async data => {
  let component: ComponentType<Record<string, unknown>> | undefined
  const get = vi.fn(async () => ({ ok: true, value: auto }))
  cleanups.push(installAutoModelPresentation({ diagnostic: vi.fn(), remote: { githubCopilotTurnSelection: { get } },
    slots: {
      spec: () => ({ kind: 'list', scope: 'session' }), inject: (_: string, setup: () => () => void) => setup(),
      register: (_: unknown, value: ComponentType<Record<string, unknown>>) => { component = value; return () => {} },
    },
  }))
  const snapshot = { nodes: { values: () => [{
    kind: 'turn-tail', location: { turn: { turn: 7 } },
    data: { ...data, closing: { finalNode: { messageId: data.messageId } } },
  }] } }
  const container = document.createElement('div')
  const root = createRoot(container); cleanups.push(() => root.unmount())
  await act(async () => root.render(createElement(component!, {
    sessionId: 'session-a', messageId: 'reply', useChat: (select: (value: unknown) => unknown) => select(snapshot),
  })))
  expect(container.textContent).toBe('')
  if (data.messageId !== 'reply') expect(get).not.toHaveBeenCalled()
})
it('shows only mode, then opens truthful reasons with focus, Escape and outside dismissal', async () => {
  const container = await mount(auto)
  expect(container.textContent).toBe('Auto (intelligence)ⓘ')
  const trigger = container.querySelector('button')!
  await act(async () => trigger.click())
  expect(container.textContent).toContain('Detailed selection reasons were not retained')
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
  expect(container.textContent).toBe('Selection unavailableRetryⓘ')
  expect(diagnostic).toHaveBeenCalledWith('COPILOT_TURN_SELECTION_READ_FAILED')
  get.mockImplementation(() => Promise.resolve({ ok: true, value: auto }))
  await act(async () => container.querySelector('button')!.click())
  expect(get).toHaveBeenLastCalledWith('new', 1)
  expect(container.textContent).toBe('Auto (intelligence)ⓘ')
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
  expect(container.querySelector('[role=dialog]')?.textContent).toContain('Detailed selection reasons were not retained')
  expect(container.querySelector('[role=dialog]')?.textContent).toContain('actual-model')
  expect(container.querySelector('[role=dialog]')?.textContent).not.toContain('Capacity preference')
  await act(async () => root.render(createElement(component!, { ...props, unrelatedPicker: 'different-model' })))
  expect(get).toHaveBeenCalledTimes(1)
  expect(diagnostic).not.toHaveBeenCalled()
})
it.each(['en', 'zh-CN'])('keeps model evidence first inside the existing dialog with multiple routes and overflow (%s)', async locale => {
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container); cleanups.push(() => root.unmount())
  const model = 'synthetic-long-model-'.repeat(40)
  await act(async () => root.render(createElement(TurnSelectionCard, {
    selection: auto, locale, models: { kind: 'recorded', incomplete: true,
      routes: [{ provider: 'github-copilot-preview', model }, { provider: 'other-provider', model: 'fixture-b' }] },
  })))
  expect(container.textContent).not.toContain(model)
  expect(container.querySelectorAll('button')).toHaveLength(1)
  await act(async () => container.querySelector('button')!.click())
  const dialog = container.querySelector<HTMLElement>('[role=dialog]')!
  expect(dialog.getAttribute('aria-label')).toBe(locale === 'en' ? 'Turn model and selection evidence' : '本轮模型与选择记录')
  expect(dialog.textContent).toContain(locale === 'en' ? 'Recorded models' : '已记录模型')
  expect(dialog.textContent).toContain(model)
  expect(dialog.textContent).toContain('other-provider')
  expect(dialog.textContent).toContain(locale === 'en' ? 'failed attempts' : '失败尝试')
  expect(dialog.style.overflowWrap).toBe('anywhere')
  expect(dialog.querySelector('section')!.compareDocumentPosition(dialog.querySelector('details')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(dialog.querySelector('details')!.open).toBe(false)
})
it.each(['requested', 'unknown'] as const)('does not turn %s evidence into execution or selection proof', async kind => {
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container); cleanups.push(() => root.unmount())
  const retryModels = vi.fn()
  await act(async () => root.render(createElement(TurnSelectionCard, {
    selection: { mode: 'unknown' }, models: { kind, incomplete: true,
      routes: kind === 'requested' ? [{ provider: 'github-copilot-preview', model: 'request-only' }] : [] },
    modelsFailed: kind === 'unknown', retryModels,
  })))
  await act(async () => container.querySelector('button')!.click())
  expect(container.textContent).toContain(kind === 'requested' ? 'Requested model' : 'Unknown')
  expect(container.textContent).toContain(kind === 'requested' ? 'not proof of dispatch' : 'not proof of missing evidence')
  expect(container.textContent).toContain('Selection evidence was not retained')
  if (kind === 'unknown') {
    await act(async () => Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Retry')!.click())
    expect(retryModels).toHaveBeenCalledOnce()
  }
})
it('reads requested models for the viewed turn and retries only failed evidence without changing selection', async () => {
  let component: ComponentType<Record<string, unknown>> | undefined
  const requestedModels = vi.fn().mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce({
    ok: true, value: { routes: [{ provider: 'github-copilot-preview', model: 'fixture-request-only' }], incomplete: false },
  })
  const get = vi.fn(async () => ({ ok: true, value: { mode: 'manual' } }))
  cleanups.push(installAutoModelPresentation({ diagnostic: vi.fn(),
    remote: { githubCopilotTurnSelection: { get, requestedModels } },
    slots: { spec: () => ({ kind: 'list', scope: 'session' }), inject: (_: string, setup: () => () => void) => setup(),
      register: (_: unknown, value: ComponentType<Record<string, unknown>>) => { component = value; return () => {} } },
  }))
  const turn = { turn: 7, data: { source: () => ({ getSnapshot: () => undefined, subscribe: () => () => {} }) } }
  const snapshot = { nodes: new Map([['tail', { kind: 'turn-tail', location: { turn },
    data: { turn: 7, seq: 12, closing: { finalNode: { messageId: 'reply' } } } }]]) }
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container); cleanups.push(() => root.unmount())
  const props = { sessionId: 'viewed', messageId: 'reply', useChat: (select: (value: unknown) => unknown) => select(snapshot) }
  await act(async () => root.render(createElement(component!, props)))
  expect(requestedModels).toHaveBeenCalledExactlyOnceWith('viewed', 7)
  await act(async () => container.querySelector('button')!.click())
  expect(container.textContent).toContain('not proof of missing evidence')
  await act(async () => Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Retry')!.click())
  expect(requestedModels).toHaveBeenLastCalledWith('viewed', 7)
  expect(get).toHaveBeenCalledTimes(1)
  expect(container.querySelector('[role=dialog]')?.textContent).toContain('Requested model')
  expect(container.querySelector('[role=dialog]')?.textContent).toContain('fixture-request-only')
  expect(container.querySelector('[role=dialog]')?.textContent).not.toContain('Recorded models')
  await act(async () => root.render(createElement(component!, { ...props, unrelatedPicker: 'wrong-model' })))
  expect(requestedModels).toHaveBeenCalledTimes(2)
  expect(container.textContent).not.toContain('wrong-model')
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
