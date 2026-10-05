import { createHash } from 'node:crypto'
import { installReplayRecovery } from './replay-recovery-host.ts'
import { installSessionContinuation } from './session-continuation-host.ts'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { Config as PiAiConfig, PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'
import type { PiAiAdapterOptions, PiAiProviderProfile, ResolvedPiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import { LlmError, ReasoningEffortId, resolveImageAttachmentAccess, resolveRetryPolicy } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmModelInfo, LlmResolvedModelInfo, PreparedAdapterCall, StreamChunk } from '@deepseek-ai/dsh-llm'
import { getSupportedThinkingLevels } from '@earendil-works/pi-ai'
import type { CredentialStore } from '@earendil-works/pi-ai'
import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all'
import { estimateContextTokens, estimateMessageTokens } from '@earendil-works/pi-ai/utils/estimate'
import { createGitHubCopilotCredentialStore, trustedGitHubCopilotBaseUrl } from './copilot-auth.ts'
import { normalizeGitHubCopilotOAuthCredential } from './copilot-grant.ts'
import { normalizeHighCostModelIds } from './auto-allocation.ts'
import type { GitHubCopilotOAuthCredential } from './copilot-grant.ts'
import {
  autoModelPreference, GITHUB_COPILOT_AUTO_MODEL_ID, GITHUB_COPILOT_AUTO_EFFICIENCY_MODEL_ID,
  GITHUB_COPILOT_AUTO_INTELLIGENCE_MODEL_ID, GITHUB_COPILOT_PREVIEW_PROVIDER_ID, GITHUB_COPILOT_CREDENTIAL_KEY,
} from './copilot-identity.ts'
import { abortable } from './http.ts'
import { accountModelFromDescriptor, copilotPublicHeaders, createAccountProvider, ManagedWireAbortError } from './preview-provider.ts'
import type { AccountProviderGuard, ManagedWireAbortCode } from './preview-provider.ts'
import { ACCOUNT_MODEL_AUTH_MIN_VALIDITY_MS, copilotAccountKey, copilotEntitlementKey, createAccountModelAuth } from './account-model-auth.ts'
import { createAccountModelSource } from './account-model-source.ts'
import type { AccountModelLoadOptions, AccountModelSnapshot, AccountModelSource } from './account-model-source.ts'
import type { AccountModelDescriptor, AccountModelRejection } from './account-model-catalog.ts'
import type { InlineConfig } from './config.ts'
import { assessRequestBudget, calculateRequestBudget, resolveRequestBudgetPolicy, selectCompactionReasoning } from './request-budget.ts'
import type { RequestBudgetFailure, RequestBudgetPolicy } from './request-budget.ts'
import { installCopilotCompactionPressure } from './compaction-pressure.ts'
import { installCopilotPreStepPressure } from './pre-step-pressure.ts'
import { autoModelInputModalities } from './auto-model-routing.ts'
import { installAutoModelRouting } from './auto-model-host.ts'
import { classifyTaskWithAdapter, taskClassifierModel } from './auto-task-classifier.ts'
import { TaskAssessmentRevokedError } from './auto-task-assessment.ts'
import { ResponsesRetryReplay } from './responses-replay-compat.ts'
import { excludedModelSet, ModelExclusionTurns } from './model-exclusions.ts'
import { onSettingsNamespaceUpdated } from './settings-reader.ts'
import { imageInputFailure } from './image-input-admission.ts'
import { activeCopilotBinding } from './copilot-accounts-host.ts'
import type { CopilotAccountBinding, CopilotAccountLease } from './copilot-accounts-types.ts'
import { COPILOT_ACCOUNTS_MAX } from './copilot-accounts-types.ts'
import type {} from './session-accounts-host.ts'

/** Safe request knobs; identities, model tables, endpoints and credentials are not configurable. */
export type PreviewRouteConfig = Pick<PiAiProviderProfile,
  'reasoning' | 'cacheRetention' | 'transport' | 'timeoutMs' | 'websocketConnectTimeoutMs'
  | 'streamIdleTimeoutMs' | 'maxRequestImageBytes' | 'requestImagePixelBudget' | 'requestImageMaxBytes' | 'retryPolicy'>
  & Pick<InlineConfig, 'accountModelTtlMs' | 'accountModelFailureCooldownMs'>
  & {
    readonly streamLiveness?: boolean
    readonly chatRequestSettings?: () => Pick<InlineConfig, 'chatStreamIdleTimeoutMs' | 'chatStreamLiveness' | 'chatMaxRequestImageBytes'>
    readonly accountModelSettings?: () => Pick<InlineConfig, 'accountModelTtlMs' | 'accountModelFailureCooldownMs' | 'excludedModelIds' | 'highCostModelIds' | 'parentModelFollow' | 'followParentModel' | 'autoSemanticAssessment' | 'autoAllocationEvidence'>
    readonly requestBudget?: Partial<RequestBudgetPolicy>
    readonly requestBudgetSettings?: () => Partial<RequestBudgetPolicy>
  }

export interface GitHubCopilotPreviewView {
  readonly provider: typeof GITHUB_COPILOT_PREVIEW_PROVIDER_ID
  readonly configured: boolean
  readonly available: boolean
  readonly correctionActive: boolean
  readonly state: 'idle' | 'loading' | 'ready' | 'stale' | 'unconfigured' | 'unavailable' | 'error' | 'disposed'
  readonly models: readonly { readonly id: string; readonly name: string; readonly api: string }[]
  readonly rejected: readonly AccountModelRejection[]
  readonly warnings: readonly { readonly id: string; readonly code: string }[]
  readonly discoveredAt?: number
  readonly error?: string
}
export interface GitHubCopilotPreview {
  getView(): GitHubCopilotPreviewView
  /** Synchronous, account-proven summary capacities for the initiating Agent; never triggers discovery. */
  recoveryLimits(modelId: string, agent?: Agent): {
    readonly limits: Pick<AccountModelDescriptor, 'contextWindow' | 'maxInputTokens' | 'maxTokens'>
    readonly policy: Partial<RequestBudgetPolicy>
    readonly assertCurrent: () => void
  } | undefined
  /** Host-only current endpoint facts; no discovery and no credential material. */
  routeFacts(modelId: string): { readonly api: string; readonly baseURL: string } | undefined
  /** Capture credential-proof continuity, independent of ordinary metadata cache TTL. */
  captureSearchProof(): () => boolean
  /** Host-only credential resolution for an independent, account-scoped search request. */
  resolveRequestAuth(modelId: string, signal?: AbortSignal): Promise<{ readonly apiKey: string; readonly baseURL: string; readonly headers: Readonly<Record<string, string>> }>
  /** Read stored credentials/status only; never starts native refresh or discovery. */
  refresh(): Promise<GitHubCopilotPreviewView>
  /** Explicit account model discovery. May refresh native OAuth and GET /models. */
  discover(options?: AccountModelLoadOptions): Promise<GitHubCopilotPreviewView>
}

declare module '@deepseek-ai/cordis' {
  interface Context { githubCopilotPreview: GitHubCopilotPreview }
}

function failure(code: string, category = 'AUTH'): LlmError { return new LlmError(code, category) }
function abortFailure(signal: AbortSignal): LlmError {
  return failure(signal.reason instanceof ManagedWireAbortError ? signal.reason.code : 'COPILOT_PREVIEW_ABORTED', 'ABORTED')
}
function tokenFingerprint(value: string): string { return createHash('sha256').update(value).digest('hex') }
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
function providerProfiles(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined
  if (typeof value.get === 'function') {
    const resolved: unknown = value.get()
    return isRecord(resolved) ? resolved : undefined
  }
  return value
}
function owned(provider: string): void {
  if (provider !== GITHUB_COPILOT_PREVIEW_PROVIDER_ID) throw failure('COPILOT_PREVIEW_MODEL_MISMATCH', 'UNKNOWN_MODEL')
}
interface Proof { readonly accountKey: string; readonly entitlementKey: string; readonly tokenFingerprint: string; readonly baseURL: string; readonly expires: number }
/** A read may advance only its own revision when it observes a real invalidation. */
interface CredentialReadTicket { revision: number }
interface Lease {
  readonly credentials: CredentialStore
  readonly snapshot: AccountModelSnapshot
  readonly descriptor: AccountModelDescriptor
  readonly proof: Proof
  readonly revision: number
  readonly signal: AbortSignal
  readonly retrySignal?: AbortSignal
  readonly retryReplay?: ResponsesRetryReplay
  started: boolean
}

class PreviewLifetime {
  readonly controller = new AbortController()
  private readonly wires = new Set<AbortController>()
  private readonly retryEntries = new Map<AbortSignal, { replay: ResponsesRetryReplay; snapshot: AccountModelSnapshot;
    proof: Proof; model: string; revision: number; at: number; onAbort: () => void }>()
  revision = 0
  private active = true
  constructor(readonly credentials: () => CredentialStore, readonly source: AccountModelSource,
    readonly proofFor: (snapshot: AccountModelSnapshot) => Proof | undefined,
    private readonly displayProofFor: (snapshot: AccountModelSnapshot) => Proof | undefined,
    private readonly excluded: (modelId: string) => boolean,
    private readonly turns: ModelExclusionTurns,
    readonly acquire: (signal?: AbortSignal) => CopilotAccountLease | undefined) {}
  assertActive(): void { if (!this.active) throw failure('COPILOT_PREVIEW_DISPOSED', 'ABORTED') }
  isCurrent(revision: number): boolean { return this.active && revision === this.revision }
  private removeRetry(signal: AbortSignal): void {
    const entry = this.retryEntries.get(signal)
    if (entry === undefined) return
    signal.removeEventListener('abort', entry.onAbort)
    entry.replay.dispose()
    this.retryEntries.delete(signal)
  }
  private clearRetries(): void {
    for (const signal of this.retryEntries.keys()) this.removeRetry(signal)
  }
  clearSessionRetries(sessionId: string): void {
    for (const [signal, entry] of this.retryEntries) {
      if (entry.replay.belongsTo(sessionId)) this.removeRetry(signal)
    }
  }
  private retryFor(signal: AbortSignal, snapshot: AccountModelSnapshot, proof: Proof, model: string): ResponsesRetryReplay {
    let entry = this.retryEntries.get(signal)
    if (entry !== undefined && (entry.snapshot !== snapshot || entry.proof !== proof || entry.model !== model
      || entry.revision !== this.revision || Date.now() - entry.at >= 60_000)) {
      this.removeRetry(signal)
      entry = undefined
    }
    if (entry !== undefined) return entry.replay
    if (this.retryEntries.size >= 16) this.removeRetry(this.retryEntries.keys().next().value!)
    const replay = new ResponsesRetryReplay()
    const onAbort = () => this.removeRetry(signal)
    signal.addEventListener('abort', onAbort, { once: true })
    this.retryEntries.set(signal, { replay, snapshot, proof, model, revision: this.revision, at: Date.now(), onAbort })
    return replay
  }
  change(): void {
    this.assertActive()
    this.revision++
    this.clearRetries()
    this.source.invalidate()
    for (const wire of this.wires) wire.abort(new ManagedWireAbortError('COPILOT_PREVIEW_CREDENTIAL_CHANGED'))
  }
  dispose(): void {
    if (!this.active) return
    this.active = false
    this.clearRetries()
    this.source.dispose()
    this.controller.abort(new ManagedWireAbortError('COPILOT_PREVIEW_DISPOSED'))
    for (const wire of this.wires) wire.abort()
    this.wires.clear()
  }
  async read(signal = this.controller.signal, ticket?: CredentialReadTicket): Promise<GitHubCopilotOAuthCredential | undefined> {
    this.assertActive()
    const revision = this.revision
    const invalidateRead = (): void => {
      const ownRevision = this.revision + 1
      this.change()
      if (ticket !== undefined) ticket.revision = ownRevision
    }
    let credential: Awaited<ReturnType<CredentialStore['read']>>
    try { credential = await abortable(this.credentials().read(GITHUB_COPILOT_PREVIEW_PROVIDER_ID), signal) }
    catch {
      this.assertActive()
      if (signal.aborted) throw abortFailure(signal)
      if (revision === this.revision) invalidateRead()
      throw failure('COPILOT_PREVIEW_CREDENTIAL_READ_FAILED')
    }
    this.assertActive()
    if (signal.aborted || revision !== this.revision) throw failure('COPILOT_PREVIEW_CREDENTIAL_CHANGED', 'ABORTED')
    if (credential === undefined) { invalidateRead(); return undefined }
    if (credential.type !== 'oauth') { invalidateRead(); throw failure('COPILOT_PREVIEW_OAUTH_REQUIRED') }
    let grant: GitHubCopilotOAuthCredential
    try { grant = normalizeGitHubCopilotOAuthCredential(credential) }
    catch { invalidateRead(); throw failure('COPILOT_PREVIEW_CREDENTIAL_INVALID') }
    // Stored-record checks must still revoke metadata after its display TTL expires.
    const snapshot = this.source.readDisplaySnapshot()
    const proof = snapshot === undefined ? undefined : this.displayProofFor(snapshot)
    if (proof !== undefined && (proof.accountKey !== copilotAccountKey(grant)
      || proof.entitlementKey !== copilotEntitlementKey(grant)
      || proof.tokenFingerprint !== tokenFingerprint(grant.access) || proof.expires <= Date.now() || grant.expires <= Date.now())) {
      // Treat an observed silent record change exactly like a notification:
      // revoke the old metadata proof and every active wire, without discovery.
      invalidateRead()
    }
    return grant
  }
  async lease(snapshot: AccountModelSnapshot, model: string, signal?: AbortSignal): Promise<Lease> {
    const combined = signal === undefined ? this.controller.signal : AbortSignal.any([signal, this.controller.signal])
    const grant = await this.read(combined)
    if (grant === undefined) throw failure('COPILOT_PREVIEW_OAUTH_REQUIRED')
    const turnAdmitted = this.turns.permits(signal, model)
    if (!turnAdmitted && this.excluded(model)) throw failure('COPILOT_PREVIEW_MODEL_EXCLUDED', 'INVALID_REQUEST')
    const descriptor = snapshot.models.find(item => item.id === model)
    if (descriptor === undefined) throw failure('COPILOT_PREVIEW_MODEL_NOT_ENTITLED', 'UNKNOWN_MODEL')
    const proof = this.proofFor(snapshot)
    if (proof === undefined) throw failure('COPILOT_PREVIEW_METADATA_STALE')
    const lease: Lease = { credentials: this.credentials(), snapshot, descriptor, proof, revision: this.revision, signal: combined, retrySignal: signal, started: false }
    this.entitled(lease, grant, model)
    if (signal !== undefined && !signal.aborted) {
      return { ...lease, retrySignal: signal, retryReplay: this.retryFor(signal, snapshot, proof, model) }
    }
    return lease
  }
  private account(lease: Lease | undefined, grant: GitHubCopilotOAuthCredential): asserts lease is Lease {
    this.assertActive()
    if (lease === undefined || copilotAccountKey(grant) !== lease.proof.accountKey) throw failure('COPILOT_PREVIEW_ACCOUNT_CHANGED')
  }
  private entitled(lease: Lease | undefined, grant: GitHubCopilotOAuthCredential, model: string): void {
    this.account(lease, grant)
    if (!this.turns.permits(lease.retrySignal, model) && !lease.started && this.excluded(model)) throw failure('COPILOT_PREVIEW_MODEL_EXCLUDED', 'INVALID_REQUEST')
    if (lease.descriptor.id !== model) throw failure('COPILOT_PREVIEW_MODEL_MISMATCH', 'UNKNOWN_MODEL')
    if (this.source.readSnapshot() !== lease.snapshot || this.proofFor(lease.snapshot) !== lease.proof) throw failure('COPILOT_PREVIEW_METADATA_STALE')
    // A live enabled entry may precede the grant's ID list, but cannot survive a
    // token rotation or explicit removal from a newly refreshed grant by itself.
    if (tokenFingerprint(grant.access) !== lease.proof.tokenFingerprint || copilotEntitlementKey(grant) !== lease.proof.entitlementKey || grant.expires <= Date.now()) {
      this.change()
      throw failure('COPILOT_PREVIEW_METADATA_STALE')
    }
    if (lease.descriptor.evidence.policySource === 'account-available-id' && !grant.availableModelIds?.includes(model)) {
      throw failure('COPILOT_PREVIEW_MODEL_NOT_ENTITLED')
    }
  }
  start(lease: Lease): void {
    this.assertActive()
    if (!lease.started && lease.revision !== this.revision) throw failure('COPILOT_PREVIEW_PREPARED_CALL_INVALIDATED', 'ABORTED')
    if (!this.turns.permits(lease.retrySignal, lease.descriptor.id) && this.excluded(lease.descriptor.id)) throw failure('COPILOT_PREVIEW_MODEL_EXCLUDED', 'INVALID_REQUEST')
    lease.started = true
  }
  guard(lease?: Lease): AccountProviderGuard {
    return {
      signal: lease?.signal ?? this.controller.signal,
      ...lease === undefined ? {} : { selectedModelId: lease.descriptor.id,
        retryReplay: lease.retryReplay, retrySignal: lease.retrySignal },
      assertActive: () => this.assertActive(),
      assertAccount: grant => this.account(lease, grant),
      assertEntitled: (grant, model) => this.entitled(lease, grant, model),
      beforeWire: async (model, options) => {
        this.assertActive()
        owned(model.provider)
        const signal = AbortSignal.any([this.controller.signal, ...lease === undefined ? [] : [lease.signal], ...options?.signal === undefined ? [] : [options.signal]])
        const grant = await this.read(signal)
        if (grant === undefined) throw failure('COPILOT_PREVIEW_OAUTH_REQUIRED')
        this.entitled(lease, grant, model.id)
        if (lease === undefined || model.api !== lease.descriptor.api) throw failure('COPILOT_PREVIEW_MODEL_MISMATCH')
        if (options?.apiKey !== grant.access) throw failure('COPILOT_PREVIEW_CREDENTIAL_CHANGED')
        if (trustedGitHubCopilotBaseUrl(model.baseUrl, grant) !== lease.proof.baseURL) throw failure('COPILOT_PREVIEW_CREDENTIAL_CHANGED')
        const controller = new AbortController()
        this.wires.add(controller)
        return { signal: AbortSignal.any([signal, controller.signal]), release: () => { this.wires.delete(controller); controller.abort() } }
      },
    }
  }
}

function resolvedProfile(provider: ReturnType<typeof createAccountProvider>['provider'], config: PreviewRouteConfig): ResolvedPiAiProviderProfile {
  const permitted = new Set(['reasoning', 'cacheRetention', 'transport', 'timeoutMs', 'websocketConnectTimeoutMs',
    'streamIdleTimeoutMs', 'maxRequestImageBytes', 'requestImagePixelBudget', 'requestImageMaxBytes', 'retryPolicy'])
  if (Object.keys(config).some(key => !permitted.has(key))) throw failure('COPILOT_PREVIEW_CONFIG_UNSUPPORTED', 'INVALID_REQUEST')
  const profiles = providerProfiles(PiAiConfig({
    providers: { [GITHUB_COPILOT_PREVIEW_PROVIDER_ID]: { ...config, api: 'openai-responses' } },
  }).providers)
  const parsed = profiles?.[GITHUB_COPILOT_PREVIEW_PROVIDER_ID]
  if (!isRecord(parsed)) throw failure('COPILOT_PREVIEW_CONFIG_UNAVAILABLE', 'INVALID_REQUEST')
  const positive = (value: unknown): number => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      throw failure('COPILOT_PREVIEW_CONFIG_DEFAULTS_UNAVAILABLE', 'INVALID_REQUEST')
    }
    return value
  }
  return Object.freeze({
    ...config,
    provider: GITHUB_COPILOT_PREVIEW_PROVIDER_ID, displayName: 'GitHub Copilot', piProvider: provider,
    streamIdleTimeoutMs: positive(parsed.streamIdleTimeoutMs), maxRequestImageBytes: positive(parsed.maxRequestImageBytes),
    requestImagePixelBudget: positive(parsed.requestImagePixelBudget), requestImageMaxBytes: positive(parsed.requestImageMaxBytes),
    retryPolicy: resolveRetryPolicy(config.retryPolicy, 'github-copilot-preview'), configuredMaxTokens: new Map<string, number>(),
    // Core alpha2 reads this map for every model. Account descriptors are already
    // validated and rejected entries never enter this provider; older Core ignores it.
    modelErrors: new Map<string, string>(),
  })
}

