/**
 * Browser companion for the Models provider-card slot.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { createElement, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { AUTHORIZATION_POLL_INITIAL_MS, AUTHORIZATION_POLL_MAX_MS, createCompactAccount } from './compact-account.ts'
import type { CSSProperties, ReactElement } from 'react'
import type { GitHubCopilotAuthorizationView } from './authorization-controller.ts'
import type { ProviderCardExtrasOwnerProps, SettingsSectionOwnerProps } from './dsh-supported-types.ts'
import githubCopilotRemote, { GitHubCopilotAuthorizationViewSchema } from './remote.ts'
import { installReasoningPresentation } from './reasoning-presentation.ts'
import { WebSearchRoutingCard } from './web-search-routing-card.ts'
export { WebSearchRoutingCard } from './web-search-routing-card.ts'
export { CopilotUsageCard } from './copilot-usage-card.ts'
import { registerCopilotUsageUi } from './copilot-usage-ui.ts'
import { externalLinkTarget } from './external-link.ts'
import {
  GITHUB_COPILOT_PROVIDER_ID,
  GITHUB_COPILOT_PREVIEW_PROVIDER_ID,
} from './copilot-identity.ts'

export const inject = ['remote', 'slots']

interface GitHubCopilotProviderCardProps extends ProviderCardExtrasOwnerProps {
  readonly remote: ClientContext['remote']['githubCopilot']
}

interface GitHubCopilotSettingsSectionProps extends SettingsSectionOwnerProps {
  readonly remote: ClientContext['remote']['githubCopilot']
}

function messageOf(result: Awaited<ReturnType<GitHubCopilotProviderCardProps['remote']['status']>>): string {
  return result.ok ? '' : 'COPILOT_AUTHORIZATION_REQUEST_FAILED'
}

function viewRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid Client view')
  return value as Record<string, unknown>
}

function viewFields(value: unknown, keys: readonly string[]): Record<string, unknown> {
  const source = viewRecord(value)
  const result: Record<string, unknown> = {}
  for (const key of keys) {
    const field = source[key]
    if (field !== undefined) result[key] = field
  }
  return result
}

function viewStrings(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error('Invalid Client strings')
  const result: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') throw new Error('Invalid Client string')
    result.push(item)
  }
  return result
}

/** Older Remote clients may not decode results: project known fields before validating our own copy. */
export function authorizationViewFrom(value: unknown): GitHubCopilotAuthorizationView | undefined {
  try {
    const source = viewRecord(value)
    const owned = viewFields(source, ['phase', 'configured', 'writable', 'inFlight', 'error'])
    if (typeof owned.phase !== 'string' || !['signed-out', 'authorizing', 'signed-in', 'error'].includes(owned.phase)
      || typeof owned.configured !== 'boolean' || typeof owned.writable !== 'boolean' || typeof owned.inFlight !== 'boolean') return undefined
    const notices = source.notices
    if (!Array.isArray(notices)) return undefined
    owned.notices = notices.map(notice => {
      const next = viewFields(notice, ['message', 'url', 'code'])
      if (typeof next.message !== 'string' || (next.code !== undefined && typeof next.code !== 'string')) throw new Error('Invalid Client notice')
      if (next.url !== undefined) {
        if (typeof next.url !== 'string') throw new Error('Invalid Client URL')
        const url = new URL(next.url)
        if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') throw new Error('Unsafe Client URL')
      }
      return next
    })
    const catalog = source.catalog
    if (catalog !== undefined) {
      const next = viewFields(catalog, ['state', 'accountModelCount', 'supportedModelCount'])
      const fields = viewRecord(catalog)
      next.unknownModelIds = viewStrings(fields.unknownModelIds)
      for (const key of ['temporarilyUnavailableModelIds', 'previewModelIds']) {
        if (fields[key] !== undefined) next[key] = viewStrings(fields[key])
      }
      owned.catalog = next
    }
    const route = source.route
    if (route !== undefined) owned.route = viewFields(route, ['state', 'diagnosticCode'])
    const accountModels = source.accountModels
    if (accountModels !== undefined) owned.accountModels = accountModelsSnapshot(accountModels)
    const parsed = GitHubCopilotAuthorizationViewSchema.safeParse(owned)
    return parsed.success ? parsed.data : undefined
  } catch {
    return undefined
  }
}

export function catalogWarningOf(status: GitHubCopilotAuthorizationView | undefined): string | undefined {
  const catalog = status?.catalog
  if (catalog === undefined) return undefined
  const warnings: string[] = []
  if (catalog.state === 'partially-outdated') {
    warnings.push(`${catalog.unknownModelIds.length} account model(s) are not represented in the installed catalog: ${catalog.unknownModelIds.join(', ')}. Use Refresh account models to read provider endpoint and capability metadata; unsupported metadata will be reported rather than guessed.`)
  }
  if (catalog.state === 'outdated') {
    warnings.push(`The installed catalog does not describe these account models: ${catalog.unknownModelIds.join(', ')}. Use Refresh account models to request current metadata and review any rejection diagnostics.`)
  }
  const unavailable = catalog.temporarilyUnavailableModelIds ?? []
  if (unavailable.length > 0) {
    warnings.push(`Temporarily hidden by the legacy route configuration: ${unavailable.join(', ')}. Refresh account models for the managed account-model route.`)
  }
  return warnings.length === 0 ? undefined : warnings.join(' ')
}

