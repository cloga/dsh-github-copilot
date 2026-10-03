import * as React from 'react'
import { GITHUB_COPILOT_PREVIEW_PROVIDER_ID, GITHUB_COPILOT_PROVIDER_ID } from './copilot-identity.ts'
import type { AutoModelPreference } from './copilot-identity.ts'
import { TURN_MODEL_PROVENANCE_KEY, isTurnModelProvenance, turnModelProvenanceDefinition } from './turn-model-provenance.ts'
import { TurnSelectionCard } from './turn-selection-card.ts'
import { TurnSelectionSchema } from './turn-selection.ts'
import type { TurnSelection } from './turn-selection.ts'

export const AUTO_MODEL_ATTRIBUTION_KEY = 'github-copilot-auto-model-attribution'
const SLOT = 'conversation.chat.assistant-actions'
type Dispose = () => void
const noop: Dispose = () => {}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function sequence(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

export interface AutoModelAttribution {
  readonly provider: string
  readonly model: string
  readonly preference?: AutoModelPreference
  readonly taskClass: 'fast' | 'balanced' | 'strong'
  readonly reason: 'short-text-turn' | 'standard-turn' | 'large-structured-turn' | 'image-capability'
  readonly candidateCount: number
  readonly fittingCandidateCount?: number
  readonly estimatedInputTokens?: number
  readonly selectedInputBudget?: number
  readonly inputFitDiagnostic?: 'fitting-candidate-selected' | 'compaction-eligible' | 'compaction-unavailable' | 'attempted-but-still-oversized' | 'fixed-content-cannot-fit'
}

interface AttributionState {
  readonly turn: number
  readonly value: AutoModelAttribution
}

function attribution(event: unknown): AttributionState | undefined {
  if (!record(event) || event.type !== 'github-copilot/auto-model-decision' || !record(event.data)
    || !sequence(event.data.turn) || event.data.provider !== GITHUB_COPILOT_PREVIEW_PROVIDER_ID
    || typeof event.data.model !== 'string' || event.data.model.trim() === ''
    || !['fast', 'balanced', 'strong'].includes(String(event.data.taskClass))
    || event.data.preference !== undefined && !['efficiency', 'balance', 'intelligence'].includes(String(event.data.preference))
    || !['short-text-turn', 'standard-turn', 'large-structured-turn', 'image-capability'].includes(String(event.data.reason))
    || !sequence(event.data.candidateCount) || event.data.candidateCount < 1) return undefined
  return {
    turn: event.data.turn,
    value: {
      provider: event.data.provider,
      model: event.data.model,
      ...event.data.preference === undefined ? {} : { preference: event.data.preference as AutoModelPreference },
      taskClass: event.data.taskClass as AutoModelAttribution['taskClass'],
      reason: event.data.reason as AutoModelAttribution['reason'],
      candidateCount: event.data.candidateCount,
      ...sequence(event.data.fittingCandidateCount) ? { fittingCandidateCount: event.data.fittingCandidateCount } : {},
      ...sequence(event.data.estimatedInputTokens) ? { estimatedInputTokens: event.data.estimatedInputTokens } : {},
      ...sequence(event.data.selectedInputBudget) ? { selectedInputBudget: event.data.selectedInputBudget } : {},
      ...typeof event.data.inputFitDiagnostic === 'string' ? { inputFitDiagnostic: event.data.inputFitDiagnostic as AutoModelAttribution['inputFitDiagnostic'] } : {},
    },
  }
}

interface Match { readonly event: unknown }
interface Context {
  readonly state?: AttributionState
  readonly matches: readonly Match[]
}
interface LocationData {
  readonly kind: 'turn'
  readonly turn: number
  readonly key: typeof AUTO_MODEL_ATTRIBUTION_KEY
  readonly value: AutoModelAttribution
}

export const autoModelAttributionDefinition = {
  kind: AUTO_MODEL_ATTRIBUTION_KEY,
  match(event: unknown): { id: string; role: 'start' } | null {
    const parsed = attribution(event)
    return parsed === undefined ? null : { id: String(parsed.turn), role: 'start' }
  },
  start(_context: Context, match: Match): AttributionState {
    const parsed = attribution(match.event)
    if (parsed === undefined) throw new Error('COPILOT_AUTO_ATTRIBUTION_START')
    return parsed
  },
  update(context: Context & { readonly state: AttributionState }): AttributionState {
    return context.state
  },
  buildLocationData(context: Context, scope: string, previous: LocationData | null): LocationData | null {
    if (scope !== 'turn') return null
    const state = context.state ?? context.matches.map(match => attribution(match.event)).find(value => value !== undefined)
    if (state === undefined) return null
    if (previous?.turn === state.turn && previous.key === AUTO_MODEL_ATTRIBUTION_KEY
      && previous.value.provider === state.value.provider && previous.value.model === state.value.model
      && previous.value.reason === state.value.reason && previous.value.taskClass === state.value.taskClass
      && previous.value.preference === state.value.preference
      && previous.value.candidateCount === state.value.candidateCount
      && previous.value.fittingCandidateCount === state.value.fittingCandidateCount
      && previous.value.inputFitDiagnostic === state.value.inputFitDiagnostic) return previous
    return { kind: 'turn', turn: state.turn, key: AUTO_MODEL_ATTRIBUTION_KEY, value: state.value }
  },
}

interface Source {
  getSnapshot(): unknown
  subscribe(listener: () => void): Dispose
}
const missingSource: Source = { getSnapshot: () => undefined, subscribe: () => noop }

function sourceOf(props: Record<string, unknown>, key: string, diagnostic: (code: string) => void): Source {
  const turn = props.turn
  if (!record(turn) || !record(turn.data) || typeof turn.data.source !== 'function') return missingSource
  try {
    const source: unknown = turn.data.source(key)
    return record(source) && typeof source.getSnapshot === 'function' && typeof source.subscribe === 'function'
      ? source as unknown as Source : missingSource
  } catch {
    diagnostic('COPILOT_TURN_SELECTION_PROJECTION_FAILED')
    return missingSource
  }
}

interface SelectionRemote { get(agentId: string, turn: number): Promise<{ ok: boolean; value?: unknown }> }
interface LocaleReader { getLocale(): { active: string }; subscribe(listener: () => void): Dispose }
function iterable(value: unknown): value is Iterable<unknown> {
  return value !== null && typeof value === 'object' && Symbol.iterator in value && typeof value[Symbol.iterator] === 'function'
}
function findTail(snapshot: unknown, messageId: unknown, diagnostic: (code: string) => void): Record<string, unknown> | undefined {
  if (typeof messageId !== 'string') return undefined
  if (!record(snapshot) || !record(snapshot.nodes) || typeof snapshot.nodes.values !== 'function') {
    diagnostic('COPILOT_TURN_SELECTION_CHAT_NODES_UNAVAILABLE')
    return undefined
  }
  const nodes: unknown = snapshot.nodes.values()
  if (!iterable(nodes)) {
    diagnostic('COPILOT_TURN_SELECTION_CHAT_NODES_UNAVAILABLE')
    return undefined
  }
  for (const node of nodes) {
    if (!record(node) || node.kind !== 'turn-tail' || !record(node.data) || !record(node.data.closing)) continue
    const closing = node.data.closing
    if (record(closing.finalNode) && closing.finalNode.messageId === messageId && record(node.location)) return node
  }
  return undefined
}

function Attribution(props: Record<string, unknown> & { remote?: SelectionRemote; locale?: LocaleReader; diagnostic: (code: string) => void }): React.ReactElement | null {
  const [live, setLive] = React.useState<TurnSelection>({ mode: 'unknown' })
  const [readState, setReadState] = React.useState<'loading' | 'ready' | 'failed'>('loading')
  const [readAttempt, setReadAttempt] = React.useState(0)
  const turn = record(props.turn) && sequence(props.turn.turn) ? props.turn.turn : undefined
  const sessionId = typeof props.sessionId === 'string' ? props.sessionId : undefined
  React.useEffect(() => {
    setLive({ mode: 'unknown' })
    if (turn === undefined || sessionId === undefined || props.remote === undefined) {
      setReadState('failed')
      return
    }
    setReadState('loading')
    let active = true
    void props.remote.get(sessionId, turn).then(result => {
      if (!active) return
      const parsed = result.ok ? TurnSelectionSchema.safeParse(result.value) : undefined
      if (parsed?.success) { setLive(parsed.data); setReadState('ready') }
      else { setReadState('failed'); props.diagnostic('COPILOT_TURN_SELECTION_READ_FAILED') }
    }, () => { if (active) { setReadState('failed'); props.diagnostic('COPILOT_TURN_SELECTION_READ_FAILED') } })
    return () => { active = false }
  }, [props.remote, sessionId, turn, props.diagnostic, readAttempt])
  const language = React.useSyncExternalStore(
    props.locale ? listener => props.locale!.subscribe(listener) : () => noop,
    () => props.locale?.getLocale().active ?? 'en', () => 'en',
  )
  const source = sourceOf(props, AUTO_MODEL_ATTRIBUTION_KEY, props.diagnostic)
  const value = React.useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot)
  const provenanceSource = sourceOf(props, TURN_MODEL_PROVENANCE_KEY, props.diagnostic)
  const provenance = React.useSyncExternalStore(provenanceSource.subscribe, provenanceSource.getSnapshot, provenanceSource.getSnapshot)
  const parsed = attribution({ type: 'github-copilot/auto-model-decision', data: { ...record(value) ? value : {}, turn: 0 } })?.value
  const evidence = isTurnModelProvenance(provenance) ? provenance : undefined
  const native = record(props.tail) && record(props.tail.data) ? props.tail.data : undefined
  const nativeCompleted = native?.turn === turn && sequence(native?.seq)
  if (evidence?.ended !== true && !nativeCompleted) return null
  if (evidence === undefined) props.diagnostic('COPILOT_TURN_SELECTION_PROVENANCE_UNAVAILABLE')
  const nativeRoutes = nativeCompleted && record(native?.tokenUsage) && Array.isArray(native.tokenUsage.routes)
    ? native.tokenUsage.routes : []
  const routes: readonly unknown[] = evidence?.routes ?? nativeRoutes
  const copilot = routes.some(route => record(route)
    && (route.provider === GITHUB_COPILOT_PREVIEW_PROVIDER_ID || route.provider === GITHUB_COPILOT_PROVIDER_ID)
    && typeof route.model === 'string' && route.model.trim() !== '')
  if (!copilot && parsed === undefined && live.mode === 'unknown') return null
  const selection: TurnSelection = live.mode !== 'unknown' ? live : parsed?.preference ? {
    mode: 'auto', preference: parsed.preference, reason: parsed.reason,
    candidateCount: parsed.candidateCount, fittingCandidateCount: parsed.fittingCandidateCount,
  } : { mode: 'unknown' }
  return React.createElement(TurnSelectionCard, { selection, locale: language, incomplete: evidence?.incomplete ?? true,
    readState: selection.mode === 'unknown' ? readState : 'ready',
    retry: props.remote === undefined ? undefined : () => setReadAttempt(value => value + 1) })
}