/** Classify only an owned admission decision, never an arbitrary provider error string. */
function budgetFailure(result: RequestBudgetFailure): LlmError {
  const contextExceeded = result.code === 'COPILOT_REQUEST_INPUT_LIMIT_EXCEEDED'
    || result.code === 'COPILOT_REQUEST_CONTEXT_LIMIT_EXCEEDED'
  return new LlmError(contextExceeded ? `COPILOT_CONTEXT_BUDGET_EXCEEDED: ${result.message}` : result.message,
    contextExceeded ? 'CONTEXT_WINDOW_EXCEEDED' : 'INVALID_REQUEST')
}

/** Account-bound admission and purpose defaults; Core owns model conversion and wire/replay. */
class PreviewAdapter extends PiAiAdapter {
  constructor(private readonly lifetime: PreviewLifetime,
    private readonly optionsFor: (lease?: Lease, hooks?: Pick<AccountProviderGuard, 'inspectRequest' | 'requestCheckpoint' | 'onReplayFailure' | 'onWireAbort' | 'onRequestBodyTimeout' | 'onStreamIdleTimeout' | 'onStreamLiveness' | 'recoverReplay' | 'onReplayScopeRejected'>) => PiAiAdapterOptions,
    private readonly discoverSnapshot: (options?: AccountModelLoadOptions) => Promise<AccountModelSnapshot>,
    private readonly refreshRejected: (snapshot: AccountModelSnapshot, signal?: AbortSignal, missingOnly?: boolean) => Promise<void>,
    private readonly requestBudgetSettings: () => Partial<RequestBudgetPolicy>,
    private readonly accountModelSettings: () => Pick<InlineConfig, 'excludedModelIds'>,
    private readonly replayRecovery?: ReturnType<typeof installReplayRecovery>,
    private readonly requestCheckpoint?: () => void,
    private readonly captureRequest: (signal?: AbortSignal) => void = () => undefined,
  ) { super(optionsFor()) }
  override async listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    owned(provider)
    try {
      // Catalog consumers share Settings/request discovery, including its signed-out
      // guard, single flight, TTL and failure cooldown. No separate catalog owner.
      const snapshot = await this.discoverSnapshot()
      // Publishing a new directory notifies Core synchronously; a listener may
      // invalidate credentials/proof before discovery returns. Recheck, never retry.
      const grant = await this.lifetime.read()
      if (grant === undefined || snapshot.accountKey !== copilotAccountKey(grant)) return []
      const proof = this.lifetime.proofFor(snapshot)
      if (proof === undefined || tokenFingerprint(grant.access) !== proof.tokenFingerprint || grant.expires <= Date.now()) return []
      const excluded = this.excludedModels()
      const models = snapshot.models.filter(model => autoModelPreference(model.id) === undefined
        && !excluded.has(model.id) && model.input.includes('text'))
      if (models.length === 0) return []
      return [
        { provider, id: GITHUB_COPILOT_AUTO_MODEL_ID, name: 'Auto · Balance',
          inputModalities: [...autoModelInputModalities(models)] },
        { provider, id: GITHUB_COPILOT_AUTO_EFFICIENCY_MODEL_ID, name: 'Auto · Efficiency',
          inputModalities: [...autoModelInputModalities(models)] },
        { provider, id: GITHUB_COPILOT_AUTO_INTELLIGENCE_MODEL_ID, name: 'Auto · Intelligence',
          inputModalities: [...autoModelInputModalities(models)] },
        ...models.map(model => ({ provider, id: model.id, name: model.name, inputModalities: [...model.input] })),
      ]
    } catch { return [] }
  }
  override async resolveModel(provider: string, model: string, signal?: AbortSignal): Promise<LlmResolvedModelInfo> {
    const admission = this.lifetime.acquire(signal)
    try { return await this.resolveAccountModel(provider, model, signal) }
    finally { admission?.release() }
  }
  private async resolveAccountModel(provider: string, model: string, signal?: AbortSignal): Promise<LlmResolvedModelInfo> {
    owned(provider)
    const cached = this.lifetime.source.readSnapshot()
    const snapshot = await this.discoverSnapshot({ signal })
    if (autoModelPreference(model) !== undefined) {
      const excluded = this.excludedModels()
      const models = snapshot.models.filter(candidate => autoModelPreference(candidate.id) === undefined
        && !excluded.has(candidate.id) && candidate.input.includes('text'))
      if (models.length === 0) throw failure('COPILOT_AUTO_NO_ELIGIBLE_MODEL', 'UNKNOWN_MODEL')
      const name = model === GITHUB_COPILOT_AUTO_MODEL_ID ? 'Auto · Balance'
        : model === GITHUB_COPILOT_AUTO_EFFICIENCY_MODEL_ID ? 'Auto · Efficiency' : 'Auto · Intelligence'
      return { provider, id: model, name, inputModalities: [...autoModelInputModalities(models)] }
    }
    const lease = await this.lease(snapshot, model, signal, cached === snapshot)
    return this.withRecovery(snapshot, signal, () => new PiAiAdapter(this.optionsFor(lease)).resolveModel(provider, model, signal))
  }
  override async prepareCall(provider: string, model: string, signal?: AbortSignal): Promise<PreparedAdapterCall> {
    const admission = this.lifetime.acquire(signal)
    try {
      const prepared = await this.prepareAccountCall(provider, model, signal)
      const lifetime = this.lifetime
      return { model: prepared.model, stream: options => (async function* () {
        let dispatch: CopilotAccountLease | undefined
        try {
          dispatch = lifetime.acquire(options.signal)
          admission?.binding.assertCurrent()
          admission?.release()
          yield* prepared.stream(options)
        } finally { admission?.release(); dispatch?.release() }
      })() }
    } catch (error) { admission?.release(); throw error }
  }
  private async prepareAccountCall(provider: string, model: string, signal?: AbortSignal): Promise<PreparedAdapterCall> {
    this.requestCheckpoint?.()
    owned(provider)
    if (autoModelPreference(model) !== undefined) throw failure('COPILOT_AUTO_ROUTE_UNRESOLVED', 'INVALID_REQUEST')
    const cached = this.lifetime.source.readSnapshot()
    const snapshot = await this.discoverSnapshot({ signal })
    this.requestCheckpoint?.()
    const lease = await this.lease(snapshot, model, signal, cached === snapshot)
    this.requestCheckpoint?.()
    const prepared = await this.withRecovery(snapshot, signal, () => new PiAiAdapter(this.optionsFor(lease)).prepareCall(provider, model, signal))
    this.requestCheckpoint?.()
    return { model: prepared.model, stream: options => this.guardedStream(lease, options) }
  }
  override stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const owner = this
    return (async function* () {
      const admission = owner.lifetime.acquire(options.signal)
      try {
      owned(options.provider)
      if (autoModelPreference(options.model) !== undefined) throw failure('COPILOT_AUTO_ROUTE_UNRESOLVED', 'INVALID_REQUEST')
      const cached = owner.lifetime.source.readSnapshot()
      const snapshot = await owner.discoverSnapshot({ signal: options.signal })
      const lease = await owner.lease(snapshot, options.model, options.signal, cached === snapshot)
      yield* owner.guardedStream(lease, options)
      } finally { admission?.release() }
    })()
  }
  private async lease(snapshot: AccountModelSnapshot, model: string, signal: AbortSignal | undefined, reused: boolean): Promise<Lease> {
    try { return await this.lifetime.lease(snapshot, model, signal) }
    catch (cause) {
      // A miss from the catalog fetched by this very request is already current;
      // only a cached miss warrants one out-of-TTL metadata recovery.
      if (reused && cause instanceof LlmError && cause.code === 'UNKNOWN_MODEL') await this.refreshRejected(snapshot, signal, true)
      throw cause
    }
  }
  private async withRecovery<T>(snapshot: AccountModelSnapshot, signal: AbortSignal | undefined, operation: () => Promise<T>): Promise<T> {
    try { return await operation() }
    catch (cause) {
      if (cause instanceof LlmError && cause.code === 'UNKNOWN_MODEL') await this.refreshRejected(snapshot, signal)
      throw cause
    }
  }
  private guardedStream(lease: Lease, options: GenerateOptions): AsyncIterable<StreamChunk> {
    const owner = this
    return (async function* () {
      owner.requestCheckpoint?.()
      owner.lifetime.start(lease)
      owned(options.provider)
      if (options.model !== lease.descriptor.id) throw failure('COPILOT_PREVIEW_MODEL_MISMATCH')
      const signal = AbortSignal.any([lease.signal, ...options.signal === undefined ? [] : [options.signal]])
      if (signal.aborted) throw abortFailure(signal)
      const policy = resolveRequestBudgetPolicy(owner.requestBudgetSettings())
      const model = accountModelFromDescriptor(lease.descriptor, lease.proof.baseURL)
      if (options.reasoningEffort !== undefined) {
        const mapping = Object.entries(model.thinkingLevelMap ?? {}).find(([level]) => level === options.reasoningEffort)?.[1]
        if (typeof mapping !== 'string' || mapping.length === 0) throw failure('COPILOT_PREVIEW_REASONING_UNSUPPORTED', 'INVALID_REQUEST')
      }
      // SDK lazyStream retains only error text. Keep an owned failure in this exact
      // dispatch closure, never on the shared lease, to restore its structured code.
      let requestFailure: LlmError | undefined
      const recovery = owner.replayRecovery?.prepare(options)
      let wireAbort: ManagedWireAbortCode | undefined
      let bodyTimeout: string | undefined
      let liveness: Parameters<NonNullable<AccountProviderGuard['onStreamLiveness']>>[0] | undefined
      const inspectRequest: NonNullable<AccountProviderGuard['inspectRequest']> = (_model, context, nativeOptions) => {
        owner.requestCheckpoint?.()
        if (signal.aborted) throw abortFailure(signal)
        const imageFailure = imageInputFailure(lease.descriptor, context.messages)
        if (imageFailure !== undefined) {
          requestFailure = new LlmError(imageFailure, 'INVALID_REQUEST')
          throw requestFailure
        }
        const calculated = calculateRequestBudget(lease.descriptor, nativeOptions?.maxTokens, policy)
        if (!calculated.ok) {
          requestFailure = budgetFailure(calculated)
          throw requestFailure
        }
        // A previous usage anchor can omit changed system/tool prefixes. In the
        // native transcript they are system messages, so price every message.
        const fresh = context.messages.reduce((tokens, message) => tokens + estimateMessageTokens(message), 0)
        const estimate = Math.max(estimateContextTokens(context).tokens, fresh)
        const admitted = assessRequestBudget(estimate, calculated.budget)
        if (!admitted.ok) {
          requestFailure = budgetFailure(admitted)
          throw requestFailure
        }
        owner.requestCheckpoint?.()
      }
      try {
        // Same immutable descriptor/profile generation, but request-local provider
        // callbacks: concurrent compaction and chat cannot share purpose or errors.
        const native = new PiAiAdapter(owner.optionsFor(lease, { inspectRequest, requestCheckpoint: owner.requestCheckpoint,
          ...recovery === undefined ? {} : { recoverReplay: recovery.transform, onReplayScopeRejected: recovery.rejected },
          onWireAbort(code) {
            wireAbort = code
          },
          onRequestBodyTimeout(diagnostic) {
            bodyTimeout = diagnostic
          },
          onStreamIdleTimeout(error) {
            requestFailure = new LlmError(error.message, 'TIMEOUT', { cause: error })
          },
          onStreamLiveness(control) {
            liveness = control
          },
          onReplayFailure(error) {
            // Only this dispatch's verified wire/payload observer can set this;
            // arbitrary upstream text must never masquerade as a compatibility failure.
            if (!signal.aborted) requestFailure = new LlmError(error.message, 'INVALID_REQUEST')
          },
        }))
        const prepared = await native.prepareCall(options.provider, options.model, signal)
        owner.requestCheckpoint?.()
        const suppliedEffort = options.reasoningEffort ?? prepared.model.reasoning?.defaultEffort
        const effort = options.purpose === 'compaction'
          ? selectCompactionReasoning<string>(getSupportedThinkingLevels(model), suppliedEffort, policy.compactionReasoning)
          : suppliedEffort
        const request = { ...options, signal,
          ...effort === undefined ? {} : { reasoningEffort: ReasoningEffortId(effort) },
        }
        let capturedRequest = false
        for await (const chunk of native.stream(request)) {
          owner.requestCheckpoint?.()
          let delivered = chunk
          // The SDK may already have queued usage before its terminal error.
          // Restore the owned failure without discarding those shared samples.
          if (requestFailure !== undefined && chunk.type === 'finish') {
            if (signal.aborted) throw abortFailure(signal)
            throw requestFailure
          }
          if (chunk.type === 'finish' && wireAbort !== undefined) {
            if (signal.aborted) throw abortFailure(signal)
            throw failure(wireAbort, 'ABORTED')
          }
          if (chunk.type === 'finish' && chunk.reason.kind === 'error' && chunk.reason.failure.code === 'UNKNOWN_MODEL') {
            await owner.refreshRejected(lease.snapshot, signal)
          }
          if (chunk.type === 'finish' && chunk.reason.kind === 'error'
            && bodyTimeout !== undefined && chunk.reason.failure.code !== 'ABORTED') {
            if (signal.aborted) throw abortFailure(signal)
            delivered = { ...chunk, reason: { ...chunk.reason, failure: { ...chunk.reason.failure, message: bodyTimeout } } }
          }
          // SDK lazyStream eagerly forwards events; only this Core-chunk boundary
          // observes consumer backpressure rather than its internal producer.
          liveness?.pause()
          if (!capturedRequest && options.purpose === undefined) {
            capturedRequest = true
            owner.captureRequest(options.signal)
          }
          try { yield delivered } finally { liveness?.resume() }
        }
        if (requestFailure !== undefined) throw requestFailure
      } catch (cause) {
        if (signal.aborted) throw abortFailure(signal)
        if (cause instanceof LlmError && cause.code === 'UNKNOWN_MODEL') await owner.refreshRejected(lease.snapshot, signal)
        throw requestFailure ?? cause
      }
    })()
  }
  private excludedModels(): ReadonlySet<string> {
    return excludedModelSet(this.accountModelSettings().excludedModelIds)
  }
}

