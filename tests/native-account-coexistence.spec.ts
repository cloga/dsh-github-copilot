import '@earendil-works/pi-ai/api/openai-completions'
import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all'
import { Context } from '@deepseek-ai/cordis'
import Authorization from '@deepseek-ai/dsh-authorization'
import LlmRuntime, { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import * as CorePiAi from '@deepseek-ai/dsh-llm-pi-ai'
import { afterEach, expect, it, vi } from 'vitest'
import * as Companion from '../src/index.ts'
import type { InlineConfig } from '../src/config.ts'
import { GITHUB_COPILOT_CREDENTIAL_KEY as KEY, GITHUB_COPILOT_PREVIEW_PROVIDER_ID as MANAGED } from '../src/copilot-identity.ts'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const key = (account: string) => account === 'canonical' ? KEY : `github-copilot/account-${account}`
afterEach(() => vi.unstubAllGlobals())

it('keeps native requests, credentials and selection independent before, during and after multi-account enhancement', async () => {
  const ctx = new Context()
  const model = getBuiltinModels('github-copilot').find(model => model.api === 'openai-completions')
  if (!model) throw new Error('Pinned native Copilot completions model unavailable')
  const grants = new Map(['canonical', A, B].map(account => [key(account), {
    kind: 'grant' as const, payload: { type: 'oauth', refresh: `synthetic-${account}`,
      access: `synthetic-access-${account}`, expires: Date.now() + 7_200_000, availableModelIds: [model.id] },
  }]))
  const before = structuredClone(grants)
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
  const modifyRecord = vi.fn(async () => { throw new Error('No credential writes expected') })
  const deleteRecord = vi.fn(async () => { throw new Error('No credential deletion expected') })
  const nativeAgent = { id: 'native-session', status: 'running',
    session: { id: 'native-session', requestHeader: () => ({ config: nativeSelection, adapterDefaults: {} }) } }
  const wireAccounts: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input)
    const token = new Headers(init?.headers).get('Authorization')
    if (url === 'https://api.github.com/copilot_internal/user') {
      expect(token).toBe('token synthetic-canonical')
      return Response.json({ token_based_billing: true, quota_snapshots: { premium_interactions: {
        entitlement: 300, quota_remaining: 240, percent_remaining: 80, unlimited: false,
      } } })
    }
    if (url === 'https://api.github.com/user') return Response.json({
      login: token === 'token synthetic-canonical' ? 'original' : token === `token synthetic-${A}` ? 'account-a' : 'account-b',
      id: token === 'token synthetic-canonical' ? 1 : token === `token synthetic-${A}` ? 2 : 3,
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
    expect(ctx.llm.listProviders().map(provider => provider.id)).toEqual(expect.arrayContaining(['github-copilot', MANAGED]))
    await send('github-copilot')
    await send(MANAGED)
    expect(await accounts.switchAccount(B, revision)).toMatchObject({ state: 'ready', activeAccountId: B })
    expect(await ctx.githubCopilotUsage.getNative()).toMatchObject({ state: 'ready', accountId: 'canonical' })
    await send('github-copilot')
    await send(MANAGED)
    expect(ctx.agentDefaultModel.currentSelection()).toEqual(nativeSelection)
    expect(nativeConfig).toEqual({ providers: { 'github-copilot': { models: [{ id: model.id }] } } })
    expect(grants).toEqual(before)
    expect(modifyRecord).not.toHaveBeenCalled()
    expect(deleteRecord).not.toHaveBeenCalled()
    expect(mutate.mock.calls).toEqual([['github-copilot', [{ op: 'set', path: ['activeAccountId'], value: B }], 1]])
    await enhancement.dispose()
    expect(ctx.llm.listProviders().map(provider => provider.id)).toEqual(['github-copilot'])
    expect(ctx.get('githubCopilotAccounts')).toBeUndefined()
    await send('github-copilot')
    expect(wireAccounts).toEqual([
      'Bearer synthetic-access-canonical', 'Bearer synthetic-access-canonical', `Bearer synthetic-access-${A}`,
      'Bearer synthetic-access-canonical', `Bearer synthetic-access-${B}`, 'Bearer synthetic-access-canonical',
    ])
    expect(grants).toEqual(before)
    expect(ctx.agentDefaultModel.currentSelection()).toEqual(nativeSelection)
    expect(modifyRecord).not.toHaveBeenCalled()
    expect(deleteRecord).not.toHaveBeenCalled()
  } finally { await ctx.fiber.dispose() }
})
