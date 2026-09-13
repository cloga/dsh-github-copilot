/** Read-only, synchronous evidence for an independently authorized Ops migration. */
import type { Context } from '@deepseek-ai/cordis'
import { name, version } from '#package.json' with { type: 'json' }
import { GITHUB_COPILOT_PROVIDER_ID, GITHUB_COPILOT_PREVIEW_PROVIDER_ID } from './copilot-identity.ts'

export interface MigrationSelection {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
}

export interface MigrationSession {
  readonly id: string
  readonly status: 'idle' | 'running'
  readonly effectiveSelection: MigrationSelection | null
  readonly selectionSource: 'pending' | 'request-header' | 'default' | 'unknown'
  /** Latest recorded request config for running Agents, not proof of an in-flight model call. */
  readonly activeRequestSelection: MigrationSelection | null
}

/** Loaded plugin identity is not Desktop/Core byte attestation. Cold histories are not inspected. */
export interface GitHubCopilotMigrationStatus {
  readonly plugin: { readonly name: string; readonly version: string }
  readonly protocolVersion: 1
  readonly historyScope: 'live-agents-only'
  readonly observedAt: number
  readonly capabilities: {
    readonly agentsList: boolean
    readonly sessionProjections: boolean
    readonly settingsCas: boolean
    readonly providerRegistry: boolean
    readonly defaultSelection: boolean
  }
  readonly complete: { readonly sessions: boolean; readonly defaultSelection: boolean; readonly routes: boolean }
  readonly defaultSelection: MigrationSelection | null
  readonly sessions: readonly MigrationSession[]
  readonly routes: {
    readonly nativeConfigured: boolean | null
    readonly nativeRegistered: boolean | null
    readonly managedRegistered: boolean | null
  }
}

const LIMIT = 1024
function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid evidence')
  return value as Record<string, unknown>
}
function text(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) throw new Error('Invalid evidence')
  return value
}
function selection(value: unknown, omitDefaultEffort = false): MigrationSelection {
  const item = object(value)
  const provider = text(item.provider), model = text(item.model), effort = item.reasoningEffort
  // Validate even an adapter-defaulted effort before excluding it from future intent.
  if (effort !== undefined) text(effort)
  return { provider, model, ...effort === undefined || omitDefaultEffort ? {} : { reasoningEffort: effort as string } }
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length > LIMIT) throw new Error('Invalid evidence')
  return value
}
function api(ctx: Context, name: string, methods: string[]): Record<string, unknown> | undefined {
  try {
    const candidate = object(ctx.get(name))
    return methods.every(key => typeof candidate[key] === 'function') ? candidate : undefined
  } catch { return undefined } // Missing/disposed/drifting optional seams never export their errors.
}
function call(service: Record<string, unknown>, method: string, ...args: unknown[]): unknown {
  const fn = service[method]
  if (typeof fn !== 'function') throw new Error('Unavailable evidence')
  return Reflect.apply(fn, service, args)
}

/**
 * Observe only public live leaves in one synchronous stack, without writes or network.
 * This is not a cross-namespace transaction; callers must recheck immediately before CAS.
 */
