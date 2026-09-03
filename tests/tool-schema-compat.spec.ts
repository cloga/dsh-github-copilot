import { Context } from '@deepseek-ai/cordis'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import { describe, expect, it } from 'vitest'
import {
  filterCopilotToolAssembly,
  installCopilotToolSchemaCompatibility,
} from '../src/tool-schema-compat.ts'

function assembly(provider: string) {
  return {
    sections: [],
    contexts: [],
    variables: { provider, model: 'gpt-5.6-sol' },
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
    ],
  }
}

describe('Copilot tool-schema compatibility', () => {
  it('removes escalation properties and required entries only for Copilot', () => {
    const input = assembly('github-copilot')
    const filtered = filterCopilotToolAssembly(input)

    expect(filtered).not.toBe(input)
    expect(filtered.tools[0]?.parameters).toEqual({
      type: 'object',
      properties: { command: { type: 'string' } },
      required: ['command'],
    })
    expect(filtered.tools[2]).toBe(input.tools[2])
    expect(input.tools[0]?.parameters.properties).toHaveProperty('sandbox_permissions')
    expect(input.tools[0]?.parameters.required).toEqual(['command', 'sandbox_permissions', 'justification'])
  })

  it('turns update_goal into action-specific schemas only for Copilot', () => {
    const input = assembly('github-copilot')
    const filtered = filterCopilotToolAssembly(input)
    const parameters = filtered.tools[1]?.parameters

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
    expect(filterCopilotToolAssembly(input)).toBe(input)
  })

  it('filters a real Cordis waterfall after model selection supplies the provider', async () => {
    const ctx = new Context()
    installCopilotToolSchemaCompatibility(ctx)
    installModelSelection(ctx, {
      current: { provider: 'github-copilot', model: 'gpt-5.6-sol' },
      assembled: undefined,
    })
    const input = assembly('')

    const result = await ctx.waterfall(
      'system-prompt/assemble',
      input,
      {},
      async () => input,
    )

    expect(result.variables.provider).toBe('github-copilot')
    expect(result.tools[0]?.parameters.properties).toEqual({ command: { type: 'string' } })
  })
})
