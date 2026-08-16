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
  it('confirms support via the standard spelling and reports it', async () => {
    const fetchMock = stubFetch({ output: [{ type: 'web_search_call', id: 'ws-1', action: { type: 'search', queries: ['q'] } }] })
    const outcome = await probeCandidate(makeCandidate('openai-responses'), async () => KEY, 1000)
    expect(outcome.supported).toBe(true)
    expect(outcome.webSearchToolType).toBe('web_search')
    // The default probe exercises the STANDARD OpenAI spelling with the
    // standard required tool_choice; the versioned spelling is an OpenCode
    // Go special case, not the global default.
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toMatchObject({
      tools: [{ type: 'web_search' }],
      tool_choice: 'required',
    })
  })

  it('probes the versioned spelling first for an OpenCode Go candidate', async () => {
    const fetchMock = stubFetch({ output: [{ type: 'web_search_call', id: 'ws-1', action: { type: 'search', queries: ['q'] } }] })
    const outcome = await probeCandidate(
      makeCandidate('openai-responses', { webSearchToolType: 'web_search_2025_08_26' }),
      async () => KEY,
      1000,
    )
    expect(outcome.supported).toBe(true)
    expect(outcome.webSearchToolType).toBe('web_search_2025_08_26')
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toMatchObject({
      tools: [{ type: 'web_search_2025_08_26' }],
      tool_choice: { type: 'web_search_2025_08_26' },
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('falls back to the versioned spelling when the standard one is refused', async () => {
    const fetchMock = vi.fn(async (_url, init) => {
      const body = JSON.parse(String((init as RequestInit).body))
      const type = (body.tools as Array<{ type: string }>)[0]?.type
      return type === 'web_search'
        ? new Response(JSON.stringify({ error: { message: 'unsupported tool type' } }), { status: 400 })
        : new Response(JSON.stringify({ output: [{ type: 'web_search_call', id: 'ws-1' }] }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const outcome = await probeCandidate(makeCandidate('openai-responses'), async () => KEY, 1000)
    expect(outcome.supported).toBe(true)
    // The fallback winner is what the wire must use.
    expect(outcome.webSearchToolType).toBe('web_search_2025_08_26')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('falls back when a 2xx reply executed no search', async () => {
    const fetchMock = vi.fn(async (_url, init) => {
      const body = JSON.parse(String((init as RequestInit).body))
      const type = (body.tools as Array<{ type: string }>)[0]?.type
      return type === 'web_search'
        ? new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'no search' }] }] }), { status: 200 })
        : new Response(JSON.stringify({ output: [{ type: 'web_search_call', id: 'ws-1' }] }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const outcome = await probeCandidate(makeCandidate('openai-responses'), async () => KEY, 1000)
    expect(outcome.supported).toBe(true)
    expect(outcome.webSearchToolType).toBe('web_search_2025_08_26')
  })

  it('rejects a 2xx reply that executed no search with either spelling', async () => {
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

  it('does not retry the other spelling for a spelling-independent HTTP failure', async () => {
    const fetchMock = stubFetch({ error: { message: 'invalid api key' } }, 401)
    const outcome = await probeCandidate(makeCandidate('openai-responses'), async () => KEY, 1000)
    expect(outcome.supported).toBe(false)
    expect(outcome.detail).toContain('invalid api key')
    expect(fetchMock).toHaveBeenCalledTimes(1)
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

describe('probeCandidate (timeout bound)', () => {
  it('bounds a hanging credential resolution', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('should never be called') }))
    const outcome = await probeCandidate(
      makeCandidate('openai-responses'),
      async () => new Promise<string | undefined>(() => undefined),
      50,
    )
    expect(outcome.supported).toBe(false)
    expect(outcome.detail).toContain('timed out')
  })

  it('clamps an absurd timeout instead of throwing', async () => {
    stubFetch({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'no search' }] }] })
    const outcome = await probeCandidate(makeCandidate('openai-responses'), async () => KEY, 2 ** 40)
    expect(outcome.supported).toBe(false)
  })

  it('does not fire a probe request after the verdict already timed out', async () => {
    const fetchMock = vi.fn(async () => { throw new Error('should never be called') })
    vi.stubGlobal('fetch', fetchMock)
    let resolveKey: ((value: string | undefined) => void) | undefined
    const keyPromise = new Promise<string | undefined>((resolve) => { resolveKey = resolve })
    // The bound elapses while the key is still resolving.
    const outcome = await probeCandidate(makeCandidate('openai-responses'), () => keyPromise, 30)
    expect(outcome.supported).toBe(false)
    expect(outcome.detail).toContain('timed out')
    // The key lands late: the probe must notice the deadline passed and NOT
    // start a fresh fetch with a fresh timeout.
    resolveKey?.('late-key')
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
