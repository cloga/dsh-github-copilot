import { createElement as h, Fragment, useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import { ContinuationDefaultViewSchema, SessionContinuationViewSchema } from './session-continuation-types.ts'
import type { SessionContinuationView } from './session-continuation-types.ts'

export interface SessionContinuationRemote {
  get(agentId: string): Promise<{ ok: boolean; value?: unknown }>
  set(agentId: string, revision: number, enabled: boolean | null): Promise<{ ok: boolean; value?: unknown }>
  authorizeNext?(agentId: string, revision: number, enabled: boolean): Promise<{ ok: boolean; value?: unknown }>
  defaults?(): Promise<{ ok: boolean; value?: unknown }>
  setDefault?(revision: number, enabled: boolean): Promise<{ ok: boolean; value?: unknown }>
}
const control: CSSProperties = { font: 'inherit', color: 'var(--dsw-alias-label-primary, CanvasText)',
  background: 'var(--dsw-alias-bg-layer-1, Canvas)', colorScheme: 'inherit',
  border: '1px solid var(--dsw-alias-border-main, GrayText)', borderRadius: 6, padding: '6px 10px' }
const paragraph: CSSProperties = { color: 'var(--dsw-alias-label-secondary, GrayText)', fontSize: 13, lineHeight: 1.5 }

export function SessionContinuationCard({ sessionId, remote, locale = 'en', running = false, onEnabledChange, expanded = false }: {
  sessionId: string; remote: SessionContinuationRemote | undefined; locale?: string; running?: boolean
  expanded?: boolean
  onEnabledChange?(enabled: boolean): void
}): ReactElement {
  const zh = locale.startsWith('zh')
  const [view, setView] = useState<SessionContinuationView>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const [reload, setReload] = useState(0)
  const owner = useRef(0)
  useEffect(() => { onEnabledChange?.(view?.enabled === true || view?.activeTurnEnabled === true) }, [view, onEnabledChange])
  useEffect(() => {
    const generation = ++owner.current
    setView(undefined); setBusy(true); setError(false)
    void (async () => {
      try {
        const result = await remote?.get(sessionId)
        const parsed = result?.ok ? SessionContinuationViewSchema.safeParse(result.value) : undefined
        if (owner.current !== generation) return
        if (!parsed?.success) setError(true)
        else setView(parsed.data)
      } catch { if (owner.current === generation) setError(true) }
      finally { if (owner.current === generation) setBusy(false) }
    })()
    return () => { owner.current++ }
  }, [remote, sessionId, running, reload])
  const save = async (enabled: boolean | null, next = false) => {
    if (!view || !remote || busy) return
    const generation = owner.current
    setBusy(true); setError(false)
    try {
      const result = next ? await remote.authorizeNext?.(sessionId, view.revision, enabled === true)
        : await remote.set(sessionId, view.revision, enabled)
      const parsed = result?.ok ? SessionContinuationViewSchema.safeParse(result.value) : undefined
      if (owner.current !== generation) return
      if (!parsed?.success) { setView(undefined); setError(true) }
      else setView(parsed.data)
    } catch { if (owner.current === generation) { setView(undefined); setError(true) } }
    finally { if (owner.current === generation) setBusy(false) }
  }
  return h('details', { open: expanded || undefined, 'data-copilot-continuation-settings': '', style: { fontSize: 13 } },
    h('summary', { style: { cursor: 'pointer' } }, zh ? '降级续聊' : 'Visible-history continuation',
      ' · ', !view ? zh ? '状态待确认' : 'Unknown' : view.enabled ? zh ? '开启' : 'On'
        : view.nextTurnAuthorized ? zh ? '仅下一轮' : 'Next turn only' : zh ? '关闭' : 'Off'),
    h('p', { style: paragraph }, zh
      ? '每个新轮次不回放旧加密推理及内嵌摘要，同账号也适用。可见消息、工具记录和磁盘历史不变；可能失去隐含细节。不会自动发送或重试。'
      : 'Every new turn omits old encrypted reasoning and embedded summaries, including on the same account. Visible messages, tool records and disk history stay unchanged; implicit details may be lost. No automatic sending or retries.'),
    h('label', { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
      zh ? '本 Session 默认策略' : 'Session policy',
      h('select', { style: control, disabled: busy || !view, value: view?.source === 'default' ? 'default' : view?.enabled ? 'on' : 'off',
        onChange: (event: { currentTarget: { value: string } }) => void save(event.currentTarget.value === 'default' ? null : event.currentTarget.value === 'on') },
      [['default', zh ? '沿用创建时默认' : 'Use creation-time default'], ['on', zh ? '开启' : 'On'], ['off', zh ? '关闭' : 'Off']].map(([value, label]) =>
        h('option', { key: value, value, style: { background: 'Canvas', color: 'CanvasText' } }, label)))),
    view?.activeTurnEnabled !== undefined && view.activeTurnEnabled !== view.enabled
      ? h('p', { role: 'status', style: paragraph }, zh ? '当前轮保持原策略，变更从下一轮生效。' : 'The active turn keeps its policy; changes apply next turn.') : null,
    view && !view.enabled ? h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 } },
      h('button', { type: 'button', style: control, disabled: busy || !remote?.authorizeNext,
        onClick: () => void save(!view.nextTurnAuthorized, true) },
      view.nextTurnAuthorized ? zh ? '撤销下一轮授权' : 'Revoke next-turn consent' : zh ? '仅下一轮降级' : 'Next turn only'),
      h('button', { type: 'button', style: control, disabled: busy, onClick: () => void save(true) },
        zh ? '一键持续开启' : 'Enable for this Session'),
      h('p', { style: paragraph }, zh
        ? '点击即同意上述损失。仅下一轮授权在该轮结束或 Host 重启后失效。'
        : 'These actions consent to the loss described above. Next-turn consent expires when that turn ends or the Host restarts.')) : null,
    error ? h('p', { role: 'alert', style: paragraph }, 'COPILOT_CONTINUATION_STATUS_UNAVAILABLE',
      h('button', { type: 'button', style: control, onClick: () => setReload(value => value + 1) }, zh ? '重试读取' : 'Retry read')) : null)
}

