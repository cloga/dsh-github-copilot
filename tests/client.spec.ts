import { isValidElement } from 'react'
import type { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import {
  activeAuthorizationNotice,
  apply,
  catalogWarningOf,
  routeStatusMessage,
  copyAuthorizationCode,
  GitHubCopilotAuthorizationNotice,
} from '../src/client.ts'

describe('GitHub Copilot Models client', () => {
  function descendants(root: unknown): ReactElement[] {
    if (Array.isArray(root)) return root.flatMap(descendants)
    if (!isValidElement(root)) return []
    const element = root as ReactElement<{ children?: unknown }>
    return [element, ...descendants(element.props.children)]
  }

  it('distinguishes route repair and conflicts from authentication state', () => {
    const base = { configured: true, writable: true, inFlight: false, phase: 'signed-in' as const, notices: [] }
    expect(routeStatusMessage({ ...base, route: { state: 'needs-repair' } })).toContain('does not refresh GitHub access')
    expect(routeStatusMessage({ ...base, route: { state: 'needs-repair', diagnosticCode: 'RECONCILIATION_FAILED' } })).toContain('sign-in is retained')
    expect(routeStatusMessage({ ...base, route: { state: 'conflict' } })).toContain('without rolling back user edits')
    expect(routeStatusMessage({ ...base, route: { state: 'error' } })).toContain('sign-in is retained')
    expect(routeStatusMessage({ ...base, route: { state: 'not-configured' } })).toContain('No usable account model')
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
    })).toContain('Update the integration and restart DSH')
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

  function clientContext(declaredSlots: readonly string[]) {
    const disposeRemote = vi.fn(async () => undefined)
    const disposeUi = vi.fn(async () => undefined)
    const registrations = new Map<string, ReturnType<typeof vi.fn>>()
    const injections = new Map<string, () => unknown>()
    const register = vi.fn((options: { name: string }) => {
      const dispose = vi.fn()
      registrations.set(options.name, dispose)
      return dispose
    })
    let ctx: {
      remote: {
        $mount: ReturnType<typeof vi.fn>
        githubCopilot: object
      }
      slots: {
        inject(name: string, callback: () => unknown): unknown
        register: ReturnType<typeof vi.fn>
      }
      inject: ReturnType<typeof vi.fn>
    }
    const inject = vi.fn((_services: string[], callback: (value: unknown) => void) => {
      callback(ctx)
      return Object.assign(Promise.resolve(), { dispose: disposeUi })
    })
    ctx = {
      remote: {
        $mount: vi.fn(async () => disposeRemote),
        githubCopilot: {},
      },
      slots: {
        inject: (name, callback) => {
          injections.set(name, callback)
          return declaredSlots.includes(name) ? callback() : () => undefined
        },
        register,
      },
      inject,
    }
    return { ctx, disposeRemote, disposeUi, register, registrations, injections }
  }

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
    expect(register).not.toHaveBeenCalledWith(
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

  it('replaces the rc.2 fallback when the rc.1 provider-card slot appears', async () => {
    const { ctx, register, registrations, injections } = clientContext(['settings.section'])
    await apply(ctx as never)
    const disposeFallback = registrations.get('settings.section')

    injections.get('settings.models.provider-card')?.()

    expect(disposeFallback).toHaveBeenCalledOnce()
    expect(register).toHaveBeenCalledWith(
      { name: 'settings.models.provider-card', key: 'llm-pi-ai' },
      expect.any(Function),
    )
  })
})
