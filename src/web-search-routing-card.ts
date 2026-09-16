import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { createElement, useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent, CSSProperties, ReactElement } from 'react'
import { GitHubCopilotAuthorizationViewSchema } from './remote.ts'
import { SearchProviderCatalogSchema } from './search-routing-remote.ts'
import { normalizeWebSearchRouting } from './search-routing-policy.ts'

const GITHUB_COPILOT_SETTINGS_NAMESPACE = 'github-copilot'
const WEB_SEARCH_ROUTING_SETTINGS_NAMESPACE = 'github-copilot-search-routing'
const NO_DEFAULT_SEARCH_PROVIDER = 'none'
const GITHUB_COPILOT_SEARCH_PROVIDER = 'github-copilot-hosted'
const DEEPSEEK_SEARCH_PROVIDER = 'deepseek-official'

interface SearchRoutingCardProps {
  readonly settings: ClientContext['remote']['settings']
  readonly copilot: ClientContext['remote']['githubCopilot']
  readonly routing: ClientContext['remote']['githubCopilotSearchRouting']
}
interface Draft {
  primary: string
  provider: string
  model: string
  legacy: boolean
  routingRevision?: number
  copilotRevision?: number
}
const cardStyle: CSSProperties = {
  display: 'grid', gap: '14px', padding: '18px', marginTop: '16px', minWidth: 0,
  border: '1px solid color-mix(in srgb, currentColor 20%, transparent)',
  borderRadius: '14px', background: 'color-mix(in srgb, currentColor 4%, transparent)',
}
const fieldStyle: CSSProperties = { display: 'grid', gap: '6px', minWidth: 0 }
const controlStyle: CSSProperties = {
  width: '100%', minWidth: 0, boxSizing: 'border-box', padding: '9px 11px', borderRadius: '9px', color: 'inherit',
  border: '1px solid color-mix(in srgb, currentColor 24%, transparent)',
  background: 'color-mix(in srgb, currentColor 3%, transparent)', font: 'inherit',
}
const buttonStyle: CSSProperties = {
  justifySelf: 'start', padding: '9px 16px', borderRadius: '999px', cursor: 'pointer',
  border: '1px solid color-mix(in srgb, currentColor 30%, transparent)',
  background: 'color-mix(in srgb, currentColor 10%, transparent)', color: 'inherit', font: 'inherit',
}
const hintStyle: CSSProperties = { opacity: 0.8, fontSize: '12px', lineHeight: 1.5, overflowWrap: 'anywhere' }
function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
function revisionOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

