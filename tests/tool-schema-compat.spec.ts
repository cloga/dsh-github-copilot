import { MessageId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import { describe, expect, it } from 'vitest'
import { filterCopilotToolRequest } from '../src/tool-schema-compat.ts'

function assembly(provider: string) {
  return {
    provider,
    model: 'fixture',
    messages: [],
    tools: [
      {
        name: 'pwsh',
        description: 'Run PowerShell',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string' },
            sandbox_permissions: { type: 'string' },
            justification: { type: 'string' },
          },
          required: ['command', 'sandbox_permissions', 'justification'],
        },
      },
      {
        name: 'update_goal',
        description: 'Update the current goal',
        parameters: {
          type: 'object',
          properties: {
            goal_id: { type: 'string' },
            revision: { type: 'number' },
            action: { type: 'string', enum: ['edit', 'pause', 'resume', 'complete', 'blocked'] },
            objective: { type: 'string' },
            max_goal_rounds: { type: 'number' },
            blocked_reason: { type: 'string' },
          },
          required: ['goal_id', 'revision', 'action'],
        },
      },
      {
        name: 'read',
        description: 'Read a file',
        parameters: {
          type: 'object',
          properties: { file_path: { type: 'string' } },
          required: ['file_path'],
        },
      },
      {
        name: 'run_code',
        description: 'Run code through the selected PTC runtime',
        parameters: {
          type: 'object',
          properties: {
            code: { type: 'string' },
            description: { type: 'string' },
            sandbox_permissions: { type: 'string' },
            justification: { type: 'string' },
          },
          required: ['code', 'description'],
        },
      },
      {
        name: 'team_task_list',
        description: 'List Team tasks with provider-owned pagination',
        parameters: {
          type: 'object',
          properties: {
            cursor: { type: 'integer' },
            limit: { type: 'integer' },
          },
        },
      },
    ],
  }
}

describe('Copilot tool-schema compatibility', () => {
  it('preserves code-first PTC instructions, timeout and native schema ownership', () => {
    const parameters = {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'The body of an async TypeScript function.' },
        description: { type: 'string', description: 'Short program summary' },
        timeoutMs: { type: 'number', description: 'Includes nested tool and approval waits' },
        sandbox_permissions: { type: 'string' },
        justification: { type: 'string' },
      },
      required: ['code', 'description'],
    }
    const tool = {
      name: 'run_code',
      description: 'Execute the BODY of an async function; top-level await and return work. Programs are never replayed automatically.',
      parameters,
    }
    const input = { provider: 'github-copilot-preview', model: 'fixture', messages: [], tools: [tool] }
    const filtered = filterCopilotToolRequest(input)
    const result = filtered.tools![0]!
    expect(result.description).toBe(tool.description)
    expect(Object.keys(result.parameters.properties!)).toEqual(['code', 'description', 'timeoutMs'])
    expect(result.parameters.required).toEqual(['code', 'description'])
    expect(result.parameters.properties).toEqual({
      code: parameters.properties.code, description: parameters.properties.description, timeoutMs: parameters.properties.timeoutMs,
    })
    expect(tool.parameters).toBe(parameters)
    expect(parameters.properties).toHaveProperty('sandbox_permissions')
    expect(filterCopilotToolRequest({ ...input, provider: 'deepseek' }).tools![0]).toBe(tool)
  })

  it('removes escalation properties and required entries only for Copilot', () => {
    const input = assembly('github-copilot-preview')
    const filtered = filterCopilotToolRequest(input)

    expect(filtered).not.toBe(input)
    expect(filtered.tools?.[0]?.parameters).toEqual({
      type: 'object',
      properties: { command: { type: 'string' } },
      required: ['command'],
    })
    expect(filtered.tools?.[2]).toBe(input.tools[2])
    expect(filtered.tools?.[3]?.parameters.properties).toEqual({
      code: { type: 'string' },
      description: { type: 'string' },
    })
    expect(filtered.tools?.[4]).toBe(input.tools[4])
    expect(input.tools[0]?.parameters.properties).toHaveProperty('sandbox_permissions')
    expect(input.tools[0]?.parameters.required).toEqual(['command', 'sandbox_permissions', 'justification'])
  })

  it('turns update_goal into action-specific schemas only for Copilot', () => {
    const input = assembly('github-copilot-preview')
    const filtered = filterCopilotToolRequest(input)
    const parameters = filtered.tools?.[1]?.parameters

    expect(parameters).toEqual({
      type: 'object',
      oneOf: [
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            goal_id: { type: 'string' },
            revision: { type: 'number' },
            action: { type: 'string', const: 'edit' },
            objective: { type: 'string' },
            max_goal_rounds: { type: 'number' },
          },
          required: ['goal_id', 'revision', 'action'],
        },
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            goal_id: { type: 'string' },
            revision: { type: 'number' },
            action: { type: 'string', const: 'pause' },
          },
          required: ['goal_id', 'revision', 'action'],
        },
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            goal_id: { type: 'string' },
            revision: { type: 'number' },
            action: { type: 'string', const: 'resume' },
          },
          required: ['goal_id', 'revision', 'action'],
        },
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            goal_id: { type: 'string' },
            revision: { type: 'number' },
            action: { type: 'string', const: 'complete' },
          },
          required: ['goal_id', 'revision', 'action'],
        },
        {
          type: 'object',
          additionalProperties: false,
          properties: {
            goal_id: { type: 'string' },
            revision: { type: 'number' },
            action: { type: 'string', const: 'blocked' },
            blocked_reason: { type: 'string' },
          },
          required: ['goal_id', 'revision', 'action', 'blocked_reason'],
        },
      ],
    })
    expect(input.tools[1]?.parameters).toHaveProperty('properties.objective')
  })

  it('preserves every schema for non-Copilot providers', () => {
    const input = assembly('deepseek')
    expect(filterCopilotToolRequest(input)).toBe(input)
  })

  it('copies managed request declarations and historical additions without mutating native input', () => {
    const tools = assembly('github-copilot-preview').tools
    const input: GenerateOptions = {
      provider: 'github-copilot-preview',
      model: 'fixture',
      messages: [],
      tools,
      toolHistory: { tools, updates: [{ messageId: MessageId('fixture-update'), additions: tools }] },
    }
    Object.freeze(input)
    Object.freeze(input.tools)
    Object.freeze(input.toolHistory)
    Object.freeze(input.toolHistory?.updates)

    const result = filterCopilotToolRequest(input)
    expect(result).not.toBe(input)
    expect(result.tools?.[0]?.parameters.properties).toEqual({ command: { type: 'string' } })
    expect(result.toolHistory?.tools[0]?.parameters.properties).toEqual({ command: { type: 'string' } })
    expect(result.toolHistory?.updates[0]?.additions[1]?.parameters).toHaveProperty('oneOf')
    expect(input.tools?.[0]?.parameters.properties).toHaveProperty('sandbox_permissions')
    expect(input.toolHistory?.updates[0]?.additions[1]?.parameters).toHaveProperty('properties.objective')
  })

  it('leaves other routes and managed requests without affected tools unchanged', () => {
    const tools = assembly('deepseek').tools
    const other: GenerateOptions = { provider: 'deepseek', model: 'fixture', messages: [], tools }
    const canonical: GenerateOptions = { ...other, provider: 'github-copilot' }
    const plain: GenerateOptions = { ...other, provider: 'github-copilot-preview', tools: [tools[2]!] }
    expect(filterCopilotToolRequest(other)).toBe(other)
    expect(filterCopilotToolRequest(canonical)).toBe(canonical)
    expect(filterCopilotToolRequest(plain)).toBe(plain)
  })
})
