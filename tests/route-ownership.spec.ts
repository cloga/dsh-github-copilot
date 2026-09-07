import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { describeGitHubCopilotProviderProfile, inspectGitHubCopilotProviderProfile } from '../src/authorization-controller.ts'
import { ROUTE_OWNERSHIP_EPOCH, leavesOf, type RouteMutation } from '../src/route-ownership.ts'

// Historical persisted values, deliberately independent of the current preview
// implementation. New code must restore these records, never recreate them.
const LEGACY_HEADERS: Readonly<Record<string, string>> = {
  'User-Agent': 'GitHubCopilotChat/0.35.0',
  'Editor-Version': 'vscode/1.107.0',
  'Editor-Plugin-Version': 'copilot-chat/0.35.0',
  'Copilot-Integration-Id': 'vscode-chat',
}
const LEGACY_MODEL = {
  id: 'gpt-6-astra', name: 'GPT-6 Astra', api: 'openai-responses',
  contextWindow: 1_050_000, maxTokens: 128_000, input: ['text', 'image'],
  reasoningEfforts: { off: null, low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' },
}
type LegacyStage = 'applied' | 'prepared' | 'restoring' | 'restored'

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  fetchMock = vi.fn(async () => { throw new Error('network is forbidden in ownership planning tests') })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  try { expect(fetchMock).not.toHaveBeenCalled() }
  finally { vi.unstubAllGlobals() }
})