export function migrationStatus(ctx: Context): GitHubCopilotMigrationStatus {
  const result = {
    plugin: { name, version }, protocolVersion: 1 as const, historyScope: 'live-agents-only' as const,
    observedAt: Date.now(),
    capabilities: { agentsList: false, sessionProjections: false, settingsCas: false, providerRegistry: false, defaultSelection: false },
    complete: { sessions: false, defaultSelection: false, routes: false },
    defaultSelection: null as MigrationSelection | null,
    sessions: [] as MigrationSession[],
    routes: { nativeConfigured: null as boolean | null, nativeRegistered: null as boolean | null, managedRegistered: null as boolean | null },
  }
  try {
    ctx.fiber.assertActive()
  } catch { return result } // A retained controller after disposal supplies no live evidence.
  const agents = api(ctx, 'agents', ['list'])
  const projections = api(ctx, 'sessionProjections', ['stateOf'])
  const defaults = api(ctx, 'agentDefaultModel', ['currentSelection'])
  const settings = api(ctx, 'settings', ['describe', 'get', 'mutate'])
  const llm = api(ctx, 'llm', ['listProviders'])
  result.capabilities.agentsList = agents !== undefined
  result.capabilities.sessionProjections = projections !== undefined
  result.capabilities.defaultSelection = defaults !== undefined
  result.capabilities.providerRegistry = llm !== undefined
  if (defaults) {
    try {
      result.defaultSelection = selection(call(defaults, 'currentSelection'))
      result.complete.defaultSelection = true
    } catch { /* Missing or malformed selection is unknown, not an absent default. */ }
  }
  if (agents) {
    try {
      const rows: MigrationSession[] = [], ids = new Set<string>()
      let complete = projections !== undefined
      for (const candidate of array(call(agents, 'list'))) {
        const agent = object(candidate), id = text(agent.id), status = agent.status
        if (ids.has(id) || (status !== 'idle' && status !== 'running')) throw new Error('Invalid agent inventory')
        ids.add(id)
        const session = object(agent.session)
        if (text(session.id) !== id) throw new Error('Invalid agent identity')
        const header = call(session, 'requestHeader')
        const request = header === undefined ? null : selection(object(header).config)
        let effective: MigrationSelection | null = null, source: MigrationSession['selectionSource'] = 'unknown'
        if (projections) {
          // Undefined projection means unsupported, never implicit pending:null.
          const state = call(projections, 'stateOf', session, 'modelSelection')
          if (state !== undefined) {
            const pending = object(state).pending
            if (pending !== null) { effective = selection(pending); source = 'pending' }
            else if (header !== undefined) {
              const defaults = object(header).adapterDefaults
              const defaultEffort = defaults === undefined ? false : object(defaults).reasoningEffort
              if (defaultEffort !== undefined && typeof defaultEffort !== 'boolean') throw new Error('Invalid adapter defaults')
              effective = selection(object(header).config, defaultEffort === true); source = 'request-header'
            } else if (result.complete.defaultSelection) {
              effective = result.defaultSelection; source = 'default'
            }
          }
        }
        if (effective === null || (status === 'running' && request === null)) complete = false
        rows.push({ id, status, effectiveSelection: effective, selectionSource: source, activeRequestSelection: status === 'running' ? request : null })
      }
      result.sessions = rows
      result.complete.sessions = complete
    } catch { /* Any malformed/throwing/overflow inventory discards every row, never a partial success. */ }
  }
  if (settings) {
    try {
      const descriptors = array(call(settings, 'describe', { redactSecrets: true }))
      const found = new Set<string>()
      for (const value of descriptors) {
        const descriptor = object(value)
        const ns = text(descriptor.ns)
        if (ns !== 'llm-pi-ai' && ns !== 'github-copilot') continue
        if (found.has(ns) || !Number.isSafeInteger(descriptor.revision) || (descriptor.revision as number) < 0) throw new Error('Invalid settings evidence')
        found.add(ns)
      }
      if (found.size !== 2) throw new Error('Unregistered settings')
      const config = object(call(settings, 'get', 'llm-pi-ai'))
      const providers = config.providers === undefined ? undefined : object(config.providers)
      const profile = providers?.[GITHUB_COPILOT_PROVIDER_ID]
      if (profile !== undefined) object(profile)
      result.capabilities.settingsCas = true
      result.routes.nativeConfigured = profile !== undefined
    } catch { /* Only registered, revision-bearing settings constitute CAS capability evidence. */ }
  }
  if (llm) {
    try {
      const ids = new Set<string>()
      for (const value of array(call(llm, 'listProviders'))) {
        const id = text(object(value).id)
        if (ids.has(id)) throw new Error('Invalid registry evidence')
        ids.add(id)
      }
      result.routes.nativeRegistered = ids.has(GITHUB_COPILOT_PROVIDER_ID)
      result.routes.managedRegistered = ids.has(GITHUB_COPILOT_PREVIEW_PROVIDER_ID)
    } catch { /* Registry absence cannot be inferred from a failed or truncated read. */ }
  }
  result.complete.routes = result.routes.nativeConfigured !== null && result.routes.nativeRegistered !== null && result.routes.managedRegistered !== null
  return result
}
