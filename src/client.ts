/**
 * Browser companion for the Models provider-card slot.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { createElement, useCallback, useEffect, useState } from 'react'
import type { GitHubCopilotAuthorizationView } from './authorization-controller.ts'
import type { ProviderCardExtrasOwnerProps } from './dsh-alpha3-types.ts'
import githubCopilotRemote from './remote.ts'

export const inject = ['remote', 'slots']

interface GitHubCopilotProviderCardProps extends ProviderCardExtrasOwnerProps {
  readonly remote: ClientContext['remote']['githubCopilot']
}

function messageOf(result: Awaited<ReturnType<GitHubCopilotProviderCardProps['remote']['status']>>): string {
  return result.ok ? '' : result.error.message
}

/** Models-card sign-in/status/sign-out controls for the catalog Copilot row. */
export function GitHubCopilotProviderCard(
  props: GitHubCopilotProviderCardProps,
): ReturnType<typeof createElement> | null {
  const [status, setStatus] = useState<GitHubCopilotAuthorizationView>()
  const [error, setError] = useState<string>()

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

  const notice = status?.notices.at(-1)
  const signedIn = status?.configured === true
  const busy = status?.inFlight === true
  return createElement('div', { 'data-dsh-github-copilot': true },
    createElement('div', { role: 'status', 'aria-live': 'polite' },
      error ?? status?.error ?? (busy ? 'Waiting for GitHub authorization…' : signedIn ? 'Signed in to GitHub Copilot.' : 'Sign in to use GitHub Copilot models.')),
    notice === undefined ? null : createElement('div', null,
      createElement('span', null, notice.message),
      notice.url === undefined ? null : createElement('a', {
        href: notice.url,
        target: '_blank',
        rel: 'noreferrer',
      }, 'Open GitHub'),
      notice.code === undefined ? null : createElement('code', null, notice.code)),
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

function registerUi(ctx: ClientContext): void {
  ctx.slots.inject('settings.models.provider-card', () => ctx.slots.register({
    name: 'settings.models.provider-card',
    key: 'llm-pi-ai',
  }, (props: ProviderCardExtrasOwnerProps) => createElement(GitHubCopilotProviderCard, {
    ...props,
    remote: ctx.remote.githubCopilot,
  })))
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