function runtime(initial?: Record<string, unknown>) {
  const documents: Record<string, Record<string, unknown>> = {
    'llm-pi-ai': { providers: { ...initial === undefined ? {} : { 'github-copilot': structuredClone(initial) }, other: { untouched: true } } },
    'github-copilot': {},
  }
  const revisions: Record<string, number> = { 'llm-pi-ai': 0, 'github-copilot': 0 }
  let available = ['gpt-6-astra']
  let before: ((namespace: string, operations: readonly RouteMutation[]) => void) | undefined
  let defaults: Record<string, unknown> | undefined
  let base: Record<string, unknown> | undefined
  let secrets: { path: string[]; set: boolean }[] = []
  let materializeModels = false
  let stripModelApi = false
  const mutate = vi.fn(async (namespace: string, operations: readonly RouteMutation[], revision?: number) => {
    before?.(namespace, operations)
    if (revision !== revisions[namespace]) throw Object.assign(new Error('sensitive external error'), { code: 'SETTINGS_CONFLICT' })
    for (const operation of operations) {
      let target = documents[namespace]!
      for (const key of operation.path.slice(0, -1)) {
        target[key] ??= {}
        target = target[key] as Record<string, unknown>
      }
      const key = operation.path.at(-1)!
      if (operation.op === 'unset') delete target[key]
      else target[key] = structuredClone(operation.value)
    }
    revisions[namespace] = revisions[namespace]! + 1
  })
  const profile = () => (documents['llm-pi-ai']!.providers as Record<string, Record<string, unknown>>)['github-copilot']
  const settings = {
    get: (namespace: string) => {
      const section = structuredClone(documents[namespace])
      if (namespace === 'llm-pi-ai' && defaults && profile()) {
        (section!.providers as Record<string, unknown>)['github-copilot'] = { ...defaults, ...profile() }
      }
      if (namespace === 'llm-pi-ai' && materializeModels && profile()?.models) {
        const resolved = (section!.providers as Record<string, Record<string, unknown>>)['github-copilot']!
        resolved.models = (profile()!.models as Record<string, unknown>[]).map(model => {
          const entry: Record<string, unknown> = { input: [], compat: {}, ...model }
          if (stripModelApi) delete entry.api
          return entry
        })
      }
      return section
    },
    describe: vi.fn(() => Object.entries(documents).map(([ns, user]) => ({
      ns, user: structuredClone(user), revision: revisions[ns]!,
      ...ns !== 'llm-pi-ai' ? {} : {
        secrets,
        ...base === undefined ? {} : { base: { providers: { 'github-copilot': structuredClone(base) } } },
      },
    }))),
    mutate,
  }
  const ctx = new Context()
  ctx.get = ((name: string) => name === 'settings' ? settings : name === 'credentials' ? {
    readRecord: async () => ({ kind: 'grant', payload: { type: 'oauth', refresh: 'synthetic-refresh', access: 'synthetic-access', expires: 9_999_999_999_999, availableModelIds: available } }),
  } : undefined) as typeof ctx.get
  const edit = (update: (value: Record<string, unknown>) => void) => {
    update(profile()!)
    revisions['llm-pi-ai']!++
  }
  const legacy = (stage: LegacyStage = 'applied') => {
    const original = structuredClone(initial ?? {})
    const preimage = {
      ...original.api === undefined ? {} : { api: original.api },
      ...original.models === undefined ? {} : { models: structuredClone(original.models) },
    }
    const postimage = { api: 'openai-responses', models: [structuredClone(LEGACY_MODEL)] }
    const headers = (original.headers ?? {}) as Record<string, unknown>
    const ownedHeaders = Object.fromEntries(Object.entries(LEGACY_HEADERS).filter(([name]) =>
      !Object.keys(headers).some(existing => existing.toLowerCase() === name.toLowerCase())))
    const applied = {
      ...original, ...postimage,
      compat: { ...(original.compat as Record<string, unknown> | undefined), supportsStrictMode: false },
      headers: { ...headers, ...ownedHeaders },
    }
    const providers = documents['llm-pi-ai']!.providers as Record<string, unknown>
    if (stage === 'prepared') {
      if (initial === undefined) delete providers['github-copilot']
      else providers['github-copilot'] = original
    } else if (stage === 'restored') {
      providers['github-copilot'] = { ...original, compat: applied.compat, headers: { ...headers } }
    } else providers['github-copilot'] = applied
    documents['github-copilot']!.temporaryRouteBackup = JSON.stringify({
      version: 2, providerExisted: initial !== undefined, preimage, postimage, ownedHeaders,
      phase: stage === 'restoring' || stage === 'restored' ? 'restoring' : 'overlay',
      sourceEpoch: ROUTE_OWNERSHIP_EPOCH, sourceRevision: stage === 'restoring' || stage === 'restored' ? 1 : 0,
      ...stage === 'restoring' || stage === 'restored' ? { target: preimage, removeProfile: false } : {},
    })
    revisions['llm-pi-ai'] = stage === 'prepared' ? 0 : stage === 'restored' ? 2 : 1
    revisions['github-copilot'] = stage === 'restoring' || stage === 'restored' ? 2 : 1
  }
  return { ctx, documents, mutate, settings, profile, edit, legacy,
    retire: (models: string[] = []) => { available = models },
    before: (callback?: typeof before) => { before = callback },
    defaults: (value: Record<string, unknown>) => { defaults = value },
    base: (value: Record<string, unknown>) => { base = value },
    secrets: (value: typeof secrets) => { secrets = value },
    modelDefaults: (stripApi = false) => { materializeModels = true; stripModelApi = stripApi },
    resetRevision: () => { revisions['llm-pi-ai'] = 0 },
    marker: () => documents['github-copilot']!.temporaryRouteBackup,
  }
}

