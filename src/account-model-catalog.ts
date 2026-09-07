/** Pure normalization of account /models metadata; no transport, credentials, or model-name rules. */
export const ACCOUNT_MODEL_CATALOG_LIMITS = Object.freeze({
  maxBytes: 2 * 1024 * 1024,
  maxModels: 512,
  maxIdLength: 200,
  maxNameLength: 256,
  maxEndpoints: 16,
  maxEndpointLength: 128,
  maxEfforts: 32,
  maxEffortLength: 64,
  maxMediaTypes: 32,
})

export type AccountModelApi = 'anthropic-messages' | 'openai-responses' | 'openai-completions'
export type AccountModelHttpEndpoint = '/v1/messages' | '/responses' | '/chat/completions'
type RecognizedEndpoint = AccountModelHttpEndpoint | 'ws:/responses'

/** Advertised data only; consumers must not turn unfamiliar labels into supported Core controls. */
export interface AccountModelReasoning {
  readonly advertisedEfforts: readonly string[]
  readonly unmappedEfforts: readonly string[]
  readonly adaptiveThinking?: boolean
  readonly minThinkingBudget?: number
  readonly maxThinkingBudget?: number
}

export interface AccountModelDescriptor {
  readonly id: string
  readonly name: string
  readonly api: AccountModelApi
  readonly contextWindow: number
  /** Independent server prompt limit; absence is not replaced with the context window. */
  readonly maxInputTokens?: number
  readonly maxTokens: number
  readonly input: readonly ('text' | 'image')[]
  readonly reasoning: AccountModelReasoning
  readonly evidence: {
    /** Recognized endpoint literals only, never arbitrary URLs or query strings. */
    readonly endpoints: readonly RecognizedEndpoint[]
    readonly unsupportedEndpointCount: number
    readonly selectedEndpoint: AccountModelHttpEndpoint
    readonly apiSource: 'advertised-native' | 'advertised-priority'
    readonly policySource: 'server-enabled' | 'account-available-id'
    readonly contextWindowSource: 'max_context_window_tokens' | 'max_prompt_tokens'
    readonly visionMediaTypes?: readonly string[]
  }
}

export interface AccountModelRejection { readonly id?: string; readonly code: string }
export interface AccountModelCatalog {
  readonly models: readonly AccountModelDescriptor[]
  readonly rejected: readonly AccountModelRejection[]
}
export interface AccountModelCatalogOptions {
  readonly nativeApis?: ReadonlyMap<string, string>
  /** Proof supplied by the account-bound caller; used only when policy is absent. */
  readonly availableModelIds?: ReadonlySet<string>
}

// Prefer the richer native message protocol, then Responses, then the generic
// completions fallback. The server must advertise every selected endpoint.
const protocols: readonly { readonly api: AccountModelApi; readonly endpoint: AccountModelHttpEndpoint }[] = [
  { api: 'anthropic-messages', endpoint: '/v1/messages' },
  { api: 'openai-responses', endpoint: '/responses' },
  { api: 'openai-completions', endpoint: '/chat/completions' },
]
const knownEfforts = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
const controls = /[\p{Cc}\p{Cf}\u2028\u2029]/u
const identifier = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u
const encoder = new TextEncoder()

class CatalogProblem extends Error {
  constructor(readonly code: string, readonly fatal = false) { super(code) }
}
function fail(code: string, fatal = false): never { throw new CatalogProblem(code, fatal) }

class Budget {
  private consumed = 0
  charge(bytes: number): void {
    this.consumed += bytes
    if (this.consumed > ACCOUNT_MODEL_CATALOG_LIMITS.maxBytes) fail('CATALOG_TOO_LARGE', true)
  }
}

function record(value: unknown, code: string): object {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(code)
  return value
}

/** Read only an explicitly named own data property, without executing getters or copying extras. */
function dataProperty(value: object, key: string, budget: Budget): PropertyDescriptor | undefined {
  budget.charge(16)
  const descriptor = Object.getOwnPropertyDescriptor(value, key)
  if (descriptor !== undefined && !Object.hasOwn(descriptor, 'value')) fail('UNREADABLE_FIELD')
  return descriptor
}

