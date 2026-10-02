import { z } from 'zod'
import type { Context } from '@deepseek-ai/cordis'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { isZeroContextUsage } from './context-usage-guard.ts'

export const COPILOT_CONTEXT_EVIDENCE = 'githubCopilotContextEvidence'
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const routeSchema = z.object({ provider: z.string().min(1), model: z.string().min(1) }).strict()
const sampleSchema = z.object({ tokens: count, seq: count, route: routeSchema }).strict()
export const ContextEvidenceSchema = z.object({
  route: routeSchema.nullable(),
  sample: sampleSchema.nullable(),
  invalid: z.boolean(),
  reason: z.enum(['none', 'failed-zero', 'compaction', 'selection', 'unknown']),
}).strict()
export type ContextEvidence = z.infer<typeof ContextEvidenceSchema>
// Core augments its own Zod copy; keep strict schemas owned by this plugin.
type ContextEvidenceDefinition = Omit<ProjectionDefinition<typeof COPILOT_CONTEXT_EVIDENCE>, 'stateSchema' | 'wire'> & {
  stateSchema: typeof ContextEvidenceSchema & Pick<ProjectionDefinition<typeof COPILOT_CONTEXT_EVIDENCE>['stateSchema'], 'parse'>
  wire: Omit<NonNullable<ProjectionDefinition<typeof COPILOT_CONTEXT_EVIDENCE>['wire']>, 'viewSchema'> & {
    viewSchema: typeof ContextEvidenceSchema & Pick<NonNullable<ProjectionDefinition<typeof COPILOT_CONTEXT_EVIDENCE>['wire']>['viewSchema'], 'parse'>
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
  return { route: null, sample: null, invalid: false, reason: 'none' }
}

/** Read only counts and routing leaves; never message content or opaque replay. */
export function foldContextEvidence(state: ContextEvidence, event: unknown): ContextEvidence {
  if (!record(event) || typeof event.type !== 'string' || !record(event.data)) return state
  if (event.type === 'request/header' || event.type === 'model/selection') {
    const raw = event.type === 'request/header'
      ? (record(event.data.header) ? event.data.header.config : undefined) : event.data
    if (!record(raw)) return { ...state, route: null, sample: null, invalid: true, reason: 'unknown' }
    const parsed = routeSchema.safeParse({ provider: raw.provider, model: raw.model })
    if (!parsed.success) return { ...state, route: null, sample: null, invalid: true, reason: 'unknown' }
    const route = parsed.data
    if (sameRoute(state.route, route)) return state
    return { ...state, route, sample: null, reason: 'selection' }
  }
  if (event.type.startsWith('compaction/') || event.surfaceOp !== undefined && event.surfaceOp !== 'append') {
    if (state.sample === null) return state
    return { ...state, sample: null, reason: 'compaction' }
  }
  if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt') return state
  if (!copilot(state.route)) return state
  if (event.type === 'assistant/message' && event.data.source !== undefined) {
    const source = event.data.source
    const parsed = routeSchema.safeParse(record(source) ? { provider: source.provider, model: source.model } : source)
    if (!parsed.success || !sameRoute(state.route, parsed.data)) {
      return { ...state, sample: null, invalid: true, reason: 'unknown' }
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
  if (usage === undefined) return state
  const parsed = usageSchema.safeParse(usage)
  if (!parsed.success || !count.safeParse(event.seq).success) {
    return { ...state, sample: null, invalid: true, reason: 'unknown' }
  }
  const value = parsed.data
  const zero = isZeroContextUsage(value)
  const successful = record(terminal)
    && (terminal.kind === 'stop' || terminal.kind === 'max-tokens' || terminal.kind === 'tool-calls')
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
  stateVersion: 1,
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
