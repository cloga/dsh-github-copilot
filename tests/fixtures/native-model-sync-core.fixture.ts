import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { boot, initProfile, readProfilePatches, type ProfileContext } from '@deepseek-ai/dsh-app-boot'
import ConfigEditor from '@deepseek-ai/dsh-config-editor'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import * as LlmPiAi from '@deepseek-ai/dsh-llm-pi-ai'
import Settings from '@deepseek-ai/dsh-settings'
import { getSupportedThinkingLevels } from '@earendil-works/pi-ai'
import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all'
import { expect, it, vi } from 'vitest'
import { Config } from '../../src/config.ts'
import { CopilotAccountsHost } from '../../src/copilot-accounts-host.ts'
import { GitHubCopilotAuthorizationController } from '../../src/authorization-controller.ts'
import type { AccountModelDescriptor } from '../../src/account-model-catalog.ts'
import type { GitHubCopilotPreviewView } from '../../src/preview-route.ts'
import { GITHUB_COPILOT_PREVIEW_PROVIDER_ID } from '../../src/copilot-identity.ts'

// The native Loader/package proof is tested separately; this fixture isolates Settings persistence.
vi.mock('../../src/native-copilot-access.ts', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/native-copilot-access.ts')>()
  const { getBuiltinModels: getFixtureCatalog } = await import('@earendil-works/pi-ai/providers/all')
  return { ...original, captureNativeCopilotCatalog: async (ctx: Context) => {
    const revision = ctx.settings.describe({ redactSecrets: true }).find(row => row.ns === 'llm-pi-ai')?.revision
    if (revision === undefined) return undefined
    const catalog = new Map(getFixtureCatalog('github-copilot').map(({ id, api }) => [id, { id, api }]))
    return {
      namespace: 'llm-pi-ai', catalog, configuredModels: undefined, accountModelIds: undefined,
      assertCurrent() {
        if (ctx.settings.describe({ redactSecrets: true }).find(row => row.ns === 'llm-pi-ai')?.revision !== revision) {
          throw new Error('COPILOT_NATIVE_ROUTE_CHANGED')
        }
      },
    }
  } }
})

const provider = 'github-copilot'
const nativeModel = getBuiltinModels(provider).find(model => model.api === 'openai-responses' && model.reasoning)
if (nativeModel === undefined) throw new Error('fixture requires a native Responses catalog entry')
const synced = nativeModel.id
const previousModel = getBuiltinModels(provider).find(model => model.api === 'openai-responses' && model.id !== synced)
if (previousModel === undefined) throw new Error('fixture requires a second native Responses entry')
const previous = previousModel.id
const future = 'not-in-native-catalog'
const excluded = 'synthetic-excluded'

function model(id: string): AccountModelDescriptor {
  return {
    id, name: `Account ${id}`, api: 'openai-responses', contextWindow: 128_000,
    maxInputTokens: 128_000, maxTokens: 8_192, input: ['text'],
    reasoning: { advertisedEfforts: ['low', 'high'], unmappedEfforts: [] },
    evidence: {
      endpoints: ['/responses'], unsupportedEndpointCount: 0, selectedEndpoint: '/responses',
      apiSource: 'advertised-priority', policySource: 'server-enabled',
      contextWindowSource: 'max_context_window_tokens', visionSupportKnown: true, reasoningEffortsKnown: true,
    },
  }
}

