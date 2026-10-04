import { z } from 'zod'

export const TURN_REQUEST_MODELS = 'githubCopilotTurnRequestModels'
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const route = z.object({ provider: z.string().trim().min(1).max(1024), model: z.string().trim().min(1).max(1024) }).strict()
export const RequestedModelsSchema = z.object({
  routes: z.array(route).max(32), incomplete: z.boolean(),
}).strict()
export type RequestedModels = z.infer<typeof RequestedModelsSchema>
const row = RequestedModelsSchema.extend({ turn: count }).strict()
export const TurnRequestModelsStateSchema = z.object({
  active: z.object({ turn: count, step: count.nullable() }).strict().nullable(),
  turns: z.array(row).max(128),
}).strict()
type State = z.infer<typeof TurnRequestModelsStateSchema>
declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap { githubCopilotTurnRequestModels: State }
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
const validCount = (value: unknown): value is number => count.safeParse(value).success
export function foldTurnRequestModels(state: State, event: unknown): State {
  if (!record(event) || !record(event.data)) return state
  const data = event.data
  if (['turn/start', 'turn/end', 'step/start', 'step/end'].includes(String(event.type))
    && (!validCount(data.turn) || event.type !== 'turn/start' && state.active !== null && data.turn !== state.active.turn
      || String(event.type).startsWith('step/') && !validCount(data.step))) {
    return { active: null, turns: state.turns.map(row => row.turn === state.active?.turn
      ? { ...row, routes: [], incomplete: true } : row) }
  }
  if (event.type === 'turn/start' && validCount(data.turn)) {
    return { active: { turn: data.turn, step: null },
      turns: [...state.turns.filter(row => row.turn !== data.turn), { turn: data.turn, routes: [], incomplete: false }].slice(-128) }
  }
  const active = state.active
  if (!active) return state
  if (event.type === 'step/start' && data.turn === active.turn && validCount(data.step)) {
    return { ...state, active: { ...active, step: data.step } }
  }
  if (event.type === 'step/end' && data.turn === active.turn && data.step === active.step) {
    return { ...state, active: { ...active, step: null } }
  }
  if (event.type === 'turn/end' && data.turn === active.turn) return { ...state, active: null }
  // Native headers have no turn field. Only a recorded open step binds this snapshot.
  if (event.type !== 'request/header' || active.step === null) return state
  const config = record(data.header) ? data.header.config : undefined
  const parsed = route.safeParse(record(config) && ['initial', 'resume', 'change', 'series'].includes(String(data.reason))
    ? { provider: config.provider, model: config.model } : undefined)
  return { ...state, turns: state.turns.map(row => {
    if (row.turn !== active.turn) return row
    if (!parsed.success) return { ...row, routes: [], incomplete: true }
    if (row.incomplete || row.routes.some(value => value.provider === parsed.data.provider && value.model === parsed.data.model)) return row
    if (row.routes.length >= 32) return { ...row, routes: [], incomplete: true }
    return { ...row, routes: [...row.routes, parsed.data] }
  }) }
}
export const turnRequestModelsDefinition = {
  key: TURN_REQUEST_MODELS, stateVersion: 1, stateSchema: TurnRequestModelsStateSchema,
  init: (): State => ({ active: null, turns: [] }),
  apply: foldTurnRequestModels,
}
