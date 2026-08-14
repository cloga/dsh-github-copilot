/**
 * Unit tests for the OpenAI Responses API adapter: request building, the
 * three-action parsing, strict-mode failures, and the fetch path.
 */

import { describe, expect, it, vi, afterEach } from 'vitest'
import { WebError } from '@deepseek-ai/dsh-web'
import {
  buildResponsesSearchBody,
  findInPageInstruction,
  mapResponsesSearchResult,
  openPageInstruction,
  runResponsesSearch,
  sourcesFromAnnotations,
} from '../src/responses.ts'
import type { ResponsesSearchOptions } from '../src/responses.ts'
import type { ResponsesResponse } from '../src/types.ts'

const OPTIONS: ResponsesSearchOptions = {
  baseURL: 'https://api.deepseek.com',
  model: 'deepseek-v4-flash',
  apiKey: 'key-1',
  maxOutputTokens: 4096,
}

afterEach(() => {
  vi.unstubAllGlobals()
})

function responseWith(output: ResponsesResponse['output'], status = 200): ResponsesResponse {
  return { id: 'resp-1', status: status === 200 ? 'completed' : 'failed', output }
}

describe('buildResponsesSearchBody', () => {
  it('pins the web search server tool through tool_choice', () => {
    const body = buildResponsesSearchBody(OPTIONS, { action: 'search', text: 'hello' }) as {
      model: string
      tools: unknown[]
      tool_choice: unknown
      input: unknown[]
      max_output_tokens: number
      stream: boolean
    }
    expect(body.model).toBe('deepseek-v4-flash')
    // The versioned type executes on gateway endpoints that drop a nameless
    // `web_search` tool (OpenCode Zen/Go) and is documented by OpenAI and
    // DeepSeek; the probe verifies the endpoint before any search is served.
    expect(body.tools).toEqual([{ type: 'web_search_2025_08_26' }])
    expect(body.tool_choice).toEqual({ type: 'web_search_2025_08_26' })
    expect(body.stream).toBe(false)
    expect(body.max_output_tokens).toBe(4096)
    expect(body.input).toEqual([
      { role: 'user', content: [{ type: 'input_text', text: 'hello' }] },
    ])
  })
})

describe('openPageInstruction / findInPageInstruction', () => {
  it('embeds the URL and forbids a fresh search', () => {
    expect(openPageInstruction('https://example.com/a')).toBe(
      'Open the page at https://example.com/a and report its content. Do not perform a new web search.',
    )
  })

  it('quotes the pattern so arbitrary text survives', () => {
    expect(findInPageInstruction('https://example.com/a', 'has "quotes"')).toBe(
      'Search within the page at https://example.com/a for the pattern "has \\"quotes\\"" and report the matching passages. Do not perform a new web search.',
    )
  })
})

