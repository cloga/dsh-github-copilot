import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { describeGitHubCopilotProviderProfile, inspectGitHubCopilotProviderProfile } from '../src/authorization-controller.ts'
import { type RouteMutation } from '../src/route-ownership.ts'

function runtime(initial?: Record<string, unknown>) {
  const documents: Record<string, Record<string, unknown>> = {
    'llm-pi-ai': { providers: { ...initial === undefined ? {} : { 'github-copilot': structuredClone(initial) }, other: { untouched: true } } },
    'github-copilot': {},
  }
  const revisions: Record<string, number> = { 'llm-pi-ai': 0, 'github-copilot': 0 }
  let available = ['gpt-6-astra']
  let before: ((namespace: string, operations: readonly RouteMutation[]) => void) | undefined
  let defaults: Record<string, unknown> | undefined
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
    describe: vi.fn(() => Object.entries(documents).map(([ns, user]) => ({ ns, user: structuredClone(user), revision: revisions[ns]! }))),
    mutate,
  }
  const ctx = new Context()
  ctx.get = ((name: string) => name === 'settings' ? settings : name === 'credentials' ? {
    readRecord: async () => ({ kind: 'grant', payload: { type: 'oauth', refresh: 'synthetic-refresh', access: 'synthetic-access', expires: 9_999_999_999_999, availableModelIds: available } }),
  } : undefined) as typeof ctx.get
  const profile = () => (documents['llm-pi-ai']!.providers as Record<string, Record<string, unknown>>)['github-copilot']
  const edit = (update: (value: Record<string, unknown>) => void) => {
    update(profile()!)
    revisions['llm-pi-ai']!++
  }
  return { ctx, documents, mutate, settings, profile, edit,
    retire: (models: string[] = []) => { available = models },
    before: (callback?: typeof before) => { before = callback },
    defaults: (value: Record<string, unknown>) => { defaults = value },
    modelDefaults: (stripApi = false) => { materializeModels = true; stripModelApi = stripApi },
    resetRevision: () => { revisions['llm-pi-ai'] = 0 },
    marker: () => documents['github-copilot']!.temporaryRouteBackup,
  }
}

