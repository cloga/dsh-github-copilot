/** Account-scoped Copilot model integration for the native DSH runtime. */

import type { Context } from '@deepseek-ai/cordis'
import { DiagnosticsController } from './diagnostics-host.ts'
import AuthorizationService from '@deepseek-ai/dsh-authorization'
import GitHubCopilotDualModel from './dual-model-host.ts'
import GitHubCopilotUsageController from './copilot-usage-host.ts'
import GitHubCopilotAccountsController from './copilot-accounts-host.ts'
import type { CopilotAccountLease } from './copilot-accounts-types.ts'
import { SessionAccountsHost } from './session-accounts-host.ts'
import { SessionAccountController } from './session-accounts-controller.ts'
import { installContextEvidence } from './context-evidence.ts'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { readInlineConfig } from './config.ts'
import type { InlineConfig, LiveInlineConfig } from './config.ts'
import { assertDshCompatibility } from './compatibility.ts'
import { readSettingsNamespace } from './settings-reader.ts'
import GitHubCopilotAuthorizationController from './authorization-controller.ts'
import previewPlugin from './preview-route.ts'
import { installAutoReviewSampling } from './auto-review-sampling.ts'
import { GITHUB_COPILOT_PREVIEW_PROVIDER_ID } from './copilot-identity.ts'
export {
  COPILOT_HOSTED_SEARCH_PROVIDER_ID,
  GITHUB_COPILOT_HOSTED_SEARCH_PROVIDER_ID,
} from './traditional-search.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'github-copilot'

/**
 * Bootstrap dependency. The integration itself is mounted below only after
 * every service in {@link integrationInject}, including authorization, is
 * active.
 */
export const inject = ['credentials']

const integrationInject = [
  'llm',
  'systemPrompt',
  'settings',
  'credentials',
  'authorization',
  'agentDefaultModel',
]

/** Settings namespace carrying this plugin's section. */
export const GITHUB_COPILOT_SETTINGS_NAMESPACE = 'github-copilot' as SettingsNamespace

/** Schema of the plugin's settings section, exported for composition consumers. */
export { Config } from './config.ts'
export type { InlineConfig } from './config.ts'
export {
  NO_DEFAULT_SEARCH_PROVIDER,
  WEB_SEARCH_ROUTING_SETTINGS_NAMESPACE,
  WebSearchRoutingConfigSchema,
} from './web-search-routing-config.ts'
export type { WebSearchRoutingConfig } from './web-search-routing-config.ts'
export { assertDshCompatibility, DSH_COMPATIBILITY } from './compatibility.ts'
export {
  GITHUB_COPILOT_CREDENTIAL_KEY,
  GitHubCopilotAuthorizationController,
  describeGitHubCopilotProviderProfile,
  ensureGitHubCopilotProviderProfile,
  LLM_PI_AI_SETTINGS_NAMESPACE,
} from './authorization-controller.ts'
export type {
  AuthorizationNoticeView,
  GitHubCopilotAuthorizationPhase,
  GitHubCopilotAuthorizationView,
  GitHubCopilotRouteView,
} from './authorization-controller.ts'

/** Register model integration after the required native services are available. */
export function apply(ctx: Context, config: LiveInlineConfig): void {
  ctx.effect(() => installAutoReviewSampling(ctx))
  ctx.plugin({ apply(scope) { new DiagnosticsController(scope) } })
  installContextEvidence(ctx)
  ensureAuthorization(ctx)
  ctx.inject(integrationInject, (integrationCtx) => {
    integrationCtx.plugin(GitHubCopilotAccountsController)
    integrationCtx.inject(['githubCopilotAccounts'], accountsCtx => {
      activate(accountsCtx, config)
    })
  })
}

/**
 * Reuse an authorization provider already mounted by Core. rc.2 profiles do
 * not mount one, so the package's runtime dependency supplies it. The
 * non-strict lookup also sees a provider whose owning fiber is still loading;
 * the registry check covers this package's provider while it is pending.
 */
function ensureAuthorization(ctx: Context): void {
  if (ctx.get('authorization', false) !== undefined || ctx.registry.has(AuthorizationService)) return
  ctx.plugin(AuthorizationService)
}

