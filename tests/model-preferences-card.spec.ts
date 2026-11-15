// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { GitHubCopilotModelPreferencesPanel } from '../src/model-preferences-card.ts'
import type { GitHubCopilotAuthorizationView, GitHubCopilotModelPreferencesView } from '../src/authorization-controller.ts'

type Props = Parameters<typeof GitHubCopilotModelPreferencesPanel>[0]
const cleanups: Array<() => void> = []
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }) })
afterEach(async () => {
  await act(async () => { cleanups.splice(0).forEach(dispose => dispose()) })
  document.body.replaceChildren()
})
const preferences: GitHubCopilotModelPreferencesView = {
  state: 'ready', writable: true, revision: 1, excludedModelIds: [], highCostModelIds: [],
  lockedModelIds: [], unavailableExcludedModelIds: [],
}
const models: GitHubCopilotAuthorizationView['accountModels'] = {
  state: 'ready', models: [
    { id: 'first', name: 'First', api: 'openai-responses' },
    { id: 'second', name: 'Second', api: 'openai-responses' },
  ], rejected: [],
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
async function mount(props: Props) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  cleanups.push(() => root.unmount())
  const render = async (next = props) => { props = next; await act(async () => { root.render(createElement(GitHubCopilotModelPreferencesPanel, props)) }) }
  await render()
  return { render, container }
}
function row(id: string) { return document.querySelector<HTMLButtonElement>(`[data-model-id="${id}"]`)! }
async function click(element: HTMLElement) { await act(async () => { element.click() }) }
function remote() {
  return {
    status: vi.fn<Props['remote']['status']>(),
    setModelExcluded: vi.fn<Props['remote']['setModelExcluded']>(),
    setModelHighCost: vi.fn(),
    previewNativeModelSync: vi.fn<Props['remote']['previewNativeModelSync']>(),
    applyNativeModelSync: vi.fn<Props['remote']['applyNativeModelSync']>(),
  }
}

it('does not expose retired Auto cost controls or change saved cost preferences', async () => {
  const face = remote()
  await mount({ remote: face, models, preferences: {
    ...preferences, highCostModelIds: ['first', 'retired-only'],
  } })
  expect(document.querySelector('[data-dsh-github-copilot-high-cost]')).toBeNull()
  expect(document.querySelector('[data-model-id="retired-only"]')).toBeNull()
  expect(document.body.textContent).not.toContain('High cost')
  expect(document.body.textContent).not.toContain('Auto gives')
  expect(row('first').textContent).toBe('Exclude')
  expect(face.setModelHighCost).not.toHaveBeenCalled()
  expect(face.setModelExcluded).not.toHaveBeenCalled()
})

it('keeps a real mounted row saving across equivalent parent snapshots and applies the strict result without rereading', async () => {
  const face = remote()
  const write = deferred<{ ok: true; value: GitHubCopilotModelPreferencesView }>()
  face.setModelExcluded.mockReturnValue(write.promise)
  const panel = await mount({ remote: face, models, preferences })
  await click(row('first'))
  await panel.render({ remote: face, models: { ...models }, preferences: { ...preferences, excludedModelIds: [] } })
  expect(row('first').textContent).toBe('Saving…')
  expect(row('second').disabled).toBe(false)
  await act(async () => { write.resolve({ ok: true, value: { ...preferences, revision: 2, excludedModelIds: ['first'] } }) })
  expect(row('first').textContent).toBe('Restore')
  await panel.render({ remote: face, models, preferences: { ...preferences } })
  expect(row('first').textContent).toBe('Restore')
  expect(face.status).not.toHaveBeenCalled()
  expect(face.setModelExcluded).toHaveBeenCalledExactlyOnceWith('first', true)
})

