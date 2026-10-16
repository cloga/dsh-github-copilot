/** Candidate-only public artifact tests. No runtime admission, network, or Core writes. */
import { readFileSync } from 'node:fs'
import { findPackageJSON } from 'node:module'
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai'
import type { Model, SimpleStreamOptions } from '@earendil-works/pi-ai'
import { createDeveloperMessage, createUserMessage, ReasoningEffortId, resolveRetryPolicy, type ToolSchema } from '@deepseek-ai/dsh-llm'
import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'
import { Context } from '@deepseek-ai/cordis'
import { ToolRuntime, renderToolsSdk } from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { coreProviderView } from '../../src/pi-provider-bridge.ts'
import type { SimpleNativeProvider } from '../../src/pi-provider-bridge.ts'
import { filterCopilotToolAssembly } from '../../src/tool-schema-compat.ts'

const provider = 'candidate-fixture'
const model: Model<'openai-responses'> = {
  id: 'synthetic-dynamic-model', name: 'Synthetic dynamic model', provider,
  api: 'openai-responses', baseUrl: 'https://fixture.invalid',
  reasoning: true, thinkingLevelMap: { off: null, low: 'low', high: 'high' },
  contextWindow: 65536, maxTokens: 8192, input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  compat: { supportsMidConvoSystemMessages: true, supportsAdditionalTools: true },
}

beforeAll(() => {
  expect(['published-artifact-runtime', 'tagged-source-runtime']).toContain(process.env.DSH_CORE_EVIDENCE)
  expect(process.env.DSH_PUBLISHED_CORE_RELEASE).toBe('0.2.1-alpha.5')
  for (const name of ['@deepseek-ai/dsh-llm', '@deepseek-ai/dsh-llm-pi-ai']) {
    const path = findPackageJSON(name, import.meta.url)
    if (path === undefined) throw new Error('CANDIDATE_PACKAGE_IDENTITY_UNAVAILABLE')
    expect(JSON.parse(readFileSync(path, 'utf8')).version).toBe('0.2.1-alpha.5')
  }
})

function adapter(simple: SimpleNativeProvider['streamSimple'], streamIdleTimeoutMs = 1000) {
  const native: SimpleNativeProvider = {
    id: provider, name: 'Synthetic candidate', getModels: () => [model],
    auth: { apiKey: { name: 'Synthetic credential', resolve: async () => ({ auth: { apiKey: 'synthetic-key' } }) } },
    streamSimple: simple,
  }
  const profile = {
    provider, displayName: 'Synthetic candidate', piProvider: coreProviderView(native),
    streamIdleTimeoutMs, maxRequestImageBytes: 20971520,
    requestImagePixelBudget: 4194304, requestImageMaxBytes: 1048576,
    retryPolicy: resolveRetryPolicy(undefined, 'fixture'),
    configuredMaxTokens: new Map<string, number>(), modelErrors: new Map<string, string>(),
  }
  return new PiAiAdapter({
    profiles: () => new Map([[provider, profile]]), resolveApiKey: async () => 'synthetic-key',
    auth: {
      authContext: { env: async () => undefined, fileExists: async () => false },
      credentials: { read: async () => undefined, list: async () => [],
        modify: async () => undefined, delete: async () => undefined },
    },
  })
}

function complete() {
  const stream = createAssistantMessageEventStream()
  const message = {
    role: 'assistant' as const, content: [], api: model.api, provider, model: model.id,
    usage: { input: 1, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 1,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: 'stop' as const, timestamp: 0,
  }
  stream.push({ type: 'done', reason: 'stop', message })
  stream.end(message)
  return stream
}

function user(text: string) {
  return createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] })
}

