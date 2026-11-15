import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import '@earendil-works/pi-ai/api/openai-completions'
import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all'
import { Context } from '@deepseek-ai/cordis'
import Authorization from '@deepseek-ai/dsh-authorization'
import type { Agent } from '@deepseek-ai/dsh-agent'
import LlmRuntime, { BlockAssembler, createUserMessage, isAgentLoopRequest, markAgentLoopRequest } from '@deepseek-ai/dsh-llm'
import { scopeTarget } from '@deepseek-ai/dsh-scope'
import { SessionId } from '@deepseek-ai/dsh-session'
import * as CorePiAi from '@deepseek-ai/dsh-llm-pi-ai'
import { afterEach, expect, it, vi } from 'vitest'
import * as Companion from '../src/index.ts'
import type { InlineConfig } from '../src/config.ts'
import { GITHUB_COPILOT_CREDENTIAL_KEY as KEY, GITHUB_COPILOT_PREVIEW_PROVIDER_ID as MANAGED } from '../src/copilot-identity.ts'

vi.mock('../src/native-copilot-access.ts', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/native-copilot-access.ts')>()
  const { getBuiltinModels } = await import('@earendil-works/pi-ai/providers/all')
  return { ...original, captureNativeCopilot: vi.fn(async () => ({
    namespace: 'llm-pi-ai',
    models: new Map(getBuiltinModels('github-copilot').map(({ id, api }) => [id, { id, api }])),
    assertCurrent: () => {},
  })) }
})

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const key = (account: string) => account === 'canonical' ? KEY : `github-copilot/account-${account}`
type SyntheticGrant = { kind: 'grant'; payload: { type: 'oauth'; refresh: string; access: string; expires: number; availableModelIds: string[] } }
afterEach(() => vi.unstubAllGlobals())