/** Provider-level primary and final fallback; model choice stays with each provider. */
export function WebSearchRoutingCard(props: SearchRoutingCardProps): ReactElement {
  const [draft, setDraft] = useState<Draft>({ primary: 'auto', provider: DEEPSEEK_SEARCH_PROVIDER, model: '', legacy: true })
  const [models, setModels] = useState<readonly string[]>([])
  const [providers, setProviders] = useState<readonly string[]>([])
  const [catalogReady, setCatalogReady] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [writable, setWritable] = useState(false)
  const [message, setMessage] = useState('')
  const [modelNotice, setModelNotice] = useState('')
  const lifecycle = useRef({ active: false, generation: 0, busy: false })

  const load = useCallback(async () => {
    const owner = lifecycle.current
    if (!owner.active || owner.busy) return
    const generation = ++owner.generation
    const current = () => owner.active && owner.generation === generation
    owner.busy = true
    setLoading(true); setSaving(false); setWritable(false); setCatalogReady(false)
    setMessage(''); setModels([]); setProviders([]); setModelNotice('')
    // Account-model suggestions are optional and never authorize search capability.
    const loadModels = async () => {
      try {
        const result = await props.copilot.status()
        if (!current()) return
        const parsed = result.ok ? GitHubCopilotAuthorizationViewSchema.safeParse(result.value) : undefined
        if (!parsed?.success) {
          setModelNotice('Model suggestions are unavailable. Enter a model id or reload settings to retry.')
          return
        }
        const ids = parsed.data.accountModels?.models.filter(item => item.api === 'openai-responses').map(item => item.id) ?? []
        setModels([...new Set(ids)].sort())
      } catch {
        if (current()) setModelNotice('Model suggestions are unavailable. Enter a model id or reload settings to retry.')
      }
    }
    void loadModels()
    try {
      const [result, catalog] = await Promise.all([
        props.settings.describe(),
        Promise.resolve().then(() => props.routing.providers()).catch(() => undefined),
      ])
      if (!current()) return
      if (!result.ok) { setMessage('Could not load search settings. Reload settings to retry.'); return }
      const routing = result.value.namespaces.find(entry => entry.ns === WEB_SEARCH_ROUTING_SETTINGS_NAMESPACE)
      const copilot = result.value.namespaces.find(entry => entry.ns === GITHUB_COPILOT_SETTINGS_NAMESPACE)
      const routingValue = record(routing?.value), copilotValue = record(copilot?.value)
      const normalized = normalizeWebSearchRouting({
        searchProvider: typeof routingValue.searchProvider === 'string' ? routingValue.searchProvider : undefined,
        searchMode: routingValue.searchMode === 'fixed' ? 'fixed' : 'auto',
        defaultSearchProvider: typeof routingValue.defaultSearchProvider === 'string' ? routingValue.defaultSearchProvider : undefined,
      })
      setDraft({ primary: normalized.primaryProvider, provider: normalized.defaultProvider, legacy: normalized.legacy,
        model: typeof copilotValue.searchModel === 'string' ? copilotValue.searchModel : '',
        routingRevision: revisionOf(routing?.revision), copilotRevision: revisionOf(copilot?.revision) })
      const parsed = catalog?.ok ? SearchProviderCatalogSchema.safeParse(catalog.value) : undefined
      const ids = parsed?.success ? parsed.data.providers.map(entry => entry.id) : []
      if (!parsed?.success || !parsed.data.supported || new Set(ids).size !== ids.length || ids.includes('auto') || ids.includes('none')) {
        setMessage('Search provider list is unavailable. Reload after the routed search service is active.')
        return
      }
      setProviders(ids.toSorted()); setCatalogReady(true)
      setWritable(result.value.writable === true)
      if (!routing || revisionOf(routing.revision) === undefined) {
        setMessage('Web search routing settings are unavailable. Reload after the routing namespace is registered.')
      } else if (!result.value.writable) {
        setMessage('Search settings are read-only in this deployment.')
      }
    } catch {
      setMessageIfCurrent('Could not load search settings. Reload settings to retry.')
    } finally {
      if (current()) { owner.busy = false; setLoading(false) }
    }
    function setMessageIfCurrent(value: string) { if (current()) setMessage(value) }
  }, [props.copilot, props.settings, props.routing])

  useEffect(() => {
    const owner = lifecycle.current; owner.active = true; void load()
    return () => { owner.active = false; owner.generation++; owner.busy = false }
  }, [load])

  const usesCopilot = draft.primary === GITHUB_COPILOT_SEARCH_PROVIDER || draft.provider === GITHUB_COPILOT_SEARCH_PROVIDER
  const disabled = loading || saving || !writable || draft.routingRevision === undefined || !catalogReady
  const missingCopilot = usesCopilot && draft.copilotRevision === undefined
  const primaryKnown = draft.primary === 'auto' || draft.primary === 'none' || providers.includes(draft.primary)
  const fallbackKnown = draft.provider === 'none' || providers.includes(draft.provider)
  const missingProvider = !primaryKnown || !fallbackKnown

  const save = useCallback(async () => {
    const owner = lifecycle.current
    if (!owner.active || owner.busy || disabled || missingCopilot) return
    if (missingProvider) { setMessage('Choose a registered search provider, or disable the fallback with None.'); return }
    const generation = owner.generation
    const current = () => owner.active && owner.generation === generation
    const provider = draft.provider, primary = draft.primary, model = draft.model.trim()
    if (usesCopilot && model.length === 0) { setMessage('Enter a Copilot Responses model before using GitHub Copilot search.'); return }
    owner.busy = true; setSaving(true); setMessage('')
    let modelSaved = false
    const saveFailure = () => modelSaved
      ? 'Copilot search model was saved, but routing was not confirmed. Retry Save, or reload settings to review current values. The two namespaces are not saved atomically.'
      : 'Search settings could not be saved or confirmed. Retry Save, or reload settings to review current values before retrying.'
    try {
      if (usesCopilot) {
        const modelWrite = await props.settings.mutate(GITHUB_COPILOT_SETTINGS_NAMESPACE, [{ op: 'set', path: ['searchModel'], value: model }], draft.copilotRevision)
        if (!current()) return
        if (!modelWrite.ok) { setMessage(saveFailure()); return }
        modelSaved = true
        const revision = revisionOf(modelWrite.value.revision)
        setDraft(value => current() ? { ...value, model, copilotRevision: revision } : value)
        if (revision === undefined) { setMessage(saveFailure()); return }
      }
      const routingWrite = await props.settings.mutate(WEB_SEARCH_ROUTING_SETTINGS_NAMESPACE, [
        { op: 'set', path: ['searchProvider'], value: primary },
        { op: 'set', path: ['defaultSearchProvider'], value: provider },
      ], draft.routingRevision)
      if (!current()) return
      if (!routingWrite.ok) { setMessage(saveFailure()); return }
      const revision = revisionOf(routingWrite.value.revision)
      setDraft(value => current() ? { ...value, primary, provider, routingRevision: revision, legacy: false } : value)
      setMessage(revision === undefined ? 'Save returned no revision. Reload settings before editing again.' : 'Saved. New searches use this routing immediately.')
    } catch {
      if (current()) setMessage(saveFailure())
    } finally {
      if (current()) { owner.busy = false; setSaving(false) }
    }
  }, [disabled, draft, missingCopilot, missingProvider, props.settings, usesCopilot])

  const providerOptions = () => providers.map(id => createElement('option', { key: id, value: id }, id))
  const unavailableOption = (id: string, known: boolean) => known ? null : createElement('option', { value: id, disabled: true }, `${id || '(empty)'} — unavailable`)
  return createElement('section', { style: cardStyle, 'data-dsh-web-search-routing': true },
    createElement('div', null,
      createElement('h3', { style: { margin: 0, fontSize: '16px' } }, 'Web search'),
      createElement('p', { style: { margin: '5px 0 0', opacity: 0.8, fontSize: '13px', lineHeight: 1.5 } },
        'Auto follows the Chat provider when a matching search provider exists. Choose a provider to keep search fixed, independently of Chat.'),
    ),
    createElement('label', { style: fieldStyle },
      createElement('span', { style: { fontSize: '13px', fontWeight: 600 } }, 'Search provider'),
      createElement('select', { style: controlStyle, disabled, value: draft.primary, 'data-dsh-web-search-mode': true,
        onChange: (event: ChangeEvent<HTMLSelectElement>) => { const primary = event.currentTarget.value; setDraft(current => ({ ...current, primary })) } },
      createElement('option', { value: 'auto' }, 'Auto — follow Chat'),
      draft.primary === 'none' ? createElement('option', { value: 'none' }, 'Disabled — saved configuration') : null,
      ...providerOptions(), unavailableOption(draft.primary, primaryKnown)),
    ),
    createElement('label', { style: fieldStyle },
      createElement('span', { style: { fontSize: '13px', fontWeight: 600 } }, 'Default search provider'),
      createElement('select', { style: controlStyle, disabled, value: draft.provider, 'data-dsh-web-search-provider': true,
        onChange: (event: ChangeEvent<HTMLSelectElement>) => { const provider = event.currentTarget.value; setDraft(current => ({ ...current, provider })) } },
      createElement('option', { value: NO_DEFAULT_SEARCH_PROVIDER }, 'None — no fallback'),
      ...providerOptions(), unavailableOption(draft.provider, fallbackKnown)),
      createElement('span', { style: hintStyle }, 'Final fallback only: used when Auto has no matching provider or the primary search fails. The same provider is never retried as its own fallback.'),
    ),
    catalogReady && providers.length === 0 ? createElement('p', { role: 'status', style: hintStyle }, 'No search providers are registered. Enable a search provider, then reload settings.') : null,
    catalogReady && missingProvider ? createElement('p', { role: 'status', style: hintStyle }, 'A saved provider is no longer registered. Choose an available entry; it has not been replaced automatically.') : null,
    draft.legacy && catalogReady ? createElement('p', { style: hintStyle }, 'Your existing choices are preserved. Saving adopts the selected Default as the final fallback, which may incur that provider’s API charges. Cancellation and captured account-proof invalidation never trigger fallback.') : null,
    !usesCopilot ? null : createElement('label', { style: fieldStyle },
      createElement('span', { style: { fontSize: '13px', fontWeight: 600 } }, 'Copilot search model'),
      createElement('input', { style: controlStyle, list: 'dsh-copilot-search-models', disabled: disabled || missingCopilot,
        value: draft.model, placeholder: 'account-authorized Responses model id', 'data-dsh-copilot-search-model': true,
        onChange: (event: ChangeEvent<HTMLInputElement>) => { const model = event.currentTarget.value; setDraft(current => ({ ...current, model })) } }),
      createElement('datalist', { id: 'dsh-copilot-search-models' }, ...models.map(id => createElement('option', { key: id, value: id }))),
      createElement('span', { style: hintStyle }, 'Used when Copilot is selected explicitly or as the fallback. Account Responses models are suggestions, not hosted-search capability proof. This does not change the Chat model.'),
      missingCopilot ? createElement('span', { role: 'status' }, 'Copilot search settings are unavailable. Reload after the github-copilot namespace is registered, or choose another provider.') : null,
      modelNotice ? createElement('span', { role: 'status', style: hintStyle }, modelNotice) : null,
    ),
    createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' } },
      createElement('button', { type: 'button', style: buttonStyle, disabled: disabled || missingCopilot || missingProvider,
        'data-dsh-web-search-save': true, onClick: () => { void save() } }, loading ? 'Loading…' : saving ? 'Saving…' : 'Save search routing'),
      createElement('button', { type: 'button', style: buttonStyle, disabled: loading || saving,
        title: 'Reload saved values and discard unsaved edits', 'data-dsh-web-search-reload': true, onClick: () => { void load() } }, 'Reload settings'),
      message.length === 0 ? null : createElement('span', { role: 'status', style: hintStyle }, message),
    ),
  )
}
