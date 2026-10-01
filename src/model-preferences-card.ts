import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { createElement, useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import type { GitHubCopilotAuthorizationView } from './authorization-controller.ts'
import { GitHubCopilotAuthorizationViewSchema } from './remote.ts'

export function GitHubCopilotModelPreferencesPanel(props: {
  readonly remote: ClientContext['remote']['githubCopilot']
  readonly models: GitHubCopilotAuthorizationView['accountModels']
  readonly preferences: GitHubCopilotAuthorizationView['modelPreferences']
}): ReactElement {
  const [query, setQuery] = useState('')
  const [preferences, setPreferences] = useState(props.preferences)
  const [busyModel, setBusyModel] = useState<string>()
  const [error, setError] = useState<string>()
  useEffect(() => { setPreferences(props.preferences); setError(undefined) }, [props.preferences])
  const available = props.models?.models ?? []
  if (preferences === undefined) {
    return createElement('details', { 'data-dsh-github-copilot-model-preferences': true },
      createElement('summary', null, 'Model preferences'),
      createElement('p', { role: 'status' }, 'Model exclusions are unavailable in this profile.'))
  }
  const excluded = new Set(preferences.excludedModelIds)
  const locked = new Set(preferences.lockedModelIds)
  const rows = [
    ...available.map(model => ({ id: model.id, name: model.name, available: true })),
    ...preferences.unavailableExcludedModelIds
      .filter(id => !available.some(model => model.id === id))
      .map(id => ({ id, name: id, available: false })),
  ]
  const needle = query.trim().toLocaleLowerCase()
  const filtered = rows.filter(model => needle.length === 0
    || model.id.toLocaleLowerCase().includes(needle) || model.name.toLocaleLowerCase().includes(needle))
  const visibleCount = available.filter(model => !excluded.has(model.id)).length
  const update = async (modelId: string, restore: boolean): Promise<void> => {
    if (busyModel !== undefined) return
    setBusyModel(modelId); setError(undefined)
    try {
      const result = restore ? await props.remote.restoreModel(modelId) : await props.remote.excludeModel(modelId)
      if (!result.ok) { setError('COPILOT_MODEL_EXCLUSION_SAVE_FAILED'); return }
      const parsed = GitHubCopilotAuthorizationViewSchema.safeParse(result.value)
      if (!parsed.success || parsed.data.modelPreferences === undefined) {
        setError('COPILOT_MODEL_PREFERENCES_UNAVAILABLE')
        return
      }
      setPreferences(parsed.data.modelPreferences)
      setError(parsed.data.modelPreferences.error)
    } catch { setError('COPILOT_MODEL_EXCLUSION_SAVE_FAILED') }
    finally { setBusyModel(undefined) }
  }
  return createElement('details', { 'data-dsh-github-copilot-model-preferences': true },
    createElement('summary', null, `Model preferences · ${visibleCount} visible · ${preferences.excludedModelIds.length} excluded`),
    createElement('p', { style: { fontSize: '13px' } },
      'Excluded models disappear from the managed picker and are never considered by Auto. Restoring a model does not select it.'),
    createElement('label', { style: { display: 'grid', gap: '4px', fontSize: '13px' } },
      'Search models',
      createElement('input', {
        type: 'search', value: query,
        onChange: (event: { currentTarget: { value: string } }) => setQuery(event.currentTarget.value),
        placeholder: 'Search by name or exact model ID',
        'data-dsh-github-copilot-model-search': true,
      })),
    error === undefined && preferences.error === undefined ? null
      : createElement('p', { role: 'alert', 'data-dsh-github-copilot-model-preferences-error': true },
        error ?? preferences.error),
    filtered.length === 0 ? createElement('p', { role: 'status' }, 'No models match this search.')
      : createElement('ul', { style: { listStyle: 'none', padding: 0, display: 'grid', gap: '8px' } },
        filtered.map(model => {
          const isExcluded = excluded.has(model.id)
          const isLocked = locked.has(model.id)
          const disabled = busyModel !== undefined || !isExcluded && isLocked
          return createElement('li', { key: model.id, style: { display: 'flex', gap: '10px', alignItems: 'center' } },
            createElement('span', { style: { flex: 1, minWidth: 0, overflowWrap: 'anywhere' } },
              createElement('strong', null, model.name),
              createElement('br'),
              createElement('code', null, model.id),
              model.available ? null : createElement('span', null, ' · Temporarily absent from account metadata'),
              !isExcluded && isLocked ? createElement('span', null, ' · Select another model before excluding') : null),
            createElement('button', {
              type: 'button',
              disabled,
              onClick: () => void update(model.id, isExcluded),
              title: !isExcluded && isLocked ? 'Select another fixed model before excluding this one.' : undefined,
              'data-dsh-github-copilot-model-action': isExcluded ? 'restore' : 'exclude',
              'data-model-id': model.id,
            }, busyModel === model.id ? 'Saving…' : isExcluded ? 'Restore' : 'Exclude'))
        })))
}
