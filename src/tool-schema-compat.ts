import type { GenerateOptions, ToolSchema } from '@deepseek-ai/dsh-llm'

import { GITHUB_COPILOT_PREVIEW_PROVIDER_ID } from './copilot-identity.ts'
const ESCALATION_FIELDS = new Set(['sandbox_permissions', 'justification'])
const GOAL_UPDATE_TOOL_NAME = 'update_goal'
const GOAL_BASE_FIELDS = ['goal_id', 'revision'] as const
const GOAL_ACTIONS = ['edit', 'pause', 'resume', 'complete', 'blocked'] as const

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

function compatibleTools(tools: ToolSchema[]): ToolSchema[]
function compatibleTools(tools: readonly ToolSchema[]): readonly ToolSchema[]
function compatibleTools(tools: readonly ToolSchema[]): readonly ToolSchema[] {
  const filtered = tools.map(makeCopilotCompatible)
  return filtered.every((tool, index) => tool === tools[index]) ? tools : filtered
}

/**
 * Adapt only the managed route's provider-facing declarations. Core retains its
 * frozen request, conditional-tool selection, execution and recorded history.
 */
export function filterCopilotToolRequest(options: GenerateOptions): GenerateOptions {
  if (options.provider !== GITHUB_COPILOT_PREVIEW_PROVIDER_ID) return options
  const tools = options.tools === undefined ? undefined : compatibleTools(options.tools)
  const originalHistory = options.toolHistory
  let toolHistory = originalHistory
  if (originalHistory !== undefined) {
    const historyTools = compatibleTools(originalHistory.tools)
    const updates = originalHistory.updates.map(update => {
      const additions = compatibleTools(update.additions)
      return additions === update.additions ? update : { ...update, additions }
    })
    if (historyTools !== originalHistory.tools || updates.some((update, index) => update !== originalHistory.updates[index])) {
      toolHistory = { ...originalHistory, tools: historyTools, updates }
    }
  }
  if (tools === options.tools && toolHistory === originalHistory) return options
  return { ...options, ...tools === undefined ? {} : { tools }, ...toolHistory === undefined ? {} : { toolHistory } }
}
