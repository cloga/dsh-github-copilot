import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { copilotLoginHost, copilotIdentityEndpoint, copilotVerificationUri,
  sameCopilotIdentity, copilotIdentityLabel } from '../../src/copilot-login-environment.ts'

describe('Copilot login environment boundary', () => {
  for (const [input, expected] of [
    [undefined, 'github.com'], ['github.com', 'github.com'], ['https://github.com/', 'github.com'],
    ['TENANT.ghe.com', 'tenant.ghe.com'], [' https://tenant.ghe.com/ ', 'tenant.ghe.com'],
    ['a-b.ghe.com', 'a-b.ghe.com'],
  ]) it(`normalizes only official login hosts: ${input}`, () => {
    assert.equal(copilotLoginHost(input), expected)
  })
  for (const input of [
    '', 'ghe.com', 'github.example', 'server.example.com', 'tenant.ghe.com.evil.example',
    'evil-tenantghe.com', 'nested.tenant.ghe.com', '-tenant.ghe.com', 'tenant-.ghe.com',
    'http://tenant.ghe.com', 'https://tenant.ghe.com:443', 'https://user@tenant.ghe.com',
    'https://tenant.ghe.com/path', 'https://tenant.ghe.com?x=1', 'https://tenant.ghe.com#x',
    'https://tenant.ghe.com\\@evil.example', 'tenant.ghe.com.', 'tenant%2eghe.com',
    'tenant.ghe.com\n.evil.example', 'ténant.ghe.com', '127.0.0.1',
  ]) it(`rejects an unsupported environment before network access: ${JSON.stringify(input)}`, () => {
    assert.throws(() => copilotLoginHost(input), /^Error: COPILOT_ACCOUNTS_ENTERPRISE_UNSUPPORTED$/)
  })
  it('binds identity and device verification to the selected host', () => {
    assert.equal(copilotIdentityEndpoint('github.com'), 'https://api.github.com/user')
    assert.equal(copilotIdentityEndpoint('tenant.ghe.com'), 'https://api.tenant.ghe.com/user')
    assert.equal(copilotVerificationUri('tenant.ghe.com'), 'https://tenant.ghe.com/login/device')
    assert.throws(() => copilotVerificationUri('evil.example'))
  })
  it('compares numeric identities within their host without relabeling legacy GitHub.com evidence', () => {
    const legacy = { login: 'octocat', userId: 1 }
    const tenant = { ...legacy, host: 'tenant.ghe.com' }
    assert.equal(sameCopilotIdentity(legacy, { ...legacy, host: 'github.com' }), true)
    assert.equal(sameCopilotIdentity(legacy, tenant), false)
    assert.equal(sameCopilotIdentity(tenant, { ...tenant, userId: 2 }), false)
    assert.equal(sameCopilotIdentity(tenant, { ...tenant, login: 'renamed' }), true)
    assert.equal(copilotIdentityLabel(legacy), '@octocat')
    assert.equal(copilotIdentityLabel(tenant), '@octocat · tenant.ghe.com')
  })
})
