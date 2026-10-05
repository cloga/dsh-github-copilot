import { expect, it } from 'vitest'
import { allocateAutoModel } from '../src/auto-allocation.ts'
import { summarizeAutoAllocations } from '../src/auto-allocation-evidence.ts'
import { TurnSelectionStore } from '../src/turn-selection.ts'
import type { AutoSelectionExplanation } from '../src/auto-model-routing.ts'

function explanation(seed: number): AutoSelectionExplanation {
  return { assessment: { demand: 'complex', source: 'local', signals: ['investigation'] },
    targetCategory: 'powerful', selectedCategory: 'powerful', categoryCandidateCount: 2,
    method: 'weighted-distribution', fallback: false,
    allocation: allocateAutoModel([{ id: 'regular' }, { id: 'marked' }], ['marked'], undefined, seed) }
}

it('sums conditional opportunities and selections rather than assuming equal candidate access', () => {
  const summary = summarizeAutoAllocations([explanation(1), explanation(2)])
  expect(summary).toMatchObject({ retainedDecisions: 2, completeHistory: false })
  expect(summary.rows.reduce((sum, row) => sum + row.selections, 0)).toBe(2)
  expect(summary.rows.reduce((sum, row) => sum + row.expectedSelections, 0)).toBeCloseTo(2)
  expect(summary.rows.find(row => row.highCost)).toMatchObject({ opportunities: 2, weight: 0.2 })
  expect(summarizeAutoAllocations([])).toMatchObject({ status: 'not-collected', rows: [] })
})

it('counts each turn once, bounds retention and never recovers missing evidence after removal', () => {
  const store = new TurnSelectionStore(), agent = {}
  for (let turn = 0; turn < 140; turn++) {
    const selection = { mode: 'auto', preference: 'balance', reason: 'standard-turn',
      candidateCount: 2, explanation: explanation(turn) } as const
    store.record(agent, turn, selection); store.record(agent, turn, selection)
  }
  expect(store.allocationSummary(agent).retainedDecisions).toBe(128)
  expect(store.get(agent, 0)).toEqual({ mode: 'unknown' })
  store.remove(agent)
  expect(store.allocationSummary(agent).status).toBe('not-collected')
})

it('marks bounded candidate detail as incomplete without losing aggregate turn counts', () => {
  const first = { ...explanation(1),
    allocation: allocateAutoModel(Array.from({ length: 512 }, (_, index) => ({ id: `model-${index}` })), [], undefined, 1) }
  const second = { ...explanation(2),
    allocation: allocateAutoModel([{ id: 'not-retained' }, { id: 'model-0' }], [], undefined, 2) }
  const summary = summarizeAutoAllocations([first, second])
  expect(summary).toMatchObject({ retainedDecisions: 2, rowsTruncated: true })
  expect(summary.rows).toHaveLength(512)
  expect(summary.rows.find(row => row.modelId === 'model-0')?.opportunities).toBe(2)
})

it('freezes copied evidence and reports the actual retained capture window', () => {
  const store = new TurnSelectionStore(), agent = {}
  const source = explanation(1)
  const allocation = { ...source.allocation!, candidates: source.allocation!.candidates.map(row => ({ ...row })) }
  const selection = { mode: 'auto' as const, preference: 'balance' as const, reason: 'standard-turn' as const,
    candidateCount: 2, explanation: { ...source, allocation } }
  store.record(agent, 1, selection)
  allocation.candidates[0]!.expectedShare = 0.99
  const saved = store.get(agent, 1)
  expect(saved.mode).toBe('auto')
  if (saved.mode !== 'auto') throw new Error('Missing captured turn')
  expect(saved.explanation?.allocation?.candidates[0]?.expectedShare).toBe(10 / 12)
  const summary = store.allocationSummary(agent)
  expect(summary.observationStart).not.toBeNull()
  expect(summary.observationEnd).toBe(summary.observationStart)
})
