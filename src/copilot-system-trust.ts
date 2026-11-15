import { getCACertificates } from 'node:tls'
import { Agent } from 'undici'

export function createCopilotSystemTrustAgent(
  certificates: (type: 'default' | 'system') => string[] = getCACertificates,
  create: (options: Agent.Options) => Agent = options => new Agent(options),
): Agent {
  const defaults = certificates('default')
  const system = certificates('system')
  if (!Array.isArray(defaults) || !Array.isArray(system) || system.length === 0
    || [...defaults, ...system].some(ca => typeof ca !== 'string' || ca.length === 0)) {
    throw new Error('COPILOT_SYSTEM_TRUST_UNAVAILABLE')
  }
  const agent = create({ connect: { ca: [...new Set([...defaults, ...system])], rejectUnauthorized: true } })
  if (!agent) throw new Error('COPILOT_SYSTEM_TRUST_UNAVAILABLE')
  return agent
}
