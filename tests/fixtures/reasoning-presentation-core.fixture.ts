// @vitest-environment jsdom
// Executed inside an exact Core checkout by verify-reasoning-presentation.mjs.
// Native Markdown resolves local media against window.location on Core 0.1.5.
import { Context } from '@deepseek-ai/cordis'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { ConversationEventRegistry, ConversationViewRegistry, ConversationNodeAssembler } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { AssistantNodeView } from '../../ui-chat/src/client/chat/AssistantNodeView.tsx'
import { ASSISTANT_ORIGIN_KEY, assistantOriginDefinition, installReasoningPresentation, projectReasoningPresentation } from '__COPILOT_REASONING_MODULE__'

const event = (seq: number, type: string, data: object) => ({
  type: 'event' as const, event: { seq, time: 1700000000000 + seq, type, data, surfaceOp: 'append' as const },
})
const reply = (provider = 'github-copilot') => event(2, 'assistant/message', {
  turn: 1, step: 1,
  message: { role: 'assistant', source: { kind: 'model', provider, model: 'fixture-model' }, content: [] },
})
const prefix = [event(0, 'turn/start', { turn: 1 }), event(1, 'step/start', { turn: 1, step: 1 })]

describe('Copilot reasoning presentation against real Core services', () => {
  it('renders answers and public summaries without the fifteen empty native Think rows', () => {
    const blocks = [
      ...Array.from({ length: 15 }, () => Object.freeze({ kind: 'reasoning', text: '' })),
      Object.freeze({ kind: 'reasoning', text: 'A public reasoning summary.' }),
      Object.freeze({ kind: 'text', text: 'The visible answer.' }),
    ]
    const props = {
      node: { kind: 'assistant-step', location: { kind: 'unresolved' }, data: { status: 'settled', step: 1, finalNode: { seq: 2 }, blocks } },
      useTurnData: () => undefined, openFile: () => {}, fileMentions: () => [],
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