function field(value: object, key: string, budget: Budget): unknown {
  const result: unknown = dataProperty(value, key, budget)?.value
  return result
}

function text(value: unknown, maxLength: number, code: string, budget: Budget): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength
    || value.trim() !== value || controls.test(value)) fail(code)
  budget.charge(encoder.encode(value).byteLength)
  return value
}

function positive(value: unknown, code: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) fail(code)
  return value
}

function optionalPositive(parent: object, key: string, code: string, budget: Budget): number | undefined {
  const descriptor = dataProperty(parent, key, budget)
  return descriptor === undefined ? undefined : positive(descriptor.value, code)
}

function stringList(value: unknown, maxItems: number, maxLength: number, code: string, budget: Budget): string[] {
  if (!Array.isArray(value)) fail(code)
  const length = field(value, 'length', budget)
  if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0 || length > maxItems) fail(code)
  const strings = new Set<string>()
  for (let index = 0; index < length; index++) {
    strings.add(text(field(value, String(index), budget), maxLength, code, budget))
  }
  return [...strings].sort()
}

function recognizedEndpoint(value: string): value is RecognizedEndpoint {
  return value === '/v1/messages' || value === '/responses' || value === '/chat/completions' || value === 'ws:/responses'
}

function normalizeModel(raw: object, id: string, options: AccountModelCatalogOptions, budget: Budget): AccountModelDescriptor {
  const rawName = field(raw, 'name', budget)
  const name = rawName === undefined ? id : text(rawName, ACCOUNT_MODEL_CATALOG_LIMITS.maxNameLength, 'INVALID_NAME', budget)
  const picker = field(raw, 'model_picker_enabled', budget)
  if (picker === false) fail('PICKER_DISABLED')
  if (picker !== true) fail('INVALID_PICKER_STATE')

  const rawPolicy = field(raw, 'policy', budget)
  let policySource: AccountModelDescriptor['evidence']['policySource']
  if (rawPolicy === undefined) {
    if (options.availableModelIds?.has(id) !== true) fail('MISSING_POLICY')
    policySource = 'account-available-id'
  } else {
    const policy = record(rawPolicy, 'INVALID_POLICY')
    const state = text(field(policy, 'state', budget), 64, 'INVALID_POLICY', budget)
    if (state !== 'enabled') fail('POLICY_NOT_ENABLED')
    policySource = 'server-enabled'
  }

  const capabilities = record(field(raw, 'capabilities', budget), 'INVALID_CAPABILITIES')
  const supports = record(field(capabilities, 'supports', budget), 'INVALID_SUPPORTS')
  const streaming = field(supports, 'streaming', budget)
  if (streaming === false) fail('STREAMING_UNSUPPORTED')
  if (streaming !== true) fail('INVALID_SUPPORTS')
  const tools = field(supports, 'tool_calls', budget)
  if (tools === false) fail('TOOLS_UNSUPPORTED')
  if (tools !== true) fail('INVALID_SUPPORTS')
  const vision = field(supports, 'vision', budget)
  if (vision !== undefined && typeof vision !== 'boolean') fail('INVALID_VISION_SUPPORT')

  const rawEndpoints = field(raw, 'supported_endpoints', budget)
  if (rawEndpoints === undefined) fail('MISSING_ENDPOINTS')
  const allEndpoints = stringList(rawEndpoints, ACCOUNT_MODEL_CATALOG_LIMITS.maxEndpoints,
    ACCOUNT_MODEL_CATALOG_LIMITS.maxEndpointLength, 'INVALID_ENDPOINTS', budget)
  if (allEndpoints.length === 0) fail('MISSING_ENDPOINTS')
  const endpoints = allEndpoints.filter(recognizedEndpoint)
  const unsupportedEndpointCount = allEndpoints.length - endpoints.length
  const nativeApi = options.nativeApis?.get(id)
  const native = protocols.find(protocol => protocol.api === nativeApi && endpoints.includes(protocol.endpoint))
  const selected = native ?? protocols.find(protocol => endpoints.includes(protocol.endpoint))
  if (selected === undefined) {
    fail(unsupportedEndpointCount === 0 && endpoints.includes('ws:/responses') ? 'WEBSOCKET_ONLY' : 'UNSUPPORTED_ENDPOINTS')
  }

  const rawLimits = field(capabilities, 'limits', budget)
  if (rawLimits === undefined) fail('MISSING_LIMITS')
  const limits = record(rawLimits, 'INVALID_LIMITS')
  const maxContext = optionalPositive(limits, 'max_context_window_tokens', 'INVALID_LIMITS', budget)
  const maxInputTokens = optionalPositive(limits, 'max_prompt_tokens', 'INVALID_LIMITS', budget)
  if (maxContext === undefined && maxInputTokens === undefined) fail('MISSING_CONTEXT_LIMIT')
  const maxTokens = optionalPositive(limits, 'max_output_tokens', 'INVALID_LIMITS', budget)
  if (maxTokens === undefined) fail('MISSING_OUTPUT_LIMIT')

  const rawEfforts = field(supports, 'reasoning_effort', budget)
  const efforts = rawEfforts === undefined ? [] : stringList(rawEfforts, ACCOUNT_MODEL_CATALOG_LIMITS.maxEfforts,
    ACCOUNT_MODEL_CATALOG_LIMITS.maxEffortLength, 'INVALID_REASONING', budget)
  const adaptiveThinking = field(supports, 'adaptive_thinking', budget)
  if (adaptiveThinking !== undefined && typeof adaptiveThinking !== 'boolean') fail('INVALID_REASONING')
  const minThinkingBudget = optionalPositive(supports, 'min_thinking_budget', 'INVALID_REASONING', budget)
  const maxThinkingBudget = optionalPositive(supports, 'max_thinking_budget', 'INVALID_REASONING', budget)
  if (minThinkingBudget !== undefined && maxThinkingBudget !== undefined && minThinkingBudget > maxThinkingBudget) fail('INVALID_REASONING')

  let visionMediaTypes: readonly string[] | undefined
  let imageInput = vision === true
  if (vision === true) {
    const rawVisionLimits = field(limits, 'vision', budget)
    if (rawVisionLimits !== undefined) {
      const visionLimits = record(rawVisionLimits, 'INVALID_VISION_LIMITS')
      const rawMediaTypes = field(visionLimits, 'supported_media_types', budget)
      if (rawMediaTypes !== undefined) {
        const mediaTypes = stringList(rawMediaTypes, ACCOUNT_MODEL_CATALOG_LIMITS.maxMediaTypes, 128, 'INVALID_VISION_LIMITS', budget)
        // Bare MIME types may describe documents too. Preserve only image
        // evidence here; document projection remains the existing Core owner's job.
        const mime = /^[a-z0-9][a-z0-9!#$%&'*+.^_`|~-]*\/[a-z0-9][a-z0-9!#$%&'*+.^_`|~-]*$/iu
        if (mediaTypes.length === 0 || mediaTypes.some(value => !mime.test(value))) fail('INVALID_VISION_LIMITS')
        visionMediaTypes = Object.freeze([...new Set(mediaTypes.map(value => value.toLowerCase())
          .filter(value => value.startsWith('image/')))].sort())
        imageInput = visionMediaTypes.length > 0
      }
    }
  }

  return Object.freeze({
    id, name, api: selected.api,
    contextWindow: maxContext ?? maxInputTokens!,
    ...maxInputTokens === undefined ? {} : { maxInputTokens },
    maxTokens,
    input: Object.freeze(imageInput ? ['text', 'image'] as const : ['text'] as const),
    reasoning: Object.freeze({
      advertisedEfforts: Object.freeze(efforts),
      unmappedEfforts: Object.freeze(efforts.filter(effort => !knownEfforts.has(effort))),
      ...adaptiveThinking === undefined ? {} : { adaptiveThinking },
      ...minThinkingBudget === undefined ? {} : { minThinkingBudget },
      ...maxThinkingBudget === undefined ? {} : { maxThinkingBudget },
    }),
    evidence: Object.freeze({
      endpoints: Object.freeze(endpoints), unsupportedEndpointCount,
      selectedEndpoint: selected.endpoint,
      apiSource: native === undefined ? 'advertised-priority' as const : 'advertised-native' as const,
      policySource,
      contextWindowSource: maxContext === undefined ? 'max_prompt_tokens' as const : 'max_context_window_tokens' as const,
      ...visionMediaTypes === undefined ? {} : { visionMediaTypes },
    }),
  })
}

function result(models: AccountModelDescriptor[], rejected: AccountModelRejection[]): AccountModelCatalog {
  return Object.freeze({ models: Object.freeze(models), rejected: Object.freeze(rejected.map(entry => Object.freeze(entry))) })
}

/**
 * Normalize an account-bound /models response without model-name inference.
 * JSON text is byte-bounded before parsing. Already-parsed objects have a
 * bounded known-field work budget; unknown fields are deliberately not visited,
 * so callers accepting objects must also bound the original transport body.
 * Returned candidates do not replace request-time OAuth/account checks.
 */
export function normalizeAccountModelCatalog(raw: unknown, options: AccountModelCatalogOptions = {}): AccountModelCatalog {
  const budget = new Budget()
  try {
    if (typeof raw === 'string') {
      if (raw.length > ACCOUNT_MODEL_CATALOG_LIMITS.maxBytes || encoder.encode(raw).byteLength > ACCOUNT_MODEL_CATALOG_LIMITS.maxBytes) fail('CATALOG_TOO_LARGE', true)
      try { raw = JSON.parse(raw) as unknown } catch { fail('INVALID_JSON', true) }
    }
    const root = record(raw, 'INVALID_CATALOG')
    const data = field(root, 'data', budget)
    if (!Array.isArray(data)) fail('INVALID_CATALOG')
    const count = field(data, 'length', budget)
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) fail('INVALID_CATALOG')
    if (count > ACCOUNT_MODEL_CATALOG_LIMITS.maxModels) fail('TOO_MANY_MODELS', true)
    const models = new Map<string, AccountModelDescriptor>()
    const seen = new Map<string, string | undefined>()
    const conflicts = new Set<string>()
    const rejected: AccountModelRejection[] = []
    const conflict = (id: string): void => {
      models.delete(id)
      seen.set(id, undefined)
      if (!conflicts.has(id)) { conflicts.add(id); rejected.push({ id, code: 'DUPLICATE_CONFLICT' }) }
    }
    for (let index = 0; index < count; index++) {
      let id: string | undefined
      try {
        const candidate = record(field(data, String(index), budget), 'INVALID_MODEL')
        const candidateId = text(field(candidate, 'id', budget), ACCOUNT_MODEL_CATALOG_LIMITS.maxIdLength, 'INVALID_ID', budget)
        if (!identifier.test(candidateId)) fail('INVALID_ID')
        id = candidateId
        const model = normalizeModel(candidate, id, options, budget)
        // Serialize only our own bounded descriptor, never the API object.
        const signature = JSON.stringify(model)
        if (seen.has(id)) {
          if (seen.get(id) !== signature) conflict(id)
        } else {
          seen.set(id, signature)
          models.set(id, model)
        }
      } catch (error) {
        if (error instanceof CatalogProblem && error.fatal) throw error
        const code = error instanceof CatalogProblem ? error.code : 'UNREADABLE_MODEL'
        if (id !== undefined && seen.has(id)) conflict(id)
        else {
          if (id !== undefined) seen.set(id, undefined)
          rejected.push({ ...id === undefined ? {} : { id }, code })
        }
      }
    }
    return result([...models.values()], rejected)
  } catch (error) {
    return result([], [{ code: error instanceof CatalogProblem ? error.code : 'INVALID_CATALOG' }])
  }
}
