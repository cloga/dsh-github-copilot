import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { createElement, useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent, CSSProperties, ReactElement } from 'react'
import { SearchProviderCatalogSchema } from './search-routing-remote.ts'
import { normalizeWebSearchRouting } from './search-routing-policy.ts'
import { nativeOptionStyle, nativeSelectStyle } from './native-select-style.ts'
import type { InlineConfig } from './config.ts'

const GITHUB_COPILOT_SETTINGS_NAMESPACE = 'github-copilot'
const WEB_SEARCH_ROUTING_SETTINGS_NAMESPACE = 'github-copilot-search-routing'
const GITHUB_COPILOT_SEARCH_PROVIDER = 'github-copilot-hosted'
const DEEPSEEK_SEARCH_PROVIDER = 'deepseek-official'

interface SearchRoutingCardProps {
  readonly settings: ClientContext['remote']['settings']
  readonly routing: ClientContext['remote']['githubCopilotSearchRouting']
}
interface Draft {
  primary: string
  provider: string
  legacy: boolean
  routingRevision?: number
  routingNamespace: string
}
interface ModelOverride { model: string; revision?: number }
const cardStyle: CSSProperties = {
  display: 'grid', gap: '14px', padding: '18px', marginTop: '16px', minWidth: 0,
  border: '1px solid color-mix(in srgb, currentColor 20%, transparent)',
  borderRadius: '14px', background: 'color-mix(in srgb, currentColor 4%, transparent)',
}
const restartBannerStyle: CSSProperties = {
  padding: '12px 14px', borderRadius: '10px', fontSize: '13px', lineHeight: 1.5,
  border: '1px solid color-mix(in srgb, var(--dsw-alias-color-warning, #e3a300) 40%, transparent)',
  background: 'color-mix(in srgb, var(--dsw-alias-color-warning, #e3a300) 12%, transparent)',
  display: 'grid', gap: '4px',
}
const fieldStyle: CSSProperties = { display: 'grid', gap: '6px', minWidth: 0 }
const optionsRowStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }
const buttonStyle: CSSProperties = {
  justifySelf: 'start', padding: '9px 16px', borderRadius: '999px', cursor: 'pointer',
  border: '1px solid color-mix(in srgb, currentColor 30%, transparent)',
  background: 'color-mix(in srgb, currentColor 10%, transparent)', color: 'inherit', font: 'inherit',
}
const hintStyle: CSSProperties = { opacity: 0.8, fontSize: '12px', lineHeight: 1.5, overflowWrap: 'anywhere', margin: 0 }
function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
function revisionOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}
function providerLabel(id: string): string {
  return id === GITHUB_COPILOT_SEARCH_PROVIDER ? 'GitHub Copilot' : id === DEEPSEEK_SEARCH_PROVIDER ? 'DeepSeek' : id
}
function saveFailure(error: unknown): string {
  const code = record(error).code
  if (code === 'settings-conflict') return 'Search settings changed since you opened this page. Reload settings, then review and save your choices again.'
  if (code === 'settings-rejected') return 'The settings service rejected this change. Reload settings to check whether editing is available, then try again.'
  return 'Could not confirm the save. Reload settings to check saved values before retrying. Your current choices have been kept.'
}

type SearchOptions = Required<Pick<InlineConfig,
  'enabled' | 'providers' | 'routeWebSearch' | 'includeSources' | 'stripServerTools'
  | 'idleTimeoutMs' | 'probe' | 'probeTimeoutMs' | 'searchFallback'>>
type OptionsDraft = Omit<SearchOptions, 'providers' | 'idleTimeoutMs' | 'probeTimeoutMs'> & {
  providers: string
  idleTimeoutMs: string
  probeTimeoutMs: string
}
const searchDefaults: SearchOptions = {
  enabled: true, providers: [], routeWebSearch: true, includeSources: true,
  stripServerTools: true, idleTimeoutMs: 300_000, probe: true,
  probeTimeoutMs: 30_000, searchFallback: 'deepseek',
}
const timeoutLimit = 2_147_483_647

