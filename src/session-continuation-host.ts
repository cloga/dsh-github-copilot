import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { readSettingsNamespace } from './settings-reader.ts'
import { SessionContinuationTurn } from './session-continuation.ts'
import { SessionContinuationPreferencesSchema, ContinuationDefaultHistorySchema } from './session-continuation-types.ts'
import type { SessionContinuationPreference, SessionContinuationView } from './session-continuation-types.ts'
import { installCompactionContinuation } from './compaction-continuation.ts'
import type { CompactionContinuationStatus } from './session-continuation-types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context { githubCopilotSessionContinuation: SessionContinuationController }
}
interface Admission {
  readonly turn: number
  readonly enabled: boolean
  readonly persistentEnabled: boolean
  readonly filter: SessionContinuationTurn
  step: number
  signal: AbortSignal
}
function preferences(value: unknown): readonly SessionContinuationPreference[] {
  if (typeof value !== 'object' || value === null) throw new Error('COPILOT_CONTINUATION_SETTINGS_UNAVAILABLE')
  const raw = 'sessionContinuation' in value ? value.sessionContinuation : []
  const parsed = SessionContinuationPreferencesSchema.safeParse(raw)
  if (!parsed.success) throw new Error('COPILOT_CONTINUATION_SETTINGS_INVALID')
  return parsed.data
}
export class SessionContinuationController extends TypertRemoteService {
  constructor(ctx: Context, private readonly active: Map<object, Admission>,
    private readonly once = new Set<object>(), private readonly ready: Promise<void> = Promise.resolve(),
    private readonly summaryStatus: (agent: Agent) => CompactionContinuationStatus | undefined = () => undefined) {
    super(ctx, 'githubCopilotSessionContinuation')
  }
  @Remote
  async get(agent: Agent): Promise<SessionContinuationView> {
    await this.ready
    const entry = this.ctx.get('settings')?.describe({ redactSecrets: true }).find(row => row.ns === 'github-copilot')
    if (!entry) throw new Error('COPILOT_CONTINUATION_SETTINGS_UNAVAILABLE')
    const admission = this.active.get(agent.session)
    const explicit = preferences(entry.value).find(row => row.sessionId === agent.session.id)
    const compaction = this.summaryStatus(agent)
    return { enabled: resolveEnabled(agent, entry.value), source: explicit ? 'session' : 'default',
      nextTurnAuthorized: this.once.has(agent.session), revision: entry.revision,
      ...admission ? { activeTurnEnabled: admission.enabled } : {},
      ...compaction ? { compaction } : {} }
  }
  @Remote
  async set(agent: Agent, revision: number, enabled: boolean | null): Promise<SessionContinuationView> {
    await this.ready
    const settings = this.ctx.get('settings')
    const entry = settings?.describe({ redactSecrets: true }).find(row => row.ns === 'github-copilot')
    if (!settings || !entry) throw new Error('COPILOT_CONTINUATION_SETTINGS_UNAVAILABLE')
    if (entry.revision !== revision) throw new Error('COPILOT_CONTINUATION_CONFLICT')
    const previous = preferences(entry.value)
    const next = previous.filter(row => row.sessionId !== agent.session.id)
    if (enabled !== null) next.push({ sessionId: agent.session.id, version: 1, consentedAt: Date.now(), enabled })
    if (!SessionContinuationPreferencesSchema.safeParse(next).success) throw new Error('COPILOT_CONTINUATION_SETTINGS_LIMIT')
    await settings.mutate('github-copilot', [{ op: 'set', path: ['sessionContinuation'], value: next }], revision)
    const actual = await this.get(agent)
    if (enabled !== null && actual.enabled !== enabled || enabled === null && actual.source !== 'default')
      throw new Error('COPILOT_CONTINUATION_COMMIT_UNCERTAIN')
    this.once.delete(agent.session)
    return { ...actual, nextTurnAuthorized: false }
  }
  @Remote
  async authorizeNext(agent: Agent, revision: number, enabled: boolean): Promise<SessionContinuationView> {
    const current = await this.get(agent)
    if (current.revision !== revision) throw new Error('COPILOT_CONTINUATION_CONFLICT')
    if (enabled && !this.once.has(agent.session) && this.once.size >= 2048) throw new Error('COPILOT_CONTINUATION_CONSENT_LIMIT')
    if (enabled) this.once.add(agent.session)
    else this.once.delete(agent.session)
    return this.get(agent)
  }
  @Remote
  async defaults(): Promise<{ enabled: boolean; revision: number }> {
    await this.ready
    const entry = this.ctx.get('settings')?.describe({ redactSecrets: true }).find(row => row.ns === 'github-copilot')
    if (!entry) throw new Error('COPILOT_CONTINUATION_SETTINGS_UNAVAILABLE')
    return { enabled: defaultHistory(entry.value).at(-1)?.enabled ?? false, revision: entry.revision }
  }
  @Remote
  async setDefault(revision: number, enabled: boolean): Promise<{ enabled: boolean; revision: number }> {
    await this.ready
    const settings = this.ctx.get('settings')
    const entry = settings?.describe({ redactSecrets: true }).find(row => row.ns === 'github-copilot')
    if (!settings || !entry) throw new Error('COPILOT_CONTINUATION_SETTINGS_UNAVAILABLE')
    if (entry.revision !== revision) throw new Error('COPILOT_CONTINUATION_CONFLICT')
    const history = defaultHistory(entry.value)
    if ((history.at(-1)?.enabled ?? false) === enabled) return this.defaults()
    const changedAt = Math.max(Date.now(), (history.at(-1)?.changedAt ?? -1) + 1)
    const next = [...history, { enabled, changedAt }]
    if (!ContinuationDefaultHistorySchema.safeParse(next).success) throw new Error('COPILOT_CONTINUATION_SETTINGS_LIMIT')
    await settings.mutate('github-copilot', [{ op: 'set', path: ['continuationDefaultHistory'], value: next }], revision)
    const actual = await this.defaults()
    if (actual.enabled !== enabled) throw new Error('COPILOT_CONTINUATION_COMMIT_UNCERTAIN')
    return actual
  }
}
function defaultHistory(value: unknown) {
  if (typeof value !== 'object' || value === null) throw new Error('COPILOT_CONTINUATION_SETTINGS_UNAVAILABLE')
  const parsed = ContinuationDefaultHistorySchema.safeParse('continuationDefaultHistory' in value ? value.continuationDefaultHistory : [])
  if (!parsed.success) throw new Error('COPILOT_CONTINUATION_SETTINGS_INVALID')
  return parsed.data
}
function resolveEnabled(agent: Agent, value: unknown): boolean {
  const explicit = preferences(value).find(row => row.sessionId === agent.session.id)
  if (explicit) return explicit.enabled ?? true
  const history = defaultHistory(value)
  const header = agent.session.header
  if (!header || header.isSeeded !== false || !Number.isSafeInteger(header.createdAt)) return false
  return history.findLast(row => row.changedAt < header.createdAt)?.enabled ?? false
}
export function installSessionContinuation(ctx: Context): {
  ready: Promise<void>
  prepare(request: GenerateOptions): ((payload: unknown) => Promise<unknown>) | undefined
  dispose(): void
} {
  if (!ctx.get('settings')) {
    ctx.logger.warn('COPILOT_CONTINUATION_SETTINGS_UNAVAILABLE: continuation integration is not active')
    return { ready: Promise.resolve(), prepare: () => undefined, dispose() {} }
  }
  const active = new Map<object, Admission>()
  const once = new Set<object>()
  const requests = new WeakMap<AbortSignal, Agent['session']>()
  let initialized = false
  const ready = (async () => {
    const settings = ctx.get('settings')
    const entry = settings?.describe({ redactSecrets: true }).find(row => row.ns === 'github-copilot')
    if (!settings || !entry) throw new Error('COPILOT_CONTINUATION_SETTINGS_UNAVAILABLE')
    if (defaultHistory(entry.value).length) { initialized = true; return }
    await settings.mutate('github-copilot', [{ op: 'set', path: ['continuationDefaultHistory'],
      value: [{ enabled: true, changedAt: Date.now() }] }], entry.revision)
    const actual = readSettingsNamespace(ctx, 'github-copilot')
    if (!defaultHistory(actual).length) throw new Error('COPILOT_CONTINUATION_COMMIT_UNCERTAIN')
    initialized = true
  })()
  // Keep startup failures observable without creating an unhandled rejection;
  // views and turn admission still await the original, rejecting promise.
  void ready.catch(() => ctx.logger.warn('COPILOT_CONTINUATION_INITIALIZATION_FAILED'))
  const summaries = installCompactionContinuation(ctx, agent => {
    if (!initialized) throw new Error('COPILOT_CONTINUATION_SETTINGS_UNAVAILABLE')
    return active.get(agent.session)?.persistentEnabled ?? resolveEnabled(agent, readSettingsNamespace(ctx, 'github-copilot'))
  })
  new SessionContinuationController(ctx, active, once, ready, agent => summaries.status(agent))
  const removeRequest = ctx.on('agent/request', async ({ agent, turn, step, signal }, next) => {
    const result = await next()
    if (signal.aborted || result.provider !== 'github-copilot-preview') return result
    await ready
    if (signal.aborted) return result
    if (!Number.isSafeInteger(turn) || turn < 0) throw new Error('COPILOT_CONTINUATION_TURN_INVALID')
    let admission = active.get(agent.session)
    if (admission && admission.turn !== turn) throw new Error('COPILOT_CONTINUATION_TURN_UNSETTLED')
    if (!admission) {
      const persistentEnabled = resolveEnabled(agent, readSettingsNamespace(ctx, 'github-copilot'))
      const enabled = persistentEnabled || once.has(agent.session)
      admission = { turn, step, enabled, persistentEnabled, filter: new SessionContinuationTurn(), signal }
      active.set(agent.session, admission)
      once.delete(agent.session)
    }
    admission.signal = signal
    admission.step = step
    requests.set(signal, agent.session)
    return result
  })
  const removeEvents = ctx.on('session/event', (session, event) => {
    if (event.type === 'turn/end' && active.get(session)?.turn === event.data.turn) active.delete(session)
  })
  const removeAgent = ctx.on('agent/disposed', ({ agent }) => { active.delete(agent.session); once.delete(agent.session) })
  let disposed = false
  return {
    ready,
    prepare(request) {
      if (request.purpose === 'compaction') return summaries.prepare(request)
      if (request.provider !== 'github-copilot-preview' || request.purpose !== undefined || !request.signal) return undefined
      const session = requests.get(request.signal)
      const admission = session && active.get(session)
      if (!session || session.id !== request.sessionId || !admission?.enabled) return undefined
      if (!admission.filter.initialized && admission.step !== 1) throw new Error('COPILOT_CONTINUATION_TURN_BOUNDARY_UNAVAILABLE')
      const current = () => !disposed && !request.signal!.aborted && active.get(session) === admission
        && admission.signal === request.signal
      if (!current()) throw new Error('COPILOT_CONTINUATION_REVOKED')
      const assertCurrent = () => {
        if (!current()) throw new Error('COPILOT_CONTINUATION_REVOKED')
      }
      return payload => admission.filter.transform(payload, assertCurrent)
    },
    dispose() { disposed = true; summaries.dispose(); removeRequest(); removeEvents(); removeAgent(); active.clear(); once.clear() },
  }
}
