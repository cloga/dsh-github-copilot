import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GenerateOptions, Message, StreamChunk } from '@deepseek-ai/dsh-llm'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { InlineConfig } from '../../src/config.ts'
import type { SearchPlanCandidate } from '../../src/plan.ts'
import { inlineStream } from '../../src/wire.ts'

const cfg: InlineConfig = { enabled: true, providers: [], includeSources: true, stripServerTools: true, idleTimeoutMs: 1_000, probe: false, probeTimeoutMs: 1_000 }
const candidate: SearchPlanCandidate = { protocol: 'openai-responses', baseURL: 'https://example.invalid', model: 'gpt-6-astra', apiKeyEnv: 'SYNTHETIC', apiVersion: '2023-06-01' }
const request: GenerateOptions = { provider: 'github-copilot', model: 'gpt-6-astra', messages: [] }
const hooks = { resolveApiKey: async () => 'synthetic-never-sent' }
const added = (index = 0) => ({ type: 'response.output_item.added', output_index: index, item: { type: 'reasoning', id: `rs_${index}` } })
const delta = (text: string, index = 0, part = 0) => ({ type: 'response.reasoning_summary_text.delta', output_index: index, summary_index: part, delta: text })
const done = (text: string, index = 0) => ({ type: 'response.output_item.done', output_index: index, item: { type: 'reasoning', id: `rs_${index}`, summary: [{ type: 'summary_text', text }] } })
const terminal = { type: 'response.completed', response: { status: 'completed' } }
const encode = (events: unknown[]) => events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('')
async function collect(events: unknown[], options = request): Promise<StreamChunk[]> {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(encode(events))))
  const chunks: StreamChunk[] = []
  for await (const chunk of inlineStream(options, candidate, hooks, cfg)) chunks.push(chunk)
  return chunks
}
function reasoning(chunks: StreamChunk[]): string[] {
  return chunks.flatMap(chunk => chunk.type === 'block-end' && chunk.block.type === 'reasoning' ? [chunk.block.text] : [])
}
function deltas(chunks: StreamChunk[]): string {
  return chunks.flatMap(chunk => chunk.type === 'reasoning-delta' ? [chunk.text] : []).join('')
}
afterEach(() => vi.unstubAllGlobals())