it('applies confirmed account switches to native credentials and retains the native route after disposal', async () => {
  const ctx = new Context()
  let markerFixture: string | undefined
  const model = getBuiltinModels('github-copilot').find(model => model.api === 'openai-completions')
  if (!model) throw new Error('Pinned native Copilot completions model unavailable')
  const expires = Date.now() + 7_200_000
  const syntheticGrant = (account: string): SyntheticGrant => ({
    kind: 'grant' as const, payload: { type: 'oauth', refresh: `synthetic-${account}`,
      access: `synthetic-access-${account}`, expires, availableModelIds: [model.id] },
  })
  const savedA = syntheticGrant(A)
  const grants = new Map<string, SyntheticGrant>([
    [KEY, structuredClone(savedA)], [key(A), savedA], [key(B), syntheticGrant(B)],
  ])
  const nativeSelection = { provider: 'github-copilot', model: model.id }
  const nativeConfig = { providers: { 'github-copilot': { models: [{ id: model.id }] } } }
  const config: InlineConfig = { enabled: true, providers: [], includeSources: true, stripServerTools: true,
    idleTimeoutMs: 300_000, probe: true, probeTimeoutMs: 30_000, activeAccountId: A,
    continuationDefaultHistory: [{ enabled: false, changedAt: 1 }] }
  let managedSettings = { ...config }, revision = 1
  const mutate = vi.fn(async (namespace: string, operations: readonly { op: string; path: string[]; value?: unknown }[], expected: number) => {
    expect(namespace).toBe('github-copilot')
    expect(expected).toBe(revision)
    expect(operations).toEqual([{ op: 'set', path: ['activeAccountId'], value: B }])
    managedSettings = { ...managedSettings, activeAccountId: B }
    revision++
    ctx.emit('settings/document-updated', 'github-copilot' as never, revision)
  })
  const readRecord = vi.fn(async (key: string) => grants.get(key))
  const modifyRecord = vi.fn(async (recordKey: string, mutate: (record: unknown) => Promise<unknown>) => {
    const next = await mutate(grants.get(recordKey))
    if (next === undefined) grants.delete(recordKey)
    else grants.set(recordKey, next as SyntheticGrant)
    ctx.emit('credentials/record-updated', recordKey as never)
    return next
  })
  const deleteRecord = vi.fn(async (recordKey: string) => {
    grants.delete(recordKey)
    ctx.emit('credentials/record-updated', recordKey as never)
  })
  let hasNativeHeader = true
  const nativeAgent = { id: 'native-session', status: 'running',
    session: { id: 'native-session', header: { id: 'native-session' },
      requestHeader: () => hasNativeHeader ? { config: nativeSelection, adapterDefaults: {} } : undefined } }
  const wireAccounts: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input)
    const token = new Headers(init?.headers).get('Authorization')
    if (url === 'https://api.github.com/copilot_internal/user') {
      expect(token).toBe(`token synthetic-${B}`)
      return Response.json({ token_based_billing: true, quota_snapshots: { premium_interactions: {
        entitlement: 300, quota_remaining: 240, percent_remaining: 80, unlimited: false,
      } } })
    }
    if (url === 'https://api.github.com/user') return Response.json({
      login: token === `token synthetic-${A}` ? 'account-a' : token === `token synthetic-${B}` ? 'account-b' : 'original',
      id: token === `token synthetic-${A}` ? 2 : token === `token synthetic-${B}` ? 3 : 1,
    })
    if (url.endsWith('/models')) return Response.json({ data: [{
      id: model.id, name: model.id, model_picker_enabled: true, policy: { state: 'enabled' },
      supported_endpoints: ['/chat/completions'],
      capabilities: { supports: { tool_calls: true, streaming: true, vision: false },
        limits: { max_context_window_tokens: 128000, max_prompt_tokens: 96000, max_output_tokens: 4096 } },
    }] })
    if (url.endsWith('/chat/completions')) {
      wireAccounts.push(token ?? 'missing')
      return new Response(`data: ${JSON.stringify({ id: 'synthetic', choices: [
        { index: 0, delta: { content: 'hello' }, finish_reason: 'stop' },
      ], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\ndata: [DONE]\n\n`,
      { headers: { 'content-type': 'text/event-stream' } })
    }
    throw new Error('Unexpected synthetic fixture request')
  }))
  const send = async (provider: string) => {
    const call = await ctx.llm.prepareCall({ provider, model: model.id })
    const assembled = new BlockAssembler()
    for await (const chunk of call.stream({ ...call.config, signal: new AbortController().signal,
      messages: [createUserMessage({ content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } })] })) {
      assembled.push(chunk)
    }
    expect(assembled.finish).toEqual({ kind: 'stop' })
  }
  try {
    await ctx.plugin({ apply(owner: Context) {
      owner.provide('credentials', { readRecord, modifyRecord, deleteRecord,
        listRecords: async () => [...grants.keys()].map(key => ({ key, kind: 'grant' })),
        describeRecord: async (key: string) => ({ configured: grants.has(key), writable: true }),
      } as unknown as Context['credentials'])
      owner.provide('settings', {
        describe: () => [{ ns: 'llm-pi-ai', revision: 1, value: nativeConfig },
          { ns: 'github-copilot', revision, value: managedSettings }], mutate,
      } as unknown as Context['settings'])
      owner.provide('systemPrompt', { section: () => () => undefined } as unknown as Context['systemPrompt'])
      owner.provide('web', { registerSearchProvider: () => () => undefined } as unknown as Context['web'])
      owner.provide('agents', { list: () => [nativeAgent] } as unknown as Context['agents'])
      owner.provide('sessionProjections', { stateOf: () => ({ pending: null }) } as unknown as Context['sessionProjections'])
      owner.provide('agentDefaultModel', { currentSelection: () => nativeSelection } as Context['agentDefaultModel'])
    } })
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(Authorization)
    await ctx.plugin(CorePiAi, nativeConfig)
    await send('github-copilot')
    const enhancement = await ctx.plugin(Companion, config)
    await vi.waitFor(() => expect(ctx.get('githubCopilotAccounts')).toBeDefined())
    const accounts = ctx.get('githubCopilotAccounts')!
    expect(await accounts.get()).toMatchObject({ state: 'ready', activeAccountId: A, switchable: true })
    const providers = ctx.llm.listProviders().map(provider => provider.id)
    expect(providers).toEqual(['github-copilot'])
    expect(providers).not.toContain(MANAGED)
    await send('github-copilot')
    const requestAgent = { ctx, session: nativeAgent.session } as unknown as Agent
    const requestSignal = new AbortController()
    hasNativeHeader = false
    await Reflect.apply(ctx.waterfall, ctx, [scopeTarget(requestAgent, requestAgent), 'agent/pre-step',
      { agent: requestAgent, turn: 1, step: 1, messages: [], signal: requestSignal.signal, modelSelection: nativeSelection },
      async () => ({ kind: 'enter', messages: [] })])
    await ctx.waterfall(scopeTarget(requestAgent, requestAgent), 'agent/request',
      { agent: requestAgent, turn: 1, step: 1, signal: requestSignal.signal }, async () => nativeSelection)
    // Core records the first request header before the stream is dispatched.
    hasNativeHeader = true
    const auxiliary = await ctx.llm.prepareCall({ provider: 'github-copilot', model: model.id })
    for await (const _chunk of auxiliary.stream({ ...auxiliary.config, signal: requestSignal.signal, messages: [] })) {}
    expect(ctx.get('githubCopilotSessionAccounts')?.turns.evidence(nativeAgent.session, 1)).toBeUndefined()
    const review = await ctx.llm.prepareCall({ provider: 'github-copilot', model: model.id })
    for await (const _chunk of review.stream(markAgentLoopRequest({ ...review.config, signal: requestSignal.signal,
      sessionId: SessionId(nativeAgent.session.id), purpose: 'auto-review', messages: [] }))) {}
    expect(ctx.get('githubCopilotSessionAccounts')?.turns.evidence(nativeAgent.session, 1)).toBeUndefined()
    if (process.env.DSH_CORE_EVIDENCE === 'published-artifact-runtime') {
      expect(process.env.DSH_PUBLISHED_CORE_RELEASE).toBe('0.2.2-rc.3')
      const require = createRequire(import.meta.url)
      const manifest = realpathSync(require.resolve('@deepseek-ai/dsh-llm/package.json'))
      expect(JSON.parse(readFileSync(manifest, 'utf8'))).toMatchObject({
        name: '@deepseek-ai/dsh-llm', version: '0.2.2-rc.3',
      })
      const packageRoot = dirname(manifest)
      markerFixture = mkdtempSync(join(tmpdir(), 'copilot-llm-marker-'))
      symlinkSync(dirname(dirname(packageRoot)), join(markerFixture, 'node_modules'), 'junction')
      const copy = join(markerFixture, 'llm')
      cpSync(packageRoot, copy, { recursive: true, errorOnExist: true, force: false })
      const other: typeof import('@deepseek-ai/dsh-llm') = require(join(copy, 'lib', 'index.js'))
      const ownMarker = markAgentLoopRequest({ provider: 'github-copilot', model: model.id, messages: [] })
      expect(isAgentLoopRequest(ownMarker)).toBe(true)
      expect(other.isAgentLoopRequest(ownMarker)).toBe(false)
      const foreign = await ctx.llm.prepareCall({ provider: 'github-copilot', model: model.id })
      const foreignRequest = other.markAgentLoopRequest({ ...foreign.config, signal: requestSignal.signal,
        sessionId: SessionId(nativeAgent.session.id), messages: [] })
      expect(other.isAgentLoopRequest(foreignRequest)).toBe(true)
      expect(isAgentLoopRequest(foreignRequest)).toBe(false)
      for await (const _chunk of foreign.stream(foreignRequest)) {}
      expect(ctx.get('githubCopilotSessionAccounts')?.turns.evidence(nativeAgent.session, 1)).toBeUndefined()
    }
    const ordinary = await ctx.llm.prepareCall({ provider: 'github-copilot', model: model.id })
    for await (const _chunk of ordinary.stream(markAgentLoopRequest({ ...ordinary.config, signal: requestSignal.signal,
      sessionId: SessionId(nativeAgent.session.id),
      messages: [createUserMessage({ content: [{ type: 'text', text: 'hello' }], source: { kind: 'user' } })] }))) {}
    await vi.waitFor(() => expect(ctx.get('githubCopilotSessionAccounts')?.turns.evidence(nativeAgent.session, 1))
      .toMatchObject({ accountId: A, source: 'global' }))
    expect(await accounts.switchAccount(B, revision)).toMatchObject({
      state: 'error', activeAccountId: A, diagnostic: 'COPILOT_ACCOUNTS_BUSY',
    })
    requestSignal.abort()
    ctx.emit('session/event', requestAgent.session,
      { type: 'turn/end', data: { turn: 1 } } as never)
    expect(await accounts.get()).toMatchObject({ state: 'ready', activeAccountId: A, switchable: true })
    expect(await accounts.switchAccount(B, revision)).toMatchObject({ state: 'ready', activeAccountId: B })
    expect(await ctx.githubCopilotUsage.getNative()).toMatchObject({ state: 'ready', accountId: 'canonical' })
    await send('github-copilot')
    expect(ctx.agentDefaultModel.currentSelection()).toEqual(nativeSelection)
    expect(nativeConfig).toEqual({ providers: { 'github-copilot': { models: [{ id: model.id }] } } })
    expect(grants.get(KEY)?.payload.refresh).toBe(`synthetic-${B}`)
    expect(grants.get(key(A))?.payload.refresh).toBe(`synthetic-${A}`)
    expect(modifyRecord).toHaveBeenCalledTimes(1)
    expect(deleteRecord).not.toHaveBeenCalled()
    expect(mutate.mock.calls).toEqual([['github-copilot', [{ op: 'set', path: ['activeAccountId'], value: B }], 1]])
    await enhancement.dispose()
    expect(ctx.llm.listProviders().map(provider => provider.id)).toEqual(['github-copilot'])
    expect(ctx.get('githubCopilotAccounts')).toBeUndefined()
    await send('github-copilot')
    expect(wireAccounts).toEqual([
      `Bearer synthetic-access-${A}`, `Bearer synthetic-access-${A}`, `Bearer synthetic-access-${A}`,
      `Bearer synthetic-access-${A}`, `Bearer synthetic-access-${A}`,
      ...(process.env.DSH_CORE_EVIDENCE === 'published-artifact-runtime' ? [`Bearer synthetic-access-${A}`] : []),
      `Bearer synthetic-access-${B}`, `Bearer synthetic-access-${B}`,
    ])
    expect(grants.get(KEY)?.payload.refresh).toBe(`synthetic-${B}`)
    expect(ctx.agentDefaultModel.currentSelection()).toEqual(nativeSelection)
    expect(modifyRecord).toHaveBeenCalledTimes(1)
    expect(deleteRecord).not.toHaveBeenCalled()
  } finally {
    try { await ctx.fiber.dispose() }
    finally { if (markerFixture !== undefined) rmSync(markerFixture, { recursive: true, force: true }) }
  }
})
