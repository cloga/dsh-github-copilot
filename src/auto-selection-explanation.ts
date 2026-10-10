import type { AutoSelectionExplanation } from './auto-model-routing.ts'

export function selectionExplanation(explanation: AutoSelectionExplanation, locale: string): {
  readonly conclusion: string
  readonly assessment: string
  readonly choice: string
  readonly diagnostic?: string
  readonly semantic?: string
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
      : explanation.assessment.diagnostic === 'timeout' && explanation.assessment.demand === 'unknown'
        ? zh ? `任务难度判断超时，需求仍不确定；按当前偏好兜底选择 ${category[explanation.selectedCategory]}。`
          : `Task assessment timed out; demand remains uncertain. The preference policy selected ${category[explanation.selectedCategory]} as a fallback.`
      : zh ? `本轮判断为${demand[explanation.assessment.demand]}；按当前偏好选择 ${category[explanation.selectedCategory]} 类模型。`
        : `This task was assessed as ${demand[explanation.assessment.demand]}; the preference policy selected ${category[explanation.selectedCategory]}.`
  const allocation = explanation.allocation
  const selected = allocation?.candidates.find(row => row.modelId === allocation.selectedModelId)
  const choice = explanation.method === 'weighted-distribution'
    ? selected === undefined
      ? zh ? '按同类正权重政策分配；本轮候选观察未保留，不从当前设置推断。连续性仅为有限加权。'
        : 'Allocated by positive within-category weights. Candidate observations were not retained; current settings cannot reconstruct them. Continuity is a finite bonus.'
      : zh ? `在 ${explanation.categoryCandidateCount} 个同类可容纳候选中按正权重分配；选中模型${selected.highCost ? '已标记高成本' : '未标记高成本'}，有效权重 ${selected.weight}，本轮条件份额 ${(selected.expectedShare * 100).toFixed(1)}%。连续性仅为有限加权，不保证保留；这不是质量排名或实际费用。`
      : `Positive weighted allocation among ${explanation.categoryCandidateCount} fitting category candidates. Selected model is ${selected.highCost ? 'marked high cost' : 'unmarked'}, effective weight ${selected.weight}, conditional share ${(selected.expectedShare * 100).toFixed(1)}%. Continuity is a finite bonus, not a lock; this is not quality ranking or actual cost.`
    : explanation.method === 'continuity'
    ? zh ? `该分类有 ${explanation.categoryCandidateCount} 个可容纳候选；上一轮模型仍合格，因此按连续性策略保留。这不是语义排名，也不证明它最适合任务。`
      : `This category has ${explanation.categoryCandidateCount} fitting candidates. Kept the previous model because it remains eligible, prioritizing continuity; this is not a semantic ranking or proof it is best for the task.`
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
      : explanation.assessment.diagnostic === 'timeout'
        ? zh ? '辅助判断未在等待预算内完成，不代表正式回答超时或任务简单；本轮保留需求不确定，再按偏好策略选模。'
          : 'The auxiliary assessment did not complete within its waiting budget. This is not a timeout of the main answer or evidence of simplicity; selection used the unknown-demand preference policy.'
      : zh ? `语义判断未提供完整可用依据（${{
        unavailable: '没有可用分类模型', 'invalid-result': '结果无效', timeout: '超时',
        failed: '请求失败', 'context-omitted': '上下文不完整',
      }[explanation.assessment.diagnostic]}）；未将失败当作简单任务。`
        : `Semantic assessment did not provide complete usable evidence (${{ unavailable: 'no classifier available',
          'invalid-result': 'invalid result', timeout: 'timeout', failed: 'request failed', 'context-omitted': 'incomplete context',
        }[explanation.assessment.diagnostic]}); failure was not treated as simplicity.`
  const evidence = explanation.assessment.semantic
  const scan = evidence?.candidateScan
  const rejectionLabels = {
    excluded: zh ? '已排除' : 'excluded',
    'configured-id': zh ? '非指定模型' : 'configured ID mismatch',
    category: zh ? '非轻量分类' : 'not lightweight',
    input: zh ? '不支持文本' : 'text unsupported',
    'reasoning-disable-unproven': zh ? '关闭 reasoning 未获证明' : 'reasoning disable unproven',
    budget: zh ? '输入预算不足' : 'insufficient input budget',
  }
  const candidateDetail = scan === undefined ? ''
    : zh ? ` 候选检查：${scan.candidates} 个模型，${scan.eligible} 个合格。首个排除原因：${Object.entries(scan.rejected)
      .filter(([, count]) => count > 0).map(([reason, count]) =>
        `${rejectionLabels[reason as keyof typeof rejectionLabels]} ${count}`).join('；') || '无'}。`
      : ` Candidate scan: ${scan.candidates} models, ${scan.eligible} eligible. First rejection reasons: ${Object.entries(scan.rejected)
        .filter(([, count]) => count > 0).map(([reason, count]) =>
          `${rejectionLabels[reason as keyof typeof rejectionLabels]} ${count}`).join('; ') || 'none'}.`
  const preparationDetail = evidence?.preparationFailure === undefined ? ''
    : zh ? ' 原生模型准备未提供 off 控制；未发起分类调用。'
      : 'Native model preparation did not expose off; classifier call was not started.'
  const semantic = evidence === undefined ? undefined
    : zh ? `辅助分类模型：${evidence.modelId ?? '未选定'}。判断总耗时 ${evidence.elapsedMs} ms，等待预算 ${evidence.budgetMs} ms。${evidence.adapterStartedMs === undefined
      ? '尚未开始适配器调用。' : `适配器调用始于 ${evidence.adapterStartedMs} ms。`}${evidence.firstTextMs === undefined
      ? '未观察到文本输出。' : `首次文本输出于 ${evidence.firstTextMs} ms。`}${evidence.nativeFinish === undefined
      ? '未观察到原生结束。' : evidence.nativeFinish === 'stop' ? '观察到原生正常结束。' : '观察到原生非正常结束。'}结果校验：${{
        'not-validated': '未完成', valid: '通过', invalid: '无效', 'context-omitted': '通过格式校验，但上下文省略阻止降级',
      }[evidence.validation]}。这些是辅助判断阶段，不证明网络或模型慢的具体原因，也不是正式回答的 Usage。`
      : `Auxiliary classifier: ${evidence.modelId ?? 'not selected'}. Assessment total ${evidence.elapsedMs} ms; budget ${evidence.budgetMs} ms. ${evidence.adapterStartedMs === undefined
        ? 'Adapter call not started.' : `Adapter call started at ${evidence.adapterStartedMs} ms.`} ${evidence.firstTextMs === undefined
        ? 'No text output observed.' : `First text at ${evidence.firstTextMs} ms.`} ${evidence.nativeFinish === undefined
        ? 'No native finish observed.' : evidence.nativeFinish === 'stop' ? 'Native stop observed.' : 'Native non-stop finish observed.'} Result validation: ${{
          'not-validated': 'not completed', valid: 'passed', invalid: 'invalid', 'context-omitted': 'format passed; omitted context prevented downshift',
        }[evidence.validation]}. These auxiliary milestones do not prove a network/model latency cause and are not main-answer Usage.`
  return { conclusion, choice, diagnostic,
    semantic: semantic === undefined ? undefined : `${semantic}${candidateDetail}${preparationDetail}`,
    assessment: `${zh ? '判断来源：' : 'Assessment: '}${explanation.assessment.source === 'semantic'
      ? zh ? '语义分类' : 'semantic classification' : zh ? '本地规则' : 'local rules'}${explanation.assessment.signals.length
      ? ` — ${explanation.assessment.signals.map(signal => signals[signal]).join(zh ? '、' : ', ')}` : ''}` }
}