export function ContinuationDefaultCard({ remote, locale = 'en', onSaved }: {
  remote?: SessionContinuationRemote; locale?: string; onSaved?(): void
}): ReactElement {
  const zh = locale.startsWith('zh')
  const [view, setView] = useState<{ enabled: boolean; revision: number }>()
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [reload, setReload] = useState(0)
  const lifetime = useRef(0)
  useEffect(() => {
    const generation = ++lifetime.current
    setBusy(true); setError(false); setView(undefined)
    void (async () => {
      try {
        const result = await remote?.defaults?.()
        const parsed = result?.ok ? ContinuationDefaultViewSchema.safeParse(result.value) : undefined
        if (generation !== lifetime.current) return
        if (parsed?.success) setView(parsed.data)
        else setError(true)
      } catch { if (generation === lifetime.current) setError(true) }
      finally { if (generation === lifetime.current) setBusy(false) }
    })()
    return () => { lifetime.current++ }
  }, [remote, reload])
  const save = async (enabled: boolean) => {
    if (!view || !remote?.setDefault || busy) return
    const generation = lifetime.current
    setBusy(true); setError(false)
    try {
      const result = await remote.setDefault(view.revision, enabled)
      const parsed = result.ok ? ContinuationDefaultViewSchema.safeParse(result.value) : undefined
      if (generation !== lifetime.current) return
      if (parsed?.success) { setView(parsed.data); onSaved?.() }
      else { setView(undefined); setError(true) }
    } catch { if (generation === lifetime.current) { setView(undefined); setError(true) } }
    finally { if (generation === lifetime.current) setBusy(false) }
  }

  return h('details', null, h('summary', null, zh ? '新 Session 降级默认' : 'New Session continuation default'),
    h('label', null, h('input', { type: 'checkbox', checked: view?.enabled ?? false, disabled: busy || !view,
      onChange: (event: { currentTarget: { checked: boolean } }) => void save(event.currentTarget.checked) }),
    zh ? '新 Session 默认开启降级续聊' : 'Enable visible-history continuation for new Sessions'),
    h('p', { style: paragraph }, zh
      ? '开启即同意新 Session 每轮省略旧加密推理及内嵌摘要，同账号也适用。已有 Session 和继承历史不自动授权，不修改消息或工具记录。'
      : 'Enabling consents to omitting prior encrypted reasoning and embedded summaries each turn, even on the same account. Existing Sessions and seeded histories are not automatically enrolled. Messages and tools are unchanged.'),
    error ? h('p', { role: 'alert' }, 'COPILOT_CONTINUATION_STATUS_UNAVAILABLE',
      h('button', { type: 'button', style: control, onClick: () => setReload(value => value + 1) }, zh ? '重试' : 'Retry')) : null)
}

  interface SwitchConsent {
    readonly view: SessionContinuationView
    readonly resolve: (approved: boolean) => void
  }
  function SwitchConfirmation({ consent, sessionId, remote, locale, done, cancel }: {
    consent: SwitchConsent; sessionId: string; remote: SessionContinuationRemote;
    locale: string; done(approved: boolean): void; cancel(): void
  }): ReactElement {
    const zh = locale.startsWith('zh')
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState(false)
    const active = useRef(true)
    useEffect(() => { active.current = true; return () => { active.current = false; consent.resolve(false); cancel() } }, [consent])
    const choose = async (choice: 'session' | 'next' | 'off') => {
      if (busy) return
      if (choice === 'off') { done(true); return }
      setBusy(true); setError(false)
      try {
        const result = choice === 'session' ? await remote.set(sessionId, consent.view.revision, true)
          : await remote.authorizeNext?.(sessionId, consent.view.revision, true)
        const parsed = result?.ok ? SessionContinuationViewSchema.safeParse(result.value) : undefined
        if (!active.current) return
        if (!parsed?.success || (choice === 'session' ? !parsed.data.enabled : !parsed.data.nextTurnAuthorized)) setError(true)
        else done(true)
      } catch { if (active.current) setError(true) }
      finally { if (active.current) setBusy(false) }
    }
    return h('section', { role: 'group', 'aria-label': zh ? '切换账号前确认' : 'Before switching accounts',
      style: { border: control.border, borderRadius: 6, padding: 10, marginBlock: 10 } },
      h('strong', null, zh ? '此 Session 的降级续聊未开启' : 'Continuation is off for this Session'),
      h('p', { style: paragraph }, zh
        ? '切换账号后，旧加密推理可能被拒绝，但不一定失败。降级每轮省略旧推理及内嵌摘要，保留可见消息与工具记录；可能损失隐含细节。仅下一轮授权在该轮结束或 Host 重启后失效。不会自动重试。'
        : 'After switching, old encrypted reasoning may be rejected; failure is not certain. Continuation omits old reasoning and embedded summaries each turn while keeping visible messages and tools. Implicit details may be lost. Next-turn consent expires when that turn ends or the Host restarts. No automatic retry.'),
      h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8 } },
        h('button', { type: 'button', style: control, disabled: busy, onClick: () => void choose('session') },
          zh ? '持续开启并切换' : 'Enable for Session and switch'),
        h('button', { type: 'button', style: control, disabled: busy || !remote.authorizeNext, onClick: () => void choose('next') },
          zh ? '仅下一轮并切换' : 'Next turn only and switch'),
        h('button', { type: 'button', style: control, disabled: busy, onClick: () => void choose('off') },
          zh ? '保持关闭并切换' : 'Keep off and switch'),
        h('button', { type: 'button', style: control, disabled: busy, onClick: () => done(false) }, zh ? '取消' : 'Cancel')),
      error ? h('p', { role: 'alert', style: paragraph }, zh
        ? '授权保存未确认，账号未切换。取消后重新读取状态再试。'
        : 'Authorization was not confirmed; account not switched. Cancel and read current status before trying again.') : null)
  }

  export function useSessionContinuationSwitch({ sessionId, remote, locale = 'en', changesAccount, running = false }: {
    sessionId: string; remote?: SessionContinuationRemote; locale?: string; running?: boolean;
    changesAccount(accountId: string | null): Promise<boolean>
  }): { beforeAccountChange(accountId: string | null, signal?: AbortSignal): Promise<boolean>; content: ReactElement } {
    const [consent, setConsent] = useState<SwitchConsent>()
    const pending = useRef<SwitchConsent>()
    const generation = useRef(0)
    useEffect(() => {
      setConsent(undefined)
      return () => { generation.current++; pending.current?.resolve(false); pending.current = undefined }
    }, [sessionId, remote])
    const beforeAccountChange = useCallback(async (accountId: string | null, signal?: AbortSignal) => {
      const owner = generation.current
      if (signal?.aborted) return false
      const changed = await changesAccount(accountId)
      if (owner !== generation.current || signal?.aborted) return false
      if (!changed) return true
      const result = await remote?.get(sessionId)
      if (owner !== generation.current || signal?.aborted) return false
      const parsed = result?.ok ? SessionContinuationViewSchema.safeParse(result.value) : undefined
      if (!parsed?.success) throw new Error('COPILOT_CONTINUATION_STATUS_UNAVAILABLE')
      if (parsed.data.enabled || parsed.data.nextTurnAuthorized) return true
      pending.current?.resolve(false)
      return new Promise<boolean>(resolve => {
        let settled = false
        const next: SwitchConsent = { view: parsed.data, resolve: approved => {
          if (settled) return
          settled = true
          signal?.removeEventListener('abort', abort)
          resolve(approved)
        } }
        const abort = () => {
          next.resolve(false)
          if (pending.current === next) { pending.current = undefined; setConsent(undefined) }
        }
        pending.current = next
        signal?.addEventListener('abort', abort, { once: true })
        if (signal?.aborted) { abort(); return }
        setConsent(next)
      })
    }, [remote, sessionId, changesAccount])
    const done = (approved: boolean) => {
      const current = pending.current
      pending.current = undefined
      current?.resolve(approved)
      setConsent(undefined)
    }
    return { beforeAccountChange, content: h(Fragment, null,
      consent && remote ? h(SwitchConfirmation, { key: consent.view.revision, consent, sessionId, remote, locale, done,
        cancel: () => { if (pending.current === consent) done(false) } }) : null,
      h(SessionContinuationCard, { sessionId, remote, locale, running })) }
  }
