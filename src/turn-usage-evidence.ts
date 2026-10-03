export const TURN_USAGE_EVIDENCE_KEY = 'github-copilot-turn-usage-evidence'

export interface TurnUsageEvidence {
  readonly ended: boolean
  readonly hasStart: boolean
  readonly localPreDispatchBlocks: number
  readonly unreportedAttempts: number
}
interface State { readonly turn: number; readonly value: TurnUsageEvidence }
interface Match { readonly event: unknown }
interface Context { readonly state?: State; readonly matches: readonly Match[] }
interface LocationData {
  readonly kind: 'turn'
  readonly turn: number
  readonly key: typeof TURN_USAGE_EVIDENCE_KEY
  readonly value: TurnUsageEvidence
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function count(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}
export function isTurnUsageEvidence(value: unknown): value is TurnUsageEvidence {
  return record(value) && typeof value.ended === 'boolean' && typeof value.hasStart === 'boolean'
    && count(value.localPreDispatchBlocks) && count(value.unreportedAttempts)
}
function coordinates(event: unknown): { turn: number; type: string; data: Record<string, unknown> } | undefined {
  if (!record(event) || typeof event.type !== 'string' || !record(event.data) || !count(event.data.turn)
    || !['turn/start', 'turn/end', 'assistant/message', 'assistant/attempt'].includes(event.type)) return undefined
  if (event.type === 'assistant/message' && event.surfaceOp !== 'append') return undefined
  return { turn: event.data.turn, type: event.type, data: event.data }
}
function unreported(type: string, data: Record<string, unknown>): boolean {
  if (type === 'assistant/message' && data.usage !== undefined) return false
  return !Array.isArray(data.stream) || !data.stream.some(entry =>
    record(entry) && entry.type === 'chunk' && record(entry.chunk) && entry.chunk.type === 'usage' && entry.chunk.usage !== undefined)
}
/** Recognize only our recorded finish-only diagnostic; never infer dispatch from a generic error. */
function localBlock(data: Record<string, unknown>): boolean {
  if (!Array.isArray(data.stream) || data.stream.length !== 1) return false
  const entry = data.stream[0]
  if (!record(entry) || entry.type !== 'chunk' || !record(entry.chunk) || entry.chunk.type !== 'finish'
    || !record(entry.chunk.reason) || entry.chunk.reason.kind !== 'error' || !record(entry.chunk.reason.failure)) return false
  const failure = entry.chunk.reason.failure
  if (failure.code !== 'CONTEXT_WINDOW_EXCEEDED' || typeof failure.message !== 'string' || failure.message.length > 256) return false
  const match = /^Copilot local estimated input budget exceeded \((\d+) estimated tokens > (\d+) budget tokens\); requesting stock compaction before provider dispatch\.$/.exec(failure.message)
  if (!match) return false
  const estimate = Number(match[1]), budget = Number(match[2])
  return count(estimate) && count(budget) && budget > 0 && estimate > budget
}
function fold(state: State | undefined, event: unknown): State | undefined {
  const parsed = coordinates(event)
  if (!parsed || state !== undefined && state.turn !== parsed.turn) return state
  const value = state?.value ?? { ended: false, hasStart: false, localPreDispatchBlocks: 0, unreportedAttempts: 0 }
  const missing = (parsed.type === 'assistant/message' || parsed.type === 'assistant/attempt') && unreported(parsed.type, parsed.data)
  const local = missing && parsed.type === 'assistant/attempt' && localBlock(parsed.data)
  return {
    turn: parsed.turn,
    value: {
      ended: value.ended || parsed.type === 'turn/end',
      hasStart: value.hasStart || parsed.type === 'turn/start',
      localPreDispatchBlocks: Math.min(Number.MAX_SAFE_INTEGER, value.localPreDispatchBlocks + (local ? 1 : 0)),
      unreportedAttempts: Math.min(Number.MAX_SAFE_INTEGER, value.unreportedAttempts + (missing && !local ? 1 : 0)),
    },
  }
}

export interface TurnUsageDiagnostic {
  readonly localPreDispatchBlocks: number
  readonly unreportedAttempts: number
  readonly incompleteHistory: boolean
}

/** Native completed-tail evidence gates the notice; native totals are never replaced. */
export function turnUsageDiagnostic(
  turn: number, tail: unknown, evidence: unknown, copilot: boolean,
): TurnUsageDiagnostic | undefined {
  if (!count(turn) || !record(tail) || tail.turn !== turn || !count(tail.seq)
    || tail.tokenUsage !== undefined) return undefined
  const parsed = isTurnUsageEvidence(evidence) && evidence.ended ? evidence : undefined
  if (!copilot && (parsed?.localPreDispatchBlocks ?? 0) === 0) return undefined
  return {
    localPreDispatchBlocks: parsed?.localPreDispatchBlocks ?? 0,
    unreportedAttempts: parsed?.unreportedAttempts ?? 0,
    incompleteHistory: parsed?.hasStart !== true,
  }
}

/** Diagnostic event counts only, not a competing usage total or billing projection. */
export const turnUsageEvidenceDefinition = {
  kind: TURN_USAGE_EVIDENCE_KEY,
  match(event: unknown): { id: string; role: 'start' | 'update' } | null {
    const parsed = coordinates(event)
    return parsed ? { id: String(parsed.turn), role: parsed.type === 'turn/start' ? 'start' : 'update' } : null
  },
  start(_context: Context, match: Match): State {
    const state = fold(undefined, match.event)
    if (!state) throw new Error('COPILOT_TURN_USAGE_EVIDENCE_START')
    return state
  },
  update(context: Context & { readonly state: State }, match: Match): State {
    return fold(context.state, match.event) ?? context.state
  },
  buildLocationData(context: Context, scope: string, previous: LocationData | null): LocationData | null {
    if (scope !== 'turn') return null
    const state = context.state ?? context.matches.reduce<State | undefined>((state, match) => fold(state, match.event), undefined)
    if (!state) return null
    const value = state.value
    if (previous?.turn === state.turn && previous.value.ended === value.ended
      && previous.value.hasStart === value.hasStart && previous.value.localPreDispatchBlocks === value.localPreDispatchBlocks
      && previous.value.unreportedAttempts === value.unreportedAttempts) return previous
    return { kind: 'turn', turn: state.turn, key: TURN_USAGE_EVIDENCE_KEY, value }
  },
}
