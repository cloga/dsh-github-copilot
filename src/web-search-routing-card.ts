import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { createElement, useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent, CSSProperties, ReactElement } from 'react'
import { GitHubCopilotAuthorizationViewSchema } from './remote.ts'

const GITHUB_COPILOT_SETTINGS_NAMESPACE = 'github-copilot'
const WEB_SEARCH_ROUTING_SETTINGS_NAMESPACE = 'github-copilot-search-routing'
const NO_DEFAULT_SEARCH_PROVIDER = 'none'
const GITHUB_COPILOT_SEARCH_PROVIDER = 'github-copilot-hosted'
const DEEPSEEK_SEARCH_PROVIDER = 'deepseek-official'
const EXA_SEARCH_PROVIDER = 'exa'
const PERPLEXITY_SEARCH_PROVIDER = 'perplexity'

interface SearchRoutingCardProps {
  readonly settings: ClientContext['remote']['settings']
  readonly copilot: ClientContext['remote']['githubCopilot']
}

interface Draft {
  mode: 'auto' | 'fixed'
  provider: string
  model: string
  routingRevision?: number
  copilotRevision?: number
}

const cardStyle: CSSProperties = {
  display: 'grid', gap: '14px', padding: '18px', marginTop: '16px',
  border: '1px solid color-mix(in srgb, currentColor 20%, transparent)',
  borderRadius: '14px', background: 'color-mix(in srgb, currentColor 4%, transparent)',
}
const fieldStyle: CSSProperties = { display: 'grid', gap: '6px' }
const controlStyle: CSSProperties = {
  width: '100%', padding: '9px 11px', borderRadius: '9px', color: 'inherit',
  border: '1px solid color-mix(in srgb, currentColor 24%, transparent)',
  background: 'color-mix(in srgb, currentColor 3%, transparent)', font: 'inherit',
}
const buttonStyle: CSSProperties = {
  justifySelf: 'start', padding: '9px 16px', borderRadius: '999px', cursor: 'pointer',
  border: '1px solid color-mix(in srgb, currentColor 30%, transparent)',
  background: 'color-mix(in srgb, currentColor 10%, transparent)', color: 'inherit', font: 'inherit',
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : {}
}

function revisionOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

