/**
 * Tagged-source runtime regression, included only by the Core 0.1.5 alpha runner.
 * Real public Session (V3), AgentRegistry, SessionProjectionRegistry and the public
 * SessionController constructor install/drive Core's actual modelSelection fold.
 * Sessions are detached: stateOf drives lazy replay, not a live SessionStore
 * event firehose. The runner attests the unchanged tagged checkout and aliases.
 * Agent shells and ancillary services are synthetic: this does not start an Agent
 * loop, call selectModel, exercise RPC/persistence, or prove an in-flight request.
 * No private Core imports, prototype replacements, Core builds or disk writes.
 */
import { Context } from '@deepseek-ai/cordis'
import { AgentRegistry, type Agent } from '@deepseek-ai/dsh-agent'
import { SessionController } from '@deepseek-ai/dsh-api-session-controller'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { currentChatRoute, currentSearchInitiator, currentSearchSelection } from '../../src/current-provider.ts'
import { migrationStatus, type MigrationSelection } from '../../src/migration-status.ts'

type RequestHeader = NonNullable<ReturnType<Session['requestHeader']>>
type RequestConfig = RequestHeader['config']
type AgentShell = Pick<Agent, 'id' | 'session' | 'status' | 'ctx'>

const nativeA: RequestConfig = {
  provider: 'github-copilot', model: 'fixture-native-A', reasoningEffort: ReasoningEffortId('high'),
}
const otherB: RequestConfig = {
  provider: 'fixture-other', model: 'fixture-B', reasoningEffort: ReasoningEffortId('low'),
}
const managedPending: MigrationSelection = {
  provider: 'github-copilot-preview', model: 'fixture-next', reasoningEffort: 'low',
}
const defaultC: MigrationSelection = { provider: 'fixture-default', model: 'fixture-C' }
const contexts: Context[] = []

beforeAll(() => {
  // Fail rather than silently substitute the installed peer or another baseline.
  expect(process.env.DSH_CORE_EVIDENCE).toBe('tagged-source-runtime')
  expect(['0.1.5-alpha.1', '0.1.5-alpha.2', '0.1.5-rc.1', '0.1.5-rc.2']).toContain(process.env.DSH_PUBLISHED_CORE_RELEASE)
  expect(SESSION_FORMAT_VERSION).toBe(3)
})

afterEach(async () => {
  try {
    for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  } finally {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  }
})

/** Supply an owned synthetic service through Cordis's public dynamic registration. */
function provideDouble(ctx: Context, key: Extract<keyof Context, string>, value: object): void {
  // Only constructor/read-path methods are implemented; these objects are not
  // asserted to be complete production services or credential/network evidence.
  ctx.provide(key, value)
}

function fixture({ mountController = true } = {}) {
  const ctx = new Context()
  contexts.push(ctx)
  const forbidden = vi.fn((): never => { throw new Error('session-fixture-forbidden-side-effect') })
  vi.stubGlobal('fetch', forbidden)

  // Constructor-only registrars: no descriptors, lookups, RPC, uploads or files
  // are resolved. Every registration's disposer is tracked by this test's fiber.
  const registration = vi.fn(() => ctx.effect(() => () => {}, 'session-fixture registration'))
  provideDouble(ctx, 'typert', {
    lookups: { configure: registration, register: registration },
    contexts: { configureHost: registration, registerHost: registration },
  })
  provideDouble(ctx, 'fileUploads', { registerAgentResolver: registration })
  const agents = new AgentRegistry(ctx)
  const projections = new SessionProjectionRegistry(ctx)
  let selectedDefault = defaultC
  const currentSelection = vi.fn(() => selectedDefault)
  provideDouble(ctx, 'agentDefaultModel', { currentSelection, saveSelection: forbidden })
  const settingsValue = Object.freeze({ providers: Object.freeze({
    'github-copilot': Object.freeze({ api: 'openai-responses', baseURL: 'https://native.fixture.invalid' }),
    'fixture-other': Object.freeze({ api: 'anthropic-messages', baseURL: 'https://other.fixture.invalid' }),
  }) })
  const getSettings = vi.fn(() => settingsValue)
  provideDouble(ctx, 'settings', {
    get: getSettings,
    describe: vi.fn(() => [{ ns: 'llm-pi-ai', revision: 2 }, { ns: 'github-copilot', revision: 7 }]),
    mutate: forbidden,
  })
  provideDouble(ctx, 'llm', {
    listProviders: vi.fn(() => [
      { id: 'github-copilot', name: 'Synthetic native fixture' },
      { id: 'github-copilot-preview', name: 'Synthetic managed fixture' },
      { id: 'fixture-other', name: 'Synthetic other fixture' },
    ]),
    listModels: forbidden,
    resolveCallConfig: forbidden,
    stream: forbidden,
  })
  provideDouble(ctx, 'credentials', {
    readRecord: forbidden, describeRecord: forbidden, modifyRecord: forbidden, deleteRecord: forbidden,
  })
  provideDouble(ctx, 'authorization', { describe: forbidden })
  provideDouble(ctx, 'githubCopilotPreview', {
    getView: forbidden, ensureModels: forbidden, routeFacts: forbidden,
  })

  // Public constructor, not a copy/import of its private projection installer.
  // Optional UI/file/skill plugins remain dependency-gated in this isolated ctx.
  const controller = mountController ? new SessionController(ctx, { nativeOpen: false }, {
    canOpenPath: () => false, openPath: forbidden,
  }) : undefined
  const shells: AgentShell[] = []
  const add = (id: string, status: Agent['status'] = 'idle') => {
    const session = Session.create(SessionId(id))
    const shell: AgentShell = { id: session.id, session, status, ctx }
    Object.defineProperty(shell, 'options', { get: forbidden })
    // No fake loop: the real registry accepts an already-created Agent. Only its
    // public id/session/status/ctx leaves are used by registration and these reads.
    const agent = shell as Agent
    agents.register(agent)
    shells.push(shell)
    return agent
  }
  const observe = () => {
    const before = shells.map(shell => ({ session: shell.session, seq: shell.session.seq,
      events: shell.session.snapshotEvents(), header: shell.session.requestHeader() }))
    const result = migrationStatus(ctx)
    for (const item of before) {
      expect(item.session.seq).toBe(item.seq)
      expect(item.session.snapshotEvents()).toBe(item.events)
      expect(item.session.requestHeader()).toBe(item.header)
    }
    expect(forbidden).not.toHaveBeenCalled()
    return result
  }
  return { ctx, agents, projections, controller, add, observe, forbidden, currentSelection,
    setDefault(value: MigrationSelection) { selectedDefault = value } }
}

