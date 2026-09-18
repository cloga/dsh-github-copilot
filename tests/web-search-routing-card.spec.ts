import * as React from 'react'
import type { ReactElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebSearchRoutingCard } from '../src/web-search-routing-card.ts'

// As in client.spec.ts: real elements, deterministic hooks and effect disposal.
// This exercises component behavior, not a browser or live Settings service.
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>()
  return { ...actual, useState: vi.fn(actual.useState), useEffect: vi.fn(actual.useEffect),
    useCallback: vi.fn(actual.useCallback), useRef: vi.fn(actual.useRef), useMemo: vi.fn(actual.useMemo) }
})

const ROUTING = 'github-copilot-search-routing'
const COPILOT = 'github-copilot'
const HOSTED = 'github-copilot-hosted'
const cleanups: Array<() => void> = []
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); vi.resetAllMocks() })

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}
function namespace(ns: string, revision: number, value: Record<string, string> = {}) {
  return { ns, revision, value, schema: {}, applies: 'live' as const, secrets: [] }
}
function settingsValue(provider = 'deepseek-official') {
  return { writable: true, hasDocument: true, namespaces: [
    namespace(ROUTING, 4, { searchMode: 'auto', defaultSearchProvider: provider }),
    namespace(COPILOT, 7, { searchModel: 'responses-model' }),
  ] }
}
function ok<T>(value: T) { return { ok: true as const, value } }
const failure = () => ({ ok: false as const, error: { code: 'FAILED', message: 'PRIVATE_REMOTE_ERROR' } })
function remotes(provider?: string) {
  return {
    routing: { providers: vi.fn(async () => ok({ supported: true, providers: [...new Set([
      'deepseek-official', HOSTED, 'exa', 'custom-provider', 'draft-provider', 'concurrent-provider',
      'replacement-provider', 'new-provider', ...(provider && provider !== 'none' && provider !== 'auto' ? [provider] : []),
    ])].map(id => ({ id })) })) },
    settings: { describe: vi.fn(async () => ok(settingsValue(provider))),
      mutate: vi.fn(async (_ns: string, _ops: unknown, revision?: number) => ok(namespace(_ns, (revision ?? 0) + 1))) },
    copilot: { status: vi.fn(async () => ok({ phase: 'signed-in', configured: true, writable: true,
      inFlight: false, notices: [], accountModels: { state: 'ready', rejected: [], models: [
        { id: 'responses-model', name: 'Responses model', api: 'openai-responses' },
        { id: 'other-model', name: 'Other model', api: 'anthropic-messages' },
      ] } })) },
  }
}
function descendants(root: unknown): ReactElement[] {
  if (Array.isArray(root)) return root.flatMap(descendants)
  if (!React.isValidElement(root)) return []
  const element = root as ReactElement<{ children?: unknown }>
  return [element, ...descendants(element.props.children)]
}
function text(root: unknown): string {
  if (Array.isArray(root)) return root.map(text).join(' ')
  if (React.isValidElement(root)) return text((root as ReactElement<{ children?: unknown }>).props.children)
  return typeof root === 'string' ? root : ''
}
function field(tree: ReactElement, name: string): ReactElement {
  const node = descendants(tree).find(element => element.props[`data-dsh-${name}`] === true)
  expect(node, name).toBeDefined()
  return node!
}
function change(tree: ReactElement, name: string, value: string) {
  // React clears currentTarget before a deferred functional updater runs.
  const event: { currentTarget: { value: string } | null } = { currentTarget: { value } }
  field(tree, name).props.onChange(event)
  event.currentTarget = null
}
function click(tree: ReactElement, name: string) { field(tree, name).props.onClick() }
function harness(initial = remotes()) {
  let remote = initial
  const states: unknown[] = []
  const setters: ReturnType<typeof vi.fn>[] = []
  const refs: Array<{ current: unknown }> = []
  const memos: Array<{ deps: React.DependencyList | undefined; value: unknown }> = []
  const effects: Array<{ deps: React.DependencyList | undefined; cleanup?: (() => void) | undefined }> = []
  let updates: Array<() => void> = []
  let pending: Array<() => void> = []
  let mounted = true
  const changed = (a?: React.DependencyList, b?: React.DependencyList) => !a || !b || a.length !== b.length || a.some((value, i) => !Object.is(value, b[i]))
  const renderOnce = () => {
    for (const update of updates.splice(0)) update()
    let stateIndex = 0, refIndex = 0, effectIndex = 0, memoIndex = 0
    vi.mocked(React.useState).mockImplementation((initial?: unknown): ReturnType<typeof React.useState> => {
      const index = stateIndex++
      if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial
      setters[index] ??= vi.fn((value: unknown) => {
        if (typeof value === 'function') updates.push(() => { states[index] = value(states[index]) })
        else states[index] = value
      })
      return [states[index], setters[index]!]
    })
    vi.mocked(React.useRef).mockImplementation((initial?: unknown) => refs[refIndex++] ??= { current: initial })
    const memo = (factory: () => unknown, deps?: React.DependencyList) => {
      const index = memoIndex++
      if (!memos[index] || changed(deps, memos[index]?.deps)) memos[index] = { deps, value: factory() }
      return memos[index]!.value
    }
    vi.mocked(React.useCallback).mockImplementation((callback, deps) => memo(() => callback, deps) as typeof callback)
    vi.mocked(React.useMemo).mockImplementation((factory, deps) => memo(factory, deps))
    vi.mocked(React.useEffect).mockImplementation((setup, deps) => {
      const index = effectIndex++
      const previous = effects[index]
      if (!previous || changed(deps, previous.deps)) pending.push(() => {
        previous?.cleanup?.()
        const cleanup = setup()
        effects[index] = { deps, cleanup: typeof cleanup === 'function' ? cleanup : undefined }
      })
    })
    return WebSearchRoutingCard(remote as never)
  }
  const render = (next = remote) => {
    if (!mounted) throw new Error('test card is unmounted')
    remote = next
    let tree = renderOnce()
    const queued = pending.splice(0)
    for (const effect of queued) effect()
    if (queued.length) tree = renderOnce()
    return tree
  }
  const unmount = () => {
    if (!mounted) return
    mounted = false
    for (const effect of effects) effect.cleanup?.()
  }
  cleanups.push(unmount)
  return { render, unmount, setters, remote }
}
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve() }
async function ready(remote = remotes()) {
  const card = harness(remote)
  card.render()
  await settle()
  return card
}

