import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
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
import type { GitHubCopilotOAuthCredential } from './copilot-grant.ts'
import { GITHUB_COPILOT_CREDENTIAL_KEY, GITHUB_COPILOT_PREVIEW_PROVIDER_ID } from './copilot-identity.ts'
import { abortable } from './http.ts'
import { accountModelFromDescriptor, copilotPublicHeaders, createAccountProvider } from './preview-provider.ts'
import type { AccountProviderGuard } from './preview-provider.ts'
import { ACCOUNT_MODEL_AUTH_MIN_VALIDITY_MS, copilotAccountKey, copilotEntitlementKey, createAccountModelAuth } from './account-model-auth.ts'
import { createAccountModelSource } from './account-model-source.ts'
import type { AccountModelLoadOptions, AccountModelSnapshot, AccountModelSource } from './account-model-source.ts'
import type { AccountModelDescriptor, AccountModelRejection } from './account-model-catalog.ts'
import type { InlineConfig } from './config.ts'
import { assessRequestBudget, calculateRequestBudget, resolveRequestBudgetPolicy, selectCompactionReasoning } from './request-budget.ts'
import type { RequestBudgetFailure, RequestBudgetPolicy } from './request-budget.ts'
import { installCopilotCompactionPressure } from './compaction-pressure.ts'