/** Account allocation is not a claim that a route is loaded or a model request succeeded. */
export function previewAssignmentMessage(status: GitHubCopilotAuthorizationView | undefined): string | undefined {
  const ids = status?.catalog?.previewModelIds
  if (status?.configured !== true || ids === undefined || ids.length === 0) return undefined
  return `Stored account snapshot assigns ${ids.length} model(s) to GitHub Copilot account discovery; this is not a live availability check.`
}

export function routeStatusMessage(status: GitHubCopilotAuthorizationView | undefined): string | undefined {
  if (!status?.configured) return undefined
  switch (status.route?.state) {
    case 'needs-repair': return status.route.diagnosticCode === 'RECONCILIATION_FAILED'
      ? 'Model configuration repair failed. Your sign-in is retained; review settings before retrying.'
      : 'Model configuration needs reconciliation. Repair uses the stored account snapshot; it does not refresh GitHub access.'
    case 'conflict': return 'Model configuration conflicts with manual edits or a legacy ownership backup. Automatic repair stopped without rolling back user edits. Review settings before repairing; do not reconnect to force ownership.'
    case 'error': return 'Model configuration could not be inspected. Your sign-in is retained; check the settings service.'
    // An absent legacy profile is the intended managed-only configuration.
    // Account discovery has its own status and must not be inferred from this field.
    case 'not-configured': return undefined
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
  readonly buttonStyle?: CSSProperties
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
    target: externalLinkTarget(),
    rel: 'noreferrer',
  }, 'Open GitHub verification page'),
  props.url === undefined ? null : createElement('div', null,
    'If the browser does not open, copy this address into your browser:',
    createElement('code', {
      'data-dsh-github-copilot-verification-url': true,
      style: { display: 'block', userSelect: 'all', overflowWrap: 'anywhere' },
    }, props.url)),
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
        style: props.buttonStyle,
      }, props.copyState === 'copying'
        ? 'Copying…'
        : props.copyState === 'copied' ? 'Copied' : 'Copy code'))),
  feedback.length === 0 ? null : createElement('div', {
    role: props.copyState === 'failed' ? 'alert' : 'status',
    'aria-live': 'polite',
    'data-dsh-github-copilot-copy-feedback': props.copyState,
  }, feedback))
}

