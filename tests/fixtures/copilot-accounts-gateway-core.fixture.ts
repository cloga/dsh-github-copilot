import { Context } from '@deepseek-ai/cordis'
import * as Gateway from '@deepseek-ai/dsh-api-gateway/client'
import { TypertGatewayService } from '@deepseek-ai/dsh-api-gateway'
import { TypertRegistry } from '@deepseek-ai/dsh-typert-registry'
import * as HostConnection from '@deepseek-ai/dsh-client-connection'
import type { CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { describe, expect, it, vi } from 'vitest'
import AccountsController from '../../src/copilot-accounts-host.ts'
import contribution from '../../src/copilot-accounts-remote.ts'

describe('account Remote public gateway binding', () => {
  it.each(['source', 'strict'] as const)('uses the actual Client and %s Host gateway without credential projection', async mode => {
    const host = new Context(), client = new Context()
    try {
      const registry = new TypertRegistry(host)
      if (mode === 'strict') registry.register({ package: contribution.package, face: 'host', schemas: [],
        model: { services: [], events: [], objects: [] }, invocations: contribution.descriptors })
      host.provide('settings', {
        describe: () => [{ ns: 'github-copilot', revision: 4, value: {} }],
        mutate: vi.fn(async () => { throw new Error('Unexpected fixture mutation') }),
      })
      let browserRecord: CredentialRecord | undefined
      const read = vi.fn(async (key: string) => {
        expect(key).toBe('client-connection/browser-session')
        return browserRecord
      })
      host.provide('credentials', { listRecords: async () => [], readRecord: read,
        modifyRecord: async (key: string, mutate: (record: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>) => {
          expect(key).toBe('client-connection/browser-session')
          browserRecord = await mutate(browserRecord)
          return browserRecord
        },
      })
      await HostConnection.apply(host, {})
      const connection = host.get('connection')
      if (!connection) throw new Error('Fixture Connection failed to register')
      const gateway = new TypertGatewayService(host, { websocketHeartbeatIntervalMs: 30000 })
      const handler = connection.createSharedFetchHandler('/api')
      let sequence = 0
      const rpc = vi.fn(async (_path: string, method: string, payload: unknown) => {
        const response = await handler.fetch(new Request(`http://fixture.invalid/api/${method}`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'client-request', rpcId: `account-${++sequence}`, method, payload }),
        }))
        expect(response.status).toBe(200)
        return (await response.json()).result
      })
      client.provide('typert', { remotes: { register: () => () => {} }, contexts: { getClient: () => undefined } })
      client.provide('connection', { rpc: { call: rpc, open: vi.fn() },
        registerGenerationSource: () => () => {}, start: () => ({ stop: () => {} }),
        generation: { getSnapshot: () => undefined } })
      Gateway.apply(client)
      await client.remote.$mount(contribution)
      await host.plugin({ apply(ctx) { new AccountsController(ctx) } })
      await expect(client.remote.githubCopilotAccounts.get()).resolves.toMatchObject({
        ok: true, value: { state: 'error', activeAccountId: 'canonical', revision: 4,
          diagnostic: 'COPILOT_ACCOUNTS_EVIDENCE_INCOMPLETE',
          accounts: [{ id: 'canonical', configured: false, identityState: 'unknown' }] },
      })
      await expect(client.remote.githubCopilotAccounts.switchAccount('canonical', 3)).resolves.toMatchObject({
        ok: true, value: { diagnostic: 'COPILOT_ACCOUNTS_CONFLICT' },
      })
      expect(read.mock.calls.every(([key]) => key === 'client-connection/browser-session')).toBe(true)
      await expect(client.remote.githubCopilotAccounts.reauthorize('11111111-1111-4111-8111-111111111111', 3))
        .resolves.toMatchObject({ ok: true, value: { diagnostic: 'COPILOT_ACCOUNTS_CONFLICT' } })
      await expect(client.remote.githubCopilotAccounts.removeAccount('arbitrary/key', 4)).resolves.toMatchObject(
        mode === 'strict' ? { ok: false, error: { code: 'gateway/input-invalid' } }
          : { ok: true, value: { diagnostic: 'COPILOT_ACCOUNTS_SELECTOR_INVALID' } })
      if (mode === 'strict') {
        await expect(gateway.invoke({ namespace: 'githubCopilotAccounts', method: 'switchAccount',
          args: { accountId: 'canonical', expectedRevision: -1 } })).rejects.toThrow()
      }
    } finally { await client.fiber.dispose(); await host.fiber.dispose() }
  })
})