/** Models-page card for plugin-owned cross-provider search routing. */
export function WebSearchRoutingCard(props: SearchRoutingCardProps): ReactElement {
  const [draft, setDraft] = useState<Draft>({ mode: 'auto', provider: DEEPSEEK_SEARCH_PROVIDER, model: '' })
  const [models, setModels] = useState<readonly string[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [writable, setWritable] = useState(false)
  const [message, setMessage] = useState('')
  const [modelNotice, setModelNotice] = useState('')
  // Every load/save belongs to one mounted Remote generation. The synchronous
  // busy flag also prevents duplicate clicks before React commits disabled UI.
  const lifecycle = useRef({ active: false, generation: 0, busy: false })

  const load = useCallback(async () => {
    const owner = lifecycle.current
    if (!owner.active || owner.busy) return
    const generation = ++owner.generation
    const current = () => owner.active && owner.generation === generation
    owner.busy = true
    setLoading(true)
    setSaving(false)
    setWritable(false)
    setMessage('')
    setModels([])
    setModelNotice('')

    // Optional suggestions must neither block Settings nor authorize a search.
    // Keep their failure separate from the routing read/save status.
    const loadModels = async () => {
      try {
        const result = await props.copilot.status()
        if (!current()) return
        const parsed = result.ok ? GitHubCopilotAuthorizationViewSchema.safeParse(result.value) : undefined
        if (!parsed?.success) {
          setModelNotice('Model suggestions are unavailable. Enter a model id or reload settings to retry.')
          return
        }
        const ids = parsed.data.accountModels?.models
          .filter(item => item.api === 'openai-responses').map(item => item.id) ?? []
        setModels([...new Set(ids)].sort())
      } catch {
        if (current()) setModelNotice('Model suggestions are unavailable. Enter a model id or reload settings to retry.')
      }
    }
    void loadModels()
    try {
      const result = await props.settings.describe()
      if (!current()) return
      if (!result.ok) {
        setMessage('Could not load search settings. Reload settings to retry.')
        return
      }
      const routing = result.value.namespaces.find(entry => entry.ns === WEB_SEARCH_ROUTING_SETTINGS_NAMESPACE)
      const copilot = result.value.namespaces.find(entry => entry.ns === GITHUB_COPILOT_SETTINGS_NAMESPACE)
      const routingValue = record(routing?.value)
      const copilotValue = record(copilot?.value)
      setDraft({
        mode: routingValue.searchMode === 'fixed' ? 'fixed' : 'auto',
        provider: typeof routingValue.defaultSearchProvider === 'string'
          ? routingValue.defaultSearchProvider : DEEPSEEK_SEARCH_PROVIDER,
        model: typeof copilotValue.searchModel === 'string' ? copilotValue.searchModel : '',
        routingRevision: revisionOf(routing?.revision),
        copilotRevision: revisionOf(copilot?.revision),
      })
      setWritable(result.value.writable === true)
      if (!routing || revisionOf(routing.revision) === undefined) {
        setMessage('Web search routing settings are unavailable. Reload after the routing namespace is registered.')
      } else if (!result.value.writable) {
        setMessage('Search settings are read-only in this deployment.')
      }
    } catch {
      // Do not render arbitrary transport errors or remote payloads.
      if (current()) setMessage('Could not load search settings. Reload settings to retry.')
    } finally {
      if (current()) { owner.busy = false; setLoading(false) }
    }
  }, [props.copilot, props.settings])

  useEffect(() => {
    const owner = lifecycle.current
    owner.active = true
    void load()
    return () => { owner.active = false; owner.generation++; owner.busy = false }
  }, [load])

  const usesCopilot = draft.provider.trim() === GITHUB_COPILOT_SEARCH_PROVIDER
  const disabled = loading || saving || !writable || draft.routingRevision === undefined
  const missingCopilot = usesCopilot && draft.copilotRevision === undefined
  const providerOptions = [DEEPSEEK_SEARCH_PROVIDER, GITHUB_COPILOT_SEARCH_PROVIDER,
    EXA_SEARCH_PROVIDER, PERPLEXITY_SEARCH_PROVIDER, NO_DEFAULT_SEARCH_PROVIDER]

  const save = useCallback(async () => {
    const owner = lifecycle.current
    if (!owner.active || owner.busy || disabled || missingCopilot) return
    const generation = owner.generation
    const current = () => owner.active && owner.generation === generation
    const provider = draft.provider.trim()
    const model = draft.model.trim()
    if (provider.length === 0) {
      setMessage('Enter a registered search provider id, or use none.')
      return
    }
    if (usesCopilot && model.length === 0) {
      setMessage('Enter a Copilot Responses model before using GitHub Copilot search.')
      return
    }
    owner.busy = true
    setSaving(true)
    setMessage('')
    let modelSaved = false
    const saveFailure = () => modelSaved
      ? 'Copilot search model was saved, but routing was not confirmed. Retry Save, or reload settings to review current values. The two namespaces are not saved atomically.'
      : 'Search settings could not be saved or confirmed. Retry Save, or reload settings to review current values before retrying.'
    try {
      if (usesCopilot) {
        const modelWrite = await props.settings.mutate(GITHUB_COPILOT_SETTINGS_NAMESPACE, [{
          op: 'set', path: ['searchModel'], value: model,
        }], draft.copilotRevision)
        if (!current()) return
        if (!modelWrite.ok) { setMessage(saveFailure()); return }
        modelSaved = true
        const revision = revisionOf(modelWrite.value.revision)
        // Retain this successful CAS even if the second namespace write fails.
        setDraft(value => current() ? { ...value, model, copilotRevision: revision } : value)
        if (revision === undefined) { setMessage(saveFailure()); return }
      }
      const routingWrite = await props.settings.mutate(WEB_SEARCH_ROUTING_SETTINGS_NAMESPACE, [
        { op: 'set', path: ['searchMode'], value: draft.mode },
        { op: 'set', path: ['defaultSearchProvider'], value: provider },
      ], draft.routingRevision)
      if (!current()) return
      if (!routingWrite.ok) { setMessage(saveFailure()); return }
      const revision = revisionOf(routingWrite.value.revision)
      setDraft(value => current() ? { ...value, provider, routingRevision: revision } : value)
      setMessage(revision === undefined ? 'Save returned no revision. Reload settings before editing again.'
        : 'Saved. New searches use this routing immediately.')
    } catch {
      if (current()) setMessage(saveFailure())
    } finally {
      if (current()) { owner.busy = false; setSaving(false) }
    }
  }, [disabled, draft, missingCopilot, props.settings, usesCopilot])

  return createElement('section', { style: cardStyle, 'data-dsh-web-search-routing': true },
    createElement('div', null,
      createElement('h3', { style: { margin: 0, fontSize: '16px' } }, 'Web search'),
      createElement('p', { style: { margin: '5px 0 0', opacity: 0.72, fontSize: '13px', lineHeight: 1.5 } },
        'Auto tries native search for the initiating Copilot model, then the default provider when unavailable. Other model providers use the default directly. Fixed always uses the default. Chat remains available when search is unavailable.'),
    ),
    createElement('label', { style: fieldStyle },
      createElement('span', { style: { fontSize: '13px', fontWeight: 600 } }, 'Search mode'),
      createElement('select', {
        style: controlStyle, disabled, value: draft.mode,
        'data-dsh-web-search-mode': true,
        onChange: (event: ChangeEvent<HTMLSelectElement>) => {
          const mode = event.currentTarget.value === 'fixed' ? 'fixed' : 'auto'
          setDraft(current => ({ ...current, mode }))
        },
      },
      createElement('option', { value: 'auto' }, 'Auto — native Copilot search first, then default provider'),
      createElement('option', { value: 'fixed' }, 'Fixed — always use the default provider')),
    ),
    createElement('label', { style: fieldStyle },
      createElement('span', { style: { fontSize: '13px', fontWeight: 600 } }, 'Default search provider'),
      createElement('input', {
        style: controlStyle, list: 'dsh-search-provider-options', disabled,
        value: draft.provider, placeholder: 'registered provider id', 'data-dsh-web-search-provider': true,
        onChange: (event: ChangeEvent<HTMLInputElement>) => {
          const provider = event.currentTarget.value
          setDraft(current => ({ ...current, provider }))
        },
      }),
      createElement('datalist', { id: 'dsh-search-provider-options' },
        ...providerOptions.map(id => createElement('option', { key: id, value: id, label:
          id === NO_DEFAULT_SEARCH_PROVIDER ? 'None — no default search provider' : `${id} (suggestion)` }))),
      createElement('span', { style: { opacity: 0.66, fontSize: '12px' } },
        'Suggestions are examples, not installed-provider or capability checks. Enter any registered search provider id, or none; unavailable providers fail without affecting chat.'),
    ),
    !usesCopilot ? null : createElement('label', { style: fieldStyle },
      createElement('span', { style: { fontSize: '13px', fontWeight: 600 } }, 'Copilot search model'),
      createElement('input', {
        style: controlStyle, list: 'dsh-copilot-search-models', disabled: disabled || missingCopilot,
        value: draft.model, placeholder: 'account-authorized Responses model id', 'data-dsh-copilot-search-model': true,
        onChange: (event: ChangeEvent<HTMLInputElement>) => {
          const model = event.currentTarget.value
          setDraft(current => ({ ...current, model }))
        },
      }),
      createElement('datalist', { id: 'dsh-copilot-search-models' },
        ...models.map(id => createElement('option', { key: id, value: id }))),
      createElement('span', { style: { opacity: 0.66, fontSize: '12px' } },
        'Account Responses models are suggestions, not hosted-search capability proof. The model must be account-authorized and pass the configured search checks. It does not change the chat model.'),
      missingCopilot ? createElement('span', { role: 'status' },
        'Copilot search settings are unavailable. Reload after the github-copilot namespace is registered, or choose another provider.') : null,
      modelNotice ? createElement('span', { role: 'status', style: { fontSize: '12px' } }, modelNotice) : null,
    ),
    createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' } },
      createElement('button', { type: 'button', style: buttonStyle, disabled: disabled || missingCopilot,
        'data-dsh-web-search-save': true, onClick: () => { void save() } },
        loading ? 'Loading…' : saving ? 'Saving…' : 'Save search routing'),
      createElement('button', { type: 'button', style: buttonStyle, disabled: loading || saving,
        title: 'Reload saved values and discard unsaved edits',
        'data-dsh-web-search-reload': true, onClick: () => { void load() } }, 'Reload settings'),
      message.length === 0 ? null : createElement('span', { role: 'status', style: { fontSize: '13px', opacity: 0.8 } }, message),
    ),
  )
}
