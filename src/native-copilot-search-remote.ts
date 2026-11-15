import type { RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'
import { strictRemoteCodec } from './remote-codec.ts'

export const NativeCopilotSearchModelsSchema = z.object({
  models: z.array(z.object({ id: z.string().min(1).max(512) }).strict()).max(512),
}).strict()
export type NativeCopilotSearchModels = z.infer<typeof NativeCopilotSearchModelsSchema>

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespaceMap {
    githubCopilotNativeSearch: {
      models(): Promise<RemoteResult<NativeCopilotSearchModels>>
    }
  }
}

const contribution: TypertRemoteContribution = {
  package: 'dsh-github-copilot',
  descriptors: [{
    id: 'dsh-github-copilot:githubCopilotNativeSearch.models',
    namespace: 'githubCopilotNativeSearch', service: 'githubCopilotNativeSearch', method: 'models',
    invocation: { kind: 'direct' }, parameters: [],
    result: strictRemoteCodec('dsh-github-copilot#NativeCopilotSearchModels', NativeCopilotSearchModelsSchema),
  }],
}
export default contribution
