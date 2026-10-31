export interface HydraFusionDescriptor {
  readonly id: string
  readonly displayName: string
  readonly description?: string
  readonly fusionTier?: string
}

export interface HydraFusionDescriptorResult {
  readonly status: 'unavailable' | 'ready'
  readonly descriptors: readonly HydraFusionDescriptor[]
  readonly truncated: boolean
}

type JsonRecord = Record<string, unknown>

const MAX_SOURCE_TIERS = 128
const MAX_DESCRIPTORS = 32
const MAX_FIELD_LENGTH = 512

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isBoundedString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_FIELD_LENGTH
}

/**
 * Maps only account-bound, explicitly enabled, picker-visible Fusion
 * descriptors from the Copilot SDK session.model.list response. IDs are opaque
 * and remain unchanged; this does not select a tier or prove execution support.
 */
export function mapHydraFusionDescriptors(value: unknown): HydraFusionDescriptorResult {
  if (!isRecord(value) || !isRecord(value.auto) || !Array.isArray(value.auto.tiers)) {
    return { status: 'unavailable', descriptors: [], truncated: false }
  }

  const tiers = value.auto.tiers
  if (tiers.length > MAX_SOURCE_TIERS) {
    return { status: 'unavailable', descriptors: [], truncated: true }
  }

  const idCounts = new Map<string, number>()
  for (const tier of tiers) {
    if (isRecord(tier) && isBoundedString(tier.id)) idCounts.set(tier.id, (idCounts.get(tier.id) ?? 0) + 1)
  }

  const candidates: HydraFusionDescriptor[] = []
  for (const tier of tiers) {
    if (!isRecord(tier) || tier.type !== 'fusion' || !isBoundedString(tier.id) || idCounts.get(tier.id) !== 1
      || !isBoundedString(tier.displayName)) continue
    const status = tier.status
    if (!isRecord(status) || status.enabled !== true || status.pickerVisible === false
      || (status.pickerVisible !== undefined && status.pickerVisible !== true)) continue
    if (tier.description !== undefined && !isBoundedString(tier.description)) continue
    if (tier.fusionTier !== undefined && !isBoundedString(tier.fusionTier)) continue

    candidates.push({
      id: tier.id,
      displayName: tier.displayName,
      ...(tier.description === undefined ? {} : { description: tier.description }),
      ...(tier.fusionTier === undefined ? {} : { fusionTier: tier.fusionTier }),
    })
  }

  const descriptors = candidates.slice(0, MAX_DESCRIPTORS)
  return {
    status: descriptors.length > 0 ? 'ready' : 'unavailable',
    descriptors,
    truncated: candidates.length > MAX_DESCRIPTORS,
  }
}
