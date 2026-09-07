import { Context } from '@deepseek-ai/cordis'
import type { GenerateOptions, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { describe, expect, it } from 'vitest'
import { resolveCopilotResponsesReasoning } from '../src/responses-reasoning.ts'
import type { SearchPlanCandidate } from '../src/plan.ts'

const candidate: SearchPlanCandidate = { protocol: 'openai-responses', model: 'gpt-6-astra',
  baseURL: 'https://api.individual.githubcopilot.com', apiKeyEnv: 'unused', apiVersion: '2023-06-01' }
function resolve(profile: Record<string, unknown>, effort?: string, model = candidate.model, unshippedService?: unknown) {
  const ctx = new Context()
  ctx.get = ((name: string) => name === 'settings' ? {
    get: () => ({ providers: { 'github-copilot': profile } }),
  } : name === 'llmPiAiModelProtocol' ? unshippedService : undefined) as typeof ctx.get
  const request: GenerateOptions = { provider: 'github-copilot', model, messages: [],
    ...effort === undefined ? {} : { reasoningEffort: effort as ReasoningEffortId },
  }
  return resolveCopilotResponsesReasoning(ctx, request, { ...candidate, model })
}
const models = [{ id: 'gpt-6-astra', api: 'openai-responses',
  reasoningEfforts: { off: null, low: 'low', high: 'high', max: 'max' } }]

describe('Responses reasoning request options', () => {
  it('honors request effort before the profile default and asks for a public summary', () => {
    expect(resolve({ models, reasoning: 'low' }, 'high')).toEqual({ effort: 'high', summary: 'auto' })
    expect(resolve({ models, reasoning: 'low' })).toEqual({ effort: 'low', summary: 'auto' })
  })
  it('does not force a reasoning mode without a selection', () => {
    expect(resolve({ models })).toBeUndefined()
  })
  it('preserves the Core off omission rather than claiming to disable server reasoning', () => {
    expect(resolve({ models, reasoning: 'high' }, 'off')).toBeUndefined()
  })
  it('maps explicitly declared efforts to their actual wire values', () => {
    expect(resolve({ models: [{ ...models[0], reasoningEfforts: { high: 'max' } }] }, 'high'))
      .toEqual({ effort: 'max', summary: 'auto' })
  })
  it('leaves undeclared native wire mappings to the registered Core adapter', () => {
    expect(() => resolve({ models: [{ id: 'gpt-5.4', api: 'openai-responses' }] }, 'high', 'gpt-5.4'))
      .toThrow('COPILOT_RESPONSES_REASONING_CORE_REQUIRED')
  })
  it('does not add a dependency on an unshipped Core effort service', () => {
    const unshipped = { getCatalogModels() { throw new Error('unshipped service must not be called') } }
    expect(() => resolve({}, 'high', 'gpt-5.4', unshipped)).toThrow('COPILOT_RESPONSES_REASONING_CORE_REQUIRED')
  })
  it('delegates implicit native effort selection without creating another metadata owner', () => {
    expect(() => resolve({}, 'high', 'gpt-5.4')).toThrow('COPILOT_RESPONSES_REASONING_CORE_REQUIRED')
  })
  it('respects modelOverrides when no replacement model list is configured', () => {
    expect(resolve({ modelOverrides: { 'gpt-5.4': { reasoningEfforts: { high: 'max' } } } }, 'high', 'gpt-5.4'))
      .toEqual({ effort: 'max', summary: 'auto' })
  })
  it.each([
    [{ models }, 'medium'],
    [{ models: [{ ...models[0], reasoningEfforts: false }] }, 'high'],
    [{ models: [{ id: 'gpt-6-astra', api: 'openai-responses' }] }, 'high'],
    [{ models: [{ ...models[0], reasoningEfforts: { high: null } }] }, 'high'],
    [{ models: [{ ...models[0], reasoningEfforts: { high: '' } }] }, 'high'],
    [{ models: [{ ...models[0], reasoningEfforts: { high: 'high' } }] }, 'off'],
    [{ models: [{ id: 'gpt-5.4' }] }, 'high'],
  ] as const)('rejects unavailable or unverified reasoning options without fallback', (profile, effort) => {
    expect(() => resolve(profile, effort)).toThrow(/COPILOT_RESPONSES_REASONING/)
  })
})
