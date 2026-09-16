import { describe, expect, it, vi } from 'vitest'
import { WebError } from '@deepseek-ai/dsh-web'
import type { WebSearchResult } from '@deepseek-ai/dsh-web'
import { routeSearchTools } from '../src/search-tool-routing.ts'

const request = { query: 'current release', maxResults: 3 }
const answer: WebSearchResult = { content: 'safe provider content', sources: [{ url: 'https://example.com' }], truncated: false }

function harness() {
  const controller = new AbortController()
  const primary = { id: 'first-search', search: vi.fn(async () => answer) }
  const fallback = { id: 'final-search', search: vi.fn(async () => answer) }
  const canContinue = vi.fn(() => true)
  return { controller, primary, fallback, canContinue }
}

async function rejected(operation: Promise<WebSearchResult>): Promise<WebError> {
  try { await operation }
  catch (error) {
    expect(error).toBeInstanceOf(WebError)
    return error as WebError
  }
  throw new Error('expected a rejected search')
}

describe('search tool primary and final fallback routing', () => {
  it.each([answer, { sources: [], truncated: false }])('preserves a successful primary result including empty sources', async result => {
    const h = harness()
    h.primary.search.mockResolvedValue(result)
    expect(await routeSearchTools(request, h.controller.signal, h)).toBe(result)
    expect(h.primary.search).toHaveBeenCalledExactlyOnceWith(request, h.controller.signal)
    expect(h.fallback.search).not.toHaveBeenCalled()
  })

  it('uses the final fallback when Auto has no matching primary, even with failure fallback disabled', async () => {
    const h = harness()
    const result = await routeSearchTools(request, h.controller.signal, { ...h, primary: undefined, allowFailureFallback: false })
    expect(result.content).toContain('final-search')
    expect(result.content).toContain('fallback')
    expect(result.content).toContain('may incur')
    expect(result.content).toContain('safe provider content')
    expect(h.primary.search).not.toHaveBeenCalled()
    expect(h.fallback.search).toHaveBeenCalledExactlyOnceWith(request, h.controller.signal)
  })

  it('fails without dispatch when neither provider is supplied', async () => {
    const h = harness()
    await expect(routeSearchTools(request, undefined, { canContinue: h.canContinue })).rejects.toMatchObject({ code: 'WEB_PROVIDER_UNAVAILABLE' })
    expect(h.primary.search).not.toHaveBeenCalled()
    expect(h.fallback.search).not.toHaveBeenCalled()
  })

  it.each(['WEB_PROVIDER_CONFIGURED_MISSING', 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE', 'WEB_PROVIDER_UNAVAILABLE', 'WEB_PROVIDER_ERROR'])('uses exactly one final fallback after %s and preserves safe result data', async code => {
    const h = harness()
    h.primary.search.mockRejectedValue(new WebError('private primary body', code))
    const result = await routeSearchTools(request, h.controller.signal, h)
    expect(result.content).toContain('first-search')
    expect(result.content).toContain('final-search')
    expect(result.content).toContain('may incur')
    expect(result.content).not.toContain('private primary body')
    expect(result.sources).toBe(answer.sources)
    expect(result.truncated).toBe(answer.truncated)
    expect(answer.content).toBe('safe provider content')
    expect(h.primary.search).toHaveBeenCalledOnce()
    expect(h.fallback.search).toHaveBeenCalledOnce()
  })

  it.each(['missing', 'same-id', 'disabled'])('does not retry or leak a failed primary when fallback is %s', async mode => {
    const h = harness()
    h.primary.search.mockRejectedValue(new WebError('private primary body', 'WEB_PROVIDER_ERROR'))
    if (mode === 'same-id') h.fallback.id = h.primary.id
    const error = await rejected(routeSearchTools(request, h.controller.signal, {
      ...h, fallback: mode === 'missing' ? undefined : h.fallback, allowFailureFallback: mode !== 'disabled',
    }))
    expect(error.code).toBe('WEB_PROVIDER_ERROR')
    expect(error.message).toContain('first-search')
    expect(error.message).not.toContain('private primary body')
    expect(error.cause).toBeUndefined()
    expect(h.primary.search).toHaveBeenCalledOnce()
    expect(h.fallback.search).not.toHaveBeenCalled()
  })

  it('reports the actual failed final backend and possible charges without either raw error or a third attempt', async () => {
    const h = harness()
    h.primary.search.mockRejectedValue(new Error('private primary body'))
    h.fallback.search.mockRejectedValue(new WebError('private fallback body', 'PRIVATE_SECRET_CODE'))
    const error = await rejected(routeSearchTools(request, h.controller.signal, h))
    expect(error.message).toContain('final-search')
    expect(error.message).toContain('fallback')
    expect(error.message).toContain('may incur')
    expect(error.message).not.toMatch(/private|PRIVATE_SECRET_CODE/)
    expect(error.cause).toBeUndefined()
    expect(h.primary.search).toHaveBeenCalledOnce()
    expect(h.fallback.search).toHaveBeenCalledOnce()
  })

  it.each(['caller', 'proof'])('does not dispatch with expired %s at entry', async mode => {
    const h = harness()
    if (mode === 'caller') h.controller.abort()
    else h.canContinue.mockReturnValue(false)
    await expect(routeSearchTools(request, h.controller.signal, h)).rejects.toMatchObject({ code: mode === 'caller' ? 'WEB_ABORTED' : 'WEB_PROVIDER_UNAVAILABLE' })
    expect(h.primary.search).not.toHaveBeenCalled()
    expect(h.fallback.search).not.toHaveBeenCalled()
  })

  it.each(['WEB_ABORTED', 'AbortError'])('treats provider-reported %s as terminal even when the supplied signal remains live', async mode => {
    const h = harness()
    const abort = mode === 'WEB_ABORTED' ? new WebError('private abort body', 'WEB_ABORTED') : new DOMException('private abort body', 'AbortError')
    h.primary.search.mockRejectedValue(abort)
    const error = await rejected(routeSearchTools(request, h.controller.signal, h))
    expect(error.code).toBe('WEB_ABORTED')
    expect(error.message).not.toContain('private abort body')
    expect(h.fallback.search).not.toHaveBeenCalled()
  })

  it.each(['caller', 'proof'])('does not fallback or return stale primary success after %s expires during the await', async mode => {
    for (const succeeds of [true, false]) {
      const h = harness()
      h.primary.search.mockImplementation(async () => {
        await Promise.resolve()
        if (mode === 'caller') h.controller.abort()
        else h.canContinue.mockReturnValue(false)
        if (!succeeds) throw new WebError('private invalidation body', 'WEB_PROVIDER_UNAVAILABLE')
        return answer
      })
      await expect(routeSearchTools(request, h.controller.signal, h)).rejects.toMatchObject({ code: mode === 'caller' ? 'WEB_ABORTED' : 'WEB_PROVIDER_UNAVAILABLE' })
      expect(h.fallback.search).not.toHaveBeenCalled()
    }
  })

  it('checks ownership immediately before final dispatch, not only after primary rejection', async () => {
    const h = harness()
    h.primary.search.mockRejectedValue(new Error('private failure'))
    let checksAfterPrimary = 0
    h.canContinue.mockImplementation(() => h.primary.search.mock.calls.length === 0 || ++checksAfterPrimary < 2)
    await expect(routeSearchTools(request, h.controller.signal, h)).rejects.toMatchObject({ code: 'WEB_PROVIDER_UNAVAILABLE' })
    expect(h.fallback.search).not.toHaveBeenCalled()
  })

  it.each(['caller', 'proof'])('rejects final fallback success or failure after %s expires', async mode => {
    for (const succeeds of [true, false]) {
      const h = harness()
      h.primary.search.mockRejectedValue(new Error('primary unavailable'))
      h.fallback.search.mockImplementation(async () => {
        await Promise.resolve()
        if (mode === 'caller') h.controller.abort()
        else h.canContinue.mockReturnValue(false)
        if (!succeeds) throw new Error('private fallback body')
        return answer
      })
      const error = await rejected(routeSearchTools(request, h.controller.signal, h))
      expect(error.code).toBe(mode === 'caller' ? 'WEB_ABORTED' : 'WEB_PROVIDER_UNAVAILABLE')
      expect(error.message).not.toContain('private fallback body')
      expect(h.primary.search).toHaveBeenCalledOnce()
      expect(h.fallback.search).toHaveBeenCalledOnce()
    }
  })

  it('treats final provider cancellation as terminal without relabeling it a billable failure', async () => {
    const h = harness()
    h.primary.search.mockRejectedValue(new Error('primary unavailable'))
    h.fallback.search.mockRejectedValue(new WebError('private abort body', 'WEB_ABORTED'))
    const error = await rejected(routeSearchTools(request, undefined, h))
    expect(error.code).toBe('WEB_ABORTED')
    expect(error.message).not.toMatch(/private|charges/)
    expect(h.fallback.search).toHaveBeenCalledOnce()
  })

  it('treats a throwing ownership guard as terminal without leaking its message', async () => {
    const h = harness()
    h.canContinue.mockImplementation(() => { throw new Error('private ownership body') })
    const error = await rejected(routeSearchTools(request, h.controller.signal, h))
    expect(error.code).toBe('WEB_PROVIDER_UNAVAILABLE')
    expect(error.message).not.toContain('private ownership body')
    expect(h.primary.search).not.toHaveBeenCalled()
    expect(h.fallback.search).not.toHaveBeenCalled()
  })

  it('does not dispatch when cancellation occurs inside the ownership check', async () => {
    const h = harness()
    h.canContinue.mockImplementation(() => { h.controller.abort(); return true })
    await expect(routeSearchTools(request, h.controller.signal, h)).rejects.toMatchObject({ code: 'WEB_ABORTED' })
    expect(h.primary.search).not.toHaveBeenCalled()
    expect(h.fallback.search).not.toHaveBeenCalled()
  })

  it('handles synchronous primary and fallback throws without raw diagnostics', async () => {
    const h = harness()
    h.primary.search.mockImplementation(() => { throw new Error('private primary body') })
    h.fallback.search.mockImplementation(() => { throw new Error('private fallback body') })
    const error = await rejected(routeSearchTools(request, h.controller.signal, h))
    expect(error.message).toContain('final-search')
    expect(error.message).not.toContain('private')
    expect(h.primary.search).toHaveBeenCalledOnce()
    expect(h.fallback.search).toHaveBeenCalledOnce()
  })

  it('retains captured final provider identity and dispatch when a registration object changes during primary work', async () => {
    const h = harness()
    const originalFallback = h.fallback.search
    const replacement = vi.fn(async () => answer)
    h.primary.search.mockImplementation(async () => {
      h.fallback.id = 'replacement-search'
      h.fallback.search = replacement
      throw new Error('primary unavailable')
    })
    const result = await routeSearchTools(request, h.controller.signal, h)
    expect(result.content).toContain('final-search')
    expect(result.content).not.toContain('replacement-search')
    expect(originalFallback).toHaveBeenCalledOnce()
    expect(replacement).not.toHaveBeenCalled()
  })

  it('keeps concurrent calls and their captured providers independent', async () => {
    const a = harness(), b = harness()
    a.primary.search.mockRejectedValue(new Error('unavailable'))
    const [fallbackResult, primaryResult] = await Promise.all([
      routeSearchTools(request, a.controller.signal, a),
      routeSearchTools({ query: 'other session' }, b.controller.signal, b),
    ])
    expect(fallbackResult.content).toContain('fallback')
    expect(primaryResult).toBe(answer)
    expect(a.fallback.search).toHaveBeenCalledOnce()
    expect(b.fallback.search).not.toHaveBeenCalled()
  })
})
