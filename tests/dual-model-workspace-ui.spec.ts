// @vitest-environment jsdom
import { Context, Service } from '@deepseek-ai/cordis'
import { act } from 'react'
import type { ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DualModelConfig, DualModelRemote, DualModelView, Result } from '../src/dual-model-card.ts'
import { registerDualModelUi } from '../src/dual-model-ui.ts'

// Real Cordis namespace tracing, registered render callback, workspace source and
// React card. Only public service data, Remote transport and slot hosts are synthetic.
const cleanups: Array<() => Promise<void>> = []
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }) })
afterEach(async () => {
  await act(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

function store<T>(initial: T) {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => value,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    set(next: T) { value = next; for (const listener of listeners) listener() },
    listeners,
  }
}
// Official alpha.2 exposes main-view retention in byId, not list.current.
const sessionState = (current?: string) => ({ phase: 'ready', byId: {
  'session-a': { id: 'session-a', retainedBy: { mainView: current === 'session-a' ? 1 : 0 } },
  'session-b': { id: 'session-b', retainedBy: { mainView: current === 'session-b' ? 1 : 0 } },
} })
const workspaceState = () => ({ phase: 'ready', state: 'idle', items: [
  { workspaceId: 'workspace-a', sessionIds: ['session-a'] },
  { workspaceId: 'workspace-b', sessionIds: ['session-b'] },
] })
const enabled: DualModelConfig = { enabled: true, plannerModel: 'plan-model', executorModel: 'code-model' }
const ok = <T,>(value: T): Result<T> => ({ ok: true, value })
function view(configuration: DualModelConfig = enabled): DualModelView {
  return {
    supported: true, writable: true, revision: 4, configuration,
    models: [{ id: 'plan-model', name: 'Planning model' }, { id: 'code-model', name: 'Coding model' }],
    workspaces: [{ id: 'workspace-a', name: 'Workspace A' }, { id: 'workspace-b', name: 'Workspace B' }],
  }
}
class NamedService extends Service {
  constructor(ctx: Context, name: string) { super(ctx, name) }
}
interface Registration {
  name: string
  render: (props: { close: () => void }) => ReactElement
  mounted?: Root
}
interface FixtureOptions {
  footer?: boolean
  current?: string
  lists?: 'both' | 'sessions' | 'workspaces' | 'none'
  navigation?: boolean
  locale?: boolean
  configuration?: DualModelConfig
}
async function fixture(options: FixtureOptions = {}) {
  const root = new Context()
  cleanups.push(async () => { await root.fiber.dispose() })
  const registrations = new Map<string, Registration>()
  const declarations = new Map<string, () => () => void>()
  const seats = new Map<string, () => void>()
  const setFooter = (available: boolean) => {
    const name = 'settings.models.footer'
    if (available && !seats.has(name)) seats.set(name, declarations.get(name)!())
    if (!available) { seats.get(name)?.(); seats.delete(name) }
  }
  const sessions = store<unknown>(sessionState(options.current))
  const workspaces = store(workspaceState())
  const language = store('en-US')
  const openSession = vi.fn(), startSession = vi.fn(), open = vi.fn(), create = vi.fn(), close = vi.fn()
  const remote = {
    view: vi.fn<DualModelRemote['view']>(async () => ok(view(options.configuration))),
    save: vi.fn<DualModelRemote['save']>(async input => ok({ ...view(input.configuration), revision: input.expectedRevision + 1 })),
    create: vi.fn<DualModelRemote['create']>(async () => ok({ sessionId: 'created-session' })),
  }
  class RolesRemote extends NamedService {
    view = remote.view
    save = remote.save
    create = remote.create
    constructor(ctx: Context) { super(ctx, 'remote.githubCopilotDualModel') }
  }
  class Slots extends NamedService {
    constructor(ctx: Context) { super(ctx, 'slots') }
    spec() { return { kind: 'list', scope: 'root' } }
    inject(name: string, callback: () => () => void) {
      return this.ctx.effect(() => {
        declarations.set(name, callback)
        if (name === 'settings.section' || (options.footer !== false && name === 'settings.models.footer')) seats.set(name, callback())
        return () => { seats.get(name)?.(); seats.delete(name); declarations.delete(name) }
      })
    }
    register(spec: { name: string; id: string }, render: Registration['render']) {
      return this.ctx.effect(() => {
        const key = `${spec.name}:${spec.id}`
        if (registrations.has(key)) throw new Error('Duplicate model-role surface')
        const registration: Registration = { name: spec.name, render }
        registrations.set(key, registration)
        return () => {
          registration.mounted?.unmount()
          registration.mounted = undefined
          registrations.delete(key)
        }
      })
    }
  }
  await root.plugin({ apply(ctx) {
    new NamedService(ctx, 'remote')
    new RolesRemote(ctx)
    new Slots(ctx)
    if (options.navigation !== false) ctx.provide('uiWorkspace', { openSession, startSession })
    if (options.locale) ctx.provide('locale', { getLocale: () => ({ active: language.getSnapshot() }), subscribe: language.subscribe })
  } })
  const provideLists = (which: FixtureOptions['lists'] = 'both') => root.plugin({ apply(ctx) {
    if (which === 'both' || which === 'sessions') ctx.provide('sessions', { list: sessions, open, create })
    if (which === 'both' || which === 'workspaces') ctx.provide('workspaces', { list: workspaces, create })
  } })
  const listOwner = provideLists(options.lists ?? 'both')
  await listOwner
  // Match the production parent Remote grant and child namespace injection;
  // neither ctx.remote nor Context is replaced with a plain object.
  const ui = root.plugin({ inject: ['remote'], apply(ctx) {
    ctx.inject(['remote.githubCopilotDualModel', 'slots'], registerDualModelUi)
  } })
  await ui
  await vi.waitFor(() => expect(registrations.size).toBe(1))
  const registration = [...registrations.values()][0]!
  const container = document.createElement('div')
  document.body.append(container)
  const mountCurrent = () => {
    expect(registrations.size).toBe(1)
    const current = [...registrations.values()][0]!
    current.mounted = createRoot(container)
    current.mounted.render(current.render({ close }))
  }
  await act(async () => { mountCurrent() })
  const field = <T extends HTMLElement = HTMLButtonElement>(name: string): T => {
    const element = container.querySelector<T>(`[data-dsh-dual-model-${name}]`)
    expect(element, name).not.toBeNull()
    return element!
  }
  return { root, ui, registration, registrations, container, field, sessions, workspaces, language,
    remote, openSession, startSession, open, create, close, listOwner, provideLists, setFooter, mountCurrent }
}
type Fixture = Awaited<ReturnType<typeof fixture>>
async function click(f: Fixture, name: string) { await act(async () => { f.field(name).click() }) }
async function select(f: Fixture, name: string, value: string) {
  await act(async () => {
    const element = f.field<HTMLSelectElement>(name)
    element.value = value
    element.dispatchEvent(new Event('change', { bubbles: true }))
  })
}
function expectNoImplicitActions(f: Fixture) {
  expect(f.remote.create).not.toHaveBeenCalled()
  expect(f.openSession).not.toHaveBeenCalled()
  expect(f.startSession).not.toHaveBeenCalled()
  expect(f.open).not.toHaveBeenCalled()
  expect(f.create).not.toHaveBeenCalled()
}

describe('mounted model-role UI current-workspace integration', () => {
  it.each([true, false])('reacts to both public lists through the registered surface (footer=%s)', async footer => {
    const f = await fixture({ footer, current: 'session-a' })
    expect(f.registration.name).toBe(footer ? 'settings.models.footer' : 'settings.section')
    expect(f.field('workspace').textContent).toBe('Workspace A')
    expect(f.field('create').disabled).toBe(false)
    expect(f.sessions.listeners.size).toBe(1)
    expect(f.workspaces.listeners.size).toBe(1)
    expect(f.container.querySelectorAll('select')).toHaveLength(2)
    expect(f.field('workspace').tagName).not.toBe('SELECT')

    // Do not call root.render again: these must propagate via useSyncExternalStore.
    await act(async () => { f.sessions.set(sessionState('session-b')) })
    expect(f.field('workspace').dataset.workspaceId).toBe('workspace-b')
    expect(f.field('workspace').textContent).toBe('Workspace B')
    await act(async () => {
      f.workspaces.set({ ...workspaceState(), items: [
        { workspaceId: 'workspace-a', sessionIds: ['session-a', 'session-b'] },
        { workspaceId: 'workspace-b', sessionIds: [] },
      ] })
    })
    expect(f.field('workspace').dataset.workspaceId).toBe('workspace-a')
    expect(f.field('workspace').textContent).toBe('Workspace A')
    expect(f.remote.view).toHaveBeenCalledTimes(1)
    expect(f.remote.save).not.toHaveBeenCalled()
    expectNoImplicitActions(f)

    await click(f, 'create')
    expect(f.remote.create).toHaveBeenCalledExactlyOnceWith({
      requestId: expect.any(String), workspaceId: 'workspace-a', expectedRevision: 4,
    })
    expect(f.openSession).toHaveBeenCalledExactlyOnceWith('created-session')
    expect(f.close).toHaveBeenCalledTimes(footer ? 0 : 1)
    expect(f.startSession).not.toHaveBeenCalled()
    expect(f.open).not.toHaveBeenCalled()
    expect(f.create).not.toHaveBeenCalled()
  })

  it('saves profile-global edits with no current session and preserves them when current membership changes', async () => {
    const f = await fixture({ configuration: { enabled: false, plannerModel: '', executorModel: '' } })
    expect(f.field('workspace').textContent).toContain('No current workspace')
    expect(f.field('workspace').textContent).not.toContain('Workspace A')
    await click(f, 'enabled')
    await select(f, 'planner', 'plan-model')
    await select(f, 'executor', 'code-model')
    expect(f.field('save').disabled).toBe(false)
    expect(f.field('create').disabled).toBe(true)
    await click(f, 'save')
    expect(f.remote.save).toHaveBeenCalledExactlyOnceWith({ configuration: enabled, expectedRevision: 4 })
    expect(f.field('create').disabled).toBe(true)
    expectNoImplicitActions(f)

    await select(f, 'executor', 'plan-model')
    await act(async () => { f.sessions.set(sessionState('session-b')) })
    expect(f.field('workspace').textContent).toBe('Workspace B')
    expect(f.field<HTMLSelectElement>('executor').value).toBe('plan-model')
    expect(f.container.textContent).toContain('Save your changes before creating a session')
    expect(f.field('create').disabled).toBe(true)
    expect(f.remote.view).toHaveBeenCalledTimes(1)
    expect(f.remote.save).toHaveBeenCalledTimes(1)
    expectNoImplicitActions(f)
  })

  it.each(['none', 'sessions', 'workspaces'] as const)('keeps Save usable without optional services (lists=%s)', async lists => {
    const f = await fixture({ lists, current: 'session-b', navigation: false })
    // Locale and navigation are also absent; the card must mount in English.
    expect(f.container.textContent).toContain('Model roles')
    expect(f.field('workspace').textContent).toContain('No current workspace')
    expect(f.field('create').disabled).toBe(true)
    expect(f.field('save').disabled).toBe(false)
    expect(f.sessions.listeners.size).toBe(0)
    expect(f.workspaces.listeners.size).toBe(0)
    await click(f, 'create')
    await click(f, 'save')
    expect(f.remote.save).toHaveBeenCalledExactlyOnceWith({ configuration: enabled, expectedRevision: 4 })
    expectNoImplicitActions(f)
  })

  it('creates in proven current membership even when optional navigation and locale services are absent', async () => {
    const f = await fixture({ footer: false, current: 'session-b', navigation: false })
    expect(f.field('workspace').textContent).toBe('Workspace B')
    expect(f.field('create').disabled).toBe(false)
    await click(f, 'create')
    expect(f.remote.create).toHaveBeenCalledExactlyOnceWith({
      requestId: expect.any(String), workspaceId: 'workspace-b', expectedRevision: 4,
    })
    expect(f.container.textContent).toContain('Session created.')
    expect(f.openSession).not.toHaveBeenCalled()
    expect(f.close).not.toHaveBeenCalled()
    expect(f.startSession).not.toHaveBeenCalled()
    expect(f.open).not.toHaveBeenCalled()
    expect(f.create).not.toHaveBeenCalled()
  })

  it('reacts to optional service arrival, loss and reappearance and removes listeners on disposal', async () => {
    const f = await fixture({ lists: 'none', current: 'session-a', locale: true })
    expect(f.field('create').disabled).toBe(true)
    expect(f.language.listeners.size).toBe(1)
    let owner!: ReturnType<typeof f.provideLists>
    await act(async () => { owner = f.provideLists(); await owner })
    expect(f.field('workspace').textContent).toBe('Workspace A')
    expect(f.field('create').disabled).toBe(false)
    expect(f.sessions.listeners.size).toBe(1)
    expect(f.workspaces.listeners.size).toBe(1)

    await act(async () => { await owner.dispose() })
    expect(f.field('workspace').textContent).toContain('No current workspace')
    expect(f.field('create').disabled).toBe(true)
    expect(f.field('save').disabled).toBe(false)
    expect(f.sessions.listeners.size).toBe(0)
    expect(f.workspaces.listeners.size).toBe(0)
    await act(async () => {
      f.sessions.set(sessionState('session-b'))
      await f.provideLists()
    })
    expect(f.field('workspace').textContent).toBe('Workspace B')
    expect(f.field('create').disabled).toBe(false)
    expect(f.remote.view).toHaveBeenCalledTimes(1)
    expectNoImplicitActions(f)

    await act(async () => { await f.ui.dispose() })
    expect(f.registrations.size).toBe(0)
    expect(f.container.childElementCount).toBe(0)
    expect(f.sessions.listeners.size).toBe(0)
    expect(f.workspaces.listeners.size).toBe(0)
    expect(f.language.listeners.size).toBe(0)
    await act(async () => { f.sessions.set(sessionState('session-a')); f.workspaces.set(workspaceState()) })
    expect(f.remote.view).toHaveBeenCalledTimes(1)
    expectNoImplicitActions(f)
  })

  it('retains an uncertain creation through current changes and mounted footer/fallback transfers', async () => {
    const f = await fixture({ footer: false, current: 'session-b' })
    f.remote.create.mockResolvedValueOnce({ ok: false, error: { code: 'UNKNOWN' } })
    await click(f, 'create')
    const request = f.remote.create.mock.calls[0]![0]
    expect(request).toMatchObject({ workspaceId: 'workspace-b', expectedRevision: 4 })
    await act(async () => { f.sessions.set(sessionState('session-a')) })
    expect(f.field('workspace').textContent).toBe('Workspace B')
    expect(f.container.textContent).toContain('Original destination')
    expect(f.remote.view).toHaveBeenCalledTimes(1)
    expect(f.remote.create).toHaveBeenCalledTimes(1)

    await act(async () => { f.setFooter(true); f.mountCurrent() })
    expect([...f.registrations.values()][0]!.name).toBe('settings.models.footer')
    expect(f.field('workspace').dataset.workspaceId).toBe('workspace-b')
    expect(f.field('create').textContent).toBe('Retry the same creation request')
    await act(async () => { f.sessions.set(sessionState()); f.setFooter(false); f.mountCurrent() })
    expect([...f.registrations.values()][0]!.name).toBe('settings.section')
    expect(f.field('workspace').dataset.workspaceId).toBe('workspace-b')
    expect(f.field('create').disabled).toBe(false)
    expect(f.remote.view).toHaveBeenCalledTimes(3)
    expect(f.remote.create).toHaveBeenCalledTimes(1)
    expect(f.openSession).not.toHaveBeenCalled()
    expect(f.sessions.listeners.size).toBe(1)
    expect(f.workspaces.listeners.size).toBe(1)

    await click(f, 'create')
    expect(f.remote.create).toHaveBeenCalledTimes(2)
    expect(f.remote.create.mock.calls[1]![0]).toEqual(request)
    expect(f.openSession).toHaveBeenCalledExactlyOnceWith('created-session')
    expect(f.close).toHaveBeenCalledTimes(1)
  })

  it('retains legacy current support without falling back when that selection is explicitly cleared', async () => {
    const f = await fixture()
    await act(async () => { f.sessions.set({ phase: 'ready', current: 'session-b' }) })
    expect(f.field('workspace').textContent).toBe('Workspace B')
    expect(f.field('create').disabled).toBe(false)
    await act(async () => { f.sessions.set({ ...sessionState('session-a'), current: undefined }) })
    expect(f.field('workspace').textContent).toContain('No current workspace')
    expect(f.field('create').disabled).toBe(true)
    expect(f.field('save').disabled).toBe(false)
    expect(f.remote.view).toHaveBeenCalledTimes(1)
    expectNoImplicitActions(f)
  })

  it('disables creation on lost or ambiguous membership without guessing another workspace', async () => {
    const f = await fixture({ current: 'session-b' })
    expect(f.field('create').disabled).toBe(false)
    for (const items of [
      [{ workspaceId: 'workspace-a', sessionIds: ['session-a'] }],
      [{ workspaceId: 'workspace-a', sessionIds: ['session-b'] }, { workspaceId: 'workspace-b', sessionIds: ['session-b'] }],
    ]) {
      await act(async () => { f.workspaces.set({ ...workspaceState(), items }) })
      expect(f.field('workspace').textContent).toContain('No current workspace')
      expect(f.field('workspace').dataset.workspaceId).toBeUndefined()
      expect(f.field('create').disabled).toBe(true)
      expect(f.field('save').disabled).toBe(false)
    }
    await act(async () => { f.workspaces.set(workspaceState()) })
    expect(f.field('workspace').textContent).toBe('Workspace B')
    await act(async () => { f.sessions.set(sessionState()) })
    expect(f.field('workspace').textContent).toContain('No current workspace')
    expect(f.field('create').disabled).toBe(true)
    expect(f.remote.view).toHaveBeenCalledTimes(1)
    expectNoImplicitActions(f)
  })
})
