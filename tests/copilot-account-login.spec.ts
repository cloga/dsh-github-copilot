import { expect, it } from 'vitest'
import { CopilotAccountsViewSchema } from '../src/copilot-accounts-remote.ts'

it.each(['github.com', 'tenant.ghe.com'])('accepts only exact official device verification links for %s', host => {
  const view = { state: 'ready', activeAccountId: 'canonical', writable: false, switchable: false,
    accounts: [], notices: [{ message: 'Open verification', url: `https://${host}/login/device` }] }
  expect(CopilotAccountsViewSchema.safeParse(view).success).toBe(true)
  for (const url of [`http://${host}/login/device`, `https://${host}/login/device?x=1`,
    `https://user@${host}/login/device`, 'https://evil.example/login/device']) {
    expect(CopilotAccountsViewSchema.safeParse({ ...view, notices: [{ message: 'Open', url }] }).success).toBe(false)
  }
})

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
