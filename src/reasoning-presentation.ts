import * as React from 'react'
import { GITHUB_COPILOT_PROVIDER_ID, GITHUB_COPILOT_PREVIEW_PROVIDER_ID } from './copilot-identity.ts'

/** Plugin-owned, Step-scoped provenance; never a model route or durable message. */
export const ASSISTANT_ORIGIN_KEY = 'github-copilot-assistant-origin'
const CHAT_NODE_SLOT = 'conversation.chat.node'
const ASSISTANT_KEY = 'assistant-step'
type Dispose = () => void
const noop: Dispose = () => {}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function sequence(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

export interface AssistantOrigin {
  readonly seq: number
  readonly provider: string
  readonly model: string
}

interface OriginState {
  readonly turn: number
  readonly step: number
  readonly origin: AssistantOrigin | undefined
}

interface OriginMatch {
  readonly event: unknown
}

interface OriginContext {
  readonly state?: OriginState | undefined
  readonly matches: readonly OriginMatch[]
}

interface OriginLocationData {
  readonly kind: 'step'
  readonly turn: number
  readonly step: number
  readonly key: typeof ASSISTANT_ORIGIN_KEY
  readonly value: AssistantOrigin
}

function eventLocation(event: unknown): { turn: number; step: number } | undefined {
  if (!record(event) || !record(event.data)) return undefined
  const { turn, step } = event.data
  return sequence(turn) && sequence(step) ? { turn, step } : undefined
}

function messageOrigin(event: unknown): AssistantOrigin | undefined {
  if (!record(event) || event.type !== 'assistant/message' || event.surfaceOp !== 'append'
    || !sequence(event.seq) || !record(event.data) || !record(event.data.message)) return undefined
  const source = event.data.message.source
  if (!record(source) || typeof source.provider !== 'string' || source.provider.trim() === ''
    || typeof source.model !== 'string' || source.model.trim() === '') return undefined
  // Read only provenance leaves. In particular, do not touch content or replayState.
  return { seq: event.seq, provider: source.provider, model: source.model }
}

/** Targetless Definition: registration rebuilds existing bindings, including cold history. */
export const assistantOriginDefinition = {
  kind: ASSISTANT_ORIGIN_KEY,
  match(event: unknown): { id: string; role: 'start' | 'update' } | null {
    if (!record(event)) return null
    const location = eventLocation(event)
    if (location === undefined) return null
    if (event.type === 'step/start') return { id: `${location.turn}:${location.step}`, role: 'start' }
    if (event.type === 'assistant/message' && event.surfaceOp === 'append') {
      return { id: `${location.turn}:${location.step}`, role: 'update' }
    }
    return null
  },
  start(_context: OriginContext, match: OriginMatch): OriginState {
    const location = eventLocation(match.event)
    if (location === undefined || !record(match.event) || match.event.type !== 'step/start') {
      throw new Error('COPILOT_REASONING_ORIGIN_START: expected step/start')
    }
    return { ...location, origin: undefined }
  },
  update(context: OriginContext & { readonly state: OriginState }, match: OriginMatch): OriginState {
    if (!record(match.event) || match.event.type !== 'assistant/message'
      || match.event.surfaceOp !== 'append') return context.state
    // Missing attribution must clear an earlier reply's origin, not inherit it.
    return { ...context.state, origin: messageOrigin(match.event) }
  },
  buildLocationData(
    context: OriginContext,
    scope: string,
    previous: OriginLocationData | null,
  ): OriginLocationData | null {
    if (scope !== 'step') return null
    let state = context.state
    if (state === undefined) {
      // A paged history window need not contain step/start. Like the native
      // Assistant Definition, derive from accepted matches in log order.
      for (const match of context.matches) {
        const event = match.event
        if (!record(event) || event.type !== 'assistant/message' || event.surfaceOp !== 'append') continue
        const location = eventLocation(event)
        if (location !== undefined) state = { ...location, origin: messageOrigin(event) }
      }
    }
    if (state?.origin === undefined) return null
    const { turn, step, origin } = state
    if (previous?.turn === turn && previous.step === step && previous.key === ASSISTANT_ORIGIN_KEY
      && previous.value.seq === origin.seq && previous.value.provider === origin.provider
      && previous.value.model === origin.model) return previous
    return { kind: 'step', turn, step, key: ASSISTANT_ORIGIN_KEY, value: origin }
  },
}

/** Shallow UI-only projection. Unchanged input retains its exact props identity. */
export function projectReasoningPresentation<Props extends object>(props: Props, origin: unknown): Props {
  if (!record(props) || !record(props.node) || props.node.kind !== ASSISTANT_KEY
    || !record(props.node.data) || !record(origin)) return props
  const node = props.node
  const data = node.data as Record<string, unknown>
  if (data.status !== 'settled' || !record(data.finalNode) || !sequence(data.finalNode.seq)
    || origin.seq !== data.finalNode.seq) return props
  const copilotReply = origin.provider === GITHUB_COPILOT_PROVIDER_ID
    || origin.provider === GITHUB_COPILOT_PREVIEW_PROVIDER_ID
  if (!copilotReply || typeof origin.model !== 'string' || origin.model.trim() === '' || !Array.isArray(data.blocks)) return props
  const blocks = data.blocks.filter((block: unknown) => !(
    record(block) && block.kind === 'reasoning' && typeof block.text === 'string' && block.text.trim() === ''
  ))
  if (blocks.length === data.blocks.length) return props
  // finalNode (including its blocks), Step data, durable messages and replay
  // indexes remain untouched. Only the renderer's local blocks list changes.
  return { ...props, node: { ...node, data: { ...data, blocks } } }
}

interface OriginSource {
  readonly getSnapshot: () => unknown
  readonly subscribe: (listener: () => void) => Dispose
}
const missingOriginSource: OriginSource = { getSnapshot: () => undefined, subscribe: () => noop }

function originSource(props: Record<string, unknown>): OriginSource {
  const node = props.node
  if (!record(node) || !record(node.location) || node.location.kind !== 'step'
    || !record(node.location.step) || !record(node.location.step.data)) return missingOriginSource
  const store = node.location.step.data
  if (typeof store.source !== 'function') return missingOriginSource
  try {
    const source: unknown = store.source(ASSISTANT_ORIGIN_KEY)
    if (!record(source) || typeof source.getSnapshot !== 'function' || typeof source.subscribe !== 'function') {
      return missingOriginSource
    }
    return source as unknown as OriginSource
  } catch {
    // A changed/unsupported Location-data reader must not hide the native row.
    return missingOriginSource
  }
}

interface SlotEntry {
  readonly component: unknown
  readonly options: {
    readonly key?: string
    readonly priority?: number
    readonly id?: unknown
    readonly order?: unknown
    readonly label?: unknown
  }
  readonly locale?: unknown
  readonly inject?: unknown
  readonly store?: unknown
  readonly children?: unknown
  readonly select?: unknown
}

interface Slots {
  entries(name: string): readonly SlotEntry[]
  spec(name: string): { readonly kind: string; readonly scope: string } | undefined
  subscribe(name: string, listener: () => void): Dispose
  inject(name: string, setup: () => Dispose): Dispose
  register(options: { name: string; key: string; priority: number; locale: string }, component: React.ComponentType<Record<string, unknown>>): Dispose
}

interface ConversationEvents {
  register(definition: typeof assistantOriginDefinition): Dispose
}

/**
 * Builtin-compatible rc.1 registration guard, not module-ownership or security
 * proof: the public roster cannot distinguish a deliberately identical foreign
 * registration. The verified rc.1 artifact preserves AssistantNodeView's name;
 * a future renamed/minified implementation fails open rather than being guessed.
 */
function supportedNative(entry: SlotEntry): entry is SlotEntry & { component: React.ComponentType<Record<string, unknown>> } {
  const component = entry.component
  return (entry.options.priority ?? 0) === 0 && entry.locale === 'chat'
    && entry.options.id === undefined && entry.options.order === undefined && entry.options.label === undefined
    && entry.inject === undefined && entry.store === undefined && entry.children === undefined
    && entry.select === undefined && record(component)
    && component.$$typeof === Symbol.for('react.memo') && typeof component.type === 'function'
    && component.type.name === 'AssistantNodeView'
}

export interface ReasoningPresentationCapabilities {
  readonly slots: unknown
  readonly uiConversation: unknown
  /** Receives stable codes only, never message text, model payloads or error bodies. */
  readonly diagnostic: (code: string) => void
}

/**
 * Optional Client enhancement. The caller owns the returned disposer in its
 * dependency-scoped effect; missing older-Core seams leave native UI alone.
 */
export function installReasoningPresentation(capabilities: ReasoningPresentationCapabilities): Dispose {
  const { diagnostic } = capabilities
  const slotsCandidate = capabilities.slots
  const conversation = capabilities.uiConversation
  if (!record(slotsCandidate)
    || !['entries', 'spec', 'subscribe', 'inject', 'register'].every(key => typeof slotsCandidate[key] === 'function')
    || !record(conversation) || !record(conversation.events) || typeof conversation.events.register !== 'function') {
    diagnostic('COPILOT_REASONING_PRESENTATION_UNAVAILABLE')
    return noop
  }
  const slots = slotsCandidate as unknown as Slots
  const events = conversation.events as unknown as ConversationEvents
  let removeOrigin: Dispose = noop
  let removeInjection: Dispose = noop
  let disposed = false
  try {
    removeOrigin = events.register(assistantOriginDefinition)
    removeInjection = slots.inject(CHAT_NODE_SLOT, () => {
      const spec = slots.spec(CHAT_NODE_SLOT)
      if (spec?.kind !== 'keyed' || spec.scope !== 'session') {
        diagnostic('COPILOT_REASONING_SLOT_UNSUPPORTED')
        return noop
      }
      let active = true
      let reconciling = false
      let pending = false
      let native: SlotEntry | undefined
      let failedNative: SlotEntry | undefined
      let wrapper: React.ComponentType<Record<string, unknown>> | undefined
      let unregister: Dispose = noop
      let lastDiagnostic: string | undefined
      const report = (code: string) => {
        if (lastDiagnostic !== code) diagnostic(code)
        lastDiagnostic = code
      }
      const retire = () => {
        const remove = unregister
        unregister = noop
        native = undefined
        // Keep the old wrapper identity until synchronous removal notifications
        // finish, so it cannot be mistaken for a third-party conflict.
        remove()
        wrapper = undefined
      }
      const reconcile = () => {
        if (!active) return
        if (reconciling) { pending = true; return }
        reconciling = true
        try {
          do {
            pending = false
            const roster = slots.entries(CHAT_NODE_SLOT)
            const candidates = roster.filter(entry => entry.options.key === ASSISTANT_KEY && entry.component !== wrapper)
            const next = candidates.length === 1 && supportedNative(candidates[0]!) ? candidates[0] : undefined
            if (next === undefined) {
              retire()
              report(candidates.length > 1 ? 'COPILOT_REASONING_SLOT_CONFLICT' : 'COPILOT_REASONING_NATIVE_UNAVAILABLE')
              continue
            }
            // A failed row is retried only after its native registration changes.
            // Our own unregister notification must not cause an endless retry.
            if (next === failedNative) continue
            if (next === native && roster.some(entry => entry.component === wrapper)) continue
            failedNative = undefined
            retire()
            const delegate = next.component as React.ComponentType<Record<string, unknown>>
            wrapper = function CopilotReasoningPresentation(props: Record<string, unknown>) {
              const source = originSource(props)
              // Always call the hook, including missing-provenance and non-Step paths.
              const origin = React.useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot)
              return React.createElement(delegate, projectReasoningPresentation(props, origin))
            }
            native = next
            unregister = slots.register({ name: CHAT_NODE_SLOT, key: ASSISTANT_KEY, priority: -1, locale: 'chat' }, wrapper)
            lastDiagnostic = undefined
          } while (pending && active)
        } catch {
          failedNative = native
          retire()
          report('COPILOT_REASONING_REGISTRATION_FAILED')
        } finally {
          reconciling = false
        }
      }
      const unsubscribe = slots.subscribe(CHAT_NODE_SLOT, reconcile)
      reconcile()
      return () => {
        active = false
        unsubscribe()
        retire()
      }
    })
  } catch {
    removeInjection()
    removeOrigin()
    diagnostic('COPILOT_REASONING_REGISTRATION_FAILED')
    return noop
  }
  return () => {
    if (disposed) return
    disposed = true
    removeInjection()
    removeOrigin()
  }
}
