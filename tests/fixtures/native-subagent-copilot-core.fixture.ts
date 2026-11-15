import '@earendil-works/pi-ai/api/openai-responses'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionController } from '@deepseek-ai/dsh-api-session-controller'
import { LlmAdapter, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import * as LlmPiAi from '@deepseek-ai/dsh-llm-pi-ai'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import type { SubagentRunEndInfo, SubagentRunInfo } from '@deepseek-ai/dsh-subagent'
import * as Spawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import * as ToolSubagent from '@deepseek-ai/dsh-tool-subagent'
import SubagentModelSelectionConfig from '@deepseek-ai/dsh-tool-subagent/model-selection-settings'
import { getSupportedThinkingLevels } from '@earendil-works/pi-ai'
import { githubCopilotProvider } from '@earendil-works/pi-ai/providers/github-copilot'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import * as GitHubCopilotPlugin from '../../src/index.ts'

const provider = 'github-copilot'
const parentProvider = 'fixture-parent'

function response(model: string) {
  const item = { type: 'message', id: 'message-1', role: 'assistant',
    content: [{ type: 'output_text', text: `finished ${model}` }] }
  const event = (type: string, data: object) => `data: ${JSON.stringify({ type, ...data })}\n\n`
  return new Response([
    event('response.created', { response: { id: 'response-1' } }),
    event('response.output_item.added', { output_index: 0, item }),
    event('response.output_text.delta', { output_index: 0, delta: `finished ${model}` }),
    event('response.output_item.done', { output_index: 0, item }),
    event('response.completed', { response: { status: 'completed', output: [item],
      usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 } } }),
  ].join(''), { headers: { 'content-type': 'text/event-stream' } })
}

