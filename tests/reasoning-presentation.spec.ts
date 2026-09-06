import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ASSISTANT_ORIGIN_KEY,
  assistantOriginDefinition as definition,
  installReasoningPresentation,
  projectReasoningPresentation,
} from '../src/reasoning-presentation.ts'

// Element/delegation evidence, not browser rendering. Keep real memo/createElement
// and replace only the hook dispatcher so its unconditional source usage is visible.
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>()
  return { ...actual, useSyncExternalStore: vi.fn((_subscribe, getSnapshot) => getSnapshot()) }
})

const origin = Object.freeze({ seq: 42, provider: 'github-copilot', model: 'gpt-6-astra' })
const answer = Object.freeze({ kind: 'text', text: 'Public answer' })
const empty = Object.freeze({ kind: 'reasoning', text: '' })
function view(blocks: readonly unknown[] = [empty, answer], status = 'settled', seq: number | undefined = 42) {
  const finalNode = Object.freeze({ seq, blocks, messageId: 'message-id' })
  return Object.freeze({
    sessionId: 'session-a', t: vi.fn(), openFile: vi.fn(), inspectCall: vi.fn(), forkAt: vi.fn(),
    renderMessageImages: vi.fn(), fileMentions: vi.fn(),
    node: Object.freeze({
      kind: 'assistant-step', key: 'assistant-step:1:2', target: 'chat',
      data: Object.freeze({ turn: 1, step: 2, status, blocks, finalNode }),
    }),
  })
}

function message(seq = 42, provider: string | undefined = 'github-copilot', model = 'gpt-6-astra') {
  return Object.freeze({
    type: 'assistant/message', seq, surfaceOp: 'append',
    data: Object.freeze({ turn: 1, step: 2, message: Object.freeze({ source: Object.freeze({ provider, model }) }) }),
  })
}
const start = { event: { type: 'step/start', seq: 1, data: { turn: 1, step: 2 } } }

