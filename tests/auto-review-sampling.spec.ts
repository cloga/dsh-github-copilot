import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { describe, expect, it } from 'vitest'

describe('public reviewer service-read qualification', () => {
  it('exposes the exact caller fiber without grouping concurrent ordinary calls', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    const callers: unknown[] = []
    const requests: GenerateOptions[] = []
    const disposeRead = ctx.on('internal/get', (caller, name, _error, next) => {
      if (name === 'llm') callers.push(caller.fiber.runtime?.callback)
      return next()
    })
    const disposeStream = ctx.on('llm/stream', options => {
      requests.push(options)
      return (async function* (): AsyncGenerator<StreamChunk> {
        yield { type: 'finish', reason: { kind: 'stop' } }
      })()
    })
    let reviewerContext: Context | undefined
    let ordinaryContext: Context | undefined
    const reviewer = {
      inject: ['llm'],
      apply(caller: Context) { reviewerContext = caller },
    }
    const ordinary = {
      inject: ['llm'],
      apply(caller: Context) { ordinaryContext = caller },
    }
    await ctx.plugin(reviewer)
    await ctx.plugin(ordinary)
    const request = Object.freeze({
      provider: 'github-copilot-preview', model: 'synthetic-model',
      messages: [], temperature: 0,
    }) satisfies GenerateOptions
    try {
      const streams = [reviewerContext!.llm.stream(request), ordinaryContext!.llm.stream(request)]
      await Promise.all(streams.map(async stream => { for await (const _chunk of stream) { /* consume */ } }))
      expect(callers).toEqual([reviewer.apply, ordinary.apply])
      expect(requests).toEqual([request, request])
      expect(Object.isFrozen(request)).toBe(true)
      disposeRead()
      ordinaryContext!.llm.stream(request)
      expect(callers).toHaveLength(2)
    } finally {
      disposeStream()
      disposeRead()
      await ctx.fiber.dispose()
    }
  })
})