describe('fixed alpha.5 public adapter and SDK contracts', () => {
  it('keeps native code-first PTC schema and runtime-specific SDK instructions intact', async () => {
    const ctx = new Context()
    try {
      new SystemPrompt(ctx, {})
      const tools = new ToolRuntime(ctx, { mode: 'ptc' })
      const schemas = tools.schemas()
      const native = schemas.find(tool => tool.name === 'run_code')
      expect(native).toBeDefined()
      expect(Object.keys(native!.parameters.properties ?? {}).slice(0, 2)).toEqual(['code', 'description'])
      expect(native!.parameters.required).toEqual(['code', 'description'])
      const filtered = filterCopilotToolAssembly({ variables: { provider: 'github-copilot' }, tools: schemas })
      expect(filtered.tools[0]!.description).toBe(schemas[0]!.description)
      expect(filtered.tools[0]!.parameters.required).toEqual(['code', 'description'])
      const functionBody = renderToolsSdk([], 'function-body')
      const repl = renderToolsSdk([], 'repl')
      expect(functionBody).toContain('the body of an async TypeScript function')
      expect(functionBody).toContain('return')
      expect(repl).not.toContain('the body of an async TypeScript function')
      expect(repl).toContain('Only values emitted as program output enter the conversation.')
    } finally {
      await ctx.dispose()
    }
  })

  it('preserves initial prompt, in-history system/tool updates and exact effort through the provider bridge', async () => {
    const simple = vi.fn<SimpleNativeProvider['streamSimple']>((_model, _context, _options) => complete())
    const native = adapter(simple)
    const prepared = await native.prepareCall(provider, model.id)
    expect(prepared.model).toMatchObject({ systemPromptUpdate: 'in-history', toolUpdate: 'addition-only' })
    const tools: ToolSchema[] = [{ name: 'late_tool', description: 'Synthetic deferred tool',
      parameters: { type: 'object', properties: {} }, deferLoading: true }]
    for await (const _chunk of prepared.stream({
      provider, model: model.id, system: 'Initial prompt', reasoningEffort: ReasoningEffortId('high'),
      messages: [user('Original task'), createDeveloperMessage({
        source: { kind: 'user' }, content: [{ type: 'text', text: 'Updated instruction' },
          { type: 'tool-addition', toolName: 'late_tool' }],
      }), user('Continue')], tools,
    })) { /* consume native output */ }
    expect(simple).toHaveBeenCalledTimes(1)
    const [, context, options] = simple.mock.calls[0]!
    expect(context.messages[0]).toMatchObject({ role: 'system', content: 'Initial prompt' })
    expect(context.messages).toContainEqual(expect.objectContaining({
      role: 'system', content: [{ type: 'text', text: 'Updated instruction' }],
      toolsAdded: [{ name: 'late_tool', description: 'Synthetic deferred tool',
        parameters: { type: 'object', properties: {} } }],
    }))
    expect(options).toMatchObject({ reasoning: 'high', maxRetries: 0 })
    expect(tools[0]!.deferLoading).toBe(true)
  })

  it('rejects undeclared dynamic tools before native provider dispatch', async () => {
    const simple = vi.fn(() => complete())
    const native = adapter(simple)
    const consume = async () => {
      for await (const _chunk of native.stream({ provider, model: model.id, messages: [createDeveloperMessage({
        source: { kind: 'user' }, content: [{ type: 'tool-addition', toolName: 'missing_tool' }],
      })] })) { /* consume native output */ }
    }
    await expect(consume()).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    expect(simple).not.toHaveBeenCalled()
  })

  it('settles native semantic timeout without waiting for an uncooperative event iterator', async () => {
    const never = createAssistantMessageEventStream()
    let dispatched: SimpleStreamOptions | undefined
    const simple = vi.fn<SimpleNativeProvider['streamSimple']>((_model, _context, options) => { dispatched = options; return never })
    const native = adapter(simple, 100)
    let timer: ReturnType<typeof setTimeout> | undefined
    const consume = async () => {
      for await (const _chunk of native.stream({ provider, model: model.id,
        messages: [user('Synthetic task')] })) { /* consume native output */ }
    }
    try {
      await expect(Promise.race([consume(), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('CANDIDATE_TIMEOUT_DID_NOT_SETTLE')), 2000)
      })])).rejects.toMatchObject({ code: 'TIMEOUT' })
      expect(simple).toHaveBeenCalledTimes(1)
      expect(dispatched?.signal?.aborted).toBe(true)
    } finally { clearTimeout(timer); never.end() }
  })
})
