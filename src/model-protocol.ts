import type { Context } from '@deepseek-ai/cordis'
import { getSupportedThinkingLevels } from '@earendil-works/pi-ai'
import type { Api, Model } from '@earendil-works/pi-ai'
import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all'
import { GITHUB_COPILOT_PREVIEW_PROVIDER_ID } from './copilot-identity.ts'

/** Public facts from this plugin's pi-ai dependency, not a claim about another Core copy. */
export interface CopilotModelFacts {
  readonly id: string
  readonly provider: string
  readonly api: string
  readonly name: string
  readonly baseUrl: string
  readonly contextWindow: number
  readonly maxTokens: number
  readonly input: readonly ('text' | 'image')[]
  readonly reasoning: boolean
  readonly supportsReasoningOff: boolean
  readonly reasoningEfforts: Readonly<Record<string, string>>
  readonly headers?: Readonly<Record<string, string | null>>
}

export interface CopilotCatalogSnapshot {
  readonly models: readonly CopilotModelFacts[]
  /** True only for models whose actual native provider is built by this plugin. */
  readonly authoritative: boolean
}

/** Project only public leaves and the same pi library's supported wire efforts. */
export function projectModelFacts(model: Model<Api>): CopilotModelFacts {
  const supported = getSupportedThinkingLevels(model)
  return {
    id: model.id, provider: model.provider, api: model.api, name: model.name, baseUrl: model.baseUrl,
    contextWindow: model.contextWindow, maxTokens: model.maxTokens, input: [...model.input],
    reasoning: model.reasoning, supportsReasoningOff: supported.includes('off'),
    reasoningEfforts: Object.fromEntries(supported.filter(level => level !== 'off')
      .map(level => [level, model.thinkingLevelMap?.[level] ?? level])),
    ...model.headers === undefined ? {} : { headers: { ...model.headers } },
  }
}

/** Stock Core owns its own catalog; local metadata must not retire corrections on its behalf. */
export function readCopilotCatalog(_ctx: Context): CopilotCatalogSnapshot {
  return { models: getBuiltinModels('github-copilot').map(projectModelFacts), authoritative: false }
}

/** The preview uses this exact pi provider instance family, so local model facts are authoritative there. */
export function readPreviewCatalog(): CopilotCatalogSnapshot {
  return { models: getBuiltinModels('github-copilot').map(projectModelFacts), authoritative: true }
}

/** Scope optional preview contributions to this plugin's successfully mounted route service. */
export function isPluginPreviewProvider(ctx: Context, provider: string): boolean {
  if (provider !== GITHUB_COPILOT_PREVIEW_PROVIDER_ID) return false
  const service: unknown = ctx.get('githubCopilotPreview')
  if (typeof service !== 'object' || service === null) return false
  const getView: unknown = Reflect.get(service, 'getView')
  if (typeof getView !== 'function') return false
  const view: unknown = getView.call(service)
  return typeof view === 'object' && view !== null && Reflect.get(view, 'provider') === provider
}
