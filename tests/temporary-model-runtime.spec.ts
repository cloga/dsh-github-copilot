import { Context } from '@deepseek-ai/cordis'
import type { LlmAdapter } from '@deepseek-ai/dsh-llm'
import * as PiAiPlugin from '@deepseek-ai/dsh-llm-pi-ai'
import { describe, expect, it, vi } from 'vitest'

describe('temporary GPT-6 pi-ai runtime integration', () => {
  it('materializes GPT-6 with the temporary Responses route mode', async () => {
    const adapters: LlmAdapter[] = []
    const ctx = new Context()
    const services = ctx.plugin({
      name: 'temporary-model-runtime-services',
      apply(serviceCtx) {
        serviceCtx.provide('llm', {
          registerAdapter: (_routes: readonly string[], adapter: LlmAdapter) => {
            adapters.push(adapter)
            return { replace: vi.fn() }
          },
          registerConfigurableProviders: () => ({ replace: vi.fn() }),
          registerModelDiscovery: () => () => undefined,
        })
      },
    })
    await services
    const integration = ctx.plugin(PiAiPlugin, {
      providers: {
        'github-copilot': {
          api: 'openai-responses',
          models: [
            {
              id: 'gpt-6-astra',
              name: 'GPT-6 Astra',
              contextWindow: 1_050_000,
              maxTokens: 128_000,
              input: ['text', 'image'],
              reasoningEfforts: {
                off: null,
                low: 'low',
                medium: 'medium',
                high: 'high',
                xhigh: 'xhigh',
                max: 'max',
              },
            },
            { id: 'gpt-5.6-sol' },
          ],
        },
      },
    })

    try {
      await integration
      expect(adapters).toHaveLength(1)
      await expect(adapters[0]!.listModels('github-copilot')).resolves.toEqual([
        expect.objectContaining({ id: 'gpt-6-astra', name: 'GPT-6 Astra' }),
        expect.objectContaining({ id: 'gpt-5.6-sol' }),
      ])
      await expect(adapters[0]!.resolveModel('github-copilot', 'gpt-6-astra', AbortSignal.timeout(1_000)))
        .resolves.toMatchObject({
          id: 'gpt-6-astra',
          context: { contextWindow: 1_050_000 },
          reasoning: {
            efforts: [
              { id: 'off', name: 'Off' },
              { id: 'low', name: 'Low' },
              { id: 'medium', name: 'Medium' },
              { id: 'high', name: 'High' },
              { id: 'xhigh', name: 'Xhigh' },
              { id: 'max', name: 'Max' },
            ],
          },
        })
    } finally {
      await integration.dispose()
      await services.dispose()
    }
  })
})
