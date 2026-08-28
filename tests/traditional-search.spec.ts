import { afterEach, describe, expect, it, vi } from 'vitest'
import type { InlineConfig } from '../src/config.ts'
import { SearchPlan } from '../src/plan.ts'
import { probeCandidate } from '../src/probe.ts'
import { createTraditionalSearchProvider } from '../src/traditional-search.ts'
import type { InlineHooks } from '../src/wire.ts'
import { makeCandidate } from './helpers.ts'

const config: InlineConfig = {
  enabled: true,
  providers: [],
  includeSources: true,
  stripServerTools: true,
  idleTimeoutMs: 10_000,
  probe: false,
  probeTimeoutMs: 1_000,
}

function provider(
  resolveApiKey: InlineHooks['resolveApiKey'] = async () => 'top-secret',
  searchPlan: SearchPlan = new SearchPlan(
    [makeCandidate('openai-responses')],
    async () => ({ supported: true, detail: 'supported', webSearchToolType: 'web_search' }),
    false,
  ),
) {
  return createTraditionalSearchProvider(() => true, () => searchPlan, { resolveApiKey }, () => config)
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('traditional search bridge', () => {
  it('normalizes generated content and deduplicated sources', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>
      expect(requestBody).toMatchObject({
        tools: [{ type: 'web_search' }],
        tool_choice: 'required',
        include: ['web_search_call.action.sources'],
        stream: false,
      })
      expect(JSON.stringify(requestBody)).toContain('latest Node release')
      return new Response(JSON.stringify({
        output: [
          {
            type: 'web_search_call',
            action: {
              sources: [
                { url: 'https://nodejs.org/en/blog/release', title: 'Node.js releases', snippet: 'Release notes' },
              ],
            },
          },
          {
            type: 'message',
            content: [{
              type: 'output_text',
              text: 'Node.js has a current release.',
              annotations: [
                { type: 'url_citation', url: 'https://nodejs.org/en/blog/release', title: 'Node.js releases' },
                { type: 'url_citation', url: 'https://example.com/status', title: 'Status' },
              ],
            }],
          },
        ],
      }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(provider().search({ query: 'latest Node release' })).resolves.toEqual({
      content: 'Node.js has a current release.',
      sources: [
        { url: 'https://nodejs.org/en/blog/release', title: 'Node.js releases', snippet: 'Release notes' },
        { url: 'https://example.com/status', title: 'Status' },
      ],
      truncated: false,
    })
  })

  it('honors caller abort before credential or network access', async () => {
    const resolveApiKey = vi.fn(async () => 'top-secret')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    controller.abort()

    await expect(provider(resolveApiKey).search({ query: 'cancelled' }, controller.signal))
      .rejects.toMatchObject({ code: 'WEB_ABORTED' })
    expect(resolveApiKey).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not create a lazy plan or start its probe when already aborted', async () => {
    const probe = vi.fn(async () => ({ supported: true, detail: 'supported' }))
    const resolveApiKey = vi.fn(async () => 'top-secret')
    const fetchMock = vi.fn()
    const createPlan = vi.fn(() => new SearchPlan(
      [makeCandidate('openai-responses')],
      probe,
      true,
    ))
    const searchProvider = createTraditionalSearchProvider(
      () => true,
      createPlan,
      { resolveApiKey },
      () => config,
    )
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    controller.abort()

    await expect(searchProvider.search({ query: 'cancelled before lazy plan' }, controller.signal))
      .rejects.toMatchObject({ code: 'WEB_ABORTED' })
    expect(createPlan).not.toHaveBeenCalled()
    expect(probe).not.toHaveBeenCalled()
    expect(resolveApiKey).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('forwards caller abort to an in-flight Responses request', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_input: string | URL | Request, init?: RequestInit) =>
      await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
      })))
    const controller = new AbortController()
    const search = provider().search({ query: 'cancelled in flight' }, controller.signal)
    controller.abort()

    await expect(search).rejects.toMatchObject({ code: 'WEB_ABORTED' })
  })

  it('preserves caller abort while reading the response body', async () => {
    let headersReceived: (() => void) | undefined
    const responseStarted = new Promise<void>((resolve) => { headersReceived = resolve })
    vi.stubGlobal('fetch', vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          init?.signal?.addEventListener('abort', () => {
            controller.error(new DOMException('aborted', 'AbortError'))
          }, { once: true })
        },
      })
      headersReceived?.()
      return new Response(body, { status: 200 })
    }))
    const controller = new AbortController()
    const search = provider().search({ query: 'cancel body read' }, controller.signal)
    await responseStarted
    controller.abort()

    await expect(search).rejects.toMatchObject({ code: 'WEB_ABORTED' })
  })

  it('maps HTTP errors without leaking credentials or provider bodies', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ error: { message: 'top-secret was rejected' } }),
      { status: 401 },
    )))

    const error = await provider().search({ query: 'news' }).catch((reason: unknown) => reason)
    expect(error).toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
    expect(String(error)).toContain('HTTP 401')
    expect(String(error)).not.toContain('top-secret')
  })

  it('sanitizes probe failures whose provider message echoes a credential', async () => {
    const secret = 'sentinel-probe-secret'
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ error: { message: `credential ${secret} rejected` } }),
      { status: 401 },
    )))
    const candidate = makeCandidate('openai-responses')
    const plan = new SearchPlan(
      [candidate],
      current => probeCandidate(current, async () => secret, 1_000),
      true,
    )

    const error = await provider(async () => secret, plan).search({ query: 'news' }).catch((reason: unknown) => reason)
    expect(error).toMatchObject({ code: 'WEB_PROVIDER_UNAVAILABLE' })
    expect(String(error)).not.toContain(secret)
    expect(String(error)).not.toContain('credential')
  })
})
