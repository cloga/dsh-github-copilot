// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
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
    setModelHighCost: vi.fn<Props['remote']['setModelHighCost']>(),
  }
}

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

it('sends one CAS intent at a time and never sends a queued intent after an unconfirmed response', async () => {
  const face = remote()
  const write = deferred<{ ok: false }>()
  face.setModelExcluded.mockReturnValue(write.promise)
  await mount({ remote: face, models, preferences })
  await click(row('first'))
  await click(row('second'))
  expect(row('second').textContent).toBe('Waiting…')
  expect(face.setModelExcluded).toHaveBeenCalledTimes(1)
  await act(async () => { write.resolve({ ok: false }) })
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
  const write = deferred<{ ok: false }>()
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
  await act(async () => { write.resolve({ ok: false }) })
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
