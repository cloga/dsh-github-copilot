import { createElement as h, useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import { AutoAllocationSummarySchema } from './auto-allocation-evidence.ts'
import type { AutoAllocationSummary } from './auto-allocation-evidence.ts'

export function AutoAllocationCard({ read, locale }: {
  readonly read: () => Promise<{ ok: boolean; value?: unknown }>
  readonly locale: string
}): ReactElement {
  const zh = locale.startsWith('zh')
  const [summary, setSummary] = useState<AutoAllocationSummary>()
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    setFailed(false); setSummary(undefined)
    void read().then(result => {
      if (!active) return
      const parsed = result.ok ? AutoAllocationSummarySchema.safeParse(result.value) : undefined
      if (parsed?.success) setSummary(parsed.data)
      else setFailed(true)
    }, () => { if (active) setFailed(true) })
    return () => { active = false }
  }, [read, attempt])
  return h('details', null,
    h('summary', null, zh ? 'Auto 分配观察（当前 Session）' : 'Auto allocation observations (this Session)'),
    h('p', null, zh ? '仅保留 Host 生命周期内最近最多 128 轮；重启、淘汰和缺失记录不代表零使用。这是选择观察，不是执行、质量或费用证明。'
      : 'Up to 128 recent retained turns in this Host lifetime. Restart, eviction and missing records are not zero usage. These are selection observations, not execution, quality or billing.'),
    failed ? h('div', { role: 'alert' }, zh ? '读取分配观察失败。' : 'Could not read allocation observations.',
      h('button', { type: 'button', onClick: () => setAttempt(value => value + 1) }, zh ? '重试' : 'Retry'))
      : summary === undefined ? h('p', { role: 'status' }, zh ? '正在读取…' : 'Reading…')
        : h('div', null,
          h('p', null, `${summary.policyVersion} · ${summary.retainedDecisions} ${zh ? '次保留分配' : 'retained allocations'} · ${summary.noFitDecisions} ${zh ? '次无适配候选' : 'no-fit decisions'}`),
          summary.observationStart === null || summary.observationEnd === null ? null
            : h('p', null, `${new Date(summary.observationStart).toLocaleString()} — ${new Date(summary.observationEnd).toLocaleString()}`),
          summary.status === 'not-collected' ? h('p', null, zh ? '尚无保留样本。' : 'No retained samples.') : null,
          summary.rowsTruncated ? h('p', { role: 'status' }, zh ? '候选明细达到上限；导出不完整。' : 'Candidate detail limit reached; export is incomplete.') : null,
          h('p', null, zh ? '导出包含模型 ID 与分配计数，不包含对话内容；不会自动上传。跨 Session 汇总和效果判断需另行审阅。'
            : 'Export contains model IDs and allocation counts, not conversation content. Nothing is uploaded automatically. Cross-Session aggregation and effectiveness require a separate review.'),
          h('label', { style: { display: 'grid', gap: 6 } }, zh ? '只读本地观察 JSON' : 'Read-only local observation JSON',
            h('textarea', { readOnly: true, value: JSON.stringify(summary, null, 2), rows: 8,
              style: { width: '100%', boxSizing: 'border-box', font: 'inherit', color: 'inherit',
                background: 'var(--dsw-alias-bg-layer-1, Canvas)' } }))))
}
