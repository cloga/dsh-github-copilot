// @vitest-environment jsdom
// Executed inside an exact Core checkout by verify-reasoning-presentation.mjs.
// Native Markdown resolves local media against window.location.
import { Context } from '@deepseek-ai/cordis'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { createSlotRenderer } from '../../ui-renderer/src/client/scoped-slots.tsx'
import { ConversationEventRegistry, ConversationViewRegistry, ConversationNodeAssembler } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { AssistantNodeView } from '../../ui-chat/src/client/chat/AssistantNodeView.tsx'
import { ASSISTANT_ORIGIN_KEY, assistantOriginDefinition, installReasoningPresentation, projectReasoningPresentation } from '__COPILOT_REASONING_MODULE__'
import { installAutoModelPresentation } from '__COPILOT_AUTO_MODULE__'
import { assistantDefinition } from '../../ui-chat/src/client/conversation-nodes/assistant.ts'
import { turnTailDefinition } from '../../ui-chat/src/client/conversation-nodes/turn-tail.ts'
import { chatViewDefinition } from '../../ui-chat/src/client/conversation-nodes/chat-snapshot-builder.ts'

// Two source checkouts must share the renderer's React, as the loaded Client does.
vi.mock('__COPILOT_REACT_MODULE__', async () => import('react'))

const event = (seq: number, type: string, data: object) => ({
  type: 'event' as const, event: { seq, time: 1700000000000 + seq, type, data, surfaceOp: 'append' as const },
})
const reply = (provider = 'github-copilot') => event(2, 'assistant/message', {
  turn: 1, step: 1,
  message: { role: 'assistant', source: { kind: 'model', provider, model: 'fixture-model' }, content: [] },
})
const prefix = [event(0, 'turn/start', { turn: 1 }), event(1, 'step/start', { turn: 1, step: 1 })]

