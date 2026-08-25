/**
 * Focused tests for the optional OpenAI-compatible model catalog integration.
 */

import { describe, expect, it, vi } from 'vitest'
import {
  modelCatalogURL,
  modelsFromOpenAICompatibleListing,
  synchronizeOpenAICompatibleModelCatalog,
} from '../src/model-catalog.ts'
import type { CatalogModel } from '../src/model-catalog.ts'

const fallback: readonly CatalogModel[] = [{
  id: 'static-chat',
  name: 'Static Chat',
  api: 'openai-responses',
  input: ['text'],
  contextWindow: 32_000,
  maxTokens: 4_000,
  reasoning: false,
}]

describe('modelsFromOpenAICompatibleListing', () => {
  it('maps rich Copilot metadata for selectable interactive models', () => {
    expect(modelsFromOpenAICompatibleListing({
      data: [{
        id: 'dynamic-chat',
        name: 'Dynamic Chat',
        model_picker_enabled: true,
        policy: { state: 'enabled' },
        supported_endpoints: ['/chat/completions', '/responses'],
        capabilities: {
          type: 'chat',
          supports: {
            tool_calls: true,
            vision: true,
            reasoning_effort: ['none', 'low', 'high', 'unsupported'],
          },
          limits: {
            max_context_window_tokens: 128_000,
            max_output_tokens: 16_000,
          },
        },
      }],
    })).toEqual([{
      id: 'dynamic-chat',
      name: 'Dynamic Chat',
      api: 'openai-responses',
      input: ['text', 'image'],
      contextWindow: 128_000,
      maxTokens: 16_000,
      reasoning: true,
      reasoningEfforts: { off: null, low: 'low', high: 'high' },
    }])
  })

  it('accepts a minimal standard OpenAI model listing', () => {
    expect(modelsFromOpenAICompatibleListing({
      object: 'list',
      data: [{ id: 'standard-model', object: 'model', owned_by: 'provider' }],
    })).toEqual([{
      id: 'standard-model',
      name: 'standard-model',
      input: ['text'],
    }])
  })

  it('filters explicitly disabled, non-picker, embedding, non-tool, and non-chat endpoint models', () => {
    const listed = modelsFromOpenAICompatibleListing({
      data: [
        { id: 'disabled', policy: { state: 'disabled' } },
        { id: 'hidden', model_picker_enabled: false },
        { id: 'embedding', capabilities: { type: 'embedding' } },
        { id: 'no-tools', capabilities: { type: 'chat', supports: { tool_calls: false } } },
        { id: 'images-only', supported_endpoints: ['/images/generations'] },
        { id: 'chat', supported_endpoints: ['/v1/chat/completions'] },
      ],
    })
    expect(listed.map(model => model.id)).toEqual(['chat'])
    expect(listed[0]?.api).toBe('openai-completions')
  })

  it('enriches a matching static entry while preserving unspecified fallback metadata', () => {
    expect(modelsFromOpenAICompatibleListing({
      data: [{
        id: 'static-chat',
        name: 'Live Name',
        capabilities: { limits: { max_output_tokens: 8_000 } },
      }],
    }, fallback)).toEqual([{
      ...fallback[0],
      name: 'Live Name',
      maxTokens: 8_000,
    }])
  })
})

describe('synchronizeOpenAICompatibleModelCatalog', () => {
  it('requests /v1/models and returns the static fallback when discovery fails', async () => {
    const onError = vi.fn()
    const request = vi.fn(async () => new Response('unavailable', { status: 503 }))
    const models = await synchronizeOpenAICompatibleModelCatalog({
      baseURL: 'https://provider.example',
      fallback,
      fetch: request,
      onError,
    })
    expect(models).toBe(fallback)
    expect(request).toHaveBeenCalledWith(
      'https://provider.example/v1/models',
      expect.objectContaining({ redirect: 'error' }),
    )
    expect(onError).toHaveBeenCalledOnce()
  })

  it('does not duplicate a v1 segment', () => {
    expect(modelCatalogURL('https://provider.example/v1/')).toBe('https://provider.example/v1/models')
  })
})
