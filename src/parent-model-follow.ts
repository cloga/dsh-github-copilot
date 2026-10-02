/** Explicit enrollment, never inferred from equality of parent and child models. */
export interface ParentModelBinding {
  readonly childSessionId: string
  readonly parentSessionId: string
}

export interface FollowSelection {
  readonly provider: string
  readonly model: string
}

export interface FollowState {
  readonly inherited: number
  readonly turn: number | null
  readonly started: boolean
  readonly explicit: FollowSelection | null
  readonly descriptor: boolean
  readonly blocked: boolean
}

interface Event {
  readonly seq: number
  readonly type: string
  readonly data: unknown
}

export const PARENT_MODEL_FOLLOW_PROJECTION = 'githubCopilotParentModelFollow'

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function followSelection(value: unknown): FollowSelection | undefined {
  if (!object(value) || typeof value.provider !== 'string' || !value.provider
    || typeof value.model !== 'string' || !value.model) return undefined
  return { provider: value.provider, model: value.model }
}

export function initialFollowState(inherited = 0): FollowState {
  return { inherited, turn: null, started: false, explicit: null, descriptor: false, blocked: false }
}

/** Fold only the child's own suffix; copied fork selections are not child overrides. */
export function foldFollowState(state: FollowState, event: Event): FollowState {
  if (event.seq < state.inherited) return state
  if (event.type === 'turn/start') {
    if (!object(event.data) || !Number.isSafeInteger(event.data.turn) || Number(event.data.turn) < 0) {
      return { ...state, blocked: true }
    }
    return { ...state, turn: Number(event.data.turn), started: false }
  }
  if (event.type === 'step/start') return { ...state, started: true }
  if (event.type === 'model/selection') {
    const selection = followSelection(event.data)
    return selection ? { ...state, explicit: selection } : { ...state, blocked: true }
  }
  if (event.type === 'github-copilot/dual-model-policy') return { ...state, blocked: true }
  if (event.type === 'subagent/descriptor') {
    const data = event.data
    const valid = object(data) && data.version === 3 && data.provider === 'spawn'
      && (data.mode === 'continuable' || data.mode === 'one-shot')
    return { ...state, descriptor: valid, blocked: state.blocked || !valid || state.descriptor }
  }
  return state
}

export class ParentModelFollowError extends Error {
  readonly code: string
  constructor(code: string) {
    super(code)
    this.code = code
    this.name = 'ParentModelFollowError'
  }
}

export interface FollowSubject {
  readonly id: string
  readonly parentId?: string
  readonly origin?: string
  readonly state: FollowState
  readonly pending: FollowSelection | null
  readonly recorded?: FollowSelection
}

export function supportsParentFollowing(subject: FollowSubject): boolean {
  return !subject.state.blocked && subject.state.descriptor && subject.origin === 'subagent'
}

/** Resolve a new turn's intent without changing any Session, setting or descriptor. */
export function resolveParentModel(
  child: FollowSubject,
  bindings: readonly ParentModelBinding[],
  lookup: (id: string) => FollowSubject | undefined,
  followAll = false,
): FollowSelection | undefined {
  const matches = bindings.filter(binding => binding.childSessionId === child.id)
  const automatic = matches.length === 0
  if (automatic && (!followAll || !supportsParentFollowing(child))) return undefined
  const fail = (code: string): never => { throw new ParentModelFollowError(`COPILOT_PARENT_MODEL_${code}`) }
  if (!automatic && matches.length !== 1) fail('BINDING_INVALID')
  if (!supportsParentFollowing(child)) fail('CHILD_UNSUPPORTED')
  if (!child.parentId || !automatic && child.parentId !== matches[0]?.parentSessionId) fail('LINEAGE_INVALID')
  // Native selection remains authoritative even if it selects the same model.
  if (child.state.explicit !== null) return undefined
  const seen = new Set([child.id])
  let current = child
  while (true) {
    const parentId = current.parentId
    if (!parentId || seen.has(parentId)) return fail('LINEAGE_INVALID')
    seen.add(parentId)
    const parent = lookup(parentId)
    if (!parent) return fail('PARENT_UNAVAILABLE')
    if (parent.state.blocked) {
      if (automatic) return undefined
      fail('PARENT_UNSUPPORTED')
    }
    const parentBindings = bindings.filter(binding => binding.childSessionId === parent.id)
    if (parentBindings.length > 1) fail('BINDING_INVALID')
    const parentFollows = (parentBindings.length === 1 || followAll && supportsParentFollowing(parent))
      && parent.state.explicit === null
    if (parentFollows) {
      if (!parent.state.descriptor || parent.origin !== 'subagent'
        || parentBindings.length === 1 && parent.parentId !== parentBindings[0]?.parentSessionId) fail('LINEAGE_INVALID')
      current = parent
      continue
    }
    const selection = parent.pending ?? parent.recorded
    if (!selection) return fail('SELECTION_UNAVAILABLE')
    if (selection.provider !== 'github-copilot-preview') {
      if (automatic) return undefined
      fail('PROVIDER_UNSUPPORTED')
    }
    return { ...selection }
  }
}
