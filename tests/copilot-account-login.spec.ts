import { expect, it } from 'vitest'
import { CopilotAccountsViewSchema } from '../src/copilot-accounts-remote.ts'

it.each(['mona-cat', 'mona-cat_octo', 'octo_admin', '2abvd19d_admin'])('accepts official account login %s', login => {
  expect(CopilotAccountsViewSchema.safeParse({
    state: 'ready', activeAccountId: 'canonical', writable: false, switchable: false, notices: [],
    accounts: [{ id: 'canonical', configured: true, identityState: 'ready', identity: { login, userId: 1 } }],
  }).success).toBe(true)
})
it.each(['', '_mona', 'mona_', 'mona/o', 'mona o', 'mona@o', 'a'.repeat(40)])('rejects unsafe or invalid login %s', login => {
  expect(CopilotAccountsViewSchema.safeParse({
    state: 'ready', activeAccountId: 'canonical', writable: false, switchable: false, notices: [],
    accounts: [{ id: 'canonical', configured: true, identityState: 'ready', identity: { login, userId: 1 } }],
  }).success).toBe(false)
})
