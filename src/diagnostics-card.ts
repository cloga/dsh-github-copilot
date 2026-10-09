import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { createElement as h, useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import {
  nativeButtonStyle, nativeCaptionStyle, nativeHeadingStyle, nativeSettingsStyle, nativeSettingsCss,
} from './native-settings-style.ts'
import { DiagnosticsViewSchema } from './diagnostics-types.ts'
import type { DiagnosticsView } from './diagnostics-types.ts'
import { updateDiagnosticsClient, clientDiagnosticsReportingFailed } from './diagnostics-client.ts'

export type DiagnosticsRemote = Context['remote']['githubCopilotDiagnostics']
const section: CSSProperties = { ...nativeSettingsStyle, marginTop: 24, paddingTop: 12,
  borderTop: '1px solid color-mix(in srgb, currentColor 20%, transparent)',
  display: 'grid', gap: 12, minWidth: 0 }
const button: CSSProperties = nativeButtonStyle
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
  const requests = view?.snapshot.requests
  const auto = view?.snapshot.autoAllocation
  const autoOpportunities = auto?.rows.reduce((sum, row) => sum + row.opportunities, 0) ?? 0
  const autoExpected = auto?.rows.reduce((sum, row) => sum + row.expectedSelections, 0) ?? 0
  const autoSelections = auto?.rows.reduce((sum, row) => sum + row.selections, 0) ?? 0
  const autoNoFit = auto?.noFitRows.reduce((sum, row) => sum + row.decisions, 0) ?? 0
  const autoWindow = auto === undefined || auto.observationStart === null || auto.observationEnd === null
    ? 'No retained observation window'
    : `${new Date(auto.observationStart).toISOString().slice(0, 10)} – ${new Date(auto.observationEnd).toISOString().slice(0, 10)} UTC`
  const autoRows = auto ? [
    ...auto.rows.map(row => ({
      key: JSON.stringify([row.day, row.version, row.policyVersion, row.modelId, row.targetCategory, row.category, row.demand,
        row.assessmentSource, row.assessmentOutcome, row.method, row.fallback, row.highCost, row.previous]),
      day: row.day, policy: row.policyVersion, model: row.modelId,
      cohort: `${row.targetCategory} → ${row.category} · ${row.demand} · ${row.assessmentSource} · assessment: ${row.assessmentOutcome ?? 'not recorded'} · ${row.method}`
        + (row.fallback ? ' · fallback' : '') + (row.highCost ? ' · high-cost' : '') + (row.previous ? ' · continuity' : ''),
      opportunities: row.opportunities, expected: row.expectedSelections, selected: row.selections, noFit: null as number | null,
    })),
    ...auto.noFitRows.map(row => ({
      key: JSON.stringify([row.day, row.version, row.policyVersion, row.targetCategory, row.category, row.demand, row.assessmentSource, row.assessmentOutcome]),
      day: row.day, policy: row.policyVersion, model: '—',
      cohort: `${row.targetCategory} → ${row.category} · ${row.demand} · ${row.assessmentSource} · assessment: ${row.assessmentOutcome ?? 'not recorded'} · no fit`,
      opportunities: null as number | null, expected: null as number | null, selected: null as number | null,
      noFit: row.decisions,
    })),
  ].sort((left, right) => right.day - left.day || left.policy.localeCompare(right.policy) || left.model.localeCompare(right.model))
    : []
  const populations = [...new Set(rows.filter(row => row.operation !== 'collection').map(row => `${row.layer}/${row.operation}`))]
  const count = (metrics: readonly string[], population: string) => rows
    .filter(row => metrics.includes(row.metric) && `${row.layer}/${row.operation}` === population)
    .reduce((sum, row) => sum + row.count, 0)
  const control = (label: string, action: () => void, disabled = false) =>
    h('button', { type: 'button', style: button, onClick: action, disabled: busy || disabled }, label)
  return h('section', { 'aria-label': 'Local diagnostics', 'data-copilot-native-ui': true, style: section },
    h('style', null, nativeSettingsCss),
    h('h3', { style: nativeHeadingStyle }, 'Local diagnostics'),
    h('div', { style: { display: 'grid', gap: 8, minWidth: 0 } },
      h('h4', { style: nativeHeadingStyle }, 'Auto allocation observations'),
      h('p', { role: 'status', style: { margin: 0 } },
        !view ? busy ? 'Reading observation status…' : 'Observation status is unknown.'
          : `${view.autoAllocationEnabled
            ? view.state === 'ready' ? 'Enabled' : 'Enabled · storage unavailable'
            : 'Paused'} · ${auto === undefined ? 'Auto observations unavailable in this snapshot'
            : auto.status === 'observed' ? 'Data observed'
              : view.state === 'ready' ? 'No observations collected' : 'Observation status unavailable'}`
          + (view.dirty ? ' · Latest changes not fully persisted' : '')),
      auto ? h('p', { style: { margin: 0 } },
        `${autoWindow} · ${auto.rows.length + auto.noFitRows.length} retained strata · ${auto.rowsTruncated ? 'row limit reached' : 'row limit not reached'}`
        + (auto.dropped ? ` · ${auto.dropped} dropped` : '')
        + (auto.expired ? ` · ${auto.expired} expired` : '')
        + (auto.restarts ? ` · ${auto.restarts} restarts observed` : '')
        + (auto.saturated ? ` · ${auto.saturated} counters saturated` : '')) : null,
      autoRows.length ? h('div', { style: { overflowX: 'auto', minWidth: 0 } },
        h('table', { style: { width: '100%', borderCollapse: 'collapse', textAlign: 'left', font: 'inherit' } },
          h('caption', { style: { ...nativeCaptionStyle, textAlign: 'left', marginBottom: 8 } },
            'Daily aggregates by matching policy, model and decision cohort'),
          h('thead', null, h('tr', null,
            ...['Date (UTC)', 'Policy', 'Model', 'Cohort', 'Opportunities', 'Expected', 'Selected', 'No-fit'].map(label =>
              h('th', { key: label, scope: 'col', style: { padding: 6, font: 'inherit', fontWeight: 500, textAlign: label === 'Cohort' || label === 'Model' ? 'left' : 'right' } }, label)))),
          h('tbody', null, ...autoRows.map(row => h('tr', { key: row.key },
            h('td', { style: { padding: 6, whiteSpace: 'nowrap' } }, new Date(row.day).toISOString().slice(0, 10)),
            h('td', { style: { padding: 6, overflowWrap: 'anywhere' } }, row.policy),
            h('td', { style: { padding: 6, overflowWrap: 'anywhere' } }, row.model),
            h('td', { style: { padding: 6, minWidth: 220 } }, row.cohort),
            h('td', { style: { padding: 6, textAlign: 'right' } }, row.opportunities ?? '—'),
            h('td', { style: { padding: 6, textAlign: 'right' } }, row.expected === null ? '—' : row.expected.toFixed(3)),
            h('td', { style: { padding: 6, textAlign: 'right' } }, row.selected ?? '—'),
            h('td', { style: { padding: 6, textAlign: 'right' } }, row.noFit ?? '—')))))) : null,
      auto?.status === 'observed' && autoRows.length === 0
        ? h('p', { style: { margin: 0 } }, 'No retained strata in this snapshot; this does not mean there were no decisions.')
        : !auto ? h('p', { style: { margin: 0 } }, 'Auto allocation aggregates are unavailable in this snapshot.')
          : view && auto.status !== 'observed' && view.state !== 'ready'
            ? h('p', { style: { margin: 0 } }, 'Storage is not ready; retained Auto observation status is unknown.')
            : view && auto.status !== 'observed' ? h('p', { style: { margin: 0 } }, 'No retained observations yet.') : null,
      autoRows.length ? h('p', { style: { ...nativeCaptionStyle, margin: 0 } },
        `${autoOpportunities} candidate opportunities · ${autoExpected.toFixed(3)} expected selections · ${autoSelections} actual selections · ${autoNoFit} no-fit decisions. Compare expected and selected counts only within matching cohorts; these are not execution, quality or billing evidence. Assessment outcomes explain classification only, not the supplier root cause. Legacy reasons are not recorded; sum Selected or No-fit, not candidate opportunities, when counting decisions by outcome.`) : null),
    view ? h('details', null,
      h('summary', null, 'Physical request observations'),
      h('p', { style: { margin: 0 } },
        requests ? `${requests.rows.length} retained requests · ${requests.pending ?? 0} sampled pending · ${requests.dropped} dropped · ${requests.evicted} expired/evicted · ${requests.interruptedOnReopen ?? 0} interrupted on reopen`
          : 'No retained request observations. This does not establish zero failures or enabled collection.'),
      h('p', { style: { ...nativeCaptionStyle, margin: 0 } },
        'Managed native adapter dispatches only. Local body-write completion is not supplier receipt. Stream-done is a native terminal observation, not tool execution or billing success. No Core retry count or Session/turn attribution is inferred.'),
      requests?.rows.length ? h('div', { style: { overflowX: 'auto', minWidth: 0 } },
        h('table', { style: { width: '100%', borderCollapse: 'collapse', textAlign: 'left', font: 'inherit' } },
          h('caption', { style: { ...nativeCaptionStyle, textAlign: 'left', marginBottom: 8 } }, 'Latest retained physical requests'),
          h('thead', null, h('tr', null, ...['Time (UTC)', 'Model', 'Outcome / reason', 'HTTP', 'JSON / wire bytes', 'Headers / body-write ms'].map(label =>
            h('th', { key: label, scope: 'col', style: { padding: 6, font: 'inherit', fontWeight: 500 } }, label)))),
          h('tbody', null, ...requests.rows.slice().sort((left, right) => right.startedAt - left.startedAt).map((row, index) => h('tr', { key: `${row.streamId}/${row.dispatchIndex}/${index}` },
            h('td', { style: { padding: 6, whiteSpace: 'nowrap' } }, new Date(row.startedAt).toISOString()),
            h('td', { style: { padding: 6, overflowWrap: 'anywhere' } }, row.model),
            h('td', { style: { padding: 6, overflowWrap: 'anywhere' } }, `${row.outcome} / ${row.reason}`),
            h('td', { style: { padding: 6 } }, row.httpStatus ?? '—'),
            h('td', { style: { padding: 6 } }, `${row.composition.totalBytes ?? 'unknown'} / ${row.wireBytes ?? 'unknown'} (${row.encoding}; composition ${row.composition.state})`),
            h('td', { style: { padding: 6 } },
              `${row.responseHeadersMs ?? 'unknown'} / ${row.upload?.state === 'observed' ? row.upload.bodyWriteCompleteMs ?? 'unknown' : 'unknown'}`)))))) : null) : null,
    view && populations.length ? h('details', null,
      h('summary', null, 'Account and compaction observations'),
      h('div', { style: { overflowX: 'auto', minWidth: 0 } },
        h('table', { style: { width: '100%', borderCollapse: 'collapse', textAlign: 'left', font: 'inherit' } },
          h('caption', { style: { ...nativeCaptionStyle, textAlign: 'left', marginBottom: 8 } },
            'Independent Client and Host populations'),
          h('thead', null, h('tr', null, ...['Population', 'Started', 'Success', 'Failed', 'Cancelled', 'Interrupted', 'Other settled'].map(label =>
            h('th', { key: label, scope: 'col', style: { padding: 6, font: 'inherit', fontWeight: 500 } }, label)))),
          h('tbody', null, ...populations.map(population => h('tr', { key: population },
            h('th', { scope: 'row', style: { padding: 6, font: 'inherit', fontWeight: 500 } }, population),
            ...['started', 'success', 'failed', 'cancelled', 'interrupted'].map(metric =>
              h('td', { key: metric, style: { padding: 6 } }, count([metric], population))),
            h('td', { style: { padding: 6 } },
              count(['no-op', 'policy-rejected', 'revoked', 'environment-fault', 'unknown'], population)))))))) : null,
    view && !populations.length ? h('details', null,
      h('summary', null, 'Account and compaction observations'),
      h('p', null, 'No retained operation observations. This is not evidence of zero failures.')) : null,
    h('details', null,
      h('summary', null, 'Collection controls'),
      h('p', { style: { margin: 0 } },
        view?.requestEnabled === undefined ? 'Request observations unavailable in this snapshot.'
          : `Request observations ${view.requestEnabled ? 'enabled' : 'paused'}. ${requests?.rows.length ?? 0} retained physical requests; ${requests?.dropped ?? 0} dropped; ${requests?.evicted ?? 0} expired/evicted.`),
      h('p', { style: { ...nativeCaptionStyle, margin: 0 } },
        'Separate opt-in: retain at most 128 content-free physical requests for 24 hours. Includes model, payload byte counts, transport timing, HTTP status and terminal categories, not bodies, credentials, URLs, headers or Session/turn IDs. Random stream IDs correlate native SDK dispatches only; dispatch index is not a Core retry count.'),
      h('p', { role: 'status', style: { margin: 0 } },
        !remote ? 'Diagnostics controls are unavailable in this connection.'
          : !view ? busy ? 'Reading local collection status…' : 'Collection status is unknown.'
            : `${view.enabled ? view.state === 'ready' ? 'Local collection enabled' : 'Local collection configured on; storage not ready' : 'Local collection paused'} · Storage ${view.state}`
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
          !remote || !view || !view.enabled && view.state !== 'ready'),
        control(view?.autoAllocationEnabled ? 'Pause Auto allocation observation' : 'Enable Auto allocation observation',
          () => { void run(value => value.setAutoAllocationEnabled(!view?.autoAllocationEnabled)) },
          !remote || !view || !view.autoAllocationEnabled && view.state !== 'ready'),
        control(view?.requestEnabled ? 'Pause request observations' : 'Enable request observations',
          () => { void run(value => value.setRequestEnabled(!view?.requestEnabled)) },
          !remote || !view || view.requestEnabled === undefined || !view.requestEnabled && view.state !== 'ready'),
        control('Clear local diagnostics', () => setConfirmClear(true), !remote || !view || view.state !== 'ready')),
      confirmClear ? h('div', { role: 'group', 'aria-label': 'Confirm clearing local diagnostics' },
        h('p', null, 'Delete collected aggregates and request observations? Collection controls keep their current enabled/paused settings. This does not clear account settings or conversation history.'),
        control('Confirm clear', () => { setConfirmClear(false); void run(value => value.clear()) }),
        control('Cancel', () => setConfirmClear(false))) : null),
    view ? h('details', null,
      h('summary', null, 'Data scope, limits and JSON'),
      h('p', { style: { margin: 0 } },
        'Aggregates stay in this profile for 14 days; request observations for 24 hours. Auto rows contain policy/model/cohort dimensions and aggregate counts only; no Session or turn IDs, conversation content, upload or automatic tuning. Expired counts are strata, not removed decisions.'),
      h('p', { style: { margin: 0 } },
        `Host pending: ${view.snapshot.pending.reduce((sum, row) => sum + row.count, 0)}. Host dropped: ${view.snapshot.dropped}; Client dropped: ${view.snapshot.clientDropped}; Client unconfirmed: ${view.snapshot.clientUnconfirmed}; evicted/expired: ${view.snapshot.evicted}; saturated: ${view.snapshot.saturated}. At most 4,096 aggregate rows and 2 MiB. Client pending samples are periodic observations, not a live outstanding count. Other settled includes policy rejection, revocation, environment faults and unknown/no-checkpoint results. Stock/custom-engine physical summaries, native recovery opt-out, OAuth, quota and unwrapped RPCs are not covered.`),
      h('details', null, h('summary', null, requests ? 'Review local diagnostics JSON' : 'Review aggregate-only JSON'),
        h('p', { style: { margin: 0 } }, 'Review before sharing. This includes build versions and diagnostic counts; when request observations were enabled it also includes request times, model IDs, byte counts and random stream IDs, never account or Session identifiers. Client timing does not prove supplier receipt or fault ownership.'),
        control('Prepare current JSON', () => setExported(true)),
        exported ? h('textarea', { 'aria-label': requests ? 'Local diagnostics JSON' : 'Local diagnostics aggregate JSON', readOnly: true,
          value: JSON.stringify(view, null, 2), rows: 12, style: { width: '100%', boxSizing: 'border-box', font: 'inherit' } }) : null)) : null)
}
