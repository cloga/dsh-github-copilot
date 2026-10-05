import { z } from 'zod'
import { AUTO_ALLOCATION_POLICY } from './auto-allocation.ts'
import type { AutoSelectionExplanation } from './auto-model-routing.ts'

export const AutoAllocationSummarySchema = z.object({
  policyVersion: z.literal(AUTO_ALLOCATION_POLICY),
  scope: z.literal('viewed-session-host-lifetime'),
  status: z.enum(['observed', 'not-collected']),
  retainedDecisions: z.number().int().nonnegative().max(128),
  noFitDecisions: z.number().int().nonnegative().max(128),
  rowsTruncated: z.boolean(),
  completeHistory: z.literal(false),
  observationStart: z.number().int().nonnegative().nullable(),
  observationEnd: z.number().int().nonnegative().nullable(),
  rows: z.array(z.object({
    modelId: z.string().min(1).max(512),
    category: z.enum(['powerful', 'versatile', 'lightweight', 'unknown']),
    highCost: z.boolean(),
    previous: z.boolean(),
    weight: z.number().positive().max(1.5),
    opportunities: z.number().int().positive().max(128),
    expectedSelections: z.number().nonnegative().max(128),
    selections: z.number().int().nonnegative().max(128),
  }).strict()).max(512),
}).strict()
export type AutoAllocationSummary = z.infer<typeof AutoAllocationSummarySchema>

/** Recompute only from captured bounded decisions, never today's settings or history content. */
export function summarizeAutoAllocations(
  explanations: readonly AutoSelectionExplanation[],
  window?: { readonly start: number; readonly end: number },
): AutoAllocationSummary {
  const rows = new Map<string, AutoAllocationSummary['rows'][number]>()
  let noFitDecisions = 0
  let retainedDecisions = 0
  let rowsTruncated = false
  for (const explanation of explanations) {
    if (explanation.method === 'no-fit') { noFitDecisions++; continue }
    const allocation = explanation.allocation
    if (allocation?.policyVersion !== AUTO_ALLOCATION_POLICY) continue
    retainedDecisions++
    for (const row of allocation.candidates) {
      const key = JSON.stringify([row.modelId, explanation.selectedCategory, row.highCost, row.previous, row.weight])
      let aggregate = rows.get(key)
      if (aggregate === undefined) {
        if (rows.size === 512) { rowsTruncated = true; continue }
        aggregate = { modelId: row.modelId, category: explanation.selectedCategory,
          highCost: row.highCost, previous: row.previous, weight: row.weight,
          opportunities: 0, expectedSelections: 0, selections: 0 }
        rows.set(key, aggregate)
      }
      aggregate.opportunities++
      aggregate.expectedSelections += row.expectedShare
      if (allocation.selectedModelId === row.modelId) aggregate.selections++
    }
  }
  return AutoAllocationSummarySchema.parse({
    policyVersion: AUTO_ALLOCATION_POLICY, scope: 'viewed-session-host-lifetime',
    status: retainedDecisions + noFitDecisions === 0 ? 'not-collected' : 'observed',
    retainedDecisions, noFitDecisions, rowsTruncated, completeHistory: false, rows: [...rows.values()],
    observationStart: window?.start ?? null, observationEnd: window?.end ?? null,
  })
}