describe('independent Web search Settings card', () => {
  it.each([true, false])('themes both provider selects and every option without changing settings (writable=%s)', async writable => {
    const remote = remotes(), value = settingsValue()
    value.writable = writable
    remote.settings.describe.mockResolvedValue(ok(value))
    const card = await ready(remote)
    for (const name of ['web-search-mode', 'web-search-provider']) {
      const control = field(card.render(), name)
      expect(control.props.style.backgroundColor).toBe('var(--dsw-alias-bg-layer-1, Canvas)')
      expect(control.props.style.color).toBe(writable ? 'var(--dsw-alias-label-primary, CanvasText)' : 'var(--dsw-alias-label-secondary, GrayText)')
      for (const option of descendants(control).filter(item => item.type === 'option')) {
        expect(option.props.style.backgroundColor).toBe('var(--dsw-alias-bg-layer-1, Canvas)')
        expect(option.props.style.color).toBe(option.props.disabled ? 'var(--dsw-alias-label-secondary, GrayText)' : 'var(--dsw-alias-label-primary, CanvasText)')
      }
    }
    expect(remote.settings.mutate).not.toHaveBeenCalled()
  })

  it('themes saved disabled and unavailable provider options without substituting them', async () => {
    const remote = remotes(), value = settingsValue('retired-provider')
    value.namespaces[0]!.value.searchProvider = 'none'
    remote.settings.describe.mockResolvedValue(ok(value))
    const card = await ready(remote)
    const primary = field(card.render(), 'web-search-mode'), fallback = field(card.render(), 'web-search-provider')
    expect(primary.props.value).toBe('none')
    expect(fallback.props.value).toBe('retired-provider')
    const savedOff = descendants(primary).find(item => item.type === 'option' && item.props.value === 'none')!
    const unavailable = descendants(fallback).find(item => item.type === 'option' && item.props.value === 'retired-provider')!
    expect(savedOff.props.style.backgroundColor).toBe('var(--dsw-alias-bg-layer-1, Canvas)')
    expect(savedOff.props.style.color).toBe('var(--dsw-alias-label-primary, CanvasText)')
    expect(unavailable.props.disabled).toBe(true)
    expect(unavailable.props.style.backgroundColor).toBe('var(--dsw-alias-bg-layer-1, Canvas)')
    expect(unavailable.props.style.color).toBe('var(--dsw-alias-label-secondary, GrayText)')
    expect(remote.settings.mutate).not.toHaveBeenCalled()
  })
  it.each(['rejected', 'unsupported', 'malformed'] as const)('does not invent provider options when the catalog is %s', async kind => {
    const remote = remotes()
    if (kind === 'rejected') remote.routing.providers.mockRejectedValueOnce(new Error('PRIVATE_CATALOG_ERROR'))
    else remote.routing.providers.mockResolvedValueOnce(ok(kind === 'unsupported'
      ? { supported: false, providers: [] }
      : { supported: true, providers: [{ id: 'injected', secret: 'PRIVATE_CATALOG_ERROR' }] }) as never)
    const card = await ready(remote)
    expect(text(card.render())).toContain('Search provider list is unavailable')
    expect(text(card.render())).not.toContain('PRIVATE_')
    expect(field(card.render(), 'web-search-save').props.disabled).toBe(true)
    expect(descendants(card.render()).some(node => node.type === 'option' && node.props.value === 'exa')).toBe(false)
    click(card.render(), 'web-search-reload'); await settle()
    expect(field(card.render(), 'web-search-save').props.disabled).toBe(false)
  })

  it('retains an unavailable saved provider until the user explicitly replaces it', async () => {
    const remote = remotes('retired-provider')
    remote.routing.providers.mockResolvedValue(ok({ supported: true, providers: [{ id: 'custom-provider' }] }))
    const card = await ready(remote)
    expect(field(card.render(), 'web-search-provider').props.value).toBe('retired-provider')
    expect(text(card.render())).toContain('retired-provider — unavailable')
    expect(field(card.render(), 'web-search-save').props.disabled).toBe(true)
    expect(remote.settings.mutate).not.toHaveBeenCalled()
    change(card.render(), 'web-search-provider', 'custom-provider')
    expect(field(card.render(), 'web-search-save').props.disabled).toBe(false)
  })

  it('reads legacy fixed and disabled choices without migration writes', async () => {
    const remote = remotes('none'), value = settingsValue('none')
    value.namespaces[0]!.value.searchMode = 'fixed'
    remote.settings.describe.mockResolvedValue(ok(value))
    const card = await ready(remote)
    expect(field(card.render(), 'web-search-mode').props.value).toBe('none')
    expect(field(card.render(), 'web-search-provider').props.value).toBe('none')
    expect(remote.settings.mutate).not.toHaveBeenCalled()
  })

  it('uses the new primary over legacy mode and edits Copilot models for a fixed primary', async () => {
    const remote = remotes('exa'), value = settingsValue('exa')
    value.namespaces[0]!.value.searchMode = 'auto'
    value.namespaces[0]!.value.searchProvider = HOSTED
    remote.settings.describe.mockResolvedValue(ok(value))
    const card = await ready(remote)
    expect(field(card.render(), 'web-search-mode').props.value).toBe(HOSTED)
    expect(field(card.render(), 'copilot-search-model').props.value).toBe('responses-model')
    expect(field(card.render(), 'web-search-provider').props.value).toBe('exa')
  })
  it('loads one actual provider catalog into both selectors without Copilot-specific Auto labels', async () => {
    const card = await ready(remotes(HOSTED))
    const tree = card.render()
    expect(text(tree)).toContain('Web search')
    expect(text(tree)).not.toContain('native Copilot search first')
    expect(field(tree, 'web-search-provider').type).toBe('select')
    const options = (name: string) => descendants(field(tree, name)).filter(node => node.type === 'option').map(node => node.props.value)
    expect(options('web-search-mode').filter(value => value !== 'auto')).toEqual(options('web-search-provider').filter(value => value !== 'none'))
    expect(options('web-search-mode')).toContain('custom-provider')
    expect(options('web-search-mode')).not.toContain('perplexity')
    expect(text(tree)).toMatch(/suggestions.*not.*capability/i)
    expect(field(tree, 'web-search-mode').props.value).toBe('auto')
    expect(field(tree, 'copilot-search-model').props.value).toBe('responses-model')
    expect(descendants(tree).some(node => node.type === 'option' && node.props.value === 'other-model')).toBe(false)
    expect(card.remote.settings.mutate).not.toHaveBeenCalled()
  })

  it('captures event values before deferred state updates and saves arbitrary provider IDs with narrow CAS', async () => {
    const card = await ready()
    change(card.render(), 'web-search-mode', 'custom-provider')
    change(card.render(), 'web-search-provider', 'exa')
    click(card.render(), 'web-search-save')
    await settle()
    expect(card.remote.settings.mutate).toHaveBeenCalledExactlyOnceWith(ROUTING, [
      { op: 'set', path: ['searchProvider'], value: 'custom-provider' },
      { op: 'set', path: ['defaultSearchProvider'], value: 'exa' },
    ], 4)
    expect(text(card.render())).toContain('Saved.')
    expect(descendants(card.render()).some(node => node.props['data-dsh-copilot-search-model'])).toBe(false)
  })

  it.each(['rejected', 'returned'] as const)('ends failed settings loading and supports explicit retry: %s', async kind => {
    const remote = remotes()
    if (kind === 'rejected') remote.settings.describe.mockRejectedValueOnce(new Error('PRIVATE_RPC_ERROR'))
    else remote.settings.describe.mockResolvedValueOnce(failure() as never)
    const card = await ready(remote)
    let tree = card.render()
    expect(text(tree)).not.toContain('Loading…')
    expect(text(tree)).not.toContain('PRIVATE_')
    expect(field(tree, 'web-search-save').props.disabled).toBe(true)
    click(tree, 'web-search-reload')
    await settle()
    tree = card.render()
    expect(field(tree, 'web-search-save').props.disabled).toBe(false)
    expect(remote.settings.describe).toHaveBeenCalledTimes(2)
  })

  it('does not block routing on rejected or pending optional account suggestions, and clears old suggestions', async () => {
    const remote = remotes(HOSTED)
    const card = await ready(remote)
    expect(descendants(card.render()).some(node => node.type === 'option' && node.props.value === 'responses-model')).toBe(true)
    remote.copilot.status.mockRejectedValueOnce(new Error('PRIVATE_STATUS_ERROR'))
    click(card.render(), 'web-search-reload')
    await settle()
    expect(field(card.render(), 'web-search-save').props.disabled).toBe(false)
    expect(descendants(card.render()).some(node => node.type === 'option' && node.props.value === 'responses-model')).toBe(false)
    expect(text(card.render())).not.toContain('PRIVATE_')
    const pending = deferred<Awaited<ReturnType<typeof remote.copilot.status>>>()
    remote.copilot.status.mockReturnValueOnce(pending.promise)
    click(card.render(), 'web-search-reload')
    await settle()
    expect(field(card.render(), 'web-search-save').props.disabled).toBe(false)
    card.unmount()
    pending.resolve(ok({ phase: 'signed-in', configured: true, writable: true, inFlight: false, notices: [],
      accountModels: { state: 'ready', rejected: [], models: [] } }))
    await settle()
  })

  it.each(['readonly', 'missing-routing', 'missing-revision'] as const)('refuses unchecked writes for %s', async kind => {
    const remote = remotes()
    const value = settingsValue()
    if (kind === 'readonly') value.writable = false
    else if (kind === 'missing-routing') value.namespaces = value.namespaces.filter(entry => entry.ns !== ROUTING)
    else value.namespaces[0]!.revision = undefined as never
    remote.settings.describe.mockResolvedValue(ok(value))
    const card = await ready(remote)
    expect(field(card.render(), 'web-search-save').props.disabled).toBe(true)
    click(card.render(), 'web-search-save')
    await settle()
    expect(remote.settings.mutate).not.toHaveBeenCalled()
  })

  it('requires the Copilot namespace only for Copilot routing and captures the model input eagerly', async () => {
    const remote = remotes(HOSTED)
    const value = settingsValue(HOSTED)
    value.namespaces = value.namespaces.filter(entry => entry.ns !== COPILOT)
    remote.settings.describe.mockResolvedValueOnce(ok(value))
    const card = await ready(remote)
    expect(field(card.render(), 'web-search-save').props.disabled).toBe(true)
    click(card.render(), 'web-search-save')
    expect(remote.settings.mutate).not.toHaveBeenCalled()
    change(card.render(), 'web-search-provider', 'exa')
    expect(field(card.render(), 'web-search-save').props.disabled).toBe(false)
    click(card.render(), 'web-search-reload')
    await settle()
    change(card.render(), 'copilot-search-model', 'future-responses-model')
    expect(field(card.render(), 'copilot-search-model').props.value).toBe('future-responses-model')
  })

  it.each(['rejected', 'returned'] as const)('retains partial-save Copilot revision for a safe retry after routing failure: %s', async kind => {
    const remote = remotes(HOSTED)
    remote.settings.mutate.mockResolvedValueOnce(ok(namespace(COPILOT, 8)))
    if (kind === 'rejected') remote.settings.mutate.mockRejectedValueOnce(new Error('PRIVATE_SAVE_ERROR'))
    else remote.settings.mutate.mockResolvedValueOnce(failure() as never)
    const card = await ready(remote)
    click(card.render(), 'web-search-save')
    await settle()
    expect(text(card.render())).toContain('Copilot search model was saved')
    expect(text(card.render())).not.toContain('PRIVATE_')
    expect(field(card.render(), 'web-search-save').props.disabled).toBe(false)
    click(card.render(), 'web-search-save')
    await settle()
    expect(remote.settings.mutate.mock.calls[2]).toEqual([COPILOT, [
      { op: 'set', path: ['searchModel'], value: 'responses-model' },
    ], 8])
    expect(remote.settings.mutate.mock.calls[3]?.[2]).toBe(4)
    expect(text(card.render())).toContain('Saved.')
  })

  it.each(['rejected', 'returned'] as const)('stops at failed model save, permits retry and does not write routing: %s', async kind => {
    const remote = remotes(HOSTED)
    if (kind === 'rejected') remote.settings.mutate.mockRejectedValueOnce(new Error('PRIVATE_MODEL_ERROR'))
    else remote.settings.mutate.mockResolvedValueOnce(failure() as never)
    const card = await ready(remote)
    click(card.render(), 'web-search-save')
    await settle()
    expect(remote.settings.mutate).toHaveBeenCalledTimes(1)
    expect(text(card.render())).not.toContain('PRIVATE_')
    expect(field(card.render(), 'web-search-save').props.disabled).toBe(false)
    click(card.render(), 'web-search-save')
    await settle()
    expect(remote.settings.mutate.mock.calls[1]?.[2]).toBe(7)
    expect(text(card.render())).toContain('Saved.')
  })

  it('requires an explicit reload to adopt concurrent revisions without silently overwriting edits', async () => {
    const remote = remotes()
    remote.settings.mutate.mockResolvedValueOnce(failure() as never)
    const card = await ready(remote)
    change(card.render(), 'web-search-provider', 'draft-provider')
    click(card.render(), 'web-search-save')
    await settle()
    expect(field(card.render(), 'web-search-provider').props.value).toBe('draft-provider')
    expect(remote.settings.describe).toHaveBeenCalledTimes(1)
    const refreshed = settingsValue('concurrent-provider')
    refreshed.namespaces[0]!.revision = 9
    remote.settings.describe.mockResolvedValueOnce(ok(refreshed))
    click(card.render(), 'web-search-reload')
    await settle()
    expect(field(card.render(), 'web-search-provider').props.value).toBe('concurrent-provider')
    click(card.render(), 'web-search-save')
    await settle()
    expect(remote.settings.mutate.mock.calls[1]?.[2]).toBe(9)
  })

  it('rejects blank providers and Copilot models but allows none without a Copilot write', async () => {
    const card = await ready(remotes(HOSTED))
    change(card.render(), 'copilot-search-model', '  ')
    click(card.render(), 'web-search-save')
    expect(text(card.render())).toContain('Enter a Copilot Responses model')
    change(card.render(), 'web-search-provider', ' ')
    click(card.render(), 'web-search-save')
    expect(text(card.render())).toContain('Choose a registered search provider')
    expect(card.remote.settings.mutate).not.toHaveBeenCalled()
    change(card.render(), 'web-search-provider', 'none')
    click(card.render(), 'web-search-save')
    await settle()
    expect(card.remote.settings.mutate).toHaveBeenCalledExactlyOnceWith(ROUTING, [
      { op: 'set', path: ['searchProvider'], value: 'auto' },
      { op: 'set', path: ['defaultSearchProvider'], value: 'none' },
    ], 4)
  })

  it.each(['resolve', 'reject'] as const)('ignores final routing save %s after unmount', async outcome => {
    const remote = remotes()
    const pending = deferred<Awaited<ReturnType<typeof remote.settings.mutate>>>()
    remote.settings.mutate.mockReturnValueOnce(pending.promise)
    const card = await ready(remote)
    click(card.render(), 'web-search-save')
    card.unmount()
    const counts = card.setters.map(setter => setter.mock.calls.length)
    if (outcome === 'resolve') pending.resolve(ok(namespace(ROUTING, 5)))
    else pending.reject(new Error('PRIVATE_LATE_SAVE'))
    await settle()
    expect(card.setters.map(setter => setter.mock.calls.length)).toEqual(counts)
  })

  it.each(['resolve', 'reject'] as const)('ignores late load %s after unmount', async outcome => {
    const remote = remotes()
    const pending = deferred<Awaited<ReturnType<typeof remote.settings.describe>>>()
    remote.settings.describe.mockReturnValueOnce(pending.promise)
    const card = harness(remote)
    card.render()
    await settle()
    card.unmount()
    const counts = card.setters.map(setter => setter.mock.calls.length)
    if (outcome === 'resolve') pending.resolve(ok(settingsValue()))
    else pending.reject(new Error('PRIVATE_LATE_LOAD'))
    await settle()
    expect(card.setters.map(setter => setter.mock.calls.length)).toEqual(counts)
  })

  it('ignores stale loads and suggestions when Remote declarations are replaced', async () => {
    const old = remotes(HOSTED)
    const load = deferred<Awaited<ReturnType<typeof old.settings.describe>>>()
    const account = deferred<Awaited<ReturnType<typeof old.copilot.status>>>()
    old.settings.describe.mockReturnValueOnce(load.promise)
    old.copilot.status.mockReturnValueOnce(account.promise)
    const card = harness(old)
    card.render()
    const next = remotes('replacement-provider')
    card.render(next)
    await settle()
    const counts = card.setters.map(setter => setter.mock.calls.length)
    load.resolve(ok(settingsValue(HOSTED)))
    account.reject(new Error('PRIVATE_OLD_ACCOUNT'))
    await settle()
    expect(card.setters.map(setter => setter.mock.calls.length)).toEqual(counts)
    expect(field(card.render(), 'web-search-provider').props.value).toBe('replacement-provider')
  })

  it.each(['unmount', 'replace'] as const)('does not continue two-namespace save or update state after %s', async disposal => {
    const remote = remotes(HOSTED)
    const pending = deferred<Awaited<ReturnType<typeof remote.settings.mutate>>>()
    remote.settings.mutate.mockReturnValueOnce(pending.promise)
    const card = await ready(remote)
    const tree = card.render()
    click(tree, 'web-search-save')
    click(tree, 'web-search-save')
    expect(remote.settings.mutate).toHaveBeenCalledTimes(1)
    if (disposal === 'unmount') card.unmount()
    else { card.render(remotes('new-provider')); await settle() }
    const counts = card.setters.map(setter => setter.mock.calls.length)
    pending.resolve(ok(namespace(COPILOT, 8)))
    await settle()
    expect(remote.settings.mutate).toHaveBeenCalledTimes(1)
    expect(card.setters.map(setter => setter.mock.calls.length)).toEqual(counts)
    if (disposal === 'replace') expect(field(card.render(), 'web-search-provider').props.value).toBe('new-provider')
  })
})