describe('mapResponsesSearchResult', () => {
  it('maps the message answer and url_citation annotations to content and sources', () => {
    const result = mapResponsesSearchResult(responseWith([
      { type: 'web_search_call', id: 'ws-1', action: { type: 'search', queries: ['deepseek news'] } },
      {
        type: 'message',
        content: [
          {
            type: 'output_text',
            text: 'DeepSeek released a new model.',
            annotations: [
              { type: 'url_citation', url: 'https://deepseek.com/news', title: 'DeepSeek News' },
              { type: 'url_citation', url: 'https://example.com/other' },
            ],
          },
        ],
      },
    ]))
    expect(result.content).toBe('DeepSeek released a new model.')
    expect(result.sources).toEqual([
      { url: 'https://deepseek.com/news', title: 'DeepSeek News' },
      { url: 'https://example.com/other' },
    ])
    expect(result.truncated).toBe(false)
  })

  it('accepts the gateway annotation vocabulary and the link fallback', () => {
    const sources = sourcesFromAnnotations([
      {
        type: 'message',
        content: [
          {
            type: 'output_text',
            text: 'x',
            annotations: [
              { type: 'web_search', link: 'https://gateway.example/1', title: 'One' },
              { type: 'search_result', url: 'https://gateway.example/2' },
            ],
          },
        ],
      },
    ])
    expect(sources).toEqual([
      { url: 'https://gateway.example/1', title: 'One' },
      { url: 'https://gateway.example/2' },
    ])
  })

  it('dedupes sources by URL across content parts', () => {
    const sources = sourcesFromAnnotations([
      {
        type: 'message',
        content: [
          { type: 'output_text', text: 'a', annotations: [{ type: 'url_citation', url: 'https://x.example/1' }] },
          { type: 'output_text', text: 'b', annotations: [{ type: 'url_citation', url: 'https://x.example/1', title: 'dup' }] },
        ],
      },
    ])
    expect(sources).toEqual([{ url: 'https://x.example/1' }])
  })

  it('skips unciteable annotations', () => {
    const sources = sourcesFromAnnotations([
      {
        type: 'message',
        content: [
          {
            type: 'output_text',
            text: 'x',
            annotations: [
              { type: 'file_citation', url: 'https://x.example/1' },
              { type: 'url_citation', url: '' },
              { type: 'url_citation' },
            ],
          },
        ],
      },
    ])
    expect(sources).toEqual([])
  })

  it('is strict: no web_search_call item means the tool did not run', () => {
    const response = responseWith([
      { type: 'message', content: [{ type: 'output_text', text: 'an answer from memory' }] },
    ])
    expect(() => mapResponsesSearchResult(response)).toThrowError(WebError)
    try {
      mapResponsesSearchResult(response)
      expect.unreachable()
    } catch (error) {
      expect((error as WebError).code).toBe('WEB_PROVIDER_ERROR')
    }
  })

  it('accepts every web_search_call action type as evidence of native search', () => {
    for (const action of [
      { type: 'search', queries: ['q'] },
      { type: 'open_page', url: 'https://x.example/1' },
      { type: 'find_in_page', url: 'https://x.example/1', pattern: 'needle' },
    ]) {
      const result = mapResponsesSearchResult(responseWith([
        { type: 'web_search_call', id: 'ws-1', action },
        { type: 'message', content: [{ type: 'output_text', text: 'summary' }] },
      ]))
      expect(result.content).toBe('summary')
    }
  })

  it('omits content when the reply carries no message text', () => {
    const result = mapResponsesSearchResult(responseWith([
      { type: 'web_search_call', id: 'ws-1', action: { type: 'search', queries: ['q'] } },
    ]))
    expect(result.content).toBeUndefined()
    expect(result.sources).toEqual([])
  })
})

describe('runResponsesSearch', () => {
  it('POSTs the pinned request and maps the reply', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(responseWith([
      { type: 'web_search_call', id: 'ws-1', action: { type: 'search', queries: ['q'] } },
      {
        type: 'message',
        content: [{ type: 'output_text', text: 'answer', annotations: [{ type: 'url_citation', url: 'https://x.example/1' }] }],
      },
    ])), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    const recorded: unknown[] = []
    const result = await runResponsesSearch(
      { ...OPTIONS, recordRequest: (request) => { recorded.push(request) } },
      { action: 'search', text: 'hello' },
    )

    expect(result.content).toBe('answer')
    expect(result.sources).toEqual([{ url: 'https://x.example/1' }])
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.deepseek.com/responses')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer key-1')
    expect(init.redirect).toBe('error')
    expect(recorded).toHaveLength(1)
    expect(recorded[0]).toMatchObject({ protocol: 'openai-responses', endpoint: 'https://api.deepseek.com/responses' })
  })

  it('surfaces the provider error message on a non-2xx reply', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message: 'unknown tool' } }), { status: 400 })))
    await expect(runResponsesSearch(OPTIONS, { action: 'search', text: 'q' })).rejects.toMatchObject({
      code: 'WEB_PROVIDER_ERROR',
      message: 'unknown tool',
    })
  })

  it('reports a missing credential with the actionable reference', async () => {
    vi.stubGlobal('fetch', vi.fn())
    await expect(
      runResponsesSearch({ ...OPTIONS, apiKey: undefined, apiKeyEnv: 'MY_SEARCH_KEY' }, { action: 'search', text: 'q' }),
    ).rejects.toMatchObject({ code: 'WEB_PROVIDER_CREDENTIAL_MISSING' })
  })

  it('surfaces caller cancellation as WEB_ABORTED', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
      return new Response('{}', { status: 200 })
    }))
    const controller = new AbortController()
    const promise = runResponsesSearch(OPTIONS, { action: 'search', text: 'q' }, controller.signal)
    controller.abort()
    await expect(promise).rejects.toMatchObject({ code: 'WEB_ABORTED' })
  })

  it('rejects redirects before a Location target is contacted', async () => {
    const fetchMock = vi.fn(async () => new Response('redirected', { status: 302, headers: { location: 'https://evil.example' } }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(runResponsesSearch(OPTIONS, { action: 'search', text: 'q' })).rejects.toMatchObject({
      code: 'WEB_PROVIDER_ERROR',
    })
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ redirect: 'error' })
  })
})
