import type { AutoSelectionExplanation } from './auto-model-routing.ts'

export function selectionExplanation(explanation: AutoSelectionExplanation, locale: string): {
  readonly conclusion: string
  readonly assessment: string
  readonly choice: string
  readonly diagnostic?: string
} {
  const zh = locale.startsWith('zh')
  const category = { powerful: 'Powerful', versatile: 'Versatile', lightweight: 'Lightweight', unknown: zh ? '分类未知' : 'unclassified' }
  const demand = { simple: zh ? '明确简单' : 'demonstrably simple',
    routine: zh ? '常规、边界明确' : 'routine and bounded', complex: zh ? '复杂' : 'complex',
    unknown: zh ? '需求不确定' : 'uncertain' }
  const signals = {
    'isolated-greeting': zh ? '独立问候' : 'isolated greeting',
    'bounded-transformation': zh ? '有边界的内容转换' : 'bounded transformation',
    reasoning: zh ? '推理任务' : 'reasoning task',
    investigation: zh ? '调查或调试' : 'investigation or debugging',
    continuation: zh ? '继续已有工作' : 'continuation of existing work',
    'context-omitted': zh ? '判断上下文不完整' : 'incomplete assessment context',
    'insufficient-evidence': zh ? '本地规则尚不能确定任务需求' : 'local rules cannot establish task demand',
  }
  const conclusion = explanation.method === 'no-fit'
    ? zh ? '没有候选能直接容纳估算输入；选中输入预算最大的模型，保留原生压缩或失败处理。'
      : 'No candidate fits the estimated input. Selected the largest input budget for native recovery or failure.'
    : explanation.fallback
      ? zh ? `目标分类 ${category[explanation.targetCategory]} 没有合格的可容纳候选，回退到 ${category[explanation.selectedCategory]}。`
        : `No eligible fitting ${category[explanation.targetCategory]} candidate; fell back to ${category[explanation.selectedCategory]}.`
      : zh ? `本轮判断为${demand[explanation.assessment.demand]}；按当前偏好选择 ${category[explanation.selectedCategory]} 类模型。`
        : `This task was assessed as ${demand[explanation.assessment.demand]}; the preference policy selected ${category[explanation.selectedCategory]}.`
  const choice = explanation.method === 'continuity'
    ? zh ? '上一轮模型仍满足本轮分类和输入要求，因此保持它。' : 'Kept the previous model because it still meets this turn’s category and input requirements.'
    : explanation.method === 'only-candidate'
      ? zh ? '该分类只有一个可容纳的合格候选。' : 'Only one eligible fitting candidate remains in this category.'
      : explanation.method === 'equal-distribution'
        ? zh ? `该分类有 ${explanation.categoryCandidateCount} 个可容纳候选；按本轮稳定等权规则选中，不代表质量排名。`
          : `Selected among ${explanation.categoryCandidateCount} fitting category candidates by stable equal-weight allocation, not a quality ranking.`
        : zh ? '所有候选均不适配；这不是成功的偏好匹配。' : 'All candidates are oversized; this is not a successful preference match.'
  const diagnostic = explanation.assessment.diagnostic === undefined ? undefined
    : explanation.assessment.diagnostic === 'disabled'
      ? zh ? '语义判断实验未开启；这是本地规则的判断边界，不代表会话没有上下文。'
        : 'Semantic assessment is disabled; this is a limit of local rules, not proof that the conversation lacks context.'
      : zh ? `语义判断未提供完整可用依据（${{
        unavailable: '没有可用分类模型', 'invalid-result': '结果无效', timeout: '超时',
        failed: '请求失败', 'context-omitted': '上下文不完整',
      }[explanation.assessment.diagnostic]}）；未将失败当作简单任务。`
        : `Semantic assessment did not provide complete usable evidence (${{ unavailable: 'no classifier available',
          'invalid-result': 'invalid result', timeout: 'timeout', failed: 'request failed', 'context-omitted': 'incomplete context',
        }[explanation.assessment.diagnostic]}); failure was not treated as simplicity.`
  return { conclusion, choice, diagnostic,
    assessment: `${zh ? '判断来源：' : 'Assessment: '}${explanation.assessment.source === 'semantic'
      ? zh ? '语义分类' : 'semantic classification' : zh ? '本地规则' : 'local rules'}${explanation.assessment.signals.length
      ? ` — ${explanation.assessment.signals.map(signal => signals[signal]).join(zh ? '、' : ', ')}` : ''}` }
}
