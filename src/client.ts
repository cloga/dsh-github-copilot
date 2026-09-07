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
import githubCopilotRemote, { GitHubCopilotAuthorizationViewSchema } from './remote.ts'
import { installReasoningPresentation } from './reasoning-presentation.ts'
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

  const refresh = useCallback(async () => {
    const result = await props.remote.status()
    if (result.ok) {
      const view = authorizationViewFrom(result.value)
      if (view === undefined) { setError('COPILOT_AUTHORIZATION_VIEW_INVALID'); return undefined }
      setStatus(view)
      setError(undefined)
      return view
    }
    setError(messageOf(result))
    return undefined
  }, [props.remote])

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
    if (props.provider.provider !== GITHUB_COPILOT_PROVIDER_ID || status?.inFlight !== true) return
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

  if (props.provider.provider !== GITHUB_COPILOT_PROVIDER_ID) return null

  const invoke = async (
    operation: () => ReturnType<GitHubCopilotProviderCardProps['remote']['status']>,
  ): Promise<void> => {
    const result = await operation()
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

/** A discovery snapshot is metadata evidence, not proof of a successful model call. */
export function GitHubCopilotAccountModelsSummary(props: { readonly snapshot: AccountModelsSnapshot }): ReactElement {
  const { snapshot } = props
  const messages: Record<AccountModelsSnapshot['state'], string> = {
    idle: 'Account models have not been refreshed.',
    loading: 'Account model discovery is still in progress. This panel does not poll automatically.',
    ready: 'Account metadata is ready. Select models under GitHub Copilot in the model picker.',
    stale: 'This account model snapshot is stale. Refresh before relying on its metadata.',
    error: 'Account model discovery failed. Use Refresh account models to retry.',
    disposed: 'Account model discovery is no longer active in this profile.',
    unconfigured: 'Sign in with GitHub before refreshing account models.',
    unavailable: 'Account model discovery is unavailable in this profile.',
  }
  const timestamp = snapshot.discoveredAt === undefined ? undefined : new Date(snapshot.discoveredAt)
  const iso = timestamp !== undefined && Number.isFinite(timestamp.getTime()) ? timestamp.toISOString() : undefined
  return createElement('section', { 'data-dsh-github-copilot-account-models': true },
    createElement('p', { role: 'status', 'aria-live': 'polite', 'data-dsh-github-copilot-account-models-state': snapshot.state }, messages[snapshot.state]),
    createElement('p', null, 'Discovery does not prove a successful model call or hosted search. No default model or account policy is changed.'),
    iso === undefined ? null : createElement('p', null, 'Snapshot time: ', createElement('time', { dateTime: iso }, iso)),
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
}

/** The sole account owner on modern Models pages, independent of a legacy provider profile. */
export function GitHubCopilotPreviewFooter(props: GitHubCopilotPreviewFooterProps): ReactElement {
  return createElement('section', {
    'data-dsh-github-copilot-preview-footer': true,
    style: noticePanelStyle,
  },
  createElement('h3', { style: { margin: 0 } }, 'GitHub Copilot'),
  createElement(GitHubCopilotProviderCard, {
    provider: { provider: GITHUB_COPILOT_PROVIDER_ID, displayName: 'GitHub Copilot', settingsNs: 'llm-pi-ai' },
    configured: false,
    keyConfigured: false,
    remote: props.remote,
  }),
  createElement(GitHubCopilotAccountModelsPanel, { remote: props.remote }),
  compatibilityDetails())
}

function compatibilityDetails(): ReactElement {
  return createElement('details', { 'data-dsh-github-copilot-compatibility': true },
    createElement('summary', null, 'Compatibility and existing configurations'),
    createElement('p', null,
      `GitHub Copilot uses account-discovered models. The internal route ID ${GITHUB_COPILOT_PREVIEW_PROVIDER_ID} is retained for existing sessions and explicit /model selections.`),
    createElement('p', null,
      `An existing ${GITHUB_COPILOT_PROVIDER_ID} profile is a legacy configuration, not a second account. It is kept until explicit migration. Sign out disconnects the shared GitHub authorization; it does not remove saved profiles.`),
    migrationLink())
}

function migrationLink(): ReactElement {
  return createElement('a', {
    href: 'https://github.com/cloga/dsh-github-copilot/blob/main/docs/single-route-migration.md',
    target: '_blank',
    rel: 'noreferrer',
  }, 'Review the single-route migration guide')
}

/** Core owns this retained row. Never start a second authorization or discovery widget here. */
export function GitHubCopilotLegacyProviderNotice(props: ProviderCardExtrasOwnerProps): ReactElement | null {
  if (props.provider.provider !== GITHUB_COPILOT_PROVIDER_ID || !props.configured) return null
  return createElement('div', { 'data-dsh-github-copilot-legacy-profile': true },
    createElement('p', null, 'This legacy provider profile is kept until explicit migration; it is not a second GitHub account. Manage sign-in and account models in the GitHub Copilot account panel.'),
    migrationLink())
}

/** Unified fallback when the Models footer extension is absent or incompatible. */
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
    }),
    createElement(GitHubCopilotAccountModelsPanel, { remote: props.remote }),
    compatibilityDetails())
}

function registerUi(ctx: ClientContext): () => void {
  let active = true
  let footerActive = false
  let settingsSectionActive = false
  let disposeFallback: (() => void) | undefined

  const syncFallback = (): void => {
    if (active && settingsSectionActive && !footerActive) {
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

  const disposeProviderCardInjection = ctx.slots.inject('settings.models.provider-card', () =>
    ctx.slots.register({
      name: 'settings.models.provider-card',
      key: 'llm-pi-ai',
    }, (props: ProviderCardExtrasOwnerProps) => createElement(GitHubCopilotLegacyProviderNotice, props)))

  let disposeFooterInjection: () => void = () => {}
  const reportFooterUnavailable = () => ctx.logger.warn('[github-copilot] COPILOT_PREVIEW_FOOTER_UNAVAILABLE')
  try {
    disposeFooterInjection = ctx.slots.inject('settings.models.footer', () => {
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
        }, () => createElement(GitHubCopilotPreviewFooter, { remote: ctx.remote.githubCopilot }))
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
    disposeFooterInjection()
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
  // The optional Chat contribution must not hold authorization activation on older Cores.
  const presentation = ctx.inject(['uiConversation', 'slots'], scope => installReasoningPresentation({
    slots: scope.slots,
    uiConversation: scope.get('uiConversation'),
    diagnostic: code => scope.logger.warn(`[github-copilot] ${code}`),
  }))
  return async () => {
    await presentation.dispose()
    await ui.dispose()
    await disposeRemote()
  }
}
