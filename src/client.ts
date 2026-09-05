/**
 * Browser companion for the Models provider-card slot.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { createElement, useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import type { GitHubCopilotAuthorizationView } from './authorization-controller.ts'
import type { ProviderCardExtrasOwnerProps, SettingsSectionOwnerProps } from './dsh-supported-types.ts'
import githubCopilotRemote from './remote.ts'

export const inject = ['remote', 'slots']

interface GitHubCopilotProviderCardProps extends ProviderCardExtrasOwnerProps {
  readonly remote: ClientContext['remote']['githubCopilot']
}

interface GitHubCopilotSettingsSectionProps extends SettingsSectionOwnerProps {
  readonly remote: ClientContext['remote']['githubCopilot']
}

function messageOf(result: Awaited<ReturnType<GitHubCopilotProviderCardProps['remote']['status']>>): string {
  return result.ok ? '' : result.error.message
}

export function catalogWarningOf(status: GitHubCopilotAuthorizationView | undefined): string | undefined {
  const catalog = status?.catalog
  if (catalog === undefined) return undefined
  const warnings: string[] = []
  if (catalog.state === 'partially-outdated') {
    warnings.push(`${catalog.unknownModelIds.length} account model(s) require a newer Copilot model catalog: ${catalog.unknownModelIds.join(', ')}.`)
  }
  if (catalog.state === 'outdated') {
    warnings.push(`This account exposes only models unknown to the installed Copilot model catalog: ${catalog.unknownModelIds.join(', ')}. Update the integration and restart DSH.`)
  }
  const unavailable = catalog.temporarilyUnavailableModelIds ?? []
  if (unavailable.length > 0) {
    warnings.push(`Temporarily hidden while GPT-6 compatibility selects the Responses protocol: ${unavailable.join(', ')}.`)
  }
  return warnings.length === 0 ? undefined : warnings.join(' ')
}

export function routeStatusMessage(status: GitHubCopilotAuthorizationView | undefined): string | undefined {
  if (!status?.configured) return undefined
  switch (status.route?.state) {
    case 'needs-repair': return status.route.diagnosticCode === 'RECONCILIATION_FAILED'
      ? 'Model configuration repair failed. Your sign-in is retained; review settings before retrying.'
      : 'Model configuration needs reconciliation. Repair uses the stored account snapshot; it does not refresh GitHub access.'
    case 'conflict': return 'Model configuration conflicts with manual edits or a legacy ownership backup. Automatic repair stopped without rolling back user edits. Review settings before repairing; do not reconnect to force ownership.'
    case 'error': return 'Model configuration could not be inspected. Your sign-in is retained; check the settings service.'
    case 'not-configured': return 'No usable account model configuration is available. Check account availability and the installed catalog.'
    default: return undefined
  }
}

export function activeAuthorizationNotice(
  status: GitHubCopilotAuthorizationView | undefined,
): GitHubCopilotAuthorizationView['notices'][number] | undefined {
  return status?.inFlight === true ? status.notices.at(-1) : undefined
}

type ClipboardWriter = Pick<Clipboard, 'writeText'>
type CopyState = 'idle' | 'copying' | 'copied' | 'failed'

const noticePanelStyle: CSSProperties = {
  display: 'grid',
  gap: '0.75rem',
  marginTop: '0.75rem',
  marginBottom: '0.75rem',
  padding: '1rem',
  border: '1px solid color-mix(in srgb, currentColor 24%, transparent)',
  borderRadius: '0.75rem',
  background: 'color-mix(in srgb, currentColor 5%, transparent)',
}

const codeRowStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: '0.75rem',
}

const deviceCodeStyle: CSSProperties = {
  display: 'inline-block',
  minWidth: '10ch',
  padding: '0.65rem 0.9rem',
  border: '2px solid color-mix(in srgb, currentColor 55%, transparent)',
  borderRadius: '0.5rem',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  fontSize: '1.5rem',
  fontWeight: 700,
  letterSpacing: '0.12em',
  lineHeight: 1.2,
  textAlign: 'center',
  userSelect: 'all',
}

/** Copy a one-time authorization code through the browser clipboard boundary. */
export async function copyAuthorizationCode(code: string, clipboard?: ClipboardWriter): Promise<void> {
  const writer = clipboard ?? globalThis.navigator?.clipboard
  if (writer === undefined) throw new Error('Clipboard access is unavailable')
  await writer.writeText(code)
}

