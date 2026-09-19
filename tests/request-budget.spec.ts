import { describe, expect, it } from 'vitest'
import {
  assessRequestBudget, calculateRequestBudget, DEFAULT_REQUEST_BUDGET_POLICY,
  resolveRequestBudgetPolicy, selectCompactionReasoning,
} from '../src/request-budget.ts'
import type { RequestBudgetLimits } from '../src/request-budget.ts'

const noMargins = resolveRequestBudgetPolicy({ safetyTokens: 0, pressureRatio: 1 })
const limits = Object.freeze({ contextWindow: 64_000, maxInputTokens: 32_000, maxTokens: 8_000 })
function budget(model: RequestBudgetLimits = limits, requestedMaxTokens?: number, policy = noMargins) {
  const result = calculateRequestBudget(model, requestedMaxTokens, policy)
  if (!result.ok) throw new Error(result.code)
  return result.budget
}

describe('managed request budget policy', () => {
  it('centralizes immutable defaults and distinguishes safety from proactive pressure margin', () => {
    expect(DEFAULT_REQUEST_BUDGET_POLICY).toEqual({ safetyTokens: 4096, pressureRatio: 0.9, compactionReasoning: 'prefer-low' })
    expect(resolveRequestBudgetPolicy()).toEqual(DEFAULT_REQUEST_BUDGET_POLICY)
    expect(Object.isFrozen(DEFAULT_REQUEST_BUDGET_POLICY)).toBe(true)
    const policy = resolveRequestBudgetPolicy({ safetyTokens: 1 })
    expect(policy).toEqual({ ...DEFAULT_REQUEST_BUDGET_POLICY, safetyTokens: 1 })
    expect(Object.isFrozen(policy)).toBe(true)
  })
  it.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])('rejects invalid policy token counts: %s', value => {
    expect(() => resolveRequestBudgetPolicy({ safetyTokens: value })).toThrow('COPILOT_REQUEST_BUDGET_POLICY_INVALID')
  })
  it.each([0, -1, 1.01, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid pressure ratios: %s', value => {
    expect(() => resolveRequestBudgetPolicy({ pressureRatio: value })).toThrow('COPILOT_REQUEST_BUDGET_POLICY_INVALID')
  })
  it.each(['safetyTokens', 'pressureRatio', 'compactionReasoning'])('does not interpret null %s as a default', key => {
    expect(() => resolveRequestBudgetPolicy({ [key]: null } as never)).toThrow('COPILOT_REQUEST_BUDGET_POLICY_INVALID')
  })
  it('rejects unsupported modes and unknown policy keys', () => {
    expect(() => resolveRequestBudgetPolicy({ compactionReasoning: 'off' } as never)).toThrow('COPILOT_REQUEST_BUDGET_POLICY_INVALID')
    expect(() => resolveRequestBudgetPolicy({ margin: 10 } as never)).toThrow('COPILOT_REQUEST_BUDGET_POLICY_INVALID')
  })
})

