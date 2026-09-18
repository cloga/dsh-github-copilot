/** Optional read-only projection of the public Client Session/Workspace lists. */
import type { Context } from '@deepseek-ai/cordis'

interface SnapshotSource {
  getSnapshot(): unknown
  subscribe(listener: () => void): () => void
}
export interface CurrentWorkspaceSource {
  getSnapshot(): string | undefined
  subscribe(listener: () => void): () => void
  dispose(): void
}
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
function listOf(value: unknown): SnapshotSource | undefined {
  if (!object(value) || !object(value.list)) return undefined
  const list = value.list
  return typeof list.getSnapshot === 'function' && typeof list.subscribe === 'function' ? list as unknown as SnapshotSource : undefined
}
function selectedSession(selection: unknown): string | undefined {
  if (!object(selection) || selection.phase !== 'ready') return undefined
  // Retained legacy Clients publish selection directly. An explicit absence is authoritative.
  if (Object.hasOwn(selection, 'current')) return typeof selection.current === 'string' && selection.current ? selection.current : undefined
  // Alpha.2 publishes public source-labelled ownership instead. This is the same
  // mainView source used by ui-session; never read uiWorkspace's private selection.
  if (!object(selection.byId)) return undefined
  let selected: string | undefined
  for (const row of Object.values(selection.byId)) {
    if (!object(row) || !object(row.retainedBy)) continue
    const count = row.retainedBy.mainView
    if (count === undefined || count === 0) continue
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0
      || typeof row.id !== 'string' || !row.id || selected !== undefined) return undefined
    selected = row.id
  }
  return selected
}
function selectedWorkspace(sessions: SnapshotSource, workspaces: SnapshotSource): string | undefined {
  try {
    const sessionId = selectedSession(sessions.getSnapshot()), registry = workspaces.getSnapshot()
    if (sessionId === undefined
      || !object(registry) || registry.phase !== 'ready' || registry.state === 'error' || !Array.isArray(registry.items)) return undefined
    let match: string | undefined
    for (const item of registry.items) {
      if (!object(item) || typeof item.workspaceId !== 'string' || !item.workspaceId || !Array.isArray(item.sessionIds)) return undefined
      if (!item.sessionIds.includes(sessionId)) continue
      if (match !== undefined) return undefined // Never choose from ambiguous ownership.
      match = item.workspaceId
    }
    return match
  } catch { return undefined }
}

/** Observe only current membership. Do not call navigation/create or use a recent-workspace fallback. */
export function createCurrentWorkspaceSource(ctx: Context): CurrentWorkspaceSource {
  const listeners = new Set<() => void>()
  let active = true
  let current: { sessions: SnapshotSource; workspaces: SnapshotSource } | undefined
  const notify = () => { if (active) for (const listener of listeners) listener() }
  const injection = ctx.inject(['sessions', 'workspaces'], scope => {
    if (!active) return
    const sessions = listOf(scope.get('sessions')), workspaces = listOf(scope.get('workspaces'))
    if (!sessions || !workspaces) return
    const binding = { sessions, workspaces }
    let stopSessions: (() => void) | undefined, stopWorkspaces: (() => void) | undefined
    try {
      stopSessions = sessions.subscribe(notify)
      stopWorkspaces = workspaces.subscribe(notify)
    } catch { stopSessions?.(); stopWorkspaces?.(); return }
    current = binding
    scope.effect(() => () => {
      stopSessions?.(); stopWorkspaces?.()
      if (current === binding) { current = undefined; notify() }
    })
    notify()
  })
  return {
    getSnapshot: () => active && current ? selectedWorkspace(current.sessions, current.workspaces) : undefined,
    subscribe(listener) {
      if (!active) return () => {}
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    dispose() {
      if (!active) return
      active = false; current = undefined; listeners.clear()
      void injection.dispose()
    },
  }
}
