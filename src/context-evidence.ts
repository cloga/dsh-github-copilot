import { z } from 'zod'
import type { Context } from '@deepseek-ai/cordis'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { isZeroContextUsage } from './context-usage.ts'

export const COPILOT_CONTEXT_EVIDENCE = 'githubCopilotContextEvidence'
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const routeSchema = z.object({ provider: z.string().min(1), model: z.string().min(1) }).strict()
const sampleSchema = z.object({ tokens: count, seq: count, route: routeSchema }).strict()
const stepSchema = z.object({ turn: count, step: count }).strict()
const compactionSchema = z.object({
  id: z.string().min(1).max(256), startSeq: count, endSeq: count.nullable(),
  state: z.enum(['running', 'completed', 'failed', 'unknown']), checkpoint: z.boolean(),
  headerSeq: count.nullable(), requestRoute: routeSchema.nullable(),
  step: stepSchema.nullable(),
  request: z.enum(['idle', 'pending', 'succeeded', 'failed', 'cancelled', 'unknown']),
}).strict()
export const ContextEvidenceSchema = z.object({
  route: routeSchema.nullable(),
  sample: sampleSchema.nullable(),
  invalid: z.boolean(),
  reason: z.enum(['none', 'failed-zero', 'compaction', 'selection', 'unknown']),
  compaction: compactionSchema.nullable().optional(),
  activeStep: stepSchema.nullable().optional(),
}).strict()
export type ContextEvidence = z.infer<typeof ContextEvidenceSchema>
// Registry parsing is unary; optional Zod options/augmentations are copy-local.
type ContextEvidenceParser = {
  parse(value: unknown): ReturnType<ProjectionDefinition<typeof COPILOT_CONTEXT_EVIDENCE>['stateSchema']['parse']>
}
type ContextEvidenceDefinition = Omit<ProjectionDefinition<typeof COPILOT_CONTEXT_EVIDENCE>, 'stateSchema' | 'wire'> & {
  stateSchema: typeof ContextEvidenceSchema & ContextEvidenceParser
  wire: Omit<NonNullable<ProjectionDefinition<typeof COPILOT_CONTEXT_EVIDENCE>['wire']>, 'viewSchema'> & {
    viewSchema: typeof ContextEvidenceSchema & ContextEvidenceParser
  }
}
declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap { githubCopilotContextEvidence: ContextEvidence }
  interface SessionProjectionStateMap { githubCopilotContextEvidence: ContextEvidence }
}
const usageSchema = z.object({
  inputTokens: count, outputTokens: count, cacheReadTokens: count.optional(),
  cacheWriteTokens: count.optional(), totalTokens: count.optional(), reasoningTokens: count.optional(),
})

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function sameRoute(left: ContextEvidence['route'], right: ContextEvidence['route']): boolean {
  return left !== null && right !== null && left.provider === right.provider && left.model === right.model
}
function copilot(route: ContextEvidence['route']): boolean {
  return route?.provider === 'github-copilot' || route?.provider === 'github-copilot-preview'
}
export function initialContextEvidence(): ContextEvidence {
  return { route: null, sample: null, invalid: false, reason: 'none', compaction: null, activeStep: null }
}

