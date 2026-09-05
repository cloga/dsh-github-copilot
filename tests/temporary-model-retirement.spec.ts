import { Context } from '@deepseek-ai/cordis'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@earendil-works/pi-ai/providers/all', async (importOriginal) => {
  const original = await importOriginal<typeof import('@earendil-works/pi-ai/providers/all')>()
  return {
    ...original,
    getBuiltinModels(provider: Parameters<typeof original.getBuiltinModels>[0]) {
      const models = original.getBuiltinModels(provider)
      return provider === 'github-copilot'
        ? [...models, { ...models[0], id: 'gpt-6-astra', name: 'GPT-6 Astra', api: 'openai-responses' as const }]
        : models
    },
  }
})

import { inspectGitHubCopilotProviderProfile } from '../src/authorization-controller.ts'
import { temporaryGitHubCopilotModel, temporaryGitHubCopilotModelProfile } from '../src/temporary-models.ts'

const COPILOT_HEADERS = {
  'User-Agent': 'GitHubCopilotChat/0.35.0',
  'Editor-Version': 'vscode/1.107.0',
  'Editor-Plugin-Version': 'copilot-chat/0.35.0',
  'Copilot-Integration-Id': 'vscode-chat',
}

describe('temporary GitHub Copilot model retirement', () => {
  beforeEach(() => vi.clearAllMocks())

  it('removes overlay-owned metadata and headers after pi-ai owns the model', async () => {
    const overlay = temporaryGitHubCopilotModel('gpt-6-astra', new Set())!
    const profile: Record<string, unknown> = {
      api: 'openai-responses',
      compat: { supportsStrictMode: false },
      headers: { 'X-Custom': 'preserved', ...COPILOT_HEADERS },
      models: [
        temporaryGitHubCopilotModelProfile(overlay),
        { id: 'gpt-5.4', api: 'openai-responses', customField: 'preserved-until-list-replacement' },
      ],
    }
    const settingsDocuments: Record<string, Record<string, unknown>> = {
      'llm-pi-ai': { providers: { 'github-copilot': profile } },
      'github-copilot': {
        temporaryRouteBackup: JSON.stringify({
          providerExisted: true,
          leaves: {},
          preservedHeaderNames: [],
        }),
      },
    }
    const mutate = vi.fn(async (namespace: string, operations: Array<
      | { op: 'set'; path: string[]; value: unknown }
      | { op: 'unset'; path: string[] }
    >) => {
      for (const operation of operations) {
        let target = settingsDocuments[namespace]!
        for (const segment of operation.path.slice(0, -1)) {
          target = target[segment] as Record<string, unknown>
        }
        const leaf = operation.path.at(-1)
        if (leaf === undefined) continue
        if (operation.op === 'unset') delete target[leaf]
        else target[leaf] = operation.value
      }
    })
    const ctx = new Context()
    ctx.get = ((name: string) => name === 'credentials'
      ? {
          readRecord: async () => ({
            kind: 'grant',
            payload: {
              type: 'oauth',
              refresh: 'github-device-grant',
              access: 'copilot-api-token',
              expires: Date.now() + 86_400_000,
              availableModelIds: ['gpt-6-astra', 'gpt-5.4'],
            },
          }),
        }
      : name === 'settings'
        ? { get: (namespace: string) => settingsDocuments[namespace], mutate }
        : undefined) as typeof ctx.get

    await expect(inspectGitHubCopilotProviderProfile(ctx)).resolves.toMatchObject({ changed: true })
    expect(mutate).toHaveBeenCalledWith('llm-pi-ai', [{
      op: 'unset',
      path: ['providers', 'github-copilot', 'api'],
    }, {
      op: 'set',
      path: ['providers', 'github-copilot', 'headers'],
      value: { 'X-Custom': 'preserved' },
    }, {
      op: 'set',
      path: ['providers', 'github-copilot', 'models'],
      value: [
        { id: 'gpt-6-astra', api: 'openai-responses' },
        { id: 'gpt-5.4', api: 'openai-responses' },
      ],
    }])
    expect(mutate).toHaveBeenCalledWith('github-copilot', [{
      op: 'unset',
      path: ['temporaryRouteBackup'],
    }])
  })
})
