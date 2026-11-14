import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-settings'
import type { Api, Model } from '@earendil-works/pi-ai'
import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all'
import { pathToFileURL } from 'node:url'

const NATIVE = '@deepseek-ai/dsh-llm-pi-ai'
const PI = '@earendil-works/pi-ai'
export const NATIVE_COPILOT = 'github-copilot'

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function customTransport(value: Record<string, unknown>): boolean {
  return ['apiKeyEnv', 'baseURL', 'headers', 'compat'].some(key => {
    const field = value[key]
    return field !== undefined && field !== '' && (!record(field) || Object.keys(field).length > 0)
  })
}

/** Only the unchanged native catalog and its explicit native narrowing are qualified. */
export function nativeCopilotModels(profile: unknown): ReadonlyMap<string, Model<Api>> | undefined {
  if (!record(profile) || customTransport(profile)) return undefined
  const configured = profile.models
  if (configured !== undefined && !Array.isArray(configured)) return undefined
  if (Array.isArray(configured) && configured.some(value => !record(value) || customTransport(value))) return undefined
  if (record(profile.modelOverrides) && Object.values(profile.modelOverrides)
    .some(value => !record(value) || customTransport(value))) return undefined
  const ids = Array.isArray(configured) && configured.length > 0
    ? new Set(configured.filter(record).map(value => value.id)) : undefined
  const api = profile.api
  if (api !== undefined && api !== '' && api !== 'openai-responses'
    && api !== 'openai-completions' && api !== 'anthropic-messages') return undefined
  return new Map(getBuiltinModels(NATIVE_COPILOT)
    .filter(model => ids === undefined || ids.has(model.id))
    .map(model => [model.id, { ...model, ...(api ? { api } : {}) }]))
}

export interface NativeCopilotSnapshot {
  readonly models: ReadonlyMap<string, Model<Api>>
  readonly namespace: string
  assertCurrent(): void
}

/**
 * Qualify the native Loader root and its exact published pi-ai dependency.
 * No credential, discovery, settings write or private adapter registry access.
 */
export async function captureNativeCopilot(ctx: Context): Promise<NativeCopilotSnapshot | undefined> {
  const llm = ctx.get('llm')
  const settings = ctx.get('settings')
  const loader = ctx.get('loader')
  const packages = ctx.get('pluginPackages')
  if (!llm || !settings || !loader || !packages) return undefined
  const directory = llm.listConfigurableProviders().find(value => value.provider === NATIVE_COPILOT)
  if (!directory || directory.declared !== false || directory.error !== undefined
    || directory.settingsPath.length !== 2 || directory.settingsPath[0] !== 'providers'
    || directory.settingsPath[1] !== NATIVE_COPILOT || directory.nativeAuth?.oauth !== true
    || directory.nativeAuth.env.length !== 0
    || !llm.listProviders().some(value => value.id === NATIVE_COPILOT)) return undefined
  const entries = [...loader.entries()].filter(entry => entry.options.id === directory.settingsNs)
  if (entries.length !== 1) return undefined
  const entry = entries[0]!
  const fiber = entry.fiber?.ctx.fiber
  const base = entry.parent.tree.ctx.baseUrl
  if (!fiber || fiber.uid === null || entry.options.name !== NATIVE || !base) return undefined
  const owner = packages.packageOf(NATIVE, base)
  const importedOwner = packages.packageOf(NATIVE, import.meta.url)
  if (owner?.version !== '0.2.2-rc.3' || owner.manifestPath !== importedOwner?.manifestPath) return undefined
  const nativePi = packages.packageOf(PI, pathToFileURL(owner.manifestPath).href)
  const localPi = packages.packageOf(PI, import.meta.url)
  if (nativePi?.version !== '1.3.0' || localPi?.manifestPath !== nativePi.manifestPath) return undefined
  const view = () => settings.describe({ redactSecrets: true }).find(value => value.ns === directory.settingsNs)
  const captured = view()
  if (!captured || !record(captured.value) || !record(captured.value.providers)) return undefined
  const models = nativeCopilotModels(captured.value.providers[NATIVE_COPILOT])
  if (!models) return undefined
  const module = await import('@deepseek-ai/dsh-llm-pi-ai')
  const current = () => fiber.uid !== null && entry.fiber?.ctx.fiber === fiber
    && fiber.runtime?.callback === module.apply && entry.options.name === NATIVE
    && view()?.revision === captured.revision
    && llm.listProviders().some(value => value.id === NATIVE_COPILOT)
  if (!current()) return undefined
  return {
    models,
    namespace: directory.settingsNs,
    assertCurrent() {
      if (!current()) throw new Error('COPILOT_NATIVE_ROUTE_CHANGED')
    },
  }
}