/** Read only counts and routing leaves; never message content or opaque replay. */
export function foldContextEvidence(state: ContextEvidence, event: unknown): ContextEvidence {
  if (!record(event) || typeof event.type !== 'string' || !record(event.data)) return state
  if (event.type === 'step/start') {
    const step = stepSchema.safeParse({ turn: event.data.turn, step: event.data.step })
    state = { ...state, activeStep: step.success ? step.data : null }
  }
  if (event.type === 'compaction/start') {
    const id = compactionSchema.shape.id.safeParse(event.data.compactionId)
    const seq = count.safeParse(event.seq)
    return { ...state, sample: null, invalid: true, reason: 'compaction',
      compaction: id.success && seq.success ? {
        id: id.data, startSeq: seq.data, endSeq: null, state: 'running', checkpoint: false,
        headerSeq: null, requestRoute: null, step: null, request: 'idle',
      } : null }
  }
  if (event.type === 'step/start' && state.compaction?.state === 'completed'
    && state.compaction.endSeq !== null && count.safeParse(event.seq).success
    && Number(event.seq) > state.compaction.endSeq) {
    const step = compactionSchema.shape.step.safeParse({ turn: event.data.turn, step: event.data.step })
    return { ...state, compaction: { ...state.compaction, step: step.success ? step.data : null,
      headerSeq: step.success ? count.parse(event.seq) : null, requestRoute: state.route,
      request: step.success && copilot(state.route) ? 'pending' : 'unknown' } }
  }
  if ((event.type === 'step/end' || event.type === 'turn/end') && state.compaction?.request === 'pending'
    && event.data.turn === state.compaction.step?.turn
    && (event.type === 'turn/end' || event.data.step === state.compaction.step?.step)) {
    state = { ...state, compaction: { ...state.compaction, request: 'unknown' } }
  }
  if ((event.type === 'step/end' || event.type === 'turn/end') && event.data.turn === state.activeStep?.turn
    && (event.type === 'turn/end' || event.data.step === state.activeStep?.step)) {
    return { ...state, activeStep: null }
  }
  const operation = state.compaction
  if (operation?.state === 'running' && count.safeParse(event.seq).success && Number(event.seq) > operation.startSeq) {
    if (event.type === 'user/message' && record(event.data.source)
      && event.data.source.kind === 'compact-checkpoint' && event.data.source.compactionId === operation.id) {
      state = { ...state, compaction: { ...operation, checkpoint: true } }
    }
    if (event.type === 'compaction/end' && event.data.compactionId === operation.id) {
      state = { ...state, compaction: { ...operation, endSeq: count.parse(event.seq),
        state: event.data.error !== undefined ? 'failed' : operation.checkpoint ? 'completed' : 'unknown' } }
    }
  }
  if (event.type === 'request/header' || event.type === 'model/selection') {
    const raw = event.type === 'request/header'
      ? (record(event.data.header) ? event.data.header.config : undefined) : event.data
    const revoke = () => state.compaction ? {
      ...state.compaction, headerSeq: null, requestRoute: null, step: null, request: 'unknown' as const,
    } : state.compaction
    if (!record(raw)) return { ...state, route: null, sample: null, invalid: true, reason: 'unknown', compaction: revoke() }
    const parsed = routeSchema.safeParse({ provider: raw.provider, model: raw.model })
    if (!parsed.success) return { ...state, route: null, sample: null, invalid: true, reason: 'unknown', compaction: revoke() }
    const route = parsed.data
    const compact = state.compaction
    if (compact?.state === 'completed') {
      if (event.type === 'request/header' && compact.endSeq !== null
        && count.safeParse(event.seq).success && Number(event.seq) > compact.endSeq && copilot(route)) {
        state = { ...state, compaction: { ...compact, headerSeq: count.parse(event.seq), requestRoute: route,
          step: state.activeStep ?? null, request: 'pending' } }
      } else if (!sameRoute(state.route, route)) state = { ...state, compaction: revoke() }
    }
    if (sameRoute(state.route, route)) return state
    return { ...state, route, sample: null, reason: 'selection' }
  }
  if (event.type.startsWith('compaction/') || event.surfaceOp !== undefined && event.surfaceOp !== 'append') {
    const checkpoint = event.type === 'user/message' && record(event.data.source)
      && event.data.source.kind === 'compact-checkpoint' && event.data.source.compactionId === state.compaction?.id
    return { ...state, sample: null, invalid: true, reason: 'compaction',
      compaction: event.type.startsWith('compaction/') || checkpoint || !state.compaction ? state.compaction
        : { ...state.compaction, request: 'unknown', step: null, headerSeq: null, requestRoute: null } }
  }
  if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt') return state
  if (!copilot(state.route)) return state
  const source = record(event.data.message) ? event.data.message.source : event.data.source
  if (event.type === 'assistant/message' && source !== undefined) {
    const parsed = routeSchema.safeParse(record(source) ? { provider: source.provider, model: source.model } : source)
    if (!parsed.success || !sameRoute(state.route, parsed.data)) {
      return { ...state, sample: null, invalid: true, reason: 'unknown', compaction: state.compaction
        ? { ...state.compaction, request: 'unknown', step: null, headerSeq: null, requestRoute: null } : state.compaction }
    }
  }
  const stream = Array.isArray(event.data.stream) ? event.data.stream : []
  let usage: unknown = event.type === 'assistant/message' ? event.data.usage : undefined
  const settledUsage = usage !== undefined
  let terminal: unknown
  for (const entry of stream) {
    if (!record(entry) || entry.type !== 'chunk' || !record(entry.chunk)) continue
    if (!settledUsage && entry.chunk.type === 'usage') {
      // Match native last-wins usage when no settled message-level value exists.
      usage = entry.chunk.usage
    }
    if (entry.chunk.type === 'finish') terminal = entry.chunk.reason
  }
  const successful = event.data.interrupted !== true && record(terminal)
    && (terminal.kind === 'stop' || terminal.kind === 'max-tokens' || terminal.kind === 'tool-calls')
  const compact = state.compaction
  if (compact?.state === 'completed') {
    if (compact.headerSeq === null || !count.safeParse(event.seq).success || Number(event.seq) <= compact.headerSeq) return state
    if (!sameRoute(compact.requestRoute, state.route)) return state
    if (compact.step === null) return { ...state, compaction: { ...compact, request: 'unknown' } }
    if (event.data.turn !== compact.step.turn || event.data.step !== compact.step.step) return state
    state = { ...state, compaction: { ...compact, request: event.type === 'assistant/message' && successful
      && source !== undefined ? 'succeeded' : record(terminal) && terminal.kind === 'aborted' ? 'cancelled'
        : record(terminal) && terminal.kind === 'error' ? 'failed' : 'unknown' } }
  } else if (compact?.state === 'running') return state
  if (usage === undefined) return state
  const parsed = usageSchema.safeParse(usage)
  if (!parsed.success || !count.safeParse(event.seq).success) {
    return { ...state, sample: null, invalid: true, reason: 'unknown' }
  }
  const value = parsed.data
  const zero = isZeroContextUsage(value)
  if (zero && !successful) {
    const reason = state.sample !== null || state.reason === 'none' ? 'failed-zero' : state.reason
    return { ...state, invalid: true, reason }
  }
  const tokens = value.inputTokens + (value.cacheReadTokens ?? 0) + (value.cacheWriteTokens ?? 0)
  if (!Number.isSafeInteger(tokens) || state.route === null) {
    return { ...state, sample: null, invalid: true, reason: 'unknown' }
  }
  return { ...state, sample: { tokens, seq: count.parse(event.seq), route: state.route }, invalid: false, reason: 'none' }
}

/** Separate bounded replay unit; never register under or modify a Core key. */
export const contextEvidenceDefinition = {
  key: COPILOT_CONTEXT_EVIDENCE,
  stateVersion: 2,
  stateSchema: ContextEvidenceSchema,
  init: initialContextEvidence,
  apply: foldContextEvidence,
  wire: { viewSchema: ContextEvidenceSchema, view: (state: ContextEvidence) => state },
} satisfies ContextEvidenceDefinition

export function installContextEvidence(ctx: Context): void {
  ctx.inject(['sessionProjections'], scope => {
    const registry: unknown = scope.get('sessionProjections')
    if (!record(registry) || typeof registry.register !== 'function') {
      scope.logger.warn('[github-copilot] COPILOT_CONTEXT_PROJECTION_UNAVAILABLE')
      return
    }
    const remove: unknown = registry.register(contextEvidenceDefinition)
    if (typeof remove !== 'function') throw new Error('COPILOT_CONTEXT_PROJECTION_DISPOSER_UNAVAILABLE')
    return () => { remove() }
  })
}
