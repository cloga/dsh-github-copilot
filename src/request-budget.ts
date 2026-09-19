import type { AccountModelDescriptor } from './account-model-catalog.ts'

/** Managed-route admission and compaction defaults; these never replace catalog capacities. */
export interface RequestBudgetPolicy {
  /** Estimated framing/tokenization headroom deducted from admissible input, once. */
  readonly safetyTokens: number
  /** Fraction of hard input headroom used only by callers eligible for proactive compaction. */
  readonly pressureRatio: number
  /** Used only for compaction with no caller or adapter-resolved effort. */
  readonly compactionReasoning: 'prefer-low' | 'preserve'
}

/** The safety allowance matches the pinned native SDK; pressure is a separate opt-in check. */
export const DEFAULT_REQUEST_BUDGET_POLICY: Readonly<RequestBudgetPolicy> = Object.freeze({
  safetyTokens: 4096,
  pressureRatio: 0.9,
  compactionReasoning: 'prefer-low',
})

/** Validate deployment policy before applying defaults; unknown keys fail rather than silently drift. */
export function resolveRequestBudgetPolicy(config: Partial<RequestBudgetPolicy> = {}): Readonly<RequestBudgetPolicy> {
  const keys = new Set(['safetyTokens', 'pressureRatio', 'compactionReasoning'])
  for (const key of Object.keys(config)) {
    if (!keys.has(key)) throw new Error(`COPILOT_REQUEST_BUDGET_POLICY_INVALID: unknown setting ${key}`)
  }
  const safetyTokens = config.safetyTokens === undefined ? DEFAULT_REQUEST_BUDGET_POLICY.safetyTokens : config.safetyTokens
  const pressureRatio = config.pressureRatio === undefined ? DEFAULT_REQUEST_BUDGET_POLICY.pressureRatio : config.pressureRatio
  const compactionReasoning = config.compactionReasoning === undefined ? DEFAULT_REQUEST_BUDGET_POLICY.compactionReasoning : config.compactionReasoning
  if (!Number.isSafeInteger(safetyTokens) || safetyTokens < 0) {
    throw new Error('COPILOT_REQUEST_BUDGET_POLICY_INVALID: safetyTokens must be a non-negative safe integer')
  }
  if (!Number.isFinite(pressureRatio) || pressureRatio <= 0 || pressureRatio > 1) {
    throw new Error('COPILOT_REQUEST_BUDGET_POLICY_INVALID: pressureRatio must be greater than zero and at most one')
  }
  if (compactionReasoning !== 'prefer-low' && compactionReasoning !== 'preserve') {
    throw new Error('COPILOT_REQUEST_BUDGET_POLICY_INVALID: unsupported compactionReasoning')
  }
  return Object.freeze({ safetyTokens, pressureRatio, compactionReasoning })
}

export type RequestBudgetLimits = Pick<AccountModelDescriptor, 'contextWindow' | 'maxInputTokens' | 'maxTokens'>

/** A detached operational budget alongside, not in place of, the supplier capacities. */
export interface RequestBudget {
  readonly contextWindow: number
  readonly maxInputTokens?: number
  readonly maxOutputTokens: number
  /** Explicit request cap, or the model's output capability when the request omits one. */
  readonly outputReservation: number
  readonly hardInputLimit: number
  readonly pressureInputLimit: number
  readonly limitingFactor: 'prompt' | 'context'
}

export type RequestBudgetFailureCode =
  | 'COPILOT_REQUEST_INVALID_LIMITS'
  | 'COPILOT_REQUEST_INVALID_OUTPUT_LIMIT'
  | 'COPILOT_REQUEST_OUTPUT_LIMIT_EXCEEDED'
  | 'COPILOT_REQUEST_NO_INPUT_HEADROOM'
  | 'COPILOT_REQUEST_INVALID_ESTIMATE'
  | 'COPILOT_REQUEST_INPUT_LIMIT_EXCEEDED'
  | 'COPILOT_REQUEST_CONTEXT_LIMIT_EXCEEDED'
  | 'COPILOT_REQUEST_PRESSURE_EXCEEDED'

/** Owned diagnostics only; no credentials, request content, or provider error bodies. */
export interface RequestBudgetFailure {
  readonly ok: false
  readonly code: RequestBudgetFailureCode
  readonly message: string
}

export type RequestBudgetResult = Readonly<{ ok: true; budget: Readonly<RequestBudget> }> | RequestBudgetFailure
export type RequestBudgetAdmission = Readonly<{ ok: true }> | RequestBudgetFailure

