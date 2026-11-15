import { Context } from '@deepseek-ai/cordis'
import { expect, it, vi } from 'vitest'
import { CopilotAccountsHost, isActiveCopilotRecord } from '../src/copilot-accounts-host.ts'
import { CopilotAccountsViewSchema } from '../src/copilot-accounts-remote.ts'

vi.mock('../src/migration-status.ts', () => ({ migrationStatus: () => { throw new Error('No native migration read') } }))
vi.mock('../src/preview-provider.ts', () => ({ copilotPublicHeaders: () => { throw new Error('No native model preflight') } }))
vi.mock('../src/http.ts', () => ({ abortable: () => { throw new Error('No HTTP expected') } }))
vi.mock('../src/account-model-source.ts', () => ({ createAccountModelSource: () => { throw new Error('No discovery expected') } }))
const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
function fixture(selected: unknown = A) {
  const ctx = new Context()
  let revision = 1
  const rows = [
    { key: 'llm-pi-ai/github-copilot', kind: 'grant' },
    ...[A, B].map(id => ({ key: `github-copilot/account-${id}`, kind: 'grant' })),
  ]
  const sharedGrant = { kind: 'grant', payload: {
    type: 'oauth', refresh: 'synthetic-account-a', access: 'synthetic-access-a', expires: Date.now() + 3_600_000,
  } }
  const grants = new Map(rows.map(row => [row.key, { kind: 'grant', payload: {
    ...sharedGrant.payload,
  } }]))
  const readRecord = vi.fn(async (key: string) => grants.get(key))
  ctx.provide('credentials', { listRecords: async () => rows, readRecord,
    modifyRecord: vi.fn(), deleteRecord: vi.fn() })
  ctx.provide('settings', {
    describe: () => [{ ns: 'github-copilot', revision, value: { activeAccountId: selected } }],
    mutate: vi.fn(),
  })
  const host = new CopilotAccountsHost(ctx, { routeDiagnostic: () => undefined })
  return { ctx, host, readRecord, rows, change(value: unknown) { selected = value; revision++; host.selectionChanged() } }
}
it('verifies the selected native credential without identity discovery or implicit fallback', async () => {
  const f = fixture()
  const view = await f.host.get()
  expect(view).toMatchObject({ state: 'ready', activeAccountId: A, revision: 1 })
  expect(CopilotAccountsViewSchema.safeParse(view).success).toBe(true)
  expect(new Set(f.readRecord.mock.calls.map(([key]) => key))).toEqual(new Set([
    'llm-pi-ai/github-copilot', `github-copilot/account-${A}`,
  ]))
  f.change('invalid')
  expect(await f.host.get()).toMatchObject({ diagnostic: 'COPILOT_ACCOUNTS_SELECTOR_INVALID' })
  f.host.dispose()
})
it('revokes captured bindings and fences activity without native gateway behavior', async () => {
  const f = fixture()
  const lease = f.host.acquire()
  expect(await f.host.switchAccount(B, 1)).toMatchObject({ diagnostic: 'COPILOT_ACCOUNTS_BUSY' })
  f.change(B)
  expect(() => lease.binding.assertCurrent()).toThrow('COPILOT_ACCOUNTS_CHANGED')
  lease.release()
  f.host.dispose()
})
it('exposes narrowly permitted selected-missing recovery while retaining error evidence', async () => {
  const f = fixture()
  f.rows.splice(f.rows.findIndex(row => row.key === `github-copilot/account-${A}`), 1)
  const view = await f.host.get()
  expect(view).toMatchObject({ state: 'error', activeAccountId: A, switchable: true,
    diagnostic: 'COPILOT_ACCOUNTS_SELECTED_MISSING' })
  expect(CopilotAccountsViewSchema.safeParse(view).success).toBe(true)
  expect(await f.host.reauthorize(A, 1)).toMatchObject({ diagnostic: 'COPILOT_ACCOUNTS_SELECTED_MISSING' })
  f.host.dispose()
})
it('classifies record notifications from retained selector metadata without reading Settings or credentials', async () => {
  const f = fixture()
  f.ctx.provide('githubCopilotAccounts', { host: f.host })
  await f.host.get()
  f.readRecord.mockClear()
  const describe = vi.spyOn(f.ctx.settings, 'describe')
  for (let index = 0; index < 20; index++) {
    expect(isActiveCopilotRecord(f.ctx, `github-copilot/account-${A}`)).toBe(true)
    expect(isActiveCopilotRecord(f.ctx, `github-copilot/account-${B}`)).toBe(false)
  }
  expect(describe).not.toHaveBeenCalled()
  expect(f.readRecord).not.toHaveBeenCalled()
  f.change(B)
  describe.mockClear()
  expect(isActiveCopilotRecord(f.ctx, `github-copilot/account-${B}`)).toBe(true)
  expect(describe).not.toHaveBeenCalled()
  f.host.dispose()
})
