import type { Context } from '@deepseek-ai/cordis'
import type { ToolSchema } from '@deepseek-ai/dsh-llm'

const GITHUB_COPILOT_PROVIDER_ID = 'github-copilot'
const ESCALATION_FIELDS = new Set(['sandbox_permissions', 'justification'])

interface PromptAssemblyView {
  readonly variables: Readonly<Record<string, string | undefined>>
  readonly tools: readonly ToolSchema[]
}

function withoutEscalationFields(tool: ToolSchema): ToolSchema {
  const properties = tool.parameters.properties
  if (typeof properties !== 'object' || properties === null || Array.isArray(properties)) return tool
  const entries = Object.entries(properties)
  if (!entries.some(([name]) => ESCALATION_FIELDS.has(name))) return tool
  const filteredProperties = Object.fromEntries(entries.filter(([name]) => !ESCALATION_FIELDS.has(name)))
  const required = Array.isArray(tool.parameters.required)
    ? tool.parameters.required.filter(name => typeof name !== 'string' || !ESCALATION_FIELDS.has(name))
    : undefined
  return {
    ...tool,
    parameters: {
      ...tool.parameters,
      properties: filteredProperties,
      ...required === undefined ? {} : { required },
    },
  }
}

/**
 * Copilot models repeatedly emit optional sandbox-escalation arguments even
 * when the current policy cannot widen. Remove those arguments from the model
 * surface instead of relying on optional JSON-schema semantics. Other model
 * providers retain the original schema and escalation path.
 */
export function filterCopilotToolAssembly<T extends PromptAssemblyView>(assembly: T): T {
  if (assembly.variables.provider !== GITHUB_COPILOT_PROVIDER_ID) return assembly
  const tools = assembly.tools.map(withoutEscalationFields)
  if (tools.every((tool, index) => tool === assembly.tools[index])) return assembly
  return { ...assembly, tools } as T
}

/** Install the provider-scoped filter after Agent model selection has run. */
export function installCopilotToolSchemaCompatibility(ctx: Context): void {
  ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
    const assembled = await next()
    return filterCopilotToolAssembly(assembled)
  })
}