/** Activate the integration only after the complete DSH service contract is available. */
function activate(ctx: Context, config: LiveInlineConfig): void {
  assertDshCompatibility(ctx)
  const current = (): InlineConfig => {
    const base = readInlineConfig(config)
    const value = readSettingsNamespace(ctx, GITHUB_COPILOT_SETTINGS_NAMESPACE)
    return typeof value === 'object' && value !== null ? { ...base, ...value } : base
  }
  const sessionAccounts = new SessionAccountsHost(ctx)
  ctx.provide('githubCopilotSessionAccounts', sessionAccounts)
  ctx.plugin({ apply(scope) { new SessionAccountController(scope, sessionAccounts) } })
  const accountTurns = new Map<string, CopilotAccountLease>()
  ctx.on('session/event', (session, event) => {
    if (event.type !== 'turn/end') return
    accountTurns.get(session.id)?.release()
    accountTurns.delete(session.id)
    sessionAccounts.end(session, event.data.turn)
  })
  ctx.on('agent/disposed', ({ agent }) => {
    accountTurns.get(agent.session.id)?.release()
    accountTurns.delete(agent.session.id)
    sessionAccounts.remove(agent.session)
  })
  // Retain the fence across Auto assessment, preparation, retries and tools
  // until the public turn boundary. No Session or selection writes are needed.
  const acquireAccount = (signal?: AbortSignal) => {
    const binding = sessionAccounts.requestBinding(signal)
    return ctx.get('githubCopilotAccounts')?.host.acquire(signal, true, binding.accountId)
  }
  ctx.on('agent/pre-step', async (payload, next) => {
    if (Object.hasOwn(payload, 'modelSelection')) {
      const selection: unknown = Reflect.get(payload, 'modelSelection')
      if (typeof selection !== 'object' || selection === null) {
        throw new Error('COPILOT_PRE_STEP_MODEL_SELECTION_INVALID')
      }
      const provider: unknown = Reflect.get(selection, 'provider')
      const model: unknown = Reflect.get(selection, 'model')
      if (typeof provider !== 'string' || provider.length === 0 || typeof model !== 'string' || model.length === 0) {
        throw new Error('COPILOT_PRE_STEP_MODEL_SELECTION_INVALID')
      }
      if (provider === GITHUB_COPILOT_PREVIEW_PROVIDER_ID) {
        sessionAccounts.admit(payload.agent, payload.turn, payload.signal)
      }
    }
    return next()
  }, { prepend: true })
  ctx.on('agent/request', async ({ agent, turn, signal }, next) => {
    const projections: unknown = ctx.get('sessionProjections')
    const state: unknown = typeof projections === 'object' && projections !== null && 'stateOf' in projections
      && typeof projections.stateOf === 'function'
      ? Reflect.apply(projections.stateOf, projections, [agent.session, 'modelSelection']) : undefined
    const pending: unknown = typeof state === 'object' && state !== null && 'pending' in state ? state.pending : undefined
    const pendingProvider = typeof pending === 'object' && pending !== null && 'provider' in pending ? pending.provider : undefined
    const selectedProvider = pendingProvider ?? agent.session.requestHeader()?.config.provider
    if (selectedProvider !== GITHUB_COPILOT_PREVIEW_PROVIDER_ID && !sessionAccounts.turns.current(agent.session)) return next()
    sessionAccounts.admit(agent, turn, signal)
    const lease = acquireAccount(signal)
    let retained = false
    try {
      const result = await next()
      lease?.binding.assertCurrent()
      if (lease && result.provider === GITHUB_COPILOT_PREVIEW_PROVIDER_ID && !signal.aborted) {
        accountTurns.get(agent.session.id)?.release()
        accountTurns.set(agent.session.id, lease)
        retained = true
      }
      return result
    } finally { if (!retained) lease?.release() }
  }, { prepend: true })
  ctx.effect(() => () => { for (const lease of accountTurns.values()) lease.release(); accountTurns.clear(); sessionAccounts.dispose() })
  ctx.plugin(previewPlugin, { accountModelSettings: () => current(), chatRequestSettings: () => current(), requestBudgetSettings: () => {
    const selected = current()
    return { safetyTokens: selected.requestBudgetSafetyTokens, pressureRatio: selected.requestBudgetPressureRatio,
      compactionReasoning: selected.compactionReasoning }
  } })
  ctx.plugin(GitHubCopilotAuthorizationController)
  ctx.plugin(GitHubCopilotDualModel)
  ctx.plugin(GitHubCopilotUsageController)

}
