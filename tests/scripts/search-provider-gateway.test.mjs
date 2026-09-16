import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { WebRuntime } from '@deepseek-ai/dsh-web'
import { TypertRegistry } from '@deepseek-ai/dsh-typert-registry'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import { TypertGatewayService } from '@deepseek-ai/dsh-api-gateway'
import CopilotRoutedWeb from '../../lib/routed-web.js'
import SearchRoutingController from '../../lib/types/search-routing-host.js'

// Postbuild: use real Connection/Gateway and the packaged facade, not Vitest's
// protocol alias. No server, account, network search or settings writes exist.
test('search catalog Remote reaches actual facade registrations and unloads cleanly', async t => {
  const ctx = new Context(); t.after(() => ctx.fiber.dispose())
  new TypertRegistry(ctx)
  const connection = new HostConnectionService(ctx, [], {})
  new TypertGatewayService(ctx, { websocketHeartbeatIntervalMs: 30000 })
  const original = new WebRuntime(ctx.isolate('web'))
  ctx.provide('githubCopilotOriginalWeb', original)
  const remote = ctx.plugin(SearchRoutingController); await remote
  const handler = connection.createSharedFetchHandler('/api')
  let sequence = 0
  async function call(status = 200) {
    const endpoint = 'githubCopilotSearchRouting/providers', rpcId = `catalog-${++sequence}`
    const response = await handler.fetch(new Request(`http://fixture.invalid/api/${endpoint}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId, method: endpoint, payload: { args: {} } }),
    }))
    assert.equal(response.status, status)
    if (status !== 200) return undefined
    const envelope = await response.json()
    assert.equal(envelope.type, 'server-response'); assert.equal(envelope.rpcId, rpcId)
    assert.equal(envelope.result.ok, true)
    return envelope.result.value
  }
  assert.deepEqual(await call(), { supported: false, providers: [] })
  const facade = ctx.plugin(CopilotRoutedWeb); await facade
  const unexpected = () => assert.fail('Listing registrations must not check availability or search')
  const provider = ctx.plugin({ apply(c) {
    c.get('web').registerSearchProvider({ id: 'new-third-party-provider', available: unexpected, search: unexpected })
  } }); await provider
  assert.deepEqual(await call(), { supported: true, providers: [{ id: 'new-third-party-provider' }] })
  await provider.dispose()
  assert.deepEqual(await call(), { supported: true, providers: [] })
  await facade.dispose()
  assert.deepEqual(await call(), { supported: false, providers: [] })
  await remote.dispose()
  await call(404)
})
