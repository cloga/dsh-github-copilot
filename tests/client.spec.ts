import * as React from 'react'
import { isValidElement } from 'react'
import type { ReactElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GITHUB_COPILOT_PREVIEW_PROVIDER_ID, GITHUB_COPILOT_PROVIDER_ID } from '../src/copilot-identity.ts'
import type { GitHubCopilotAuthorizationView } from '../src/authorization-controller.ts'

// Element/lifecycle evidence, not a browser or live Remote integration. Keep the
// actual React element implementation and control only hooks exercised below.
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>()
  return { ...actual, useState: vi.fn(actual.useState), useEffect: vi.fn(actual.useEffect),
    useCallback: vi.fn(actual.useCallback), useRef: vi.fn(actual.useRef), useMemo: vi.fn(actual.useMemo),
    useSyncExternalStore: vi.fn(actual.useSyncExternalStore), useLayoutEffect: vi.fn(actual.useLayoutEffect), useId: vi.fn(actual.useId) }
})

const panelCleanups: Array<() => void> = []
afterEach(() => { for (const cleanup of panelCleanups.splice(0)) cleanup(); vi.resetAllMocks(); vi.useRealTimers() })
import {
  activeAuthorizationNotice,
  authorizationViewFrom,
  apply,
  catalogWarningOf,
  routeStatusMessage,
  copyAuthorizationCode,
  GitHubCopilotAuthorizationNotice,
  GitHubCopilotPreviewFooter,
  GitHubCopilotCompactAccount,
  GitHubCopilotProviderCard,
  GitHubCopilotAccountSurface,
  createAccountSurfaces,
  isGitHubCopilotAccountRow,
  GitHubCopilotSettingsSection,
  previewAssignmentMessage,
  GitHubCopilotAccountModelsPanel,
  GitHubCopilotAccountModelsSummary,
} from '../src/client.ts'