function createAccountRuntime(ctx: Context, config: PreviewRouteConfig, binding: CopilotAccountBinding | undefined,
  exclusionTurns: ModelExclusionTurns, replayRecovery: ReturnType<typeof installReplayRecovery>,
  publish: () => void) {
  const { accountModelTtlMs, accountModelFailureCooldownMs, accountModelSettings,
    requestBudget, requestBudgetSettings, streamLiveness, chatRequestSettings, ...requestConfig } = config
  const cacheSettings: () => Pick<InlineConfig, 'accountModelTtlMs' | 'accountModelFailureCooldownMs' | 'excludedModelIds' | 'highCostModelIds' | 'parentModelFollow' | 'followParentModel' | 'autoSemanticAssessment' | 'autoAllocationEvidence'>
    = accountModelSettings ?? (() => ({ accountModelTtlMs, accountModelFailureCooldownMs, excludedModelIds: [] }))
  const budgetSettings = requestBudgetSettings ?? (() => requestBudget ?? {})
  const excludedModels = () => excludedModelSet(cacheSettings().excludedModelIds)
  resolveRequestBudgetPolicy(budgetSettings())
  const store = () => createGitHubCopilotCredentialStore(ctx, GITHUB_COPILOT_PREVIEW_PROVIDER_ID, binding)
  const acquire = (signal?: AbortSignal) => ctx.get('githubCopilotAccounts')?.host.acquire(signal, true, binding?.accountId)
  let rejectedAuth: Proof | undefined
  let authRecovery: { readonly accountKey: string; readonly at: number } | undefined
  const nativeAuth = createAccountModelAuth(() => createGitHubCopilotCredentialStore(ctx, 'github-copilot', binding), grant => {
    const accountKey = copilotAccountKey(grant)
    if (rejectedAuth?.accountKey !== accountKey || rejectedAuth.tokenFingerprint !== tokenFingerprint(grant.access)) return false
    const now = Date.now()
    const cooldown = Math.max(1000, cacheSettings().accountModelFailureCooldownMs ?? 300_000)
    const age = authRecovery === undefined ? undefined : now - authRecovery.at
    // Metadata invalidation resets its own cooldown. Bound rejected-token
    // recovery separately per account, including successful but rejected renewals.
    if (!Number.isFinite(now) || authRecovery?.accountKey === accountKey
      && (age === undefined || !Number.isFinite(age) || age < cooldown)) throw failure('COPILOT_PREVIEW_AUTH_RECOVERY_COOLDOWN')
    authRecovery = { accountKey, at: now }
    return true
  })
  const nativeModels = getBuiltinModels('github-copilot')
  const nativeApis = new Map(nativeModels.map(model => [model.id, model.api]))
  let lastValidatedProof: Proof | undefined
  let provenSnapshot: AccountModelSnapshot | undefined
  let snapshotProof: Proof | undefined
  const source: AccountModelSource = createAccountModelSource({
    nativeApis, headers: copilotPublicHeaders(),
    ttlMs: () => cacheSettings().accountModelTtlMs ?? 86_400_000,
    failureCooldownMs: () => cacheSettings().accountModelFailureCooldownMs ?? 300_000,
    async resolveAuth(signal) {
      try { return await nativeAuth.resolveAuth(signal) }
      catch (error) {
        if (!signal.aborted) lifetime.change()
        throw error
      }
    },
    async assertAuthCurrent(auth, signal) {
      try {
        await nativeAuth.assertAuthCurrent(auth, signal)
        const stored = await store().read(GITHUB_COPILOT_PREVIEW_PROVIDER_ID)
        if (signal.aborted || stored?.type !== 'oauth') throw failure('COPILOT_PREVIEW_CREDENTIAL_CHANGED')
        const grant = normalizeGitHubCopilotOAuthCredential(stored)
        if (copilotAccountKey(grant) !== auth.accountKey || grant.access !== auth.apiKey || grant.expires <= Date.now()) throw failure('COPILOT_PREVIEW_CREDENTIAL_CHANGED')
        const entitlementKey = copilotEntitlementKey({ ...auth.availableModelIds === undefined ? {} : { availableModelIds: [...auth.availableModelIds] } })
        if (copilotEntitlementKey(grant) !== entitlementKey) throw failure('COPILOT_PREVIEW_CREDENTIAL_CHANGED')
        if (source.readDisplaySnapshot() !== undefined && snapshotProof !== undefined && (snapshotProof.accountKey !== auth.accountKey
          || snapshotProof.entitlementKey !== entitlementKey || snapshotProof.tokenFingerprint !== tokenFingerprint(auth.apiKey))) {
          throw failure('COPILOT_PREVIEW_CREDENTIAL_CHANGED')
        }
        lastValidatedProof = Object.freeze({ accountKey: auth.accountKey, entitlementKey, tokenFingerprint: tokenFingerprint(auth.apiKey), baseURL: auth.baseURL, expires: grant.expires })
      } catch (error) {
        // Discovery sanitizes errors into a view. Revoke continuity first so a
        // caller cannot mistake failed auth validation for ordinary unavailability.
        if (!signal.aborted) lifetime.change()
        throw error
      }
    },
  })
  const displayProofFor = (snapshot: AccountModelSnapshot): Proof | undefined => source.readDisplaySnapshot() === snapshot
    && provenSnapshot === snapshot && snapshotProof?.accountKey === snapshot.accountKey ? snapshotProof : undefined
  const proofFor = (snapshot: AccountModelSnapshot): Proof | undefined => source.readSnapshot() === snapshot
    && snapshotProof !== undefined && snapshotProof.expires > Date.now() ? displayProofFor(snapshot) : undefined
  const lifetime = new PreviewLifetime(store, source, proofFor, displayProofFor, modelId => excludedModels().has(modelId),
    exclusionTurns, acquire)
  // Empty provider is used only for registry metadata/config validation, never requests.
  const template = resolvedProfile(createAccountProvider([], lifetime.guard(), 'https://api.individual.githubcopilot.com').provider, requestConfig)
  let configured = false
  let readError: string | undefined
  const getView = (): GitHubCopilotPreviewView => {
    const status = source.getView()
    const cachedSnapshot = source.readDisplaySnapshot()
    const proof = cachedSnapshot === undefined ? undefined : displayProofFor(cachedSnapshot)
    const snapshot = readError === undefined && proof !== undefined && proof.expires > Date.now() ? cachedSnapshot : undefined
    const models = snapshot?.models.map(({ id, name, api }) => Object.freeze({ id, name, api })) ?? []
    const rejected = snapshot?.rejected.map(({ id, code }) => Object.freeze({ ...id === undefined ? {} : { id }, code })) ?? []
    const warnings = snapshot?.models.flatMap(model => {
      const codes: string[] = []
      if (model.maxInputTokens !== undefined && model.maxInputTokens < model.contextWindow) codes.push('INPUT_LIMIT_ESTIMATED_GUARD')
      if (model.evidence.categoryDiagnostic !== undefined) codes.push(`AUTO_CATEGORY_${model.evidence.categoryDiagnostic.toUpperCase()}`)
      if (snapshotProof !== undefined && accountModelFromDescriptor(model, snapshotProof.baseURL).unmappedReasoningEfforts.length > 0) codes.push('REASONING_EFFORTS_UNSUPPORTED')
      return codes.map(code => Object.freeze({ id: model.id, code }))
    }) ?? []
    const changed = snapshot?.models.some(model => {
      const native = nativeModels.find(item => item.id === model.id)
      if (native === undefined || snapshotProof === undefined) return true
      const actual = accountModelFromDescriptor(model, snapshotProof.baseURL)
      const expectedEfforts = getSupportedThinkingLevels(actual)
      const nativeEfforts = getSupportedThinkingLevels(native)
      return native.api !== model.api || native.contextWindow !== model.contextWindow || native.maxTokens !== model.maxTokens
        || native.input.length !== model.input.length || native.input.some(value => !model.input.includes(value))
        || native.reasoning !== actual.reasoning || expectedEfforts.length !== nativeEfforts.length
        || expectedEfforts.some(level => !nativeEfforts.includes(level) || (native.thinkingLevelMap?.[level] ?? level) !== (actual.thinkingLevelMap?.[level] ?? level))
    }) ?? false
    const state = status.state === 'disposed' ? 'disposed' : readError !== undefined ? 'error' : !configured ? 'unconfigured'
      : status.state === 'ready' && cachedSnapshot !== undefined && snapshot === undefined ? 'stale'
        : status.state === 'ready' && models.length === 0 ? 'unavailable' : status.state
    return Object.freeze({ provider: GITHUB_COPILOT_PREVIEW_PROVIDER_ID, configured, available: configured && state === 'ready' && models.length > 0,
      correctionActive: changed, state, models: Object.freeze(models), rejected: Object.freeze(rejected), warnings: Object.freeze(warnings),
      ...status.fetchedAt === undefined ? {} : { discoveredAt: status.fetchedAt },
      ...readError === undefined && status.error === undefined ? {} : { error: readError ?? status.error },
    })
  }
  const notify = publish
  const refresh = async (): Promise<GitHubCopilotPreviewView> => {
    lifetime.assertActive()
    const ticket: CredentialReadTicket = { revision: lifetime.revision }
    try {
      const grant = await lifetime.read(undefined, ticket)
      if (ticket.revision !== lifetime.revision) return getView()
      configured = grant !== undefined; readError = undefined
      const snapshot = source.readDisplaySnapshot()
      if (snapshot !== undefined && (grant === undefined || snapshot.accountKey !== copilotAccountKey(grant)
        || snapshotProof?.tokenFingerprint !== tokenFingerprint(grant.access) || grant.expires <= Date.now())) {
        source.invalidate(); provenSnapshot = undefined; snapshotProof = undefined
      }
    } catch {
      lifetime.assertActive()
      if (ticket.revision !== lifetime.revision) return getView()
      configured = false; readError = 'COPILOT_PREVIEW_CREDENTIAL_READ_FAILED'
    }
    notify()
    return getView()
  }
  const discoverSnapshot = async (options: AccountModelLoadOptions = {}): Promise<AccountModelSnapshot> => {
    const admission = acquire(options.signal)
    try { return await discoverAccountSnapshot(options) }
    finally { admission?.release() }
  }
  const discoverAccountSnapshot = async (options: AccountModelLoadOptions = {}): Promise<AccountModelSnapshot> => {
    lifetime.assertActive()
    const ticket: CredentialReadTicket = { revision: lifetime.revision }
    let grant: GitHubCopilotOAuthCredential | undefined
    try { grant = await lifetime.read(options.signal, ticket) }
    catch {
      lifetime.assertActive()
      if (ticket.revision === lifetime.revision) {
        readError = 'COPILOT_PREVIEW_CREDENTIAL_READ_FAILED'
        notify()
      }
      throw failure('COPILOT_PREVIEW_CREDENTIAL_READ_FAILED')
    }
    if (ticket.revision !== lifetime.revision) throw failure('COPILOT_PREVIEW_CREDENTIAL_CHANGED', 'ABORTED')
    if (grant === undefined) {
      configured = false; readError = undefined; source.invalidate(); provenSnapshot = undefined; snapshotProof = undefined
      notify()
      throw failure('COPILOT_PREVIEW_OAUTH_REQUIRED')
    }
    configured = true
    readError = undefined
    const cached = source.readDisplaySnapshot()
    // A warm cache must not mint a lease that native getAuth immediately revokes
    // by renewing its token. Retire only reusable cache here: callers must join
    // an existing flight, not cancel its HTTP/checking phase. Renewal stays in
    // source.load's auth phase, which rebases its own credential notification.
    const renewBeforeLease = source.readSnapshot() !== undefined
      && grant.expires <= Date.now() + ACCOUNT_MODEL_AUTH_MIN_VALIDITY_MS
    if (cached !== undefined && (cached.accountKey !== copilotAccountKey(grant) || snapshotProof?.tokenFingerprint !== tokenFingerprint(grant.access) || grant.expires <= Date.now() || renewBeforeLease)) {
      source.invalidate(); provenSnapshot = undefined; snapshotProof = undefined
    }
    try {
      const snapshot = await source.load({ ...options, signal: options.signal === undefined ? lifetime.controller.signal : AbortSignal.any([options.signal, lifetime.controller.signal]) })
      lifetime.assertActive()
      if (source.readSnapshot() !== snapshot || lastValidatedProof?.accountKey !== snapshot.accountKey) throw failure('COPILOT_PREVIEW_METADATA_STALE')
      if (provenSnapshot !== snapshot) { provenSnapshot = snapshot; snapshotProof = lastValidatedProof }
      return snapshot
    } finally { notify() }
  }
  let rejectedRecovery: { readonly accountKey: string; readonly tokenFingerprint: string; readonly at: number } | undefined
  const refreshRejected = async (snapshot: AccountModelSnapshot, signal?: AbortSignal, missingOnly = false): Promise<void> => {
    const proof = displayProofFor(snapshot)
    if (proof === undefined) return
    const now = Date.now()
    const age = rejectedRecovery === undefined ? undefined : now - rejectedRecovery.at
    // Even when passive failure cooldown is disabled, repeated model rejection
    // cannot produce an unbounded immediate metadata retry loop.
    const cooldown = Math.max(1000, cacheSettings().accountModelFailureCooldownMs ?? 300_000)
    const cooling = !Number.isFinite(now) || rejectedRecovery?.accountKey === proof.accountKey
      && rejectedRecovery.tokenFingerprint === proof.tokenFingerprint && (age === undefined || !Number.isFinite(age) || age < cooldown)
    // A local typo/absent ID does not revoke the other models in a catalog that
    // recovery just validated. A native rejection of a listed ID does revoke it.
    if (missingOnly && (cooling || signal?.aborted)) return
    if (!source.rejectSnapshot(snapshot)) return
    provenSnapshot = undefined; snapshotProof = undefined
    notify()
    if (cooling || signal?.aborted) return
    rejectedRecovery = { accountKey: proof.accountKey, tokenFingerprint: proof.tokenFingerprint, at: now }
    // Metadata recovery only: preserve the original request failure, model ID and
    // stream. Never replay a model wire request or retry generic provider errors.
    try { await discoverSnapshot({ force: true, signal }) } catch { /* Original failure remains authoritative. */ }
  }
  const optionsFor = (lease?: Lease, hooks: Pick<AccountProviderGuard, 'inspectRequest' | 'requestCheckpoint' | 'onReplayFailure' | 'onWireAbort' | 'onRequestBodyTimeout' | 'onStreamIdleTimeout' | 'onStreamLiveness' | 'recoverReplay' | 'onReplayScopeRejected'> = {}): PiAiAdapterOptions => {
    const settings = chatRequestSettings?.()
    const idle = settings?.chatStreamIdleTimeoutMs ?? template.streamIdleTimeoutMs
    const enabled = (settings?.chatStreamLiveness ?? streamLiveness ?? true)
      && (template.transport === undefined || template.transport === 'sse')
    const guard: AccountProviderGuard = { ...lifetime.guard(lease), ...hooks,
      onReplayFailure(error) {
        if (error.dispatchEvidence !== undefined) ctx.logger.warn(`[github-copilot] ${error.dispatchEvidence}`)
        hooks.onReplayFailure?.(error)
      },
      ...enabled ? { streamIdleTimeoutMs: idle } : {},
      onUnauthorized() {
        // A late response from before sign-in, refresh or disposal cannot retire
        // a newer credential. This synchronous fence precedes every state change.
        if (lease === undefined || !lifetime.isCurrent(lease.revision)
          || source.readDisplaySnapshot() !== lease.snapshot || provenSnapshot !== lease.snapshot || snapshotProof !== lease.proof) return
        rejectedAuth = lease.proof
        lifetime.change()
        provenSnapshot = undefined; snapshotProof = undefined; lastValidatedProof = undefined
        // No auth/discovery here and no replay. Native renewal belongs to the
        // next independent caller through the shared discovery single flight.
      },
    }
    const { provider } = createAccountProvider(lease?.snapshot.models ?? [], guard, lease?.proof.baseURL ?? 'https://api.individual.githubcopilot.com')
    // Byte-idle retains the original interval; real SSE progress earns only a bounded
    // extra semantic window. WebSocket/auto keep the untouched native policy.
    const profile = resolvedProfile(provider, { ...requestConfig,
      streamIdleTimeoutMs: enabled ? Math.min(idle * 2, 2_147_483_647) : idle,
      maxRequestImageBytes: settings?.chatMaxRequestImageBytes ?? template.maxRequestImageBytes,
    })
    const profiles = new Map([[GITHUB_COPILOT_PREVIEW_PROVIDER_ID, profile]])
    return { profiles: () => profiles, resolveApiKey: async () => { lifetime.assertActive(); return undefined },
      auth: { credentials: lease?.credentials ?? store(),
        authContext: { env: async () => undefined, fileExists: async () => false } },
      resolveAttachments: () => ctx.get('attachments'),
      resolveImageAccess: (attachments, ref) => resolveImageAttachmentAccess(attachments, hostPath => ctx.get('fs')?.processPathFromHostPath(hostPath), ref),
    }
  }
  const auto = {
    async loadModels(signal: AbortSignal) {
      const excluded = excludedModels()
      return (await discoverSnapshot({ signal })).models.filter(model => !excluded.has(model.id))
    },
    budgetPolicy: () => budgetSettings(),
    parentModelBindings: () => cacheSettings().parentModelFollow ?? [],
    followParentModel: () => cacheSettings().followParentModel === true,
    semanticAssessment: () => cacheSettings().autoSemanticAssessment ?? true,
    highCostModelIds: () => normalizeHighCostModelIds(cacheSettings().highCostModelIds),
    assessmentDiagnostic: (code: string) => ctx.logger.warn(code),
    async classifyTask(...args: Parameters<NonNullable<Parameters<typeof installAutoModelRouting>[1]['classifyTask']>>) {
      const [input, signal, observe, checkpoint] = args
      checkpoint?.()
      const snapshot = await discoverSnapshot({ signal })
      checkpoint?.()
      const model = taskClassifierModel(snapshot.models.filter(model => !excludedModels().has(model.id)),
        normalizeHighCostModelIds(cacheSettings().highCostModelIds))
      if (model === undefined) throw failure('COPILOT_AUTO_CLASSIFIER_UNAVAILABLE')
      observe?.({ stage: 'model-selected', modelId: model.id })
      const revision = lifetime.revision
      const adapter = new PreviewAdapter(lifetime, optionsFor, discoverSnapshot, refreshRejected, budgetSettings, cacheSettings,
        undefined, checkpoint)
      try {
        const prepared = await adapter.prepareCall(GITHUB_COPILOT_PREVIEW_PROVIDER_ID, model.id, signal)
        checkpoint?.()
        if (signal.aborted) throw signal.reason
        const offSupported = prepared.model.reasoning?.efforts.some(effort => effort.id === 'off') === true
        return await classifyTaskWithAdapter(model, input, signal,
          request => prepared.stream(request), observe, offSupported, checkpoint)
      }
      finally {
        if (!lifetime.isCurrent(revision) || source.readSnapshot() !== snapshot || proofFor(snapshot) === undefined) {
          throw new TaskAssessmentRevokedError(failure('COPILOT_PREVIEW_METADATA_STALE', 'ABORTED'))
        }
      }
    },
    admitModel(agent: Agent, turn: number, model: string, signal: AbortSignal) {
      if (!exclusionTurns.admit(agent.session, turn, model, signal, excludedModels())) {
        throw failure('COPILOT_PREVIEW_MODEL_EXCLUDED', 'INVALID_REQUEST')
      }
    },
  }
  const adapter = new PreviewAdapter(lifetime, optionsFor, discoverSnapshot, refreshRejected, budgetSettings, cacheSettings,
    replayRecovery, undefined, signal => ctx.get('githubCopilotSessionAccounts')?.recordRequest(signal))
  const pressureCallbacks = { resolve(request: GenerateOptions) {
    const snapshot = source.readSnapshot()
    if (snapshot === undefined || proofFor(snapshot) === undefined) return undefined
    if (excludedModels().has(request.model)) return undefined
    const descriptor = snapshot.models.find(model => model.id === request.model)
    if (descriptor === undefined) return undefined
    const result = calculateRequestBudget(descriptor, request.maxTokens, resolveRequestBudgetPolicy(budgetSettings()))
    return result.ok ? { inputBudgetTokens: result.budget.pressureInputLimit } : undefined
  } }
  const preview: GitHubCopilotPreview = { getView, refresh,
    recoveryLimits(modelId) {
      const snapshot = source.readSnapshot()
      if (snapshot === undefined || proofFor(snapshot) === undefined || !getView().available
        || excludedModels().has(modelId)) return undefined
      const descriptor = snapshot.models.find(model => model.id === modelId)
      if (descriptor === undefined) return undefined
      const revision = lifetime.revision
      const proof = snapshotProof
      return Object.freeze({
        limits: Object.freeze({
          contextWindow: descriptor.contextWindow, maxTokens: descriptor.maxTokens,
          ...descriptor.maxInputTokens === undefined ? {} : { maxInputTokens: descriptor.maxInputTokens },
        }),
        policy: Object.freeze({ ...budgetSettings() }),
        assertCurrent: () => {
          if (!lifetime.isCurrent(revision) || snapshotProof !== proof || proofFor(snapshot) === undefined
            || source.readSnapshot() !== snapshot || excludedModels().has(modelId)) {
            throw new Error('COPILOT_MANUAL_RECOVERY_ACCOUNT_PROOF_CHANGED')
          }
        },
      })
    },
    captureSearchProof() {
      const revision = lifetime.revision
      const captured = snapshotProof
      const expires = captured !== undefined && captured.expires > Date.now() ? captured.expires : undefined
      // Metadata TTL/refresh is not credential revocation. Retain a live grant's
      // deadline even if discovery replaces its metadata. Already-expired/cold
      // facts may enter discovery, whose stored read still revokes this revision.
      return () => lifetime.isCurrent(revision)
        && (expires === undefined || expires > Date.now())
        && (snapshotProof === captured || snapshotProof === undefined || snapshotProof.expires > Date.now())
    },
    routeFacts(modelId) {
      if (excludedModels().has(modelId)) return undefined
      const snapshot = source.readSnapshot()
      const proof = snapshot === undefined ? undefined : proofFor(snapshot)
      const descriptor = snapshot?.models.find(model => model.id === modelId)
      return !getView().available || proof === undefined || descriptor === undefined ? undefined : Object.freeze({ api: descriptor.api, baseURL: proof.baseURL })
    },
    async resolveRequestAuth(modelId, signal) {
      const snapshot = await discoverSnapshot({ signal })
      const lease = await lifetime.lease(snapshot, modelId, signal)
      const auth = await nativeAuth.resolveAuth(lease.signal)
      const grant = await lifetime.read(lease.signal)
      if (grant === undefined) throw failure('COPILOT_PREVIEW_OAUTH_REQUIRED')
      lifetime.guard(lease).assertEntitled(grant, modelId)
      if (auth.accountKey !== lease.proof.accountKey || tokenFingerprint(auth.apiKey) !== lease.proof.tokenFingerprint || auth.baseURL !== lease.proof.baseURL) {
        throw failure('COPILOT_PREVIEW_METADATA_STALE')
      }
      await nativeAuth.assertAuthCurrent(auth, lease.signal)
      lifetime.guard(lease).assertEntitled(grant, modelId)
      return Object.freeze({ apiKey: auth.apiKey, baseURL: auth.baseURL, headers: Object.freeze({ ...copilotPublicHeaders() }) })
    },
    async discover(options) {
    try { await discoverSnapshot(options) } catch { lifetime.assertActive() }
    return getView()
  } }
  return { adapter, preview, auto, pressureCallbacks, optionsFor, lifetime,
    proof() {
      if (snapshotProof === undefined || snapshotProof.expires <= Date.now()) return undefined
      return `${binding?.accountId ?? 'canonical'}:${lifetime.revision}:${snapshotProof.accountKey}:${snapshotProof.tokenFingerprint}`
    },
    invalidate() {
      lifetime.change(); provenSnapshot = undefined; snapshotProof = undefined; lastValidatedProof = undefined
      void refresh().catch(() => undefined)
    },
  }
}