interface Slots {
  spec(name: string): { kind: string; scope: string } | undefined
  inject(name: string, setup: () => Dispose): Dispose
  register(options: { name: string; id: string; order: number }, component: React.ComponentType<Record<string, unknown>>): Dispose
}

interface ConversationEvents {
  register(definition: typeof autoModelAttributionDefinition | typeof turnModelProvenanceDefinition): Dispose
}

export function installAutoModelProjections(capabilities: {
  readonly uiConversation: unknown
  readonly diagnostic: (code: string) => void
}): Dispose {
  if (!record(capabilities.uiConversation) || !record(capabilities.uiConversation.events)
    || typeof capabilities.uiConversation.events.register !== 'function') {
    capabilities.diagnostic('COPILOT_AUTO_PROJECTIONS_UNAVAILABLE')
    return noop
  }
  const events = capabilities.uiConversation.events as unknown as ConversationEvents
  let removeDefinition: Dispose = noop
  let removeProvenance: Dispose = noop
  try {
    removeDefinition = events.register(autoModelAttributionDefinition)
    removeProvenance = events.register(turnModelProvenanceDefinition)
  } catch {
    removeProvenance()
    removeDefinition()
    capabilities.diagnostic('COPILOT_AUTO_PROJECTIONS_FAILED')
    return noop
  }
  return () => { removeProvenance(); removeDefinition() }
}

