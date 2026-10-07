import { describe, expect, it, vi } from 'vitest'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { AccountModelDescriptor } from '../src/account-model-catalog.ts'
import { classifyTaskWithAdapter, taskClassifierModel } from '../src/auto-task-classifier.ts'
const model: AccountModelDescriptor = {
  id: 'synthetic-arbitrary', name: 'Arbitrary', category: 'lightweight', api: 'openai-responses',
  contextWindow: 64_000, maxTokens: 8000, input: ['text'],
  reasoning: { advertisedEfforts: [], unmappedEfforts: [] },
  evidence: { endpoints: ['/responses'], unsupportedEndpointCount: 0, selectedEndpoint: '/responses',
    apiSource: 'advertised-native', policySource: 'server-enabled', contextWindowSource: 'max_context_window_tokens' },
}
describe('concrete managed task classifier', () => {
  it('never starts an auxiliary adapter after cancellation during preparation', async () => {
    const controller = new AbortController()
    controller.abort(new Error('CANCELLED'))
    const stream = vi.fn()
    await expect(classifyTaskWithAdapter(model, { text: 'task', omitted: false }, controller.signal, stream))
      .rejects.toThrow('CANCELLED')
    expect(stream).not.toHaveBeenCalled()
  })
  it('selects only supplier lightweight candidates with bounded input/output headroom, never guessed names', () => {
    expect(taskClassifierModel([{ ...model, category: undefined }, { ...model, category: 'powerful' }])).toBeUndefined()
    expect(taskClassifierModel([{ ...model, contextWindow: 2000 }, model])).toBe(model)
    expect(taskClassifierModel([{ ...model, id: 'z' }, { ...model, id: 'a' }])?.id).toBe('a')
  })
  it('prefers advertised reasoning-off candidates without inferring latency or model-name capabilities', () => {
    const off = { ...model, id: 'z', reasoning: { advertisedEfforts: ['off'], unmappedEfforts: [] } }
    expect(taskClassifierModel([{ ...model, id: 'a' }, off])).toBe(off)
    expect(taskClassifierModel([{ ...off, category: 'powerful' }, model])).toBe(model)
    expect(taskClassifierModel([{ ...off, contextWindow: 2000 }, model])).toBe(model)
  })
  it('prefers an eligible unmarked classifier but preserves a marked-only pool', () => {
    const marked = { ...model, id: 'marked-off', reasoning: { advertisedEfforts: ['off'], unmappedEfforts: [] } }
    expect(taskClassifierModel([marked, model], [marked.id])).toBe(model)
    expect(taskClassifierModel([marked], [marked.id])).toBe(marked)
  })
  it('makes one concrete native call with no tools, history identity, fake purpose or recursive Auto', async () => {
    const stream = vi.fn(async function* (request: GenerateOptions): AsyncIterable<StreamChunk> {
      expect(request.model).toBe(model.id)
      expect(request.maxTokens).toBe(128)
      expect(request.tools).toBeUndefined()
      expect(request.sessionId).toBeUndefined()
      expect(request.purpose).toBeUndefined()
      expect(JSON.stringify(request.messages)).toContain('conversationData')
      yield { type: 'text-delta', index: 0, text: '{"demand":"routine","signals":[]}' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    })
    expect(await classifyTaskWithAdapter(model, { text: 'untrusted task', omitted: false },
      new AbortController().signal, stream)).toContain('"routine"')
    expect(stream).toHaveBeenCalledOnce()
  })
  it.each(['oversized', 'incomplete', 'truncated', 'tool'] as const)('rejects unusable native output without retry: %s', async kind => {
    const stream = vi.fn(async function* (): AsyncIterable<StreamChunk> {
      yield { type: 'text-delta', index: 0, text: kind === 'oversized' ? 'x'.repeat(2049) : '{}' }
      if (kind === 'truncated') yield { type: 'finish', reason: { kind: 'max-tokens' } }
      if (kind === 'tool') yield { type: 'finish', reason: { kind: 'tool-calls' } }
    })
    await expect(classifyTaskWithAdapter(model, { text: 'task', omitted: false },
      new AbortController().signal, stream)).rejects.toThrow()
    expect(stream).toHaveBeenCalledOnce()
  })
  it.each([{ efforts: [], nativeOff: true }, { efforts: ['high'], nativeOff: true },
    { efforts: ['off', 'high'], nativeOff: false }, { efforts: ['off', 'high'], nativeOff: true }])(
    'requests off reasoning only for matching supplier and published native support: $efforts/$nativeOff', async ({ efforts, nativeOff }) => {
      const observe = vi.fn()
      const output = '{"demand":"routine","signals":[]}'
      const stream = vi.fn(async function* (request: GenerateOptions): AsyncIterable<StreamChunk> {
        expect(request.reasoningEffort).toBe(efforts.includes('off') && nativeOff ? 'off' : undefined)
        yield { type: 'text-delta', index: 0, text: '' }
        yield { type: 'text-delta', index: 0, text: output }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })
      await classifyTaskWithAdapter({ ...model, reasoning: { advertisedEfforts: efforts, unmappedEfforts: [] } },
        { text: 'PRIVATE_TASK', omitted: false }, new AbortController().signal, stream, observe, nativeOff)
      expect(observe.mock.calls.map(([value]) => value)).toEqual([
        { stage: 'adapter-started' }, { stage: 'text', characters: 0 }, { stage: 'text', characters: output.length },
        { stage: 'finished', stopped: true },
      ])
      expect(JSON.stringify(observe.mock.calls)).not.toContain('PRIVATE_TASK')
    })
})