interface AuthorizationNoticeProps {
  readonly message: string
  readonly url?: string
  readonly code?: string
  readonly copyState: CopyState
  readonly onCopy: () => void
}

/** Pure presentation for the in-flight GitHub device-code handoff. */
export function GitHubCopilotAuthorizationNotice(props: AuthorizationNoticeProps): ReactElement {
  const feedback = props.copyState === 'copying'
    ? 'Copying code…'
    : props.copyState === 'copied'
      ? 'Code copied to clipboard.'
      : props.copyState === 'failed'
        ? 'Copy failed. Select the code and copy it manually.'
        : ''
  return createElement('div', {
    'data-dsh-github-copilot-auth-notice': true,
    style: noticePanelStyle,
  },
  createElement('div', null, props.message),
  props.url === undefined ? null : createElement('a', {
    href: props.url,
    target: '_blank',
    rel: 'noreferrer',
  }, 'Open GitHub verification page'),
  props.code === undefined ? null : createElement('div', null,
    createElement('div', { style: { marginBottom: '0.4rem', fontWeight: 600 } }, 'Your one-time code'),
    createElement('div', { style: codeRowStyle },
      createElement('code', {
        'data-dsh-github-copilot-device-code': true,
        'aria-label': `GitHub device code ${props.code}`,
        style: deviceCodeStyle,
      }, props.code),
      createElement('button', {
        type: 'button',
        disabled: props.copyState === 'copying',
        onClick: props.onCopy,
      }, props.copyState === 'copying'
        ? 'Copying…'
        : props.copyState === 'copied' ? 'Copied' : 'Copy code'))),
  feedback.length === 0 ? null : createElement('div', {
    role: props.copyState === 'failed' ? 'alert' : 'status',
    'aria-live': 'polite',
    'data-dsh-github-copilot-copy-feedback': props.copyState,
  }, feedback))
}

