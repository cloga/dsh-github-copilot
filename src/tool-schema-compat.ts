import type { Context } from '@deepseek-ai/cordis'
import type { ToolSchema } from '@deepseek-ai/dsh-llm'

const GITHUB_COPILOT_PROVIDER_ID = 'github-copilot'
const ESCALATION_FIELDS = new Set(['sandbox_permissions', 'justification'])
const GOAL_UPDATE_TOOL_NAME = 'update_goal'
const GOAL_BASE_FIELDS = ['goal_id', 'revision'] as const
const GOAL_ACTIONS = ['edit', 'pause', 'resume', 'complete', 'blocked'] as const

interface PromptAssemblyView {
  readonly variables: Readonly<Record<string, string | undefined>>
  readonly tools: readonly ToolSchema[]
}

function objectProperties(tool: ToolSchema): Record<string, unknown> | undefined {
  const properties = tool.parameters.properties
  if (typeof properties !== 'object' || properties === null || Array.isArray(properties)) return undefined
  return properties as Record<string, unknown>
}

function withoutEscalationFields(tool: ToolSchema): ToolSchema {
  const properties = objectProperties(tool)
  if (properties === undefined) return tool
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

function goalActionSchema(
  properties: Record<string, unknown>,
  action: typeof GOAL_ACTIONS[number],
): Record<string, unknown> {
  const names = action === 'edit'
    ? [...GOAL_BASE_FIELDS, 'action', 'objective', 'max_goal_rounds']
    : action === 'blocked'
      ? [...GOAL_BASE_FIELDS, 'action', 'blocked_reason']
      : [...GOAL_BASE_FIELDS, 'action']
  const branchProperties = Object.fromEntries(names.map((name) => [
    name,
    name === 'action' ? { type: 'string', const: action } : properties[name],
  ]))
  return {
    type: 'object',
    additionalProperties: false,
    properties: branchProperties,
    required: [
      ...GOAL_BASE_FIELDS,
      'action',
      ...action === 'blocked' ? ['blocked_reason'] : [],
    ],
  }
}

function withActionSpecificGoalSchema(tool: ToolSchema): ToolSchema {
  if (tool.name !== GOAL_UPDATE_TOOL_NAME) return tool
  const properties = objectProperties(tool)
  if (properties === undefined) return tool
  const requiredFields = [
    ...GOAL_BASE_FIELDS,
    'action',
    'objective',
    'max_goal_rounds',
    'blocked_reason',
  ]
  if (!requiredFields.every(name => properties[name] !== undefined)) return tool
  return {
    ...tool,
    parameters: {
      type: 'object',
      oneOf: GOAL_ACTIONS.map(action => goalActionSchema(properties, action)),
    },
  }
}

function makeCopilotCompatible(tool: ToolSchema): ToolSchema {
  return withActionSpecificGoalSchema(withoutEscalationFields(tool))
}

/**
 * Copilot models repeatedly emit optional arguments even when runtime state
 * makes them invalid. Remove unusable sandbox escalation fields and expose the
 * multi-action Goal update as a discriminated union, so each action advertises
 * only its legal fields. Other model providers retain the original schemas.
 */
export function filterCopilotToolAssembly<T extends PromptAssemblyView>(assembly: T): T {
  if (assembly.variables.provider !== GITHUB_COPILOT_PROVIDER_ID) return assembly
  const tools = assembly.tools.map(makeCopilotCompatible)
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