// Contract mock (not real Core activation): raw roster includes shadowed entries, lower rank
// wins, inject follows declaration lifetimes, all teardown is idempotent. Both
// synchronous (adversarial) and microtask-batched (Core) entry notifications are tested.
class SlotFixture {
  rows: { component: unknown; options: { key: string; priority?: number }; locale?: unknown; inject?: unknown; children?: unknown; store?: unknown; select?: unknown }[] = []
  listeners = new Set<() => void>()
  injections = new Set<{ setup: () => () => void; cleanup?: (() => void) | undefined }>()
  declared = true
  kind = 'keyed'
  scope = 'session'
  notifications = 0
  queued = false
  constructor(readonly batched = false) {}
  entries() { return this.rows }
  spec() { return this.declared ? { kind: this.kind, scope: this.scope } : undefined }
  subscribe(_name: string, listener: () => void) {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  notify() {
    if (this.batched) {
      if (!this.queued) {
        this.queued = true
        queueMicrotask(() => { this.queued = false; this.emit() })
      }
    } else this.emit()
  }
  emit() {
    if (++this.notifications > 100) throw new Error('reentrant registration loop')
    for (const listener of [...this.listeners]) listener()
  }
  inject(_name: string, setup: () => () => void) {
    const injection: { setup: () => () => void; cleanup?: (() => void) | undefined } = { setup }
    this.injections.add(injection)
    if (this.declared) injection.cleanup = setup()
    return () => {
      this.injections.delete(injection)
      injection.cleanup?.()
      injection.cleanup = undefined
    }
  }
  register(options: { name: string; key: string; priority?: number; locale?: unknown; inject?: unknown; children?: unknown; store?: unknown; select?: unknown }, component: unknown) {
    if (!this.declared) throw new Error('undeclared slot')
    if (this.rows.some(row => row.options.key === options.key && (row.options.priority ?? 0) === (options.priority ?? 0))) {
      throw new Error('duplicate rank')
    }
    const row = {
      component, options: { key: options.key, ...(options.priority === undefined ? {} : { priority: options.priority }) },
      locale: options.locale, inject: options.inject, children: options.children, store: options.store, select: options.select,
    }
    this.rows = [...this.rows, row].sort((a, b) => (a.options.priority ?? 0) - (b.options.priority ?? 0))
    this.notify()
    return () => {
      if (!this.rows.includes(row)) return
      this.rows = this.rows.filter(candidate => candidate !== row)
      this.notify()
    }
  }
  declare() {
    this.declared = true
    for (const injection of this.injections) injection.cleanup = injection.setup()
  }
  collapse() {
    this.declared = false
    this.rows = []
    for (const injection of this.injections) {
      injection.cleanup?.()
      injection.cleanup = undefined
    }
    this.notify()
  }
  native(component: unknown = React.memo(function AssistantNodeView() { return null }), extra: object = {}) {
    return this.register({ name: 'conversation.chat.node', key: 'assistant-step', locale: 'chat', ...extra }, component)
  }
}

function install(slots = new SlotFixture()) {
  const definitions = new Set<unknown>()
  const register = vi.fn((value: unknown) => {
    if (definitions.has(value)) throw new Error('duplicate definition')
    definitions.add(value)
    return () => { definitions.delete(value) }
  })
  const diagnostic = vi.fn()
  const dispose = installReasoningPresentation({ slots, uiConversation: { events: { register } }, diagnostic })
  return { slots, definitions, register, diagnostic, dispose }
}

beforeEach(() => vi.clearAllMocks())

describe('Copilot reasoning presentation projection', () => {
  it('removes fifteen empty rows without reading or changing encrypted durable replay material', () => {
    const content = Object.freeze([...Array.from({ length: 15 }, (_, index) => Object.freeze({
      type: 'reasoning', text: '', signature: `encrypted_content_${index}`,
    })), Object.freeze({ type: 'text', text: 'Public answer', signature: '' })])
    const replayState = Object.freeze({ blocks: Object.freeze(content.map((block, index) => Object.freeze({ index, signature: block.signature }))) })
    const durable = Object.freeze({ content, replayState })
    const props = view(Object.freeze([...Array.from({ length: 15 }, () => empty), answer]))
    const withDurable = Object.freeze({ ...props, durable })
    const projected = projectReasoningPresentation(withDurable, origin)
    expect(projected.node.data.blocks).toEqual([answer])
    expect(projected.node.data.finalNode).toBe(props.node.data.finalNode)
    expect(projected.node.data.finalNode.blocks).toHaveLength(16)
    expect(projected.durable).toBe(durable)
    expect(projected.durable.replayState).toBe(replayState)
    expect(content).toHaveLength(16)
    expect(replayState.blocks.map(block => block.index)).toEqual(Array.from({ length: 16 }, (_, index) => index))
    expect(replayState.blocks[14]?.signature).toBe('encrypted_content_14')
  })

  it('preserves public summaries, images, tool blocks, empty non-reasoning blocks and relative order', () => {
    const blocks = Object.freeze([
      answer, empty, Object.freeze({ kind: 'reasoning', text: ' \t\r\n' }),
      Object.freeze({ kind: 'reasoning', text: 'A public summary' }),
      Object.freeze({ kind: 'image', data: 'image-reference' }),
      Object.freeze({ kind: 'tool-call', name: 'read', callId: 'call-1' }),
      Object.freeze({ kind: 'text', text: '' }), Object.freeze({ kind: 'reasoning' }),
    ])
    const projected = projectReasoningPresentation(view(blocks), origin)
    expect(projected.node.data.blocks).toEqual([blocks[0], ...blocks.slice(3)])
    for (const block of projected.node.data.blocks) expect(blocks.some(original => original === block)).toBe(true)
  })

  it.each(['running', 'interrupted'])('leaves %s placeholders unchanged', status => {
    const props = view(undefined, status)
    expect(projectReasoningPresentation(props, origin)).toBe(props)
  })

  it('fails open for other providers, missing provenance, missing/mismatched seq and no empty rows', () => {
    const props = view()
    for (const evidence of [undefined, null, {}, { ...origin, provider: 'openai' }, { ...origin, seq: 43 }, { ...origin, model: '' }]) {
      expect(projectReasoningPresentation(props, evidence)).toBe(props)
    }
    const missingSeq = view(undefined, 'settled', undefined)
    // Override explicitly: default arguments normally supply the fixture seq.
    const missing = { ...missingSeq, node: { ...missingSeq.node, data: { ...missingSeq.node.data, finalNode: {} } } }
    expect(projectReasoningPresentation(missing, origin)).toBe(missing)
    const publicOnly = view([answer, { kind: 'reasoning', text: 'Visible' }])
    expect(projectReasoningPresentation(publicOnly, origin)).toBe(publicOnly)
    const notAssistant = { ...props, node: { ...props.node, kind: 'other' } }
    expect(projectReasoningPresentation(notAssistant, origin)).toBe(notAssistant)
  })
})

describe('historical assistant origin Definition', () => {
  it('is targetless and correlates explicit starts and append messages by turn/step', () => {
    expect(definition).not.toHaveProperty('target')
    expect(definition).not.toHaveProperty('buildViewNode')
    expect(definition.kind).toBe(ASSISTANT_ORIGIN_KEY)
    expect(definition.match(start.event)).toEqual({ id: '1:2', role: 'start' })
    expect(definition.match(message())).toEqual({ id: '1:2', role: 'update' })
    expect(definition.match({ ...message(), surfaceOp: { op: 'replace' } })).toBeNull()
    expect(definition.match({ ...message(), surfaceOp: undefined })).toBeNull()
    expect(definition.match({ type: 'assistant/chunk', data: { turn: 1, step: 2 } })).toBeNull()
    expect(definition.match({ type: 'step/start', data: {} })).toBeNull()
    expect(definition.match(null)).toBeNull()
  })

  it('publishes only settled evidence and preserves unchanged publication identity', () => {
    const state = definition.start({ matches: [] }, start)
    expect(state).toEqual({ turn: 1, step: 2, origin: undefined })
    expect(definition.buildLocationData({ state, matches: [start] }, 'step', null)).toBeNull()
    const final = { event: message() }
    const settled = definition.update({ state, matches: [start, final] }, final)
    const context = { state: settled, matches: [start, final] }
    const published = definition.buildLocationData(context, 'step', null)
    expect(published).toEqual({ kind: 'step', turn: 1, step: 2, key: ASSISTANT_ORIGIN_KEY, value: origin })
    expect(definition.buildLocationData(context, 'step', published)).toBe(published)
    expect(definition.buildLocationData(context, 'turn', null)).toBeNull()
  })

  it('reconstructs cold/prepended history without step/start and never borrows a current route', () => {
    const copilot = { event: message() }
    expect(definition.buildLocationData({ matches: [copilot] }, 'step', null)?.value).toEqual(origin)
    const other = { event: message(50, 'openai', 'another-model') }
    const context = { matches: [copilot, other] }
    expect(definition.buildLocationData(context, 'step', null)?.value).toEqual({ seq: 50, provider: 'openai', model: 'another-model' })
    const missingSource = { event: { ...message(60), data: { turn: 1, step: 2, message: {} } } }
    expect(definition.buildLocationData({ matches: [copilot, missingSource] }, 'step', null)).toBeNull()
    expect(definition.buildLocationData({ matches: [] }, 'step', null)).toBeNull()
    const replay = { ...message(), data: { ...message().data, message: {
      source: origin,
      get content(): never { throw new Error('must not read content') },
      get replayState(): never { throw new Error('must not read replayState') },
    } } }
    expect(definition.buildLocationData({ matches: [{ event: replay }] }, 'step', null)?.value).toEqual(origin)
  })

  it('clears old provenance on a subsequent unattributed message', () => {
    const first = { event: message() }
    const state = definition.update({ state: definition.start({ matches: [] }, start), matches: [first] }, first)
    const next = { event: { ...message(43), data: { turn: 1, step: 2, message: {} } } }
    const cleared = definition.update({ state, matches: [first, next] }, next)
    expect(definition.buildLocationData({ state: cleared, matches: [first, next] }, 'step', null)).toBeNull()
    expect(definition.update({ state, matches: [] }, start)).toBe(state)
    expect(() => definition.start({ matches: [] }, first)).toThrow('COPILOT_REASONING_ORIGIN_START')
  })
})

describe('public Slot delegation lifecycle (contract mock)', () => {
  it('delegates the original memo component and forwards locale/actions with reactive origin', () => {
    const slots = new SlotFixture()
    const renderNative = vi.fn(() => null)
    const native = React.memo(function AssistantNodeView() { return renderNative() })
    slots.native(native)
    const fixture = install(slots)
    const wrapper = slots.rows[0]?.component as React.FunctionComponent<Record<string, unknown>>
    expect(slots.rows[0]?.options.priority).toBe(-1)
    expect(slots.rows[0]?.locale).toBe('chat')
    const getSnapshot = vi.fn(() => origin)
    const subscribe = vi.fn(() => () => {})
    const source = vi.fn(() => ({ getSnapshot, subscribe }))
    const props = view()
    const located = { ...props, node: { ...props.node, location: { kind: 'step', step: { data: { source } } } } }
    const result = wrapper(located) as React.ReactElement<typeof located>
    expect(result.type).toBe(native)
    expect(renderNative).not.toHaveBeenCalled()
    expect(result.props.node.data.blocks).toEqual([answer])
    expect(result.props.t).toBe(props.t)
    expect(result.props.openFile).toBe(props.openFile)
    expect(result.props.inspectCall).toBe(props.inspectCall)
    expect(result.props.forkAt).toBe(props.forkAt)
    expect(result.props.renderMessageImages).toBe(props.renderMessageImages)
    expect(result.props.node.data.finalNode).toBe(props.node.data.finalNode)
    expect(source).toHaveBeenCalledWith(ASSISTANT_ORIGIN_KEY)
    expect(React.useSyncExternalStore).toHaveBeenCalledWith(subscribe, getSnapshot, getSnapshot)
    const missing = wrapper(props) as React.ReactElement<typeof props>
    expect(missing.props.node).toBe(props.node)
    expect(React.useSyncExternalStore).toHaveBeenCalledTimes(2)
    fixture.dispose()
  })

  it.each([false, true])('handles native late mount, unload/reload and disposal (batched=%s)', async batched => {
    const slots = new SlotFixture(batched)
    const fixture = install(slots)
    expect(slots.rows).toHaveLength(0)
    const native = React.memo(function AssistantNodeView() { return null })
    const removeNative = slots.native(native)
    await Promise.resolve()
    expect(slots.rows).toHaveLength(2)
    const originalWrapper = slots.rows[0]?.component
    removeNative()
    await Promise.resolve()
    expect(slots.rows).toHaveLength(0)
    const replacement = React.memo(function AssistantNodeView() { return null })
    slots.native(replacement)
    await Promise.resolve()
    expect(slots.rows).toHaveLength(2)
    expect(slots.rows[0]?.component).not.toBe(originalWrapper)
    const delegate = (slots.rows[0]?.component as React.FunctionComponent<Record<string, unknown>>)(view()) as React.ReactElement
    expect(delegate.type).toBe(replacement)
    fixture.dispose()
    fixture.dispose()
    await Promise.resolve()
    expect(slots.rows.map(row => row.component)).toEqual([replacement])
    expect(slots.listeners.size).toBe(0)
    expect(slots.injections.size).toBe(0)
    expect(fixture.definitions.size).toBe(0)
    expect(slots.notifications).toBeLessThan(25)
  })

  it('follows declaration collapse/redeclare and restores native without duplicate wrappers', () => {
    const slots = new SlotFixture()
    slots.declared = false
    const fixture = install(slots)
    expect(slots.listeners.size).toBe(0)
    slots.declare()
    slots.native()
    expect(slots.rows).toHaveLength(2)
    slots.collapse()
    expect(slots.listeners.size).toBe(0)
    slots.declare()
    slots.native()
    expect(slots.rows).toHaveLength(2)
    expect(slots.listeners.size).toBe(1)
    fixture.dispose()
    expect(slots.rows).toHaveLength(1)
  })

  it('retires on any third-party override conflict and resumes only when safe', () => {
    const slots = new SlotFixture()
    slots.native()
    const fixture = install(slots)
    const removeOther = slots.native(React.memo(function AssistantNodeView() { return null }), { priority: -2 })
    expect(slots.rows).toHaveLength(2)
    expect(slots.rows.some(row => row.options.priority === -1)).toBe(false)
    expect(fixture.diagnostic).toHaveBeenCalledWith('COPILOT_REASONING_SLOT_CONFLICT')
    removeOther()
    expect(slots.rows.map(row => row.options.priority ?? 0)).toEqual([-1, 0])
    fixture.dispose()
  })

  it.each([{ locale: 'other' }, { inject: () => ({}) }, { store: {} }, { children: {} }, { select: () => null }, { priority: 1 }])('leaves unsupported native entry untouched: %j', extra => {
    const slots = new SlotFixture()
    slots.native(undefined, extra)
    const fixture = install(slots)
    expect(slots.rows).toHaveLength(1)
    expect(fixture.diagnostic).toHaveBeenCalledWith('COPILOT_REASONING_NATIVE_UNAVAILABLE')
    fixture.dispose()
  })

  it('leaves a lone foreign priority-zero memo renderer untouched despite matching metadata', () => {
    const slots = new SlotFixture()
    const foreign = React.memo(function OtherAssistant() { return null })
    slots.native(foreign)
    const fixture = install(slots)
    expect(slots.rows).toHaveLength(1)
    expect(slots.rows[0]?.component).toBe(foreign)
    expect(fixture.diagnostic).toHaveBeenCalledWith('COPILOT_REASONING_NATIVE_UNAVAILABLE')
    fixture.dispose()
  })

  it('fails open for future native component names that no longer match the verified artifact', () => {
    const slots = new SlotFixture()
    slots.native(React.memo(function a() { return null }))
    const fixture = install(slots)
    expect(slots.rows).toHaveLength(1)
    expect(fixture.diagnostic).toHaveBeenCalledWith('COPILOT_REASONING_NATIVE_UNAVAILABLE')
    fixture.dispose()
  })

  it('fails open on missing public APIs and incompatible slot declaration', () => {
    const diagnostic = vi.fn()
    const remove = installReasoningPresentation({ slots: {}, uiConversation: {}, diagnostic })
    expect(diagnostic).toHaveBeenCalledWith('COPILOT_REASONING_PRESENTATION_UNAVAILABLE')
    expect(() => remove()).not.toThrow()
    const slots = new SlotFixture()
    slots.scope = 'root'
    slots.native()
    const fixture = install(slots)
    expect(fixture.diagnostic).toHaveBeenCalledWith('COPILOT_REASONING_SLOT_UNSUPPORTED')
    expect(slots.rows).toHaveLength(1)
    fixture.dispose()
  })

  it('does not retry a failed registration on its own batched notifications', async () => {
    const slots = new SlotFixture(true)
    slots.native()
    const register = slots.register.bind(slots)
    const attempt = vi.fn((options: Parameters<SlotFixture['register']>[0], component: unknown) => {
      if (options.priority === -1) {
        slots.notify()
        throw new Error('entry rejected')
      }
      return register(options, component)
    })
    slots.register = attempt
    const fixture = install(slots)
    await Promise.resolve()
    await Promise.resolve()
    expect(attempt).toHaveBeenCalledOnce()
    expect(slots.rows).toHaveLength(1)
    expect(fixture.diagnostic).toHaveBeenCalledWith('COPILOT_REASONING_REGISTRATION_FAILED')
    fixture.dispose()
  })

  it('uses a stable no-op hook source for unsupported Location readers', () => {
    const slots = new SlotFixture()
    slots.native()
    const fixture = install(slots)
    const wrapper = slots.rows[0]?.component as React.FunctionComponent<Record<string, unknown>>
    const props = view()
    const located = { ...props, node: { ...props.node, location: {
      kind: 'step', step: { data: { source: () => { throw new Error('unsupported key') } } },
    } } }
    const result = wrapper(located) as React.ReactElement<typeof located>
    wrapper(props)
    expect(result.props.node).toBe(located.node)
    const calls = vi.mocked(React.useSyncExternalStore).mock.calls
    expect(calls[0]?.[0]).toBe(calls[1]?.[0])
    expect(calls[0]?.[1]).toBe(calls[1]?.[1])
    fixture.dispose()
  })

  it('requires the public spec seam rather than the private SlotCore specDynamic helper', () => {
    const slots = new SlotFixture()
    slots.native()
    const diagnostic = vi.fn()
    const unregister = vi.fn()
    const register = vi.fn(() => unregister)
    const legacyShape = {
      entries: slots.entries.bind(slots),
      specDynamic: slots.spec.bind(slots),
      subscribe: slots.subscribe.bind(slots),
      inject: slots.inject.bind(slots),
      register: slots.register.bind(slots),
    }
    installReasoningPresentation({ slots: legacyShape, uiConversation: { events: { register } }, diagnostic })()
    expect(diagnostic).toHaveBeenCalledWith('COPILOT_REASONING_PRESENTATION_UNAVAILABLE')
    expect(register).not.toHaveBeenCalled()
    expect(slots.rows).toHaveLength(1)
  })

  it('rolls back owned origin registration when setup throws', () => {
    const slots = new SlotFixture()
    slots.inject = () => { throw new Error('unsupported implementation') }
    const fixture = install(slots)
    expect(fixture.definitions.size).toBe(0)
    expect(fixture.diagnostic).toHaveBeenCalledWith('COPILOT_REASONING_REGISTRATION_FAILED')
    fixture.dispose()
  })
})
