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
import { installAutoModelPresentation } from '__COPILOT_AUTO_MODULE__'
import { assistantDefinition } from '../../ui-chat/src/client/conversation-nodes/assistant.ts'
import { turnTailDefinition } from '../../ui-chat/src/client/conversation-nodes/turn-tail.ts'
import { chatViewDefinition } from '../../ui-chat/src/client/conversation-nodes/chat-snapshot-builder.ts'

// Two source checkouts must share the renderer's React, as the loaded Client does.
vi.mock('__COPILOT_REACT_MODULE__', async () => import('react'))

const event = (seq: number, type: string, data: object) => ({
  type: 'event' as const, event: { seq, time: 1700000000000 + seq, type, data, surfaceOp: 'append' as const },
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

  it.each(['settled', 'running', 'interrupted'] as const)('renders native answers and summaries without blank Thinking disclosures (%s)', status => {
    const blocks = [
      ...Array.from({ length: 15 }, () => Object.freeze({ kind: 'reasoning', text: '' })),
      Object.freeze({ kind: 'reasoning', text: ' \n\t ' }),
      Object.freeze({ kind: 'reasoning', text: 'A public reasoning summary.' }),
      Object.freeze({ kind: 'text', text: 'The visible answer.' }),
    ]
    const props = {
      node: { kind: 'assistant-step', location: { kind: 'unresolved' }, data: { status, step: 1, finalNode: { seq: 2 }, blocks } },
      useTurnData: () => undefined, openFile: () => {}, fileMentions: () => [],
      useDisclosure: () => ({ expanded: false, setExpanded: () => {}, toggle: () => {} }),
      useGroupAction: () => ({ current: null }),
      usePresentation: (select: (policy: { settledReasoningPreview: boolean }) => unknown) =>
        select({ settledReasoningPreview: true }),
      renderMessageImages: () => null, t: (key: string) => key === 'message.think' ? 'Think' : key,
    }
    const html = renderToStaticMarkup(createElement(AssistantNodeView, props as never))
    expect((html.match(/data-variant="think"/g) ?? []).length).toBe(1)
    expect(html).toContain('A public reasoning summary.')
    expect(html).toContain('The visible answer.')
    expect(props.node.data.blocks).toHaveLength(18)
  })

})
