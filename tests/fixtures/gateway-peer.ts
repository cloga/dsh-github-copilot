import type { Context } from '@deepseek-ai/cordis'
import * as Connection from '@deepseek-ai/dsh-client-connection'

/** Bind the candidate's public owner Peer; historical carriers predate Peers. */
export function fixturePeer(ctx: Context) {
  return ['0.2.1-alpha.4', '0.2.1-alpha.5'].includes(process.env.DSH_PUBLISHED_CORE_RELEASE ?? '')
    ? new Connection.Peer(ctx, { principal: { kind: 'owner' } }) : undefined
}

export function fixtureFetchHandler(ctx: Context, connection: Connection.HostConnectionService) {
  const handler = connection.createSharedFetchHandler('/api')
  const peer = fixturePeer(ctx)
  if (peer === undefined) return handler
  return { fetch: (request: Request) => handler.fetch(request, peer) }
}
