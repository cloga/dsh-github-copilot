/** Client-safe, strict wire contract for the optional Copilot model-role feature. */
import type { RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'
import type { DualModelConfig, DualModelView, DualModelSaveRequest, DualModelCreateRequest, DualModelCreateResult } from './dual-model-types.ts'
export type { DualModelConfig, DualModelView, DualModelSaveRequest, DualModelCreateRequest, DualModelCreateResult } from './dual-model-types.ts'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    'copilot/dual-model': { readonly reason: string; readonly creation?: 'not-created' | 'uncertain' }
  }
  interface TypertRemoteNamespaceMap {
    githubCopilotDualModel: {
      view(): Promise<RemoteResult<DualModelView>>
      save(input: DualModelSaveRequest): Promise<RemoteResult<DualModelView>>
      create(input: DualModelCreateRequest): Promise<RemoteResult<DualModelCreateResult>>
    }
  }
}

const id = z.string().min(1).max(512)
const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
export const DualModelConfigSchema = z.object({
  enabled: z.boolean(), plannerModel: z.string().max(512), executorModel: z.string().max(512),
}).strict()
export const DualModelViewSchema = z.object({
  supported: z.boolean(), diagnostic: z.string().min(1).max(128).optional(),
  writable: z.boolean(), revision: revision.nullable(), configuration: DualModelConfigSchema,
  models: z.array(z.object({ id, name: z.string().min(1).max(1024) }).strict()).max(512),
  workspaces: z.array(z.object({ id, name: z.string().min(1).max(1024) }).strict()).max(1024),
}).strict()
export const DualModelSaveSchema = z.object({
  configuration: DualModelConfigSchema, expectedRevision: revision,
}).strict()
export const DualModelCreateSchema = z.object({
  requestId: z.string().uuid(), workspaceId: id, expectedRevision: revision,
}).strict()
export const DualModelCreateResultSchema = z.object({ sessionId: id }).strict()

const contribution: TypertRemoteContribution = {
  package: 'dsh-github-copilot',
  descriptors: [
    {
      id: 'dsh-github-copilot:githubCopilotDualModel.view',
      namespace: 'githubCopilotDualModel', service: 'githubCopilotDualModel', method: 'view',
      invocation: { kind: 'direct' }, parameters: [],
      result: { mode: 'strict', typeSymbol: 'dsh-github-copilot#DualModelView', schema: DualModelViewSchema },
    },
    {
      id: 'dsh-github-copilot:githubCopilotDualModel.save',
      namespace: 'githubCopilotDualModel', service: 'githubCopilotDualModel', method: 'save',
      invocation: { kind: 'direct' }, parameters: [{ name: 'input', wire: 'input', source: 'json',
        codec: { mode: 'strict', typeSymbol: 'dsh-github-copilot#DualModelSaveRequest', schema: DualModelSaveSchema } }],
      result: { mode: 'strict', typeSymbol: 'dsh-github-copilot#DualModelView', schema: DualModelViewSchema },
    },
    {
      id: 'dsh-github-copilot:githubCopilotDualModel.create',
      namespace: 'githubCopilotDualModel', service: 'githubCopilotDualModel', method: 'create',
      invocation: { kind: 'direct' }, parameters: [{ name: 'input', wire: 'input', source: 'json',
        codec: { mode: 'strict', typeSymbol: 'dsh-github-copilot#DualModelCreateRequest', schema: DualModelCreateSchema } }],
      result: { mode: 'strict', typeSymbol: 'dsh-github-copilot#DualModelCreateResult', schema: DualModelCreateResultSchema },
    },
  ],
}
export default contribution