describe('temporary route ownership', () => {
  it('restores a historical bounded journal without copying unrelated sensitive leaves', async () => {
    const harness = runtime({ headers: { Authorization: 'private-header' }, models: [{ id: 'gpt-5.4', api: 'openai-responses' }], userField: 'keep' })
    harness.legacy()
    const marker = harness.marker() as string
    expect(marker).not.toContain('private-header')
    expect(marker).not.toContain('userField')
    expect(JSON.parse(marker)).toMatchObject({ version: 2, phase: 'overlay', preimage: { models: [{ id: 'gpt-5.4', api: 'openai-responses' }] }, postimage: { api: 'openai-responses' } })
    await expect(inspectGitHubCopilotProviderProfile(harness.ctx)).resolves.toMatchObject({ changed: true })
    expect(harness.profile()).toEqual({ headers: { Authorization: 'private-header' }, models: [{ id: 'gpt-5.4', api: 'openai-responses' }], userField: 'keep', compat: { supportsStrictMode: false } })
    expect(harness.marker()).toBeUndefined()
  })

  it('creates only minimal strict-mode configuration without a new canonical override', async () => {
    const harness = runtime()
    await expect(inspectGitHubCopilotProviderProfile(harness.ctx)).resolves.toEqual({ changed: true })
    expect(harness.profile()).toEqual({ compat: { supportsStrictMode: false } })
    expect(harness.mutate).toHaveBeenCalledExactlyOnceWith('llm-pi-ai', [{
      op: 'set', path: ['providers', 'github-copilot', 'compat', 'supportsStrictMode'], value: false,
    }], 0)
    expect(harness.marker()).toBeUndefined()
  })

  it.each(['field', 'header', 'default'])('never deletes a created profile with user %s additions', async (kind) => {
    const harness = runtime()
    harness.legacy()
    harness.edit(profile => {
      if (kind === 'header') (profile.headers as Record<string, unknown>).Authorization = 'private-header'
      else if (kind === 'default') profile.streamIdleTimeoutMs = 300000
      else profile.userField = 'keep'
    })
    harness.retire()
    await inspectGitHubCopilotProviderProfile(harness.ctx)
    expect(harness.profile()).toBeDefined()
    expect(harness.profile()?.api).toBeUndefined()
    expect(harness.profile()?.models).toBeUndefined()
    if (kind === 'header') expect(harness.profile()?.headers).toEqual({ Authorization: 'private-header' })
    else if (kind === 'default') expect(harness.profile()?.streamIdleTimeoutMs).toBe(300000)
    else expect(harness.profile()?.userField).toBe('keep')
  })

  it('deletes only the exact raw plugin-owned profile despite resolved defaults', async () => {
    const harness = runtime()
    harness.defaults({ streamIdleTimeoutMs: 300000, defaultInput: ['text'] })
    harness.legacy()
    harness.retire()
    await inspectGitHubCopilotProviderProfile(harness.ctx)
    expect(harness.profile()).toBeUndefined()
    expect(harness.documents['llm-pi-ai']!.providers).toEqual({ other: { untouched: true } })
  })

  it.each(['base', 'secret'])('does not delete a created profile shadowed by %s ownership', async (kind) => {
    const harness = runtime()
    harness.legacy()
    if (kind === 'base') harness.base({ userField: 'base-only' })
    else harness.secrets([{ path: ['providers', 'github-copilot', 'apiKeyEnv'], set: true }])
    harness.retire()
    await inspectGitHubCopilotProviderProfile(harness.ctx)
    expect(harness.profile()).toBeDefined()
    expect(harness.profile()?.api).toBeUndefined()
    expect(harness.profile()?.models).toBeUndefined()
    expect(harness.marker()).toBeUndefined()
    expect(harness.mutate.mock.calls.flatMap(([, operations]) => operations).some(operation =>
      operation.op === 'unset' && operation.path.length === 2)).toBe(false)
  })

  it.each(['api', 'models'])('refuses restoration of a secret-bearing owned %s leaf', async (field) => {
    const harness = runtime({})
    harness.legacy()
    harness.secrets([{ path: ['providers', 'github-copilot', field], set: true }])
    const before = structuredClone(harness.documents)
    await expect(inspectGitHubCopilotProviderProfile(harness.ctx)).rejects.toMatchObject({ code: 'TEMPORARY_ROUTE_OWNERSHIP_CONFLICT' })
    expect(harness.documents).toEqual(before)
    expect(harness.mutate).not.toHaveBeenCalled()
  })

  it('compares raw model ownership despite schema-materialized defaults', async () => {
    const harness = runtime({ models: [{ id: 'gpt-5.4', api: 'openai-responses' }] })
    harness.legacy()
    harness.modelDefaults(true)
    await expect(describeGitHubCopilotProviderProfile(harness.ctx)).resolves.toMatchObject({ state: 'needs-repair' })
    expect(harness.mutate).not.toHaveBeenCalled()
    await inspectGitHubCopilotProviderProfile(harness.ctx)
    expect(harness.profile()?.models).toEqual([{ id: 'gpt-5.4', api: 'openai-responses' }])
    harness.mutate.mockClear()
    await expect(describeGitHubCopilotProviderProfile(harness.ctx)).resolves.toMatchObject({ state: 'ready' })
    await expect(inspectGitHubCopilotProviderProfile(harness.ctx)).resolves.toMatchObject({ changed: false })
    expect(harness.mutate).not.toHaveBeenCalled()
  })

  it('preserves normal canonical models without copying resolved defaults or new account IDs', async () => {
    const harness = runtime({ models: [{ id: 'gpt-5.4', api: 'openai-responses' }], compat: { supportsStrictMode: false } })
    harness.modelDefaults(true)
    harness.retire(['gpt-5.6-sol'])
    await expect(inspectGitHubCopilotProviderProfile(harness.ctx)).resolves.toEqual({ changed: false })
    expect(harness.profile()?.models).toEqual([{ id: 'gpt-5.4', api: 'openai-responses' }])
    harness.mutate.mockClear()
    await expect(describeGitHubCopilotProviderProfile(harness.ctx)).resolves.toMatchObject({ state: 'ready' })
    await expect(inspectGitHubCopilotProviderProfile(harness.ctx)).resolves.toMatchObject({ changed: false })
    expect(harness.mutate).not.toHaveBeenCalled()
  })

  it('preserves every raw canonical model and extra despite account catalog changes', async () => {
    const harness = runtime({ models: [
      { id: 'gpt-5.4', userField: 'keep' },
      { id: 'claude-sonnet-4.5', api: 'anthropic-messages' },
    ], compat: { supportsStrictMode: false } })
    harness.modelDefaults(true)
    harness.retire(['gpt-5.4', 'gpt-5.6-sol'])
    await inspectGitHubCopilotProviderProfile(harness.ctx)
    expect(harness.profile()?.models).toEqual([
      { id: 'gpt-5.4', userField: 'keep' },
      { id: 'claude-sonnet-4.5', api: 'anthropic-messages' },
    ])
  })

  it('does not report normal inherited catalog api as drift', async () => {
    const harness = runtime({ models: [{ id: 'gpt-5.4' }], compat: { supportsStrictMode: false } })
    harness.modelDefaults(true)
    harness.retire(['gpt-5.4'])
    await expect(describeGitHubCopilotProviderProfile(harness.ctx)).resolves.toMatchObject({ state: 'ready' })
    await expect(inspectGitHubCopilotProviderProfile(harness.ctx)).resolves.toMatchObject({ changed: false })
    expect(harness.mutate).not.toHaveBeenCalled()
    expect(harness.profile()?.models).toEqual([{ id: 'gpt-5.4' }])
  })

  it.each(['api', 'models', 'model-extra'])('retains the marker and edits on changed %s', async (field) => {
    const harness = runtime({})
    harness.legacy()
    harness.edit(profile => {
      if (field === 'api') profile.api = 'anthropic-messages'
      else if (field === 'models') profile.models = [{ id: 'my-model', api: 'openai-responses' }]
      else (profile.models as Record<string, unknown>[])[0]!.headers = { Authorization: 'private-model-header' }
    })
    const before = structuredClone(harness.documents)
    harness.retire()
    await expect(inspectGitHubCopilotProviderProfile(harness.ctx)).rejects.toMatchObject({ code: 'TEMPORARY_ROUTE_OWNERSHIP_CONFLICT' })
    expect(harness.documents).toEqual(before)
    expect(harness.mutate).not.toHaveBeenCalled()
  })

  it('refuses unsafe preimage extras without copying sensitive data', async () => {
    const harness = runtime({})
    harness.legacy()
    const journal = JSON.parse(harness.marker() as string)
    journal.preimage.models = [{ id: 'gpt-5.4', headers: { Authorization: 'private-model-header' } }]
    harness.documents['github-copilot']!.temporaryRouteBackup = JSON.stringify(journal)
    const before = structuredClone(harness.documents)
    await expect(inspectGitHubCopilotProviderProfile(harness.ctx)).rejects.toMatchObject({ code: 'TEMPORARY_ROUTE_INVALID_BACKUP' })
    await expect(inspectGitHubCopilotProviderProfile(harness.ctx)).rejects.not.toThrow('private-model-header')
    expect(harness.documents).toEqual(before)
    expect(harness.mutate).not.toHaveBeenCalled()
    const model = Object.defineProperty({ id: 'gpt-5.4' }, 'headers', { enumerable: true, get() { throw new Error('private getter must not run') } })
    expect(() => leavesOf({ models: [model] })).toThrow(/TEMPORARY_ROUTE_OWNERSHIP_CONFLICT/)
  })

  it('fails closed on prepared activation retry without registration lifetime evidence', async () => {
    const harness = runtime({})
    harness.legacy('prepared')
    const before = structuredClone(harness.documents)
    await expect(inspectGitHubCopilotProviderProfile(harness.ctx)).rejects.toMatchObject({ code: 'TEMPORARY_ROUTE_OWNERSHIP_CONFLICT' })
    expect(harness.documents).toEqual(before)
    expect(harness.mutate).not.toHaveBeenCalled()
  })

  it('refuses a user api edit after failed activation', async () => {
    const harness = runtime({})
    harness.legacy('prepared')
    harness.edit(profile => { profile.api = 'anthropic-messages' })
    const before = structuredClone(harness.documents)
    await expect(inspectGitHubCopilotProviderProfile(harness.ctx)).rejects.toMatchObject({ code: 'TEMPORARY_ROUTE_OWNERSHIP_CONFLICT' })
    expect(harness.documents).toEqual(before)
    expect(harness.mutate).not.toHaveBeenCalled()
  })

  it.each(['restore', 'clear'])('handles failed %s conservatively without user edits', async (failure) => {
    const harness = runtime({ models: [{ id: 'gpt-5.4', api: 'openai-responses' }] })
    harness.legacy()
    harness.retire()
    harness.before((ns, operations) => {
      if (failure === 'restore' ? ns === 'llm-pi-ai' : ns === 'github-copilot' && operations[0]?.op === 'unset') throw new Error('write failed')
    })
    await expect(inspectGitHubCopilotProviderProfile(harness.ctx)).rejects.toThrow('write failed')
    harness.before()
    if (failure === 'restore') {
      const before = structuredClone(harness.documents)
      harness.mutate.mockClear()
      await expect(inspectGitHubCopilotProviderProfile(harness.ctx)).rejects.toMatchObject({ code: 'TEMPORARY_ROUTE_OWNERSHIP_CONFLICT' })
      expect(harness.documents).toEqual(before)
      expect(harness.mutate).not.toHaveBeenCalled()
    } else {
      harness.mutate.mockClear()
      await inspectGitHubCopilotProviderProfile(harness.ctx)
      expect(harness.profile()?.models).toEqual([{ id: 'gpt-5.4', api: 'openai-responses' }])
      expect(harness.marker()).toBeUndefined()
      expect(harness.mutate.mock.calls.every(([ns]) => ns === 'github-copilot')).toBe(true)
    }
  })

  it.each(['restore', 'clear'])('protects user edits after failed %s', async (failure) => {
    const harness = runtime({ models: [{ id: 'gpt-5.4', api: 'openai-responses' }] })
    harness.legacy()
    harness.retire()
    harness.before((ns, operations) => {
      if (failure === 'restore' ? ns === 'llm-pi-ai' : ns === 'github-copilot' && operations[0]?.op === 'unset') throw new Error('write failed')
    })
    await expect(inspectGitHubCopilotProviderProfile(harness.ctx)).rejects.toThrow('write failed')
    harness.before()
    harness.edit(profile => { profile.models = [{ id: 'user-edit', api: 'openai-responses' }] })
    const before = structuredClone(harness.documents)
    harness.mutate.mockClear()
    await expect(inspectGitHubCopilotProviderProfile(harness.ctx)).rejects.toMatchObject({ code: 'TEMPORARY_ROUTE_OWNERSHIP_CONFLICT' })
    expect(harness.documents).toEqual(before)
    expect(harness.mutate).not.toHaveBeenCalled()
  })

  it('does not erase edits returned to the old postimage after a failed clear', async () => {
    const harness = runtime({})
    harness.legacy()
    const old = structuredClone(harness.profile()!)
    harness.retire()
    harness.before((ns, operations) => { if (ns === 'github-copilot' && operations[0]?.op === 'unset') throw new Error('clear failed') })
    await expect(inspectGitHubCopilotProviderProfile(harness.ctx)).rejects.toThrow('clear failed')
    harness.before()
    harness.edit(profile => { profile.api = old.api; profile.models = old.models })
    const before = structuredClone(harness.documents)
    harness.mutate.mockClear()
    await expect(inspectGitHubCopilotProviderProfile(harness.ctx)).rejects.toMatchObject({ code: 'TEMPORARY_ROUTE_OWNERSHIP_CONFLICT' })
    expect(harness.documents).toEqual(before)
    expect(harness.mutate).not.toHaveBeenCalled()
  })

  it.each([
    ['activation', 'new-process'], ['restoration', 'new-process'],
    ['activation', 'same-module'], ['restoration', 'same-module'],
  ])('refuses pending %s replay after %s namespace revision reset', async (stage, lifetime) => {
    const harness = runtime({})
    harness.legacy(stage === 'activation' ? 'prepared' : 'restoring')
    const journal = JSON.parse(harness.marker() as string)
    if (lifetime === 'new-process') journal.sourceEpoch = '00000000-0000-0000-0000-000000000000'
    journal.sourceRevision = 0
    harness.documents['github-copilot']!.temporaryRouteBackup = JSON.stringify(journal)
    harness.resetRevision()
    const nextContext = new Context()
    nextContext.get = harness.ctx.get
    const before = structuredClone(harness.documents)
    await expect(describeGitHubCopilotProviderProfile(nextContext)).resolves.toMatchObject({ state: 'conflict' })
    await expect(inspectGitHubCopilotProviderProfile(nextContext)).rejects.toMatchObject({ code: 'TEMPORARY_ROUTE_OWNERSHIP_CONFLICT' })
    expect(harness.documents).toEqual(before)
    expect(harness.mutate).not.toHaveBeenCalled()
  })

  it.each(['steady-overlay', 'restored-target'])('allows safe %s retirement across epochs', async (stage) => {
    const harness = runtime({})
    harness.legacy(stage === 'steady-overlay' ? 'applied' : 'restored')
    harness.retire()
    const journal = JSON.parse(harness.marker() as string)
    journal.sourceEpoch = '00000000-0000-0000-0000-000000000000'
    harness.documents['github-copilot']!.temporaryRouteBackup = JSON.stringify(journal)
    harness.resetRevision()
    await inspectGitHubCopilotProviderProfile(harness.ctx)
    expect(harness.marker()).toBeUndefined()
    if (stage === 'restored-target') expect(harness.mutate.mock.calls.every(([ns]) => ns === 'github-copilot')).toBe(true)
  })

  it.each(['restoring', 'restored'])('preserves a historical %s marker whose recorded target differs from its preimage', async (stage) => {
    const harness = runtime({ models: [{ id: 'claude-sonnet-4.5', api: 'anthropic-messages' }] })
    harness.legacy(stage as LegacyStage)
    const journal = JSON.parse(harness.marker() as string)
    journal.target = { models: [{ id: 'projection-from-another-pi-copy', api: 'openai-responses' }] }
    if (stage === 'restored') harness.edit(profile => { profile.models = structuredClone(journal.target.models) })
    harness.documents['github-copilot']!.temporaryRouteBackup = JSON.stringify(journal)
    const before = structuredClone(harness.documents)
    await expect(describeGitHubCopilotProviderProfile(harness.ctx)).resolves.toMatchObject({ state: 'conflict' })
    await expect(inspectGitHubCopilotProviderProfile(harness.ctx)).rejects.toMatchObject({ code: 'TEMPORARY_ROUTE_OWNERSHIP_CONFLICT' })
    expect(harness.documents).toEqual(before)
    expect(harness.mutate).not.toHaveBeenCalled()
  })

  it('refuses old version-two markers without a process epoch', async () => {
    const harness = runtime({})
    harness.legacy()
    const journal = JSON.parse(harness.marker() as string)
    delete journal.sourceEpoch
    harness.documents['github-copilot']!.temporaryRouteBackup = JSON.stringify(journal)
    await expect(inspectGitHubCopilotProviderProfile(harness.ctx)).rejects.toMatchObject({ code: 'TEMPORARY_ROUTE_LEGACY_CONFLICT' })
    expect(harness.mutate).not.toHaveBeenCalled()
  })

  it.each(['delete', 'replace'])('detects marker %s while a route write is awaited without blind rollback', async (action) => {
    const harness = runtime({})
    harness.legacy()
    harness.before(ns => {
      if (ns !== 'llm-pi-ai') return
      if (action === 'delete') delete harness.documents['github-copilot']!.temporaryRouteBackup
      else {
        const journal = JSON.parse(harness.marker() as string)
        journal.providerExisted = false
        harness.documents['github-copilot']!.temporaryRouteBackup = JSON.stringify(journal)
      }
    })
    await expect(inspectGitHubCopilotProviderProfile(harness.ctx)).rejects.toMatchObject({ code: 'TEMPORARY_ROUTE_OWNERSHIP_CONFLICT' })
    // The awaited restoration committed. A lost marker must not reinstall the old override.
    expect(harness.profile()?.api).toBeUndefined()
    expect(harness.profile()?.models).toBeUndefined()
    expect(harness.mutate.mock.calls.filter(([ns]) => ns === 'llm-pi-ai')).toHaveLength(1)
  })

  it('bounds backup parsing and never returns raw JSON errors', async () => {
    const harness = runtime({})
    harness.documents['github-copilot']!.temporaryRouteBackup = 'private-content'.repeat(20_000)
    await expect(inspectGitHubCopilotProviderProfile(harness.ctx)).rejects.toMatchObject({ code: 'TEMPORARY_ROUTE_INVALID_BACKUP' })
    await expect(inspectGitHubCopilotProviderProfile(harness.ctx)).rejects.not.toThrow('private-content')
    expect(harness.mutate).not.toHaveBeenCalled()
  })

  it.each(['model-count', 'unknown-header', 'changed-header', 'unknown-field'])('rejects historical journal %s outside its bounded public fields', async (invalid) => {
    const harness = runtime({})
    harness.legacy()
    const journal = JSON.parse(harness.marker() as string)
    if (invalid === 'model-count') journal.postimage.models = Array.from({ length: 513 }, () => ({ id: 'gpt-5.4' }))
    else if (invalid === 'unknown-header') journal.ownedHeaders.Authorization = 'private-journal-header'
    else if (invalid === 'changed-header') journal.ownedHeaders['User-Agent'] = 'private-journal-header'
    else journal.extra = 'private-journal-header'
    harness.documents['github-copilot']!.temporaryRouteBackup = JSON.stringify(journal)
    const before = structuredClone(harness.documents)
    await expect(inspectGitHubCopilotProviderProfile(harness.ctx)).rejects.toMatchObject({ code: 'TEMPORARY_ROUTE_INVALID_BACKUP' })
    await expect(inspectGitHubCopilotProviderProfile(harness.ctx)).rejects.not.toThrow('private-journal-header')
    expect(harness.documents).toEqual(before)
    expect(harness.mutate).not.toHaveBeenCalled()
  })

  it('preserves a required header that predates the overlay', async () => {
    const harness = runtime({ headers: { 'user-agent': 'GitHubCopilotChat/0.35.0' } })
    harness.legacy()
    expect(JSON.parse(harness.marker() as string).ownedHeaders).not.toHaveProperty('User-Agent')
    harness.retire()
    await inspectGitHubCopilotProviderProfile(harness.ctx)
    expect(harness.profile()?.headers).toEqual({ 'user-agent': 'GitHubCopilotChat/0.35.0' })
  })

  it('retains a user-edited formerly owned header during restoration', async () => {
    const harness = runtime({})
    harness.legacy()
    harness.edit(profile => { (profile.headers as Record<string, unknown>)['User-Agent'] = 'user-agent-replacement' })
    await inspectGitHubCopilotProviderProfile(harness.ctx)
    expect(harness.profile()?.headers).toEqual({ 'User-Agent': 'user-agent-replacement' })
    expect(harness.marker()).toBeUndefined()
  })

  it('clears a restored journal without replaying removal of later user headers', async () => {
    const harness = runtime({})
    harness.legacy()
    harness.retire()
    harness.before((ns, operations) => { if (ns === 'github-copilot' && operations[0]?.op === 'unset') throw new Error('clear failed') })
    await expect(inspectGitHubCopilotProviderProfile(harness.ctx)).rejects.toThrow('clear failed')
    harness.before()
    harness.edit(profile => { profile.headers = { 'User-Agent': 'GitHubCopilotChat/0.35.0' } })
    const before = structuredClone(harness.profile())
    harness.mutate.mockClear()
    await inspectGitHubCopilotProviderProfile(harness.ctx)
    expect(harness.profile()).toEqual(before)
    expect(harness.marker()).toBeUndefined()
    expect(harness.mutate.mock.calls.every(([ns]) => ns === 'github-copilot')).toBe(true)
  })

  it('uses namespace revisions to reject races after ownership backup commits', async () => {
    const harness = runtime({})
    harness.legacy()
    harness.before(ns => {
      if (ns === 'llm-pi-ai') harness.edit(profile => { profile.api = 'anthropic-messages' })
    })
    await expect(inspectGitHubCopilotProviderProfile(harness.ctx)).rejects.toMatchObject({ code: 'TEMPORARY_ROUTE_OWNERSHIP_CONFLICT' })
    expect(harness.profile()?.api).toBe('anthropic-messages')
    expect(harness.marker()).toBeDefined()
    expect(harness.settings.describe).toHaveBeenCalledWith({ redactSecrets: true })
  })

  it('does not guess ownership for legacy or malformed backups', async () => {
    for (const marker of ['{private-invalid-json', JSON.stringify({ providerExisted: true, leaves: {}, preservedHeaderNames: [] })]) {
      const harness = runtime({})
      harness.documents['github-copilot']!.temporaryRouteBackup = marker
      await expect(describeGitHubCopilotProviderProfile(harness.ctx)).resolves.toMatchObject({ state: 'conflict' })
      await expect(inspectGitHubCopilotProviderProfile(harness.ctx)).rejects.toThrow(/TEMPORARY_ROUTE_(LEGACY_CONFLICT|INVALID_BACKUP)/)
      expect(harness.mutate).not.toHaveBeenCalled()
      expect(harness.marker()).toBe(marker)
    }
  })

  it('read-only planning reports ready only after reconciliation', async () => {
    const harness = runtime({})
    harness.legacy()
    const before = structuredClone(harness.documents)
    await expect(describeGitHubCopilotProviderProfile(harness.ctx)).resolves.toMatchObject({ state: 'needs-repair' })
    expect(harness.documents).toEqual(before)
    expect(harness.mutate).not.toHaveBeenCalled()
    await inspectGitHubCopilotProviderProfile(harness.ctx)
    harness.mutate.mockClear()
    await expect(describeGitHubCopilotProviderProfile(harness.ctx)).resolves.toMatchObject({ state: 'ready' })
    harness.retire(['gpt-5.6-sol'])
    await expect(describeGitHubCopilotProviderProfile(harness.ctx)).resolves.toMatchObject({ state: 'ready' })
    harness.edit(profile => { profile.compat = { supportsStrictMode: true } })
    await expect(describeGitHubCopilotProviderProfile(harness.ctx)).resolves.toMatchObject({ state: 'needs-repair' })
    expect(harness.mutate).not.toHaveBeenCalled()
  })
})