/** Shared account authorization controls, mounted by the account footer or its fallback only. */
export function GitHubCopilotProviderCard(
  props: GitHubCopilotProviderCardProps,
): ReturnType<typeof createElement> | null {
  const [status, setStatus] = useState<GitHubCopilotAuthorizationView>()
  const [error, setError] = useState<string>()
  const [repairing, setRepairing] = useState(false)
  const repairInFlight = useRef(false)
  const [copyState, setCopyState] = useState<CopyState>('idle')
  const copyAttempt = useRef(0)

  const statusRead = useRef<{
    readonly remote: GitHubCopilotProviderCardProps['remote']
    readonly promise: Promise<GitHubCopilotAuthorizationView | undefined>
  }>()
  const refresh = useCallback(() => {
    if (statusRead.current?.remote === props.remote) return statusRead.current.promise
    const reading = Promise.resolve().then(async () => {
      try {
        if (statusRead.current !== request) return undefined
        const result = await props.remote.status()
        if (statusRead.current !== request) return undefined
        if (result.ok) {
          const view = authorizationViewFrom(result.value)
          if (view === undefined) { setError('COPILOT_AUTHORIZATION_VIEW_INVALID'); return undefined }
          setStatus(view)
          setError(undefined)
          return view
        }
        setError('COPILOT_AUTHORIZATION_STATUS_FAILED')
      } catch {
        if (statusRead.current === request) setError('COPILOT_AUTHORIZATION_STATUS_FAILED')
      }
      return undefined
    }).finally(() => {
      if (statusRead.current === request) statusRead.current = undefined
    })
    const request = { remote: props.remote, promise: reading }
    statusRead.current = request
    return reading
  }, [props.remote])

  useEffect(() => () => { statusRead.current = undefined }, [props.remote])

  useEffect(() => {
    if (props.provider.provider !== GITHUB_COPILOT_PROVIDER_ID) return
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
    if (props.provider.provider !== GITHUB_COPILOT_PROVIDER_ID || status?.inFlight !== true || error !== undefined) return
    let disposed = false
    let delay = AUTHORIZATION_POLL_INITIAL_MS
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async (): Promise<void> => {
      const next = await refresh()
      if (!disposed && next?.inFlight === true) {
        delay = Math.min(delay * 2, AUTHORIZATION_POLL_MAX_MS)
        timer = setTimeout(() => void poll(), delay)
      }
    }
    timer = setTimeout(() => void poll(), delay)
    return () => {
      disposed = true
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [props.provider.provider, refresh, status?.inFlight, error])

  if (props.provider.provider !== GITHUB_COPILOT_PROVIDER_ID) return null

  const invoke = async (
    operation: () => ReturnType<GitHubCopilotProviderCardProps['remote']['status']>,
  ): Promise<void> => {
    statusRead.current = undefined
    let result: Awaited<ReturnType<typeof operation>>
    try {
      result = await operation()
    } catch {
      setError('COPILOT_AUTHORIZATION_REQUEST_FAILED')
      return
    } finally {
      statusRead.current = undefined
    }
    if (result.ok) {
      const view = authorizationViewFrom(result.value)
      if (view === undefined) { setError('COPILOT_AUTHORIZATION_VIEW_INVALID'); return }
      setStatus(view)
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
  const previewMessage = previewAssignmentMessage(status)
  return createElement('div', { 'data-dsh-github-copilot': true },
    createElement('div', { role: 'status', 'aria-live': 'polite' },
      error ?? status?.error ?? (busy ? 'Waiting for GitHub authorization…' : signedIn ? 'Signed in to GitHub Copilot.' : 'Sign in to use GitHub Copilot models.')),
    error === 'COPILOT_AUTHORIZATION_STATUS_FAILED' || error === 'COPILOT_AUTHORIZATION_VIEW_INVALID'
      ? createElement('button', { type: 'button', onClick: () => void refresh() }, 'Retry status') : null,
    catalogWarning === undefined ? null : createElement('div', {
      role: 'alert',
      'data-dsh-github-copilot-catalog-warning': status?.catalog?.state,
    }, catalogWarning),
    routeMessage === undefined ? null : createElement('div', {
      role: 'status', 'data-dsh-github-copilot-route-state': status?.route?.state,
    }, routeMessage),
    previewMessage === undefined ? null : createElement('div', {
      'data-dsh-github-copilot-preview-allocation': true,
    }, previewMessage),
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

type AccountModelsSnapshot = NonNullable<GitHubCopilotAuthorizationView['accountModels']>

function discoveryCode(value: string | undefined, fallback: string): string {
  return value !== undefined && /^[A-Z][A-Z0-9_]{0,100}$/.test(value) ? value : fallback
}

/** Copy only the Client presentation fields; unknown account or credential fields never enter UI state. */
function accountModelsSnapshot(value: unknown): AccountModelsSnapshot {
  const source = viewRecord(value)
  const models = source.models, rejected = source.rejected, warnings = source.warnings
  if (!Array.isArray(models) || models.length > 512 || !Array.isArray(rejected) || rejected.length > 1024
    || (warnings !== undefined && (!Array.isArray(warnings) || warnings.length > 1024))) throw new Error('Invalid model view lists')
  const owned = viewFields(source, ['state', 'discoveredAt'])
  owned.models = models.map(model => viewFields(model, ['id', 'name', 'api']))
  const diagnostics = (items: unknown[], fallback: string) => items.map(item => {
    const next = viewFields(item, ['id', 'code'])
    if (typeof next.code !== 'string') throw new Error('Invalid model diagnostic')
    next.code = discoveryCode(next.code, fallback)
    return next
  })
  owned.rejected = diagnostics(rejected, 'COPILOT_MODEL_METADATA_REJECTED')
  if (warnings !== undefined) owned.warnings = diagnostics(warnings, 'COPILOT_MODEL_CAPABILITY_WARNING')
  const error = source.error
  if (error !== undefined) {
    if (typeof error !== 'string') throw new Error('Invalid model error')
    owned.error = discoveryCode(error, 'COPILOT_MODEL_DISCOVERY_FAILED')
  }
  const parsed = GitHubCopilotAuthorizationViewSchema.shape.accountModels.unwrap().safeParse(owned)
  if (!parsed.success) throw new Error('Invalid model view fields')
  return parsed.data
}

function capabilityWarningMessage(code: string): string {
  if (code === 'INPUT_LIMIT_NOT_ENFORCED_BY_CORE') return 'Core does not independently enforce this model\'s input-token limit.'
  if (code === 'REASONING_EFFORTS_UNSUPPORTED') return 'Some advertised thinking levels are not supported by the installed SDK and are not offered.'
  return 'Review this model capability warning before relying on the affected feature.'
}

export interface AccountModelsUpdatedAt {
  readonly text: string
  readonly dateTime: string
  readonly title: string
  readonly ariaLabel: string
}

/** Pure presentation of the Host's last successful cache update; never invent freshness evidence. */
export function formatAccountModelsUpdatedAt(discoveredAt: number | undefined, now: number, locales?: Intl.LocalesArgument): AccountModelsUpdatedAt | undefined {
  if (typeof discoveredAt !== 'number' || !Number.isFinite(discoveredAt) || discoveredAt < 0) return undefined
  const date = new Date(discoveredAt)
  if (!Number.isFinite(date.getTime())) return undefined
  // Omit timeZone deliberately: both hover and accessible text use the viewer's local timezone.
  const title = new Intl.DateTimeFormat(locales, {
    year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', timeZoneName: 'long',
  }).format(date)
  const elapsed = now - discoveredAt
  let text = `Updated ${title}`
  // A future timestamp is clock skew, not a negative age or a claim that it just happened.
  if (Number.isFinite(elapsed) && elapsed >= 0) {
    if (elapsed < 60_000) text = 'Updated just now'
    else {
      const [unit, duration] = elapsed < 3_600_000 ? ['minute', 60_000] as const
        : elapsed < 86_400_000 ? ['hour', 3_600_000] as const : ['day', 86_400_000] as const
      const count = Math.floor(elapsed / duration)
      text = `Updated ${count} ${unit}${count === 1 ? '' : 's'} ago`
    }
  }
  return { text, dateTime: date.toISOString(), title, ariaLabel: `Last successful account-model cache update: ${title}` }
}

/** Display-only clock: no Remote, status, discovery, or controller lifecycle ownership. */
export function GitHubCopilotAccountModelsUpdatedAt(props: { readonly discoveredAt: number | undefined }): ReactElement | null {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const current = Date.now()
    setNow(current)
    if (formatAccountModelsUpdatedAt(props.discoveredAt, current) === undefined) return
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [props.discoveredAt])
  const timestamp = formatAccountModelsUpdatedAt(props.discoveredAt, now)
  return timestamp === undefined ? null : createElement('time', {
    'data-dsh-github-copilot-models-updated-at': true,
    dateTime: timestamp.dateTime, title: timestamp.title, 'aria-label': timestamp.ariaLabel,
    style: { fontSize: '12px', opacity: 0.65, minWidth: 0, maxWidth: '100%', overflowWrap: 'anywhere' },
  }, timestamp.text)
}

/** A discovery snapshot is metadata evidence, not proof of a successful model call. */
export function GitHubCopilotAccountModelsSummary(props: { readonly snapshot: AccountModelsSnapshot }): ReactElement {
  const { snapshot } = props
  const messages: Record<AccountModelsSnapshot['state'], string> = {
    idle: 'Account models have not been refreshed.',
    loading: 'Account model discovery is still in progress. This panel does not poll automatically.',
    ready: 'Account metadata is ready. Select models under GitHub Copilot in the model picker.',
    stale: 'Showing the last checked model list. Freshness is checked when opening Models or preparing a model request.',
    error: 'Account model discovery failed. Use Refresh account models to retry.',
    disposed: 'Account model discovery is no longer active in this profile.',
    unconfigured: 'Sign in with GitHub before refreshing account models.',
    unavailable: 'Account model discovery is unavailable in this profile.',
  }
  return createElement('section', { 'data-dsh-github-copilot-account-models': true },
    createElement('p', { role: 'status', 'aria-live': 'polite', 'data-dsh-github-copilot-account-models-state': snapshot.state }, messages[snapshot.state]),
    createElement('p', null, 'Discovery does not prove a successful model call or hosted search. No default model or account policy is changed.'),
    snapshot.error === undefined ? null : createElement('p', { role: 'alert' }, discoveryCode(snapshot.error, 'COPILOT_MODEL_DISCOVERY_FAILED')),
    createElement('details', null,
      createElement('summary', null, `${snapshot.models.length} accepted model(s)`),
      createElement('ul', null, snapshot.models.map((model, index) => createElement('li', { key: `${model.id}:${index}` },
        `${model.name} (${model.id}) — ${model.api}`)))),
    createElement('details', null,
      createElement('summary', null, `${snapshot.rejected.length} rejected model(s)`),
      createElement('ul', null, snapshot.rejected.map((item, index) => createElement('li', { key: `${item.id ?? 'unknown'}:${index}` },
        `${item.id ?? 'Unidentified model'} — ${discoveryCode(item.code, 'COPILOT_MODEL_METADATA_REJECTED')}`)))),
    snapshot.warnings === undefined || snapshot.warnings.length === 0 ? null : createElement('details', null,
      createElement('summary', null, `${snapshot.warnings.length} capability warning(s)`),
      createElement('p', null, 'Capability warnings do not reject the listed models; they describe limits of specific features.'),
      createElement('ul', null, snapshot.warnings.map((item, index) => createElement('li', { key: `${item.id}:${index}` },
        `${item.id} — ${discoveryCode(item.code, 'COPILOT_MODEL_CAPABILITY_WARNING')}: ${capabilityWarningMessage(item.code)}`)))))
}

/** Explicit account discovery only: no mount-time request, polling, or automatic retry. */
export function GitHubCopilotAccountModelsPanel(props: { readonly remote: ClientContext['remote']['githubCopilot'] }): ReactElement {
  const [snapshot, setSnapshot] = useState<AccountModelsSnapshot>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const lifecycle = useRef({ active: true, epoch: 0, pending: false })
  const latestRemote = useRef(props.remote)
  latestRemote.current = props.remote

  useEffect(() => {
    const scope = lifecycle.current
    scope.active = true
    scope.epoch++
    scope.pending = false
    setSnapshot(undefined)
    setError(undefined)
    setBusy(false)
    return () => { scope.active = false; scope.epoch++; scope.pending = false }
  }, [props.remote])

  const refreshAccountModels = async (): Promise<void> => {
    const scope = lifecycle.current
    if (!scope.active || scope.pending || latestRemote.current !== props.remote) return
    const epoch = scope.epoch
    const remote = props.remote
    const current = () => scope.active && scope.epoch === epoch && latestRemote.current === remote
    scope.pending = true
    setBusy(true)
    setError(undefined)
    setSnapshot(undefined)
    try {
      if (typeof remote.discoverModels !== 'function') {
        if (current()) setError('COPILOT_MODEL_DISCOVERY_UNAVAILABLE')
        return
      }
      const result = await remote.discoverModels()
      if (!current()) return
      if (!result.ok) { setError('COPILOT_MODEL_DISCOVERY_FAILED'); return }
      const view = authorizationViewFrom(result.value)
      if (view === undefined) { setError('COPILOT_MODEL_DISCOVERY_INVALID_VIEW'); return }
      if (view.accountModels === undefined) { setError('COPILOT_MODEL_DISCOVERY_UNAVAILABLE'); return }
      setSnapshot(view.accountModels)
    } catch {
      if (current()) setError('COPILOT_MODEL_DISCOVERY_FAILED')
    } finally {
      if (current()) { scope.pending = false; setBusy(false) }
    }
  }
  return createElement('section', { 'data-dsh-github-copilot-account-models-panel': true, 'aria-busy': busy },
    snapshot === undefined && !busy && error === undefined ? createElement('p', {
      role: 'status', 'data-dsh-github-copilot-discovery-idle': true,
    }, 'Refresh to load the models available to this account. Signing in alone does not refresh this list.') : null,
    createElement('p', null, 'Refresh account models explicitly requests provider metadata and may refresh the stored OAuth grant. It does not start another sign-in or change your selected model.'),
    createElement('button', { type: 'button', disabled: busy, onClick: refreshAccountModels, 'data-dsh-github-copilot-refresh-models': true },
      busy ? 'Refreshing account models…' : 'Refresh account models'),
    error === undefined ? null : createElement('p', { role: 'alert', 'data-dsh-github-copilot-discovery-error': true }, error),
    snapshot === undefined ? null : createElement(GitHubCopilotAccountModelsSummary, { snapshot }))
}

interface GitHubCopilotPreviewFooterProps {
  readonly remote: ClientContext['remote']['githubCopilot']
  /** A slot coordinator owns this controller's attachment across surface handoffs. */
  readonly account?: ReturnType<typeof createCompactAccount>
  readonly embedded?: boolean
}

const compactButtonStyle: CSSProperties = {
  appearance: 'none', border: '1px solid color-mix(in srgb, currentColor 24%, transparent)',
  borderRadius: '999px', background: 'transparent', color: 'inherit', fontFamily: 'inherit',
  fontSize: '13px', lineHeight: '18px', padding: '6px 12px', minHeight: '32px',
  maxWidth: '100%', cursor: 'pointer',
}

function compactErrorMessage(code: string): string {
  if (code === 'COPILOT_MODEL_DISCOVERY_FAILED') return 'Could not refresh models. Try again.'
  if (code === 'COPILOT_AUTHORIZATION_START_FAILED') return 'Could not confirm sign-in. Retry status to check.'
  if (code === 'COPILOT_AUTHORIZATION_CANCEL_FAILED') return 'Could not confirm cancellation. Retry status to check.'
  if (code === 'COPILOT_SIGN_OUT_FAILED') return 'Could not confirm sign-out. Retry status to check.'
  if (code === 'COPILOT_AUTHORIZATION_STATUS_FAILED') return 'Could not check account status. Retry to check again.'
  if (code === 'COPILOT_CONFIGURATION_REPAIR_FAILED') return 'Could not repair the legacy configuration. Review it before retrying.'
  return 'GitHub sign-in failed. Try again.'
}

/** One lifecycle owner; disclosure toggles never mount another status or discovery controller. */
export function GitHubCopilotCompactAccount(props: GitHubCopilotPreviewFooterProps): ReactElement {
  const account = useMemo(() => props.account ?? createCompactAccount(props.remote, authorizationViewFrom, copyAuthorizationCode), [props.remote, props.account])
  const state = useSyncExternalStore(account.subscribe, account.getSnapshot, account.getSnapshot)
  useEffect(() => props.account === undefined ? account.attach() : undefined, [account, props.account])
  const [manageOpen, setManageOpen] = useState(false)
  const managementId = `github-copilot-management-${useId()}`
  const view = state.view
  const signedIn = view?.configured === true
  const authorizing = view?.inFlight === true || state.operation === 'start' || state.operation === 'cancel'
  const pendingAction = state.checking || state.operation !== undefined || authorizing
  const uncertain = state.error === 'COPILOT_AUTHORIZATION_START_FAILED'
    || state.error === 'COPILOT_AUTHORIZATION_CANCEL_FAILED' || state.error === 'COPILOT_SIGN_OUT_FAILED'
  const notice = activeAuthorizationNotice(view)
  const models = view?.accountModels
  const refreshing = state.operation === 'discoverModels' || models?.state === 'loading'
  // The Host alone retains same-account TTL-stale presentation. This count is
  // not readiness, entitlement, or a reason to skip the freshness check.
  const count = models !== undefined && (models.state === 'ready' || models.models.length > 0)
    ? `${models.models.length} model${models.models.length === 1 ? '' : 's'}` : undefined
  const modelStatus = refreshing ? count === undefined ? 'Refreshing models…' : `${count} · Refreshing…`
    : models?.state === 'error' ? count === undefined ? 'Model discovery failed' : `${count} · Refresh failed`
      : count ?? (models?.state === 'unavailable' || models?.state === 'disposed' ? 'Models unavailable' : undefined)
  const status = state.checking ? 'Checking status…'
    : state.operation === 'signOut' ? 'Signing out…'
      : state.operation === 'cancel' ? 'Cancelling sign-in…'
      : uncertain ? 'Status unconfirmed' : authorizing ? 'Authorizing…'
        : signedIn ? 'Signed in' : view === undefined ? 'Status unavailable' : 'Signed out'
  const actionButton = (label: string, onClick: () => unknown, disabled = false, extras: Record<string, unknown> = {}) =>
    createElement('button', { type: 'button', onClick, disabled,
      style: { ...compactButtonStyle, opacity: disabled ? 0.5 : 1, cursor: disabled ? 'default' : 'pointer' }, ...extras }, label)
  return createElement('section', {
    'data-dsh-github-copilot-compact-account': true,
    'data-dsh-github-copilot-embedded': props.embedded === true ? true : undefined,
    'aria-label': props.embedded === true ? 'GitHub Copilot account' : undefined,
    style: props.embedded === true ? { minWidth: 0, marginTop: '8px' }
      : { minWidth: 0, padding: '12px 14px', margin: '12px 0', borderRadius: '16px',
        border: '1px solid color-mix(in srgb, currentColor 24%, transparent)', background: 'transparent' },
  },
  createElement('div', { style: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '10px', minHeight: '42px' } },
    createElement('div', { style: { display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: '8px', minWidth: 0 } },
      props.embedded === true ? null : createElement('h3', { style: { margin: 0, fontSize: '16px', lineHeight: '24px' } }, 'GitHub Copilot'),
      createElement('span', { role: 'status', 'aria-live': 'polite', style: { fontSize: '13px', opacity: 0.75 } }, status),
      modelStatus === undefined ? null : createElement('span', { role: 'status', 'aria-live': 'polite', style: { fontSize: '12px', opacity: 0.7 } }, modelStatus),
      signedIn ? createElement(GitHubCopilotAccountModelsUpdatedAt, { discoveredAt: models?.discoveredAt }) : null),
    createElement('div', { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px', marginInlineStart: 'auto', minWidth: 0 } },
      (view === undefined && !state.checking) || state.error === 'COPILOT_AUTHORIZATION_STATUS_FAILED' || uncertain
        ? actionButton('Retry status', account.retryStatus, state.checking || state.operation !== undefined) : null,
      signedIn && state.error === 'COPILOT_MODEL_DISCOVERY_FAILED'
        ? actionButton('Retry', account.refreshModels, pendingAction, { 'data-dsh-github-copilot-retry-models': true }) : null,
      !signedIn && !authorizing && view !== undefined ? actionButton('Sign in with GitHub', account.start, pendingAction || view.writable === false,
        { title: view.writable === false ? 'Credentials are read-only' : undefined }) : null,
      actionButton('Manage', () => setManageOpen(open => !open), false, { 'aria-expanded': manageOpen, 'aria-controls': managementId }))),
  state.error === undefined ? null : createElement('p', { role: 'alert', 'data-dsh-github-copilot-account-error': state.error,
    style: { margin: '8px 0 0', fontSize: '13px', overflowWrap: 'anywhere' } }, compactErrorMessage(state.error)),
  authorizing ? createElement('div', { 'data-dsh-github-copilot-auto-authorization': true, style: { marginTop: '8px', overflowWrap: 'anywhere' } },
    notice === undefined ? createElement('p', { role: 'status', 'aria-live': 'polite' }, state.operation === 'cancel' ? 'Cancelling sign-in…' : 'Waiting for GitHub authorization…')
      : createElement(GitHubCopilotAuthorizationNotice, { message: notice.message, url: notice.url, code: notice.code,
        copyState: state.copyState, onCopy: () => void account.copyCode(), buttonStyle: compactButtonStyle }),
    actionButton(state.operation === 'cancel' ? 'Cancelling…' : 'Cancel sign-in', account.cancel, state.operation === 'cancel')) : null,
  manageOpen ? createElement('div', { id: managementId, role: 'region', 'aria-label': 'GitHub Copilot account management',
    style: { marginTop: '12px', paddingTop: '12px', borderTop: '1px solid color-mix(in srgb, currentColor 18%, transparent)', overflowWrap: 'anywhere' } },
    createElement('p', { style: { margin: '0 0 10px', fontSize: '13px' } }, 'Signing in here fetches your account models once. Opening this view refreshes missing or stale metadata when needed. No manual model definitions are needed. Refresh models updates account metadata; it does not verify a model call or change your selected model.'),
    signedIn ? actionButton(refreshing ? 'Refreshing models…' : 'Refresh models', account.refreshModels, pendingAction,
      { 'data-dsh-github-copilot-refresh-models': true }) : null,
    models === undefined ? createElement('p', { style: { fontSize: '13px' } }, 'Account model metadata is not available yet.')
      : createElement(GitHubCopilotAccountModelsSummary, { snapshot: models }),
    routeStatusMessage(view) === undefined ? null : createElement('p', { role: 'status' }, routeStatusMessage(view)),
    view?.route?.state === 'needs-repair' && signedIn ? actionButton('Repair model configuration', account.reconcile, pendingAction) : null,
    signedIn ? actionButton(state.operation === 'signOut' ? 'Signing out…' : 'Sign out', account.signOut, pendingAction || view?.writable === false) : null,
    view?.writable === false ? createElement('p', { style: { fontSize: '13px' } }, 'Credentials are read-only in this profile.') : null) : null)
}

/** Standalone footer presentation; registered Models seats use the shared surface coordinator. */
export function GitHubCopilotPreviewFooter(props: GitHubCopilotPreviewFooterProps): ReactElement {
  return createElement('div', { 'data-dsh-github-copilot-preview-footer': true },
    createElement(GitHubCopilotCompactAccount, { remote: props.remote }))
}

type AccountSurfaceKind = 'provider' | 'footer' | 'settings'
interface AccountSurfaceSeat { readonly kind: AccountSurfaceKind; active: boolean }
type AccountController = ReturnType<typeof createCompactAccount>
type AccountSurfaceOwner = { readonly token: symbol; readonly account: AccountController }
interface AccountSurfaceLease { readonly seat: AccountSurfaceSeat; readonly remote: GitHubCopilotPreviewFooterProps['remote'] }

/** Only the mounted canonical row owns embedded controls. Credential presence is not row presence. */
export function isGitHubCopilotAccountRow(props: ProviderCardExtrasOwnerProps): boolean {
  return props.configured && props.provider.provider === GITHUB_COPILOT_PROVIDER_ID
    && props.provider.settingsNs === 'llm-pi-ai'
}

/** Plugin-owned mounted-seat leases, not a view into Core's settings or provider store.
 * One controller follows the winning surface, retaining in-flight work during a
 * handoff. Slot disposal revokes its leases even before React unmounts the rows.
 */
export function createAccountSurfaces() {
  const surfaces = new Map<symbol, AccountSurfaceLease>()
  const listeners = new Set<() => void>()
  const rank: Record<AccountSurfaceKind, number> = { provider: 0, footer: 1, settings: 2 }
  let active = true
  let snapshot: AccountSurfaceOwner | undefined
  let remote: GitHubCopilotPreviewFooterProps['remote'] | undefined
  let account: AccountController | undefined
  let detach: (() => void) | undefined
  const sync = () => {
    let selected: AccountSurfaceLease | undefined
    let token: symbol | undefined
    for (const [candidate, surface] of surfaces) {
      if (surface.seat.active && (selected === undefined || rank[surface.seat.kind] < rank[selected.seat.kind])) {
        selected = surface
        token = candidate
      }
    }
    if (selected?.remote !== remote) {
      detach?.()
      detach = undefined
      remote = selected?.remote
      account = remote === undefined ? undefined : createCompactAccount(remote, authorizationViewFrom, copyAuthorizationCode)
    }
    if (snapshot?.token === token && snapshot?.account === account) return
    snapshot = token === undefined || account === undefined ? undefined : { token, account }
    // Attach only once per remote/lifetime, not once per mounted React surface.
    if (account !== undefined && detach === undefined) detach = account.attach()
    for (const listener of listeners) listener()
  }
  return {
    getSnapshot: () => snapshot,
    invalidate() { account?.invalidate() },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    mount(seat: AccountSurfaceSeat, token: symbol, remote: GitHubCopilotPreviewFooterProps['remote']) {
      if (!active || !seat.active) return () => {}
      const lease = { seat, remote }
      surfaces.set(token, lease)
      sync()
      return () => {
        if (surfaces.get(token) !== lease) return
        surfaces.delete(token)
        sync()
      }
    },
    revoke(seat: AccountSurfaceSeat) {
      seat.active = false
      for (const [token, surface] of surfaces) if (surface.seat === seat) surfaces.delete(token)
      sync()
    },
    dispose() {
      if (!active) return
      active = false
      surfaces.clear()
      sync()
      listeners.clear()
    },
  }
}

/** Arbitration happens in committed layout effects, never during speculative render. */
export function GitHubCopilotAccountSurface(props: GitHubCopilotPreviewFooterProps & {
  readonly surfaces: ReturnType<typeof createAccountSurfaces>
  readonly seat: AccountSurfaceSeat
  readonly eligible?: boolean
}): ReactElement | null {
  const token = useMemo(() => Symbol('github-copilot-account-surface'), [])
  const owner = useSyncExternalStore(props.surfaces.subscribe, props.surfaces.getSnapshot, props.surfaces.getSnapshot)
  useLayoutEffect(() => props.eligible === false ? undefined : props.surfaces.mount(props.seat, token, props.remote),
    [props.surfaces, props.seat, props.remote, props.eligible, token])
  if (props.eligible === false || owner?.token !== token) return null
  const embedded = props.seat.kind === 'provider'
  return createElement('div', { 'data-dsh-github-copilot-account-surface': props.seat.kind },
    createElement(GitHubCopilotCompactAccount, { remote: props.remote, account: owner.account, embedded }))
}

/** Unified fallback when the Models footer extension is absent or incompatible. */
export function GitHubCopilotSettingsSection(
  props: GitHubCopilotSettingsSectionProps,
): ReturnType<typeof createElement> {
  return createElement('section', { 'data-dsh-github-copilot-settings': true },
    createElement(GitHubCopilotCompactAccount, { remote: props.remote }))
}

function registerUi(ctx: ClientContext): () => void {
  const surfaces = createAccountSurfaces()
  const disposeCredentials = ctx.remote.$on('credentials/reference-updated', () => surfaces.invalidate())
  const disposeReset = ctx.on('connection/reset', () => surfaces.invalidate())
  let active = true
  let footerActive = false
  let settingsSectionActive = false
  let disposeFallback: (() => void) | undefined

  const syncFallback = (): void => {
    if (active && settingsSectionActive && !footerActive) {
      if (disposeFallback === undefined) {
        const seat: AccountSurfaceSeat = { kind: 'settings', active: true }
        const dispose = ctx.slots.register({
          name: 'settings.section',
          id: 'github-copilot',
          order: 11,
          label: 'GitHub Copilot',
        }, () => createElement(GitHubCopilotAccountSurface, { surfaces, seat, remote: ctx.remote.githubCopilot }))
        disposeFallback = () => { surfaces.revoke(seat); dispose() }
      }
      return
    }
    disposeFallback?.()
    disposeFallback = undefined
  }

  const disposeProviderCardInjection = ctx.slots.inject('settings.models.provider-card', () => {
    const seat: AccountSurfaceSeat = { kind: 'provider', active: true }
    const dispose = ctx.slots.register({
      name: 'settings.models.provider-card',
      key: 'llm-pi-ai',
    }, (props: ProviderCardExtrasOwnerProps) => {
      if (!props.configured && props.provider.provider === GITHUB_COPILOT_PROVIDER_ID && props.provider.settingsNs === 'llm-pi-ai') {
        return createElement('p', { role: 'note', 'data-dsh-github-copilot-native-add-warning': true,
          style: { fontSize: '13px', lineHeight: 1.6 } },
        'GitHub Copilot account models are already managed by the account panel. Saving this additional provider profile enables another model group; it does not connect a second account. Use the account panel instead. This plugin cannot disable the native Save action.')
      }
      return createElement(GitHubCopilotAccountSurface, {
        surfaces, seat, remote: ctx.remote.githubCopilot, eligible: isGitHubCopilotAccountRow(props),
      })
    })
    return () => { surfaces.revoke(seat); dispose() }
  })

  let disposeFooterInjection: () => void = () => {}
  const reportFooterUnavailable = () => ctx.logger.warn('[github-copilot] COPILOT_PREVIEW_FOOTER_UNAVAILABLE')
  try {
    disposeFooterInjection = ctx.slots.inject('settings.models.footer', () => {
      const seat: AccountSurfaceSeat = { kind: 'footer', active: true }
      let dispose: () => void
      try {
        const spec = ctx.slots.spec?.('settings.models.footer')
        if (spec?.kind !== 'list' || spec.scope !== 'root') {
          reportFooterUnavailable()
          return () => {}
        }
        dispose = ctx.slots.register({
          name: 'settings.models.footer',
          id: GITHUB_COPILOT_PREVIEW_PROVIDER_ID,
          order: 10,
        }, () => createElement(GitHubCopilotAccountSurface, { surfaces, seat, remote: ctx.remote.githubCopilot }))
      } catch {
        // Do not withdraw working fallback authorization until footer registration succeeds.
        reportFooterUnavailable()
        return () => {}
      }
      footerActive = true
      syncFallback()
      let removed = false
      return () => {
        if (removed) return
        removed = true
        surfaces.revoke(seat)
        dispose()
        footerActive = false
        syncFallback()
      }
    })
  } catch {
    reportFooterUnavailable()
  }

  // Register after the optional footer so a supported surface has only one owner.
  const disposeSettingsSectionInjection = ctx.slots.inject('settings.section', () => {
    settingsSectionActive = true
    syncFallback()
    return () => {
      settingsSectionActive = false
      syncFallback()
    }
  })

  return () => {
    active = false
    surfaces.dispose()
    disposeCredentials()
    disposeReset()
    disposeFooterInjection()
    disposeProviderCardInjection()
    disposeSettingsSectionInjection()
    disposeFallback?.()
  }
}

/** Optional search settings must never hold account authorization UI in waiting. */
function registerSearchUi(ctx: ClientContext): () => void {
  let active = true
  let footerActive = false
  let sectionActive = false
  let fallback: (() => void) | undefined
  // Keep traced Remote identities stable across parent renders and async saves.
  const settings = ctx.remote.settings
  const routing = ctx.remote.githubCopilotSearchRouting
  const render = () => createElement(WebSearchRoutingCard, { settings, routing })
  const syncFallback = () => {
    if (active && sectionActive && !footerActive) {
      fallback ??= ctx.slots.register({
        name: 'settings.section', id: 'github-copilot-search-routing', order: 12, label: 'Web search',
      }, render)
    } else {
      fallback?.()
      fallback = undefined
    }
  }
  let footer: () => void = () => {}
  try {
    footer = ctx.slots.inject('settings.models.footer', () => {
      try {
        const spec = ctx.slots.spec?.('settings.models.footer')
        if (spec?.kind !== 'list' || spec.scope !== 'root') return () => {}
        const dispose = ctx.slots.register({
          name: 'settings.models.footer', id: 'github-copilot-search-routing', order: 20,
        }, render)
        footerActive = true
        syncFallback()
        let removed = false
        return () => {
          if (removed) return
          removed = true
          dispose()
          footerActive = false
          syncFallback()
        }
      } catch {
        ctx.logger.warn('[github-copilot] WEB_SEARCH_ROUTING_FOOTER_UNAVAILABLE')
        return () => {}
      }
    })
  } catch { ctx.logger.warn('[github-copilot] WEB_SEARCH_ROUTING_FOOTER_UNAVAILABLE') }
  const section = ctx.slots.inject('settings.section', () => {
    sectionActive = true
    syncFallback()
    return () => { sectionActive = false; syncFallback() }
  })
  return () => {
    active = false
    footer()
    section()
    fallback?.()
    fallback = undefined
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
  const searchUi = ctx.inject(['remote.settings', 'remote.githubCopilotSearchRouting', 'slots'], registerSearchUi)
  const usageUi = ctx.inject(['remote.githubCopilotUsage', 'slots'], registerCopilotUsageUi)
  // The optional Chat contribution must not hold authorization activation on older Cores.
  const presentation = ctx.inject(['uiConversation', 'slots'], scope => installReasoningPresentation({
    slots: scope.slots,
    uiConversation: scope.get('uiConversation'),
    diagnostic: code => scope.logger.warn(`[github-copilot] ${code}`),
  }))
  return async () => {
    await usageUi.dispose()
    await presentation.dispose()
    await searchUi.dispose()
    await ui.dispose()
    await disposeRemote()
  }
}