it.each(['absent', 'enabled', 'disposed'] as const)('selects and concurrently dispatches native Copilot subagents with the plugin %s', async state => {
  expect(process.env.DSH_CORE_EVIDENCE).toBe('tagged-source-runtime')
  expect(process.env.DSH_PUBLISHED_CORE_RELEASE).toBe('0.2.2-rc.3')
  const model = githubCopilotProvider().getModels().find(entry => entry.api === 'openai-responses'
    && entry.reasoning && getSupportedThinkingLevels(entry).includes('low')
    && getSupportedThinkingLevels(entry).includes('high'))
  expect(model).toBeDefined()
  if (!model) throw new Error('NATIVE_COPILOT_REASONING_MODEL_UNAVAILABLE')
  const directory = await mkdtemp(join(tmpdir(), 'copilot-native-subagent-'))
  const ctx = new Context()
  const release = Promise.withResolvers<void>()
  const releaseCancellationPair = Promise.withResolvers<void>()
  const requests: Array<{ model: string; authorization: string | null; effort: unknown }> = []
  const signals: Array<AbortSignal | null | undefined> = []
  const started: SubagentRunInfo[] = []
  const completed: SubagentRunEndInfo[] = []
  ctx.on('subagent/start', info => { started.push(info) })
  ctx.on('subagent/end', info => { completed.push(info) })
  vi.stubGlobal('fetch', async (input: unknown, init?: RequestInit) => {
    if (!String(input).endsWith('/responses')) throw new Error('unexpected fixture request')
    const body = JSON.parse(String(init?.body)) as { model: string; reasoning?: { effort?: unknown } }
    requests.push({ model: body.model, authorization: new Headers(init?.headers).get('authorization'),
      effort: body.reasoning?.effort })
    signals.push(init?.signal)
    const gate = requests.length <= 2 ? release.promise : releaseCancellationPair.promise
    const signal = init?.signal
    if (!signal) throw new Error('fixture request has no cancellation signal')
    const aborted = Promise.withResolvers<never>()
    const onAbort = () => aborted.reject(new DOMException('Synthetic cancellation', 'AbortError'))
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) onAbort()
    try { await Promise.race([gate, aborted.promise]) }
    finally { signal.removeEventListener('abort', onAbort) }
    return response(body.model)
  })
  try {
    const registration = () => ctx.effect(() => () => {})
    ctx.provide('typert', {
      resources: { register: registration }, lookups: { configure: registration, register: registration },
      contexts: { configureHost: registration, registerHost: registration },
    })
    ctx.provide('fileUploads', { registerAgentResolver: registration })
    ctx.provide('credentials', {
      describeRecord: async (key: string) => ({ configured: key === 'llm-pi-ai/github-copilot', writable: true }),
      readRecord: async (key: string) => key === 'llm-pi-ai/github-copilot'
        ? { kind: 'grant', payload: { type: 'oauth', refresh: 'synthetic-refresh',
          access: 'synthetic-access', expires: Date.now() + 3_600_000, availableModelIds: [model.id] } }
        : undefined,
      listRecords: async () => [{ key: 'llm-pi-ai/github-copilot', kind: 'grant' }],
      modifyRecord: async () => { throw new Error('unexpected fixture credential mutation') },
      deleteRecord: async () => { throw new Error('unexpected fixture credential deletion') },
    })
    ctx.provide('settings', {
      configure: registration,
      describe: () => [
        { ns: 'github-copilot', revision: 1, value: { activeAccountId: 'canonical',
          continuationDefaultHistory: [{ enabled: true, changedAt: 1 }] } },
        { ns: 'llm-pi-ai', revision: 1, value: { providers: { [provider]: {} } } },
      ],
      mutate: async () => { throw new Error('unexpected fixture settings mutation') },
    })
    ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: parentProvider, model: parentProvider }) })
    await mountAgentLoopTestDependencies(ctx, { workingDirectory: true })
    ctx.provide('tokenMeter', { estimateMessage: () => 1, measure: () => ({ totalTokens: 1 }) })
    await ctx.plugin(LlmPiAi, { providers: { [provider]: {} } })
    if (state !== 'absent') {
      const plugin = ctx.plugin(GitHubCopilotPlugin, {
        enabled: true, providers: [], includeSources: true, stripServerTools: true,
        idleTimeoutMs: 300_000, probe: false, probeTimeoutMs: 30_000,
      })
      await plugin
      await vi.waitFor(() => expect(ctx.get('githubCopilotUsage')).toBeDefined())
      if (state === 'disposed') {
        await plugin.dispose()
        await vi.waitFor(() => expect(ctx.get('githubCopilotUsage')).toBeUndefined())
      }
    }
    ctx.llm.registerAdapter([parentProvider], new class extends LlmAdapter {
      async *stream(_options: GenerateOptions): AsyncGenerator<StreamChunk> {
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text: 'Parent received child result.' }
        yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Parent received child result.' } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      }
    })
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(JsonlSessionPersistence, { root: join(directory, 'sessions'), compression: 'none' })
    await ctx.plugin(SubagentRuntime)
    await ctx.plugin(Spawn, { providerName: 'spawn' })
    await ctx.plugin(ToolSubagent, { provider: 'spawn', modelSelection: true, modelDiscovery: true })
    await ctx.plugin(SubagentModelSelectionConfig, { enabled: true, allowedModels: [{ provider, model: model.id }] })
    const controller = new SessionController(ctx, { nativeOpen: false }, { canOpenPath: () => false })
    const catalog = await controller.modelCatalog()
    expect(catalog.groups.find(group => group.id === provider)?.models.map(entry => entry.id)).toContain(model.id)
    const { agent: parent } = await ctx.agents.create({
      sessionId: SessionId('native-copilot-subagent-parent'),
      agentOptions: { provider: parentProvider, model: parentProvider },
    })
    const discovery = await ctx.agents.withInitiator(parent, () => ctx.tools.execute({
      agent: parent, signal: new AbortController().signal,
      calls: [{ type: 'tool-call', id: ToolCallId('discover-native'), name: 'list_subagent_models',
        arguments: JSON.stringify({ provider }) }],
    }))
    const discoveryResult = discovery.results[0]!.result
    expect(discoveryResult.isError).toBe(false)
    expect(discoveryResult.content.filter(block => block.type === 'text').map(block => block.text).join(''))
      .toContain(`${provider}/${model.id}`)
    const call = (id: string, effort: 'low' | 'high', modelId = model.id) => ctx.agents.withInitiator(parent, () => ctx.tools.execute({
      agent: parent, signal: new AbortController().signal,
      calls: [{ type: 'tool-call', id: ToolCallId(id), name: 'subagent',
        arguments: JSON.stringify({ description: 'fixture child', prompt: `Handle ${id}.`,
          provider, model: modelId, reasoning_effort: effort }) }],
    }))
    const batches = await Promise.all([call('native-child-first', 'low'), call('native-child-second', 'high')])
    expect(batches).toHaveLength(2)
    for (const batch of batches) {
      expect(batch.results).toHaveLength(1)
      expect(batch.results[0]!.result.isError).toBe(false)
    }
    await vi.waitFor(() => expect(requests).toHaveLength(2), { timeout: 15_000 })
    expect(ctx.agents.list().filter(agent => agent.session.header.parentSession === parent.session.id)).toHaveLength(2)
    expect(signals).toHaveLength(2)
    expect(signals[0]).toBeTruthy()
    expect(signals[1]).toBeTruthy()
    expect(signals[0]).not.toBe(signals[1])
    release.resolve()
    do { await parent.whenIdle() } while (await ctx.subagents.waitForTreeWork(parent))
    expect(requests).toEqual(expect.arrayContaining([
      { model: model.id, authorization: 'Bearer synthetic-access', effort: model.thinkingLevelMap?.low ?? 'low' },
      { model: model.id, authorization: 'Bearer synthetic-access', effort: model.thinkingLevelMap?.high ?? 'high' },
    ]))
    expect(completed).toHaveLength(2)
    for (const info of completed) {
      expect(info.stopReason).toBe('completed')
      expect(info.lastAssistantMessage?.some(block =>
        block.type === 'text' && block.text === `finished ${model.id}`)).toBe(true)
    }

    expect((await call('native-child-cancelled', 'low')).results[0]!.result.isError).toBe(false)
    await vi.waitFor(() => expect(requests).toHaveLength(3), { timeout: 15_000 })
    const cancelledId = started.at(-1)!.id
    const cancelledChild = ctx.agents.list().find(agent => agent.session.id === cancelledId)
    expect(cancelledChild).toBeDefined()
    expect((await call('native-child-survivor', 'high')).results[0]!.result.isError).toBe(false)
    await vi.waitFor(() => expect(requests).toHaveLength(4), { timeout: 15_000 })
    const survivorId = started.at(-1)!.id
    expect(survivorId).not.toBe(cancelledId)
    expect(signals[2]).not.toBe(signals[3])
    cancelledChild!.cancel({ kind: 'user' })
    await vi.waitFor(() => expect(signals[2]?.aborted).toBe(true))
    expect(signals[3]?.aborted).toBe(false)
    releaseCancellationPair.resolve()
    do { await parent.whenIdle() } while (await ctx.subagents.waitForTreeWork(parent))
    expect(completed.find(info => info.id === cancelledId)?.stopReason).toBe('aborted')
    expect(completed.find(info => info.id === survivorId)).toMatchObject({
      stopReason: 'completed',
      lastAssistantMessage: expect.arrayContaining([expect.objectContaining({ type: 'text', text: `finished ${model.id}` })]),
    })
    expect(requests).toHaveLength(4)
    expect(requests.slice(2).every(request => request.authorization === 'Bearer synthetic-access')).toBe(true)
    const unauthorized = (await call('native-child-unauthorized', 'low', 'fixture-unauthorized')).results[0]!.result
    expect(unauthorized.isError).toBe(true)
    expect(unauthorized.content.filter(block => block.type === 'text').map(block => block.text).join(''))
      .toContain('is not allowed for this Session')
    expect(requests).toHaveLength(4)
  } finally {
    release.resolve()
    releaseCancellationPair.resolve()
    try { await ctx.fiber.dispose() }
    finally {
      try { await rm(directory, { recursive: true, force: true }) }
      finally { vi.unstubAllGlobals() }
    }
  }
}, 30_000)
