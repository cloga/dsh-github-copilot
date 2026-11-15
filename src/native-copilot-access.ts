import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-settings'
import { pathToFileURL } from 'node:url'

const NATIVE = '@deepseek-ai/dsh-llm-pi-ai'
const PI = '@earendil-works/pi-ai'
export const NATIVE_COPILOT = 'github-copilot'

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  if (!record(value)) return false
  const prototype: unknown = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/**
 * Native Config materializes empty template maps at provider, model and override
 * scope. They do not add template values; supportsStrictMode only controls native
 * JSON-schema tool conversion, not the credential, endpoint or model protocol.
 * Qualify these exact shapes without deleting or overriding any native setting.
 */
function nativeCompat(value: unknown): boolean {
  if (value === undefined) return true
  if (!plainRecord(value)) return false
  return Reflect.ownKeys(value).every(key => {
    if (key === 'supportsStrictMode') return typeof value[key] === 'boolean'
    if (key !== 'chatTemplateKwargs' && key !== 'chatTemplateArgs') return false
    const template = value[key]
    return plainRecord(template) && Reflect.ownKeys(template).length === 0
  })
}

function customTransport(value: Record<string, unknown>): boolean {
  return !nativeCompat(value.compat) || ['apiKeyEnv', 'baseURL', 'headers'].some(key => {
    const field = value[key]
    return field !== undefined && field !== '' && (!record(field) || Object.keys(field).length > 0)
  })
}

export interface NativeCopilotModel {
  readonly id: string
  readonly api: string
}

/** Only the adapter's native catalog and its explicit native narrowing are qualified. */
export function nativeCopilotModels(profile: unknown, catalog: unknown): ReadonlyMap<string, NativeCopilotModel> | undefined {
  if (!record(profile) || customTransport(profile) || !Array.isArray(catalog)) return undefined
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
  const models = new Map<string, NativeCopilotModel>()
  for (const model of catalog) {
    if (!record(model) || typeof model.id !== 'string' || model.id.length === 0 || model.id !== model.id.trim()
      || typeof model.api !== 'string' || model.api.length === 0 || model.api !== model.api.trim()
      || models.has(model.id)) return undefined
    models.set(model.id, { id: model.id, api: api || model.api })
  }
  if (ids !== undefined) for (const id of models.keys()) if (!ids.has(id)) models.delete(id)
  return models
}

/** Account membership does not establish a model's protocol or capabilities. */
function nativeAccountModelIds(
  profile: unknown, configuredModels: ReadonlyMap<string, NativeCopilotModel> | undefined,
): ReadonlySet<string> | undefined {
  if (!record(profile) || configuredModels === undefined
    || profile.modelOverrides !== undefined && !plainRecord(profile.modelOverrides)) return undefined
  const configured = profile.models
  if (configured === undefined || Array.isArray(configured) && configured.length === 0) {
    return new Set(configuredModels.keys())
  }
  if (!Array.isArray(configured) || configured.length > 512) return undefined
  const ids = new Set<string>()
  for (const model of configured) {
    if (!record(model) || typeof model.id !== 'string' || model.id.length === 0 || model.id.length > 512
      || model.id !== model.id.trim() || /[\p{Cc}\p{Cf}\u2028\u2029]/u.test(model.id) || ids.has(model.id)) {
      return undefined
    }
    ids.add(model.id)
  }
  return ids
}

function nativeCatalogUrl(manifestPath: string, exports: unknown): string | undefined {
  if (!record(exports)) return undefined
  const exact = exports['./providers/all']
  const wildcard = exact === undefined
  if (wildcard && Object.keys(exports).some(key => {
    if (key === './providers/*') return false
    const parts = key.split('*')
    if (parts.length !== 2) return false
    const [prefix = '', suffix = ''] = parts
    return './providers/all'.startsWith(prefix) && './providers/all'.endsWith(suffix)
      && prefix.length + suffix.length <= './providers/all'.length
  })) return undefined
  const descriptor = wildcard ? exports['./providers/*'] : exact
  const target = typeof descriptor === 'string' ? descriptor
    : record(descriptor) && Object.keys(descriptor).every(key => key === 'types' || key === 'import')
      && typeof descriptor.import === 'string' ? descriptor.import : undefined
  if (!target || !/^\.\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._*-]+\.m?js$/u.test(target)
    || target.split('/').slice(1).some(part => part === '.' || part === '..')) return undefined
  const stars = [...target].filter(character => character === '*').length
  if (stars !== (wildcard ? 1 : 0)) return undefined
  const base = new URL('.', pathToFileURL(manifestPath))
  const url = new URL(wildcard ? target.replace('*', 'all') : target, base)
  return url.href.startsWith(base.href) ? url.href : undefined
}