describe('GitHub Copilot Models client', () => {
  function descendants(root: unknown): ReactElement[] {
    if (Array.isArray(root)) return root.flatMap(descendants)
    if (!isValidElement(root)) return []
    const element = root as ReactElement<{ children?: unknown }>
    return [element, ...descendants(element.props.children)]
  }

  type AccountModels = NonNullable<GitHubCopilotAuthorizationView['accountModels']>
  function accountResult(accountModels?: AccountModels) {
    return { ok: true as const, value: { phase: 'signed-in' as const, configured: true, writable: true, inFlight: false, notices: [],
      ...accountModels === undefined ? {} : { accountModels },
    } }
  }
  function deferred<T>() {
    let resolve!: (value: T) => void
    let reject!: (reason: Error) => void
    const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
    return { promise, resolve, reject }
  }
  function modelRemote(discoverModels: ReturnType<typeof vi.fn> = vi.fn(async () => accountResult({ state: 'ready', models: [], rejected: [] }))) {
    return { discoverModels, ensureModels: vi.fn(async () => accountResult({ state: 'ready', models: [], rejected: [] })),
      status: vi.fn(), reconcile: vi.fn(), start: vi.fn(), cancel: vi.fn(), signOut: vi.fn() }
  }
  // Tiny deterministic hook host: component state/ref identity and effect cleanup,
  // without mounting a browser or invoking any real Remote implementation.
  function panelHarness(initialRemote: object) {
    let remote = initialRemote
    const states: unknown[] = []
    const setters: ReturnType<typeof vi.fn>[] = []
    const refs: Array<{ current: unknown }> = []
    const effects: Array<{ deps: React.DependencyList | undefined; cleanup?: (() => void) | undefined }> = []
    let pending: Array<() => void> = []
    let mounted = true
    const renderOnce = () => {
      let stateIndex = 0, refIndex = 0, effectIndex = 0
      vi.mocked(React.useState).mockImplementation((initial?: unknown): ReturnType<typeof React.useState> => {
        const index = stateIndex++
        if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial
        setters[index] ??= vi.fn((value: unknown) => { states[index] = typeof value === 'function' ? value(states[index]) : value })
        return [states[index], setters[index]!]
      })
      vi.mocked(React.useRef).mockImplementation((initial?: unknown) => {
        const index = refIndex++
        return refs[index] ??= { current: initial }
      })
      vi.mocked(React.useEffect).mockImplementation((setup, deps) => {
        const index = effectIndex++
        const previous = effects[index]
        if (!previous || !deps || !previous.deps || deps.length !== previous.deps.length || deps.some((value, at) => !Object.is(value, previous.deps?.[at]))) {
          pending.push(() => {
            previous?.cleanup?.()
            const cleanup = setup()
            effects[index] = { deps, cleanup: typeof cleanup === 'function' ? cleanup : undefined }
          })
        }
      })
      return GitHubCopilotAccountModelsPanel({ remote: remote as never })
    }
    const render = (nextRemote = remote) => {
      if (!mounted) throw new Error('test panel is unmounted')
      remote = nextRemote
      let tree = renderOnce()
      const queued = pending
      pending = []
      for (const effect of queued) effect()
      if (queued.length > 0) tree = renderOnce()
      return tree
    }
    const unmount = () => {
      if (!mounted) return
      mounted = false
      for (const effect of effects) effect.cleanup?.()
    }
    panelCleanups.push(unmount)
    return { render, unmount, setters }
  }
  function refreshButton(tree: ReactElement) {
    const button = descendants(tree).find(element => element.props['data-dsh-github-copilot-refresh-models'] === true)
    expect(button).toBeDefined()
    return button!
  }

  it('validates a field-safe authorization view without reading unknown credential fields', () => {
    const raw = Object.defineProperty({ ...accountResult().value,
      notices: [{ message: 'Continue on GitHub', url: 'https://github.com/login/device', code: 'ABCD-EFGH' }],
    }, 'accountKey', { enumerable: true, get() { throw new Error('do not read accountKey') } })
    const view = authorizationViewFrom(raw)
    expect(view?.configured).toBe(true)
    expect(view?.notices[0]?.url).toBe('https://github.com/login/device')
    expect(view === raw).toBe(false)
    expect(view).not.toHaveProperty('accountKey')
  })

  it.each([
    { phase: 'unexpected' }, { configured: 'true' }, { writable: undefined }, { inFlight: 1 }, { notices: {} },
    { notices: [{ message: 17 }] }, { accountModels: { state: 'ready', models: [{ id: 17, name: 'Invalid', api: 'openai-responses' }], rejected: [] } },
  ])('rejects malformed raw Remote view fields: %j', malformed => {
    expect(authorizationViewFrom({ ...accountResult().value, ...malformed })).toBeUndefined()
  })

  it.each(['javascript:alert(1)', 'data:text/html,hello', 'http://github.com/login/device', 'https://user:password@github.com/login/device'])('refuses an unsafe authorization link: %s', url => {
    expect(authorizationViewFrom({ ...accountResult().value, notices: [{ message: 'Continue', url }] })).toBeUndefined()
  })

  it('contains a throwing known view getter without exposing its value', () => {
    const raw = Object.defineProperty({ ...accountResult().value }, 'notices', { get() { throw new Error('PRIVATE_NOTICE_VALUE') } })
    expect(authorizationViewFrom(raw)).toBeUndefined()
  })

  it('does not accept a malformed status view into the authorization card', async () => {
    const setStatus = vi.fn(), setError = vi.fn()
    const effects: React.EffectCallback[] = []
    vi.mocked(React.useEffect).mockImplementation(setup => { effects.push(setup) })
    vi.mocked(React.useCallback).mockImplementation(callback => callback)
    vi.mocked(React.useRef).mockImplementation(initial => ({ current: initial }))
    vi.mocked(React.useState)
      .mockReturnValueOnce([undefined, setStatus]).mockReturnValueOnce([undefined, setError])
      .mockReturnValueOnce([false, vi.fn()]).mockReturnValueOnce(['idle', vi.fn()])
    const remote = { status: vi.fn(async () => ({ ok: true, value: { phase: 'signed-in', configured: 'invalid', writable: true, inFlight: false, notices: [] } })) }
    GitHubCopilotProviderCard({ provider: { provider: GITHUB_COPILOT_PROVIDER_ID, displayName: 'GitHub Copilot', settingsNs: 'llm-pi-ai' },
      configured: true, keyConfigured: false, remote: remote as never })
    const disposers = effects.map(setup => setup())
    await Promise.resolve()
    expect(setStatus).not.toHaveBeenCalled()
    expect(setError).toHaveBeenCalledWith('COPILOT_AUTHORIZATION_VIEW_INVALID')
    for (const dispose of disposers) if (typeof dispose === 'function') dispose()
  })

  it('distinguishes route repair and conflicts from authentication state', () => {
    const base = { configured: true, writable: true, inFlight: false, phase: 'signed-in' as const, notices: [] }
    expect(routeStatusMessage({ ...base, route: { state: 'needs-repair' } })).toContain('does not refresh GitHub access')
    expect(routeStatusMessage({ ...base, route: { state: 'needs-repair', diagnosticCode: 'RECONCILIATION_FAILED' } })).toContain('sign-in is retained')
    expect(routeStatusMessage({ ...base, route: { state: 'conflict' } })).toContain('without rolling back user edits')
    expect(routeStatusMessage({ ...base, route: { state: 'error' } })).toContain('sign-in is retained')
    expect(routeStatusMessage({ ...base, route: { state: 'not-configured' } })).toBeUndefined()
    expect(routeStatusMessage({ ...base, route: { state: 'ready' } })).toBeUndefined()
    expect(routeStatusMessage(undefined)).toBeUndefined()
  })

  it('exposes a device code only while authorization is in flight', () => {
    const notice = { message: 'Enter this code on GitHub.', code: 'ABCD-EFGH' }
    const base = {
      configured: false,
      writable: true,
      notices: [notice],
    }
    expect(activeAuthorizationNotice({
      ...base,
      phase: 'authorizing',
      inFlight: true,
    })).toEqual(notice)
    for (const phase of ['signed-out', 'signed-in', 'error'] as const) {
      expect(activeAuthorizationNotice({
        ...base,
        phase,
        inFlight: false,
      })).toBeUndefined()
    }
  })

  it('renders the device code prominently with an explicit copy action', () => {
    const onCopy = vi.fn()
    const tree = GitHubCopilotAuthorizationNotice({
      message: 'Enter this code on GitHub.',
      url: 'https://github.com/login/device',
      code: 'ABCD-EFGH',
      copyState: 'idle',
      onCopy,
    })
    const elements = descendants(tree)
    const code = elements.find(element => element.props['data-dsh-github-copilot-device-code'] === true)
    const button = elements.find(element => element.type === 'button')
    const link = elements.find(element => element.type === 'a')

    expect(code?.props).toMatchObject({
      children: 'ABCD-EFGH',
      'aria-label': 'GitHub device code ABCD-EFGH',
      style: expect.objectContaining({
        fontSize: '1.5rem',
        fontWeight: 700,
        letterSpacing: '0.12em',
        userSelect: 'all',
      }),
    })
    expect(button?.props.children).toBe('Copy code')
    expect(link?.props).toMatchObject({
      href: 'https://github.com/login/device',
      children: 'Open GitHub verification page',
    })
    button?.props.onClick()
    expect(onCopy).toHaveBeenCalledOnce()
  })

  it('announces successful and failed copy outcomes accessibly', () => {
    for (const [copyState, expected, role, buttonLabel] of [
      ['copying', 'Copying code…', 'status', 'Copying…'],
      ['copied', 'Code copied to clipboard.', 'status', 'Copied'],
      ['failed', 'Copy failed. Select the code and copy it manually.', 'alert', 'Copy code'],
    ] as const) {
      const elements = descendants(GitHubCopilotAuthorizationNotice({
        message: 'Enter this code on GitHub.',
        code: 'ABCD-EFGH',
        copyState,
        onCopy: vi.fn(),
      }))
      const feedback = elements.find(element =>
        element.props['data-dsh-github-copilot-copy-feedback'] === copyState)
      expect(feedback?.props).toMatchObject({ role, children: expected })
      const button = elements.find(element => element.type === 'button')
      expect(button?.props.children).toBe(buttonLabel)
      expect(button?.props.disabled).toBe(copyState === 'copying')
    }
    const idle = descendants(GitHubCopilotAuthorizationNotice({
      message: 'Enter this code on GitHub.',
      code: 'ABCD-EFGH',
      copyState: 'idle',
      onCopy: vi.fn(),
    }))
    expect(idle.some(element => element.props['data-dsh-github-copilot-copy-feedback'] !== undefined)).toBe(false)
  })

  it('copies the exact one-time code through the supplied clipboard writer', async () => {
    const writeText = vi.fn(async () => undefined)
    await expect(copyAuthorizationCode('ABCD-EFGH', { writeText })).resolves.toBeUndefined()
    expect(writeText).toHaveBeenCalledWith('ABCD-EFGH')
    await expect(copyAuthorizationCode('ABCD-EFGH', undefined)).rejects.toThrow(
      /Clipboard access is unavailable/,
    )
  })

  it('explains partial and complete installed-catalog mismatches', () => {
    expect(catalogWarningOf({
      phase: 'signed-in',
      configured: true,
      writable: true,
      inFlight: false,
      notices: [],
      catalog: {
        state: 'partially-outdated',
        accountModelCount: 2,
        supportedModelCount: 1,
        unknownModelIds: ['gpt-6-astra'],
      },
    })).toContain('gpt-6-astra')
    expect(catalogWarningOf({
      phase: 'signed-in',
      configured: true,
      writable: true,
      inFlight: false,
      notices: [],
      catalog: {
        state: 'outdated',
        accountModelCount: 1,
        supportedModelCount: 0,
        unknownModelIds: ['gpt-6-astra'],
      },
    })).toContain('Refresh account models')
    expect(catalogWarningOf({
      phase: 'signed-in',
      configured: true,
      writable: true,
      inFlight: false,
      notices: [],
      catalog: {
        state: 'current',
        accountModelCount: 2,
        supportedModelCount: 1,
        unknownModelIds: [],
        temporarilyUnavailableModelIds: ['claude-sonnet-4.5'],
      },
    })).toContain('Temporarily hidden')
    expect(catalogWarningOf({
      phase: 'signed-in',
      configured: true,
      writable: true,
      inFlight: false,
      notices: [],
      catalog: {
        state: 'current',
        accountModelCount: 1,
        supportedModelCount: 1,
        unknownModelIds: [],
      },
    })).toBeUndefined()
  })

  it('mounts one compact account lifecycle instead of separate authorization and discovery owners', () => {
    const remote = modelRemote()
    const elements = descendants(GitHubCopilotPreviewFooter({ remote: remote as never }))
    const accounts = elements.filter(element => element.type === GitHubCopilotCompactAccount)
    expect(accounts).toHaveLength(1)
    expect(accounts[0]?.props.remote).toBe(remote)
    expect(elements.some(element => element.type === GitHubCopilotProviderCard || element.type === GitHubCopilotAccountModelsPanel)).toBe(false)
    expect(remote.status).not.toHaveBeenCalled()
    expect(remote.discoverModels).not.toHaveBeenCalled()
    expect(remote.start).not.toHaveBeenCalled()
    expect(remote.signOut).not.toHaveBeenCalled()
  })

  it('selects only a configured canonical Copilot provider row, regardless of key configuration', () => {
    const props = { provider: { provider: GITHUB_COPILOT_PROVIDER_ID, displayName: 'GitHub Copilot', settingsNs: 'llm-pi-ai' }, configured: true, keyConfigured: false }
    expect(isGitHubCopilotAccountRow(props)).toBe(true)
    expect(isGitHubCopilotAccountRow({ ...props, keyConfigured: true })).toBe(true)
    expect(isGitHubCopilotAccountRow({ ...props, configured: false })).toBe(false)
    expect(isGitHubCopilotAccountRow({ ...props, provider: { ...props.provider, provider: 'other' } })).toBe(false)
    expect(isGitHubCopilotAccountRow({ ...props, provider: { ...props.provider, provider: GITHUB_COPILOT_PREVIEW_PROVIDER_ID } })).toBe(false)
    expect(isGitHubCopilotAccountRow({ ...props, provider: { ...props.provider, settingsNs: 'another-plugin' } })).toBe(false)
  })

  it('does not poll shared status after a signed-in render', async () => {
    vi.useFakeTimers()
    const signedIn = { phase: 'signed-in' as const, configured: true, writable: true, inFlight: false, notices: [] }
    const remote = { status: vi.fn(async () => ({ ok: true as const, value: signedIn })) }
    const effects: React.EffectCallback[] = []
    vi.mocked(React.useEffect).mockImplementation(setup => { effects.push(setup) })
    vi.mocked(React.useCallback).mockImplementation(callback => callback)
    vi.mocked(React.useRef).mockImplementation(initial => ({ current: initial }))
    vi.mocked(React.useState)
      .mockReturnValueOnce([signedIn, vi.fn()])
      .mockReturnValueOnce([undefined, vi.fn()])
      .mockReturnValueOnce([false, vi.fn()])
      .mockReturnValueOnce(['idle', vi.fn()])
    GitHubCopilotProviderCard({
      provider: { provider: GITHUB_COPILOT_PROVIDER_ID, displayName: 'GitHub Copilot', settingsNs: 'llm-pi-ai' },
      configured: true, keyConfigured: false, remote: remote as never,
    })
    const disposers = effects.map(setup => setup())
    await Promise.resolve()
    expect(remote.status).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(remote.status).toHaveBeenCalledTimes(1)
    for (const dispose of disposers) if (typeof dispose === 'function') dispose()
  })

  it('cancels the shared authorization polling timer when the expanded controls unmount', async () => {
    vi.useFakeTimers()
    const pending = { phase: 'authorizing' as const, configured: false, writable: true, inFlight: true, notices: [] }
    const remote = { status: vi.fn(async () => ({ ok: true as const, value: pending })), cancel: vi.fn() }
    const effects: React.EffectCallback[] = []
    vi.mocked(React.useEffect).mockImplementation(setup => { effects.push(setup) })
    vi.mocked(React.useCallback).mockImplementation(callback => callback)
    vi.mocked(React.useRef).mockImplementation(initial => ({ current: initial }))
    vi.mocked(React.useState)
      .mockReturnValueOnce([pending, vi.fn()])
      .mockReturnValueOnce([undefined, vi.fn()])
      .mockReturnValueOnce([false, vi.fn()])
      .mockReturnValueOnce(['idle', vi.fn()])
    GitHubCopilotProviderCard({
      provider: { provider: GITHUB_COPILOT_PROVIDER_ID, displayName: 'GitHub Copilot', settingsNs: 'llm-pi-ai' },
      configured: false, keyConfigured: false, remote: remote as never,
    })
    const disposers = effects.map(setup => setup())
    await Promise.resolve()
    expect(remote.status).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(1)
    for (const dispose of disposers) if (typeof dispose === 'function') dispose()
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(remote.status).toHaveBeenCalledTimes(1)
    expect(remote.cancel).not.toHaveBeenCalled()
  })

  it('describes generic preview allocation as stored metadata rather than live availability', () => {
    const base = { phase: 'signed-in' as const, configured: true, writable: true, inFlight: false, notices: [],
      catalog: { state: 'current' as const, accountModelCount: 2, supportedModelCount: 2, unknownModelIds: [] } }
    const assigned = { ...base, catalog: { ...base.catalog, previewModelIds: ['unseen-model-a', 'another-provider-model'] } }
    expect(previewAssignmentMessage(assigned)).toContain('Stored account snapshot')
    expect(previewAssignmentMessage(assigned)).toContain('2 model(s)')
    expect(previewAssignmentMessage(assigned)).toContain('not a live availability check')
    expect(previewAssignmentMessage(base)).toBeUndefined()
    expect(previewAssignmentMessage({ ...assigned, configured: false })).toBeUndefined()
    expect(previewAssignmentMessage({ ...base, catalog: { ...base.catalog, previewModelIds: [] } })).toBeUndefined()
  })

  it('explains the initial model list without inferring a completed discovery from sign-in', () => {
    const remote = modelRemote()
    const panel = panelHarness(remote)
    const elements = descendants(panel.render())
    const hint = elements.find(element => element.props['data-dsh-github-copilot-discovery-idle'] === true)
    expect(hint?.props.children).toContain('Refresh to load the models available to this account')
    expect(hint?.props.children).toContain('Signing in alone does not refresh this list')
    expect(elements.some(element => element.type === GitHubCopilotAccountModelsSummary)).toBe(false)
    expect(remote.status).not.toHaveBeenCalled()
    expect(remote.discoverModels).not.toHaveBeenCalled()
  })

  it('discovers account models only on a click and deduplicates clicks while busy', async () => {
    const response = deferred<ReturnType<typeof accountResult>>()
    const remote = modelRemote(vi.fn(() => response.promise))
    const panel = panelHarness(remote)
    const button = refreshButton(panel.render())
    expect(button.props.disabled).toBe(false)
    expect(remote.discoverModels).not.toHaveBeenCalled()
    expect(remote.status).not.toHaveBeenCalled()
    const first = button.props.onClick()
    const second = button.props.onClick()
    expect(remote.discoverModels).toHaveBeenCalledTimes(1)
    expect(refreshButton(panel.render()).props.disabled).toBe(true)
    const models = [
      { id: 'never-seen-a', name: 'New A', api: 'openai-responses' },
      { id: 'vendor-future-b', name: 'New B', api: 'openai-completions' },
      { id: 'arbitrary-c', name: 'New C', api: 'anthropic-messages' },
    ]
    response.resolve(accountResult({ state: 'ready', models, rejected: [] }))
    await Promise.all([first, second])
    const elements = descendants(panel.render())
    const summary = elements.find(element => element.type === GitHubCopilotAccountModelsSummary)
    expect(summary?.props.snapshot.models).toEqual(models)
    expect(summary?.props.snapshot.models).not.toBe(models)
    expect(refreshButton(panel.render()).props.disabled).toBe(false)
    for (const method of [remote.status, remote.reconcile, remote.start, remote.signOut]) expect(method).not.toHaveBeenCalled()
  })

  it('stores only account-model presentation leaves from a successful refresh', async () => {
    const model = Object.defineProperty({ id: 'new-model', name: 'New model', api: 'openai-responses' }, 'token', {
      enumerable: true, get() { throw new Error('must not read token') },
    })
    const snapshot = Object.defineProperty({ state: 'ready' as const, models: [model], rejected: [] }, 'accountKey', {
      enumerable: true, get() { throw new Error('must not read accountKey') },
    })
    const panel = panelHarness(modelRemote(vi.fn(async () => accountResult(snapshot))))
    await refreshButton(panel.render()).props.onClick()
    const summary = descendants(panel.render()).find(element => element.type === GitHubCopilotAccountModelsSummary)
    expect(summary).toBeDefined()
    expect(summary?.props.snapshot === snapshot).toBe(false)
    expect(summary?.props.snapshot).not.toHaveProperty('accountKey')
    expect(summary?.props.snapshot.models[0]).toEqual({ id: 'new-model', name: 'New model', api: 'openai-responses' })
  })

  it('reports discovery failures safely and permits an explicit retry', async () => {
    const remote = modelRemote(vi.fn()
      .mockRejectedValueOnce(new Error('PRIVATE_TOKEN=value'))
      .mockResolvedValueOnce(accountResult({ state: 'ready', models: [], rejected: [] })))
    const panel = panelHarness(remote)
    await refreshButton(panel.render()).props.onClick()
    const failed = descendants(panel.render())
    const error = failed.find(element => element.props['data-dsh-github-copilot-discovery-error'] === true)
    expect(error?.props.children).toBe('COPILOT_MODEL_DISCOVERY_FAILED')
    expect(failed.some(element => String(element.props.children).includes('PRIVATE_TOKEN'))).toBe(false)
    expect(refreshButton(panel.render()).props.disabled).toBe(false)
    await refreshButton(panel.render()).props.onClick()
    expect(remote.discoverModels).toHaveBeenCalledTimes(2)
    expect(descendants(panel.render()).some(element => element.props['data-dsh-github-copilot-discovery-error'] === true)).toBe(false)
  })

  it.each(['leaf', 'getter'])('rejects malformed discovery %s data before displaying it', async failure => {
    const invalid = failure === 'leaf'
      ? { state: 'ready', models: [{ id: 17, name: 'Invalid', api: 'openai-responses' }], rejected: [] }
      : Object.defineProperty({ state: 'ready', rejected: [] }, 'models', { get() { throw new Error('PRIVATE_MODEL_VALUE') } })
    const remote = modelRemote(vi.fn(async () => ({ ok: true, value: { ...accountResult().value, accountModels: invalid } })))
    const panel = panelHarness(remote)
    await refreshButton(panel.render()).props.onClick()
    const elements = descendants(panel.render())
    expect(elements.some(element => element.type === GitHubCopilotAccountModelsSummary)).toBe(false)
    expect(elements.find(element => element.props['data-dsh-github-copilot-discovery-error'] === true)?.props.children)
      .toBe('COPILOT_MODEL_DISCOVERY_INVALID_VIEW')
  })

  it('does not show an unsafe Remote error body as a discovery diagnostic', async () => {
    const remote = modelRemote(vi.fn(async () => ({ ok: false, error: { message: 'PRIVATE_ACCOUNT_KEY', code: 'PRIVATE_TOKEN' } })))
    const panel = panelHarness(remote)
    await refreshButton(panel.render()).props.onClick()
    const error = descendants(panel.render()).find(element => element.props['data-dsh-github-copilot-discovery-error'] === true)
    expect(error?.props.children).toBe('COPILOT_MODEL_DISCOVERY_FAILED')
  })

  it.each(['method', 'view'])('keeps authorization independent when discovery %s is unavailable', async missing => {
    const remote = modelRemote(vi.fn(async () => accountResult()))
    if (missing === 'method') Reflect.deleteProperty(remote, 'discoverModels')
    const panel = panelHarness(remote)
    await refreshButton(panel.render()).props.onClick()
    const error = descendants(panel.render()).find(element => element.props['data-dsh-github-copilot-discovery-error'] === true)
    expect(error?.props.children).toBe('COPILOT_MODEL_DISCOVERY_UNAVAILABLE')
    expect(remote.start).not.toHaveBeenCalled()
    expect(remote.signOut).not.toHaveBeenCalled()
  })

  it.each(['success', 'failure'])('ignores a late discovery %s after unmount', async outcome => {
    const response = deferred<ReturnType<typeof accountResult>>()
    const panel = panelHarness(modelRemote(vi.fn(() => response.promise)))
    const request = refreshButton(panel.render()).props.onClick()
    const writes = panel.setters.map(setter => setter.mock.calls.length)
    panel.unmount()
    if (outcome === 'success') response.resolve(accountResult({ state: 'ready', models: [{ id: 'late', name: 'Late', api: 'openai-responses' }], rejected: [] }))
    else response.reject(new Error('PRIVATE_LATE_FAILURE'))
    await request
    expect(panel.setters.map(setter => setter.mock.calls.length)).toEqual(writes)
  })

  it('does not let a previous Remote overwrite a newly mounted discovery result', async () => {
    const old = deferred<ReturnType<typeof accountResult>>()
    const panel = panelHarness(modelRemote(vi.fn(() => old.promise)))
    const oldRequest = refreshButton(panel.render()).props.onClick()
    const latest = deferred<ReturnType<typeof accountResult>>()
    const newer = modelRemote(vi.fn(() => latest.promise))
    const newRequest = refreshButton(panel.render(newer)).props.onClick()
    old.resolve(accountResult({ state: 'ready', models: [{ id: 'previous', name: 'Previous', api: 'openai-responses' }], rejected: [] }))
    await oldRequest
    expect(refreshButton(panel.render()).props.disabled).toBe(true)
    await refreshButton(panel.render()).props.onClick()
    expect(newer.discoverModels).toHaveBeenCalledTimes(1)
    latest.resolve(accountResult({ state: 'ready', models: [{ id: 'current', name: 'Current', api: 'anthropic-messages' }], rejected: [] }))
    await newRequest
    const summary = descendants(panel.render()).find(element => element.type === GitHubCopilotAccountModelsSummary)
    expect(summary?.props.snapshot.models.map((model: { id: string }) => model.id)).toEqual(['current'])
    expect(newer.discoverModels).toHaveBeenCalledTimes(1)
  })

  it('makes explicit account discovery available in the old-Core settings fallback', () => {
    const remote = modelRemote()
    const elements = descendants(GitHubCopilotSettingsSection({ remote: remote as never, close: vi.fn() }))
    expect(elements.filter(element => element.type === GitHubCopilotCompactAccount)).toHaveLength(1)
    expect(elements.some(element => element.type === GitHubCopilotProviderCard || element.type === GitHubCopilotAccountModelsPanel)).toBe(false)
    expect(remote.status).not.toHaveBeenCalled()
    expect(remote.discoverModels).not.toHaveBeenCalled()
  })

  it('does not poll or automatically rediscover a loading server snapshot', async () => {
    vi.useFakeTimers()
    const remote = modelRemote(vi.fn(async () => accountResult({ state: 'loading', models: [], rejected: [] })))
    const panel = panelHarness(remote)
    panel.render()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(remote.discoverModels).not.toHaveBeenCalled()
    await refreshButton(panel.render()).props.onClick()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(remote.discoverModels).toHaveBeenCalledTimes(1)
    expect(remote.status).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('renders metadata lists, counts and safe diagnostics without exposing unknown fields', () => {
    const model = Object.defineProperty({ id: 'arbitrary-new-id', name: '<Untrusted name>', api: 'openai-responses' }, 'token', { get() { throw new Error('token read') } })
    const snapshot = Object.defineProperty({ state: 'ready' as const, models: [model],
      rejected: [{ id: 'unsupported-id', code: 'UNSUPPORTED_ENDPOINT' }, { code: 'secret=value' }],
      discoveredAt: 1_700_000_000_000, error: 'secret=value',
    }, 'accountKey', { get() { throw new Error('accountKey read') } })
    const elements = descendants(GitHubCopilotAccountModelsSummary({ snapshot }))
    const text = elements.flatMap(element => typeof element.props.children === 'string' ? [element.props.children] : []).join(' ')
    expect(text).toContain('1 accepted model(s)')
    expect(text).toContain('2 rejected model(s)')
    expect(text).toContain('arbitrary-new-id')
    expect(text).toContain('openai-responses')
    expect(text).toContain('UNSUPPORTED_ENDPOINT')
    expect(text).toContain('COPILOT_MODEL_METADATA_REJECTED')
    expect(text).not.toContain('secret=value')
    expect(text).toContain('Select models under GitHub Copilot')
    expect(text).not.toContain(GITHUB_COPILOT_PREVIEW_PROVIDER_ID)
    expect(text).toContain('does not prove')
    expect(elements.some(element => element.type === 'script' || element.props.dangerouslySetInnerHTML !== undefined)).toBe(false)
  })

  it('shows capability warnings separately without rejecting otherwise accepted models', () => {
    const snapshot = { state: 'ready' as const, models: [{ id: 'new-model', name: 'New model', api: 'openai-responses' }], rejected: [],
      warnings: [{ id: 'new-model', code: 'INPUT_LIMIT_NOT_ENFORCED_BY_CORE' }, { id: 'new-model', code: 'REASONING_EFFORTS_UNSUPPORTED' }],
    }
    const elements = descendants(GitHubCopilotAccountModelsSummary({ snapshot }))
    const text = elements.flatMap(element => typeof element.props.children === 'string' ? [element.props.children] : []).join(' ')
    expect(text).toContain('1 accepted model(s)')
    expect(text).toContain('0 rejected model(s)')
    expect(text).toContain('2 capability warning(s)')
    expect(text).toContain('do not reject')
    expect(text).toContain('INPUT_LIMIT_NOT_ENFORCED_BY_CORE')
    expect(text).toContain('REASONING_EFFORTS_UNSUPPORTED')
    expect(text).toContain('not offered')
  })

  it('preserves safe warnings from discovery while accepting older responses without them', async () => {
    const warning = Object.defineProperty({ id: 'new-model', code: 'REASONING_EFFORTS_UNSUPPORTED' }, 'accountKey', {
      enumerable: true, get() { throw new Error('must not read warning extras') },
    })
    const remote = modelRemote(vi.fn()
      .mockResolvedValueOnce(accountResult({ state: 'ready', models: [], rejected: [], warnings: [warning] }))
      .mockResolvedValueOnce(accountResult({ state: 'ready', models: [], rejected: [] })))
    const panel = panelHarness(remote)
    await refreshButton(panel.render()).props.onClick()
    const first = descendants(panel.render()).find(element => element.type === GitHubCopilotAccountModelsSummary)
    expect(first?.props.snapshot.warnings).toEqual([{ id: 'new-model', code: 'REASONING_EFFORTS_UNSUPPORTED' }])
    expect(first?.props.snapshot.warnings[0] === warning).toBe(false)
    await refreshButton(panel.render()).props.onClick()
    const second = descendants(panel.render()).find(element => element.type === GitHubCopilotAccountModelsSummary)
    expect(second?.props.snapshot).not.toHaveProperty('warnings')
  })

  it.each(['idle', 'loading', 'ready', 'stale', 'error', 'disposed', 'unconfigured', 'unavailable'] as const)('shows the %s discovery snapshot without inventing a successful call', state => {
    const elements = descendants(GitHubCopilotAccountModelsSummary({ snapshot: { state, models: [], rejected: [], error: state === 'error' ? 'COPILOT_MODEL_DISCOVERY_FAILED' : undefined } }))
    const status = elements.find(element => element.props['data-dsh-github-copilot-account-models-state'] === state)
    expect(status).toBeDefined()
    if (state === 'stale') {
      expect(status?.props.children).toContain('Showing the last checked model list')
      expect(status?.props.children).not.toContain('Refresh before')
    }
    expect(elements.some(element => String(element.props.children).includes('does not prove'))).toBe(true)
  })

  function surfaceFixture(view: GitHubCopilotAuthorizationView = { phase: 'signed-out', configured: false, writable: true, inFlight: false, notices: [] }) {
    const remote = modelRemote()
    remote.status.mockResolvedValue({ ok: true, value: view })
    const surfaces = createAccountSurfaces()
    panelCleanups.push(() => surfaces.dispose())
    return { remote, surfaces, provider: { kind: 'provider' as const, active: true }, footer: { kind: 'footer' as const, active: true }, settings: { kind: 'settings' as const, active: true } }
  }

  it('uses borderless untitled embedded presentation without attaching another controller or exposing compatibility by default', async () => {
    const { remote, surfaces, provider } = surfaceFixture()
    surfaces.mount(provider, Symbol('provider'), remote as never)
    await Promise.resolve()
    const account = surfaces.getSnapshot()!.account
    const effects: React.EffectCallback[] = []
    vi.mocked(React.useMemo).mockImplementation(factory => factory())
    vi.mocked(React.useSyncExternalStore).mockImplementation((_subscribe, snapshot) => snapshot())
    vi.mocked(React.useEffect).mockImplementation(setup => { effects.push(setup) })
    vi.mocked(React.useId).mockReturnValue('fixture-management')
    vi.mocked(React.useState).mockReturnValue([false, vi.fn()])
    const embedded = GitHubCopilotCompactAccount({ remote: remote as never, account, embedded: true })
    const elements = descendants(embedded)
    expect(embedded.props['aria-label']).toBe('GitHub Copilot account')
    expect(embedded.props['data-dsh-github-copilot-embedded']).toBe(true)
    expect(embedded.props.style).not.toHaveProperty('border')
    expect(elements.some(element => element.type === 'h3')).toBe(false)
    expect(elements.some(element => element.props['data-dsh-github-copilot-compatibility'] === true)).toBe(false)
    expect(elements.find(element => element.type === 'button' && element.props.children === 'Sign in with GitHub')).toBeDefined()
    const fallback = GitHubCopilotCompactAccount({ remote: remote as never, account })
    expect(descendants(fallback).filter(element => element.type === 'h3')).toHaveLength(1)
    expect(fallback.props.style.border).toBeDefined()
    for (const effect of effects) expect(effect()).toBeUndefined()
    expect(remote.status).toHaveBeenCalledOnce()
    expect(remote.start).not.toHaveBeenCalled()
    expect(remote.reconcile).not.toHaveBeenCalled()
    expect(remote.signOut).not.toHaveBeenCalled()
  })

  it.each(['provider-first', 'footer-first'] as const)('owns one controller with both mounted seats: %s', order => {
    const { remote, surfaces, provider, footer } = surfaceFixture()
    const p = Symbol('provider'), f = Symbol('footer')
    const first = order === 'provider-first' ? provider : footer
    const second = order === 'provider-first' ? footer : provider
    surfaces.mount(first, first === provider ? p : f, remote as never)
    const account = surfaces.getSnapshot()?.account
    surfaces.mount(second, second === provider ? p : f, remote as never)
    expect(surfaces.getSnapshot()).toEqual({ token: p, account })
    expect(remote.status).toHaveBeenCalledOnce()
    expect(remote.start).not.toHaveBeenCalled()
    expect(remote.discoverModels).not.toHaveBeenCalled()
  })

  it('shares one initial stale refresh across surfaces and checks again only after the last surface leaves', async () => {
    vi.useFakeTimers()
    const stale = accountResult({ state: 'stale', models: [{ id: 'example', name: 'Example', api: 'openai-responses' }], rejected: [] }).value
    const { remote, surfaces, provider, footer } = surfaceFixture(stale)
    const wait = deferred<ReturnType<typeof accountResult>>()
    remote.ensureModels.mockReturnValueOnce(wait.promise)
    const removeFooter = surfaces.mount(footer, Symbol('footer'), remote as never)
    for (let index=0;index<8;index++) await Promise.resolve()
    const account = surfaces.getSnapshot()!.account
    expect(remote.ensureModels).toHaveBeenCalledOnce()
    const removeProvider = surfaces.mount(provider, Symbol('provider'), remote as never)
    expect(surfaces.getSnapshot()!.account).toBe(account)
    removeProvider()
    expect(surfaces.getSnapshot()!.account).toBe(account)
    expect(account.getSnapshot().view?.accountModels?.models).toHaveLength(1)
    wait.resolve(accountResult({ state: 'ready', models: [], rejected: [] }))
    for (let index=0;index<8;index++) await Promise.resolve()
    await vi.advanceTimersByTimeAsync(5000)
    expect(remote.ensureModels).toHaveBeenCalledOnce()
    expect(remote.status).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
    removeFooter()
    surfaces.mount(footer, Symbol('reopened'), remote as never)
    for (let index=0;index<8;index++) await Promise.resolve()
    expect(surfaces.getSnapshot()!.account).not.toBe(account)
    expect(remote.status).toHaveBeenCalledTimes(2)
    expect(remote.ensureModels).toHaveBeenCalledTimes(2)
    expect(remote.discoverModels).not.toHaveBeenCalled()
  })

  it('transfers a pending sign-in to an arriving row and back without stale actions or a second poll owner', async () => {
    vi.useFakeTimers()
    const { remote, surfaces, provider, footer } = surfaceFixture()
    const f = Symbol('footer'), p = Symbol('provider')
    const unmountFooter = surfaces.mount(footer, f, remote as never)
    await Promise.resolve()
    const account = surfaces.getSnapshot()!.account
    const start = deferred<{ ok: true; value: GitHubCopilotAuthorizationView }>()
    remote.start.mockReturnValue(start.promise)
    const starting = account.start()
    const unmountProvider = surfaces.mount(provider, p, remote as never)
    expect(surfaces.getSnapshot()?.account).toBe(account)
    expect(account.getSnapshot().operation).toBe('start')
    await surfaces.getSnapshot()!.account.start()
    expect(remote.start).toHaveBeenCalledOnce()
    const pending: GitHubCopilotAuthorizationView = { phase: 'authorizing', configured: false, writable: true, inFlight: true,
      notices: [{ message: 'Enter this code', code: 'TEST-1234' }] }
    remote.status.mockResolvedValue({ ok: true, value: pending })
    start.resolve({ ok: true, value: pending })
    await starting
    expect(vi.getTimerCount()).toBe(1)
    unmountProvider()
    expect(surfaces.getSnapshot()).toEqual({ token: f, account })
    expect(account.getSnapshot().view?.notices[0]?.code).toBe('TEST-1234')
    await vi.advanceTimersByTimeAsync(500)
    expect(remote.status).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(1)
    unmountFooter()
    expect(surfaces.getSnapshot()).toBeUndefined()
    expect(vi.getTimerCount()).toBe(0)
    await account.start()
    expect(remote.start).toHaveBeenCalledOnce()
    expect(remote.cancel).not.toHaveBeenCalled()
  })

  it('retains the footer when an unrelated or unconfigured row is not eligible and restores it on eligibility loss', () => {
    const { remote, surfaces, provider, footer } = surfaceFixture()
    const token = Symbol('footer')
    surfaces.mount(footer, token, remote as never)
    const props = { provider: { provider: 'another-provider', displayName: 'Other', settingsNs: 'llm-pi-ai' }, configured: true, keyConfigured: true }
    if (isGitHubCopilotAccountRow(props)) surfaces.mount(provider, Symbol('unrelated'), remote as never)
    expect(surfaces.getSnapshot()?.token).toBe(token)
    const removeProvider = surfaces.mount(provider, Symbol('canonical'), remote as never)
    const account = surfaces.getSnapshot()?.account
    removeProvider()
    expect(surfaces.getSnapshot()).toEqual({ token, account })
    expect(remote.status).toHaveBeenCalledOnce()
  })

  it('revokes a provider declaration before React cleanup and ignores stale leases on redeclaration', () => {
    const { remote, surfaces, provider, footer } = surfaceFixture()
    const f = Symbol('footer'), p = Symbol('provider')
    surfaces.mount(footer, f, remote as never)
    const oldCleanup = surfaces.mount(provider, p, remote as never)
    surfaces.revoke(provider)
    expect(surfaces.getSnapshot()?.token).toBe(f)
    surfaces.mount(provider, Symbol('revoked'), remote as never)
    expect(surfaces.getSnapshot()?.token).toBe(f)
    const newSeat = { kind: 'provider' as const, active: true }
    surfaces.mount(newSeat, p, remote as never)
    oldCleanup()
    expect(surfaces.getSnapshot()?.token).toBe(p)
    expect(remote.status).toHaveBeenCalledOnce()
  })

  it('keeps one owner across duplicate row instances and footer/settings competition', () => {
    const { remote, surfaces, provider, footer, settings } = surfaceFixture()
    const s = Symbol('settings'), f = Symbol('footer'), a = Symbol('row-a'), b = Symbol('row-b')
    surfaces.mount(settings, s, remote as never)
    const removeFooter = surfaces.mount(footer, f, remote as never)
    const removeA = surfaces.mount(provider, a, remote as never)
    const removeB = surfaces.mount(provider, b, remote as never)
    expect(surfaces.getSnapshot()?.token).toBe(a)
    removeA()
    expect(surfaces.getSnapshot()?.token).toBe(b)
    removeB()
    expect(surfaces.getSnapshot()?.token).toBe(f)
    removeFooter()
    expect(surfaces.getSnapshot()?.token).toBe(s)
    expect(remote.status).toHaveBeenCalledOnce()
  })

  it('fences old Remote responses on replacement and never reuses the previous private view', async () => {
    vi.useFakeTimers()
    const { remote, surfaces, provider, footer } = surfaceFixture()
    const oldStatus = deferred<{ ok: true; value: GitHubCopilotAuthorizationView }>()
    remote.status.mockReturnValue(oldStatus.promise)
    const p = Symbol('provider'), f = Symbol('footer')
    surfaces.mount(footer, f, remote as never)
    surfaces.mount(provider, p, remote as never)
    const oldAccount = surfaces.getSnapshot()!.account
    const replacement = modelRemote()
    replacement.status.mockResolvedValue({ ok: true, value: { phase: 'signed-out', configured: false, writable: true, inFlight: false, notices: [] } })
    surfaces.mount(provider, p, replacement as never)
    surfaces.mount(footer, f, replacement as never)
    const newAccount = surfaces.getSnapshot()!.account
    expect(newAccount).not.toBe(oldAccount)
    expect(newAccount.getSnapshot().view).toBeUndefined()
    oldStatus.resolve({ ok: true, value: { phase: 'authorizing', configured: false, writable: true, inFlight: true,
      notices: [{ message: 'Old account', code: 'OLD-CODE' }] } })
    await Promise.resolve()
    expect(newAccount.getSnapshot().view?.phase).toBe('signed-out')
    expect(newAccount.getSnapshot().view?.notices).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
    await oldAccount.start()
    expect(remote.start).not.toHaveBeenCalled()
    expect(replacement.status).toHaveBeenCalledOnce()
  })

  it('disposes all leases without activating another owner and starts fresh after a whole-page remount', async () => {
    const { remote, surfaces, provider, footer } = surfaceFixture()
    const notify = vi.fn()
    const unsubscribe = surfaces.subscribe(notify)
    const unmountFooter = surfaces.mount(footer, Symbol('footer'), remote as never)
    const unmountProvider = surfaces.mount(provider, Symbol('provider'), remote as never)
    const oldAccount = surfaces.getSnapshot()!.account
    surfaces.dispose()
    const calls = notify.mock.calls.length
    surfaces.dispose()
    unmountProvider(); unmountFooter(); unsubscribe()
    surfaces.mount({ kind: 'provider', active: true }, Symbol('after-disposal'), remote as never)
    expect(surfaces.getSnapshot()).toBeUndefined()
    expect(remote.status).toHaveBeenCalledOnce()
    expect(notify).toHaveBeenCalledTimes(calls)
    await oldAccount.start()
    expect(remote.start).not.toHaveBeenCalled()
    const fresh = createAccountSurfaces()
    panelCleanups.push(() => fresh.dispose())
    fresh.mount({ kind: 'footer', active: true }, Symbol('fresh'), remote as never)
    expect(fresh.getSnapshot()?.account).not.toBe(oldAccount)
    expect(remote.status).toHaveBeenCalledTimes(2)
  })

  function clientContext(declaredSlots: readonly string[]) {
    const disposeRemote = vi.fn(async () => undefined)
    let cleanupUi: (() => void) | undefined
    const disposeUi = vi.fn(async () => { cleanupUi?.(); cleanupUi = undefined })
    const disposePresentation = vi.fn(async () => undefined)
    const registrations = new Map<string, ReturnType<typeof vi.fn>>()
    const injections = new Map<string, () => unknown>()
    const register = vi.fn((options: { name: string; id?: string; order?: number }, _component: unknown) => {
      const dispose = vi.fn()
      registrations.set(options.name, dispose)
      return dispose
    })
    let ctx: {
      remote: {
        $mount: ReturnType<typeof vi.fn>
        $on: ReturnType<typeof vi.fn>
        githubCopilot: object
      }
      slots: {
        inject(name: string, callback: () => unknown): unknown
        register: ReturnType<typeof vi.fn>
        spec: ReturnType<typeof vi.fn>
      }
      logger: { warn: ReturnType<typeof vi.fn> }
      on: ReturnType<typeof vi.fn>
      inject: ReturnType<typeof vi.fn>
    }
    const inject = vi.fn((services: string[], callback: (value: unknown) => unknown) => {
      if (services.includes('uiConversation')) {
        return Object.assign(new Promise<void>(() => {}), { dispose: disposePresentation })
      }
      const cleanup = callback(ctx)
      if (typeof cleanup === 'function') cleanupUi = cleanup as () => void
      return Object.assign(Promise.resolve(), { dispose: disposeUi })
    })
    ctx = {
      remote: {
        $mount: vi.fn(async () => disposeRemote),
        $on: vi.fn(() => vi.fn()),
        githubCopilot: {},
      },
      slots: {
        inject: (name, callback) => {
          let active = true
          let cleanup: (() => void) | undefined
          const activate = () => {
            if (!active) return
            cleanup?.()
            const result = callback()
            cleanup = typeof result === 'function' ? result as () => void : undefined
            return cleanup
          }
          injections.set(name, activate)
          if (declaredSlots.includes(name)) activate()
          return () => { if (!active) return; active = false; cleanup?.(); cleanup = undefined }
        },
        register,
        spec: vi.fn((name: string) => ({ kind: name === 'settings.models.provider-card' ? 'keyed' : 'list', scope: 'root' })),
      },
      logger: { warn: vi.fn() },
      on: vi.fn(() => vi.fn()),
      inject,
    }
    return { ctx, disposeRemote, disposeUi, disposePresentation, register, registrations, injections }
  }

  it('registers coordinated provider and fallback seats without starting either controller during registration', async () => {
    const { ctx, register, registrations, injections } = clientContext([
      'settings.models.provider-card', 'settings.models.footer', 'settings.section',
    ])
    const dispose = await apply(ctx as never)
    expect(register).toHaveBeenCalledWith({ name: 'settings.models.footer', id: GITHUB_COPILOT_PREVIEW_PROVIDER_ID, order: 10 }, expect.any(Function))
    const render = register.mock.calls.find(([options]) => options.name === 'settings.models.footer')?.[1] as (() => ReactElement) | undefined
    const element = render?.()
    expect(element?.type).toBe(GitHubCopilotAccountSurface)
    expect(element?.props.remote).toBe(ctx.remote.githubCopilot)
    expect(element?.props.seat.kind).toBe('footer')
    expect(register).toHaveBeenCalledWith({ name: 'settings.models.provider-card', key: 'llm-pi-ai' }, expect.any(Function))
    const renderProvider = register.mock.calls.find(([options]) => options.name === 'settings.models.provider-card')?.[1] as ((props: object) => ReactElement) | undefined
    const provider = renderProvider?.({ provider: { provider: GITHUB_COPILOT_PROVIDER_ID, displayName: 'GitHub Copilot', settingsNs: 'llm-pi-ai' }, configured: true, keyConfigured: false })
    expect(provider?.type).toBe(GitHubCopilotAccountSurface)
    expect(provider?.props.remote).toBe(ctx.remote.githubCopilot)
    expect(provider?.props.eligible).toBe(true)
    expect(provider?.props.seat.kind).toBe('provider')
    expect(provider?.props.surfaces).toBe(element?.props.surfaces)
    expect(provider?.props.surfaces.getSnapshot()).toBeUndefined()
    expect(registrations.has('settings.section')).toBe(false)
    const removeFooter = registrations.get('settings.models.footer')
    await dispose()
    expect(removeFooter).toHaveBeenCalledOnce()
    const count = register.mock.calls.length
    injections.get('settings.models.footer')?.()
    expect(register).toHaveBeenCalledTimes(count)
  })

  it('waits for footer declaration without blocking old-Core authorization and follows redeclaration', async () => {
    const { ctx, register, registrations, injections } = clientContext(['settings.section'])
    const dispose = await apply(ctx as never)
    expect(registrations.has('settings.section')).toBe(true)
    expect(registrations.has('settings.models.footer')).toBe(false)
    injections.get('settings.models.footer')?.()
    const first = registrations.get('settings.models.footer')
    expect(first).toBeDefined()
    injections.get('settings.models.footer')?.()
    expect(first).toHaveBeenCalledOnce()
    const second = registrations.get('settings.models.footer')
    expect(second).not.toBe(first)
    expect(register.mock.calls.filter(([options]) => options.name === 'settings.models.footer')).toHaveLength(2)
    await dispose()
    expect(second).toHaveBeenCalledOnce()
  })

  it('leaves authorization active when the optional footer contract is incompatible or registration fails', async () => {
    for (const failure of ['contract', 'missing-spec', 'registration', 'injection'] as const) {
      const fixture = clientContext(['settings.models.provider-card', 'settings.models.footer', 'settings.section'])
      if (failure === 'contract') fixture.ctx.slots.spec.mockReturnValue({ kind: 'keyed', scope: 'session' })
      if (failure === 'missing-spec') Reflect.deleteProperty(fixture.ctx.slots, 'spec')
      if (failure === 'registration') {
        const register = fixture.register.getMockImplementation()!
        fixture.register.mockImplementation((options, component) => {
          if (options.name === 'settings.models.footer') throw new Error('PRIVATE_FOOTER_ERROR')
          return register(options, component)
        })
      }
      if (failure === 'injection') {
        const inject = fixture.ctx.slots.inject
        fixture.ctx.slots.inject = (name, callback) => {
          if (name === 'settings.models.footer') throw new Error('PRIVATE_FOOTER_ERROR')
          return inject(name, callback)
        }
      }
      const dispose = await apply(fixture.ctx as never)
      expect(fixture.registrations.has('settings.section')).toBe(true)
      expect(fixture.registrations.has('settings.models.footer')).toBe(false)
      expect(fixture.ctx.logger.warn).toHaveBeenCalled()
      expect(fixture.ctx.logger.warn.mock.calls.flat().join(' ')).not.toContain('PRIVATE_FOOTER_ERROR')
      await dispose()
    }
  })

  it('restores exactly one account fallback when a footer declaration is withdrawn', async () => {
    const fixture = clientContext(['settings.section'])
    const dispose = await apply(fixture.ctx as never)
    const firstFallback = fixture.registrations.get('settings.section')
    const removeFooter = fixture.injections.get('settings.models.footer')?.() as (() => void)
    expect(firstFallback).toHaveBeenCalledOnce()
    const count = fixture.register.mock.calls.filter(([options]) => options.name === 'settings.section').length
    removeFooter()
    expect(fixture.register.mock.calls.filter(([options]) => options.name === 'settings.section')).toHaveLength(count + 1)
    const restored = fixture.registrations.get('settings.section')
    expect(restored).not.toBe(firstFallback)
    await dispose()
    expect(restored).toHaveBeenCalledOnce()
    expect(fixture.register.mock.calls.filter(([options]) => options.name === 'settings.section')).toHaveLength(count + 1)
  })

  it('retains a working account fallback when later footer registration fails', async () => {
    const fixture = clientContext(['settings.section'])
    const dispose = await apply(fixture.ctx as never)
    const fallback = fixture.registrations.get('settings.section')
    const original = fixture.register.getMockImplementation()!
    fixture.register.mockImplementation((options, component) => {
      if (options.name === 'settings.models.footer') throw new Error('PRIVATE_REGISTRATION_FAILURE')
      return original(options, component)
    })
    fixture.injections.get('settings.models.footer')?.()
    expect(fallback).not.toHaveBeenCalled()
    expect(fixture.ctx.logger.warn.mock.calls.flat().join(' ')).not.toContain('PRIVATE_REGISTRATION_FAILURE')
    await dispose()
    expect(fallback).toHaveBeenCalledOnce()
  })

  it('does not delay authorization while the optional reasoning presentation waits for Core services', async () => {
    const { ctx, disposeRemote, disposeUi, disposePresentation } = clientContext(['settings.section'])
    const dispose = await apply(ctx as never)
    expect(ctx.inject).toHaveBeenCalledWith(['uiConversation', 'slots'], expect.any(Function))
    expect(disposePresentation).not.toHaveBeenCalled()
    await dispose()
    expect(disposePresentation).toHaveBeenCalledOnce()
    expect(disposeUi).toHaveBeenCalledOnce()
    expect(disposeRemote).toHaveBeenCalledOnce()
  })

  it('mounts its Remote contribution and registers the rc.1 provider-card seat', async () => {
    const { ctx, disposeRemote, disposeUi, register } = clientContext([
      'settings.models.provider-card',
      'settings.section',
    ])

    const dispose = await apply(ctx as never)

    expect(ctx.remote.$mount).toHaveBeenCalledWith(expect.objectContaining({
      package: 'dsh-github-copilot',
    }))
    expect(register).toHaveBeenCalledWith(
      { name: 'settings.models.provider-card', key: 'llm-pi-ai' },
      expect.any(Function),
    )
    expect(register).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'settings.section' }),
      expect.any(Function),
    )

    await dispose()
    expect(disposeUi).toHaveBeenCalled()
    expect(disposeRemote).toHaveBeenCalled()
  })

  it('registers a GitHub Copilot settings section on the rc.2 Models surface', async () => {
    const { ctx, register } = clientContext(['settings.section'])

    const dispose = await apply(ctx as never)

    expect(register).toHaveBeenCalledWith(
      {
        name: 'settings.section',
        id: 'github-copilot',
        order: 11,
        label: 'GitHub Copilot',
      },
      expect.any(Function),
    )
    expect(register).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: 'settings.models.provider-card' }),
      expect.any(Function),
    )

    await dispose()
  })

  it('keeps fallback authorization when only the legacy provider-card slot appears', async () => {
    const { ctx, register, registrations, injections } = clientContext(['settings.section'])
    await apply(ctx as never)
    const disposeFallback = registrations.get('settings.section')

    injections.get('settings.models.provider-card')?.()

    expect(disposeFallback).not.toHaveBeenCalled()
    expect(register).toHaveBeenCalledWith(
      { name: 'settings.models.provider-card', key: 'llm-pi-ai' },
      expect.any(Function),
    )
  })
})