/** Safe request knobs; identities, model tables, endpoints and credentials are not configurable. */
export type PreviewRouteConfig = Pick<PiAiProviderProfile,
  'reasoning' | 'cacheRetention' | 'transport' | 'timeoutMs' | 'websocketConnectTimeoutMs'
  | 'streamIdleTimeoutMs' | 'maxRequestImageBytes' | 'requestImagePixelBudget' | 'requestImageMaxBytes' | 'retryPolicy'>
  & Pick<InlineConfig, 'accountModelTtlMs' | 'accountModelFailureCooldownMs'>
  & {
    readonly accountModelSettings?: () => Pick<InlineConfig, 'accountModelTtlMs' | 'accountModelFailureCooldownMs'>
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
function tokenFingerprint(value: string): string { return createHash('sha256').update(value).digest('hex') }
function owned(provider: string): void {
  if (provider !== GITHUB_COPILOT_PREVIEW_PROVIDER_ID) throw failure('COPILOT_PREVIEW_MODEL_MISMATCH', 'UNKNOWN_MODEL')
}
interface Proof { readonly accountKey: string; readonly entitlementKey: string; readonly tokenFingerprint: string; readonly baseURL: string; readonly expires: number }
/** A read may advance only its own revision when it observes a real invalidation. */
interface CredentialReadTicket { revision: number }
interface Lease {
  readonly snapshot: AccountModelSnapshot
  readonly descriptor: AccountModelDescriptor
  readonly proof: Proof
  readonly revision: number
  readonly signal: AbortSignal
  started: boolean
}

class PreviewLifetime {
  readonly controller = new AbortController()
  private readonly wires = new Set<AbortController>()
  revision = 0
  private active = true
  constructor(readonly credentials: CredentialStore, readonly source: AccountModelSource,
    readonly proofFor: (snapshot: AccountModelSnapshot) => Proof | undefined,
    private readonly displayProofFor: (snapshot: AccountModelSnapshot) => Proof | undefined) {}
  assertActive(): void { if (!this.active) throw failure('COPILOT_PREVIEW_DISPOSED', 'ABORTED') }
  isCurrent(revision: number): boolean { return this.active && revision === this.revision }
  change(): void {
    this.assertActive()
    this.revision++
    this.source.invalidate()
    for (const wire of this.wires) wire.abort(failure('COPILOT_PREVIEW_CREDENTIAL_CHANGED', 'ABORTED'))
  }
  dispose(): void {
    if (!this.active) return
    this.active = false
    this.source.dispose()
    this.controller.abort(failure('COPILOT_PREVIEW_DISPOSED', 'ABORTED'))
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
    try { credential = await abortable(this.credentials.read(GITHUB_COPILOT_PREVIEW_PROVIDER_ID), signal) }
    catch {
      this.assertActive()
      if (signal.aborted) throw failure('COPILOT_PREVIEW_ABORTED', 'ABORTED')
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
    const descriptor = snapshot.models.find(item => item.id === model)
    if (descriptor === undefined) throw failure('COPILOT_PREVIEW_MODEL_NOT_ENTITLED', 'UNKNOWN_MODEL')
    const proof = this.proofFor(snapshot)
    if (proof === undefined) throw failure('COPILOT_PREVIEW_METADATA_STALE')
    const lease: Lease = { snapshot, descriptor, proof, revision: this.revision, signal: combined, started: false }
    this.entitled(lease, grant, model)
    return lease
  }
  private account(lease: Lease | undefined, grant: GitHubCopilotOAuthCredential): asserts lease is Lease {
    this.assertActive()
    if (lease === undefined || copilotAccountKey(grant) !== lease.proof.accountKey) throw failure('COPILOT_PREVIEW_ACCOUNT_CHANGED')
  }
  private entitled(lease: Lease | undefined, grant: GitHubCopilotOAuthCredential, model: string): void {
    this.account(lease, grant)
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
    lease.started = true
  }
  guard(lease?: Lease): AccountProviderGuard {
    return {
      signal: lease?.signal ?? this.controller.signal,
      ...lease === undefined ? {} : { selectedModelId: lease.descriptor.id },
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
  const parsed = PiAiConfig({ providers: { [GITHUB_COPILOT_PREVIEW_PROVIDER_ID]: { ...config, api: 'openai-responses' } } })
    .providers?.[GITHUB_COPILOT_PREVIEW_PROVIDER_ID]
  if (parsed === undefined) throw failure('COPILOT_PREVIEW_CONFIG_UNAVAILABLE', 'INVALID_REQUEST')
  const positive = (value: number | undefined): number => {
    if (value === undefined || !Number.isFinite(value) || value <= 0) throw failure('COPILOT_PREVIEW_CONFIG_DEFAULTS_UNAVAILABLE', 'INVALID_REQUEST')
    return value
  }
  return Object.freeze({
    ...config,
    provider: GITHUB_COPILOT_PREVIEW_PROVIDER_ID, displayName: 'GitHub Copilot', piProvider: provider,
    streamIdleTimeoutMs: positive(parsed.streamIdleTimeoutMs), maxRequestImageBytes: positive(parsed.maxRequestImageBytes),
    requestImagePixelBudget: positive(parsed.requestImagePixelBudget), requestImageMaxBytes: positive(parsed.requestImageMaxBytes),
    retryPolicy: resolveRetryPolicy(parsed.retryPolicy, 'github-copilot-preview'), configuredMaxTokens: new Map<string, number>(),
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
    private readonly optionsFor: (lease?: Lease, inspectRequest?: AccountProviderGuard['inspectRequest']) => PiAiAdapterOptions,
    private readonly discoverSnapshot: (options?: AccountModelLoadOptions) => Promise<AccountModelSnapshot>,
    private readonly refreshRejected: (snapshot: AccountModelSnapshot, signal?: AbortSignal, missingOnly?: boolean) => Promise<void>,
    private readonly requestBudgetSettings: () => Partial<RequestBudgetPolicy>,
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
      return snapshot.models.map(model => ({ provider, id: model.id, name: model.name, inputModalities: [...model.input] }))
    } catch { return [] }
  }
  override async resolveModel(provider: string, model: string, signal?: AbortSignal): Promise<LlmResolvedModelInfo> {
    owned(provider)
    const cached = this.lifetime.source.readSnapshot()
    const snapshot = await this.discoverSnapshot({ signal })
    const lease = await this.lease(snapshot, model, signal, cached === snapshot)
    return this.withRecovery(snapshot, signal, () => new PiAiAdapter(this.optionsFor(lease)).resolveModel(provider, model, signal))
  }
  override async prepareCall(provider: string, model: string, signal?: AbortSignal): Promise<PreparedAdapterCall> {
    owned(provider)
    const cached = this.lifetime.source.readSnapshot()
    const snapshot = await this.discoverSnapshot({ signal })
    const lease = await this.lease(snapshot, model, signal, cached === snapshot)
    const prepared = await this.withRecovery(snapshot, signal, () => new PiAiAdapter(this.optionsFor(lease)).prepareCall(provider, model, signal))
    return { model: prepared.model, stream: options => this.guardedStream(lease, options) }
  }
  override stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const owner = this
    return (async function* () {
      owned(options.provider)
      const cached = owner.lifetime.source.readSnapshot()
      const snapshot = await owner.discoverSnapshot({ signal: options.signal })
      const lease = await owner.lease(snapshot, options.model, options.signal, cached === snapshot)
      yield* owner.guardedStream(lease, options)
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
      owner.lifetime.start(lease)
      owned(options.provider)
      if (options.model !== lease.descriptor.id) throw failure('COPILOT_PREVIEW_MODEL_MISMATCH')
      const signal = AbortSignal.any([lease.signal, ...options.signal === undefined ? [] : [options.signal]])
      if (signal.aborted) throw failure('COPILOT_PREVIEW_ABORTED', 'ABORTED')
      const policy = resolveRequestBudgetPolicy(owner.requestBudgetSettings())
      const model = accountModelFromDescriptor(lease.descriptor, lease.proof.baseURL)
      if (options.reasoningEffort !== undefined) {
        const mapping = Object.entries(model.thinkingLevelMap ?? {}).find(([level]) => level === options.reasoningEffort)?.[1]
        if (typeof mapping !== 'string' || mapping.length === 0) throw failure('COPILOT_PREVIEW_REASONING_UNSUPPORTED', 'INVALID_REQUEST')
      }
      // SDK lazyStream retains only error text. Keep an owned failure in this exact
      // dispatch closure, never on the shared lease, to restore its structured code.
      let admissionFailure: LlmError | undefined
      const inspectRequest: NonNullable<AccountProviderGuard['inspectRequest']> = (_model, context, nativeOptions) => {
        if (signal.aborted) throw failure('COPILOT_PREVIEW_ABORTED', 'ABORTED')
        const calculated = calculateRequestBudget(lease.descriptor, nativeOptions?.maxTokens, policy)
        if (!calculated.ok) {
          admissionFailure = budgetFailure(calculated)
          throw admissionFailure
        }
        // A previous usage anchor can omit changed system/tool prefixes. Price the
        // current prefix and every message independently as a second lower bound.
        const prefix = estimateContextTokens({ messages: [],
          ...context.systemPrompt === undefined ? {} : { systemPrompt: context.systemPrompt },
          ...context.tools === undefined ? {} : { tools: context.tools },
        }).tokens
        const fresh = context.messages.reduce((tokens, message) => tokens + estimateMessageTokens(message), prefix)
        const estimate = Math.max(estimateContextTokens(context).tokens, fresh)
        const admitted = assessRequestBudget(estimate, calculated.budget)
        if (!admitted.ok) {
          admissionFailure = budgetFailure(admitted)
          throw admissionFailure
        }
      }
      try {
        // Same immutable descriptor/profile generation, but request-local provider
        // callbacks: concurrent compaction and chat cannot share purpose or errors.
        const native = new PiAiAdapter(owner.optionsFor(lease, inspectRequest))
        const prepared = await native.prepareCall(options.provider, options.model, signal)
        const suppliedEffort = options.reasoningEffort ?? prepared.model.reasoning?.defaultEffort
        const effort = options.purpose === 'compaction'
          ? selectCompactionReasoning<string>(getSupportedThinkingLevels(model), suppliedEffort, policy.compactionReasoning)
          : suppliedEffort
        const request = { ...options, signal,
          ...effort === undefined ? {} : { reasoningEffort: ReasoningEffortId(effort) },
        }
        for await (const chunk of native.stream(request)) {
          if (admissionFailure !== undefined) {
            if (signal.aborted) throw failure('COPILOT_PREVIEW_ABORTED', 'ABORTED')
            throw admissionFailure
          }
          if (chunk.type === 'finish' && chunk.reason.kind === 'error' && chunk.reason.failure.code === 'UNKNOWN_MODEL') {
            await owner.refreshRejected(lease.snapshot, signal)
          }
          yield chunk
        }
        if (admissionFailure !== undefined) throw admissionFailure
      } catch (cause) {
        if (signal.aborted) throw failure('COPILOT_PREVIEW_ABORTED', 'ABORTED')
        if (cause instanceof LlmError && cause.code === 'UNKNOWN_MODEL') await owner.refreshRejected(lease.snapshot, signal)
        throw admissionFailure ?? cause
      }
    })()
  }
}

/** Register one stable account route; attach/status remain network-free. */
export function apply(ctx: Context, config: PreviewRouteConfig = {}): void {
  const { accountModelTtlMs, accountModelFailureCooldownMs, accountModelSettings,
    requestBudget, requestBudgetSettings, ...requestConfig } = config
  const cacheSettings = accountModelSettings ?? (() => ({ accountModelTtlMs, accountModelFailureCooldownMs }))
  const budgetSettings = requestBudgetSettings ?? (() => requestBudget ?? {})
  resolveRequestBudgetPolicy(budgetSettings())
  const store = createGitHubCopilotCredentialStore(ctx, GITHUB_COPILOT_PREVIEW_PROVIDER_ID)
  let rejectedAuth: Proof | undefined
  let authRecovery: { readonly accountKey: string; readonly at: number } | undefined
  const nativeAuth = createAccountModelAuth(createGitHubCopilotCredentialStore(ctx), grant => {
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
        const stored = await store.read(GITHUB_COPILOT_PREVIEW_PROVIDER_ID)
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
  const lifetime = new PreviewLifetime(store, source, proofFor, displayProofFor)
  // Empty provider is used only for registry metadata/config validation, never requests.
  const template = resolvedProfile(createAccountProvider([], lifetime.guard(), 'https://api.individual.githubcopilot.com').provider, requestConfig)
  let configured = false
  let readError: string | undefined
  let publishedDirectory = ''
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
  let notify = (): void => undefined
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
  const optionsFor = (lease?: Lease, inspectRequest?: AccountProviderGuard['inspectRequest']): PiAiAdapterOptions => {
    const guard: AccountProviderGuard = { ...lifetime.guard(lease), ...inspectRequest === undefined ? {} : { inspectRequest },
      onUnauthorized() {
        // A late response from before sign-in, refresh or disposal cannot retire
        // a newer credential. This synchronous fence precedes every state change.
        if (lease === undefined || !lifetime.isCurrent(lease.revision)
          || provenSnapshot !== lease.snapshot || snapshotProof !== lease.proof) return
        rejectedAuth = lease.proof
        lifetime.change()
        provenSnapshot = undefined; snapshotProof = undefined; lastValidatedProof = undefined
        // No auth/discovery here and no replay. Native renewal belongs to the
        // next independent caller through the shared discovery single flight.
      },
    }
    const { provider } = createAccountProvider(lease?.snapshot.models ?? [], guard, lease?.proof.baseURL ?? 'https://api.individual.githubcopilot.com')
    const profile = Object.freeze({ ...template, piProvider: provider })
    const profiles = new Map([[GITHUB_COPILOT_PREVIEW_PROVIDER_ID, profile]])
    return { profiles: () => profiles, resolveApiKey: async () => { lifetime.assertActive(); return undefined },
      auth: { credentials: store, authContext: { env: async () => undefined, fileExists: async () => false } },
      resolveAttachments: () => ctx.get('attachments'),
      resolveImageAccess: (attachments, ref) => resolveImageAttachmentAccess(attachments, hostPath => ctx.get('fs')?.processPathFromHostPath(hostPath), ref),
    }
  }
  const registration = ctx.llm.registerAdapter([GITHUB_COPILOT_PREVIEW_PROVIDER_ID], new PreviewAdapter(lifetime, optionsFor, discoverSnapshot, refreshRejected, budgetSettings))
  installCopilotCompactionPressure(ctx, { resolve(request) {
    const snapshot = source.readSnapshot()
    if (snapshot === undefined || proofFor(snapshot) === undefined) return undefined
    const descriptor = snapshot.models.find(model => model.id === request.model)
    if (descriptor === undefined) return undefined
    const result = calculateRequestBudget(descriptor, request.maxTokens, resolveRequestBudgetPolicy(budgetSettings()))
    return result.ok ? { inputBudgetTokens: result.budget.pressureInputLimit } : undefined
  } })
  notify = () => {
    const view = getView()
    // These are small owned DTOs, not live Cordis objects or credential records.
    const directory = JSON.stringify({ models: view.models, available: view.available, configured: view.configured })
    if (directory === publishedDirectory || view.state === 'disposed') return
    publishedDirectory = directory
    registration.replace([GITHUB_COPILOT_PREVIEW_PROVIDER_ID])
  }
  ctx.provide('githubCopilotPreview', { getView, refresh,
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
  } })
  const removeListener = ctx.on('credentials/record-updated', key => {
    if (key !== GITHUB_COPILOT_CREDENTIAL_KEY) return
    lifetime.change(); provenSnapshot = undefined; snapshotProof = undefined; lastValidatedProof = undefined
    void refresh().catch(() => undefined)
  })
  ctx.effect(() => () => { lifetime.dispose(); removeListener(); registration() })
  void refresh().catch(() => undefined)
}

export default { name: 'github-copilot-preview', inject: ['llm', 'credentials'], apply }
