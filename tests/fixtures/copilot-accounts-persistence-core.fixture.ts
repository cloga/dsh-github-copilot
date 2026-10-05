import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { boot, initProfile, readProfilePatches, type ProfileContext } from '@deepseek-ai/dsh-app-boot'
import ConfigEditor from '@deepseek-ai/dsh-config-editor'
import Settings from '@deepseek-ai/dsh-settings'
import { LocalCredentialProvider } from '@deepseek-ai/dsh-credentials-local'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import Authorization from '@deepseek-ai/dsh-authorization'
import { createModels } from '@earendil-works/pi-ai'
import { githubCopilotProvider } from '@earendil-works/pi-ai/providers/github-copilot'
import { Config as PiAiConfig } from '@deepseek-ai/dsh-llm-pi-ai'
import { expect, it, vi } from 'vitest'
import { Config } from '../../src/config.ts'
import { CopilotAccountsHost } from '../../src/copilot-accounts-host.ts'
import { createGitHubCopilotCredentialStore } from '../../src/copilot-auth.ts'
import { GitHubCopilotAuthorizationController } from '../../src/authorization-controller.ts'
import { migrationStatus } from '../../src/migration-status.ts'
import { SessionAccountsHost } from '../../src/session-accounts-host.ts'
import { installSessionContinuation } from '../../src/session-continuation-host.ts'
import type { Agent } from '@deepseek-ai/dsh-agent'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const key = (id: string) => credentialKey('github-copilot', `account-${id}`)
const grant = (id: string) => ({ kind: 'grant' as const, payload: {
  type: 'oauth', refresh: `synthetic-${id}`, access: `synthetic-access-${id}`, expires: 0,
} })

