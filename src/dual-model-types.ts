/** Credential-free contracts shared by the optional dual-model Host and UI. */
export interface DualModelConfig {
  readonly enabled: boolean
  readonly plannerModel: string
  readonly executorModel: string
}
export interface DualModelView {
  readonly supported: boolean
  readonly diagnostic?: string
  readonly writable: boolean
  readonly revision: number | null
  readonly configuration: DualModelConfig
  readonly models: readonly { readonly id: string; readonly name: string }[]
  readonly workspaces: readonly { readonly id: string; readonly name: string }[]
}
export interface DualModelSaveRequest {
  readonly configuration: DualModelConfig
  readonly expectedRevision: number
}
export interface DualModelCreateRequest {
  readonly requestId: string
  readonly workspaceId: string
  readonly expectedRevision: number
}
export interface DualModelCreateResult { readonly sessionId: string }