/** Models-card sign-in/status/sign-out controls for the catalog Copilot row. */
export function GitHubCopilotProviderCard(
  props: GitHubCopilotProviderCardProps,
): ReturnType<typeof createElement> | null {
  const [status, setStatus] = useState<GitHubCopilotAuthorizationView>()
  const [error, setError] = useState<string>()
  const [repairing, setRepairing] = useState(false)
  const repairInFlight = useRef(false)
  const [copyState, setCopyState] = useState<CopyState>('idle')
  const copyAttempt = useRef(0)

  const refresh = useCallback(async () => {
    const result = await props.remote.status()
    if (result.ok) {
      setStatus(result.value)
      setError(undefined)
      return result.value
    }
    setError(messageOf(result))
    return undefined
  }, [props.remote])

  useEffect(() => {
    if (props.provider.provider !== 'github-copilot') return
    void refresh()
  }, [props.provider.provider, refresh])

  useEffect(() => {
    copyAttempt.current += 1
    setCopyState('idle')
  }, [status?.notices.at(-1)?.code])

  useEffect(() => () => {
    copyAttempt.current += 1
  }, [])

  useEffect(() => {
    if (props.provider.provider !== 'github-copilot' || status?.inFlight !== true) return
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async (): Promise<void> => {
      const next = await refresh()
      if (!disposed && (next?.inFlight ?? true)) timer = setTimeout(() => void poll(), 500)
    }
    timer = setTimeout(() => void poll(), 500)
    return () => {
      disposed = true
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [props.provider.provider, refresh, status?.inFlight])

  if (props.provider.provider !== 'github-copilot') return null

  const invoke = async (
    operation: () => ReturnType<GitHubCopilotProviderCardProps['remote']['status']>,
  ): Promise<void> => {
    const result = await operation()
    if (result.ok) {
      setStatus(result.value)
      setError(undefined)
      return
    }
    setError(messageOf(result))
  }

  const notice = activeAuthorizationNotice(status)
  const signedIn = status?.configured === true
  const busy = status?.inFlight === true
  const catalogWarning = catalogWarningOf(status)
  const routeMessage = routeStatusMessage(status)
  return createElement('div', { 'data-dsh-github-copilot': true },
    createElement('div', { role: 'status', 'aria-live': 'polite' },
      error ?? status?.error ?? (busy ? 'Waiting for GitHub authorization…' : signedIn ? 'Signed in to GitHub Copilot.' : 'Sign in to use GitHub Copilot models.')),
    catalogWarning === undefined ? null : createElement('div', {
      role: 'alert',
      'data-dsh-github-copilot-catalog-warning': status?.catalog?.state,
    }, catalogWarning),
    routeMessage === undefined ? null : createElement('div', {
      role: 'status', 'data-dsh-github-copilot-route-state': status?.route?.state,
    }, routeMessage),
    signedIn && !busy && status?.route?.state === 'needs-repair' ? createElement('button', {
      type: 'button',
      disabled: repairing,
      onClick: () => {
        if (repairInFlight.current) return
        repairInFlight.current = true
        setRepairing(true)
        void invoke(() => props.remote.reconcile()).catch(() => {
          setError('Model configuration repair could not be completed.')
        }).finally(() => {
          repairInFlight.current = false
          setRepairing(false)
        })
      },
    }, repairing ? 'Repairing model configuration…' : 'Repair model configuration') : null,
    !busy || notice === undefined ? null : createElement(GitHubCopilotAuthorizationNotice, {
      message: notice.message,
      url: notice.url,
      code: notice.code,
      copyState,
      onCopy: () => {
        if (notice.code === undefined || copyState === 'copying') return
        const attempt = ++copyAttempt.current
        setCopyState('copying')
        void copyAuthorizationCode(notice.code).then(
          () => {
            if (copyAttempt.current === attempt) setCopyState('copied')
          },
          () => {
            if (copyAttempt.current === attempt) setCopyState('failed')
          },
        )
      },
    }),
    busy
      ? createElement('button', {
        type: 'button',
        onClick: () => void invoke(() => props.remote.cancel()),
      }, 'Cancel sign-in')
      : signedIn
        ? createElement('button', {
          type: 'button',
          disabled: status?.writable === false,
          onClick: () => void invoke(() => props.remote.signOut()),
        }, 'Sign out')
        : createElement('button', {
          type: 'button',
          onClick: () => void invoke(() => props.remote.start()),
        }, 'Sign in with GitHub'))
}

/** rc.2 fallback for Models pages that predate the provider-card extension slot. */
export function GitHubCopilotSettingsSection(
  props: GitHubCopilotSettingsSectionProps,
): ReturnType<typeof createElement> {
  return createElement('section', { 'data-dsh-github-copilot-settings': true },
    createElement('h2', null, 'GitHub Copilot'),
    createElement(GitHubCopilotProviderCard, {
      provider: {
        provider: 'github-copilot',
        displayName: 'GitHub Copilot',
        settingsNs: 'llm-pi-ai',
      },
      configured: false,
      keyConfigured: false,
      remote: props.remote,
    }))
}

function registerUi(ctx: ClientContext): () => void {
  let providerCardActive = false
  let settingsSectionActive = false
  let disposeFallback: (() => void) | undefined

  const syncFallback = (): void => {
    if (settingsSectionActive && !providerCardActive) {
      disposeFallback ??= ctx.slots.register({
        name: 'settings.section',
        id: 'github-copilot',
        order: 11,
        label: 'GitHub Copilot',
      }, (props: SettingsSectionOwnerProps) => createElement(GitHubCopilotSettingsSection, {
        ...props,
        remote: ctx.remote.githubCopilot,
      }))
      return
    }
    disposeFallback?.()
    disposeFallback = undefined
  }

  const disposeProviderCardInjection = ctx.slots.inject('settings.models.provider-card', () => {
    providerCardActive = true
    syncFallback()
    const dispose = ctx.slots.register({
      name: 'settings.models.provider-card',
      key: 'llm-pi-ai',
    }, (props: ProviderCardExtrasOwnerProps) => createElement(GitHubCopilotProviderCard, {
      ...props,
      remote: ctx.remote.githubCopilot,
    }))
    return () => {
      dispose()
      providerCardActive = false
      syncFallback()
    }
  })

  const disposeSettingsSectionInjection = ctx.slots.inject('settings.section', () => {
    settingsSectionActive = true
    syncFallback()
    return () => {
      settingsSectionActive = false
      syncFallback()
    }
  })

  return () => {
    disposeProviderCardInjection()
    disposeSettingsSectionInjection()
    disposeFallback?.()
  }
}

/** Mount the plugin-owned Remote namespace and register the Models card seat. */
export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(githubCopilotRemote)
  const ui = ctx.inject(['remote.githubCopilot', 'slots'], registerUi)
  try {
    await ui
  } catch (error) {
    await ui.dispose()
    await disposeRemote()
    throw error
  }
  return async () => {
    await ui.dispose()
    await disposeRemote()
  }
}
