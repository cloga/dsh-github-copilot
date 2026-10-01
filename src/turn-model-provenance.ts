export const TURN_MODEL_PROVENANCE_KEY = 'github-copilot-turn-model-provenance'

export interface RecordedModel {
  readonly provider: string
  readonly model: string
}

export interface TurnModelProvenance {
  readonly routes: readonly RecordedModel[]
  readonly incomplete: boolean
  readonly ended: boolean
}

interface State {
  readonly turn: number
  readonly hasStart: boolean
  readonly openSteps: readonly number[]
  readonly value: TurnModelProvenance
}
interface Match { readonly event: unknown }
interface Context { readonly state?: State; readonly matches: readonly Match[] }
interface LocationData {
  readonly kind: 'turn'
  readonly turn: number
  readonly key: typeof TURN_MODEL_PROVENANCE_KEY
  readonly value: TurnModelProvenance
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
export function isTurnModelProvenance(value: unknown): value is TurnModelProvenance {
  return record(value) && typeof value.ended === 'boolean' && typeof value.incomplete === 'boolean'
    && Array.isArray(value.routes) && value.routes.every(route => record(route)
      && typeof route.provider === 'string' && route.provider.trim() !== ''
      && typeof route.model === 'string' && route.model.trim() !== '')
}
function coordinates(event: unknown): { turn: number; type: string; data: Record<string, unknown> } | undefined {
  if (!record(event) || typeof event.type !== 'string' || !record(event.data)
    || !Number.isSafeInteger(event.data.turn) || typeof event.data.turn !== 'number' || event.data.turn < 0
    || !['turn/start', 'turn/end', 'step/start', 'step/end', 'assistant/message', 'assistant/attempt', 'llm/retry'].includes(event.type)) return undefined
  if (event.type === 'assistant/message' && event.surfaceOp !== 'append') return undefined
  return { turn: event.data.turn, type: event.type, data: event.data }
}
function fold(state: State | undefined, event: unknown): State | undefined {
  const parsed = coordinates(event)
  if (parsed === undefined || state !== undefined && state.turn !== parsed.turn) return state
  const hasStart = state?.hasStart === true || parsed.type === 'turn/start'
  const routes = state?.value.routes ?? []
  const step = typeof parsed.data.step === 'number' && Number.isSafeInteger(parsed.data.step) ? parsed.data.step : undefined
  let openSteps = state?.openSteps ?? []
  if (parsed.type === 'step/start' && step !== undefined && !openSteps.includes(step)) openSteps = [...openSteps, step]
  const unrecorded = parsed.type === 'turn/end' && openSteps.length > 0
    || parsed.type === 'step/end' && step !== undefined && openSteps.includes(step)
  if (['assistant/message', 'assistant/attempt', 'step/end'].includes(parsed.type)) openSteps = openSteps.filter(value => value !== step)
  let missing = false
  let route: RecordedModel | undefined
  if (parsed.type === 'assistant/message') {
    const source = record(parsed.data.message) ? parsed.data.message.source : undefined
    if (record(source) && typeof source.provider === 'string' && source.provider.trim() !== ''
      && typeof source.model === 'string' && source.model.trim() !== '') {
      route = { provider: source.provider, model: source.model }
    } else missing = true
  }
  return {
    turn: parsed.turn, hasStart, openSteps,
    value: {
      routes: route && !routes.some(value => value.provider === route.provider && value.model === route.model)
        ? [...routes, route] : routes,
      incomplete: state?.value.incomplete === true || missing || unrecorded || parsed.type === 'assistant/attempt' || parsed.type === 'llm/retry',
      ended: state?.value.ended === true || parsed.type === 'turn/end',
    },
  }
}

/** Read provenance only; native Core retains attempt accounting and token totals. */
export const turnModelProvenanceDefinition = {
  kind: TURN_MODEL_PROVENANCE_KEY,
  match(event: unknown): { id: string; role: 'start' | 'update' } | null {
    const parsed = coordinates(event)
    return parsed ? { id: String(parsed.turn), role: parsed.type === 'turn/start' ? 'start' : 'update' } : null
  },
  start(_context: Context, match: Match): State {
    const state = fold(undefined, match.event)
    if (!state) throw new Error('COPILOT_MODEL_PROVENANCE_START')
    return state
  },
  update(context: Context & { readonly state: State }, match: Match): State {
    return fold(context.state, match.event) ?? context.state
  },
  buildLocationData(context: Context, scope: string, previous: LocationData | null): LocationData | null {
    if (scope !== 'turn') return null
    const state = context.state ?? context.matches.reduce<State | undefined>((state, match) => fold(state, match.event), undefined)
    if (!state) return null
    const value = { ...state.value, incomplete: state.value.incomplete || !state.hasStart }
    if (previous?.turn === state.turn && previous.value.ended === value.ended
      && previous.value.incomplete === value.incomplete && previous.value.routes.length === value.routes.length
      && previous.value.routes.every((route, index) => route.provider === value.routes[index]?.provider && route.model === value.routes[index]?.model)) return previous
    return { kind: 'turn', turn: state.turn, key: TURN_MODEL_PROVENANCE_KEY, value }
  },
}