export function installAutoModelPresentation(capabilities: {
  readonly slots: unknown
  readonly uiConversation?: unknown
  readonly diagnostic: (code: string) => void
  readonly remote?: unknown
  readonly locale?: unknown
}): Dispose {
  const diagnosed = new Set<string>()
  const diagnostic = (code: string) => {
    if (!diagnosed.has(code)) { diagnosed.add(code); capabilities.diagnostic(code) }
  }
  const slotsCandidate = capabilities.slots
  if (!record(slotsCandidate) || !['spec', 'inject', 'register'].every(key => typeof slotsCandidate[key] === 'function')) {
    diagnostic('COPILOT_AUTO_PRESENTATION_UNAVAILABLE')
    return noop
  }
  const slots = slotsCandidate as unknown as Slots
  const face = record(capabilities.remote) ? capabilities.remote.githubCopilotTurnSelection : undefined
  const remote = record(face) && typeof face.get === 'function' ? face as unknown as SelectionRemote : undefined
  const locale = record(capabilities.locale) && typeof capabilities.locale.getLocale === 'function'
    && typeof capabilities.locale.subscribe === 'function' ? capabilities.locale as unknown as LocaleReader : undefined
  if (!remote) diagnostic('COPILOT_TURN_SELECTION_REMOTE_UNAVAILABLE')
  function Entry(props: Record<string, unknown>): React.ReactElement | null {
    if (typeof props.useChat !== 'function') {
      diagnostic('COPILOT_TURN_SELECTION_CHAT_RUNTIME_UNAVAILABLE')
      return null
    }
    const useChat = props.useChat as (selector: (snapshot: unknown) => unknown) => unknown
    const tail = useChat(snapshot => findTail(snapshot, props.messageId, diagnostic))
    const turn = record(tail) && record(tail.location) ? tail.location.turn : undefined
    if (!record(turn) || !sequence(turn.turn)) return null
    return React.createElement(Attribution, { ...props, key: `${props.sessionId}:${turn.turn}`, turn, tail, remote, locale, diagnostic })
  }
  const removeProjections = capabilities.uiConversation === undefined ? noop
    : installAutoModelProjections({ uiConversation: capabilities.uiConversation, diagnostic })
  let removeInjection: Dispose = noop
  try {
    removeInjection = slots.inject(SLOT, () => {
      if (slots.spec(SLOT)?.kind !== 'list' || slots.spec(SLOT)?.scope !== 'session') {
        diagnostic('COPILOT_AUTO_ACTIONS_SLOT_UNAVAILABLE')
        return noop
      }
      return slots.register({ name: SLOT, id: 'github-copilot-auto-model', order: 20 }, Entry)
    })
  } catch {
    removeInjection()
    removeProjections()
    diagnostic('COPILOT_AUTO_PRESENTATION_FAILED')
    return noop
  }
  return () => {
    removeInjection()
    removeProjections()
  }
}
