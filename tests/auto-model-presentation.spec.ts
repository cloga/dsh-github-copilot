import { describe, expect, it, vi } from 'vitest'
import {
  AUTO_MODEL_ATTRIBUTION_KEY, autoModelAttributionDefinition, installAutoModelPresentation,
} from '../src/auto-model-presentation.ts'
import { turnModelProvenanceDefinition } from '../src/turn-model-provenance.ts'

function decision(overrides: Record<string, unknown> = {}) {
  return {
    type: 'github-copilot/auto-model-decision',
    ignorable: true,
    data: {
      turn: 3,
      step: 1,
      provider: 'github-copilot-preview',
      model: 'fixture-model',
      taskClass: 'balanced',
      reason: 'standard-turn',
      candidateCount: 3,
      ...overrides,
    },
  }
}

describe('Auto model presentation', () => {
  it('omits attribution when a compatible history contains no optional decision', () => {
    expect(autoModelAttributionDefinition.buildLocationData({ matches: [] }, 'turn', null)).toBeNull()
    expect(autoModelAttributionDefinition.match({
      type: 'request/header', data: { config: { provider: 'github-copilot-preview', model: 'fixture-model' } },
    })).toBeNull()
  })

  it('folds a durable decision into turn-scoped credential-free attribution', () => {
    const event = decision()
    expect(autoModelAttributionDefinition.match(event)).toEqual({ id: '3', role: 'start' })
    const state = autoModelAttributionDefinition.start({ matches: [] }, { event })
    expect(autoModelAttributionDefinition.buildLocationData({ state, matches: [{ event }] }, 'turn', null)).toEqual({
      kind: 'turn',
      turn: 3,
      key: AUTO_MODEL_ATTRIBUTION_KEY,
      value: {
        provider: 'github-copilot-preview',
        model: 'fixture-model',
        taskClass: 'balanced',
        reason: 'standard-turn',
        candidateCount: 3,
      },
    })
    expect(autoModelAttributionDefinition.match(decision({ candidateCount: 0 }))).toBeNull()
    expect(autoModelAttributionDefinition.match({ ...event, type: 'request/header' })).toBeNull()
    const preferred = decision({ preference: 'intelligence' })
    const stateWithPreference = autoModelAttributionDefinition.start({ matches: [] }, { event: preferred })
    expect(autoModelAttributionDefinition.buildLocationData({ state: stateWithPreference, matches: [{ event: preferred }] }, 'turn', null))
      .toMatchObject({ value: { preference: 'intelligence' } })
    expect(autoModelAttributionDefinition.match(decision({ preference: 'unsupported' }))).toBeNull()

    const withDiagnostics = decision({
      fittingCandidateCount: 2,
      estimatedInputTokens: 50_000,
      selectedInputBudget: 100_000,
      inputFitDiagnostic: 'fitting-candidate-selected',
    })
    const stateDiag = autoModelAttributionDefinition.start({ matches: [] }, { event: withDiagnostics })
    expect(autoModelAttributionDefinition.buildLocationData({ state: stateDiag, matches: [{ event: withDiagnostics }] }, 'turn', null))
      .toMatchObject({
        value: {
          fittingCandidateCount: 2,
          estimatedInputTokens: 50_000,
          selectedInputBudget: 100_000,
          inputFitDiagnostic: 'fitting-candidate-selected',
        },
      })
  })

  it('registers only the public turn-tail list slot and conversation definition', () => {
    const removeEntry = vi.fn()
    const removeDefinition = vi.fn()
    const removeInjection = vi.fn()
    const register = vi.fn(() => removeEntry)
    const events = { register: vi.fn(() => removeDefinition) }
    const slots = {
      spec: vi.fn(() => ({ kind: 'list', scope: 'session' })),
      register,
      inject: vi.fn((_name: string, setup: () => () => void) => {
        const remove = setup()
        return () => { remove(); removeInjection() }
      }),
    }
    const diagnostic = vi.fn()
    const dispose = installAutoModelPresentation({ slots, uiConversation: { events }, diagnostic,
      remote: { githubCopilotTurnSelection: { get: vi.fn() } } })
    expect(events.register).toHaveBeenCalledWith(autoModelAttributionDefinition)
    expect(events.register).toHaveBeenCalledWith(turnModelProvenanceDefinition)
    expect(register).toHaveBeenCalledWith(
      { name: 'conversation.chat.assistant-actions', id: 'github-copilot-auto-model', order: 20 },
      expect.any(Function),
    )
    expect(diagnostic).not.toHaveBeenCalled()
    dispose()
    expect(removeEntry).toHaveBeenCalledOnce()
    expect(removeDefinition).toHaveBeenCalledTimes(2)
    expect(removeInjection).toHaveBeenCalledOnce()
  })
})
