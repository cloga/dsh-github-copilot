import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { boot, initProfile, readProfilePatches, type ProfileContext } from '@deepseek-ai/dsh-app-boot'
import ConfigEditor from '@deepseek-ai/dsh-config-editor'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import * as LlmPiAi from '@deepseek-ai/dsh-llm-pi-ai'
import Settings from '@deepseek-ai/dsh-settings'
import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all'
import { expect, it, vi } from 'vitest'
import { Config } from '../../src/config.ts'
import { CopilotAccountsHost } from '../../src/copilot-accounts-host.ts'
import { GitHubCopilotAuthorizationController } from '../../src/authorization-controller.ts'
import type { AccountModelDescriptor } from '../../src/account-model-catalog.ts'
import type { GitHubCopilotPreviewView } from '../../src/preview-route.ts'
import { GITHUB_COPILOT_PREVIEW_PROVIDER_ID } from '../../src/copilot-identity.ts'

const provider = 'github-copilot'
const synced = 'synthetic-native-sync'
const excluded = 'synthetic-excluded'

function model(id: string): AccountModelDescriptor {
  return {
    id, name: `Account ${id}`, api: 'openai-responses', contextWindow: 128_000,
    maxInputTokens: 128_000, maxTokens: 8_192, input: ['text'],
    reasoning: { advertisedEfforts: ['low', 'high'], unmappedEfforts: [] },
    evidence: {
      endpoints: ['/responses'], unsupportedEndpointCount: 0, selectedEndpoint: '/responses',
      apiSource: 'advertised-priority', policySource: 'server-enabled',
      contextWindowSource: 'max_context_window_tokens',
    },
  }
}

it('syncs a confirmed snapshot through real native Settings and the pinned model catalog across restart', async () => {
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
        providers: { [provider]: { api: 'openai-responses', models: [{ id: 'old-native-model' }] } },
      } },
    ] }]))
    await writeFile(join(dir, 'cordis.yml'), '[]\n')
    const profile: ProfileContext = {
      name: 'synthetic', startedBundles: ['synthetic-bundle'], dir, patchPath: join(dir, 'cordis.patch.yml'),
      installAnchor: join(home, 'package.json'), cwd: home, home, overlays: [], telemetryDisabledEnv: undefined,
    }
    const accountModels = [model(synced), model(excluded), { ...model('bounded-input'), maxInputTokens: 64_000 }]
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
        refresh: async () => view,
        nativeModelSyncSnapshot: () => ({ generation: 1, fetchedAt: 123, models: accountModels }),
        captureSearchProof: () => () => true,
        recoveryLimits: () => undefined,
        routeFacts: () => undefined,
        resolveRequestAuth: async () => { throw new Error('unexpected fixture auth request') },
      })
      return { ctx, host }
    }
    let { ctx, host } = await start()
    const controller = new GitHubCopilotAuthorizationController(ctx)
    const preview = await controller.previewNativeModelSync()
    expect(preview).toMatchObject({
      state: 'ready', enabledCount: 2, syncableCount: 1,
      addedIds: [synced], removedIds: ['old-native-model'],
      skipped: [{ id: 'bounded-input', code: 'NATIVE_INPUT_LIMIT_UNSUPPORTED' }],
    })
    expect((await ctx.llm.listModels(provider)).map(entry => entry.id)).toEqual(['old-native-model'])
    if (preview.planId === undefined) throw new Error('fixture preview lacks a plan')
    expect(await controller.applyNativeModelSync(preview.planId)).toEqual({ state: 'ready', modelCount: 1 })
    await vi.waitFor(async () => expect((await ctx.llm.listModels(provider)).map(entry => entry.id)).toEqual([synced]))
    expect(await ctx.llm.resolveModelInfo(provider, synced)).toMatchObject({
      id: synced, context: { contextWindow: 128_000 }, defaultMaxTokens: 8_192,
      reasoning: { efforts: expect.arrayContaining([expect.objectContaining({ id: 'low' }), expect.objectContaining({ id: 'high' })]) },
    })
    host.dispose()
    await ctx.fiber.dispose()
    ;({ ctx, host } = await start())
    expect((await ctx.llm.listModels(provider)).map(entry => entry.id)).toEqual([synced])

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
