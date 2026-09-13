import { createRequire } from 'node:module'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { name, version } from '#package.json' with { type: 'json' }
import { migrationStatus, type MigrationSelection } from '../src/migration-status.ts'
import { GitHubCopilotAuthorizationController } from '../src/authorization-controller.ts'
import remote, { GitHubCopilotMigrationStatusSchema, GitHubCopilotAuthorizationViewSchema } from '../src/remote.ts'

// Unchanged installed Core artifacts; no private registries or implementation patches.
const agentRequire = createRequire(createRequire(import.meta.url).resolve('@deepseek-ai/dsh-agent'))
const { Session } = agentRequire('@deepseek-ai/dsh-session') as {
  Session: { create(id: Agent['id']): Agent['session'] }
}
const { SessionProjectionRegistry } = agentRequire('@deepseek-ai/dsh-session-projection') as {
  SessionProjectionRegistry: new(ctx: Context) => {
    register(definition: unknown): () => void
    stateOf(session: Agent['session'], key: string): unknown
  }
}
type RequestConfig = NonNullable<ReturnType<Agent['session']['requestHeader']>>['config']
// Synthetic protocol strings acquire only the installed peer's compile-time brands.
const native: RequestConfig = { provider: 'github-copilot', model: 'old-native', reasoningEffort: 'high' as RequestConfig['reasoningEffort'] }
const managed = { provider: 'github-copilot-preview', model: 'next-managed', reasoningEffort: 'low' }
const fallback = { provider: 'other', model: 'global-C' }
const contexts: Context[] = []
afterEach(async () => { vi.unstubAllGlobals(); vi.restoreAllMocks(); for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })

function fixture() {
  const ctx = new Context(); contexts.push(ctx)
  const rows: unknown[] = []
  const pending = new Map<object, unknown>()
  const services = new Map<string, unknown>()
  const forbidden = vi.fn(() => { throw new Error('private-test-sentinel') })
  vi.stubGlobal('fetch', forbidden)
  const list = vi.fn((): unknown => rows)
  const stateOf = vi.fn((session: object, key: string): unknown => {
    expect(key).toBe('modelSelection')
    return pending.has(session) ? pending.get(session) : { pending: null }
  })
  const currentSelection = vi.fn((): unknown => fallback)
  const get = vi.fn((): unknown => ({ providers: { 'github-copilot': {} } }))
  const describeSettings = vi.fn((): unknown => [{ ns: 'llm-pi-ai', revision: 2 }, { ns: 'github-copilot', revision: 5 }])
  const listProviders = vi.fn((): unknown => [{ id: 'github-copilot' }, { id: 'github-copilot-preview' }])
  services.set('agents', { list, roots: forbidden })
  services.set('sessionProjections', { stateOf })
  services.set('agentDefaultModel', { currentSelection, select: forbidden })
  services.set('settings', { get, describe: describeSettings, mutate: forbidden })
  services.set('llm', { listProviders, listModels: forbidden })
  services.set('credentials', { readRecord: forbidden, describeRecord: forbidden, modifyRecord: forbidden })
  services.set('sessions', { list: forbidden, get: forbidden })
  services.set('githubCopilotPreview', { ensure: forbidden, discover: forbidden })
  ctx.get = ((key: string) => services.get(key)) as typeof ctx.get
  const add = (id: string, status: 'idle' | 'running' = 'idle', config: MigrationSelection | undefined = native) => {
    const session = Session.create(id as Agent['id'])
    if (config) session.append('request/header', { header: { config: config as RequestConfig }, reason: 'initial' })
    const row = { id, status, session, get options() { return forbidden() } }
    rows.push(row)
    return row
  }
  return { ctx, rows, pending, services, forbidden, list, stateOf, currentSelection, get, describeSettings, listProviders, add }
}

