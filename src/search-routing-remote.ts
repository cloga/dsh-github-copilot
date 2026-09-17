/** Client-safe catalog of search registrations observed by the routed facade. */
import type { RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'
import { strictRemoteCodec } from './remote-codec.ts'

export const SearchProviderCatalogSchema = z.object({
  supported: z.boolean(),
  providers: z.array(z.object({ id: z.string().min(1).max(512) }).strict()).max(512),
}).strict()
export type SearchProviderCatalog = z.infer<typeof SearchProviderCatalogSchema>

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespaceMap {
    githubCopilotSearchRouting: {
      providers(): Promise<RemoteResult<SearchProviderCatalog>>
    }
  }
}
const contribution: TypertRemoteContribution = {
  package: 'dsh-github-copilot',
  descriptors: [{
    id: 'dsh-github-copilot:githubCopilotSearchRouting.providers',
    namespace: 'githubCopilotSearchRouting', service: 'githubCopilotSearchRouting', method: 'providers',
    invocation: { kind: 'direct' }, parameters: [],
    result: strictRemoteCodec('dsh-github-copilot#SearchProviderCatalog', SearchProviderCatalogSchema),
  }],
}
export default contribution
