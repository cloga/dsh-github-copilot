import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { scopeTarget } from '@deepseek-ai/dsh-scope'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { sessionFormatCatalog } from '@deepseek-ai/dsh-session-format-catalog'
import { describe, expect, it, vi } from 'vitest'
import type { AccountModelDescriptor } from '../src/account-model-catalog.ts'
import { installAutoModelRouting } from '../src/auto-model-host.ts'
import {
  GITHUB_COPILOT_AUTO_MODEL_ID as AUTO, GITHUB_COPILOT_AUTO_EFFICIENCY_MODEL_ID as EFFICIENCY,
  GITHUB_COPILOT_AUTO_INTELLIGENCE_MODEL_ID as INTELLIGENCE, GITHUB_COPILOT_PREVIEW_PROVIDER_ID as PREVIEW,
} from '../src/copilot-identity.ts'

function model(id: string, contextWindow: number, effort: string): AccountModelDescriptor {
  return {
    id,
    name: id,
    api: 'openai-responses',
    contextWindow,
    maxTokens: Math.floor(contextWindow / 4),
    input: ['text'],
    reasoning: { advertisedEfforts: [effort], unmappedEfforts: [] },
    evidence: {
      endpoints: ['/responses'],
      unsupportedEndpointCount: 0,
      selectedEndpoint: '/responses',
      apiSource: 'advertised-native',
      policySource: 'server-enabled',
      contextWindowSource: 'max_context_window_tokens',
    },
  }
}

function message(text: string) {
  return createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
}