it('previews a native model sync and applies it only after the explicit confirmation action', async () => {
  const face = remote()
  face.previewNativeModelSync.mockResolvedValue({ ok: true, value: {
    state: 'ready', planId: '12345678-1234-4234-8234-123456789012',
    enabledCount: 3, syncableCount: 2, addedIds: ['first'], removedIds: ['old'],
    outputTokenDefaults: [{ id: 'first', maxTokens: 8192 }, { id: 'second', maxTokens: 4096 }],
    updatedIds: ['second'], skipped: [{ id: 'third', code: 'NATIVE_API_MISMATCH' }],
  } })
  face.applyNativeModelSync.mockResolvedValue({ ok: true, value: { state: 'ready', modelCount: 2 } })
  const availableModels = { ...models, models: [...models.models, { id: 'third', name: 'Third', api: 'openai-responses' }] }
  await mount({ remote: face, models: availableModels, preferences })

  await click(document.querySelector<HTMLButtonElement>('[data-dsh-github-copilot-native-model-sync-preview]')!)
  expect(face.previewNativeModelSync).toHaveBeenCalledOnce()
  expect(face.applyNativeModelSync).not.toHaveBeenCalled()
  expect(document.body.textContent).toContain('2 of 3 enabled models will be written')
  expect(document.body.textContent).toContain('Models to add')
  expect(document.body.textContent).toContain('Models to update')
  expect(document.body.textContent).toContain('NATIVE_API_MISMATCH')
  expect(document.body.textContent).toContain('The native route uses a different protocol')
  expect(document.body.textContent).toContain('replaces the native provider’s built-in catalog')
  expect(document.body.textContent).toContain('remains after the plugin is unloaded or uninstalled')
  expect(document.body.textContent).toContain('permission-field filtering does not transfer')
  expect(document.body.textContent).toContain('Core also uses each configured maxTokens')
  expect(document.body.textContent).toContain('Per-request output defaults (2)')
  expect(document.body.textContent).toContain(`${new Intl.NumberFormat().format(8192)} max output tokens`)
  expect(document.body.textContent).toContain(`${new Intl.NumberFormat().format(4096)} max output tokens`)
  expect(document.body.textContent).toContain('old')

  await click(document.querySelector<HTMLButtonElement>('[data-dsh-github-copilot-native-model-sync-apply]')!)
  expect(face.applyNativeModelSync).toHaveBeenCalledExactlyOnceWith('12345678-1234-4234-8234-123456789012')
  expect(document.body.textContent).toContain('Synced 2 models')
})

it('does not dispatch duplicate preview or apply actions before React renders the busy state', async () => {
  const face = remote()
  const preview = deferred<Awaited<ReturnType<Props['remote']['previewNativeModelSync']>>>()
  const apply = deferred<Awaited<ReturnType<Props['remote']['applyNativeModelSync']>>>()
  face.previewNativeModelSync.mockReturnValue(preview.promise)
  face.applyNativeModelSync.mockReturnValue(apply.promise)
  await mount({ remote: face, models, preferences })
  const previewButton = document.querySelector<HTMLButtonElement>('[data-dsh-github-copilot-native-model-sync-preview]')!
  await act(async () => { previewButton.click(); previewButton.click() })
  expect(face.previewNativeModelSync).toHaveBeenCalledOnce()
  await act(async () => { preview.resolve({ ok: true, value: {
    state: 'ready', planId: '12345678-1234-4234-8234-123456789012',
    enabledCount: 1, syncableCount: 1, addedIds: ['first'], removedIds: [], updatedIds: [],
    outputTokenDefaults: [{ id: 'first', maxTokens: 8192 }], skipped: [],
  } }) })
  const applyButton = document.querySelector<HTMLButtonElement>('[data-dsh-github-copilot-native-model-sync-apply]')!
  await act(async () => { applyButton.click(); applyButton.click() })
  expect(face.applyNativeModelSync).toHaveBeenCalledOnce()
  await act(async () => { apply.resolve({ ok: true, value: { state: 'ready', modelCount: 1 } }) })
})

it('consumes the preview after an uncertain apply instead of offering the same plan again', async () => {
  const face = remote()
  face.previewNativeModelSync.mockResolvedValue({ ok: true, value: {
    state: 'ready', planId: '12345678-1234-4234-8234-123456789012',
    enabledCount: 1, syncableCount: 1, addedIds: ['first'], removedIds: [], updatedIds: [],
    outputTokenDefaults: [{ id: 'first', maxTokens: 8192 }], skipped: [],
  } })
  face.applyNativeModelSync.mockResolvedValue({ ok: false, error: new RemoteError('gateway/internal', 'Synthetic failure', {}) })
  await mount({ remote: face, models, preferences })
  await click(document.querySelector<HTMLButtonElement>('[data-dsh-github-copilot-native-model-sync-preview]')!)
  await click(document.querySelector<HTMLButtonElement>('[data-dsh-github-copilot-native-model-sync-apply]')!)
  expect(document.querySelector('[data-dsh-github-copilot-native-model-sync-apply]')).toBeNull()
  expect(document.body.textContent).toContain('Read the saved settings before trying again')
  expect(face.applyNativeModelSync).toHaveBeenCalledOnce()
})

