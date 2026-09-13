import { describe, expect, it, vi } from 'vitest'
import { WebError } from '@deepseek-ai/dsh-web'
import type { WebSearchProvider, WebSearchResult } from '@deepseek-ai/dsh-web'
import { routeSessionSearch } from '../src/search-routing.ts'
import { DescribedSearchFallbackError } from '../src/search-backend.ts'

const answer: WebSearchResult = { content: 'answer', sources: [{ url: 'https://example.com' }], truncated: false }
const request = { query: 'current release', maxResults: 3 }
const signal = new AbortController().signal
function harness(provider = 'github-copilot-preview', fallback: 'none' | 'deepseek' = 'none') {
  const copilot: WebSearchProvider = { id: 'github-copilot-hosted', available: () => true, search: vi.fn(async () => answer) }
  const deepseek: WebSearchProvider = { id: 'deepseek-official', available: () => true, search: vi.fn(async () => answer) }
  return {
    selection: { provider, model: 'account-discovered-model' },
    managedOwned: true,
    fallback,
    copilot,
    delegate: vi.fn(async () => answer),
    resolveDeepSeek: vi.fn(async () => deepseek),
    canContinue: vi.fn(() => true),
    deepseek,
  }
}

describe('session search routing', () => {
  it.each(['deepseek-official', 'openai', 'anthropic', 'custom'])('preserves %s delegation without checking Copilot or fallback', async provider => {
    const deps = harness(provider, 'deepseek')
    const available = vi.spyOn(deps.copilot, 'available')
    const result = await routeSessionSearch(request, signal, deps)
    expect(result.result).toBe(answer)
    expect(result.routing).toBeUndefined()
    expect(deps.delegate).toHaveBeenCalledExactlyOnceWith(request, signal)
    expect(available).not.toHaveBeenCalled()
    expect(deps.resolveDeepSeek).not.toHaveBeenCalled()
    expect(deps.canContinue).not.toHaveBeenCalled()
  })

  it('does not claim an unowned preview route or missing selection', async () => {
    const deps = harness()
    deps.managedOwned = false
    expect((await routeSessionSearch(request, signal, deps)).routing).toBeUndefined()
    expect((await routeSessionSearch(request, signal, { ...deps, selection: undefined })).routing).toBeUndefined()
    expect(deps.copilot.search).not.toHaveBeenCalled()
  })

  it.each(['github-copilot', 'github-copilot-preview'])('uses Copilot for %s and retains the captured model', async provider => {
    const deps = harness(provider, 'deepseek')
    const result = await routeSessionSearch(request, signal, deps)
    expect(result.result).toBe(answer)
    expect(result.routing).toEqual({ requestedProvider: 'github-copilot-hosted', actualProvider: 'github-copilot-hosted', model: 'account-discovered-model', fallback: false })
    expect(deps.delegate).not.toHaveBeenCalled()
    expect(deps.resolveDeepSeek).not.toHaveBeenCalled()
  })

  it('does not spend fallback credits unless explicitly enabled', async () => {
    const deps = harness()
    const error = new WebError('synthetic capability failure', 'WEB_PROVIDER_UNAVAILABLE')
    vi.mocked(deps.copilot.search).mockRejectedValue(error)
    await expect(routeSessionSearch(request, signal, deps)).rejects.toBe(error)
    expect(deps.resolveDeepSeek).not.toHaveBeenCalled()
  })

  it('labels a permitted fallback with its real provider, reason and billing warning', async () => {
    const deps = harness('github-copilot-preview', 'deepseek')
    vi.mocked(deps.copilot.search).mockRejectedValue(new WebError('upstream secret-body must not escape', 'WEB_PROVIDER_ERROR'))
    const result = await routeSessionSearch(request, signal, deps)
    expect(result.routing).toMatchObject({ actualProvider: 'deepseek-official', fallback: true, reason: 'WEB_PROVIDER_ERROR' })
    expect(result.result.content).toContain('deepseek-official')
    expect(result.result.content).toContain('DeepSeek API charges')
    expect(result.result.content).not.toContain('secret-body')
    expect(result.result.sources).toEqual(answer.sources)
    expect(answer.content).toBe('answer')
    expect(deps.deepseek.search).toHaveBeenCalledExactlyOnceWith(request, signal)
    expect(deps.delegate).not.toHaveBeenCalled()
  })

  it('does not fallback when the primary reports cancellation', async () => {
    const deps = harness('github-copilot-preview', 'deepseek')
    vi.mocked(deps.copilot.search).mockRejectedValue(new WebError('provider cancellation', 'WEB_ABORTED'))
    await expect(routeSessionSearch(request, signal, deps)).rejects.toMatchObject({ code: 'WEB_ABORTED' })
    expect(deps.resolveDeepSeek).not.toHaveBeenCalled()
  })

  it('discloses a failed fallback without leaking either upstream error body', async () => {
    const deps = harness('github-copilot-preview', 'deepseek')
    vi.mocked(deps.copilot.search).mockRejectedValue(new WebError('private Copilot body', 'WEB_PROVIDER_ERROR'))
    vi.mocked(deps.deepseek.search).mockRejectedValue(new Error('private DeepSeek body'))
    await expect(routeSessionSearch(request, signal, deps)).rejects.toThrow('DeepSeek fallback also failed')
    expect(deps.deepseek.search).toHaveBeenCalledOnce()
    expect(deps.delegate).not.toHaveBeenCalled()
  })

  it('retains safe configured backend details when fallback fails', async () => {
    const deps = harness('github-copilot-preview', 'deepseek')
    vi.mocked(deps.copilot.search).mockRejectedValue(new WebError('private primary error', 'WEB_PROVIDER_ERROR'))
    vi.mocked(deps.deepseek.search).mockRejectedValue(new DescribedSearchFallbackError({
      provider: 'deepseek-official', origin: 'https://custom-search.example', model: 'actual-search-model', customEndpoint: true,
    }))
    const error = await routeSessionSearch(request, signal, deps).catch(error => error)
    expect(String(error)).toContain('origin=https://custom-search.example')
    expect(String(error)).toContain('model="actual-search-model"')
    expect(String(error)).toContain('endpoint=custom')
    expect(String(error)).not.toContain('private primary error')
  })

  it('never falls back merely because a successful search has no sources', async () => {
    const deps = harness('github-copilot-preview', 'deepseek')
    vi.mocked(deps.copilot.search).mockResolvedValue({ sources: [], truncated: false })
    expect((await routeSessionSearch(request, signal, deps)).routing?.fallback).toBe(false)
    expect(deps.resolveDeepSeek).not.toHaveBeenCalled()
  })

  it('does not start primary or fallback requests after caller cancellation', async () => {
    const deps = harness('github-copilot-preview', 'deepseek')
    const controller = new AbortController()
    controller.abort()
    await expect(routeSessionSearch(request, controller.signal, deps)).rejects.toMatchObject({ code: 'WEB_ABORTED' })
    expect(deps.copilot.search).not.toHaveBeenCalled()
    expect(deps.resolveDeepSeek).not.toHaveBeenCalled()
  })

  it.each(['caller', 'proof'])('does not fallback when %s expires during primary work', async mode => {
    const deps = harness('github-copilot-preview', 'deepseek')
    const controller = new AbortController()
    vi.mocked(deps.copilot.search).mockImplementation(async () => {
      if (mode === 'caller') controller.abort()
      else deps.canContinue.mockReturnValue(false)
      throw new WebError('cancelled ownership', 'WEB_PROVIDER_UNAVAILABLE')
    })
    await expect(routeSessionSearch(request, controller.signal, deps)).rejects.toBeInstanceOf(WebError)
    expect(deps.resolveDeepSeek).not.toHaveBeenCalled()
  })

  it('does not leak stale successful results after proof invalidation', async () => {
    const deps = harness()
    vi.mocked(deps.copilot.search).mockImplementation(async () => {
      deps.canContinue.mockReturnValue(false)
      return answer
    })
    await expect(routeSessionSearch(request, signal, deps)).rejects.toMatchObject({ code: 'WEB_PROVIDER_UNAVAILABLE' })
  })

  it('checks cancellation again after resolving the fallback provider', async () => {
    const deps = harness('github-copilot-preview', 'deepseek')
    vi.mocked(deps.copilot.search).mockRejectedValue(new WebError('no capability', 'WEB_PROVIDER_UNAVAILABLE'))
    deps.resolveDeepSeek.mockImplementation(async () => {
      deps.canContinue.mockReturnValue(false)
      return deps.deepseek
    })
    await expect(routeSessionSearch(request, signal, deps)).rejects.toMatchObject({ code: 'WEB_PROVIDER_UNAVAILABLE' })
    expect(deps.deepseek.search).not.toHaveBeenCalled()
  })

  it('refuses an unknown fallback backend instead of mislabelling it DeepSeek', async () => {
    const deps = harness('github-copilot-preview', 'deepseek')
    vi.mocked(deps.copilot.search).mockRejectedValue(new WebError('no capability', 'WEB_PROVIDER_UNAVAILABLE'))
    deps.resolveDeepSeek.mockResolvedValue({ ...deps.deepseek, id: 'another-provider' })
    await expect(routeSessionSearch(request, signal, deps)).rejects.toThrow('DeepSeek fallback')
    expect(deps.deepseek.search).not.toHaveBeenCalled()
  })

  it('keeps simultaneous Copilot and DeepSeek operations independent', async () => {
    const a = harness('github-copilot-preview')
    const b = harness('deepseek-official')
    const [ra, rb] = await Promise.all([routeSessionSearch(request, signal, a), routeSessionSearch({ query: 'different session' }, signal, b)])
    expect(ra.routing?.actualProvider).toBe('github-copilot-hosted')
    expect(rb.routing).toBeUndefined()
    expect(a.delegate).not.toHaveBeenCalled()
    expect(b.copilot.search).not.toHaveBeenCalled()
  })
})
