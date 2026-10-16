import type { Context } from '@deepseek-ai/cordis'
import * as Connection from '@deepseek-ai/dsh-client-connection'

/** Bind the candidate's public owner Peer; historical carriers predate Peers. */
export function fixtureFetchHandler(ctx: Context, connection: Connection.HostConnectionService) {
  const handler = connection.createSharedFetchHandler('/api')
  if (process.env.DSH_PUBLISHED_CORE_RELEASE !== '0.2.1-alpha.4') return handler
  const peer = new Connection.Peer(ctx, { principal: { kind: 'owner' } })
  return { fetch: (request: Request) => handler.fetch(request, peer) }
}