it('ignores a preview response after the preference scope changes', async () => {
  const face = remote()
  const preview = deferred<Awaited<ReturnType<Props['remote']['previewNativeModelSync']>>>()
  face.previewNativeModelSync.mockReturnValue(preview.promise)
  const panel = await mount({ remote: face, models, preferences })
  await click(document.querySelector<HTMLButtonElement>('[data-dsh-github-copilot-native-model-sync-preview]')!)
  await panel.render({ remote: face, models, preferences: { ...preferences, revision: 2 } })
  await act(async () => { preview.resolve({ ok: true, value: {
    state: 'ready', planId: '12345678-1234-4234-8234-123456789012',
    enabledCount: 1, syncableCount: 1, addedIds: ['first'], removedIds: [],
    outputTokenDefaults: [{ id: 'first', maxTokens: 8192 }],
    updatedIds: [], skipped: [],
  } }) })
  expect(document.querySelector('[data-dsh-github-copilot-native-model-sync-preview-result]')).toBeNull()
  expect(face.applyNativeModelSync).not.toHaveBeenCalled()
})

it('sends one CAS intent at a time and never sends a queued intent after an unconfirmed response', async () => {
  const face = remote()
  const write = deferred<Awaited<ReturnType<Props['remote']['setModelExcluded']>>>()
  face.setModelExcluded.mockReturnValue(write.promise)
  await mount({ remote: face, models, preferences })
  await click(row('first'))
  await click(row('second'))
  expect(row('second').textContent).toBe('Waiting…')
  expect(face.setModelExcluded).toHaveBeenCalledTimes(1)
  await act(async () => { write.resolve({ ok: false, error: new RemoteError('gateway/internal', 'Synthetic failure', {}) }) })
  expect(row('first').disabled).toBe(true)
  expect(row('second').disabled).toBe(true)
  face.status.mockResolvedValue({ ok: true, value: {
    phase: 'signed-in', configured: true, writable: true, inFlight: false, notices: [],
    modelPreferences: { ...preferences, state: 'error', error: 'COPILOT_MODEL_EXCLUSION_SAVE_FAILED' }, accountModels: models,
  } })
  await click(document.querySelector<HTMLButtonElement>('[data-dsh-github-copilot-preferences-retry]')!)
  expect(row('first').disabled).toBe(false)
  expect(face.setModelExcluded).toHaveBeenCalledTimes(1)
  expect(face.status).toHaveBeenCalledTimes(1)
})

it('bounds waiting intents without dispatching past the active save or claiming persistence', async () => {
  const face = remote()
  const write = deferred<Awaited<ReturnType<Props['remote']['setModelExcluded']>>>()
  face.setModelExcluded.mockReturnValue(write.promise)
  const many = { ...models, models: Array.from({ length: 34 }, (_, index) => ({
    id: `model-${index}`, name: `Model ${index}`, api: 'openai-responses',
  })) }
  await mount({ remote: face, models: many, preferences })
  for (let index = 0; index < 34; index++) await click(row(`model-${index}`))
  expect(face.setModelExcluded).toHaveBeenCalledTimes(1)
  expect(row('model-32').textContent).toBe('Waiting…')
  expect(row('model-33').textContent).toBe('Exclude')
  expect(document.body.textContent).toContain('Too many edits are waiting')
  await act(async () => { write.resolve({ ok: false, error: new RemoteError('gateway/internal', 'Synthetic failure', {}) }) })
  expect(face.setModelExcluded).toHaveBeenCalledTimes(1)
})

it('cancels unsent row intents explicitly on a changed preference scope and ignores the late save', async () => {
  const face = remote()
  const write = deferred<{ ok: true; value: GitHubCopilotModelPreferencesView }>()
  face.setModelExcluded.mockReturnValue(write.promise)
  const panel = await mount({ remote: face, models, preferences })
  await click(row('first'))
  await click(row('second'))
  await panel.render({ remote: face, models, preferences: { ...preferences, revision: 3, excludedModelIds: ['second'] } })
  expect(document.body.textContent).toContain('Waiting edits were not sent')
  expect(row('second').textContent).toBe('Restore')
  await act(async () => { write.resolve({ ok: true, value: { ...preferences, revision: 2, excludedModelIds: ['first'] } }) })
  expect(row('second').textContent).toBe('Restore')
  expect(row('first').textContent).toBe('Exclude')
  expect(face.setModelExcluded).toHaveBeenCalledTimes(1)
})