describe('temporary route ownership', () => {
  it('backs up only bounded owned leaves and restores normally', async () => {
    const harness = runtime({ headers: { Authorization: 'private-header' }, models: [{ id: 'gpt-5.4', api: 'openai-responses' }], userField: 'keep' })
    await inspectGitHubCopilotProviderProfile(harness.ctx)
    const marker = harness.marker() as string
    expect(marker).not.toContain('private-header')
    expect(marker).not.toContain('userField')
    expect(JSON.parse(marker)).toMatchObject({ version: 2, phase: 'overlay', preimage: { models: [{ id: 'gpt-5.4', api: 'openai-responses' }] }, postimage: { api: 'openai-responses' } })
    harness.retire()
    await inspectGitHubCopilotProviderProfile(harness.ctx)
    expect(harness.profile()).toEqual({ headers: { Authorization: 'private-header' }, models: [{ id: 'gpt-5.4', api: 'openai-responses' }], userField: 'keep', compat: { supportsStrictMode: false } })
    expect(harness.marker()).toBeUndefined()
  })

  it.each(['field', 'header', 'default'])('never deletes a created profile with user %s additions', async (kind) => {
    const harness = runtime()
    await inspectGitHubCopilotProviderProfile(harness.ctx)
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
    await inspectGitHubCopilotProviderProfile(harness.ctx)
    harness.retire()
    await inspectGitHubCopilotProviderProfile(harness.ctx)
    expect(harness.profile()).toBeUndefined()
    expect(harness.documents['llm-pi-ai']!.providers).toEqual({ other: { untouched: true } })
  })

  it('compares raw model ownership despite schema-materialized defaults', async () => {
    const harness = runtime({ models: [{ id: 'gpt-5.4', api: 'openai-responses' }] })
    harness.modelDefaults()
    await inspectGitHubCopilotProviderProfile(harness.ctx)
    await expect(describeGitHubCopilotProviderProfile(harness.ctx)).resolves.toMatchObject({ state: 'ready' })
    harness.retire()
    await inspectGitHubCopilotProviderProfile(harness.ctx)
    expect(harness.profile()?.models).toEqual([{ id: 'gpt-5.4', api: 'openai-responses' }])
  })

  it('replaces normal account models without treating resolved defaults as user extras', async () => {
    const harness = runtime({ models: [{ id: 'gpt-5.4', api: 'openai-responses' }], compat: { supportsStrictMode: false } })
    harness.modelDefaults(true)
    harness.retire(['gpt-5.6-sol'])
    await expect(inspectGitHubCopilotProviderProfile(harness.ctx)).resolves.toMatchObject({ changed: true })
    expect(harness.profile()?.models).toEqual([{ id: 'gpt-5.6-sol', api: 'openai-responses' }])
    harness.mutate.mockClear()
    await expect(describeGitHubCopilotProviderProfile(harness.ctx)).resolves.toMatchObject({ state: 'ready' })
    await expect(inspectGitHubCopilotProviderProfile(harness.ctx)).resolves.toMatchObject({ changed: false })
    expect(harness.mutate).not.toHaveBeenCalled()
  })

  it('preserves only raw surviving model extras during normal account reconciliation', async () => {
    const harness = runtime({ models: [
      { id: 'gpt-5.4', userField: 'keep' },
      { id: 'claude-sonnet-4.5', api: 'anthropic-messages' },
    ], compat: { supportsStrictMode: false } })
    harness.modelDefaults(true)
    harness.retire(['gpt-5.4', 'gpt-5.6-sol'])
    await inspectGitHubCopilotProviderProfile(harness.ctx)
    expect(harness.profile()?.models).toEqual([
      { id: 'gpt-5.4', api: 'openai-responses', userField: 'keep' },
      { id: 'gpt-5.6-sol', api: 'openai-responses' },
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
    await inspectGitHubCopilotProviderProfile(harness.ctx)
    harness.edit(profile => {
      if (field === 'api') profile.api = 'anthropic-messages'
      else if (field === 'models') profile.models = [{ id: 'my-model', api: 'openai-responses' }]
      else (profile.models as Record<string, unknown>[])[0]!.headers = { Authorization: 'private-model-header' }
    })
    const before = structuredClone(harness.documents)
    harness.retire()
    await expect(inspectGitHubCopilotProviderProfile(harness.ctx)).rejects.toMatchObject({ code: 'TEMPORARY_ROUTE_OWNERSHIP_CONFLICT' })
    expect(harness.documents).toEqual(before)
  })

  it('refuses unsafe preimage extras without copying sensitive data', async () => {
    const harness = runtime({ models: [{ id: 'gpt-5.4', headers: { Authorization: 'private-model-header' } }] })
    await expect(inspectGitHubCopilotProviderProfile(harness.ctx)).rejects.toMatchObject({ code: 'TEMPORARY_ROUTE_OWNERSHIP_CONFLICT' })
    expect(harness.mutate).not.toHaveBeenCalled()
    expect(harness.marker()).toBeUndefined()
  })

  it('fails closed on prepared activation retry without registration lifetime evidence', async () => {
    const harness = runtime({})
    harness.before(ns => { if (ns === 'llm-pi-ai') throw new Error('write failed') })
    await expect(inspectGitHubCopilotProviderProfile(harness.ctx)).rejects.toThrow('write failed')
    expect(harness.marker()).toBeDefined()
    harness.before()
    const before = structuredClone(harness.documents)
    await expect(inspectGitHubCopilotProviderProfile(harness.ctx)).rejects.toMatchObject({ code: 'TEMPORARY_ROUTE_OWNERSHIP_CONFLICT' })
    expect(harness.documents).toEqual(before)
  })

  it('refuses a user api edit after failed activation', async () => {
    const harness = runtime({})
    harness.before(ns => { if (ns === 'llm-pi-ai') throw new Error('write failed') })
    await expect(inspectGitHubCopilotProviderProfile(harness.ctx)).rejects.toThrow('write failed')
    harness.before()
    harness.edit(profile => { profile.api = 'anthropic-messages' })
    const before = structuredClone(harness.documents)
    await expect(inspectGitHubCopilotProviderProfile(harness.ctx)).rejects.toMatchObject({ code: 'TEMPORARY_ROUTE_OWNERSHIP_CONFLICT' })
    expect(harness.documents).toEqual(before)
  })

  it.each(['restore', 'clear'])('handles failed %s conservatively without user edits', async (failure) => {
    const harness = runtime({ models: [{ id: 'gpt-5.4', api: 'openai-responses' }] })
    await inspectGitHubCopilotProviderProfile(harness.ctx)
    harness.retire()
    harness.before((ns, operations) => {
      if (failure === 'restore' ? ns === 'llm-pi-ai' : ns === 'github-copilot' && operations[0]?.op === 'unset') throw new Error('write failed')
    })
    await expect(inspectGitHubCopilotProviderProfile(harness.ctx)).rejects.toThrow('write failed')
    harness.before()
    if (failure === 'restore') {
      const before = structuredClone(harness.documents)
      await expect(inspectGitHubCopilotProviderProfile(harness.ctx)).rejects.toMatchObject({ code: 'TEMPORARY_ROUTE_OWNERSHIP_CONFLICT' })
      expect(harness.documents).toEqual(before)
    }
    else {
      await inspectGitHubCopilotProviderProfile(harness.ctx)
      expect(harness.profile()?.models).toEqual([{ id: 'gpt-5.4', api: 'openai-responses' }])
      expect(harness.marker()).toBeUndefined()
    }
  })

  it.each(['restore', 'clear'])('protects user edits after failed %s', async (failure) => {
    const harness = runtime({ models: [{ id: 'gpt-5.4', api: 'openai-responses' }] })
    await inspectGitHubCopilotProviderProfile(harness.ctx)
    harness.retire()
    harness.before((ns, operations) => {
      if (failure === 'restore' ? ns === 'llm-pi-ai' : ns === 'github-copilot' && operations[0]?.op === 'unset') throw new Error('write failed')
    })
    await expect(inspectGitHubCopilotProviderProfile(harness.ctx)).rejects.toThrow('write failed')
    harness.before()
    harness.edit(profile => { profile.models = [{ id: 'user-edit', api: 'openai-responses' }] })
    const before = structuredClone(harness.documents)
    await expect(inspectGitHubCopilotProviderProfile(harness.ctx)).rejects.toMatchObject({ code: 'TEMPORARY_ROUTE_OWNERSHIP_CONFLICT' })
    expect(harness.documents).toEqual(before)
  })

  it('does not erase edits returned to the old postimage after a failed clear', async () => {
    const harness = runtime({})
    await inspectGitHubCopilotProviderProfile(harness.ctx)
    const old = structuredClone(harness.profile()!)
    harness.retire()
    harness.before((ns, operations) => { if (ns === 'github-copilot' && operations[0]?.op === 'unset') throw new Error('clear failed') })
    await expect(inspectGitHubCopilotProviderProfile(harness.ctx)).rejects.toThrow('clear failed')
    harness.before()
    harness.edit(profile => { profile.api = old.api; profile.models = old.models })
    const before = structuredClone(harness.documents)
    await expect(inspectGitHubCopilotProviderProfile(harness.ctx)).rejects.toMatchObject({ code: 'TEMPORARY_ROUTE_OWNERSHIP_CONFLICT' })
    expect(harness.documents).toEqual(before)
  })

  it.each([
    ['activation', 'new-process'], ['restoration', 'new-process'],
    ['activation', 'same-module'], ['restoration', 'same-module'],
  ])('refuses pending %s replay after %s namespace revision reset', async (stage, lifetime) => {
    const harness = runtime({})
    if (stage === 'activation') {
      harness.before(ns => { if (ns === 'llm-pi-ai') throw new Error('write failed') })
      await expect(inspectGitHubCopilotProviderProfile(harness.ctx)).rejects.toThrow('write failed')
    }
    else {
      await inspectGitHubCopilotProviderProfile(harness.ctx)
      const old = structuredClone(harness.profile()!)
      harness.retire()
      harness.before((ns, operations) => { if (ns === 'github-copilot' && operations[0]?.op === 'unset') throw new Error('write failed') })
      await expect(inspectGitHubCopilotProviderProfile(harness.ctx)).rejects.toThrow('write failed')
      harness.edit(profile => { profile.api = old.api; profile.models = old.models })
    }
    harness.before()
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
  })

  it.each(['steady-overlay', 'restored-target'])('allows safe %s retirement across epochs', async (stage) => {
    const harness = runtime({})
    await inspectGitHubCopilotProviderProfile(harness.ctx)
    harness.retire()
    if (stage === 'restored-target') {
      harness.before((ns, operations) => { if (ns === 'github-copilot' && operations[0]?.op === 'unset') throw new Error('clear failed') })
      await expect(inspectGitHubCopilotProviderProfile(harness.ctx)).rejects.toThrow('clear failed')
      harness.before()
    }
    const journal = JSON.parse(harness.marker() as string)
    journal.sourceEpoch = '00000000-0000-0000-0000-000000000000'
    harness.documents['github-copilot']!.temporaryRouteBackup = JSON.stringify(journal)
    harness.resetRevision()
    harness.mutate.mockClear()
    await inspectGitHubCopilotProviderProfile(harness.ctx)
    expect(harness.marker()).toBeUndefined()
    if (stage === 'restored-target') expect(harness.mutate.mock.calls.every(([ns]) => ns === 'github-copilot')).toBe(true)
  })

  it('refuses old version-two markers without a process epoch', async () => {
    const harness = runtime({})
    await inspectGitHubCopilotProviderProfile(harness.ctx)
    const journal = JSON.parse(harness.marker() as string)
    delete journal.sourceEpoch
    harness.documents['github-copilot']!.temporaryRouteBackup = JSON.stringify(journal)
    harness.mutate.mockClear()
    await expect(inspectGitHubCopilotProviderProfile(harness.ctx)).rejects.toMatchObject({ code: 'TEMPORARY_ROUTE_LEGACY_CONFLICT' })
    expect(harness.mutate).not.toHaveBeenCalled()
  })

  it.each(['delete', 'replace'])('detects marker %s while a route write is awaited without blind rollback', async (action) => {
    const harness = runtime({})
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
    expect(harness.profile()?.api).toBe('openai-responses')
    expect(harness.mutate.mock.calls.filter(([ns]) => ns === 'llm-pi-ai')).toHaveLength(1)
  })

  it('bounds backup parsing and never returns raw JSON errors', async () => {
    const harness = runtime({})
    harness.documents['github-copilot']!.temporaryRouteBackup = 'private-content'.repeat(20_000)
    await expect(inspectGitHubCopilotProviderProfile(harness.ctx)).rejects.toMatchObject({ code: 'TEMPORARY_ROUTE_INVALID_BACKUP' })
    await expect(inspectGitHubCopilotProviderProfile(harness.ctx)).rejects.not.toThrow('private-content')
    expect(harness.mutate).not.toHaveBeenCalled()
  })

  it('preserves a required header that predates the overlay', async () => {
    const harness = runtime({ headers: { 'user-agent': 'GitHubCopilotChat/0.35.0' } })
    await inspectGitHubCopilotProviderProfile(harness.ctx)
    expect(JSON.parse(harness.marker() as string).ownedHeaders).not.toHaveProperty('User-Agent')
    harness.retire()
    await inspectGitHubCopilotProviderProfile(harness.ctx)
    expect(harness.profile()?.headers).toEqual({ 'user-agent': 'GitHubCopilotChat/0.35.0' })
  })

  it('clears a restored journal without replaying removal of later user headers', async () => {
    const harness = runtime({})
    await inspectGitHubCopilotProviderProfile(harness.ctx)
    harness.retire()
    harness.before((ns, operations) => { if (ns === 'github-copilot' && operations[0]?.op === 'unset') throw new Error('clear failed') })
    await expect(inspectGitHubCopilotProviderProfile(harness.ctx)).rejects.toThrow('clear failed')
    harness.before()
    harness.edit(profile => { profile.headers = { 'User-Agent': 'GitHubCopilotChat/0.35.0' } })
    const before = structuredClone(harness.profile())
    await inspectGitHubCopilotProviderProfile(harness.ctx)
    expect(harness.profile()).toEqual(before)
    expect(harness.marker()).toBeUndefined()
  })

  it('uses namespace revisions to reject races after ownership backup commits', async () => {
    const harness = runtime({})
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
    await expect(describeGitHubCopilotProviderProfile(harness.ctx)).resolves.toMatchObject({ state: 'needs-repair' })
    expect(harness.mutate).not.toHaveBeenCalled()
    await inspectGitHubCopilotProviderProfile(harness.ctx)
    harness.mutate.mockClear()
    await expect(describeGitHubCopilotProviderProfile(harness.ctx)).resolves.toMatchObject({ state: 'ready' })
    harness.retire()
    await expect(describeGitHubCopilotProviderProfile(harness.ctx)).resolves.toMatchObject({ state: 'needs-repair' })
    expect(harness.mutate).not.toHaveBeenCalled()
  })
})
