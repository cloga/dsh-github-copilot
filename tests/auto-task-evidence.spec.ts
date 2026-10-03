import { expect, it, vi } from 'vitest'
import { assessmentEvidence, SemanticAssessmentEvidenceSchema } from '../src/auto-assessment-evidence.ts'

it('captures monotonic auxiliary phases without text, accounting or late mutation', () => {
  let clock = 10
  const timer = vi.spyOn(performance, 'now').mockImplementation(() => clock)
  try {
    const evidence = assessmentEvidence(8000)
    clock = 20
    evidence.observe({ stage: 'model-selected', modelId: 'fixture-model' })
    clock = 30
    evidence.observe({ stage: 'adapter-started' })
    evidence.observe({ stage: 'text', characters: 0 })
    clock = 60
    evidence.observe({ stage: 'text', characters: 10 })
    clock = 90
    evidence.observe({ stage: 'text', characters: 2049 })
    evidence.observe({ stage: 'finished', stopped: false })
    const value = evidence.finish('not-validated')
    expect(value).toEqual({ modelId: 'fixture-model', budgetMs: 8000, elapsedMs: 80, stage: 'finished',
      adapterStartedMs: 20, firstTextMs: 50, nativeFinish: 'non-stop',
      outputCharacters: 2049, validation: 'not-validated' })
    expect(Object.isFrozen(value)).toBe(true)
    evidence.observe({ stage: 'text', characters: 4 })
    expect(value.outputCharacters).toBe(2049)
  } finally { timer.mockRestore() }
})

it('strictly rejects sensitive extras, unsafe counters and inconsistent milestones', () => {
  const value = { budgetMs: 8000, elapsedMs: 80, stage: 'adapter-started',
    adapterStartedMs: 20, outputCharacters: 0, validation: 'not-validated' }
  expect(SemanticAssessmentEvidenceSchema.safeParse(value).success).toBe(true)
  for (const extra of [{ prompt: 'PRIVATE' }, { modelId: 'bad\nid' }, { budgetMs: 0 }, { outputCharacters: 2050 },
    { elapsedMs: -1 }, { elapsedMs: Infinity }, { elapsedMs: Number.MAX_SAFE_INTEGER + 1 },
    { firstTextMs: 10 }, { firstTextMs: 81 }, { adapterStartedMs: 81 }, { nativeFinish: 'stop' },
    { outputCharacters: 1 }, { stage: 'finished' }, { stage: 'text-received' }, { stage: 'model-selected' }]) {
    expect(SemanticAssessmentEvidenceSchema.safeParse({ ...value, ...extra }).success).toBe(false)
  }
})
