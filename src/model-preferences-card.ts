import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { createElement, useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import type { GitHubCopilotAuthorizationView } from './authorization-controller.ts'
import { GitHubCopilotAuthorizationViewSchema, GitHubCopilotModelPreferencesViewSchema } from './remote.ts'

const controlStyle: CSSProperties = {
  color: 'inherit', background: 'transparent', font: 'inherit', fontSize: '14px',
  border: '1px solid var(--dsw-alias-border-main, ButtonBorder)', colorScheme: 'inherit',
  borderRadius: '8px', padding: '7px 12px', minHeight: '36px',
}

function preferenceMessage(code: string): string {
  switch (code) {
    case 'COPILOT_MODEL_SETTINGS_UNAVAILABLE':
      return 'Cannot read model preference settings. Models are read-only. Retry to read settings again.'
    case 'COPILOT_MODEL_SETTINGS_INVALID':
      return 'Model preference settings are invalid. No settings were changed. Review the settings before retrying.'
    case 'COPILOT_MODEL_SELECTION_UNAVAILABLE':
      return 'Cannot confirm the models selected by sessions or the default. Changes are disabled to protect those selections. Retry to check again.'
    case 'COPILOT_MODEL_EXCLUSION_SELECTED':
      return 'This model is selected by a session or the default. Select another fixed model there before excluding it.'
    case 'COPILOT_MODEL_EXCLUSION_CONFLICT':
      return 'Settings changed elsewhere. Review the current list before trying again.'
    case 'COPILOT_MODEL_EXCLUSION_SAVE_FAILED':
      return 'Could not confirm the change. Retry to read the saved settings before trying again.'
    default:
      return 'The Host did not provide model preferences. Models are read-only. Retry; if this persists, check that Host and Client are running the same plugin version.'
  }
}

export function GitHubCopilotModelPreferencesPanel(props: {
  readonly remote: Pick<ClientContext['remote']['githubCopilot'], 'status' | 'setModelExcluded' | 'setModelHighCost'>
  readonly models: GitHubCopilotAuthorizationView['accountModels']
  readonly preferences: GitHubCopilotAuthorizationView['modelPreferences']
}): ReactElement {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'enabled' | 'excluded' | 'available' | 'unavailable'>('all')
  const [preferences, setPreferences] = useState(props.preferences)
  const [models, setModels] = useState(props.models)
  const [busyModel, setBusyModel] = useState<string>()
  const [error, setError] = useState<string>()
  const [errorModel, setErrorModel] = useState<string>()
  const request = useRef({ generation: 0, pending: false })
  useEffect(() => {
    const scope = request.current
    scope.generation++
    scope.pending = false
    setPreferences(props.preferences); setModels(props.models)
    setError(undefined); setErrorModel(undefined); setBusyModel(undefined)
    return () => { scope.generation++; scope.pending = false }
  }, [props.preferences, props.models, props.remote])
  const available = models?.models ?? []
  const availabilityKnown = models?.state === 'ready'
  const settingsKnown = preferences !== undefined && preferences.revision !== undefined
  const excluded = new Set(preferences?.excludedModelIds ?? [])
  const highCost = new Set(preferences?.highCostModelIds ?? [])
  const highCostKnown = settingsKnown && preferences?.highCostModelIds !== undefined
  const diagnostic = error ?? preferences?.error
    ?? (preferences === undefined ? 'COPILOT_MODEL_PREFERENCES_UNAVAILABLE' : undefined)
  const writable = preferences?.writable === true && settingsKnown
  const rows = [
    ...available.map(model => ({ id: model.id, name: model.name, available: true })),
    ...Array.from(new Set([...(preferences?.excludedModelIds ?? []), ...(preferences?.unavailableExcludedModelIds ?? []),
      ...(preferences?.highCostModelIds ?? [])]))
      .filter(id => !available.some(model => model.id === id))
      .map(id => ({ id, name: id, available: false })),
  ]
  const needle = query.trim().toLocaleLowerCase()
  const filtered = rows.filter(model => (filter === 'all'
    || filter === 'enabled' && settingsKnown && !excluded.has(model.id)
    || filter === 'excluded' && settingsKnown && excluded.has(model.id)
    || filter === 'available' && availabilityKnown && model.available
    || filter === 'unavailable' && availabilityKnown && !model.available)
    && (needle.length === 0 || model.id.toLocaleLowerCase().includes(needle) || model.name.toLocaleLowerCase().includes(needle)))
  const visibleCount = available.filter(model => !excluded.has(model.id)).length
  const unavailableCount = rows.filter(model => !model.available).length
  const update = async (modelId?: string, restore = false, marking?: boolean): Promise<void> => {
    const scope = request.current
    if (scope.pending || modelId !== undefined && !writable) return
    scope.pending = true
    const generation = ++scope.generation
    const current = () => scope.generation === generation
    setBusyModel(modelId ?? ''); setError(undefined); setErrorModel(modelId)
    try {
      if (modelId !== undefined) {
        const result = marking === undefined ? await props.remote.setModelExcluded(modelId, !restore)
          : await props.remote.setModelHighCost(modelId, marking)
        if (!current()) return
        if (!result.ok) { setError('COPILOT_MODEL_EXCLUSION_SAVE_FAILED'); return }
        const parsed = GitHubCopilotModelPreferencesViewSchema.safeParse(result.value)
        if (!parsed.success) { setError('COPILOT_MODEL_PREFERENCES_UNAVAILABLE'); return }
        setPreferences(parsed.data)
        setError(parsed.data.error)
        return
      }
      const result = await props.remote.status()
      if (!current()) return
      if (!result.ok) { setError('COPILOT_MODEL_EXCLUSION_SAVE_FAILED'); return }
      const parsed = GitHubCopilotAuthorizationViewSchema.safeParse(result.value)
      if (!parsed.success) {
        setError('COPILOT_MODEL_PREFERENCES_UNAVAILABLE')
        return
      }
      if (!parsed.data.configured || parsed.data.inFlight) {
        setPreferences(undefined); setModels(undefined)
        setError('COPILOT_MODEL_PREFERENCES_UNAVAILABLE')
        return
      }
      setPreferences(parsed.data.modelPreferences)
      setModels(parsed.data.accountModels)
      setError(parsed.data.modelPreferences?.error)
    } catch { if (current()) setError('COPILOT_MODEL_EXCLUSION_SAVE_FAILED') }
    finally { if (current()) { scope.pending = false; setBusyModel(undefined) } }
  }
  return createElement('details', { 'data-dsh-github-copilot-model-preferences': true },
    createElement('summary', null, settingsKnown
      ? `Model preferences · ${visibleCount} enabled · ${excluded.size} excluded` : 'Model preferences · Read-only'),
    createElement('p', { style: { fontSize: '14px', marginBlock: '12px' } },
      'Exclusions are shared across GitHub Copilot accounts; availability below reflects the current account. Newly discovered models are enabled by default. Unavailable saved exclusions are retained and apply again if that model returns. Excluded models disappear from the managed picker and cannot start a new turn, including Auto. An admitted turn keeps its model. Fixed selections are not changed; select another model before the next turn. Restoring a model does not select it.'),
    createElement('p', { style: { fontSize: '14px', marginBlock: '12px' } },
      'High cost is your preference, not a price or quality rating. Auto gives marked models a smaller, nonzero allocation weight within their fitting category, including Fast models. Continuity is a small bonus, not a lock. Markings are shared across accounts, save immediately and affect new Auto turns only; fixed selections and admitted turns are unchanged.'),
    highCostKnown ? null : createElement('p', { role: 'status' },
      'High-cost preferences are unknown. Retry to read settings; marking is disabled.'),
    availabilityKnown ? null : createElement('p', { role: 'status' },
      'Current account availability unconfirmed. Shown models reflect the last metadata snapshot and saved preferences, not a current availability check.'),
    diagnostic === undefined ? null : createElement('div', { role: 'alert',
      'data-dsh-github-copilot-model-preferences-error': true, style: { fontSize: '14px', marginBlock: '12px' } },
      createElement('p', null, preferenceMessage(diagnostic)),
      createElement('code', { style: { overflowWrap: 'anywhere' } }, diagnostic),
      createElement('div', { style: { marginTop: '8px' } },
        createElement('button', { type: 'button', style: controlStyle, disabled: busyModel !== undefined,
          onClick: () => update(), 'data-dsh-github-copilot-preferences-retry': true },
        busyModel === '' ? 'Reading settings…' : 'Retry'))),
    createElement('label', { style: { display: 'grid', gap: '6px', fontSize: '14px' } },
      'Search models',
      createElement('input', {
        type: 'search', value: query,
        style: { ...controlStyle, fontSize: '16px', width: '100%', boxSizing: 'border-box', minWidth: 0,
          background: 'var(--dsw-alias-bg-layer-1, Canvas)', color: 'var(--dsw-alias-label-primary, CanvasText)' },
        onChange: (event: { currentTarget: { value: string } }) => setQuery(event.currentTarget.value),
        placeholder: 'Search by name or exact model ID',
        'data-dsh-github-copilot-model-search': true,
      })),
    createElement('div', { role: 'group', 'aria-label': 'Filter models',
      style: { display: 'flex', flexWrap: 'wrap', gap: '8px', marginBlock: '12px' } },
    (['all', 'enabled', 'excluded', 'available', 'unavailable'] as const).map(value => createElement('button', {
      key: value, type: 'button', 'aria-pressed': filter === value,
      disabled: (value === 'enabled' || value === 'excluded') && !settingsKnown
        || (value === 'available' || value === 'unavailable') && !availabilityKnown,
      onClick: () => setFilter(value),
      style: { ...controlStyle, fontWeight: filter === value ? 600 : 400,
        background: filter === value ? 'color-mix(in srgb, currentColor 12%, transparent)' : 'transparent' },
    }, value === 'all' ? `All (${rows.length})` : value === 'enabled'
      ? `Enabled (${settingsKnown ? visibleCount : '?'})` : value === 'excluded'
        ? `Excluded (${settingsKnown ? excluded.size : '?'})` : value === 'available'
          ? `Available (${availabilityKnown ? available.length : '?'})` : `Unavailable (${availabilityKnown ? unavailableCount : '?'})`))),
    filtered.length === 0 ? createElement('p', { role: 'status' },
      rows.length === 0 ? 'No account models to display. Use Refresh models to read account metadata.' : 'No models match this filter or search.')
      : createElement('ul', { 'aria-label': 'Account models', style: { listStyle: 'none', padding: 0, margin: 0 } },
        filtered.map(model => {
          const isExcluded = excluded.has(model.id)
          const disabled = !writable || busyModel !== undefined
          return createElement('li', { key: model.id, style: { display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center',
            paddingBlock: '12px', borderBottom: '1px solid color-mix(in srgb, currentColor 18%, transparent)' } },
            createElement('span', { style: { flex: 1, minWidth: 0, overflowWrap: 'anywhere', fontSize: '14px' } },
              createElement('strong', null, model.name),
              createElement('br'),
              createElement('code', null, model.id),
              createElement('span', null, ` · ${!availabilityKnown ? 'Current account availability unconfirmed'
                : model.available ? 'Available on current account' : 'Currently unavailable on current account; saved preferences retained'}`),
              createElement('span', null, ` · ${!settingsKnown ? 'Exclusion status unknown' : isExcluded ? 'Excluded' : 'Enabled'}`),
              errorModel === model.id && error !== undefined
                ? createElement('span', { role: 'status', style: { display: 'block', marginTop: '6px' } }, preferenceMessage(error)) : null),
            createElement('label', { style: { display: 'inline-flex', alignItems: 'center', gap: '6px',
              fontSize: '14px', minHeight: '36px' } },
              createElement('input', { type: 'checkbox', checked: highCost.has(model.id),
                disabled: disabled || !highCostKnown, 'aria-label': `High cost ${model.name}`,
                'data-dsh-github-copilot-high-cost': true, 'data-high-cost-model-id': model.id,
                onChange: (event: { currentTarget: { checked: boolean } }) => update(model.id, false, event.currentTarget.checked) }),
              'High cost'),
            createElement('button', {
              type: 'button', style: { ...controlStyle, flexShrink: 0, cursor: disabled ? 'not-allowed' : 'pointer',
                color: disabled ? 'var(--dsw-alias-label-secondary, GrayText)' : 'inherit' },
              disabled,
              'aria-label': `${isExcluded ? 'Restore' : 'Exclude'} ${model.name}`,
              onClick: () => update(model.id, isExcluded),
              'data-dsh-github-copilot-model-action': isExcluded ? 'restore' : 'exclude',
              'data-model-id': model.id,
            }, busyModel === model.id ? 'Saving…' : isExcluded ? 'Restore' : 'Exclude'))
        })))
}