describe('Copilot reasoning presentation against real Core services', () => {
  it.each(['replace', 'append'] as const)('explains missing turn Usage through native assembly and scoped actions (%s)', async mode => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    const ctx = new Context()
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await ctx.plugin(SlotRegistry)
      const events = new ConversationEventRegistry(ctx)
      const views = new ConversationViewRegistry(ctx)
      events.register(assistantDefinition)
      events.register(turnTailDefinition)
      views.register(chatViewDefinition)
      ctx.slots.install(createSlotRenderer())
      const remove = installAutoModelPresentation({
        slots: ctx.slots, uiConversation: { events }, diagnostic: vi.fn(),
        remote: { githubCopilotTurnSelection: { get: async () => ({ ok: true, value: { mode: 'manual' } }) } },
      })
      const assembler = new ConversationNodeAssembler(events, views)
      assembler.activateTarget('chat')
      const records = [
        ...prefix,
        event(2, 'assistant/attempt', { turn: 1, step: 1, stream: [{ type: 'chunk', time: 2, chunk: {
          type: 'finish', reason: { kind: 'error', failure: {
            code: 'CONTEXT_WINDOW_EXCEEDED',
            message: 'Copilot local estimated input budget exceeded (796299 estimated tokens > 781113 budget tokens); requesting stock compaction before provider dispatch.',
          } },
        } }] }),
        event(3, 'assistant/message', {
          turn: 1, step: 1, stream: [], usage: {
            inputTokens: 3, outputTokens: 113, totalTokens: 32601, cacheReadTokens: 30237, cacheWriteTokens: 2248,
          },
          message: { id: 'usage-fixture-reply', role: 'assistant',
            source: { kind: 'model', provider: 'github-copilot-preview', model: 'fixture-model' },
            content: [{ type: 'text', text: 'Synthetic recovered completion.' }] },
        }),
        event(4, 'step/end', { turn: 1, step: 1 }),
        event(5, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
      ]
      const original = JSON.stringify(records)
      if (mode === 'replace') assembler.replaceWindow(records as never, false)
      else {
        assembler.replaceWindow([], false)
        assembler.flush()
        for (const record of records) { assembler.append(record as never); assembler.flush() }
      }
      assembler.flush()
      const snapshot = assembler.snapshot('chat')
      const binding = { key: 'fixture-session', ctx, props: { sessionId: 'fixture-session' }, keyedHooks: {},
        hooks: { chat: { getSnapshot: () => snapshot, subscribe: () => () => {} } } }
      const source = { getSnapshot: () => binding, subscribe: () => () => {} }
      ctx.slots.installScope('session', { current: source, bindingSource: () => source, renderArea: (_, props) => props.children })
      ctx.slots.register({
        name: 'root', children: { 'conversation.chat.assistant-actions': { kind: 'list', scope: 'session' } },
      }, props => createElement(props.SessionProvider, { session: 'fixture-session' as never },
        props.renderSlot('conversation.chat.assistant-actions', { messageId: 'usage-fixture-reply' as never })))
      await act(async () => root.render(ctx.slots.renderSlot('root', {})))
      const modelTrigger = container.querySelector<HTMLButtonElement>('[aria-label="View turn model and selection evidence"]')
      if (!modelTrigger) throw new Error('Missing existing model evidence dialog')
      await act(async () => modelTrigger.click())
      expect(container.querySelector('[role=dialog]')?.textContent).toContain('Recorded models')
      expect(container.querySelector('[role=dialog]')?.textContent).toContain('fixture-model')
      expect(container.querySelector('[role=dialog]')?.textContent).toContain('Model attribution is incomplete')
      await act(async () => Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Close')!.click())
      const trigger = Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Turn Usage incomplete')
      if (!trigger) throw new Error('Missing native fixture Usage explanation')
      await act(async () => trigger.click())
      expect(container.querySelector('[role=dialog]')?.textContent).toContain('1 local input-budget block')
      expect(container.querySelector('[role=dialog]')?.textContent).not.toContain('32601')
      expect(JSON.stringify(records)).toBe(original)
      await act(async () => remove())
      expect(container.textContent).toBe('')
    } finally {
      await act(async () => root.unmount())
      container.remove()
      await ctx.fiber.dispose()
    }
  })
  it.each(['replace', 'append'] as const)('renders retained Auto evidence without optional projections through native %s and slots', async mode => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    const ctx = new Context()
    const container = document.createElement('div')
    const root = createRoot(container)
    try {
      await ctx.plugin(SlotRegistry)
      const events = new ConversationEventRegistry(ctx)
      const views = new ConversationViewRegistry(ctx)
      events.register(assistantDefinition)
      events.register(turnTailDefinition)
      views.register(chatViewDefinition)
      const assembler = new ConversationNodeAssembler(events, views)
      assembler.activateTarget('chat')
      const records = [
        ...prefix,
        event(2, 'assistant/message', {
          turn: 1, step: 1, stream: [],
          message: { id: 'fixture-reply', role: 'assistant', source: { kind: 'model', provider: 'github-copilot-preview', model: 'fixture' },
            content: [{ type: 'text', text: 'A completed response.' }] },
        }),
        event(3, 'step/end', { turn: 1, step: 1 }),
        event(4, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
      ]
      if (mode === 'replace') assembler.replaceWindow(records as never, false)
      else {
        assembler.replaceWindow([], false)
        assembler.flush()
        for (const record of records) { assembler.append(record as never); assembler.flush() }
      }
      assembler.flush()
      const snapshot = assembler.snapshot('chat')
      const binding = { key: 'fixture-session', ctx, props: { sessionId: 'fixture-session' }, keyedHooks: {},
        hooks: { chat: { getSnapshot: () => snapshot, subscribe: () => () => {} } } }
      const source = { getSnapshot: () => binding, subscribe: () => () => {} }
      ctx.slots.install(createSlotRenderer())
      ctx.slots.installScope('session', { current: source, bindingSource: () => source, renderArea: (_, props) => props.children })
      ctx.slots.register({
        name: 'root', children: { 'conversation.chat.assistant-actions': { kind: 'list', scope: 'session' } },
      }, props => createElement(props.SessionProvider, { session: 'fixture-session' as never },
        props.renderSlot('conversation.chat.assistant-actions', { messageId: 'fixture-reply' as never })))
      const diagnostic = vi.fn()
      const get = vi.fn(async () => ({ ok: true, value: {
        mode: 'auto', preference: 'intelligence', reason: 'standard-turn', candidateCount: 3,
      } }))
      // Intentionally no uiConversation: its optional dependency fiber may still be pending.
      const remove = installAutoModelPresentation({ slots: ctx.slots, remote: { githubCopilotTurnSelection: { get } }, diagnostic })
      await act(async () => root.render(ctx.slots.renderSlot('root', {})))
      expect(container.textContent).toBe('Auto (intelligence)ⓘ')
      expect(get).toHaveBeenCalledExactlyOnceWith('fixture-session', 1)
      expect(diagnostic).toHaveBeenCalledWith('COPILOT_TURN_SELECTION_PROVENANCE_UNAVAILABLE')
      expect(container.textContent).not.toContain('fixture')
      await act(async () => remove())
      expect(container.textContent).toBe('')
    } finally {
      await act(async () => root.unmount())
      await ctx.fiber.dispose()
    }
  })

  it('renders answers and public summaries without the fifteen empty native Think rows', () => {
    const blocks = [
      ...Array.from({ length: 15 }, () => Object.freeze({ kind: 'reasoning', text: '' })),
      Object.freeze({ kind: 'reasoning', text: 'A public reasoning summary.' }),
      Object.freeze({ kind: 'text', text: 'The visible answer.' }),
    ]
    const props = {
      node: { kind: 'assistant-step', location: { kind: 'unresolved' }, data: { status: 'settled', step: 1, finalNode: { seq: 2 }, blocks } },
      useTurnData: () => undefined, openFile: () => {}, fileMentions: () => [],
      useDisclosure: () => ({ expanded: false, setExpanded: () => {}, toggle: () => {} }),
      usePresentation: (select: (policy: { settledReasoningPreview: boolean }) => unknown) =>
        select({ settledReasoningPreview: true }),
      renderMessageImages: () => null, t: (key: string) => key === 'message.think' ? 'Think' : key,
    }
    const before = renderToStaticMarkup(createElement(AssistantNodeView, props as never))
    const projected = projectReasoningPresentation(props, { seq: 2, provider: 'github-copilot', model: 'gpt-6-astra' })
    const after = renderToStaticMarkup(createElement(AssistantNodeView, projected as never))
    expect((before.match(/data-variant="think"/g) ?? []).length).toBe(16)
    expect((after.match(/data-variant="think"/g) ?? []).length).toBe(1)
    expect(after).toContain('A public reasoning summary.')
    expect(after).toContain('The visible answer.')
    expect(props.node.data.blocks).toHaveLength(17)
    expect(projected.node.data.finalNode).toBe(props.node.data.finalNode)
  })

  it('selects and restores the actual native Assistant renderer through the public registry', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(SlotRegistry)
      const slots = ctx.slots
      slots.register({ name: 'root', children: { 'conversation.chat.node': { kind: 'keyed', scope: 'session' } } }, () => null)
      slots.register({ name: 'conversation.chat.node', key: 'assistant-step', locale: 'chat' }, AssistantNodeView)
      const events = new ConversationEventRegistry(ctx)
      const diagnostic = vi.fn()
      const remove = installReasoningPresentation({ slots, uiConversation: { events }, diagnostic })
      await Promise.resolve()
      expect(diagnostic).not.toHaveBeenCalled()
      expect(events.entries().some(entry => entry.kind === ASSISTANT_ORIGIN_KEY)).toBe(true)
      expect(slots.entriesOfSlot('conversation.chat.node')[0]?.component).not.toBe(AssistantNodeView)
      expect(slots.entriesOfSlot('conversation.chat.node')[0]?.options.priority).toBe(-1)
      remove()
      await Promise.resolve()
      expect(slots.entriesOfSlot('conversation.chat.node')[0]?.component).toBe(AssistantNodeView)
      expect(events.entries()).toHaveLength(0)
    } finally { await ctx.fiber.dispose() }
  })

  it('publishes historical provider leaves through real assembly, prepend and source notifications', async () => {
    const ctx = new Context()
    try {
      const events = new ConversationEventRegistry(ctx)
      const views = new ConversationViewRegistry(ctx)
      events.register(assistantOriginDefinition)
      events.register({
        kind: 'reasoning-fixture-reader', target: 'reasoning-fixture',
        match: item => item.type === 'assistant/message' ? { id: 'reply', role: 'start' } : null,
        start: () => null, update: context => context.state,
        buildViewNode: context => ({ key: context.key, kind: context.kind, id: context.id, target: 'reasoning-fixture', data: context.start?.location }),
      })
      views.register({ target: 'reasoning-fixture', create: () => ({ empty: [], replace: ({ nodes }) => nodes, apply: ({ upserts }) => upserts }) })
      const assembler = new ConversationNodeAssembler(events, views)
      assembler.activateTarget('reasoning-fixture')
      // Fixture event envelopes are deliberately synthetic; real Core owns their assembly.
      assembler.replaceWindow([reply()] as never, true)
      assembler.flush()
      const snapshot = assembler.snapshot('reasoning-fixture') as readonly { data: { kind: string; step: { data: { source(key: string): { getSnapshot(): unknown; subscribe(cb: () => void): () => void } } } } }[]
      expect(snapshot[0]?.data.kind).toBe('step')
      const source = snapshot[0]!.data.step.data.source(ASSISTANT_ORIGIN_KEY)
      expect(source.getSnapshot()).toEqual({ seq: 2, provider: 'github-copilot', model: 'fixture-model' })
      const changed = vi.fn()
      const off = source.subscribe(changed)
      assembler.prepend(prefix as never, false)
      assembler.flush()
      expect(source.getSnapshot()).toEqual({ seq: 2, provider: 'github-copilot', model: 'fixture-model' })
      assembler.replaceWindow([...prefix, reply('other-provider')] as never, false)
      assembler.flush()
      expect(source.getSnapshot()).toEqual({ seq: 2, provider: 'other-provider', model: 'fixture-model' })
      expect(changed).toHaveBeenCalled()
      const props = { node: { kind: 'assistant-step', data: { status: 'settled', finalNode: { seq: 2 }, blocks: [{ kind: 'reasoning', text: '' }] } } }
      expect(projectReasoningPresentation(props, source.getSnapshot())).toBe(props)
      assembler.replaceWindow(prefix as never, false)
      assembler.flush()
      expect(source.getSnapshot()).toBeUndefined()
      off()
    } finally { await ctx.fiber.dispose() }
  })
})
