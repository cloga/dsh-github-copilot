import type { RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'
import { strictRemoteCodec } from './remote-codec.ts'
import { COPILOT_USAGE_DIAGNOSTICS, COPILOT_USAGE_MAX_AMOUNT, COPILOT_USAGE_MAX_TIMESTAMP } from './copilot-usage-types.ts'
import type { CopilotUsageView } from './copilot-usage-types.ts'
export type { CopilotUsageView } from './copilot-usage-types.ts'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespaceMap {
    githubCopilotUsage: {
      get(): Promise<RemoteResult<CopilotUsageView>>
      refresh(): Promise<RemoteResult<CopilotUsageView>>
    }
  }
}

const amount = z.number().finite().nonnegative().max(COPILOT_USAGE_MAX_AMOUNT)
const timestamp = z.number().int().nonnegative().max(COPILOT_USAGE_MAX_TIMESTAMP)
export const CopilotUsageViewSchema = z.object({
  state: z.enum(['ready', 'stale', 'unavailable', 'signed-out']),
  billing: z.enum(['credits', 'requests', 'unknown']),
  budget: z.enum(['individual', 'pooled', 'unknown']),
  used: amount.optional(), remaining: amount.optional(), limit: amount.positive().optional(),
  percentUsed: z.number().finite().min(0).max(100).optional(),
  resetAt: timestamp.optional(), observedAt: timestamp.optional(),
  diagnostic: z.enum(COPILOT_USAGE_DIAGNOSTICS).optional(),
}).strict().superRefine((view, ctx) => {
  const invalid = () => ctx.addIssue({ code: 'custom', message: 'Invalid account quota snapshot' })
  const hasAmounts = [view.used, view.remaining, view.limit, view.percentUsed].some(value => value !== undefined)
  if (view.state === 'unavailable' || view.state === 'signed-out') {
    if (hasAmounts || view.observedAt !== undefined || view.resetAt !== undefined || view.diagnostic === undefined) invalid()
    if (view.state === 'signed-out' && (view.billing !== 'unknown' || view.budget !== 'unknown')) invalid()
    return
  }
  if (!hasAmounts || view.observedAt === undefined || view.billing === 'unknown' || view.budget === 'unknown') invalid()
  if (view.state === 'stale' && view.diagnostic === undefined) invalid()
  if (view.state === 'ready' && view.diagnostic !== undefined) invalid()
  if (view.budget === 'pooled' && (view.billing !== 'credits' || view.used === undefined
    || view.remaining !== undefined || view.limit !== undefined || view.percentUsed !== undefined)) invalid()
  if (view.limit !== undefined) {
    if ((view.used !== undefined && view.used > view.limit) || (view.remaining !== undefined && view.remaining > view.limit)) invalid()
    if (view.used !== undefined && view.remaining !== undefined
      && Math.abs(view.used + view.remaining - view.limit) > Math.max(1e-8, view.limit * 1e-12)) invalid()
    if (view.remaining !== undefined && view.percentUsed !== undefined
      && Math.abs((1 - view.remaining / view.limit) * 100 - view.percentUsed) > 1) invalid()
  }
})

const contribution: TypertRemoteContribution = {
  package: 'dsh-github-copilot',
  descriptors: ['get', 'refresh'].map(method => ({
    id: `dsh-github-copilot:githubCopilotUsage.${method}`,
    namespace: 'githubCopilotUsage', service: 'githubCopilotUsage', method,
    invocation: { kind: 'direct' }, parameters: [],
    result: strictRemoteCodec('dsh-github-copilot#CopilotUsageView', CopilotUsageViewSchema),
  })),
}
export default contribution
