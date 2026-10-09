import type { Agent } from '@deepseek-ai/dsh-agent'
import { LlmError } from '@deepseek-ai/dsh-llm'

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Resolve the owning preset's service without reaching into Core's service registry. */
export function agentCompaction(agent: Agent): unknown {
  if (typeof agent.ctx?.get !== 'function') {
    throw new LlmError('COPILOT_COMPACTION_AGENT_CONTEXT_UNAVAILABLE', 'INVALID_REQUEST')
  }
  const presets: unknown = agent.ctx.get('agentPresets')
  if (presets !== undefined) {
    if (!record(presets) || typeof presets.composedPreset !== 'function' || typeof presets.serviceFor !== 'function') {
      throw new LlmError('COPILOT_COMPACTION_PRESET_LOOKUP_UNAVAILABLE', 'INVALID_REQUEST')
    }
    const preset: unknown = presets.composedPreset(agent.ctx)
    if (preset !== undefined) {
      if (typeof preset !== 'string' || preset.trim().length === 0) {
        throw new LlmError('COPILOT_COMPACTION_PRESET_LOOKUP_UNAVAILABLE', 'INVALID_REQUEST')
      }
      return presets.serviceFor(agent, 'compaction')
    }
  }
  return agent.ctx.get('compaction')
}