it('syncs a confirmed snapshot and conditional route API through real native Settings and model resolution across restart using synthetic catalog proof', async () => {
  expect(process.env.DSH_CORE_EVIDENCE).toBe('tagged-source-runtime')
  expect(process.env.DSH_PUBLISHED_CORE_RELEASE).toBe('0.2.2-rc.3')
  const home = await mkdtemp(join(tmpdir(), 'copilot-native-sync-'))
  const dir = join(home, 'profiles', 'synthetic')
  const contexts: Context[] = []
  const hosts: CopilotAccountsHost[] = []
  const fetcher = vi.fn(async () => { throw new Error('unexpected fixture network request') })
  vi.stubGlobal('fetch', fetcher)
  try {
    initProfile(dir, ['synthetic-bundle'])
    const bundle = join(dir, 'node_modules', 'synthetic-bundle')
    await mkdir(bundle, { recursive: true })
    await writeFile(join(home, 'package.json'), '{"name":"synthetic-installation"}')
    await writeFile(join(bundle, 'package.json'), JSON.stringify({
      name: 'synthetic-bundle', version: '1.0.0', dsh: { bundle: { patch: 'cordis.patch.yml' } },
    }))
    await writeFile(join(bundle, 'cordis.patch.yml'), JSON.stringify([{ insert: [
      { id: 'config-editor', name: 'cordis:editor' },
      { id: 'settings', name: 'cordis:settings' },
      { id: 'github-copilot', name: 'cordis:selector', config: { excludedModelIds: [excluded] } },
      { id: 'llm', name: 'cordis:llm' },
      { id: 'llm-pi-ai', name: 'cordis:native-provider', config: {
        providers: { [provider]: { compat: { supportsStrictMode: false },
          models: [{ id: previous }] } },
      } },
    ] }]))
    await writeFile(join(dir, 'cordis.yml'), '[]\n')
    const profile: ProfileContext = {
      name: 'synthetic', startedBundles: ['synthetic-bundle'], dir, patchPath: join(dir, 'cordis.patch.yml'),
      installAnchor: join(home, 'package.json'), cwd: home, home, overlays: [], telemetryDisabledEnv: undefined,
    }
    const accountModels = [{ ...model(synced), maxInputTokens: 64_000 }, model(excluded), model(future)]
    const view: GitHubCopilotPreviewView = {
      provider: GITHUB_COPILOT_PREVIEW_PROVIDER_ID, configured: true, available: true, correctionActive: true,
      state: 'ready', models: accountModels, rejected: [], warnings: [], discoveredAt: 123,
    }
    const start = async () => {
      const ctx = await boot('synthetic', join(dir, 'cordis.yml'), readProfilePatches('synthetic', profile), scope => {
        scope.provide('profileContext', profile)
        scope.provide('appReady', { onReady: (listener: () => void) => { listener(); return () => {} } })
        Object.assign(scope.loader.builtins, {
          editor: ConfigEditor, settings: Settings, llm: LlmRuntime, 'native-provider': LlmPiAi,
          selector: { Config, apply() {} },
        })
      })
      contexts.push(ctx)
      const host = new CopilotAccountsHost(ctx)
      hosts.push(host)
      ctx.provide('githubCopilotAccounts', { host, get: () => host.get() })
      ctx.provide('githubCopilotPreview', {
        getView: () => view,
        discover: async () => view,
        discoverNativeModelSync: async () => view,
        refresh: async () => view,
        nativeModelSyncSnapshot: () => ({ generation: 1, fetchedAt: 123, models: accountModels, isCurrent: () => true }),
        captureSearchProof: () => () => true,
        recoveryLimits: () => undefined,
        routeFacts: () => undefined,
        resolveRequestAuth: async () => { throw new Error('unexpected fixture auth request') },
      })
      return { ctx, host }
    }
    let { ctx, host } = await start()
    const controller = new GitHubCopilotAuthorizationController(ctx)
    let preview = await controller.prepareNativeModelSync()
    expect(preview).toMatchObject({
      state: 'ready', enabledCount: 2, syncableCount: 2,
      addedIds: [synced, future], removedIds: [previous],
      outputTokenDefaults: [],
      skipped: [], nativeCatalogMissingIds: [future],
      routeApiChange: 'openai-responses',
    })
    expect((await ctx.llm.listModels(provider)).map(entry => entry.id)).toEqual([previous])
    if (preview.planId === undefined) throw new Error('fixture preview lacks a plan')
    expect(await controller.applyNativeModelSync(preview.planId)).toEqual({ state: 'ready', modelCount: 2 })
    const settings = ctx.settings.describe().find(row => row.ns === 'llm-pi-ai')!
    expect(settings.value).toMatchObject({ providers: { [provider]: {
      api: 'openai-responses', compat: { supportsStrictMode: false },
    } } })
    await vi.waitFor(async () => expect((await ctx.llm.listModels(provider)).map(entry => entry.id)).toEqual([synced, future]))
    expect(await ctx.llm.resolveModelInfo(provider, synced)).toMatchObject({
      id: synced, context: { contextWindow: nativeModel.contextWindow },
      inputModalities: nativeModel.input,
    })
    expect(await ctx.llm.resolveModelInfo(provider, synced)).not.toHaveProperty('defaultMaxTokens')
    expect((await ctx.llm.resolveModelInfo(provider, synced)).reasoning?.efforts.map(effort => effort.id))
      .toEqual(getSupportedThinkingLevels(nativeModel))
    expect(settings.user).toMatchObject({ providers: { [provider]: { models: [{ id: synced }, { id: future }] } } })
    expect(settings.user).toMatchObject({ providers: { [provider]: { api: 'openai-responses' } } })
    host.dispose()
    await ctx.fiber.dispose()
    ;({ ctx, host } = await start())
    expect((await ctx.llm.listModels(provider)).map(entry => entry.id)).toEqual([synced, future])
    expect(await ctx.llm.resolveModelInfo(provider, synced)).toMatchObject({
      id: synced, context: { contextWindow: nativeModel.contextWindow },
    })
    expect(await ctx.llm.resolveModelInfo(provider, synced)).not.toHaveProperty('defaultMaxTokens')
    expect(ctx.settings.describe().find(row => row.ns === 'llm-pi-ai')?.value).toMatchObject({
      providers: { [provider]: { api: 'openai-responses', compat: { supportsStrictMode: false } } },
    })

    const known = getBuiltinModels(provider)[0]
    if (known === undefined) throw new Error('fixture native catalog is empty')
    const revision = ctx.settings.describe().find(row => row.ns === 'llm-pi-ai')!.revision
    await ctx.settings.mutate('llm-pi-ai', [
      { op: 'set', path: ['providers', provider, 'models'], value: [] },
      { op: 'set', path: ['providers', provider, 'modelOverrides'], value: { [known.id]: { maxTokens: 1_024 } } },
    ], revision)
    expect(await new GitHubCopilotAuthorizationController(ctx).previewNativeModelSync()).toMatchObject({
      state: 'blocked', code: 'NATIVE_MODEL_SYNC_OVERRIDES_CONFLICT',
    })
    expect(fetcher).not.toHaveBeenCalled()
  } finally {
    for (const host of hosts) host.dispose()
    await Promise.all(contexts.map(ctx => ctx.fiber.dispose()))
    vi.unstubAllGlobals()
    await rm(home, { recursive: true, force: true })
  }
}, 30_000)