describe('read-only live migration evidence', () => {
  it('reports loaded identity and all live roots and children, never stale list/activation options', () => {
    const f = fixture()
    f.add('root-A', 'running')
    const child = f.add('child-B')
    f.pending.set(child.session, { pending: managed })
    const result = migrationStatus(f.ctx)
    expect(result.plugin).toEqual({ name, version })
    expect(result.protocolVersion).toBe(1)
    expect(result.historyScope).toBe('live-agents-only')
    expect(result.observedAt).toBeGreaterThan(0)
    expect(result.capabilities).toEqual({ agentsList: true, sessionProjections: true, settingsCas: true, providerRegistry: true, defaultSelection: true })
    expect(result.complete).toEqual({ sessions: true, defaultSelection: true, routes: true })
    expect(result.sessions).toEqual([
      { id: 'root-A', status: 'running', effectiveSelection: native, selectionSource: 'request-header', activeRequestSelection: native },
      { id: 'child-B', status: 'idle', effectiveSelection: managed, selectionSource: 'pending', activeRequestSelection: null },
    ])
    expect(result.routes).toEqual({ nativeConfigured: true, nativeRegistered: true, managedRegistered: true })
    expect(GitHubCopilotMigrationStatusSchema.parse(result)).toEqual(result)
    expect(f.forbidden).not.toHaveBeenCalled()
    expect(f.list).toHaveBeenCalledOnce()
    expect(f.get).toHaveBeenCalledExactlyOnceWith('llm-pi-ai')
    expect(f.describeSettings).toHaveBeenCalledExactlyOnceWith({ redactSecrets: true })
  })

  it('uses the real public Session projection registry for pending versus old request headers', () => {
    const f = fixture(), projections = new SessionProjectionRegistry(f.ctx)
    // Synthetic projection registration over the real Core driver and real Session.
    const dispose = projections.register({ key: 'modelSelection', stateVersion: 2,
      stateSchema: z.object({ pending: z.unknown() }), init: () => ({ pending: managed }),
      apply: (state: unknown) => state,
    })
    try {
      f.services.set('sessionProjections', projections)
      f.add('real-session', 'running')
      expect(migrationStatus(f.ctx).sessions[0]).toEqual({ id: 'real-session', status: 'running',
        effectiveSelection: managed, selectionSource: 'pending', activeRequestSelection: native })
    } finally { dispose() }
  })

  it('uses default only with explicit absent pending and absent header; preserves adapter-default semantics', () => {
    const f = fixture()
    const empty = Session.create('empty' as Agent['id'])
    f.rows.push({ id: 'empty', status: 'idle', session: empty })
    const old = f.add('old')
    old.session.append('request/header', { header: { config: native, adapterDefaults: { reasoningEffort: true } }, reason: 'initial' })
    expect(migrationStatus(f.ctx).sessions.map(row => [row.selectionSource, row.effectiveSelection])).toEqual([
      ['default', fallback], ['request-header', { provider: native.provider, model: native.model }],
    ])
    f.currentSelection.mockReturnValue({ provider: 'other', model: 'new-global' })
    expect(migrationStatus(f.ctx).sessions[1]?.effectiveSelection?.model).toBe(native.model)
  })

  it.each([undefined, {}])('unavailable projection never infers absent pending (%j)', projection => {
    const f = fixture(); f.add('selected')
    f.services.set('sessionProjections', projection)
    expect(migrationStatus(f.ctx)).toMatchObject({ capabilities: { sessionProjections: false }, complete: { sessions: false },
      sessions: [{ effectiveSelection: null, selectionSource: 'unknown' }] })
  })
  it('unsupported projection key reports unknown even when the default and old header exist', () => {
    const f = fixture(); f.add('unsupported'); f.stateOf.mockReturnValue(undefined)
    expect(migrationStatus(f.ctx)).toMatchObject({ complete: { sessions: false }, sessions: [{ selectionSource: 'unknown', effectiveSelection: null }] })
  })

  it.each([{}, { pending: undefined }, { pending: { provider: 'github-copilot' } }, { pending: null, then: true }])('malformed selection cannot fall back (%j)', value => {
    const f = fixture(); const row = f.add('malformed')
    // Unrelated projection leaves are not read; pending:null is valid.
    f.pending.set(row.session, value)
    const result = migrationStatus(f.ctx)
    if ('pending' in value && value.pending === null) expect(result.complete.sessions).toBe(true)
    else expect(result).toMatchObject({ complete: { sessions: false }, sessions: [] })
  })

  it.each(['agents', 'sessionProjections', 'agentDefaultModel', 'settings', 'llm'])('missing optional service is incomplete without private errors: %s', key => {
    const f = fixture(); f.add('a'); f.services.delete(key)
    const result = migrationStatus(f.ctx)
    expect(Object.values(result.complete)).toContain(false)
    expect(JSON.stringify(result)).not.toContain('private-test-sentinel')
    expect(f.forbidden).not.toHaveBeenCalled()
  })

  it('catches optional service lookup, disposal and stateOf failures without leaking or keeping partial rows', async () => {
    const f = fixture(); f.add('valid'); f.add('throws')
    f.stateOf.mockImplementationOnce(() => ({ pending: null })).mockImplementationOnce(f.forbidden)
    expect(migrationStatus(f.ctx)).toMatchObject({ complete: { sessions: false }, sessions: [] })
    f.ctx.get = (() => { throw new Error('private-test-sentinel') }) as typeof f.ctx.get
    expect(migrationStatus(f.ctx).capabilities).toEqual({ agentsList: false, sessionProjections: false, settingsCas: false, providerRegistry: false, defaultSelection: false })
    await f.ctx.fiber.dispose()
    expect(migrationStatus(f.ctx)).toMatchObject({ complete: { sessions: false, defaultSelection: false, routes: false }, sessions: [] })
  })

  it.each([null, {}, { provider: '', model: 'x' }, { provider: 'x', model: 'x', reasoningEffort: 1 }])('rejects invalid default selection %j', value => {
    const f = fixture(); f.currentSelection.mockReturnValue(value)
    const empty = Session.create('empty' as Agent['id']); f.rows.push({ id: 'empty', status: 'idle', session: empty })
    expect(migrationStatus(f.ctx)).toMatchObject({ defaultSelection: null, complete: { defaultSelection: false, sessions: false }, sessions: [{ selectionSource: 'unknown' }] })
  })

  it('does not claim a running no-header request is complete', () => {
    const f = fixture(); f.rows.push({ id: 'early', status: 'running', session: Session.create('early' as Agent['id']) })
    expect(migrationStatus(f.ctx)).toMatchObject({ complete: { sessions: false }, sessions: [{ activeRequestSelection: null }] })
  })

  it('bounds complete arrays and rejects malformed or duplicate inventory without a success prefix', () => {
    const f = fixture(); const row = f.add('a')
    f.list.mockReturnValue(Array.from({ length: 1024 }, (_, i) => ({ status: 'idle', id: `s${i}`, session: { id: `s${i}`, requestHeader: () => ({ config: native }) } })))
    expect(migrationStatus(f.ctx).complete.sessions).toBe(true)
    for (const value of [Array(1025).fill(row), [row, row], [row, null], [row, { session: row.session, id: 'bad', status: 'disposed' }], [row, { session: row.session, status: 'idle', id: 'wrong-session' }], Promise.resolve([])]) {
      f.list.mockReturnValue(value)
      expect(migrationStatus(f.ctx)).toMatchObject({ complete: { sessions: false }, sessions: [] })
    }
  })

  it('reads only named public leaves, not private titles history credentials or settings', () => {
    const f = fixture(), row = f.add('safe')
    for (const key of ['title', 'prompts', 'history', 'credentials']) Object.defineProperty(row, key, { get: f.forbidden })
    f.currentSelection.mockReturnValue(Object.defineProperty({ ...fallback }, 'credential', { get: f.forbidden }))
    f.get.mockReturnValue(Object.defineProperty({ providers: { 'github-copilot': {} } }, 'private', { get: f.forbidden }))
    f.describeSettings.mockReturnValue([
      Object.defineProperty({ ns: 'llm-pi-ai', revision: 1 }, 'user', { get: f.forbidden }),
      { ns: 'github-copilot', revision: 1 },
    ])
    expect(migrationStatus(f.ctx).complete).toEqual({ sessions: true, defaultSelection: true, routes: true })
    expect(f.forbidden).not.toHaveBeenCalled()
  })

  it.each(['list', 'currentSelection', 'get', 'describeSettings', 'listProviders'] as const)('contains synchronous service errors without leaking messages: %s', reader => {
    const f = fixture(); f.add('error')
    f[reader].mockImplementation(() => { throw new Error('private-test-sentinel') })
    const result = migrationStatus(f.ctx)
    expect(Object.values(result.complete)).toContain(false)
    expect(JSON.stringify(result)).not.toContain('private-test-sentinel')
    expect(GitHubCopilotMigrationStatusSchema.safeParse(result).success).toBe(true)
  })

  it('discards all rows on requestHeader errors and unknown malformed native configuration', () => {
    const f = fixture(); f.add('good')
    f.rows.push({ id: 'bad', status: 'idle', session: { id: 'bad', requestHeader() { throw new Error('private-test-sentinel') } } })
    expect(migrationStatus(f.ctx)).toMatchObject({ sessions: [], complete: { sessions: false } })
    for (const value of [undefined, null, { providers: null }, { providers: { 'github-copilot': null } }]) {
      f.get.mockReturnValue(value)
      expect(migrationStatus(f.ctx)).toMatchObject({ complete: { routes: false }, routes: { nativeConfigured: null } })
    }
    expect(f.forbidden).not.toHaveBeenCalled()
  })

  it('observes actual configured and registered routes independently of sign-in or metadata', () => {
    const f = fixture(); f.get.mockReturnValue({ providers: {} }); f.listProviders.mockReturnValue([{ id: 'github-copilot-preview' }])
    expect(migrationStatus(f.ctx).routes).toEqual({ nativeConfigured: false, nativeRegistered: false, managedRegistered: true })
    f.get.mockReturnValue({ providers: { 'github-copilot': {} } }); f.listProviders.mockReturnValue([])
    expect(migrationStatus(f.ctx).routes).toEqual({ nativeConfigured: true, nativeRegistered: false, managedRegistered: false })
    expect(f.forbidden).not.toHaveBeenCalled()
  })

  it.each([
    [], [{ ns: 'llm-pi-ai', revision: 1 }], [{ ns: 'github-copilot', revision: 1 }],
    [{ ns: 'llm-pi-ai', revision: 1 }, { ns: 'llm-pi-ai', revision: 1 }, { ns: 'github-copilot', revision: 1 }],
    [{ ns: 'llm-pi-ai', revision: NaN }, { ns: 'github-copilot', revision: 1 }],
    [{ ns: 'llm-pi-ai', revision: 1 }, { ns: 'github-copilot', revision: -1 }], Array(1025).fill({ ns: 'other', revision: 1 }),
  ].map(value => [value]))('requires unique revision-bearing relevant namespaces without truncated descriptors', descriptors => {
    const f = fixture(); f.describeSettings.mockReturnValue(descriptors)
    expect(migrationStatus(f.ctx)).toMatchObject({ capabilities: { settingsCas: false }, complete: { routes: false }, routes: { nativeConfigured: null } })
  })

  it.each([null, [null], [{ id: '' }], [{ id: 'x' }, { id: 'x' }], Array(1025).fill({ id: 'x' })].map(value => [value]))('fails registry observation closed without a success prefix', providers => {
    const f = fixture(); f.listProviders.mockReturnValue(providers)
    expect(migrationStatus(f.ctx)).toMatchObject({ complete: { routes: false }, routes: { nativeRegistered: null, managedRegistered: null } })
  })

  it('returns a synchronous detached observation; later microtasks cannot alter it', async () => {
    const f = fixture(); f.add('one')
    const result = migrationStatus(f.ctx)
    queueMicrotask(() => { f.rows.length = 0; f.currentSelection.mockReturnValue(managed) })
    expect(result).not.toBeInstanceOf(Promise)
    await Promise.resolve()
    expect(result.sessions).toHaveLength(1)
    expect(result.defaultSelection).toEqual(fallback)
    expect(migrationStatus(f.ctx).sessions).toEqual([])
  })

  it('keeps noargs Remote migration evidence separate and ordinary status unchanged', async () => {
    const f = fixture()
    const controller = new GitHubCopilotAuthorizationController(f.ctx)
    const result = controller.migrationStatus()
    expect(GitHubCopilotMigrationStatusSchema.parse(result)).toEqual(result)
    expect(GitHubCopilotAuthorizationViewSchema.safeParse(result).success).toBe(false)
    f.services.set('authorization', { describe: () => undefined })
    f.services.set('credentials', { describeRecord: async () => ({ configured: false, writable: true }) })
    f.services.delete('githubCopilotPreview')
    expect(await controller.status()).toEqual({ phase: 'signed-out', configured: false, writable: true, inFlight: false, notices: [], route: { state: 'not-configured' } })
    const descriptor = remote.descriptors.find(item => item.method === 'migrationStatus')!
    expect(descriptor).toMatchObject({ id: 'dsh-github-copilot:githubCopilot.migrationStatus', service: 'githubCopilotAuthorization', namespace: 'githubCopilot', invocation: { kind: 'direct' }, parameters: [], result: { mode: 'strict', typeSymbol: 'dsh-github-copilot#GitHubCopilotMigrationStatus' } })
  })

  it('strict codec rejects private fields at every object layer and oversized evidence', () => {
    const f = fixture(); f.add('codec', 'running')
    const value = migrationStatus(f.ctx), row = value.sessions[0]!
    const invalid = [
      { ...value, credentials: 'secret' }, { ...value, plugin: { ...value.plugin, path: 'private' } },
      { ...value, capabilities: { ...value.capabilities, private: true } }, { ...value, complete: { ...value.complete, private: true } },
      { ...value, routes: { ...value.routes, settings: {} } }, { ...value, defaultSelection: { ...fallback, token: 'secret' } },
      { ...value, sessions: [{ ...row, title: 'private' }] }, { ...value, sessions: [{ ...row, effectiveSelection: { ...native, history: [] } }] },
      { ...value, sessions: [{ ...row, activeRequestSelection: { ...native, prompt: 'private' } }] },
      { ...value, sessions: Array(1025).fill(row) }, { ...value, protocolVersion: 2 }, { ...value, historyScope: 'all' },
      { ...value, observedAt: Infinity }, { ...value, defaultSelection: { provider: 'x', model: 'x'.repeat(513) } },
    ]
    for (const item of invalid) expect(GitHubCopilotMigrationStatusSchema.safeParse(item).success).toBe(false)
  })
})
