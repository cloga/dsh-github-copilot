import { Context } from '@deepseek-ai/cordis'
import Agents from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import BasicCompaction from '@deepseek-ai/dsh-compaction-basic'
import Llm, { LlmAdapter, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import Projections from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import Tools from '@deepseek-ai/dsh-tools'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Group from '@deepseek-ai/cordis-plugin-group'
import AgentPresets from '@deepseek-ai/dsh-agent-preset-registry'
import { test, expect, vi, beforeAll } from 'vitest'
import { installCopilotCompactionPressure } from '../../src/compaction-pressure.ts'
import ManualRecovery from '../../src/manual-compaction-recovery.ts'

const provider = 'github-copilot-preview'
beforeAll(() => {
  expect(process.env.DSH_CORE_EVIDENCE).toBe('tagged-source-runtime')
  expect(process.env.DSH_PUBLISHED_CORE_RELEASE).toBe('0.2.0-rc.2')
})

test.each([
  { manual: false, cancel: false }, { manual: true, cancel: false },
  { manual: false, cancel: true }, { manual: true, cancel: true },
])('global pressure finds isolated preset recovery: %j', async ({ manual, cancel }) => {
  const root = new Context()
  const forbiddenFetch = vi.fn(() => { throw new Error('Fixture network forbidden') })
  vi.stubGlobal('fetch', forbiddenFetch)
  try {
    await root.plugin(Llm)
    await root.plugin(SessionStore)
    await root.plugin(Projections)
    await root.plugin(SystemPrompt, {})
    await root.plugin(Tools, {})
    await root.plugin(Agents)
    await root.plugin(AgentLoop, { agents: [] })
    await root.plugin(TokenMeter)
    await root.plugin(Loader)
    root.loader.builtins.group = Group
    root.loader.internal = {
      version: 'v2',
      async import(name: string) {
        if (name === 'fixture-compaction') return manual ? ManualRecovery : BasicCompaction
        throw new Error(`Unexpected fixture plugin: ${name}`)
      },
    } as unknown as NonNullable<typeof root.loader.internal>
    await root.plugin(AgentPresets, { default: 'enabled' })
    const policy = { auto: true, thresholdRatio: 1, retainTokens: 100, maxTokens: 8192,
      compactionRetries: 0, maxOverflowRetries: 1 }
    const presetIds = ['enabled', 'disabled', 'no-retries', 'absent']
    for (const id of presetIds) {
      await root.agentPresets.register({ id, plugins: [{
        name: 'cordis:group', group: true, isolate: { compaction: true },
        config: id === 'absent' ? [] : [{ name: 'fixture-compaction',
          config: { ...policy, auto: id !== 'disabled', maxOverflowRetries: id === 'no-retries' ? 0 : 1 } }],
      }] })
    }
    const observations: { sessionId: GenerateOptions['sessionId']; purpose: GenerateOptions['purpose']; text: string }[] = []
    const summaryStarted = Promise.withResolvers<void>()
    class Adapter extends LlmAdapter {
      override async resolveModel(route: string, model: string): Promise<LlmResolvedModelInfo> {
        return { provider: route, id: model, name: model, context: { contextWindow: 100000 }, defaultMaxTokens: 8192 }
      }
      override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
        observations.push({ sessionId: options.sessionId, purpose: options.purpose,
          text: options.messages.flatMap(message => message.content.flatMap(block => block.type === 'text' ? [block.text] : [])).join('\n') })
        if (options.purpose === 'compaction') {
          summaryStarted.resolve()
          const signal = options.signal
          if (cancel && !signal?.aborted) {
            if (signal === undefined) throw new Error('Expected native summary cancellation signal')
            await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }))
          }
        }
        if (options.signal?.aborted) {
          yield { type: 'finish', reason: { kind: 'aborted', failure: { code: 'ABORTED', message: 'Fixture cancelled' } } }
          return
        }
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'block-end', index: 0, block: { type: 'text', text: options.purpose === 'compaction' ? 'CHECKPOINT' : 'REPLY' } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      }
    }
    root.llm.registerAdapter([provider], new Adapter())
    root.provide('githubCopilotPreview', {
      getView: () => ({ provider }),
      recoveryLimits: () => ({
        api: 'openai-responses',
        limits: { contextWindow: 100000, maxInputTokens: 80000, maxTokens: 8192 },
        policy: { safetyTokens: 0 }, assertCurrent: () => {},
      }),
    })
    let pressure = false
    installCopilotCompactionPressure(root, {
      resolve: () => pressure ? { inputBudgetTokens: 1000 } : undefined,
    })
    const ids = presetIds.map(value => SessionId(`isolated-pressure-${value}`))
    const events = new Map<SessionId, SessionEvent[]>(ids.map(id => [id, []]))
    root.on('session/event', (session, event) => events.get(session.id)?.push(event))
    const handles = await Promise.all(presetIds.map((preset, index) =>
      root.agents.create({ sessionId: ids[index]!, agentOptions: { provider, model: 'fixture', maxTokens: 8192 },
        setup: async ctx => { await root.agentPresets.mount(ctx, preset) },
      })))
    const agents = handles.map(handle => handle.agent)
    expect(root.get('compaction')).toBeUndefined()
    for (const [index, agent] of agents.entries()) {
      expect(agent.ctx.get('compaction')).toBeUndefined()
      const engine = root.agentPresets.serviceFor(agent, 'compaction')
      expect(engine === undefined ? undefined : engine instanceof BasicCompaction && engine.config.auto).toBe(index === 3 ? undefined : index !== 1)
      if (engine instanceof BasicCompaction) {
        expect(engine.config).toMatchObject({ ...policy, auto: index !== 1, maxOverflowRetries: index === 2 ? 0 : 1 })
        expect(engine.config).not.toHaveProperty('automaticRecovery')
      }
      root.agents.withInitiator(agent, () => {
        const current = root.agentPresets.serviceFor(root.agents.requireInitiator(), 'compaction')
        expect(current === undefined ? undefined : current instanceof BasicCompaction && current.config.auto).toBe(index === 3 ? undefined : index !== 1)
      })
    }
    const send = async (agent: Agent, text: string) => {
      agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
      await agent.whenIdle()
    }
    await Promise.all(agents.map(agent => send(agent, `OLD ${'historical detail '.repeat(1000)}`)))
    for (const agent of agents) expect(root.tokenMeter.measure(agent.session).totalTokens).toBeGreaterThan(1000)
    pressure = true
    const generations = agents.map(agent => agent.session.surface.replaceGeneration)
    const running = Promise.all(agents.map(agent => send(agent, 'CURRENT')))
    if (cancel) {
      await Promise.race([summaryStarted.promise, running.then(() => { throw new Error('Expected cancellable summary') })])
      agents[0]!.cancel({ kind: 'user' })
    }
    await running
    expect(events.get(ids[0]!)!.filter(event => event.type === 'compaction/summary')).toHaveLength(cancel ? 0 : 1)
    if (cancel) expect(agents[0]!.session.surface.replaceGeneration).toBe(generations[0])
    else expect(agents[0]!.session.surface.replaceGeneration).toBeGreaterThan(generations[0]!)
    for (const id of ids.slice(1)) expect(events.get(id)!.filter(event => event.type === 'compaction/summary')).toHaveLength(0)
    for (const [index, id] of ids.entries()) expect(events.get(id)!.at(-1)).toMatchObject({
      type: 'turn/end', data: { reason: { kind: index === 0 && cancel ? 'aborted' : 'completed' } },
    })
    expect(observations.filter(item => item.purpose === 'compaction')).toHaveLength(1)
    const conversation = observations.filter(item => item.sessionId === ids[0] && item.purpose === undefined)
    expect(conversation).toHaveLength(cancel ? 1 : 2)
    if (!cancel) {
      expect(conversation[1]!.text).toContain('CHECKPOINT')
      expect(conversation[1]!.text).toContain('CURRENT')
      expect(conversation[1]!.text).not.toContain('historical detail')
    }
    expect(forbiddenFetch).not.toHaveBeenCalled()
  } finally {
    try { await root.fiber.dispose() }
    finally { vi.unstubAllGlobals() }
  }
})
