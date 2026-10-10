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
it.each(['en', 'zh'])('explains timeout as unknown-demand policy fallback, not proven task complexity (%s)', locale => {
  const text = selectionExplanation({ ...explanation, method: 'equal-distribution',
    assessment: { demand: 'unknown', source: 'local', signals: ['insufficient-evidence'], diagnostic: 'timeout',
      semantic: { modelId: 'aux-fixture', budgetMs: 8000, elapsedMs: 8001, stage: 'adapter-started',
        adapterStartedMs: 100, outputCharacters: 0, validation: 'not-validated' } },
  }, locale)
  expect(text.conclusion).toContain(locale === 'en' ? 'as a fallback' : '兜底')
  expect(text.conclusion).toContain('Powerful')
  expect(text.semantic).toContain('aux-fixture')
  expect(text.semantic).toContain('8000 ms')
  expect(text.semantic).toContain(locale === 'en' ? 'No text output observed' : '未观察到文本输出')
  expect(text.diagnostic).toContain(locale === 'en' ? 'not a timeout of the main answer' : '不代表正式回答超时')
})
it.each(['en', 'zh'])('distinguishes continuity and category pool from semantic model merit (%s)', locale => {
  const text = selectionExplanation({ ...explanation,
    assessment: { demand: 'unknown', source: 'local', signals: [], diagnostic: 'timeout' },
  }, locale)
  expect(text.choice).toContain('2')
  expect(text.choice).toContain(locale === 'en' ? 'not a semantic ranking' : '不是语义排名')
})

it.each(['en', 'zh'])('shows bounded rejection counts and preparation failure without claiming a timeout (%s)', locale => {
  const text = selectionExplanation({ ...explanation,
    assessment: { demand: 'unknown', source: 'local', signals: [], diagnostic: 'unavailable',
      semantic: { budgetMs: 30000, elapsedMs: 514, stage: 'preparing', outputCharacters: 0,
        validation: 'not-validated', candidateScan: { candidates: 6, eligible: 0,
          rejected: { category: 2, 'reasoning-disable-unproven': 4 } },
        preparationFailure: 'native-off-unavailable' } },
  }, locale)
  expect(text.semantic).toContain(locale === 'en' ? '6 models, 0 eligible' : '6 个模型，0 个合格')
  expect(text.semantic).toContain(locale === 'en' ? 'reasoning disable unproven 4' : '关闭 reasoning 未获证明 4')
  expect(text.semantic).toContain(locale === 'en' ? 'did not expose off' : '未提供 off 控制')
  expect(text.conclusion).not.toContain(locale === 'en' ? 'timed out' : '超时')
})

it('does not turn missing legacy candidate evidence into an empty scan', () => {
  const text = selectionExplanation({ ...explanation,
    assessment: { demand: 'unknown', source: 'local', signals: [], diagnostic: 'unavailable',
      semantic: { budgetMs: 30000, elapsedMs: 514, stage: 'preparing', outputCharacters: 0,
        validation: 'not-validated' } },
  }, 'en')
  expect(text.semantic).not.toContain('Candidate scan')
  expect(text.semantic).not.toContain('preparation did not expose')
})