it('persists independent native credentials and SettingsForms CAS across profile restart without cross-account OAuth writes', async () => {
  expect(process.env.DSH_CORE_EVIDENCE).toBe('tagged-source-runtime')
  const home = await mkdtemp(join(tmpdir(), 'copilot-accounts-persistence-'))
  const dir = join(home, 'profiles', 'synthetic')
  const contexts: Context[] = []
  const hosts: CopilotAccountsHost[] = []
  try {
    initProfile(dir, ['synthetic-bundle'])
    const bundle = join(dir, 'node_modules', 'synthetic-bundle')
    await mkdir(bundle, { recursive: true })
    await writeFile(join(home, 'package.json'), '{"name":"synthetic-installation"}')
    await writeFile(join(bundle, 'package.json'), JSON.stringify({
      name: 'synthetic-bundle', version: '1.0.0', dsh: { bundle: { patch: 'cordis.patch.yml' } },
    }))
    await writeFile(join(bundle, 'cordis.patch.yml'), JSON.stringify([{ insert: [
      { id: 'config-editor', name: 'cordis:editor' }, { id: 'settings', name: 'cordis:settings' },
      { id: 'github-copilot', name: 'cordis:selector', config: {} },
      { id: 'llm-pi-ai', name: 'cordis:provider-config', config: { providers: {} } },
    ] }]))
    await writeFile(join(dir, 'cordis.yml'), '[]\n')
    const profile: ProfileContext = { name: 'synthetic', startedBundles: ['synthetic-bundle'], dir,
      patchPath: join(dir, 'cordis.patch.yml'), installAnchor: join(home, 'package.json'),
      cwd: home, home, overlays: [], telemetryDisabledEnv: undefined }
    const start = async () => {
      const ctx = await boot('synthetic', join(dir, 'cordis.yml'), readProfilePatches('synthetic', profile), scope => {
        scope.provide('profileContext', profile)
        scope.provide('appReady', { onReady: (listener: () => void) => { listener(); return () => {} } })
        Object.assign(scope.loader.builtins, { editor: ConfigEditor, settings: Settings,
          selector: { Config, apply() {} }, 'provider-config': { Config: PiAiConfig, apply() {} } })
      })
      contexts.push(ctx)
      await ctx.plugin(LocalCredentialProvider, { path: join(dir, '.credentials.yaml'), dshHome: home, watch: false })
      await ctx.plugin(Authorization)
      ctx.provide('agents', { list: () => [] })
      ctx.provide('sessionProjections', { stateOf: () => undefined })
      ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'github-copilot-preview', model: 'synthetic' }) })
      ctx.provide('llm', { listProviders: () => [{ id: 'github-copilot-preview' }] })
      expect(Reflect.get(ctx.settings, 'get')).toBeUndefined()
      expect(migrationStatus(ctx)).toMatchObject({
        capabilities: { settingsCas: true },
        complete: { routes: true, sessions: true, defaultSelection: true },
        routes: { nativeConfigured: false, nativeRegistered: false, managedRegistered: true },
      })
      const host = new CopilotAccountsHost(ctx, {
        validateModels: async () => {},
        fetch: async (_input, init) => {
          const token = new Headers(init?.headers).get('Authorization')
          return Response.json({ login: token === `token synthetic-${A}` ? 'account-a'
            : token === 'token synthetic-new-user' ? 'new-user'
            : token === 'token synthetic-recovery-user' ? 'recovery-user' : 'account-b',
            id: token === `token synthetic-${A}` ? 1 : token === 'token synthetic-new-user' ? 3
              : token === 'token synthetic-recovery-user' ? 4 : 2 })
        },
      })
      hosts.push(host)
      ctx.provide('githubCopilotAccounts', { host, get: () => host.get() })
      const sessionAccounts = new SessionAccountsHost(ctx)
      ctx.provide('githubCopilotSessionAccounts', sessionAccounts)
      ctx.effect(() => () => sessionAccounts.dispose())
      const continuation = installSessionContinuation(ctx)
      ctx.effect(() => () => continuation.dispose())
      await continuation.ready
      return { ctx, host, sessionAccounts }
    }
    let { ctx, host } = await start()
    const providerRevision = () => ctx.settings.describe().find(row => row.ns === 'llm-pi-ai')!.revision
    await ctx.settings.mutate('llm-pi-ai', [
      { op: 'set', path: ['providers', 'github-copilot'], value: {} },
    ], providerRevision())
    expect(await host.get()).toMatchObject({ switchable: false, diagnostic: 'COPILOT_ACCOUNTS_ROUTE_BLOCKED' })
    await ctx.settings.mutate('llm-pi-ai', [
      { op: 'unset', path: ['providers', 'github-copilot'] },
    ], providerRevision())
    await ctx.credentials.modifyRecord(key(A), async () => grant(A))
    await ctx.credentials.modifyRecord(key(B), async () => grant(B))
    const selectorFiber = [...ctx.loader.entries()].find(entry => entry.options.id === 'github-copilot')!.fiber
    const revision = (await host.get()).revision!
    expect(await host.switchAccount(A, revision)).toMatchObject({ state: 'ready', activeAccountId: A })
    expect([...ctx.loader.entries()].find(entry => entry.options.id === 'github-copilot')!.fiber).toBe(selectorFiber)
    const viewedSession = { session: { id: 'synthetic-session-override' } }
    const defaults = await ctx.githubCopilotSessionContinuation.defaults()
    expect(defaults.enabled).toBe(true)
    const initialHistory = ctx.settings.describe().find(row => row.ns === 'github-copilot')!.value as {
      continuationDefaultHistory: { enabled: boolean; changedAt: number }[]
    }
    const fresh = { session: { id: 'synthetic-fresh', header: {
      isSeeded: false, createdAt: initialHistory.continuationDefaultHistory[0]!.changedAt + 1,
    } } } as unknown as Agent
    expect((await ctx.githubCopilotSessionContinuation.get(fresh)).enabled).toBe(true)
    await ctx.githubCopilotSessionContinuation.setDefault(defaults.revision, false)
    const oneShot = { session: { id: 'synthetic-once' } } as Agent
    await ctx.githubCopilotSessionContinuation.authorizeNext(oneShot, (await host.get()).revision!, true)
    await ctx.githubCopilotSessionContinuation.set(viewedSession as Agent, (await host.get()).revision!, true)
    await ctx.githubCopilotSessionAccounts.set(viewedSession, B, (await host.get()).revision!)
    expect(ctx.githubCopilotSessionAccounts.selected(viewedSession)).toEqual({ accountId: B, source: 'session' })
    expect((await ctx.githubCopilotSessionContinuation.get(viewedSession as Agent)).enabled).toBe(true)
    expect((await ctx.githubCopilotSessionContinuation.defaults()).enabled).toBe(false)
    expect((await ctx.githubCopilotSessionContinuation.get(fresh)).enabled).toBe(true)
    expect((await ctx.githubCopilotSessionContinuation.get(oneShot)).nextTurnAuthorized).toBe(true)
    expect(ctx.githubCopilotSessionAccounts.selected({ session: { id: 'synthetic-inherited' } }))
      .toEqual({ accountId: A, source: 'global' })
    expect([...ctx.loader.entries()].find(entry => entry.options.id === 'github-copilot')!.fiber).toBe(selectorFiber)
    await expect(ctx.settings.mutate('github-copilot', [{ op: 'set', path: ['activeAccountId'], value: B }], revision))
      .rejects.toThrow('changed since it was read')
    host.dispose()
    await ctx.fiber.dispose()
    const reopened = await start()
    ctx = reopened.ctx
    host = reopened.host
    expect(await host.get()).toMatchObject({ state: 'ready', activeAccountId: A })
    expect((await ctx.githubCopilotSessionContinuation.get(viewedSession as Agent)).enabled).toBe(true)
    expect((await ctx.githubCopilotSessionContinuation.defaults()).enabled).toBe(false)
    expect((await ctx.githubCopilotSessionContinuation.get(fresh)).enabled).toBe(true)
    expect((await ctx.githubCopilotSessionContinuation.get(oneShot)).nextTurnAuthorized).toBe(false)
    expect(ctx.githubCopilotSessionAccounts.selected(viewedSession)).toEqual({ accountId: B, source: 'session' })
    expect(await ctx.credentials.readRecord(key(A))).toEqual(grant(A))
    const beforeB = await ctx.credentials.readRecord(key(B))
    expect(beforeB).toEqual(grant(B))
    let oauthToken = 'synthetic-wrong-user'
    vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
      const url = String(input)
      if (url.endsWith('/copilot_internal/v2/token')) return Response.json({
        token: 'synthetic-refreshed-a', expires_at: Math.floor(Date.now() / 1000) + 7200,
      })
      if (url.endsWith('/login/device/code')) return Response.json({
        device_code: 'synthetic-device', user_code: 'SYNTHETIC', verification_uri: 'https://github.com/login/device',
        interval: 0.001, expires_in: 60,
      })
      if (url.endsWith('/login/oauth/access_token')) return Response.json({ access_token: oauthToken })
      if (url.endsWith('/models')) return Response.json({ data: [] })
      throw new Error('Unexpected synthetic URL')
    }))
    const models = createModels({ credentials: createGitHubCopilotCredentialStore(ctx, 'github-copilot', host.capture()) })
    const provider = githubCopilotProvider()
    models.setProvider({ ...provider, auth: { oauth: provider.auth.oauth } })
    await models.getAuth('github-copilot')
    expect(await ctx.credentials.readRecord(key(A))).toMatchObject({ payload: { access: 'synthetic-refreshed-a' } })
    expect(await ctx.credentials.readRecord(key(B))).toEqual(beforeB)
    const beforeA = await ctx.credentials.readRecord(key(A))
    await host.reauthorize(A, (await host.get()).revision!)
    await vi.waitFor(async () => expect((await host.get()).operation).toBeUndefined(), { timeout: 15_000 })
    expect(await host.get()).toMatchObject({ diagnostic: 'COPILOT_ACCOUNTS_IDENTITY_CHANGED' })
    expect(await ctx.credentials.readRecord(key(A))).toEqual(beforeA)
    expect(await ctx.credentials.readRecord(key(B))).toEqual(beforeB)
    await host.add()
    await host.cancel()
    await vi.waitFor(async () => expect((await host.get()).operation).toBeUndefined(), { timeout: 15_000 })
    expect((await ctx.credentials.listRecords()).filter(row => row.key.startsWith('github-copilot/account-'))).toHaveLength(2)
    expect(await ctx.credentials.readRecord(key(B))).toEqual(beforeB)
    oauthToken = 'synthetic-new-user'
    await host.add()
    await vi.waitFor(async () => expect((await host.get()).operation).toBeUndefined(), { timeout: 15_000 })
    expect(await host.get()).toMatchObject({ state: 'ready', activeAccountId: A })
    const added = (await ctx.credentials.listRecords()).find(row => row.key !== key(A) && row.key !== key(B))!
    expect(await ctx.credentials.readRecord(added.key)).toMatchObject({ payload: { refresh: 'synthetic-new-user' } })
    expect(await ctx.credentials.readRecord(key(B))).toEqual(beforeB)
    host.dispose()
    await ctx.fiber.dispose()
    const restored = await start()
    ctx = restored.ctx
    host = restored.host
    expect(await host.get()).toMatchObject({ activeAccountId: A })
    expect(await ctx.credentials.readRecord(key(A))).toEqual(beforeA)
    expect(await ctx.credentials.readRecord(key(B))).toEqual(beforeB)
    expect(await ctx.credentials.readRecord(added.key)).toMatchObject({ payload: { refresh: 'synthetic-new-user' } })
    await host.signOutActive()
    const missing = await host.get()
    expect(missing).toMatchObject({ state: 'error', activeAccountId: A, switchable: true,
      diagnostic: 'COPILOT_ACCOUNTS_SELECTED_MISSING' })
    const authorization = new GitHubCopilotAuthorizationController(ctx)
    const beforeSignInCalls = vi.mocked(globalThis.fetch).mock.calls.length
    expect(await authorization.start()).toMatchObject({ phase: 'error', configured: false,
      error: 'COPILOT_ACCOUNTS_SELECTED_MISSING' })
    expect(vi.mocked(globalThis.fetch).mock.calls).toHaveLength(beforeSignInCalls)
    expect(await host.reauthorize(A, missing.revision!)).toMatchObject({ diagnostic: 'COPILOT_ACCOUNTS_SELECTED_MISSING' })
    oauthToken = 'synthetic-recovery-user'
    expect(await host.add()).toMatchObject({ operation: 'authorizing', activeAccountId: A })
    await vi.waitFor(async () => expect((await host.get()).operation).toBeUndefined(), { timeout: 15_000 })
    expect(await host.get()).toMatchObject({ activeAccountId: A, diagnostic: 'COPILOT_ACCOUNTS_SELECTED_MISSING' })
    expect(await ctx.credentials.readRecord(key(A))).toBeUndefined()
    expect((await ctx.credentials.listRecords()).filter(row => row.key.startsWith('github-copilot/account-'))).toHaveLength(3)
    expect(await host.switchAccount(B, missing.revision!)).toMatchObject({ state: 'ready', activeAccountId: B })
    expect(await ctx.credentials.readRecord(key(A))).toBeUndefined()
    expect(await ctx.credentials.readRecord(key(B))).toEqual(beforeB)
  } finally {
    for (const host of hosts) host.dispose()
    for (const ctx of contexts.reverse()) await ctx.fiber.dispose()
    vi.unstubAllGlobals()
    await rm(home, { recursive: true, force: true })
  }
}, 60_000)
