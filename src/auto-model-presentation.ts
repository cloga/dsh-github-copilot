import * as React from 'react'
import { GITHUB_COPILOT_PREVIEW_PROVIDER_ID } from './copilot-identity.ts'
import type { AutoModelPreference } from './copilot-identity.ts'

export const AUTO_MODEL_ATTRIBUTION_KEY = 'github-copilot-auto-model-attribution'
const SLOT = 'conversation.chat.turnTail'
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

function sourceOf(props: Record<string, unknown>): Source {
  const turn = props.turn
  if (!record(turn) || !record(turn.data) || typeof turn.data.source !== 'function') return missingSource
  try {
    const source: unknown = turn.data.source(AUTO_MODEL_ATTRIBUTION_KEY)
    return record(source) && typeof source.getSnapshot === 'function' && typeof source.subscribe === 'function'
      ? source as unknown as Source : missingSource
  } catch { return missingSource }
}

/** Inline footer chrome: after the settled clock, hidden until the message is hovered. */
export const AUTO_ATTRIBUTION_STYLE = [
  '[data-turn-tail]:has(> [data-copilot-auto-attribution]){flex-direction:row;flex-wrap:wrap;align-items:center;gap:0 8px}',
  '[data-turn-tail]>[data-copilot-auto-attribution]{order:1;display:inline-flex;align-items:center;gap:6px;margin:0;padding-left:4px;color:var(--dsw-alias-label-tertiary,var(--text-muted,#667085));font-size:14px;line-height:24px;white-space:nowrap}',
  '@media (hover:hover){[data-time-hover-root]>[data-copilot-auto-attribution]{opacity:0;transition:opacity 80ms ease}',
  '[data-time-hover-root]:hover>[data-copilot-auto-attribution],[data-time-hover-root]:focus-within>[data-copilot-auto-attribution]{opacity:1}}',
].join('')
const AUTO_ATTRIBUTION_STYLE_ID = 'dsh-copilot-auto-attribution-style'

function ensureAttributionStyle(): void {
  if (typeof document === 'undefined' || document.getElementById(AUTO_ATTRIBUTION_STYLE_ID)) return
  const style = document.createElement('style')
  style.id = AUTO_ATTRIBUTION_STYLE_ID
  style.textContent = AUTO_ATTRIBUTION_STYLE
  document.head.appendChild(style)
}

function reasonText(value: AutoModelAttribution): string {
  const reason = value.reason === 'short-text-turn' ? 'Short text turn'
    : value.reason === 'large-structured-turn' ? 'Large structured turn'
      : value.reason === 'image-capability' ? 'Image-capable model required' : 'Standard turn'
  const fitInfo = value.fittingCandidateCount !== undefined && value.fittingCandidateCount < value.candidateCount
    ? `; ${value.fittingCandidateCount} of ${value.candidateCount} models can fit turn context`
    : ''
  return `${reason}; ${value.preference ?? 'balance'} capacity preference; selected from ${value.candidateCount} eligible account model${value.candidateCount === 1 ? '' : 's'}${fitInfo}.`
}

function Attribution(props: Record<string, unknown>): React.ReactElement | null {
  const source = sourceOf(props)
  const value = React.useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot)
  const [open, setOpen] = React.useState(false)
  React.useEffect(ensureAttributionStyle, [])
  if (!record(value) || typeof value.model !== 'string' || typeof value.provider !== 'string'
    || !sequence(value.candidateCount)) return null
  const parsed = value as unknown as AutoModelAttribution
  return React.createElement('span', {
    'data-copilot-auto-attribution': '',
  },
  React.createElement('span', null, `Auto${parsed.preference === undefined || parsed.preference === 'balance' ? '' : ` (${parsed.preference})`} · ${parsed.model}`),
  React.createElement('button', {
    type: 'button',
    'aria-label': 'Why this model',
    'aria-expanded': open,
    title: open ? reasonText(parsed) : 'Why this model',
    onClick: () => setOpen(current => !current),
    style: {
      width: 18, height: 18, padding: 0, borderRadius: '50%', border: '1px solid currentColor',
      color: 'inherit', background: 'transparent', cursor: 'pointer', fontSize: 11, lineHeight: '16px',
    },
  }, '?'),
  open ? React.createElement('span', { role: 'status' }, reasonText(parsed)) : null)
}

interface Slots {
  spec(name: string): { kind: string; scope: string } | undefined
  inject(name: string, setup: () => Dispose): Dispose
  register(options: { name: string; id: string; order: number }, component: React.ComponentType<Record<string, unknown>>): Dispose
}

interface ConversationEvents {
  register(definition: typeof autoModelAttributionDefinition): Dispose
}

export function installAutoModelPresentation(capabilities: {
  readonly slots: unknown
  readonly uiConversation: unknown
  readonly diagnostic: (code: string) => void
}): Dispose {
  const { diagnostic } = capabilities
  const slotsCandidate = capabilities.slots
  if (!record(slotsCandidate) || !['spec', 'inject', 'register'].every(key => typeof slotsCandidate[key] === 'function')
    || !record(capabilities.uiConversation) || !record(capabilities.uiConversation.events)
    || typeof capabilities.uiConversation.events.register !== 'function') {
    diagnostic('COPILOT_AUTO_PRESENTATION_UNAVAILABLE')
    return noop
  }
  const slots = slotsCandidate as unknown as Slots
  const events = capabilities.uiConversation.events as unknown as ConversationEvents
  let removeDefinition: Dispose = noop
  let removeInjection: Dispose = noop
  try {
    removeDefinition = events.register(autoModelAttributionDefinition)
    removeInjection = slots.inject(SLOT, () => {
      if (slots.spec(SLOT)?.kind !== 'list' || slots.spec(SLOT)?.scope !== 'session') {
        diagnostic('COPILOT_AUTO_TURN_TAIL_UNAVAILABLE')
        return noop
      }
      return slots.register({ name: SLOT, id: 'github-copilot-auto-model', order: 20 }, Attribution)
    })
  } catch {
    removeInjection()
    removeDefinition()
    diagnostic('COPILOT_AUTO_PRESENTATION_FAILED')
    return noop
  }
  return () => {
    removeInjection()
    removeDefinition()
  }
}
