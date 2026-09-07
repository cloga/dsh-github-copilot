import { Context } from '@deepseek-ai/cordis'
import AuthorizationService from '@deepseek-ai/dsh-authorization'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { parseCredentialKey } from '@deepseek-ai/dsh-credentials'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import * as CorePiAi from '@deepseek-ai/dsh-llm-pi-ai'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Companion from '../src/index.ts'
import type { InlineConfig } from '../src/config.ts'
import { GITHUB_COPILOT_CREDENTIAL_KEY as KEY, GITHUB_COPILOT_PREVIEW_PROVIDER_ID as MANAGED } from '../src/copilot-identity.ts'

// Actual published Core LLM, pi adapter and OAuth registrations; synthetic
// credentials/settings/network only. This is not a live account or migration.
const contexts: Context[] = []
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  vi.unstubAllGlobals()
})
const companionConfig: InlineConfig = {
  enabled: true, providers: [], includeSources: true, stripServerTools: true,
  idleTimeoutMs: 300_000, probe: true, probeTimeoutMs: 30_000,
}
async function runtime(legacy = false) {
  const ctx = new Context()
  contexts.push(ctx)
  const grant = { kind: 'grant', payload: { type: 'oauth', refresh: 'synthetic-account', access: 'synthetic-access',
    expires: Date.now() + 3_600_000, availableModelIds: ['future-account-model'] } }
  const documents: Record<string, unknown> = {
    'llm-pi-ai': CorePiAi.Config({ providers: legacy ? { 'github-copilot': { compat: { supportsStrictMode: false } } } : {} }),
    'github-copilot': companionConfig,
  }
  const revisions = new Map<string, number>()
  const watchers = new Map<string, () => void>()
  const mutate = vi.fn(async (ns: string, operations: readonly { op: string; path: string[] }[]) => {
    if (ns !== 'llm-pi-ai' || operations.length !== 1 || operations[0]?.op !== 'unset'
      || operations[0].path.join('.') !== 'providers.github-copilot') throw new Error('Unexpected automatic settings mutation')
    documents[ns] = CorePiAi.Config({ providers: {} })
    revisions.set(ns, (revisions.get(ns) ?? 0) + 1)
    watchers.get(ns)?.()
  })
  const deleteRecord = vi.fn()
  const modifyRecord = vi.fn(async (_key: string, change: (record: typeof grant) => Promise<typeof grant | undefined>) => {
    const next = await change(grant)
    if (next !== undefined && JSON.stringify(next) !== JSON.stringify(grant)) throw new Error('Unexpected credential write')
    return grant
  })
  await ctx.plugin({ apply(owner: Context) {
    owner.provide('credentials', {
      readRecord: async () => grant,
      describeRecord: async () => ({ configured: true, writable: true }),
      listRecords: async () => [{ key: KEY, kind: 'grant' }], modifyRecord, deleteRecord,
    } as unknown as Context['credentials'])
    owner.provide('settings', {
      get: (ns: string) => documents[ns],
      describe: () => Object.entries(documents).map(([ns, user]) => ({ ns, revision: revisions.get(ns) ?? 0, user, value: user })),
      mutate,
      installSection(_owner: Context, ns: string, _schema: unknown, entry: unknown,
        hooks: { setSource(source: () => unknown): void; onChange(): void }) {
        documents[ns] ??= entry
        hooks.setSource(() => documents[ns])
        watchers.set(ns, hooks.onChange)
        hooks.onChange()
      },
    } as unknown as Context['settings'])
    owner.provide('systemPrompt', { section: () => () => undefined } as unknown as Context['systemPrompt'])
    owner.provide('web', { registerSearchProvider: () => () => undefined } as unknown as Context['web'])
    owner.provide('agentDefaultModel', { currentSelection: () => ({ provider: legacy ? 'github-copilot' : MANAGED, model: 'future-account-model' }) } as Context['agentDefaultModel'])
  } })
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(AuthorizationService)
  await ctx.plugin(CorePiAi, documents['llm-pi-ai'] as ReturnType<typeof CorePiAi.Config>)
  await ctx.plugin(Companion, companionConfig)
  await vi.waitFor(() => expect(ctx.get('githubCopilotAuthorization')).toBeDefined())
  await ctx.get('githubCopilotPreview')!.refresh()
  return { ctx, documents, grant, mutate, deleteRecord, modifyRecord }
}

