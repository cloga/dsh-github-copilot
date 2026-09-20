import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { TypertRegistry } from '@deepseek-ai/dsh-typert-registry'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import { TypertGatewayService } from '@deepseek-ai/dsh-api-gateway'
import GitHubCopilotUsageController from '../../lib/types/copilot-usage-host.js'

test('quota Remote reaches the actual Host gateway without startup or signed-out network requests', async t => {
  const ctx = new Context()
  t.after(() => ctx.fiber.dispose())
  let reads = 0
  ctx.provide('credentials', {
    async readRecord() { reads++; return undefined },
    async listRecords() { return [] },
    async modifyRecord() { assert.fail('Quota inspection must not modify credentials') },
    async deleteRecord() { assert.fail('Quota inspection must not delete credentials') },
  })
  t.mock.method(globalThis, 'fetch', () => { assert.fail('Signed-out quota reads must not make network requests') })
  new TypertRegistry(ctx)
  const connection = new HostConnectionService(ctx, [], {})
  new TypertGatewayService(ctx, { websocketHeartbeatIntervalMs: 30000 })
  const mounted = ctx.plugin(GitHubCopilotUsageController)
  await mounted
  assert.equal(reads, 0, 'Mounting must not resolve credentials or quota')
  const handler = connection.createSharedFetchHandler('/api')
  for (const method of ['get', 'refresh']) {
    const endpoint = `githubCopilotUsage/${method}`
    const response = await handler.fetch(new Request(`http://fixture.invalid/api/${endpoint}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: method, method: endpoint, payload: { args: {} } }),
    }))
    assert.equal(response.status, 200)
    const envelope = await response.json()
    assert.equal(envelope.result.ok, true)
    assert.equal(envelope.result.value.state, 'signed-out')
    assert.equal(envelope.result.value.billing, 'unknown')
    assert.equal(envelope.result.value.used, undefined)
    assert.equal(envelope.result.value.remaining, undefined)
    assert.equal(JSON.stringify(envelope).includes('refresh_token'), false)
  }
  assert.ok(reads > 0)
  await mounted.dispose()
  const missing = await handler.fetch(new Request('http://fixture.invalid/api/githubCopilotUsage/get', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: 'disposed', method: 'githubCopilotUsage/get', payload: { args: {} } }),
  }))
  assert.equal(missing.status, 404)
})
