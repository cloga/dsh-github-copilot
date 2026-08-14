/**
 * Unit tests for the capability probe: the structural verdicts on both
 * protocols, credential gating, and error mapping.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { probeCandidate } from '../src/probe.ts'
import { makeCandidate } from './helpers.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

const KEY = 'key-1'

function stubFetch(body: unknown, status = 200): ReturnType<typeof vi.fn> {
  const mock = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }))
  vi.stubGlobal('fetch', mock)
  return mock
}

describe('probeCandidate (openai-responses)', () => {
  it('confirms support when a web_search_call item comes back', async () => {
    const fetchMock = stubFetch({ output: [{ type: 'web_search_call', id: 'ws-1', action: { type: 'search', queries: ['q'] } }] })
    const outcome = await probeCandidate(makeCandidate('openai-responses'), async () => KEY, 1000)
    expect(outcome.supported).toBe(true)
    // The probe must exercise the exact tool spelling real searches use, or a
    // gateway that drops a nameless `web_search` would pass a probe that
    // never ran one.
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toMatchObject({
      tools: [{ type: 'web_search_2025_08_26' }],
      tool_choice: { type: 'web_search_2025_08_26' },
    })
  })

  it('rejects a 2xx reply that executed no search', async () => {
    stubFetch({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'no search' }] }] })
    const outcome = await probeCandidate(makeCandidate('openai-responses'), async () => KEY, 1000)
    expect(outcome.supported).toBe(false)
    expect(outcome.detail).toContain('no web_search_call')
  })

  it('rejects an HTTP error and names the provider message', async () => {
    stubFetch({ error: { message: 'unknown tool' } }, 400)
    const outcome = await probeCandidate(makeCandidate('openai-responses'), async () => KEY, 1000)
    expect(outcome.supported).toBe(false)
    expect(outcome.detail).toContain('unknown tool')
  })

  it('rejects a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED') }))
    const outcome = await probeCandidate(makeCandidate('openai-responses'), async () => KEY, 1000)
    expect(outcome.supported).toBe(false)
    expect(outcome.detail).toContain('ECONNREFUSED')
  })
})

describe('probeCandidate (anthropic-messages)', () => {
  it('confirms support when a web_search_tool_result block comes back', async () => {
    stubFetch({ content: [{ type: 'web_search_tool_result', content: [{ type: 'web_search_result', url: 'https://x.example/1' }] }] })
    const outcome = await probeCandidate(makeCandidate('anthropic-messages'), async () => KEY, 1000)
    expect(outcome.supported).toBe(true)
  })

  it('rejects a reply without a result block', async () => {
    stubFetch({ content: [{ type: 'text', text: 'no search' }] })
    const outcome = await probeCandidate(makeCandidate('anthropic-messages'), async () => KEY, 1000)
    expect(outcome.supported).toBe(false)
    expect(outcome.detail).toContain('no web_search_tool_result')
  })
})

describe('probeCandidate (credential gating)', () => {
  it('rejects a candidate whose key cannot be resolved', async () => {
    const outcome = await probeCandidate(makeCandidate('openai-responses'), async () => undefined, 1000)
    expect(outcome.supported).toBe(false)
    expect(outcome.detail).toContain('no API key')
  })
})