describe('single managed Copilot route with native OAuth', () => {
  it('keeps the native login flow while exposing only the account-driven provider', async () => {
    const fetch = vi.fn(async () => { throw new Error('No eager discovery or model request') })
    vi.stubGlobal('fetch', fetch)
    const h = await runtime()
    expect(h.ctx.authorization.describe(parseCredentialKey(KEY))?.methods.some(method => method.id === 'oauth')).toBe(true)
    expect(h.ctx.llm.listProviders().map(provider => provider.id)).toEqual([MANAGED])
    const status = await h.ctx.get('githubCopilotAuthorization')!.status()
    expect(status).toMatchObject({ configured: true, phase: 'signed-in', route: { state: 'not-configured' } })
    expect(await Companion.ensureGitHubCopilotProviderProfile(h.ctx)).toBe(false)
    expect(h.mutate).not.toHaveBeenCalled()
    expect(h.deleteRecord).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('discovers new IDs and reasoning metadata without a canonical model profile', async () => {
    const fetch = vi.fn(async (url: unknown) => {
      expect(String(url)).toMatch(/\/models$/)
      return new Response(JSON.stringify({ data: [{ id: 'future-account-model', name: 'Future model', model_picker_enabled: true,
        policy: { state: 'enabled' }, supported_endpoints: ['/responses'],
        capabilities: { supports: { streaming: true, tool_calls: true, reasoning_effort: ['low', 'high'] },
          limits: { max_context_window_tokens: 128000, max_prompt_tokens: 100000, max_output_tokens: 16000 } },
      }] }), { headers: { 'content-type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetch)
    const h = await runtime()
    const view = await h.ctx.get('githubCopilotAuthorization')!.discoverModels()
    expect(view.accountModels).toMatchObject({ state: 'ready', models: [{ id: 'future-account-model', api: 'openai-responses' }] })
    expect(h.ctx.llm.listProviders().map(provider => ({ id: provider.id, name: provider.name }))).toEqual([{ id: MANAGED, name: 'GitHub Copilot' }])
    expect((await h.ctx.llm.listModels(MANAGED)).map(model => model.id)).toEqual(['future-account-model'])
    const model = await h.ctx.llm.resolveModelInfo(MANAGED, 'future-account-model')
    expect(model.reasoning?.efforts.map(effort => effort.id)).toEqual(['low', 'high'])
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(h.mutate).not.toHaveBeenCalled()
    expect(h.deleteRecord).not.toHaveBeenCalled()
  })

  it('honors an explicit legacy-profile removal without deleting OAuth or rebuilding the route', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('No implicit network during migration') }))
    const h = await runtime(true)
    expect(h.ctx.llm.listProviders().map(provider => provider.id)).toContain('github-copilot')
    // Simulate ONLY the explicitly authorized last settings step. Selecting a
    // new default and migrating active sessions is a separate user action.
    await h.ctx.settings.mutate('llm-pi-ai' as never, [{ op: 'unset', path: ['providers', 'github-copilot'] }])
    await Companion.ensureGitHubCopilotProviderProfile(h.ctx)
    await h.ctx.get('githubCopilotAuthorization')!.reconcile()
    expect(h.ctx.llm.listProviders().map(provider => provider.id)).toEqual([MANAGED])
    expect(h.ctx.authorization.describe(parseCredentialKey(KEY))?.methods.some(method => method.id === 'oauth')).toBe(true)
    expect(h.mutate).toHaveBeenCalledOnce()
    expect(h.deleteRecord).not.toHaveBeenCalled()
    expect(h.ctx.agentDefaultModel.currentSelection().provider).toBe('github-copilot')
  })
})
