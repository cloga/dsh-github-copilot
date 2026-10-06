import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { createElement as h, useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { DiagnosticsViewSchema } from './diagnostics-types.ts'
import type { DiagnosticsView } from './diagnostics-types.ts'
import { updateDiagnosticsClient, clientDiagnosticsReportingFailed } from './diagnostics-client.ts'

export type DiagnosticsRemote = Context['remote']['githubCopilotDiagnostics']
const section: CSSProperties = { marginTop: 24, paddingTop: 18,
  borderTop: '1px solid color-mix(in srgb, currentColor 20%, transparent)',
  display: 'grid', gap: 12, minWidth: 0 }
const button: CSSProperties = { font: 'inherit', color: 'inherit', cursor: 'pointer',
  padding: '8px 12px', minHeight: 44, borderRadius: 8, border: '1px solid color-mix(in srgb, currentColor 30%, transparent)',
  background: 'color-mix(in srgb, currentColor 6%, transparent)' }
export function DiagnosticsCard({ remote }: { remote?: DiagnosticsRemote }) {
  const [view, setView] = useState<DiagnosticsView>()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [exported, setExported] = useState(false)
  const owner = useRef({ active: false, generation: 0, busy: false })
  async function run(action: (remote: DiagnosticsRemote) => ReturnType<DiagnosticsRemote['get']>) {
    const current = owner.current
    if (!remote || !current.active || current.busy) return
    current.busy = true
    const generation = ++current.generation
    setBusy(true); setFailed(false); setExported(false)
    try {
      const result = await action(remote)
      if (!current.active || current.generation !== generation) return
      const parsed = result.ok ? DiagnosticsViewSchema.safeParse(result.value) : undefined
      if (!parsed?.success) { setFailed(true); return }
      setView(parsed.data)
      updateDiagnosticsClient(parsed.data)
    } catch {
      if (current.active && current.generation === generation) setFailed(true)
    } finally {
      if (current.active && current.generation === generation) { current.busy = false; setBusy(false) }
    }
  }
  useEffect(() => {
    const current = owner.current
    current.active = true
    void run(value => value.get())
    return () => { current.active = false; current.generation++; current.busy = false }
  }, [remote])
  const rows = view?.snapshot.rows ?? []
  const populations = [...new Set(rows.filter(row => row.operation !== 'collection').map(row => `${row.layer}/${row.operation}`))]
  const count = (metrics: readonly string[], population: string) => rows
    .filter(row => metrics.includes(row.metric) && `${row.layer}/${row.operation}` === population)
    .reduce((sum, row) => sum + row.count, 0)
  const control = (label: string, action: () => void, disabled = false) =>
    h('button', { type: 'button', style: button, onClick: action, disabled: busy || disabled }, label)
  return h('section', { 'aria-label': 'Local diagnostics', style: section },
    h('h3', { style: { margin: 0 } }, 'Local diagnostics'),
    h('p', { style: { margin: 0, lineHeight: 1.5, maxWidth: '70ch' } },
      'Account, Checking and compaction counts stay in this profile. No identities, conversation content or raw errors. No upload, scheduled analysis or automatic repair.'),
    h('p', { role: 'status', style: { margin: 0 } },
      !remote ? 'Diagnostics controls are unavailable in this connection.'
        : !view ? busy ? 'Reading local collection status…' : 'Collection status is unknown.'
          : `${view.enabled ? view.state === 'ready' ? 'Collection enabled' : 'Collection configured on; not collecting' : 'Collection paused'} · Storage ${view.state}`
            + (view.diagnostic === 'none' ? '' : ` · ${view.diagnostic}`)
            + (view.dirty ? ' · Not all observations are persisted yet' : '')),
    failed ? h('p', { role: 'alert', style: { margin: 0 } },
      'Could not confirm the operation. Read status before retrying; no write is automatically replayed.') : null,
    clientDiagnosticsReportingFailed() ? h('p', { role: 'alert', style: { margin: 0 } },
      'Some Client observations could not be confirmed. Client counts are incomplete; Host counts are separate.') : null,
    h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8 } },
      control('Read status', () => { void run(value => value.get()) }, !remote),
      control(view?.enabled ? 'Pause collection' : 'Enable local collection',
        () => { void run(value => value.setEnabled(!view?.enabled)) },
        !remote || !view || view.state !== 'ready'),
      control('Clear local aggregates', () => setConfirmClear(true), !remote || !view || view.state !== 'ready')),
    confirmClear ? h('div', { role: 'group', 'aria-label': 'Confirm clearing local diagnostics' },
      h('p', null, 'Delete collected aggregates only? Collection keeps its current enabled/paused setting. This does not clear account settings or conversation history.'),
      control('Confirm clear', () => { setConfirmClear(false); void run(value => value.clear()) }),
      control('Cancel', () => setConfirmClear(false))) : null,
    view && populations.length ? h('div', { style: { overflowX: 'auto', minWidth: 0 } },
      h('table', { style: { width: '100%', borderCollapse: 'collapse', textAlign: 'left' } },
        h('caption', { style: { textAlign: 'left', marginBottom: 8 } }, 'Retained observations · independent Client and Host populations'),
        h('thead', null, h('tr', null, ...['Population', 'Started', 'Success', 'Failed', 'Cancelled', 'Interrupted', 'Other settled'].map(label => h('th', { key: label, scope: 'col', style: { padding: 6 } }, label)))),
        h('tbody', null, ...populations.map(population => h('tr', { key: population },
          h('th', { scope: 'row', style: { padding: 6 } }, population),
          ...['started', 'success', 'failed', 'cancelled', 'interrupted'].map(metric =>
            h('td', { key: metric, style: { padding: 6 } }, count([metric], population))),
          h('td', { style: { padding: 6 } },
            count(['no-op', 'policy-rejected', 'revoked', 'environment-fault', 'unknown'], population))))))) : null,
    view && !populations.length ? h('p', null, 'No retained operation observations. This is not evidence of zero failures.') : null,
    view ? h('p', { style: { margin: 0, fontSize: 13, lineHeight: 1.5 } },
      `Host pending: ${view.snapshot.pending.reduce((sum, row) => sum + row.count, 0)}. `
      + `Host dropped: ${view.snapshot.dropped}; Client dropped: ${view.snapshot.clientDropped}; Client unconfirmed: ${view.snapshot.clientUnconfirmed}; `
      + `evicted/expired: ${view.snapshot.evicted}; saturated: ${view.snapshot.saturated}. `
      + 'Retention: 14 days, at most 4,096 aggregate rows and 2 MiB. Client pending samples are periodic observations, not a live outstanding count. '
      + 'Other settled includes policy rejection, revocation, environment faults and unknown/no-checkpoint results; JSON preserves each category. '
      + 'Stock/custom-engine physical summaries, native recovery opt-out, OAuth, quota and unwrapped RPCs are not covered.') : null,
    view ? h('details', null, h('summary', null, 'Review aggregate-only JSON'),
      h('p', null, 'Review before sharing. This includes build versions, hour windows and fixed diagnostic counts, never account or Session identifiers.'),
      control('Prepare current JSON', () => setExported(true)),
      exported ? h('textarea', { 'aria-label': 'Local diagnostics aggregate JSON', readOnly: true,
        value: JSON.stringify(view, null, 2), rows: 12, style: { width: '100%', boxSizing: 'border-box', font: 'inherit' } }) : null) : null)
}
