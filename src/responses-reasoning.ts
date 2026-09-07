import type { Context } from '@deepseek-ai/cordis'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import type { SearchPlanCandidate } from './plan.ts'
import type { ResponsesReasoningOptions } from './serialize.ts'

const levels = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined
}
function unavailable(): never {
  throw new Error('COPILOT_RESPONSES_REASONING_UNSUPPORTED: the selected model does not declare the requested reasoning effort')
}

/** Resolve only the selected model's declared/native efforts, with the same precedence as Core. */
export function resolveCopilotResponsesReasoning(
  ctx: Context,
  request: GenerateOptions,
  candidate: Pick<SearchPlanCandidate, 'protocol' | 'model'>,
): ResponsesReasoningOptions | undefined {
  if (request.provider !== 'github-copilot' || candidate.protocol !== 'openai-responses'
    || candidate.model !== request.model) return unavailable()
  const section = object(ctx.get('settings')?.get('llm-pi-ai' as SettingsNamespace))
  const profile = object(object(section?.providers)?.['github-copilot'])
  const effort = request.reasoningEffort ?? profile?.reasoning
  if (effort === undefined) return undefined
  const level = levels.find(value => value === effort)
  if (level === undefined || profile === undefined) return unavailable()
  const configured = Array.isArray(profile.models) ? profile.models : []
  const entry = configured.length > 0
    ? object(configured.find(value => object(value)?.id === request.model))
    : object(object(profile.modelOverrides)?.[request.model])
  if (configured.length > 0 && entry === undefined) return unavailable()
  const declared = entry?.reasoningEfforts
  if (declared !== undefined) {
    if (declared === false) return level === 'off' ? undefined : unavailable()
    const mapping = object(declared)
    if (mapping === undefined) return unavailable()
    const wire = mapping[level]
    // A profile's off:null means "omit the option" in Core, not a server-side disable.
    if (level === 'off' && (wire === null || typeof wire === 'string' && wire.length > 0)) return undefined
    if (typeof wire !== 'string' || wire.length === 0) return unavailable()
    return { effort: wire, summary: 'auto' }
  }
  // A separate local catalog is not authority for Core's native wire mapping.
  // The caller must delegate to the registered adapter rather than guess it.
  throw new Error('COPILOT_RESPONSES_REASONING_CORE_REQUIRED')
}
