import { z } from 'zod'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { Context } from '@deepseek-ai/cordis'

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
type Definition = Omit<ProjectionDefinition<typeof TURN_REQUEST_MODELS, State>, 'stateSchema'> & {
  stateSchema: typeof TurnRequestModelsStateSchema
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
const validCount = (value: unknown): value is number => count.safeParse(value).success
function uncertain(state: State): State {
  return { active: null, turns: state.turns.map(row => row.turn === state.active?.turn
    ? { ...row, routes: [], incomplete: true } : row) }
}
export function foldTurnRequestModels(state: State, event: unknown): State {
  if (!record(event)) return state
  const lifecycle = ['turn/start', 'turn/end', 'step/start', 'step/end'].includes(String(event.type))
  if (!record(event.data)) return lifecycle || event.type === 'request/header' ? uncertain(state) : state
  const data = event.data
  if (lifecycle
    && (!validCount(data.turn) || event.type !== 'turn/start' && state.active !== null && data.turn !== state.active.turn
      || String(event.type).startsWith('step/') && !validCount(data.step)
      || event.type === 'step/start' && state.active?.step != null
      || event.type === 'step/end' && state.active !== null && data.step !== state.active.step)) return uncertain(state)
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
} satisfies Definition

export function installTurnRequestModels(ctx: Context): void {
  ctx.inject(['sessionProjections'], scope => {
    const registry: unknown = scope.get('sessionProjections')
    if (!record(registry) || typeof registry.register !== 'function') {
      scope.logger.warn('[github-copilot] COPILOT_TURN_REQUEST_PROJECTION_UNAVAILABLE')
      return
    }
    const remove: unknown = registry.register(turnRequestModelsDefinition)
    if (typeof remove !== 'function') throw new Error('COPILOT_TURN_REQUEST_PROJECTION_DISPOSER_UNAVAILABLE')
    return () => { remove() }
  })
}