function searchOptions(value: unknown): OptionsDraft | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const source = record(value)
  const options = { ...searchDefaults, ...source }
  if (typeof options.enabled !== 'boolean' || typeof options.routeWebSearch !== 'boolean'
    || typeof options.includeSources !== 'boolean' || typeof options.stripServerTools !== 'boolean'
    || typeof options.probe !== 'boolean' || !Array.isArray(options.providers)
    || options.providers.some((id: unknown) => typeof id !== 'string')
    || options.searchFallback !== 'deepseek' && options.searchFallback !== 'none'
    || ![options.idleTimeoutMs, options.probeTimeoutMs].every(number => typeof number === 'number'
      && Number.isSafeInteger(number) && number >= 1 && number <= timeoutLimit)) return undefined
  return {
    enabled: options.enabled, routeWebSearch: options.routeWebSearch,
    includeSources: options.includeSources, stripServerTools: options.stripServerTools,
    probe: options.probe, searchFallback: options.searchFallback,
    providers: options.providers.join(', '),
    idleTimeoutMs: String(options.idleTimeoutMs), probeTimeoutMs: String(options.probeTimeoutMs),
  }
}

/** Edit only explicit Copilot hosted-search leaves; provider routing remains a separate CAS. */
export function HostedSearchSettingsCard({ settings }: Pick<SearchRoutingCardProps, 'settings'>): ReactElement {
  const [draft, setDraft] = useState<OptionsDraft>(() => searchOptions({})!)
  const [saved, setSaved] = useState<OptionsDraft>()
  const [revision, setRevision] = useState<number>()
  const [writable, setWritable] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const lifecycle = useRef({ active: false, generation: 0, busy: false })
  const load = useCallback(async () => {
    const owner = lifecycle.current
    if (!owner.active || owner.busy) return
    const generation = ++owner.generation
    owner.busy = true
    setLoading(true); setWritable(false); setMessage('')
    try {
      const result = await settings.describe()
      if (!owner.active || generation !== owner.generation) return
      if (!result.ok) { setMessage('Could not load Copilot search options. Reload to retry.'); return }
      const entry = result.value.namespaces.find(item => item.ns === GITHUB_COPILOT_SETTINGS_NAMESPACE)
      const next = entry && searchOptions(entry.value)
      const nextRevision = revisionOf(entry?.revision)
      if (!next || nextRevision === undefined) {
        setMessage('Copilot search settings are unavailable or invalid. Review the saved configuration.')
        return
      }
      setDraft(next); setSaved(next); setRevision(nextRevision)
      setWritable(result.value.writable === true)
      if (!result.value.writable) setMessage('Copilot search settings are read-only in this deployment.')
    } catch {
      if (owner.active && generation === owner.generation) setMessage('Could not load Copilot search options. Reload to retry.')
    } finally {
      if (owner.active && generation === owner.generation) { owner.busy = false; setLoading(false) }
    }
  }, [settings])

  useEffect(() => {
    const owner = lifecycle.current; owner.active = true; void load()
    return () => { owner.active = false; owner.generation++; owner.busy = false }
  }, [load])

  const update = <K extends keyof OptionsDraft>(key: K, value: OptionsDraft[K]): void => {
    setDraft(current => ({ ...current, [key]: value }))
    setMessage('')
  }
  const disabled = loading || saving || !writable || revision === undefined || saved === undefined
  const save = async (): Promise<void> => {
    const owner = lifecycle.current
    if (disabled || owner.busy || saved === undefined || revision === undefined) return
    const ops: Array<{ op: 'set'; path: string[]; value: boolean | number | string | string[] }> = []
    for (const key of ['enabled', 'routeWebSearch', 'includeSources', 'stripServerTools', 'probe', 'searchFallback'] as const) {
      if (draft[key] !== saved[key]) ops.push({ op: 'set', path: [key], value: draft[key] })
    }
    for (const key of ['idleTimeoutMs', 'probeTimeoutMs'] as const) {
      if (draft[key] === saved[key]) continue
      const value = Number(draft[key])
      if (!/^\d+$/.test(draft[key]) || !Number.isSafeInteger(value) || value < 1 || value > timeoutLimit) {
        setMessage(`${key} must be a whole number between 1 and ${timeoutLimit}.`)
        return
      }
      ops.push({ op: 'set', path: [key], value })
    }
    if (draft.providers !== saved.providers) {
      const providers = draft.providers.split(',').map(id => id.trim())
      if (providers.some(id => !id) && draft.providers.trim() !== '' || new Set(providers).size !== providers.length) {
        setMessage('Enter distinct route IDs separated by commas, or leave the allowlist empty.')
        return
      }
      ops.push({ op: 'set', path: ['providers'], value: draft.providers.trim() === '' ? [] : providers })
    }
    if (ops.length === 0) { setMessage('No search options changed.'); return }
    const generation = owner.generation
    owner.busy = true; setSaving(true); setMessage('')
    try {
      const result = await settings.mutate(GITHUB_COPILOT_SETTINGS_NAMESPACE, ops, revision)
      if (!owner.active || generation !== owner.generation) return
      if (!result.ok) { setMessage(saveFailure(result.error)); return }
      const nextRevision = revisionOf(result.value.revision)
      if (nextRevision === undefined) {
        setRevision(undefined)
        setMessage('Save returned no revision. Reload settings before editing again.')
        return
      }
      setRevision(nextRevision); setSaved(draft)
      setMessage('Saved Copilot search options. Availability is checked when you search.')
    } catch (error) {
      if (owner.active && generation === owner.generation) setMessage(saveFailure(error))
    } finally {
      if (owner.active && generation === owner.generation) { owner.busy = false; setSaving(false) }
    }
  }
  const toggles = [
    ['enabled', 'Enable Copilot hosted search'],
    ['routeWebSearch', 'Route web search through this plugin'],
    ['includeSources', 'Include citations in inline requests'],
    ['stripServerTools', 'Remove local variants of hosted-search tools'],
    ['probe', 'Verify native search capability before use'],
  ] as const
  return createElement('details', { 'data-dsh-copilot-search-options': true, style: cardStyle },
    createElement('summary', { style: { cursor: 'pointer', fontWeight: 600 } }, 'Copilot hosted-search options'),
    createElement('p', { style: hintStyle }, 'These settings affect Copilot only. Disabling capability verification explicitly trusts the provider protocol. The allowlist restricts routes; it does not choose a search model.'),
    ...toggles.map(([key, label]) => createElement('label', { key, style: optionsRowStyle },
      createElement('input', { type: 'checkbox', disabled, checked: draft[key], 'data-dsh-copilot-search-option': key,
        onChange: (event: ChangeEvent<HTMLInputElement>) => update(key, event.currentTarget.checked) }), label)),
    createElement('label', { style: fieldStyle }, 'Allowed route IDs (comma-separated; empty follows the initiating route)',
      createElement('input', { type: 'text', disabled, value: draft.providers, 'data-dsh-copilot-search-option': 'providers',
        onChange: (event: ChangeEvent<HTMLInputElement>) => update('providers', event.currentTarget.value) })),
    ...(['idleTimeoutMs', 'probeTimeoutMs'] as const).map(key => createElement('label', { key, style: fieldStyle },
      key === 'idleTimeoutMs' ? 'Search idle timeout (ms)' : 'Capability probe timeout (ms)',
      createElement('input', { type: 'number', min: 1, max: timeoutLimit, step: 1, disabled, value: draft[key],
        'data-dsh-copilot-search-option': key,
        onChange: (event: ChangeEvent<HTMLInputElement>) => update(key, event.currentTarget.value) }))),
    createElement('label', { style: fieldStyle }, 'Legacy failure fallback',
      createElement('select', { disabled, value: draft.searchFallback, style: nativeSelectStyle(disabled),
        'data-dsh-copilot-search-option': 'searchFallback',
        onChange: (event: ChangeEvent<HTMLSelectElement>) => update('searchFallback', event.currentTarget.value === 'none' ? 'none' : 'deepseek') },
      createElement('option', { value: 'deepseek', style: nativeOptionStyle() }, 'Use configured DeepSeek fallback'),
      createElement('option', { value: 'none', style: nativeOptionStyle() }, 'No legacy failure fallback'))),
    createElement('div', { style: optionsRowStyle },
      createElement('button', { type: 'button', style: buttonStyle, disabled, 'data-dsh-copilot-search-options-save': true,
        onClick: () => { void save() } }, saving ? 'Saving…' : 'Save Copilot search options'),
      createElement('button', { type: 'button', style: buttonStyle, disabled: loading || saving,
        onClick: () => { void load() } }, 'Reload options')),
    createElement('p', { role: 'status', 'aria-live': 'polite', style: hintStyle }, message))
}

