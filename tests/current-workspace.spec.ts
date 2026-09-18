import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCurrentWorkspaceSource } from '../src/current-workspace.ts'

const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })
function store(initial: unknown) {
  let value = initial
  const listeners = new Set<() => void>()
  return { getSnapshot: () => value, subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn) } },
    set(next: unknown) { value = next; for (const fn of listeners) fn() }, listeners }
}
const sessionState = (current?: string) => ({ phase: 'ready', current })
const workspaceState = () => ({ phase: 'ready', state: 'idle', items: [
  { workspaceId: 'workspace-a', sessionIds: ['session-a'] },
  { workspaceId: 'workspace-b', sessionIds: ['session-b'] },
] })
function setup() {
  const ctx = new Context(); contexts.push(ctx)
  const sessions = store(sessionState('session-a')), workspaces = store(workspaceState())
  const create = vi.fn(), open = vi.fn(), startSession = vi.fn()
  const provide = () => ctx.plugin({ apply(c) {
    c.provide('sessions', { list: sessions, create, open })
    c.provide('workspaces', { list: workspaces, create })
    c.provide('uiWorkspace', { startSession })
  } })
  return { ctx, sessions, workspaces, create, open, startSession, provide }
}

describe('optional current workspace source', () => {
  it('uses only current-session membership and observes both public lists without navigation', async () => {
    const f = setup(); const owner = f.provide(); await owner
    const source = createCurrentWorkspaceSource(f.ctx)
    await Promise.resolve(); await Promise.resolve()
    const notify = vi.fn(), off = source.subscribe(notify)
    expect(source.getSnapshot()).toBe('workspace-a')
    f.sessions.set(sessionState('session-b'))
    expect(source.getSnapshot()).toBe('workspace-b')
    f.workspaces.set({ ...workspaceState(), items: [{ workspaceId: 'moved', sessionIds: ['session-b'] }] })
    expect(source.getSnapshot()).toBe('moved')
    expect(notify).toHaveBeenCalled()
    expect(f.create).not.toHaveBeenCalled(); expect(f.open).not.toHaveBeenCalled(); expect(f.startSession).not.toHaveBeenCalled()
    off(); source.dispose()
  })

  it('never guesses first or recent workspace for missing, pending, failed or ambiguous state', async () => {
    const f = setup(); await f.provide()
    const source = createCurrentWorkspaceSource(f.ctx)
    await Promise.resolve(); await Promise.resolve()
    for (const value of [sessionState(), sessionState('unknown'), { current: 'session-a' }, { phase: 'pending', current: 'session-a' }]) {
      f.sessions.set(value); expect(source.getSnapshot()).toBeUndefined()
    }
    f.sessions.set(sessionState('session-a'))
    for (const value of [undefined, { ...workspaceState(), phase: 'pending' }, { ...workspaceState(), state: 'error' },
      { phase: 'ready', state: 'idle', items: [{ workspaceId: 'one', sessionIds: ['session-a'] }, { workspaceId: 'two', sessionIds: ['session-a'] }] }]) {
      f.workspaces.set(value); expect(source.getSnapshot()).toBeUndefined()
    }
    source.dispose()
  })

  it('reads alpha.2 public mainView ownership without legacy current or private navigation state', async () => {
    const f = setup(); await f.provide()
    const source = createCurrentWorkspaceSource(f.ctx)
    await Promise.resolve(); await Promise.resolve()
    const row = (id: string, mainView = 0) => ({ id, retainedBy: { mainView, background: 3 } })
    const state = (a = 0, b = 0) => ({ phase: 'ready', byId: { 'session-a': row('session-a', a), 'session-b': row('session-b', b) } })
    f.sessions.set(state(1)); expect(source.getSnapshot()).toBe('workspace-a')
    f.sessions.set(state(0, 1)); expect(source.getSnapshot()).toBe('workspace-b')
    for (const value of [state(), state(1, 1), state(-1), state(0.5), state(Infinity),
      { ...state(1), phase: 'pending' }, { ...state(1), current: undefined },
      { phase: 'ready', byId: { malformed: { retainedBy: { mainView: 1 } } } }]) {
      f.sessions.set(value); expect(source.getSnapshot()).toBeUndefined()
    }
    expect(f.create).not.toHaveBeenCalled(); expect(f.open).not.toHaveBeenCalled(); expect(f.startSession).not.toHaveBeenCalled()
    source.dispose()
  })

  it('tracks optional service loss/reappearance and disposes every listener', async () => {
    const f = setup(), source = createCurrentWorkspaceSource(f.ctx), notify = vi.fn()
    const off = source.subscribe(notify)
    expect(source.getSnapshot()).toBeUndefined()
    const owner = f.provide(); await owner; await Promise.resolve(); await Promise.resolve()
    expect(source.getSnapshot()).toBe('workspace-a')
    await owner.dispose()
    expect(source.getSnapshot()).toBeUndefined()
    expect(f.sessions.listeners.size).toBe(0); expect(f.workspaces.listeners.size).toBe(0)
    f.sessions.set(sessionState('session-b'))
    await f.provide(); await Promise.resolve(); await Promise.resolve()
    expect(source.getSnapshot()).toBe('workspace-b')
    off(); source.dispose(); await Promise.resolve(); await Promise.resolve()
    expect(source.getSnapshot()).toBeUndefined()
    expect(f.sessions.listeners.size).toBe(0); expect(f.workspaces.listeners.size).toBe(0)
  })
})
