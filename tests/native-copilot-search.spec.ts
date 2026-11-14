import { Context } from '@deepseek-ai/cordis'
import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { captureNativeCopilot } from '../src/native-copilot-access.ts'
import { createNativeCopilotSearch } from '../src/native-copilot-search.ts'

vi.mock('../src/native-copilot-access.ts', async importOriginal => ({
  ...await importOriginal<typeof import('../src/native-copilot-access.ts')>(),
  captureNativeCopilot: vi.fn(),
}))

const model = getBuiltinModels('github-copilot').find(model => model.api === 'openai-responses')!
const key = 'llm-pi-ai/github-copilot'
const contexts: Context[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

function setup() {
  const ctx = new Context()
  contexts.push(ctx)
  const assertCurrent = vi.fn()
  vi.mocked(captureNativeCopilot).mockResolvedValue({ namespace: 'llm-pi-ai',
    models: new Map([[model.id, model]]), assertCurrent })
  const readRecord = vi.fn(async (record: string) => {
    expect(record).toBe(key)
    return { kind: 'grant', payload: { type: 'oauth', refresh: 'synthetic-refresh',
      access: 'synthetic-access', expires: Date.now() + 3_600_000, availableModelIds: [model.id] } }
  })
  ctx.provide('credentials', {
    readRecord, listRecords: async () => [{ key, kind: 'grant' }],
    modifyRecord: async () => { throw new Error('unexpected refresh') },
    deleteRecord: async () => { throw new Error('unexpected deletion') },
  })
  const requests: Record<string, unknown>[] = []
  const fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    expect(init?.redirect).toBe('error')
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer synthetic-access')
    if (String(url).endsWith('/models')) return Response.json({ data: [{
      id: model.id, model_picker_enabled: true, policy: { state: 'enabled' },
      supported_endpoints: ['/responses'],
      capabilities: { supports: { tool_calls: true, streaming: true },
        limits: { max_context_window_tokens: 32000, max_output_tokens: 4096 } },
    }] })
    const body: Record<string, unknown> = JSON.parse(String(init?.body))
    requests.push(body)
    return Response.json({ output: [
      { type: 'web_search_call', status: 'completed', action: { sources: [{ type: 'url', url: 'https://example.com', title: 'Example' }] } },
      { type: 'message', content: [{ type: 'output_text', text: 'A sourced answer.' }] },
    ] })
  })
  vi.stubGlobal('fetch', fetch)
  return { ctx, provider: createNativeCopilotSearch(ctx), readRecord, fetch, requests, assertCurrent }
}

describe('optional native Copilot hosted search', () => {
  it('registers without I/O and checks readiness without discovery or refresh', async () => {
    const fixture = setup()
    expect(fixture.fetch).not.toHaveBeenCalled()
    expect(fixture.readRecord).not.toHaveBeenCalled()
    expect(await fixture.provider.ready?.('github-copilot')).toBe(true)
    expect(fixture.fetch).not.toHaveBeenCalled()
  })

  it('sends one fixed proof and one user query using the canonical account', async () => {
    const fixture = setup()
    const result = await fixture.provider.search({ query: 'unique user query' })
    expect(fixture.requests).toHaveLength(2)
    expect(JSON.stringify(fixture.requests[0])).not.toContain('unique user query')
    expect(JSON.stringify(fixture.requests[1])).toContain('unique user query')
    expect(result).toMatchObject({ content: 'A sourced answer.', sources: [{ url: 'https://example.com' }] })
  })

  it('refuses an unqualified route even when search is called without ready', async () => {
    const fixture = setup()
    vi.mocked(captureNativeCopilot).mockResolvedValue(undefined)
    await expect(fixture.provider.search({ query: 'must not send' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_UNAVAILABLE' })
    expect(fixture.fetch).not.toHaveBeenCalled()
  })

  it('does not send the user query when the proof has no search evidence', async () => {
    const fixture = setup()
    fixture.fetch.mockImplementationOnce(async () => Response.json({ data: [] }))
    await expect(fixture.provider.search({ query: 'must not send' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_UNAVAILABLE' })
    expect(fixture.requests).toHaveLength(0)
  })

  it('revokes an in-flight operation on canonical credential change without retry', async () => {
    const fixture = setup()
    const original = fixture.fetch.getMockImplementation()!
    fixture.fetch.mockImplementation(async (url, init) => {
      const response = await original(url, init)
      if (String(url).endsWith('/responses')) fixture.ctx.emit('credentials/record-updated', key)
      return response
    })
    await expect(fixture.provider.search({ query: 'must not send' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_UNAVAILABLE' })
    expect(fixture.requests).toHaveLength(1)
  })

  it('rejects oversized queries and already-cancelled calls before I/O', async () => {
    const fixture = setup()
    await expect(fixture.provider.search({ query: 'x'.repeat(16385) })).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
    await expect(fixture.provider.search({ query: 'cancelled' }, AbortSignal.abort())).rejects.toMatchObject({ code: 'ABORTED' })
    expect(fixture.fetch).not.toHaveBeenCalled()
  })
})
