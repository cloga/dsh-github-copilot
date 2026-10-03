import { expect, it } from 'vitest'
import { selectionExplanation } from '../src/auto-selection-explanation.ts'
import type { AutoSelectionExplanation } from '../src/auto-model-routing.ts'

const explanation: AutoSelectionExplanation = {
  assessment: { demand: 'unknown', source: 'local', signals: ['continuation', 'insufficient-evidence'], diagnostic: 'disabled' },
  targetCategory: 'powerful', selectedCategory: 'powerful', categoryCandidateCount: 2,
  fallback: false, method: 'continuity',
}

it('distinguishes local rule coverage from absent conversation context in both languages', () => {
  const en = selectionExplanation(explanation, 'en')
  expect(en.assessment).toContain('continuation of existing work')
  expect(en.assessment).toContain('local rules cannot establish task demand')
  expect(en.diagnostic).toContain('not proof that the conversation lacks context')
  const zh = selectionExplanation(explanation, 'zh-CN')
  expect(zh.assessment).toContain('本地规则尚不能确定任务需求')
  expect(zh.diagnostic).toContain('不代表会话没有上下文')
})

it('shows established continuation evidence without an irrelevant disabled experiment warning', () => {
  const text = selectionExplanation({
    ...explanation,
    assessment: { demand: 'complex', source: 'local', signals: ['continuation', 'investigation'] },
  }, 'en')
  expect(text.conclusion).toContain('complex')
  expect(text.assessment).toContain('investigation')
  expect(text.diagnostic).toBeUndefined()
})
