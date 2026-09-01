/**
 * Fail-closed runtime validation for the DSH service APIs this integration
 * consumes. Version ranges are validated by the deployment baseline; this
 * check protects source and unpacked installs from API-shape drift.
 * @module dsh-github-copilot/compatibility
 */

import type { Context } from '@deepseek-ai/cordis'
import * as dshSettings from '@deepseek-ai/dsh-settings'

export const DSH_COMPATIBILITY = {
  release: '0.1.2-alpha.3',
  developmentRelease: '0.1.2-alpha.3',
  peerRange: '^0.1.2-alpha.3',
  requiredApis: [
    'agentDefaultModel.currentSelection',
    'authorization.describe',
    'authorization.begin',
    'authorization.cancel',
    'credentials.describeRecord',
    'credentials.readRecord',
    'credentials.listRecords',
    'credentials.modifyRecord',
    'credentials.deleteRecord',
    'settings.get',
    'settings.mutate',
    'settings.installSection',
    'web.registerSearchProvider',
    'systemPrompt.section',
    'context.on',
    'context.plugin',
  ],
} as const

interface LegacySettingsModule {
  installSettingsSection?: unknown
}

function method(value: unknown, key: string): boolean {
  return typeof value === 'object'
    && value !== null
    && key in value
    && typeof (value as Record<string, unknown>)[key] === 'function'
}

function incompatible(api: string): never {
  throw new Error(
    `github-copilot: incompatible DSH runtime; required API "${api}" is unavailable `
    + `(supported DSH range ${DSH_COMPATIBILITY.peerRange})`,
  )
}

/** Assert every required Core service shape before registering any effects. */
export function assertDshCompatibility(ctx: Context): void {
  if (!method(ctx.get('agentDefaultModel'), 'currentSelection')) incompatible('agentDefaultModel.currentSelection')
  const authorization = ctx.get('authorization')
  for (const api of ['describe', 'begin', 'cancel']) {
    if (!method(authorization, api)) incompatible(`authorization.${api}`)
  }
  const credentials = ctx.get('credentials')
  for (const api of ['describeRecord', 'readRecord', 'listRecords', 'modifyRecord', 'deleteRecord']) {
    if (!method(credentials, api)) incompatible(`credentials.${api}`)
  }
  const settings = ctx.get('settings')
  if (!method(settings, 'get')) incompatible('settings.get')
  if (!method(settings, 'mutate')) incompatible('settings.mutate')
  const legacyInstaller = (dshSettings as LegacySettingsModule).installSettingsSection
  if (typeof legacyInstaller !== 'function' && !method(settings, 'installSection')) {
    incompatible('settings.installSection')
  }
  if (!method(ctx.get('web'), 'registerSearchProvider')) incompatible('web.registerSearchProvider')
  if (!method((ctx as unknown as Record<string, unknown>)['systemPrompt'], 'section')) incompatible('systemPrompt.section')
  if (typeof (ctx as unknown as Record<string, unknown>)['on'] !== 'function') incompatible('context.on')
  if (typeof (ctx as unknown as Record<string, unknown>)['plugin'] !== 'function') incompatible('context.plugin')
}
