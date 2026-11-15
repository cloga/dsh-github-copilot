import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { expect, it } from 'vitest'
import { DiagnosticsController } from '../../src/diagnostics-host.ts'

it('observes native and prepared streams through the published waterfall without affecting output', async () => {
  const ctx = new Context()
  try {
    await ctx.plugin(LlmRuntime)
    ctx.llm.registerAdapter(['github-copilot', 'other'], new class extends LlmAdapter {
      async *stream(options: GenerateOptions): AsyncGenerator<StreamChunk> {
        if (options.model === 'failure') throw new Error('private fixture error')
        yield { type: 'text-delta', index: 0, text: 'private fixture text' }
        yield { type: 'finish', reason: { kind: 'stop' } }
      }
    })
    let diagnostics!: DiagnosticsController
    const plugin = ctx.plugin({ apply(scope) { diagnostics = new DiagnosticsController(scope) } })
    await plugin
    diagnostics.collector.setNativeEnabled(true)
    const read = async (source: AsyncIterable<StreamChunk>) => {
      const chunks: StreamChunk[] = []
      for await (const chunk of source) chunks.push(chunk)
      return chunks
    }
    const options: GenerateOptions = { provider: 'github-copilot', model: 'fixture', messages: [] }
    expect(await read(ctx.llm.stream(options))).toMatchObject([
      { type: 'text-delta', text: 'private fixture text' }, { type: 'finish', reason: { kind: 'stop' } },
    ])
    const prepared = await ctx.llm.prepareCall({ provider: 'github-copilot', model: 'fixture' })
    expect(await read(prepared.stream({ ...prepared.config, messages: [], purpose: 'auto-review' })))
      .toHaveLength(2)
    expect(await read(ctx.llm.stream({ ...options, model: 'failure' })))
      .toMatchObject([{ type: 'finish', reason: { kind: 'error' } }])
    await read(ctx.llm.stream({ ...options, provider: 'other' }))
    const rows = diagnostics.collector.snapshot().rows
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ operation: 'native-copilot-llm', metric: 'success', count: 1 }),
      expect.objectContaining({ operation: 'native-copilot-review', metric: 'success', count: 1 }),
      expect.objectContaining({ operation: 'native-copilot-llm', metric: 'failed', count: 1 }),
    ]))
    expect(JSON.stringify(rows)).not.toContain('private fixture')
    await plugin.dispose()
    const before = diagnostics.collector.snapshot().rows
    await read(ctx.llm.stream(options))
    expect(diagnostics.collector.snapshot().rows).toEqual(before)
  } finally { await ctx.fiber.dispose() }
})