export interface NativeCopilotSnapshot {
  readonly models: ReadonlyMap<string, NativeCopilotModel>
  readonly accountModelIds: ReadonlySet<string> | undefined
  readonly namespace: string
  assertCurrent(): void
}

export interface NativeCopilotCatalogSnapshot {
  readonly catalog: ReadonlyMap<string, NativeCopilotModel>
  readonly configuredModels: ReadonlyMap<string, NativeCopilotModel> | undefined
  readonly accountModelIds: ReadonlySet<string> | undefined
  readonly namespace: string
  assertCurrent(): void
}

/**
 * Qualify the native Loader root and its exact published pi-ai dependency.
 * No credential, discovery, settings write or private adapter registry access.
 */
export async function captureNativeCopilotCatalog(
  ctx: Context, diagnose: (code: string) => void = () => {},
): Promise<NativeCopilotCatalogSnapshot | undefined> {
  const unproven = (code: string) => { diagnose(code); return undefined }
  const llm = ctx.get('llm')
  const settings = ctx.get('settings')
  const loader = ctx.get('loader')
  const packages = ctx.get('pluginPackages')
  if (!llm || !settings || !loader || !packages) return unproven('COPILOT_NATIVE_SERVICES_UNAVAILABLE')
  const directory = llm.listConfigurableProviders().find(value => value.provider === NATIVE_COPILOT)
  if (!directory || directory.declared !== false || directory.error !== undefined
    || directory.settingsPath.length !== 2 || directory.settingsPath[0] !== 'providers'
    || directory.settingsPath[1] !== NATIVE_COPILOT || directory.nativeAuth?.oauth !== true
    || !llm.listProviders().some(value => value.id === NATIVE_COPILOT)) return unproven('COPILOT_NATIVE_DIRECTORY_UNPROVEN')
  const entries = [...loader.entries()].filter(entry => entry.options.id === directory.settingsNs)
  if (entries.length !== 1) return unproven('COPILOT_NATIVE_ENTRY_UNPROVEN')
  const entry = entries[0]!
  const fiber = entry.fiber?.ctx.fiber
  const base = entry.parent.tree.ctx.baseUrl
  if (!fiber || fiber.uid === null || entry.options.name !== NATIVE || !base) return unproven('COPILOT_NATIVE_FIBER_UNPROVEN')
  const owner = packages.packageOf(NATIVE, base)
  const importedOwner = packages.packageOf(NATIVE, import.meta.url)
  if (owner?.version !== '0.2.2-rc.3' || owner.manifestPath !== importedOwner?.manifestPath) return unproven('COPILOT_NATIVE_PACKAGE_UNPROVEN')
  const nativePi = packages.packageOf(PI, pathToFileURL(owner.manifestPath).href)
  const localPi = packages.packageOf(PI, import.meta.url)
  if (nativePi?.name !== PI || nativePi.version !== '1.3.0'
    || localPi?.name !== PI || localPi.version !== '1.3.0') return unproven('COPILOT_NATIVE_PI_UNPROVEN')
  const ownerPath = owner.manifestPath
  const nativePiPath = nativePi.manifestPath
  const localPiPath = localPi.manifestPath
  const view = () => settings.describe({ redactSecrets: true }).find(value => value.ns === directory.settingsNs)
  const captured = view()
  if (!captured || !record(captured.value) || !record(captured.value.providers)) return unproven('COPILOT_NATIVE_SETTINGS_UNPROVEN')
  const catalogUrl = nativeCatalogUrl(nativePiPath, nativePi.manifest.exports)
  if (!catalogUrl) return unproven('COPILOT_NATIVE_CATALOG_UNAVAILABLE')
  let catalog: unknown
  try {
    const nativeModule: unknown = await import(/* @vite-ignore */ catalogUrl)
    if (!record(nativeModule) || typeof nativeModule.getBuiltinModels !== 'function') return unproven('COPILOT_NATIVE_CATALOG_UNAVAILABLE')
    catalog = nativeModule.getBuiltinModels(NATIVE_COPILOT)
  } catch {
    return unproven('COPILOT_NATIVE_CATALOG_UNAVAILABLE')
  }
  const nativeCatalog = nativeCopilotModels({}, catalog)
  if (!nativeCatalog) return unproven('COPILOT_NATIVE_MODELS_UNPROVEN')
  const profile = captured.value.providers[NATIVE_COPILOT]
  const configuredModels = nativeCopilotModels(profile, catalog)
  const accountModelIds = nativeAccountModelIds(profile, configuredModels)
  const module = await import('@deepseek-ai/dsh-llm-pi-ai')
  const current = () => {
    const currentLlm = ctx.get('llm')
    const currentSettings = ctx.get('settings')
    const currentLoader = ctx.get('loader')
    const currentPackages = ctx.get('pluginPackages')
    if (!currentLlm || !currentSettings || !currentLoader || !currentPackages) return false
    const currentEntries = [...currentLoader.entries()].filter(value => value.options.id === directory.settingsNs)
    if (currentEntries.length !== 1 || currentEntries[0] !== entry) return false
    const currentDirectory = currentLlm.listConfigurableProviders().find(value => value.provider === NATIVE_COPILOT)
    if (!currentDirectory || currentDirectory.declared !== false || currentDirectory.error !== undefined
      || currentDirectory.settingsNs !== directory.settingsNs
      || currentDirectory.settingsPath.length !== 2 || currentDirectory.settingsPath[0] !== 'providers'
      || currentDirectory.settingsPath[1] !== NATIVE_COPILOT || currentDirectory.nativeAuth?.oauth !== true) return false
    const nativeOwner = currentPackages.packageOf(NATIVE, base)
    const importedOwner = currentPackages.packageOf(NATIVE, import.meta.url)
    const nativeCatalog = currentPackages.packageOf(PI, pathToFileURL(ownerPath).href)
    const pluginCatalog = currentPackages.packageOf(PI, import.meta.url)
    return fiber.uid !== null && entry.fiber?.ctx.fiber === fiber
      && fiber.runtime?.callback === module.apply && entry.options.name === NATIVE
      && currentSettings.describe({ redactSecrets: true }).find(value => value.ns === directory.settingsNs)?.revision === captured.revision
      && nativeOwner?.manifestPath === ownerPath && nativeOwner.version === '0.2.2-rc.3'
      && importedOwner?.manifestPath === ownerPath && importedOwner.version === '0.2.2-rc.3'
      && nativeCatalog?.manifestPath === nativePiPath && nativeCatalog.version === '1.3.0'
      && pluginCatalog?.manifestPath === localPiPath && pluginCatalog.version === '1.3.0'
      && currentLlm.listProviders().some(value => value.id === NATIVE_COPILOT)
  }
  if (!current()) return unproven('COPILOT_NATIVE_SNAPSHOT_REVOKED')
  return {
    catalog: nativeCatalog,
    configuredModels,
    accountModelIds,
    namespace: directory.settingsNs,
    assertCurrent() {
      if (!current()) throw new Error('COPILOT_NATIVE_ROUTE_CHANGED')
    },
  }
}

export async function captureNativeCopilot(
  ctx: Context, diagnose: (code: string) => void = () => {},
): Promise<NativeCopilotSnapshot | undefined> {
  const snapshot = await captureNativeCopilotCatalog(ctx, diagnose)
  if (snapshot === undefined) return undefined
  if (snapshot.configuredModels === undefined) {
    diagnose('COPILOT_NATIVE_MODELS_UNPROVEN')
    return undefined
  }
  return { models: snapshot.configuredModels, accountModelIds: snapshot.accountModelIds,
    namespace: snapshot.namespace, assertCurrent: snapshot.assertCurrent }
}
