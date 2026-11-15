import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { describe, expect, it, vi } from 'vitest'
import { DiagnosticsCollector } from '../src/diagnostics-collector.ts'
import { observeNativeStream } from '../src/native-diagnostics.ts'

const request: GenerateOptions = { provider: 'github-copilot', model: 'synthetic', messages: [] }
const chunks: StreamChunk[] = [
  { type: 'text-delta', index: 0, text: 'private fixture text' },
  { type: 'finish', reason: { kind: 'stop' } },
]
async function* stream(values: StreamChunk[]) { yield* values }
async function collect(value: AsyncIterable<StreamChunk>) {
  const result: StreamChunk[] = []
  for await (const chunk of value) result.push(chunk)
  return result
}

describe('native Copilot logical stream observations', () => {
  it('does not wrap other providers or collect without separate consent', async () => {
    const collector = new DiagnosticsCollector('0.4.0-alpha.123', 'host')
    const source = stream(chunks)
    expect(observeNativeStream(request, () => source, collector, vi.fn())).toBe(source)
    collector.setNativeEnabled(true)
    const other = stream(chunks)
    expect(observeNativeStream({ ...request, provider: 'other' }, () => other, collector, vi.fn())).toBe(other)
    expect(collector.snapshot().rows).toEqual([])
  })
  it('preserves chunks and records only fixed, content-free terminal evidence', async () => {
    const collector = new DiagnosticsCollector('0.4.0-alpha.123', 'host')
    collector.setNativeEnabled(true)
    const result = await collect(observeNativeStream(request, () => stream(chunks), collector, vi.fn()))
    expect(result).toEqual(chunks)
    expect(result[0]).toBe(chunks[0])
    expect(collector.snapshot().rows).toContainEqual(expect.objectContaining({
      operation: 'native-copilot-llm', metric: 'success',
    }))
    expect(JSON.stringify(collector.snapshot())).not.toContain('private fixture text')
  })
  it('preserves thrown errors and early iterator closure without claiming success', async () => {
    const collector = new DiagnosticsCollector('0.4.0-alpha.123', 'host')
    collector.setNativeEnabled(true)
    const original = new Error('private fixture error')
    async function* fails(): AsyncGenerator<StreamChunk> { throw original }
    await expect(collect(observeNativeStream(request, fails, collector, vi.fn()))).rejects.toBe(original)
    const iterator = observeNativeStream({ ...request, purpose: 'auto-review' },
      () => stream(chunks), collector, vi.fn())[Symbol.asyncIterator]()
    await iterator.next()
    await iterator.return?.()
    expect(collector.snapshot().rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ operation: 'native-copilot-llm', metric: 'failed' }),
      expect.objectContaining({ operation: 'native-copilot-review', metric: 'interrupted' }),
    ]))
    expect(JSON.stringify(collector.snapshot())).not.toContain('private fixture error')
  })
  it('does not revive an unconsumed stream after pause or clear', async () => {
    const collector = new DiagnosticsCollector('0.4.0-alpha.123', 'host')
    collector.setNativeEnabled(true)
    const beforePause = observeNativeStream(request, () => stream(chunks), collector, vi.fn())
    collector.setNativeEnabled(false)
    collector.setNativeEnabled(true)
    const beforeClear = observeNativeStream(request, () => stream(chunks), collector, vi.fn())
    collector.clear()
    await collect(beforePause)
    await collect(beforeClear)
    expect(collector.snapshot().rows).toEqual([])
  })
  it('passes iterator input and return through unchanged', async () => {
    const collector = new DiagnosticsCollector('0.4.0-alpha.123', 'host')
    collector.setNativeEnabled(true)
    const returnValue = { marker: 'original' }
    const upstream = {
      next: vi.fn(async () => ({ done: false as const, value: chunks[0]! })),
      return: vi.fn(async (value?: unknown) => ({ done: true as const, value })),
    }
    const wrapped = observeNativeStream(request, () => ({ [Symbol.asyncIterator]: () => upstream }), collector, vi.fn())
    const iterator = wrapped[Symbol.asyncIterator]()
    await iterator.next('forwarded')
    expect(await iterator.return?.(returnValue)).toEqual({ done: true, value: returnValue })
    expect(upstream.next).toHaveBeenCalledWith('forwarded')
    expect(upstream.return).toHaveBeenCalledWith(returnValue)
    expect(collector.snapshot().rows).toContainEqual(expect.objectContaining({ metric: 'interrupted' }))
  })
  it('does not infer cancellation from an aborted terminal without signal evidence', async () => {
    const collector = new DiagnosticsCollector('0.4.0-alpha.123', 'host')
    collector.setNativeEnabled(true)
    const aborted: StreamChunk[] = [{ type: 'finish', reason: { kind: 'aborted',
      failure: { code: 'ABORTED', message: 'private abort' } } }]
    await collect(observeNativeStream(request, () => stream(aborted), collector, vi.fn()))
    const controller = new AbortController()
    controller.abort()
    await collect(observeNativeStream({ ...request, signal: controller.signal }, () => stream(aborted), collector, vi.fn()))
    expect(collector.snapshot().rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ metric: 'unknown' }), expect.objectContaining({ metric: 'cancelled' }),
    ]))
    expect(JSON.stringify(collector.snapshot())).not.toContain('private abort')
  })
  it('records only allowlisted native failure codes without retaining error text', async () => {
    const collector = new DiagnosticsCollector('0.4.0-alpha.123', 'host')
    collector.setNativeEnabled(true)
    for (const code of ['TIMEOUT', 'private-unrecognized-code']) {
      const failure: StreamChunk[] = [{ type: 'finish', reason: { kind: 'error',
        failure: { code, message: 'private error text' } } }]
      await collect(observeNativeStream(request, () => stream(failure), collector, vi.fn()))
    }
    expect(collector.snapshot().rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ metric: 'failed', reason: 'NATIVE_LLM_TIMEOUT' }),
      expect.objectContaining({ metric: 'failed', reason: 'unknown' }),
    ]))
    expect(JSON.stringify(collector.snapshot())).not.toContain('private')
  })
  it('preserves the stream when diagnostics itself fails', async () => {
    const collector = new DiagnosticsCollector('0.4.0-alpha.123', 'host')
    collector.setNativeEnabled(true)
    vi.spyOn(collector, 'beginNative').mockImplementation(() => { throw new Error('private diagnostic error') })
    const warn = vi.fn()
    await expect(collect(observeNativeStream(request, () => stream(chunks), collector, warn))).resolves.toEqual(chunks)
    expect(warn).toHaveBeenCalledOnce()
  })
})