function failure(code: RequestBudgetFailureCode, message: string): RequestBudgetFailure {
  return Object.freeze({ ok: false, code, message: `${code}: ${message}` })
}
function positiveInteger(value: number): boolean { return Number.isSafeInteger(value) && value > 0 }

/**
 * Reserve output under the combined context and independently enforce the prompt ceiling.
 * `policy` must come from resolveRequestBudgetPolicy; no caller cap or catalog object is changed.
 */
export function calculateRequestBudget(
  limits: RequestBudgetLimits,
  requestedMaxTokens?: number,
  policy: Readonly<RequestBudgetPolicy> = DEFAULT_REQUEST_BUDGET_POLICY,
): RequestBudgetResult {
  const { contextWindow, maxInputTokens, maxTokens } = limits
  if (!positiveInteger(contextWindow) || !positiveInteger(maxTokens)
    || maxInputTokens !== undefined && !positiveInteger(maxInputTokens)) {
    return failure('COPILOT_REQUEST_INVALID_LIMITS', 'model token capacities must be positive safe integers')
  }
  if (requestedMaxTokens !== undefined && !positiveInteger(requestedMaxTokens)) {
    return failure('COPILOT_REQUEST_INVALID_OUTPUT_LIMIT', 'request output cap must be a positive safe integer')
  }
  const outputReservation = requestedMaxTokens ?? maxTokens
  if (outputReservation > maxTokens) {
    return failure('COPILOT_REQUEST_OUTPUT_LIMIT_EXCEEDED', `request output cap ${outputReservation} exceeds model output capacity ${maxTokens}`)
  }
  const contextInputLimit = contextWindow - outputReservation
  const limitingFactor = maxInputTokens !== undefined && maxInputTokens <= contextInputLimit ? 'prompt' : 'context'
  const hardInputLimit = Math.min(maxInputTokens ?? contextInputLimit, contextInputLimit) - policy.safetyTokens
  if (hardInputLimit <= 0) {
    return failure('COPILOT_REQUEST_NO_INPUT_HEADROOM', 'output reservation and safety allowance leave no positive input budget')
  }
  return Object.freeze({ ok: true, budget: Object.freeze({
    contextWindow,
    ...maxInputTokens === undefined ? {} : { maxInputTokens },
    maxOutputTokens: maxTokens,
    outputReservation,
    hardInputLimit,
    pressureInputLimit: Math.floor(hardInputLimit * policy.pressureRatio),
    limitingFactor,
  }) })
}

/**
 * Check an estimated full prompt; estimates are not provider-exact token counts.
 * Enable pressure only for an owned ordinary loop call with a compaction recovery path.
 * Auxiliary and agentless calls use hard admission, including compaction itself.
 */
export function assessRequestBudget(
  estimatedInput: number,
  budget: Readonly<RequestBudget>,
  pressure = false,
): RequestBudgetAdmission {
  if (!Number.isFinite(estimatedInput) || estimatedInput < 0 || estimatedInput > Number.MAX_SAFE_INTEGER) {
    return failure('COPILOT_REQUEST_INVALID_ESTIMATE', 'estimated input must be finite, non-negative, and safely representable')
  }
  const input = Math.ceil(estimatedInput)
  if (input > budget.hardInputLimit) {
    return failure(budget.limitingFactor === 'prompt'
      ? 'COPILOT_REQUEST_INPUT_LIMIT_EXCEEDED' : 'COPILOT_REQUEST_CONTEXT_LIMIT_EXCEEDED',
    `estimated input ${input} exceeds input budget ${budget.hardInputLimit} with output reservation ${budget.outputReservation}`)
  }
  if (pressure && input > budget.pressureInputLimit) {
    return failure('COPILOT_REQUEST_PRESSURE_EXCEEDED', `estimated input ${input} exceeds proactive compaction budget ${budget.pressureInputLimit}`)
  }
  return Object.freeze({ ok: true })
}

/**
 * Select a low-cost supported effort only for a caller-confirmed compaction request.
 * A supplied effort, including a materialized provider default, wins unchanged; native validation
 * remains authoritative. Unsupported low-cost controls preserve the provider default, never off/none.
 */
export function selectCompactionReasoning<Effort extends string>(
  supportedEfforts: readonly Effort[],
  requestedEffort?: Effort,
  mode: RequestBudgetPolicy['compactionReasoning'] = DEFAULT_REQUEST_BUDGET_POLICY.compactionReasoning,
): Effort | undefined {
  if (requestedEffort !== undefined || mode === 'preserve') return requestedEffort
  return supportedEfforts.find(effort => effort === 'minimal') ?? supportedEfforts.find(effort => effort === 'low')
}
