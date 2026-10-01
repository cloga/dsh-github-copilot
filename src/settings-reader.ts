import type { Context } from '@deepseek-ai/cordis'

export interface LiveSetting<T> {
  get(): T
}

function isLiveSetting<T>(value: T | LiveSetting<T>): value is LiveSetting<T> {
  return typeof value === 'object' && value !== null && typeof Reflect.get(value, 'get') === 'function'
}

/** Capture a native volatile field for one operation, or retain a plain fixture value. */
export function readConfigValue<T>(value: T | LiveSetting<T>): T {
  return isLiveSetting(value) ? value.get() : value
}

interface SettingsFormsView {
  describe(options: { redactSecrets: true }): readonly { ns: string; value: unknown }[]
}

interface LegacySettingsView {
  get(namespace: string): unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isSettingsForms(value: unknown): value is SettingsFormsView {
  return isRecord(value) && typeof value.describe === 'function'
}

function isLegacySettings(value: unknown): value is LegacySettingsView {
  return isRecord(value) && typeof value.get === 'function'
}

/** Read non-secret configuration through the API available on the running Core. */
export function readSettingsNamespace(ctx: Context, namespace: string): unknown {
  const settings: unknown = ctx.get('settings')
  if (isLegacySettings(settings)) return settings.get(namespace)
  if (!isSettingsForms(settings)) return undefined
  const entry = settings.describe({ redactSecrets: true }).find(candidate => candidate.ns === namespace)
  return entry?.value
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    'settings/updated'(namespace: string): void
  }
}

/** Subscribe to namespace changes across the legacy settings provider and current form service. */
export function onSettingsNamespaceUpdated(ctx: Context, listener: (namespace: string) => void): () => void {
  const disposeDocument = ctx.on('settings/document-updated', namespace => listener(namespace))
  const disposeLegacy = ctx.on('settings/updated', namespace => listener(namespace))
  return () => {
    disposeDocument()
    disposeLegacy()
  }
}