function recordHeader(session: Session, config: RequestConfig, adapterDefault = false) {
  return session.append('request/header', {
    header: { config, ...(adapterDefault ? { adapterDefaults: { reasoningEffort: true } } : {}) },
    reason: session.requestHeader() === undefined ? 'initial' : 'change',
  })
}

function requestConfig(selection: MigrationSelection): RequestConfig {
  return { provider: selection.provider, model: selection.model,
    ...(selection.reasoningEffort === undefined ? {} : { reasoningEffort: ReasoningEffortId(selection.reasoningEffort) }) }
}

describe('Core 0.1.5 alpha public Session context (actual controller projection)', () => {
  it('installs the actual controller fold and applies pending > header > genuinely-empty default', () => {
    const f = fixture()
    expect(f.controller).toBeInstanceOf(SessionController)
    const a = f.add('projection-A', 'running')
    const empty = f.add('projection-empty')
    expect(empty.session.header.version).toBe(3)
    expect(empty.session.seq).toBe(0)
    expect(empty.session.requestHeader()).toBeUndefined()
    expect(f.projections.stateOf(empty.session, 'modelSelection')).toEqual({ lastUsed: null, pending: null })
    recordHeader(a.session, nativeA)
    expect(f.projections.stateOf(a.session, 'modelSelection')).toEqual({ lastUsed: nativeA, pending: null })
    a.session.append('model/selection', managedPending)
    expect(f.projections.stateOf(a.session, 'modelSelection')).toEqual({ lastUsed: nativeA, pending: managedPending })
    expect(f.observe().sessions).toEqual([
      { id: a.id, status: 'running', effectiveSelection: managedPending,
        selectionSource: 'pending', activeRequestSelection: nativeA },
      { id: empty.id, status: 'idle', effectiveSelection: defaultC,
        selectionSource: 'default', activeRequestSelection: null },
    ])

    // An unrelated request cannot consume the pending choice. A matching one can.
    recordHeader(a.session, otherB)
    expect(f.projections.stateOf(a.session, 'modelSelection')).toEqual({ lastUsed: otherB, pending: managedPending })
    expect(f.observe().sessions[0]).toMatchObject({ effectiveSelection: managedPending, activeRequestSelection: otherB })
    recordHeader(a.session, requestConfig(managedPending))
    expect(f.projections.stateOf(a.session, 'modelSelection')).toEqual({ lastUsed: managedPending, pending: null })
    expect(f.projections.snapshot(a.session, ['modelSelection']).values.modelSelection)
      .toEqual({ lastUsed: managedPending, next: managedPending })
    expect(f.observe()).toMatchObject({ complete: { sessions: true, defaultSelection: true, routes: true },
      sessions: [{ selectionSource: 'request-header', effectiveSelection: managedPending, activeRequestSelection: managedPending },
        { selectionSource: 'default', effectiveSelection: defaultC }] })
  })

  it('isolates concurrent real initiator A/B contexts from the future global default C', async () => {
    const f = fixture(), a = f.add('concurrent-A', 'running'), b = f.add('concurrent-B', 'running')
    const empty = f.add('concurrent-empty')
    recordHeader(a.session, nativeA)
    recordHeader(b.session, otherB)
    const gate = Promise.withResolvers<void>()
    const read = (agent: Agent) => f.agents.withInitiator(agent, async () => {
      expect(currentSearchInitiator(f.ctx)).toBe(agent)
      await gate.promise
      expect(currentSearchInitiator(f.ctx)).toBe(agent)
      return currentChatRoute(f.ctx)
    })
    const reads = [read(a), read(b)]
    try {
      expect(currentSearchInitiator(f.ctx)).toBeUndefined()
      expect(currentChatRoute(f.ctx)).toBeUndefined()
      expect(f.observe().sessions.map(row => row.effectiveSelection?.model))
        .toEqual([nativeA.model, otherB.model, defaultC.model])
      f.setDefault({ provider: 'fixture-default', model: 'fixture-later-default' })
    } finally { gate.resolve() }
    expect(await Promise.all(reads)).toEqual([
      { provider: nativeA.provider, model: nativeA.model, api: 'openai-responses', baseURL: 'https://native.fixture.invalid' },
      { provider: otherB.provider, model: otherB.model, api: 'anthropic-messages', baseURL: 'https://other.fixture.invalid' },
    ])
    expect(f.observe().sessions.map(row => row.effectiveSelection?.model))
      .toEqual([nativeA.model, otherB.model, 'fixture-later-default'])
    expect(f.agents.withInitiator(empty, () => currentChatRoute(f.ctx))).toBeUndefined()
    expect(f.agents.withInitiator(a, () => currentChatRoute(f.ctx, otherB)))
      .toMatchObject({ provider: otherB.provider, model: otherB.model })
    expect(f.forbidden).not.toHaveBeenCalled()
  })

  it('keeps recorded request context separate from pending future intent and activity claims', () => {
    const f = fixture(), a = f.add('recorded-not-in-flight', 'running')
    recordHeader(a.session, nativeA)
    a.session.append('model/selection', managedPending)
    a.session.append('turn/start', { turn: 1 })
    a.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    // A completed synthetic turn deliberately leaves the shell's status running.
    // activeRequestSelection means last recorded config, not a live model call.
    expect(f.observe().sessions[0]).toEqual({ id: a.id, status: 'running',
      selectionSource: 'pending', effectiveSelection: managedPending, activeRequestSelection: nativeA })
    expect(currentSearchSelection(a)).toEqual({ provider: nativeA.provider, model: nativeA.model })
    // Request-bound search reads this committed header; it does not label that
    // stale request as the newly selected model's future prompt guidance.
    expect(f.agents.withInitiator(a, () => currentChatRoute(f.ctx)))
      .toMatchObject({ provider: nativeA.provider, model: nativeA.model })
    expect(f.forbidden).not.toHaveBeenCalled()
  })

  it('omits adapter-defaulted effort from future intent but preserves it in the recorded header', () => {
    const f = fixture(), a = f.add('adapter-default', 'running'), b = f.add('explicit-effort')
    const event = recordHeader(a.session, nativeA, true)
    recordHeader(b.session, otherB)
    const header = a.session.requestHeader()
    expect(header?.config).toEqual(nativeA)
    expect(header?.adapterDefaults).toEqual({ reasoningEffort: true })
    expect(Object.isFrozen(header)).toBe(true)
    expect(Object.isFrozen(header?.config)).toBe(true)
    expect(f.projections.stateOf(a.session, 'modelSelection')).toEqual({ lastUsed: nativeA, pending: null })
    expect(f.observe().sessions).toEqual([
      { id: a.id, status: 'running', selectionSource: 'request-header',
        effectiveSelection: { provider: nativeA.provider, model: nativeA.model }, activeRequestSelection: nativeA },
      { id: b.id, status: 'idle', selectionSource: 'request-header', effectiveSelection: otherB, activeRequestSelection: null },
    ])
    expect(a.session.eventAt(event.seq)).toBe(event)
    expect(a.session.requestHeader()).toBe(header)
    a.session.append('model/selection', managedPending)
    expect(f.observe().sessions[0]?.effectiveSelection).toEqual(managedPending)
  })

  it('fails closed when the real registry has no modelSelection owner despite a header/default', () => {
    const f = fixture({ mountController: false }), a = f.add('unsupported-projection')
    f.add('unsupported-empty')
    recordHeader(a.session, nativeA)
    expect(f.projections.stateOf(a.session, 'modelSelection')).toBeUndefined()
    const result = f.observe()
    expect(result.capabilities.sessionProjections).toBe(true)
    expect(result.complete.sessions).toBe(false)
    expect(result.sessions.map(row => [row.selectionSource, row.effectiveSelection]))
      .toEqual([['unknown', null], ['unknown', null]])
  })

  it('does not claim complete recorded-request evidence for a running genuinely-empty Session', () => {
    const f = fixture(), a = f.add('running-before-first-header', 'running')
    expect(f.observe()).toMatchObject({ complete: { sessions: false }, sessions: [{ id: a.id,
      selectionSource: 'default', effectiveSelection: defaultC, activeRequestSelection: null }] })
    expect(currentSearchSelection(a)).toBeUndefined()
  })
})