/** Save provider routing independently of account discovery and provider-specific model settings. */
export function WebSearchRoutingCard(props: SearchRoutingCardProps): ReactElement {
  const [draft, setDraft] = useState<Draft>({
    primary: 'auto', provider: DEEPSEEK_SEARCH_PROVIDER, legacy: true,
    routingNamespace: WEB_SEARCH_ROUTING_SETTINGS_NAMESPACE,
  })
  const [override, setOverride] = useState<ModelOverride>({ model: '' })
  const [providers, setProviders] = useState<readonly string[]>([])
  const [catalogReady, setCatalogReady] = useState(false)
  const [restartRequired, setRestartRequired] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<'routing' | 'override' | undefined>()
  const [writable, setWritable] = useState(false)
  const [message, setMessage] = useState('')
  const lifecycle = useRef({ active: false, generation: 0, busy: false })

  const load = useCallback(async () => {
    const owner = lifecycle.current
    if (!owner.active || owner.busy) return
    const generation = ++owner.generation
    const current = () => owner.active && owner.generation === generation
    owner.busy = true
    setLoading(true); setSaving(undefined); setWritable(false); setCatalogReady(false); setRestartRequired(false)
    setMessage(''); setProviders([])
    try {
      const [result, catalog] = await Promise.all([
        props.settings.describe(),
        Promise.resolve().then(() => props.routing.providers()).catch(() => undefined),
      ])
      if (!current()) return
      if (!result.ok) { setMessage('Could not load search settings. Reload settings to retry.'); return }
      const copilot = result.value.namespaces.find(entry => entry.ns === GITHUB_COPILOT_SETTINGS_NAMESPACE)
      const routing = result.value.namespaces.find(entry => entry.ns === WEB_SEARCH_ROUTING_SETTINGS_NAMESPACE)
      const copilotValue = record(copilot?.value)
      const routingValue = record(routing?.value)
      const normalized = normalizeWebSearchRouting({
        searchProvider: typeof routingValue.searchProvider === 'string' ? routingValue.searchProvider : undefined,
        searchMode: routingValue.searchMode === 'fixed' ? 'fixed' : 'auto',
        defaultSearchProvider: typeof routingValue.defaultSearchProvider === 'string' ? routingValue.defaultSearchProvider : undefined,
      })
      setDraft({ primary: normalized.primaryProvider, provider: normalized.defaultProvider, legacy: normalized.legacy,
        routingRevision: revisionOf(routing?.revision), routingNamespace: WEB_SEARCH_ROUTING_SETTINGS_NAMESPACE })
      setOverride({ model: typeof copilotValue.searchModel === 'string' ? copilotValue.searchModel.trim() : '',
        revision: revisionOf(copilot?.revision) })
      const parsed = catalog?.ok ? SearchProviderCatalogSchema.safeParse(catalog.value) : undefined
      const ids = parsed?.success ? parsed.data.providers.map(entry => entry.id) : []
      if (!parsed?.success || !parsed.data.supported || new Set(ids).size !== ids.length || ids.includes('auto') || ids.includes('none')) {
        if (parsed?.success && !parsed.data.supported) {
          setRestartRequired(true)
          setMessage('Search service is not ready. Please restart Desktop to apply updates.')
        } else {
          setMessage('Search provider list is unavailable. Reload after the routed search service is active.')
        }
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
      if (current()) setMessage('Could not load search settings. Reload settings to retry.')
    } finally {
      if (current()) { owner.busy = false; setLoading(false) }
    }
  }, [props.settings, props.routing])

  useEffect(() => {
    const owner = lifecycle.current; owner.active = true; void load()
    return () => { owner.active = false; owner.generation++; owner.busy = false }
  }, [load])

  const usesCopilot = draft.primary === GITHUB_COPILOT_SEARCH_PROVIDER || draft.provider === GITHUB_COPILOT_SEARCH_PROVIDER
  const disabled = loading || saving !== undefined || !writable || draft.routingRevision === undefined || !catalogReady
  const primaryKnown = draft.primary === 'auto' || draft.primary === 'none' || providers.includes(draft.primary)
  const fallbackKnown = draft.provider === 'none' || providers.includes(draft.provider)
  const missingProvider = !primaryKnown || !fallbackKnown

  const save = useCallback(async () => {
    const owner = lifecycle.current
    if (!owner.active || owner.busy || disabled) return
    if (missingProvider) { setMessage('Choose a registered search provider, or disable the fallback with None.'); return }
    const generation = owner.generation
    const current = () => owner.active && owner.generation === generation
    const provider = draft.provider, primary = draft.primary
    owner.busy = true; setSaving('routing'); setMessage('')
    try {
      const result = await props.settings.mutate(draft.routingNamespace, [
        { op: 'set', path: ['searchProvider'], value: primary },
        { op: 'set', path: ['defaultSearchProvider'], value: provider },
      ], draft.routingRevision)
      if (!current()) return
      if (!result.ok) { setMessage(saveFailure(result.error)); return }
      const revision = revisionOf(result.value.revision)
      setDraft(value => current() ? { ...value, primary, provider, routingRevision: revision, legacy: false } : value)
      setMessage(revision === undefined ? 'Save returned no revision. Reload settings before editing again.'
        : 'Saved. New searches use this routing. Search availability is checked when you search.')
    } catch (error) {
      if (current()) setMessage(saveFailure(error))
    } finally {
      if (current()) { owner.busy = false; setSaving(undefined) }
    }
  }, [disabled, draft, missingProvider, props.settings])

  // Explicitly reset an old override without also saving the provider draft.
  // Empty overrides inherited composition values; unset would reveal them again.
  const clearOverride = useCallback(async () => {
    const owner = lifecycle.current
    if (!owner.active || owner.busy || disabled || override.revision === undefined) return
    const generation = owner.generation
    const current = () => owner.active && owner.generation === generation
    owner.busy = true; setSaving('override'); setMessage('')
    try {
      const result = await props.settings.mutate(GITHUB_COPILOT_SETTINGS_NAMESPACE,
        [{ op: 'set', path: ['searchModel'], value: '' }], override.revision)
      if (!current()) return
      if (!result.ok) { setMessage(saveFailure(result.error)); return }
      const revision = revisionOf(result.value.revision)
      if (revision === undefined) {
        setOverride(value => ({ ...value, revision: undefined }))
        setMessage('Save returned no revision. Reload settings before editing again.')
        return
      }
      setOverride({ model: '', revision })
      setMessage('Copilot model selection is now automatic. Unsaved provider choices have not been applied.')
    } catch (error) {
      if (current()) setMessage(saveFailure(error))
    } finally {
      if (current()) { owner.busy = false; setSaving(undefined) }
    }
  }, [disabled, override, props.settings])

  const providerOptions = () => providers.map(id => createElement('option', { key: id, value: id, style: nativeOptionStyle() }, providerLabel(id)))
  const unavailableOption = (id: string, known: boolean) => known ? null : createElement('option', { value: id, disabled: true, style: nativeOptionStyle(true) }, `${id || '(empty)'} — unavailable`)
  return createElement('section', { style: cardStyle, 'data-dsh-web-search-routing': true, 'aria-busy': loading || saving !== undefined },
    restartRequired ? createElement('div', { role: 'alert', style: restartBannerStyle, 'data-dsh-web-search-restart-banner': true },
      createElement('strong', { style: { fontWeight: 600 } }, 'Restart required to complete update / 检测到更新，请重启 Desktop 完成生效'),
      createElement('span', { style: { opacity: 0.85 } },
        'Web search service composition requires a full application restart to rebind components. / Web 搜索服务组件更新需退出并重新启动 Desktop 以完成重编排。'),
    ) : null,
    createElement('div', null,
      createElement('h3', { style: { margin: 0, fontSize: '16px' } }, 'Web search'),
      createElement('p', { style: { margin: '5px 0 0', opacity: 0.8, fontSize: '13px', lineHeight: 1.5 } },
        'Choose who runs web searches. This does not change your Chat model.'),
    ),
    createElement('label', { style: fieldStyle },
      createElement('span', { style: { fontSize: '13px', fontWeight: 600 } }, 'Search provider'),
      createElement('select', { style: nativeSelectStyle(disabled), disabled, value: draft.primary, 'data-dsh-web-search-mode': true,
        onChange: (event: ChangeEvent<HTMLSelectElement>) => { const primary = event.currentTarget.value; setMessage(''); setDraft(current => ({ ...current, primary })) } },
      createElement('option', { value: 'auto', style: nativeOptionStyle() }, 'Auto — follow Chat'),
      draft.primary === 'none' ? createElement('option', { value: 'none', style: nativeOptionStyle() }, 'Disabled — saved configuration') : null,
      ...providerOptions(), unavailableOption(draft.primary, primaryKnown)),
      createElement('span', { style: hintStyle }, 'Auto follows the Chat provider when it supports search. A selected provider stays fixed when you switch Chat models.'),
    ),
    createElement('label', { style: fieldStyle },
      createElement('span', { style: { fontSize: '13px', fontWeight: 600 } }, 'Fallback provider'),
      createElement('select', { style: nativeSelectStyle(disabled), disabled, value: draft.provider, 'data-dsh-web-search-provider': true,
        onChange: (event: ChangeEvent<HTMLSelectElement>) => { const provider = event.currentTarget.value; setMessage(''); setDraft(current => ({ ...current, provider })) } },
      createElement('option', { value: 'none', style: nativeOptionStyle() }, 'None — no fallback'),
      ...providerOptions(), unavailableOption(draft.provider, fallbackKnown)),
      createElement('span', { style: hintStyle }, 'Used if Auto has no matching provider or the primary search fails. May incur the fallback provider’s charges. The same provider is not tried twice.'),
    ),
    catalogReady && providers.length === 0 ? createElement('p', { role: 'status', style: hintStyle }, 'No search providers are registered. Enable a search provider, then reload settings.') : null,
    catalogReady && missingProvider ? createElement('p', { role: 'status', style: hintStyle }, 'A saved provider is no longer registered. Choose an available entry; it has not been replaced automatically.') : null,
    draft.legacy && catalogReady ? createElement('p', { style: hintStyle }, 'Saving adopts the selected fallback for new searches. Cancellation and account-proof invalidation never trigger fallback.') : null,
    usesCopilot ? createElement('p', { style: hintStyle }, 'Copilot handles search model selection. No model setup is needed here. A signed-in account and a model with verified search support are required when searching.') : null,
    usesCopilot && override.model ? createElement('details', { 'data-dsh-copilot-search-override': true },
      createElement('summary', { style: { cursor: 'pointer', fontSize: '13px' } }, 'Existing Copilot model override'),
      createElement('div', { style: { ...fieldStyle, marginTop: '8px' } },
        createElement('p', { style: hintStyle }, 'Your saved override ', createElement('code', null, override.model), ' is preserved. Saving providers does not change it.'),
        createElement('button', { type: 'button', style: buttonStyle, disabled: disabled || override.revision === undefined,
          'data-dsh-copilot-search-reset': true, onClick: () => { void clearOverride() } }, saving === 'override' ? 'Updating…' : 'Use automatic model selection'),
      ),
    ) : null,
    createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' } },
      createElement('button', { type: 'button', style: buttonStyle, disabled: disabled || missingProvider,
        'data-dsh-web-search-save': true, onClick: () => { void save() } }, loading ? 'Loading…' : saving === 'routing' ? 'Saving…' : 'Save search routing'),
      createElement('button', { type: 'button', style: buttonStyle, disabled: loading || saving !== undefined,
        title: 'Reload saved values and discard unsaved edits', 'data-dsh-web-search-reload': true, onClick: () => { void load() } }, 'Reload settings'),
    ),
    createElement('p', { role: 'status', 'aria-live': 'polite', 'aria-atomic': true, style: { ...hintStyle, ...message ? {} : { display: 'none' } } }, message),
  )
}