type AccountRuntime = ReturnType<typeof createAccountRuntime>

/** One registry owner delegates to immutable account-local native adapter state. */
class AccountRoutingAdapter extends PiAiAdapter {
  constructor(options: PiAiAdapterOptions, private readonly requestRuntime: (signal?: AbortSignal) => AccountRuntime) { super(options) }
  override listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    return this.requestRuntime().adapter.listModels(provider)
  }
  override resolveModel(provider: string, model: string, signal?: AbortSignal): Promise<LlmResolvedModelInfo> {
    return this.requestRuntime(signal).adapter.resolveModel(provider, model, signal)
  }
  override prepareCall(provider: string, model: string, signal?: AbortSignal): Promise<PreparedAdapterCall> {
    return this.requestRuntime(signal).adapter.prepareCall(provider, model, signal)
  }
  override stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    return this.requestRuntime(options.signal).adapter.stream(options)
  }
}

/** Register services once; account switches affect the directory, not admitted turns. */
export function apply(ctx: Context, config: PreviewRouteConfig = {}): void {
  const runtimes = new Map<string, AccountRuntime>()
  const exclusionTurns = new ModelExclusionTurns()
  const freezeBinding = (binding: CopilotAccountBinding | undefined) => binding === undefined ? undefined
    : ctx.get('githubCopilotAccounts')?.host.captureAccount(binding.accountId) ?? binding
  const globalBinding = () => freezeBinding(activeCopilotBinding(ctx))
  const requestBinding = (signal?: AbortSignal) => ctx.get('githubCopilotSessionAccounts')?.requestBinding(signal) ?? globalBinding()
  let disposed = false
  let publishedDirectory = ''
  let publish = (): void => undefined
  const runtimeFor = (binding: CopilotAccountBinding | undefined): AccountRuntime => {
    if (disposed) throw failure('COPILOT_PREVIEW_DISPOSED', 'ABORTED')
    binding?.assertCurrent()
    const accountId = binding?.accountId ?? 'canonical'
    const current = runtimes.get(accountId)
    if (current !== undefined) return current
    // Do not evict prepared calls, discovery, or live Session proof owners.
    if (runtimes.size >= COPILOT_ACCOUNTS_MAX) throw failure('COPILOT_ACCOUNTS_RUNTIME_LIMIT', 'INVALID_REQUEST')
    const runtime = createAccountRuntime(ctx, config, binding, exclusionTurns, replayRecovery, () => {
      if (disposed) return
      // A broken default directory cannot invalidate a different admitted account.
      try { if ((globalBinding()?.accountId ?? 'canonical') === accountId) publish() }
      catch { ctx.logger.warn('COPILOT_PREVIEW_DIRECTORY_ACCOUNT_UNAVAILABLE') }
    })
    runtimes.set(accountId, runtime)
    return runtime
  }
  const currentRuntime = (signal?: AbortSignal) => runtimeFor(requestBinding(signal))
  const directoryRuntime = () => runtimeFor(globalBinding())
  const temporaryRecovery = installReplayRecovery(ctx, (agent?: Agent, request?: GenerateOptions) => {
    const accounts = ctx.get('githubCopilotSessionAccounts')
    const binding = agent !== undefined && accounts !== undefined
      ? accounts.bindingForAccount((accounts.turns.current(agent.session) ?? accounts.selected(agent)).accountId)
      : requestBinding(request?.signal)
    return runtimeFor(binding).proof()
  })
  const continuation = installSessionContinuation(ctx)
  const replayRecovery: ReturnType<typeof installReplayRecovery> = {
    prepare(request) {
      const portable = continuation.prepare(request)
      const temporary = temporaryRecovery.prepare(request)
      if (!portable) return temporary
      return { transform: portable, rejected: body => temporary?.rejected(body) }
    },
    dispose() { temporaryRecovery.dispose(); continuation.dispose() },
  }
  const initial = directoryRuntime()
  const registration = ctx.llm.registerAdapter([GITHUB_COPILOT_PREVIEW_PROVIDER_ID],
    new AccountRoutingAdapter(initial.optionsFor(), currentRuntime))
  publish = () => {
    const view = directoryRuntime().preview.getView()
    const directory = JSON.stringify({ account: globalBinding()?.accountId ?? 'canonical',
      models: view.models, available: view.available, configured: view.configured })
    if (directory === publishedDirectory || view.state === 'disposed') return
    publishedDirectory = directory
    registration.replace([GITHUB_COPILOT_PREVIEW_PROVIDER_ID])
  }
  const removeAutoRoute = installAutoModelRouting(ctx, {
    loadModels: signal => currentRuntime(signal).auto.loadModels(signal),
    classifyTask: (...args) => currentRuntime(args[1]).auto.classifyTask(...args),
    budgetPolicy: () => currentRuntime().auto.budgetPolicy(),
    parentModelBindings: () => currentRuntime().auto.parentModelBindings(),
    followParentModel: () => currentRuntime().auto.followParentModel(),
    semanticAssessment: () => currentRuntime().auto.semanticAssessment(),
    highCostModelIds: () => normalizeHighCostModelIds(config.accountModelSettings?.().highCostModelIds),
    allocationEvidence: () => config.accountModelSettings?.().autoAllocationEvidence !== false,
    assessmentDiagnostic: code => ctx.logger.warn(code),
    admitModel: (agent, turn, model, signal) => currentRuntime(signal).auto.admitModel(agent, turn, model, signal),
  })
  const pressureCallbacks = {
    resolve: (request: GenerateOptions) => currentRuntime(request.signal).pressureCallbacks.resolve(request),
  }
  installCopilotPreStepPressure(ctx, pressureCallbacks)
  installCopilotCompactionPressure(ctx, pressureCallbacks)
  ctx.provide('githubCopilotPreview', {
    getView: () => disposed ? initial.preview.getView() : currentRuntime().preview.getView(),
    refresh: async () => currentRuntime().preview.refresh(),
    discover: options => currentRuntime(options?.signal).preview.discover(options),
    recoveryLimits: (model, agent) => {
      const accounts = ctx.get('githubCopilotSessionAccounts')
      const binding = agent !== undefined && accounts !== undefined
        ? accounts.bindingForAccount((accounts.turns.current(agent.session) ?? accounts.selected(agent)).accountId)
        : requestBinding()
      const lease = runtimeFor(binding).preview.recoveryLimits(model)
      if (lease === undefined) return undefined
      return {
        ...lease,
        assertCurrent: () => {
          binding?.assertCurrent()
          if (agent !== undefined && accounts !== undefined
            && (accounts.turns.current(agent.session) ?? accounts.selected(agent)).accountId !== binding?.accountId) {
            throw new Error('COPILOT_MANUAL_RECOVERY_ACCOUNT_PROOF_CHANGED')
          }
          lease.assertCurrent()
        },
      }
    },
    routeFacts: model => currentRuntime().preview.routeFacts(model),
    captureSearchProof: () => currentRuntime().preview.captureSearchProof(),
    resolveRequestAuth: (model, signal) => currentRuntime(signal).preview.resolveRequestAuth(model, signal),
  })
  const removeStepListener = ctx.on('session/event', (session, event) => {
    if (event.type === 'step/start' || event.type === 'turn/end') {
      for (const runtime of runtimes.values()) runtime.lifetime.clearSessionRetries(session.id)
    }
    if (event.type === 'turn/end') exclusionTurns.end(session)
  })
  const removeListener = ctx.on('credentials/record-updated', key => {
    for (const [accountId, runtime] of runtimes) {
      const record = accountId === 'canonical' ? GITHUB_COPILOT_CREDENTIAL_KEY : `github-copilot/account-${accountId}`
      if (record === key) runtime.invalidate()
    }
  })
  const removeAccountListener = ctx.get('githubCopilotAccounts')?.host.onChanged(() => {
    publishedDirectory = ''
    try {
      publish()
      void directoryRuntime().preview.refresh().catch(() => undefined)
    } catch {
      registration.replace([GITHUB_COPILOT_PREVIEW_PROVIDER_ID])
      ctx.logger.warn('COPILOT_PREVIEW_DIRECTORY_ACCOUNT_UNAVAILABLE')
    }
  })
  let exclusionSignature = JSON.stringify([...excludedModelSet(config.accountModelSettings?.().excludedModelIds)])
  const removeSettings = onSettingsNamespaceUpdated(ctx, namespace => {
    if (namespace !== 'github-copilot') return
    const next = JSON.stringify([...excludedModelSet(config.accountModelSettings?.().excludedModelIds)])
    if (next === exclusionSignature) return
    exclusionSignature = next
    publishedDirectory = ''
    registration.replace([GITHUB_COPILOT_PREVIEW_PROVIDER_ID])
  })
  ctx.effect(() => () => {
    disposed = true
    for (const runtime of runtimes.values()) runtime.lifetime.dispose()
    runtimes.clear()
    removeStepListener()
    replayRecovery.dispose()
    removeListener()
    removeAccountListener?.()
    removeSettings()
    removeAutoRoute()
    registration()
  })
  void initial.preview.refresh().catch(() => undefined)
}

export default { name: 'github-copilot-preview', inject: ['llm', 'credentials'], apply }