describe('Auto model Host integration', () => {
  it('cold-reads Auto selection through the official format reader without plugin vocabulary', async () => {
    const ctx = new Context()
    const id = SessionId('fixture-auto-cold-read')
    const session = Session.create(id, [], {
      version: 4, id, createdAt: 1, isSeeded: false, delegationDepth: 0,
    })
    const agent = { ctx, session } as unknown as Agent
    const scope = scopeTarget(agent, agent)
    ctx.provide('sessionProjections', { stateOf: () => ({ pending: null }) } as never)
    const dispose = installAutoModelRouting(ctx, {
      async loadModels() { return [model('fixture-real', 128_000, 'medium')] },
    })
    ctx.emit(scope, 'agent/created', { agent, source: 'startup' })
    const signal = new AbortController().signal
    try {
      const messages = [message('Short question.')]
      await ctx.waterfall(scope, 'agent/pre-step', { agent, messages, turn: 1, step: 1, signal },
        async () => ({ kind: 'enter' as const, messages }))
      await expect(ctx.waterfall(scope, 'agent/request', { agent, turn: 1, step: 1, signal },
        async () => ({ provider: PREVIEW, model: AUTO }))).resolves.toMatchObject({ model: 'fixture-real' })
      const header = JSON.parse(JSON.stringify(session.header))
      const reader = sessionFormatCatalog.createRestore(sessionFormatCatalog.encodeCurrentHeader(header, 0), {
        recovery: 'strict', validation: 'current',
      })
      for (const event of session.snapshotEvents()) {
        reader.decodeRow(sessionFormatCatalog.encodeCurrentEvent(JSON.parse(JSON.stringify(event))))
      }
      const restored = reader.finish()
      expect(restored.events.map(event => event.type)).toEqual(['session/end-seed', 'model/selection'])
      expect(restored.events[1]?.data).toEqual({ provider: PREVIEW, model: AUTO })
    } finally {
      dispose()
      await ctx.fiber.dispose()
    }
  })

  it('persists a virtual preference across turns and yields to an explicit fixed selection', async () => {
    const ctx = new Context()
    const selection: { pending: { provider: string; model: string } | null } = { pending: null }
    let header: { config: { provider: string; model: string } } | undefined
    const append = vi.fn((type: string, data: { provider: string; model: string }) => {
      if (type === 'model/selection') selection.pending = data
    })
    const agent = { ctx, session: { append, requestHeader: () => header } } as unknown as Agent
    const scope = scopeTarget(agent, agent)
    const promptScope = scopeTarget(new SystemPrompt(ctx, {}), agent)
    const loadModels = vi.fn(async () => [
      model('fixture-fast', 64_000, 'low'), model('fixture-middle', 128_000, 'medium'), model('fixture-strong', 256_000, 'high'),
    ])
    ctx.provide('sessionProjections', { stateOf: () => selection } as never)
    const dispose = installAutoModelRouting(ctx, { loadModels })
    ctx.emit(scope, 'agent/created', { agent, source: 'startup' })
    const signal = new AbortController().signal
    const enter = async (turn: number, text: string) => {
      const messages = [message(text)]
      await ctx.waterfall(scope, 'agent/pre-step', { agent, messages, turn, step: 1, signal },
        async () => ({ kind: 'enter' as const, messages }))
    }
    const request = (turn: number, id: string) => ctx.waterfall(scope, 'agent/request',
      { agent, turn, step: 1, signal }, async () => ({ provider: PREVIEW, model: id }))
    try {
      await enter(1, 'Short.')
      const first = await request(1, INTELLIGENCE)
      expect(first.model).toBe('fixture-middle')
      expect(selection.pending?.model).toBe(INTELLIGENCE)
      expect(ctx.githubCopilotTurnSelection.get(agent, 1)).toMatchObject({
        mode: 'auto', preference: 'intelligence', reason: 'short-text-turn', candidateCount: 3,
      })
      header = { config: first }
      const assembly = { sections: [], contexts: [], tools: [], variables: { provider: PREVIEW, model: first.model } }
      const assembled = await ctx.waterfall(promptScope, 'system-prompt/assemble', assembly, {}, async () => assembly)
      expect(assembled.variables).toMatchObject({ provider: PREVIEW, model: INTELLIGENCE })
      await enter(2, 'detail '.repeat(1_000))
      expect((await request(2, first.model)).model).toBe('fixture-strong')
      expect(selection.pending?.model).toBe(INTELLIGENCE)
      selection.pending = { provider: PREVIEW, model: EFFICIENCY }
      await enter(3, 'detail '.repeat(1_000))
      expect((await request(3, EFFICIENCY)).model).toBe('fixture-middle')
      expect(selection.pending?.model).toBe(EFFICIENCY)
      selection.pending = { provider: PREVIEW, model: 'fixture-fast' }
      await enter(4, 'detail '.repeat(1_000))
      expect((await request(4, 'fixture-fast')).model).toBe('fixture-fast')
      expect(loadModels).toHaveBeenCalledTimes(3)
      expect(ctx.githubCopilotTurnSelection.get(agent, 4)).toEqual({ mode: 'manual' })
      expect(ctx.githubCopilotTurnSelection.get(agent, 1)).toMatchObject({ mode: 'auto', preference: 'intelligence' })
      expect(append.mock.calls.some(([type]) => type === 'github-copilot/auto-model-decision')).toBe(false)
    } finally {
      dispose()
      await ctx.fiber.dispose()
    }
  })
  it('keeps a default Auto selection across turns until a manual model choice', async () => {
    const ctx = new Context()
    const selection: { pending: { provider: string; model: string } | null } = { pending: null }
    let header: { config: { provider: string; model: string } } | undefined
    const append = vi.fn((type: string, data: { provider: string; model: string }) => {
      if (type === 'model/selection') selection.pending = data
    })
    const agent = { ctx, session: { append, requestHeader: () => header } } as unknown as Agent
    const scope = scopeTarget(agent, agent)
    const promptScope = scopeTarget(new SystemPrompt(ctx, {}), agent)
    ctx.provide('sessionProjections', { stateOf: () => selection } as never)
    ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: PREVIEW, model: AUTO }) } as never)
    const loadModels = vi.fn(async () => [
      model('fixture-fast', 64_000, 'low'),
      model('fixture-strong', 256_000, 'high'),
    ])
    const dispose = installAutoModelRouting(ctx, { loadModels })
    ctx.emit(scope, 'agent/created', { agent, source: 'startup' })
    const signal = new AbortController().signal
    const enter = (turn: number, text: string) => {
      const messages = [message(text)]
      return ctx.waterfall(scope, 'agent/pre-step', { agent, messages, turn, step: 1, signal },
        async () => ({ kind: 'enter' as const, messages }))
    }
    const request = (turn: number, modelId: string) => ctx.waterfall(scope, 'agent/request',
      { agent, turn, step: 1, signal }, async () => ({ provider: PREVIEW, model: modelId }))
    try {
      await enter(1, 'Short question.')
      const first = await request(1, AUTO)
      expect(first.model).toBe('fixture-fast')
      expect(selection.pending).toEqual({ provider: PREVIEW, model: AUTO })
      expect(append.mock.calls.filter(([type]) => type === 'model/selection')).toHaveLength(1)
      header = { config: { provider: PREVIEW, model: first.model } }

      const assembly = { sections: [], contexts: [], tools: [], variables: { provider: PREVIEW, model: first.model } }
      const assembled = await ctx.waterfall(promptScope, 'system-prompt/assemble', assembly, {},
        async () => assembly)
      expect(assembled.variables).toMatchObject({ provider: PREVIEW, model: AUTO })
      await enter(2, 'detail '.repeat(1_000))
      const second = await request(2, first.model)
      expect(second.model).toBe('fixture-strong')
      expect(selection.pending).toEqual({ provider: PREVIEW, model: AUTO })
      expect(append.mock.calls.filter(([type]) => type === 'model/selection')).toHaveLength(1)

      selection.pending = { provider: PREVIEW, model: 'fixture-fast' }
      const manualAssembly = { ...assembly, variables: { provider: PREVIEW, model: 'fixture-fast' } }
      const manual = await ctx.waterfall(promptScope, 'system-prompt/assemble', manualAssembly, {},
        async () => manualAssembly)
      expect(manual.variables).toMatchObject({ provider: PREVIEW, model: 'fixture-fast' })
      await enter(3, 'detail '.repeat(1_000))
      await expect(request(3, 'fixture-fast')).resolves.toMatchObject({ model: 'fixture-fast' })
      selection.pending = null
      header = { config: { provider: PREVIEW, model: 'fixture-fast' } }
      const existing = await ctx.waterfall(promptScope, 'system-prompt/assemble', manualAssembly, {},
        async () => manualAssembly)
      expect(existing.variables).toMatchObject({ provider: PREVIEW, model: 'fixture-fast' })
      await enter(4, 'detail '.repeat(1_000))
      await expect(request(4, 'fixture-fast')).resolves.toMatchObject({ model: 'fixture-fast' })
      expect(ctx.githubCopilotTurnSelection.get(agent, 3)).toEqual({ mode: 'manual' })
      expect(ctx.githubCopilotTurnSelection.get(agent, 4)).toEqual({ mode: 'unknown' })
      expect(loadModels).toHaveBeenCalledTimes(2)
    } finally {
      dispose()
      await ctx.fiber.dispose()
    }
  })

  it('resolves after downstream model selection and freezes one decision per turn', async () => {
    const ctx = new Context()
    const append = vi.fn()
    const agent = { ctx, session: { append, requestHeader: () => undefined } } as unknown as Agent
    const scope = scopeTarget(agent, agent)
    const loadModels = vi.fn(async () => [
      model('fixture-fast', 64_000, 'low'),
      model('fixture-strong', 256_000, 'high'),
    ])
    const dispose = installAutoModelRouting(ctx, { loadModels })
    ctx.emit(scope, 'agent/created', { agent, source: 'startup' })
    ctx.on('agent/request', async (_payload, next) => ({ ...await next(), provider: PREVIEW, model: AUTO }))
    const signal = new AbortController().signal
    const enter = async (turn: number, text: string) => {
      const messages = [message(text)]
      return ctx.waterfall(scope, 'agent/pre-step', { agent, messages, turn, step: 1, signal },
        async () => ({ kind: 'enter' as const, messages }))
    }
    const request = (turn: number, step = 1) => ctx.waterfall(scope, 'agent/request',
      { agent, turn, step, signal }, async () => ({ provider: 'fixture-seed', model: 'fixture-seed' }))
    try {
      await enter(1, 'Explain this symbol.')
      await expect(request(1)).resolves.toMatchObject({ provider: PREVIEW, model: 'fixture-fast' })
      await enter(1, 'detail '.repeat(1_000))
      await expect(request(1, 2)).resolves.toMatchObject({ provider: PREVIEW, model: 'fixture-fast' })
      expect(loadModels).toHaveBeenCalledTimes(1)

      await enter(2, 'detail '.repeat(1_000))
      await expect(request(2)).resolves.toMatchObject({ provider: PREVIEW, model: 'fixture-strong' })
      expect(loadModels).toHaveBeenCalledTimes(2)
      // Optional attribution must not add unknown required events to the durable log.
      expect(append).not.toHaveBeenCalled()
    } finally {
      dispose()
      await ctx.fiber.dispose()
    }
  })

  it('replaces Core virtual-Auto switch guidance with the resolved real route', async () => {
    const ctx = new Context()
    const previous = { provider: PREVIEW, model: 'fixture-previous' }
    const append = vi.fn()
    const agent = { ctx, session: { append, requestHeader: () => ({ config: previous }) } } as unknown as Agent
    const scope = scopeTarget(agent, agent)
    ctx.provide('sessionProjections', {
      stateOf: () => ({ lastUsed: previous, pending: { provider: PREVIEW, model: AUTO } }),
    } as never)
    // Core installs this agent-scoped prepended listener during setup.
    ctx.on('agent/pre-step', async (_payload, next) => {
      const result = await next()
      if (result.kind === 'reject') return result
      return { ...result, messages: [...result.messages, createUserMessage({
        content: [{ type: 'text',
          text: '[model changed: assistant turns above this point were generated by fixture-previous; the session continues with auto]' }],
        source: { kind: 'model-selection', form: 'notice', summary: 'fixture-previous → auto' as never },
      })] }
    }, { prepend: true })
    const dispose = installAutoModelRouting(ctx, {
      async loadModels() { return [model('fixture-resolved', 128_000, 'medium')] },
    })
    ctx.emit(scope, 'agent/created', { agent, source: 'startup' })
    const signal = new AbortController().signal
    try {
      const input = [message('Continue.')]
      const result = await ctx.waterfall(scope, 'agent/pre-step',
        { agent, messages: input, turn: 1, step: 1, signal },
        async () => ({ kind: 'enter' as const, messages: input }))
      expect(result).toMatchObject({ kind: 'enter' })
      if (result.kind !== 'enter') throw new Error('expected enter')
      const text = result.messages.flatMap(item => item.content)
        .filter(block => block.type === 'text').map(block => block.text)
      expect(text).not.toContain(expect.stringContaining('continues with auto'))
      expect(text).toContain(
        '[model changed: assistant turns above this point were generated by fixture-previous; the session continues with fixture-resolved]',
      )
    } finally {
      dispose()
      await ctx.fiber.dispose()
    }
  })

  it('keeps input-fit routing without persisting an optional decision event', async () => {
    const ctx = new Context()
    const append = vi.fn()
    const agent = { ctx, session: { id: 'test-session-123', append, requestHeader: () => undefined } } as unknown as Agent
    const scope = scopeTarget(agent, agent)
    const loadModels = vi.fn(async () => [
      model('fixture-fast', 64_000, 'low'),
      model('fixture-strong', 256_000, 'high'),
    ])
    const dispose = installAutoModelRouting(ctx, { loadModels })
    ctx.emit(scope, 'agent/created', { agent, source: 'startup' })
    const signal = new AbortController().signal
    try {
      const messages = [message('Explain this symbol.')]
      await ctx.waterfall(scope, 'agent/pre-step', { agent, messages, turn: 1, step: 1, signal },
        async () => ({ kind: 'enter' as const, messages }))
      const resolved = await ctx.waterfall(scope, 'agent/request', { agent, turn: 1, step: 1, signal },
        async () => ({ provider: PREVIEW, model: AUTO }))

      expect(resolved).toMatchObject({ provider: PREVIEW, model: 'fixture-fast' })
      expect(loadModels).toHaveBeenCalledOnce()
      expect(append).not.toHaveBeenCalled()
    } finally {
      dispose()
      await ctx.fiber.dispose()
    }
  })

  it('preserves concrete child teammate route without relabeling as Auto', async () => {
    const ctx = new Context()
    const append = vi.fn()
    // Child agent spawned with a concrete model snapshot from parent
    const childAgent = {
      ctx,
      session: { id: 'child-session-456', append, requestHeader: () => ({ config: { provider: PREVIEW, model: 'fixture-concrete' } }) },
    } as unknown as Agent
    const scope = scopeTarget(childAgent, childAgent)
    const promptScope = scopeTarget(new SystemPrompt(ctx, {}), childAgent)
    const loadModels = vi.fn(async () => [model('fixture-concrete', 128_000, 'medium')])
    const dispose = installAutoModelRouting(ctx, { loadModels })
    ctx.emit(scope, 'agent/created', { agent: childAgent, source: 'startup' })
    const signal = new AbortController().signal
    try {
      const messages = [message('Perform teammate work.')]
      await ctx.waterfall(scope, 'agent/pre-step', { agent: childAgent, messages, turn: 1, step: 1, signal },
        async () => ({ kind: 'enter' as const, messages }))

      // Child agent request with its concrete model
      const requested = await ctx.waterfall(scope, 'agent/request', { agent: childAgent, turn: 1, step: 1, signal },
        async () => ({ provider: PREVIEW, model: 'fixture-concrete' }))
      expect(requested.model).toBe('fixture-concrete')

      // System prompt variables must not be rewritten to Auto
      const assembly = { sections: [], contexts: [], tools: [], variables: { provider: PREVIEW, model: 'fixture-concrete' } }
      const assembled = await ctx.waterfall(promptScope, 'system-prompt/assemble', assembly, {}, async () => assembly)
      expect(assembled.variables.model).toBe('fixture-concrete')

      // No auto-model-decision event emitted for concrete model
      const decisions = append.mock.calls.filter(([type]) => type === 'github-copilot/auto-model-decision')
      expect(decisions).toHaveLength(0)
    } finally {
      dispose()
      await ctx.fiber.dispose()
    }
  })
})
