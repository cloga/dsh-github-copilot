import { z } from 'zod'
import type { RequestBodyEvidence } from './request-body-evidence.ts'
import type { RequestUploadEvidence } from './request-upload-evidence.ts'

const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const composition = z.discriminatedUnion('state', [
  z.object({
    state: z.literal('complete'), totalBytes: integer, conversationBytes: integer,
    toolSchemaBytes: integer, systemBytes: integer, otherBytes: integer,
    imageBlockBytes: integer, opaqueReplayBytes: integer, remainingConversationBytes: integer,
  }).strict(),
  z.object({ state: z.enum(['unavailable', 'size-limit', 'work-limit', 'invalid-json', 'unsupported-shape', 'cancelled', 'time-limit']),
    totalBytes: integer.optional() }).strict(),
])
const upload = z.discriminatedUnion('state', [
  z.object({ state: z.literal('observed'), bodyWrite: z.enum(['observed', 'not-observed']),
    bodyWriteCompleteMs: integer.optional(), nativeResponseHeadersMs: integer.optional(),
    alpn: z.enum(['h2', 'http/1.1', 'unavailable']), nodeWritableBufferBytes: integer.optional() }).strict(),
  z.object({ state: z.enum(['unavailable', 'work-limit']) }).strict(),
  z.object({ state: z.literal('ambiguous'), requestCount: integer }).strict(),
])
export const REQUEST_DIAGNOSTICS_MAX_ROWS = 128
export const REQUEST_DIAGNOSTICS_RETENTION_MS = 24 * 60 * 60 * 1000
export const RequestDiagnosticSchema = z.object({
  streamId: z.string().uuid(), dispatchIndex: integer.min(1),
  version: z.string().max(64).regex(/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/),
  startedAt: integer, elapsedMs: integer,
  model: z.string().max(128).regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/),
  protocol: z.enum(['openai-responses', 'openai-completions', 'anthropic-messages']),
  composition, encoding: z.enum(['identity', 'gzip', 'unknown']), wireBytes: integer.optional(),
  upload: upload.optional(), responseHeadersMs: integer.optional(),
  httpStatus: integer.min(100).max(599).optional(),
  outcome: z.enum(['http-error', 'transport-error', 'stream-done', 'stream-error', 'cancelled', 'interrupted']),
  reason: z.enum(['none', 'unknown', 'request-body-timeout', 'caller-abort', 'credential-changed',
    'disposed', 'byte-idle-timeout', 'signal-abort']),
}).strict()
export const RequestDiagnosticsSchema = z.object({
  rows: z.array(RequestDiagnosticSchema).max(REQUEST_DIAGNOSTICS_MAX_ROWS),
  dropped: integer, evicted: integer,
  pending: integer.max(REQUEST_DIAGNOSTICS_MAX_ROWS).optional(),
  interruptedOnReopen: integer.optional(),
}).strict()
export type RequestDiagnostic = z.infer<typeof RequestDiagnosticSchema>
export interface RequestDiagnosticHandle {
  composition?(evidence: RequestBodyEvidence): void
  isCurrent?(): boolean
  headers(status: number | undefined, ms: number | undefined, upload?: RequestUploadEvidence): void
  finish(outcome: RequestDiagnostic['outcome'], reason?: RequestDiagnostic['reason']): void
}
export interface RequestDiagnosticStart {
  streamId: string
  dispatchIndex: number
  model: string
  protocol: RequestDiagnostic['protocol']
  composition: RequestBodyEvidence
  encoding: RequestDiagnostic['encoding']
  wireBytes?: number
}
