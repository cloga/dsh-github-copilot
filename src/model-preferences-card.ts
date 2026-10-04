import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { createElement, useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import type { GitHubCopilotAuthorizationView } from './authorization-controller.ts'
import { GitHubCopilotAuthorizationViewSchema, GitHubCopilotModelPreferencesViewSchema } from './remote.ts'

const controlStyle: CSSProperties = {
  color: 'inherit', background: 'transparent', font: 'inherit', fontSize: '14px',
  border: '1px solid color-mix(in srgb, currentColor 30%, transparent)',
  borderRadius: '8px', padding: '7px 12px', minHeight: '36px',
}

function preferenceMessage(code: string): string {
  switch (code) {
    case 'COPILOT_MODEL_SETTINGS_UNAVAILABLE':
      return 'Cannot read model exclusion settings. Models are read-only. Retry to read settings again.'
    case 'COPILOT_MODEL_SETTINGS_INVALID':
      return 'Model exclusion settings are invalid. No settings were changed. Review the settings before retrying.'
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
  readonly remote: ClientContext['remote']['githubCopilot']
  readonly models: GitHubCopilotAuthorizationView['accountModels']
  readonly preferences: GitHubCopilotAuthorizationView['modelPreferences']
}): ReactElement {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'enabled' | 'excluded'>('all')
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
  const settingsKnown = preferences !== undefined && preferences.revision !== undefined
  const excluded = new Set(preferences?.excludedModelIds ?? [])
  const diagnostic = error ?? preferences?.error
    ?? (preferences === undefined ? 'COPILOT_MODEL_PREFERENCES_UNAVAILABLE' : undefined)
  const writable = preferences?.writable === true && settingsKnown
  const rows = [
    ...available.map(model => ({ id: model.id, name: model.name, available: true })),
    ...(preferences?.unavailableExcludedModelIds ?? [])
      .filter(id => !available.some(model => model.id === id))
      .map(id => ({ id, name: id, available: false })),
  ]
  const needle = query.trim().toLocaleLowerCase()
  const filtered = rows.filter(model => (filter === 'all'
    || settingsKnown && (filter === 'excluded' ? excluded.has(model.id) : !excluded.has(model.id)))
    && (needle.length === 0 || model.id.toLocaleLowerCase().includes(needle) || model.name.toLocaleLowerCase().includes(needle)))
  const visibleCount = available.filter(model => !excluded.has(model.id)).length
  const update = async (modelId?: string, restore = false): Promise<void> => {
    const scope = request.current
    if (scope.pending || modelId !== undefined && !writable) return
    scope.pending = true
    const generation = ++scope.generation
    const current = () => scope.generation === generation
    setBusyModel(modelId ?? ''); setError(undefined); setErrorModel(modelId)
    try {
      if (modelId !== undefined) {
        const result = await props.remote.setModelExcluded(modelId, !restore)
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
      'Excluded models disappear from the managed picker and cannot start a new turn, including Auto. An admitted turn keeps its model. Fixed selections are not changed; select another model before the next turn. Restoring a model does not select it.'),
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
        style: { ...controlStyle, fontSize: '16px', width: '100%', boxSizing: 'border-box', minWidth: 0 },
        onChange: (event: { currentTarget: { value: string } }) => setQuery(event.currentTarget.value),
        placeholder: 'Search by name or exact model ID',
        'data-dsh-github-copilot-model-search': true,
      })),
    createElement('div', { role: 'group', 'aria-label': 'Filter models',
      style: { display: 'flex', flexWrap: 'wrap', gap: '8px', marginBlock: '12px' } },
    (['all', 'enabled', 'excluded'] as const).map(value => createElement('button', {
      key: value, type: 'button', 'aria-pressed': filter === value,
      disabled: value !== 'all' && !settingsKnown, onClick: () => setFilter(value),
      style: { ...controlStyle, fontWeight: filter === value ? 600 : 400,
        background: filter === value ? 'color-mix(in srgb, currentColor 12%, transparent)' : 'transparent' },
    }, value === 'all' ? `All (${rows.length})` : value === 'enabled'
      ? `Enabled (${settingsKnown ? visibleCount : '?'})` : `Excluded (${settingsKnown ? excluded.size : '?'})`))),
    filtered.length === 0 ? createElement('p', { role: 'status' },
      rows.length === 0 ? 'No account models to display. Use Refresh models to read account metadata.' : 'No models match this filter or search.')
      : createElement('ul', { 'aria-label': 'Account models', style: { listStyle: 'none', padding: 0, margin: 0 } },
        filtered.map(model => {
          const isExcluded = excluded.has(model.id)
          const disabled = !writable || busyModel !== undefined
          return createElement('li', { key: model.id, style: { display: 'flex', gap: '12px', alignItems: 'center',
            paddingBlock: '12px', borderBottom: '1px solid color-mix(in srgb, currentColor 18%, transparent)' } },
            createElement('span', { style: { flex: 1, minWidth: 0, overflowWrap: 'anywhere', fontSize: '14px' } },
              createElement('strong', null, model.name),
              createElement('br'),
              createElement('code', null, model.id),
              createElement('span', null, !settingsKnown ? ' · Exclusion status unknown' : isExcluded ? ' · Excluded' : ' · Enabled'),
              model.available ? null : createElement('span', null, ' · Temporarily absent from account metadata'),
              errorModel === model.id && error !== undefined
                ? createElement('span', { role: 'status', style: { display: 'block', marginTop: '6px' } }, preferenceMessage(error)) : null),
            createElement('button', {
              type: 'button', style: { ...controlStyle, flexShrink: 0, cursor: disabled ? 'not-allowed' : 'pointer' },
              disabled,
              'aria-label': `${isExcluded ? 'Restore' : 'Exclude'} ${model.name}`,
              onClick: () => update(model.id, isExcluded),
              'data-dsh-github-copilot-model-action': isExcluded ? 'restore' : 'exclude',
              'data-model-id': model.id,
            }, busyModel === model.id ? 'Saving…' : isExcluded ? 'Restore' : 'Exclude'))
        })))
}