describe('Responses public reasoning stream', () => {
  it('rejects an explicit effort without a metadata resolver before sending a request', async () => {
    const chunks = await collect([terminal], { ...request, reasoningEffort: ReasoningEffortId('high') })
    expect(fetch).not.toHaveBeenCalled()
    expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'error', failure: { code: 'INVALID_REQUEST', message: expect.stringContaining('COPILOT_RESPONSES_REASONING_RESOLVER_REQUIRED') } } })
  })

  it('uses the resolved wire effort rather than guessing from the requested effort', async () => {
    const fetchMock = vi.fn(async () => new Response(encode([added(), delta('Summary.'), done('Summary.'), terminal])))
    vi.stubGlobal('fetch', fetchMock)
    const resolveResponsesReasoning = vi.fn(() => ({ effort: 'medium', summary: 'auto' as const }))
    const options = { ...request, reasoningEffort: ReasoningEffortId('high') }
    for await (const _chunk of inlineStream(options, candidate, { ...hooks, resolveResponsesReasoning }, cfg)) { /* drain */ }
    expect(resolveResponsesReasoning).toHaveBeenCalledWith(options, expect.objectContaining({ model: 'gpt-6-astra' }))
    const call = vi.mocked(fetch).mock.calls[0]
    const body = JSON.parse(String(call?.[1]?.body)) as Record<string, unknown>
    expect(body.reasoning).toEqual({ effort: 'medium', summary: 'auto' })
  })

  it('omits reasoning options when a resolver validates an off or default selection', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(encode([terminal])))
    vi.stubGlobal('fetch', fetchMock)
    const resolveResponsesReasoning = vi.fn(() => undefined)
    for await (const _chunk of inlineStream({ ...request, reasoningEffort: ReasoningEffortId('off') }, candidate, { ...hooks, resolveResponsesReasoning }, cfg)) { /* drain */ }
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).not.toHaveProperty('reasoning')
    expect(resolveResponsesReasoning).toHaveBeenCalledOnce()
  })

  it('refuses invalid capabilities without touching credentials or the network', async () => {
    const resolveApiKey = vi.fn(async () => 'synthetic-never-sent')
    const resolveResponsesReasoning = () => { throw new Error('COPILOT_REASONING_UNSUPPORTED_EFFORT') }
    vi.stubGlobal('fetch', vi.fn())
    const chunks: StreamChunk[] = []
    for await (const chunk of inlineStream(request, candidate, { resolveApiKey, resolveResponsesReasoning }, cfg)) chunks.push(chunk)
    expect(resolveApiKey).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
    expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'error', failure: { code: 'INVALID_REQUEST' } } })
  })

  it.each([
    ['COPILOT_RESPONSES_REASONING_UNSUPPORTED: PRIVATE_SETTINGS_VALUE', 'COPILOT_RESPONSES_REASONING_UNSUPPORTED'],
    ['settings service failed with PRIVATE_SETTINGS_VALUE', 'COPILOT_RESPONSES_REQUEST_UNSUPPORTED'],
  ])('reports only owned codes for resolver failures: %s', async (failure, code) => {
    const resolveResponsesReasoning = () => { throw new Error(failure) }
    vi.stubGlobal('fetch', vi.fn())
    const chunks: StreamChunk[] = []
    for await (const chunk of inlineStream(request, candidate, { ...hooks, resolveResponsesReasoning }, cfg)) chunks.push(chunk)
    expect(fetch).not.toHaveBeenCalled()
    expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'error', failure: { code: 'INVALID_REQUEST', message: code } } })
    expect(JSON.stringify(chunks)).not.toContain('PRIVATE_SETTINGS_VALUE')
  })

  it('refuses Core-owned reasoning history before resolving credentials or sending it', async () => {
    const resolveApiKey = vi.fn(async () => 'synthetic-never-sent')
    vi.stubGlobal('fetch', vi.fn())
    const history = { id: 'history' as Message['id'], role: 'assistant', content: [{ type: 'reasoning', text: 'Public summary, not a replay item.' }], source: { kind: 'user' } } as Message
    const chunks: StreamChunk[] = []
    for await (const chunk of inlineStream({ ...request, messages: [history] }, candidate, { resolveApiKey }, cfg)) chunks.push(chunk)
    expect(resolveApiKey).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
    expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'error', failure: { code: 'INVALID_REQUEST', message: expect.stringContaining('Core-owned') } } })
  })

  it('preserves public summary deltas without repeating done snapshots', async () => {
    const chunks = await collect([added(), delta('Public '), delta('summary.'),
      { type: 'response.reasoning_summary_text.done', output_index: 0, summary_index: 0, text: 'Public summary.' },
      { type: 'response.reasoning_summary_part.done', output_index: 0, summary_index: 0, part: { type: 'summary_text', text: 'Public summary.' } },
      done('Public summary.'), done('Public summary.'), terminal])
    expect(reasoning(chunks)).toEqual(['Public summary.'])
    expect(deltas(chunks)).toBe('Public summary.')
  })

  it('keeps interleaved reasoning items and answer output indices independent', async () => {
    const chunks = await collect([added(2),
      { type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'msg_0' } },
      added(4), delta('First ', 2), delta('Second.', 4),
      { type: 'response.output_text.delta', output_index: 0, delta: 'Answer.' },
      delta('summary.', 2), done('Second.', 4), done('First summary.', 2), terminal])
    expect(reasoning(chunks)).toEqual(['Second.', 'First summary.'])
    expect(chunks).toContainEqual(expect.objectContaining({ type: 'text-delta', text: 'Answer.' }))
    const starts = chunks.filter(chunk => chunk.type === 'block-start')
    expect(new Set(starts.map(chunk => chunk.index)).size).toBe(3)
  })

  it('uses done-only summary parts and separates them once', async () => {
    const chunks = await collect([added(),
      { type: 'response.reasoning_summary_part.done', output_index: 0, summary_index: 0, part: { type: 'summary_text', text: 'First.' } },
      { type: 'response.reasoning_summary_part.done', output_index: 0, summary_index: 0, part: { type: 'summary_text', text: 'First.' } },
      { type: 'response.reasoning_summary_text.done', output_index: 0, summary_index: 1, text: 'Second.' },
      { type: 'response.output_item.done', output_index: 0, item: { type: 'reasoning', summary: [{ type: 'summary_text', text: 'First.' }, { type: 'summary_text', text: 'Second.' }] } }, terminal])
    expect(reasoning(chunks)).toEqual(['First.\n\nSecond.'])
    expect(deltas(chunks)).toBe('First.\n\nSecond.')
  })

  it('buffers interleaved parts until they can be emitted in summary order', async () => {
    const chunks = await collect([added(), delta('Second.', 0, 1), delta('First ', 0, 0), delta('part.', 0, 0),
      { type: 'response.reasoning_summary_part.done', output_index: 0, summary_index: 0, part: { type: 'summary_text', text: 'First part.' } },
      { type: 'response.output_item.done', output_index: 0, item: { type: 'reasoning', summary: [{ type: 'summary_text', text: 'First part.' }, { type: 'summary_text', text: 'Second.' }] } }, terminal])
    expect(reasoning(chunks)).toEqual(['First part.\n\nSecond.'])
    expect(deltas(chunks)).toBe('First part.\n\nSecond.')
  })

  it('flushes buffered public parts on EOF without fabricating missing parts', async () => {
    const chunks = await collect([added(), delta('Received part only.', 0, 2)])
    expect(reasoning(chunks)).toEqual(['Received part only.'])
    expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'error' } })
  })

  it.each([true, false])('uses output-item done-only text with added=%s', async (withAdded) => {
    const chunks = await collect([...(withAdded ? [added()] : []), done('Only final summary.'), terminal])
    expect(reasoning(chunks)).toEqual(['Only final summary.'])
  })

  it('recovers summary only present in the final response output without duplicates', async () => {
    const item = { type: 'reasoning', id: 'rs_0', summary: [{ type: 'summary_text', text: 'Final summary.' }] }
    const chunks = await collect([added(), delta('Final '), { type: 'response.completed', response: { status: 'completed', output: [item] } }])
    expect(reasoning(chunks)).toEqual(['Final summary.'])
    expect(deltas(chunks)).toBe('Final summary.')
  })

  it('preserves raw reasoning text and deduplicates its done snapshot', async () => {
    const chunks = await collect([added(),
      { type: 'response.reasoning_text.delta', output_index: 0, content_index: 0, delta: 'Public raw text.' },
      { type: 'response.reasoning_text.done', output_index: 0, content_index: 0, text: 'Public raw text.' },
      { type: 'response.output_item.done', output_index: 0, item: { type: 'reasoning', content: [{ type: 'reasoning_text', text: 'Public raw text.' }] } }, terminal])
    expect(reasoning(chunks)).toEqual(['Public raw text.'])
    expect(deltas(chunks)).toBe('Public raw text.')
  })

  it('does not reset a streaming slot on repeated added events or accept late deltas', async () => {
    const chunks = await collect([added(), delta('Public '), added(), delta('summary.'), done('Public summary.'), delta('LATE'), terminal])
    expect(reasoning(chunks)).toEqual(['Public summary.'])
    expect(deltas(chunks)).toBe('Public summary.')
  })

  it.each(['Mirror.', 'Distinct summary.'])('retains a distinct secondary public representation but not an identical mirror: %s', async (summary) => {
    const chunks = await collect([added(),
      { type: 'response.reasoning_text.delta', output_index: 0, content_index: 0, delta: 'Mirror.' },
      delta(summary), done(summary), terminal])
    const expected = summary === 'Mirror.' ? 'Mirror.' : 'Mirror.\n\nDistinct summary.'
    expect(reasoning(chunks)).toEqual([expected])
    expect(deltas(chunks)).toBe(expected)
  })

  it('does not let whitespace from another representation hide a public summary', async () => {
    const chunks = await collect([added(), { type: 'response.reasoning_text.delta', output_index: 0, delta: '  ' }, delta('Summary.'), done('Summary.'), terminal])
    expect(reasoning(chunks)).toEqual(['Summary.'])
  })

  it('ignores malformed indices and fields rather than joining unrelated reasoning', async () => {
    const chunks = await collect([
      { ...delta('UNSCOPED'), output_index: undefined },
      { ...delta('NEGATIVE'), output_index: -1 },
      { ...delta('FRACTION'), output_index: 0.5 },
      added(), { ...delta('WRONG PART'), summary_index: -1 },
      { ...delta(''), delta: { private: 'NOT TEXT' } }, delta('Valid.'), done('Valid.'), terminal])
    expect(reasoning(chunks)).toEqual(['Valid.'])
    expect(deltas(chunks)).toBe('Valid.')
  })

  it('fails conflicting final snapshots without repeating or leaking their text', async () => {
    const chunks = await collect([added(), delta('Streamed.'), done('CONFLICTING TEXT'), terminal])
    expect(reasoning(chunks)).toEqual(['Streamed.'])
    expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'error', failure: { message: 'COPILOT_REASONING_SNAPSHOT_CONFLICT' } } })
    expect(JSON.stringify(chunks)).not.toContain('CONFLICTING TEXT')
  })

  it('does not display whitespace or encrypted-only reasoning', async () => {
    const chunks = await collect([added(), delta(' \n\t'),
      { type: 'response.output_item.done', output_index: 0, item: { type: 'reasoning', encrypted_content: 'SYNTHETIC_ENCRYPTED', summary: [] } },
      { type: 'response.completed', response: { status: 'completed', output: [{ type: 'reasoning', encrypted_content: 'SYNTHETIC_ENCRYPTED', summary: [] }] } }])
    expect(reasoning(chunks)).toEqual([])
    expect(deltas(chunks)).toBe('')
    expect(JSON.stringify(chunks)).not.toContain('SYNTHETIC_ENCRYPTED')
  })

  it.each(['response.failed', 'error', 'eof', 'response.incomplete'])('closes a nonempty reasoning block exactly once on %s', async (ending) => {
    const end = ending === 'eof' ? [] : [{ type: ending, response: { status: ending === 'response.incomplete' ? 'incomplete' : 'failed', incomplete_details: { reason: 'max_output_tokens' } } }]
    const chunks = await collect([added(), delta('Partial summary.'), ...end])
    expect(reasoning(chunks)).toEqual(['Partial summary.'])
    expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: ending === 'response.incomplete' ? 'max-tokens' : 'error' } })
  })

  it('closes a partial public summary on idle timeout', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url, init: RequestInit | undefined) => new Response(new ReadableStream({
      start(stream) {
        stream.enqueue(new TextEncoder().encode(encode([added(), delta('Partial before timeout.')])))
        init?.signal?.addEventListener('abort', () => stream.error(new Error('aborted')))
      },
    }))))
    const chunks: StreamChunk[] = []
    for await (const chunk of inlineStream(request, candidate, hooks, { ...cfg, idleTimeoutMs: 30 })) chunks.push(chunk)
    expect(reasoning(chunks)).toEqual(['Partial before timeout.'])
    expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'error', failure: { code: 'TIMEOUT' } } })
  })

  it('does not process buffered events after caller cancellation', async () => {
    const controller = new AbortController()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(encode([added(), delta('Partial.'), delta('AFTER ABORT'), terminal]))))
    const chunks: StreamChunk[] = []
    for await (const chunk of inlineStream({ ...request, signal: controller.signal }, candidate, hooks, cfg)) {
      chunks.push(chunk)
      if (chunk.type === 'reasoning-delta') controller.abort()
    }
    expect(reasoning(chunks)).toEqual(['Partial.'])
    expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'aborted' } })
    expect(JSON.stringify(chunks)).not.toContain('AFTER ABORT')
  })

  it('closes partial reasoning before an aborted finish', async () => {
    const controller = new AbortController()
    vi.stubGlobal('fetch', vi.fn(async (_url, init: RequestInit | undefined) => new Response(new ReadableStream({
      start(stream) {
        stream.enqueue(new TextEncoder().encode(encode([added(), delta('Partial summary.')])) )
        init?.signal?.addEventListener('abort', () => stream.error(new Error('aborted')))
      },
    }))))
    const chunks: StreamChunk[] = []
    for await (const chunk of inlineStream({ ...request, signal: controller.signal }, candidate, hooks, cfg)) {
      chunks.push(chunk)
      if (chunk.type === 'reasoning-delta') controller.abort()
    }
    expect(reasoning(chunks)).toEqual(['Partial summary.'])
    expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'aborted' } })
  })
})
