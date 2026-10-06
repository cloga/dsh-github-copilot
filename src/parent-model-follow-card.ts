import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { createElement, useEffect, useId, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { nativeButtonStyle, nativeHeadingStyle, nativeSettingsStyle, nativeSettingsCss } from './native-settings-style.ts'

type Settings = Context['remote']['settings']
interface Snapshot { enabled: boolean; revision: number; writable: boolean; legacy: boolean }
interface Props {
  settings: Settings
  onSaved?: (revision: { previous: number; next: number }) => void
}

const ns = 'github-copilot'
const button: CSSProperties = nativeButtonStyle

export async function readParentFollowSettings(settings: Settings): Promise<Snapshot> {
  const result = await settings.describe()
  if (!result.ok) throw new Error('Could not load subagent settings. Reload to retry.')
  const entry = result.value.namespaces.find(value => value.ns === ns)
  const value: unknown = entry?.value
  if (!entry || !Number.isSafeInteger(entry.revision) || entry.revision < 0
    || typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Subagent settings are unavailable. Reload after the plugin is active.')
  }
  const enabled = Reflect.get(value, 'followParentModel')
  const legacy = Reflect.get(value, 'parentModelFollow')
  if (enabled !== undefined && typeof enabled !== 'boolean'
    || legacy !== undefined && !Array.isArray(legacy)) {
    throw new Error('Subagent settings are invalid. Review the saved configuration before editing.')
  }
  return { enabled: enabled === true, revision: entry.revision, writable: result.value.writable === true,
    legacy: Array.isArray(legacy) && legacy.length > 0 }
}

export async function saveParentFollowSettings(settings: Settings, saved: Snapshot, enabled: boolean) {
  const current = await readParentFollowSettings(settings)
  if (!current.writable) throw new Error('Subagent settings are read-only in this deployment.')
  if (current.enabled !== saved.enabled) throw new Error('This setting changed elsewhere. Reload and review it before saving.')
  const result = await settings.mutate(ns, [{ op: 'set', path: ['followParentModel'], value: enabled }], current.revision)
  if (!result.ok) throw new Error('Could not confirm the save. Reload to check saved settings before retrying.')
  if (!Number.isSafeInteger(result.value.revision) || result.value.revision <= current.revision) {
    throw new Error('Save returned no valid revision. Reload before editing again.')
  }
  return { snapshot: { ...current, enabled, revision: result.value.revision },
    revision: { previous: current.revision, next: result.value.revision } }
}

export function ParentModelFollowCard({ settings, onSaved }: Props) {
  const [saved, setSaved] = useState<Snapshot>()
  const [enabled, setEnabled] = useState(false)
  const [busy, setBusy] = useState(true)
  const [message, setMessage] = useState('')
  const [failed, setFailed] = useState(false)
  const lifecycle = useRef({ active: false, generation: 0, busy: false })
  const descriptionId = useId()
  const load = async () => {
    const owner = lifecycle.current
    if (!owner.active || owner.busy) return
    const generation = owner.generation
    owner.busy = true; setBusy(true)
    try {
      const next = await readParentFollowSettings(settings)
      if (!owner.active || owner.generation !== generation) return
      setSaved(next); setEnabled(next.enabled); setFailed(false)
      setMessage(next.writable ? '' : 'Subagent settings are read-only in this deployment.')
    } catch {
      if (owner.active && owner.generation === generation) {
        setFailed(true); setMessage('Could not load subagent settings. Reload to retry.')
      }
    } finally {
      if (owner.active && owner.generation === generation) { owner.busy = false; setBusy(false) }
    }
  }
  useEffect(() => {
    const owner = lifecycle.current
    owner.active = true; void load()
    return () => { owner.active = false; owner.generation++; owner.busy = false }
  }, [settings])
  const disabled = busy || failed || !saved?.writable
  const save = async () => {
    const owner = lifecycle.current
    if (disabled || !saved || owner.busy || enabled === saved.enabled) return
    const generation = owner.generation
    owner.busy = true; setBusy(true); setMessage('Saving…')
    try {
      const next = await saveParentFollowSettings(settings, saved, enabled)
      if (!owner.active || owner.generation !== generation) return
      setSaved(next.snapshot); onSaved?.(next.revision)
      setMessage('Saved. Applies from each child’s next turn.')
    } catch {
      if (owner.active && owner.generation === generation) {
        setFailed(true)
        setMessage('Could not confirm the save. Reload to check for conflicts or read-only settings before retrying. Your choice has been kept.')
      }
    } finally {
      if (owner.active && owner.generation === generation) { owner.busy = false; setBusy(false) }
    }
  }
  return createElement('section', { 'data-dsh-parent-model-follow': true, 'data-copilot-native-ui': true, 'aria-busy': busy,
    style: { ...nativeSettingsStyle, padding: '12px 14px', marginTop: '16px', display: 'grid', gap: '12px' } },
  createElement('style', null, nativeSettingsCss),
  createElement('h3', { style: nativeHeadingStyle }, 'Subagent models'),
  createElement('label', { style: { display: 'flex', gap: '12px', alignItems: 'center', minHeight: '40px' } },
    createElement('input', { type: 'checkbox', role: 'switch', checked: enabled, disabled,
      'aria-describedby': descriptionId,
      onChange: (event: { currentTarget: { checked: boolean } }) => { setEnabled(event.currentTarget.checked); setMessage('Unsaved change.') } }),
    createElement('strong', null, 'Follow parent model')),
  createElement('div', { id: descriptionId, style: { fontSize: '14px', lineHeight: '22px', maxWidth: '70ch' } },
    createElement('p', { style: { margin: 0 } }, 'Apply to existing and new supported Copilot subagents and Team mates.'),
    createElement('p', { style: { margin: '6px 0 0' } }, 'Fixed parent: follow its model next turn. Auto parent: each child chooses using its own context.'),
    createElement('p', { style: { margin: '6px 0 0' } }, 'Running turns stay unchanged. Replaces creation-time model choices; a child’s own manual selection still wins.')),
  saved?.legacy ? createElement('p', { role: 'note', style: { margin: 0, fontSize: '12px', lineHeight: '18px' } },
    'Existing per-child bindings remain active even when this switch is off. They have not been changed.') : null,
  createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '12px' } },
    createElement('button', { type: 'button', style: { ...button, opacity: disabled || enabled === saved?.enabled ? 0.5 : 1 },
      disabled: disabled || enabled === saved?.enabled,
      onClick: () => { void save() } }, busy ? 'Please wait…' : 'Save'),
    createElement('button', { type: 'button', style: { ...button, opacity: busy ? 0.5 : 1 }, disabled: busy,
      title: 'Reload saved values and discard unsaved edits', onClick: () => { void load() } }, 'Reload')),
  createElement('p', { role: 'status', 'aria-live': 'polite', 'aria-atomic': true,
    style: { margin: 0, fontSize: '12px', lineHeight: '18px' } }, message || (busy ? 'Loading subagent settings…' : '')))
}