describe('independent input and combined context admission', () => {
  it('does not subtract output from an independent prompt ceiling or mutate capacity', () => {
    expect(budget()).toMatchObject({ contextWindow: 64_000, maxInputTokens: 32_000, maxOutputTokens: 8_000,
      outputReservation: 8_000, hardInputLimit: 32_000, pressureInputLimit: 32_000, limitingFactor: 'prompt' })
    expect(limits).toEqual({ contextWindow: 64_000, maxInputTokens: 32_000, maxTokens: 8_000 })
    expect(Object.isFrozen(budget())).toBe(true)
  })
  it('reserves output from total context when combined capacity is the binding constraint', () => {
    expect(budget({ contextWindow: 64_000, maxInputTokens: 60_000, maxTokens: 16_000 })).toMatchObject({ hardInputLimit: 48_000, limitingFactor: 'context' })
  })
  it('supports omitted prompt limits without inventing them', () => {
    const result = calculateRequestBudget({ contextWindow: 64_000, maxTokens: 8_000 }, undefined, noMargins)
    expect(result).toMatchObject({ ok: true, budget: { hardInputLimit: 56_000, limitingFactor: 'context' } })
    if (result.ok) expect(result.budget).not.toHaveProperty('maxInputTokens')
  })
  it('preserves an explicit cap and reserves it without silently increasing or reducing it', () => {
    expect(budget({ contextWindow: 64_000, maxInputTokens: 60_000, maxTokens: 16_000 }, 8_000))
      .toMatchObject({ outputReservation: 8_000, maxOutputTokens: 16_000, hardInputLimit: 56_000 })
    expect(calculateRequestBudget(limits, 8_001, noMargins)).toMatchObject({ ok: false, code: 'COPILOT_REQUEST_OUTPUT_LIMIT_EXCEEDED' })
  })
  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])('rejects invalid capacities and explicit caps: %s', value => {
    for (const key of ['contextWindow', 'maxInputTokens', 'maxTokens']) {
      expect(calculateRequestBudget({ ...limits, [key]: value }, undefined, noMargins))
        .toMatchObject({ ok: false, code: 'COPILOT_REQUEST_INVALID_LIMITS' })
    }
    expect(calculateRequestBudget(limits, value, noMargins)).toMatchObject({ ok: false, code: 'COPILOT_REQUEST_INVALID_OUTPUT_LIMIT' })
  })
  it('reports no input headroom rather than fabricating a positive limit', () => {
    expect(calculateRequestBudget({ contextWindow: 8_000, maxTokens: 8_000 }, undefined, noMargins))
      .toMatchObject({ ok: false, code: 'COPILOT_REQUEST_NO_INPUT_HEADROOM' })
    expect(calculateRequestBudget(limits, undefined, resolveRequestBudgetPolicy({ safetyTokens: 32_000 })))
      .toMatchObject({ ok: false, code: 'COPILOT_REQUEST_NO_INPUT_HEADROOM' })
  })
  it('applies safety once and scales pressure separately for small windows', () => {
    expect(budget(limits, undefined, resolveRequestBudgetPolicy({ safetyTokens: 1000, pressureRatio: 0.9 })))
      .toMatchObject({ hardInputLimit: 31_000, pressureInputLimit: 27_900 })
    expect(budget({ contextWindow: 10, maxInputTokens: 9, maxTokens: 1 }, undefined,
      resolveRequestBudgetPolicy({ safetyTokens: 0, pressureRatio: 0.5 })))
      .toMatchObject({ hardInputLimit: 9, pressureInputLimit: 4 })
  })
  it('admits equality, rejects excess, and identifies the binding hard constraint', () => {
    expect(assessRequestBudget(32_000, budget())).toEqual({ ok: true })
    expect(assessRequestBudget(32_001, budget())).toMatchObject({ ok: false, code: 'COPILOT_REQUEST_INPUT_LIMIT_EXCEEDED' })
    const combined = budget({ contextWindow: 64_000, maxInputTokens: 60_000, maxTokens: 16_000 })
    expect(assessRequestBudget(48_001, combined)).toMatchObject({ ok: false, code: 'COPILOT_REQUEST_CONTEXT_LIMIT_EXCEEDED' })
  })
  it('requires explicit pressure admission so auxiliary and agentless calls keep hard headroom', () => {
    const current = budget(limits, undefined, resolveRequestBudgetPolicy({ safetyTokens: 1000, pressureRatio: 0.9 }))
    expect(assessRequestBudget(30_000, current, true)).toMatchObject({ ok: false, code: 'COPILOT_REQUEST_PRESSURE_EXCEEDED' })
    expect(assessRequestBudget(30_000, current)).toEqual({ ok: true })
    expect(assessRequestBudget(30_000, current, false)).toEqual({ ok: true })
    expect(assessRequestBudget(31_001, current)).toMatchObject({ ok: false, code: 'COPILOT_REQUEST_INPUT_LIMIT_EXCEEDED' })
    expect(assessRequestBudget(27_900, current, true)).toEqual({ ok: true })
  })
  it('accepts an empty estimate and rounds fractional estimates upward', () => {
    expect(assessRequestBudget(0, budget())).toEqual({ ok: true })
    expect(assessRequestBudget(31_999.1, budget())).toEqual({ ok: true })
    expect(assessRequestBudget(32_000.1, budget())).toMatchObject({ ok: false, code: 'COPILOT_REQUEST_INPUT_LIMIT_EXCEEDED' })
  })
  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])('refuses invalid estimates before comparisons: %s', estimate => {
    expect(assessRequestBudget(estimate, budget())).toMatchObject({ ok: false, code: 'COPILOT_REQUEST_INVALID_ESTIMATE' })
  })
})

describe('capability-driven summary reasoning defaults', () => {
  it('preserves any explicit caller effort for native validation, even when unsupported', () => {
    expect(selectCompactionReasoning(['minimal', 'low', 'high'], 'high')).toBe('high')
    expect(selectCompactionReasoning([], 'off')).toBe('off')
    expect(selectCompactionReasoning(['low'], 'future-effort')).toBe('future-effort')
  })
  it('selects only supported low-cost controls without inventing disabled reasoning', () => {
    expect(selectCompactionReasoning(['high', 'low'])).toBe('low')
    expect(selectCompactionReasoning(['low', 'minimal'])).toBe('minimal')
    expect(selectCompactionReasoning(['off', 'none', 'medium', 'high'])).toBeUndefined()
    expect(selectCompactionReasoning([])).toBeUndefined()
  })
  it('preserves native defaults when policy is disabled and never mutates capabilities', () => {
    const supported = Object.freeze(['low'])
    expect(selectCompactionReasoning(supported, undefined, 'preserve')).toBeUndefined()
    expect(selectCompactionReasoning(supported, 'high', 'preserve')).toBe('high')
    expect(supported).toEqual(['low'])
  })
})
