import { z } from 'zod'
import { normalizeExcludedModelIds } from './model-exclusions.ts'

export const AUTO_ALLOCATION_POLICY = 'high-cost-v1'
export const AutoAllocationSchema = z.object({
  policyVersion: z.literal(AUTO_ALLOCATION_POLICY),
  selectedModelId: z.string().min(1).max(512),
  candidates: z.array(z.object({
    modelId: z.string().min(1).max(512),
    highCost: z.boolean(),
    previous: z.boolean(),
    weight: z.number().positive().max(1.5),
    expectedShare: z.number().positive().max(1),
  }).strict()).min(1).max(512),
}).strict().refine(value => {
  const total = value.candidates.reduce((sum, row) => sum + row.weight, 0)
  return new Set(value.candidates.map(row => row.modelId)).size === value.candidates.length
    && value.candidates.some(row => row.modelId === value.selectedModelId)
    && value.candidates.filter(row => row.previous).length <= 1
    && value.candidates.every(row => row.weight === (row.highCost ? 2 : 10) * (row.previous ? 1.5 : 1) / 10
      && Math.abs(row.expectedShare - row.weight / total) <= 1e-12)
}, { message: 'Invalid allocation policy evidence' })
type AllocationValue = z.infer<typeof AutoAllocationSchema>
export type AutoAllocation = Readonly<Omit<AllocationValue, 'candidates'>> & {
  readonly candidates: readonly Readonly<AllocationValue['candidates'][number]>[]
}

export function normalizeHighCostModelIds(value: unknown): readonly string[] {
  try { return normalizeExcludedModelIds(value) }
  catch (cause) {
    if (cause instanceof Error && cause.message === 'COPILOT_MODEL_EXCLUSIONS_INVALID') {
      throw new Error('COPILOT_HIGH_COST_MODELS_INVALID')
    }
    throw cause
  }
}

/** Integer policy units avoid cumulative decimal drift; avalanche sequential turn seeds. */
export function allocateAutoModel(
  pool: readonly { readonly id: string }[],
  highCostModelIds: unknown,
  previousModelId: string | undefined,
  seed: number,
): AutoAllocation {
  if (!Number.isSafeInteger(seed) || pool.length === 0 || pool.length > 512
    || normalizeExcludedModelIds(pool.map(model => model.id)).length !== pool.length) {
    throw new Error('COPILOT_AUTO_ALLOCATION_INVALID')
  }
  const marked = new Set(normalizeHighCostModelIds(highCostModelIds))
  const rows = pool.map(model => {
    const highCost = marked.has(model.id)
    const previous = model.id === previousModelId
    const units = (highCost ? 2 : 10) * (previous ? 1.5 : 1)
    return { modelId: model.id, highCost, previous, units }
  })
  const total = rows.reduce((sum, row) => sum + row.units, 0)
  let hash = seed >>> 0
  hash = Math.imul(hash ^ hash >>> 16, 0x85ebca6b)
  hash = Math.imul(hash ^ hash >>> 13, 0xc2b2ae35)
  const point = ((hash ^ hash >>> 16) >>> 0) / 0x1_0000_0000 * total
  let boundary = 0
  const selected = rows.find(row => {
    boundary += row.units
    return point < boundary
  })!
  return Object.freeze({
    policyVersion: AUTO_ALLOCATION_POLICY,
    selectedModelId: selected.modelId,
    candidates: Object.freeze(rows.map(({ units, ...row }) => Object.freeze({
      ...row, weight: units / 10, expectedShare: units / total,
    }))),
  })
}
