import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { createElement, useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent, ReactElement } from 'react'
import { NativeCopilotSearchModelsSchema } from './native-copilot-search-remote.ts'
import { nativeOptionStyle, nativeSelectStyle } from './native-select-style.ts'
import { nativeButtonStyle, nativeCaptionStyle, nativeHeadingStyle, nativeSettingsCss, nativeSettingsStyle } from './native-settings-style.ts'

type SettingsRemote = Pick<ClientContext['remote']['settings'], 'describe' | 'mutate'>
type SearchRemote = Pick<ClientContext['remote']['githubCopilotNativeSearch'], 'models'>

function snapshot(value: Awaited<ReturnType<SettingsRemote['describe']>>) {
  if (!value.ok) return undefined
  const entry = value.value.namespaces.find(item => item.ns === 'github-copilot')
  if (!entry || typeof entry.revision !== 'number' || !Number.isSafeInteger(entry.revision) || entry.revision < 0
    || typeof entry.value !== 'object' || entry.value === null || Array.isArray(entry.value)) return undefined
  const field: unknown = Reflect.get(entry.value, 'nativeSearchModel')
  if (field !== undefined && (typeof field !== 'string' || field.length > 512 || field !== field.trim()
    || /[\p{Cc}\p{Cf}]/u.test(field))) return undefined
  return { model: field ?? '', revision: entry.revision, writable: value.value.writable === true }
}

export function NativeSearchModelCard({ settings, search }: {
  settings: SettingsRemote
  search: SearchRemote
}): ReactElement {
  const [saved, setSaved] = useState<string>()
  const [draft, setDraft] = useState('')
  const [revision, setRevision] = useState<number>()
  const [writable, setWritable] = useState(false)
  const [models, setModels] = useState<string[]>()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [modelsError, setModelsError] = useState(false)
  const owner = useRef({ active: false, generation: 0, busy: false })

  const load = useCallback(async () => {
    const state = owner.current
    if (!state.active || state.busy) return
    state.busy = true
    const generation = ++state.generation
    setLoading(true); setMessage(''); setModelsError(false); setModels(undefined)
    const [settingsResult, modelsResult] = await Promise.allSettled([settings.describe(), search.models()])
    if (!state.active || generation !== state.generation) return
    const current = settingsResult.status === 'fulfilled' ? snapshot(settingsResult.value) : undefined
    if (!current) {
      setSaved(undefined); setRevision(undefined); setWritable(false)
      setMessage('Could not read Copilot search settings. Reload to try again.')
    } else {
      setSaved(current.model); setDraft(current.model); setRevision(current.revision); setWritable(current.writable)
      if (!current.writable) setMessage('Copilot search settings are read-only.')
    }
    const result = modelsResult.status === 'fulfilled' ? modelsResult.value : undefined
    const parsed = result?.ok ? NativeCopilotSearchModelsSchema.safeParse(result.value) : undefined
    if (!parsed?.success || new Set(parsed.data.models.map(model => model.id)).size !== parsed.data.models.length) {
      setModelsError(true)
    } else {
      setModels(parsed.data.models.map(model => model.id))
    }
    state.busy = false
    setLoading(false)
  }, [settings, search])

  useEffect(() => {
    const state = owner.current
    state.active = true
    void load()
    return () => { state.active = false; state.generation++; state.busy = false }
  }, [load])

  const save = async (): Promise<void> => {
    const state = owner.current
    if (!state.active || state.busy || !writable || revision === undefined || saved === undefined || draft === saved) return
    if (draft !== '' && !models?.includes(draft)) {
      setMessage('The chosen model is unavailable. Reload models or choose automatic.')
      return
    }
    const generation = state.generation
    state.busy = true
    setSaving(true); setMessage('')
    try {
      const result = await settings.mutate('github-copilot',
        [{ op: 'set', path: ['nativeSearchModel'], value: draft }], revision)
      if (!state.active || generation !== state.generation) return
      if (!result.ok) {
        setMessage('Could not save search model. Reload settings and try again.')
        return
      }
      const confirmed = snapshot(await settings.describe())
      if (!state.active || generation !== state.generation) return
      if (!confirmed || confirmed.model !== draft) {
        setSaved(undefined); setRevision(undefined)
        setMessage('Could not confirm the saved search model. Reload settings before editing again.')
        return
      }
      setSaved(confirmed.model); setRevision(confirmed.revision); setWritable(confirmed.writable)
      setMessage('Saved. Search capability is checked when you search.')
    } catch {
      if (state.active && generation === state.generation) {
        setSaved(undefined); setRevision(undefined)
        setMessage('Could not confirm the saved search model. Reload settings before editing again.')
      }
    } finally {
      if (state.active && generation === state.generation) { state.busy = false; setSaving(false) }
    }
  }
  const disabled = loading || saving || !writable || revision === undefined || saved === undefined
  const missing = draft !== '' && !models?.includes(draft)
  return createElement('section', { style: { ...nativeSettingsStyle, display: 'grid', gap: 10 },
    'data-dsh-native-search-model': true },
  createElement('style', null, nativeSettingsCss),
  createElement('h3', { style: nativeHeadingStyle }, 'Copilot search model'),
  createElement('p', { style: nativeCaptionStyle },
    'Uses the native Copilot account, independently of the chat model. Listed models match account and native Responses metadata; search support is verified only when searching. Each search can incur charges for a probe and query.'),
  createElement('label', null, 'Search model',
    createElement('select', { value: draft, disabled, style: nativeSelectStyle(disabled),
      onChange: (event: ChangeEvent<HTMLSelectElement>) => { setDraft(event.currentTarget.value); setMessage('') } },
    createElement('option', { value: '', style: nativeOptionStyle() }, 'Automatic'),
    missing ? createElement('option', { value: draft, style: nativeOptionStyle(true), disabled: true }, `${draft} (unavailable)`) : null,
    ...(models ?? []).map(id => createElement('option', { key: id, value: id, style: nativeOptionStyle() }, id)))),
  modelsError ? createElement('p', { role: 'alert', style: nativeCaptionStyle },
    'Could not load eligible models. Check the native Copilot account and provider, then reload. Automatic remains available.') : null,
  createElement('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
    createElement('button', { type: 'button', style: nativeButtonStyle, disabled: loading || saving,
      onClick: () => void load() }, 'Reload'),
    createElement('button', { type: 'button', 'data-save': true, style: nativeButtonStyle,
      disabled: disabled || draft === saved, onClick: () => void save() }, saving ? 'Saving…' : 'Save')),
  message ? createElement('p', { role: 'status', style: nativeCaptionStyle }, message) : null)
}
