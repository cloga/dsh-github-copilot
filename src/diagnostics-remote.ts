import type { RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'
import { strictRemoteCodec } from './remote-codec.ts'
import { DiagnosticsRowSchema, DiagnosticsViewSchema } from './diagnostics-types.ts'
import type { DiagnosticsView } from './diagnostics-types.ts'
export const ClientDiagnosticsBatchSchema = z.object({
  epoch: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  rows: z.array(DiagnosticsRowSchema.refine(row => row.layer === 'client')).max(128),
  dropped: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  unconfirmed: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
}).strict()
export type ClientDiagnosticsBatch = z.infer<typeof ClientDiagnosticsBatchSchema>
declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespaceMap {
    githubCopilotDiagnostics: {
      get(): Promise<RemoteResult<DiagnosticsView>>
      setEnabled(enabled: boolean): Promise<RemoteResult<DiagnosticsView>>
      setAutoAllocationEnabled(enabled: boolean): Promise<RemoteResult<DiagnosticsView>>
      setRequestEnabled(enabled: boolean): Promise<RemoteResult<DiagnosticsView>>
      clear(): Promise<RemoteResult<DiagnosticsView>>
      recordClient(batch: ClientDiagnosticsBatch): Promise<RemoteResult<DiagnosticsView>>
    }
  }
}
const result = strictRemoteCodec('dsh-github-copilot#DiagnosticsView', DiagnosticsViewSchema)
const contribution: TypertRemoteContribution = {
  package: 'dsh-github-copilot',
  descriptors: [
    { method: 'get', parameters: [] },
    { method: 'clear', parameters: [] },
    { method: 'setEnabled', parameters: [{ name: 'enabled', wire: 'enabled', source: 'json' as const,
      codec: strictRemoteCodec('dsh-github-copilot#DiagnosticsEnabled', z.boolean()) }] },
    { method: 'setAutoAllocationEnabled', parameters: [{ name: 'enabled', wire: 'enabled', source: 'json' as const,
      codec: strictRemoteCodec('dsh-github-copilot#AutoAllocationDiagnosticsEnabled', z.boolean()) }] },
    { method: 'setRequestEnabled', parameters: [{ name: 'enabled', wire: 'enabled', source: 'json' as const,
      codec: strictRemoteCodec('dsh-github-copilot#RequestDiagnosticsEnabled', z.boolean()) }] },
    { method: 'recordClient', parameters: [{ name: 'batch', wire: 'batch', source: 'json' as const,
      codec: strictRemoteCodec('dsh-github-copilot#ClientDiagnosticsBatch', ClientDiagnosticsBatchSchema) }] },
  ].map(descriptor => ({ ...descriptor, id: `dsh-github-copilot:githubCopilotDiagnostics.${descriptor.method}`,
    namespace: 'githubCopilotDiagnostics', service: 'githubCopilotDiagnostics', invocation: { kind: 'direct' }, result })),
}
export default contribution
