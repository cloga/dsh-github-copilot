import { createElement, useCallback, useEffect, useId, useRef, useState } from 'react'
import type { ChangeEvent, CSSProperties, ReactElement } from 'react'

/** Client-owned contracts: no Host implementation or credential imports. */
export interface DualModelConfig {
  enabled: boolean
  plannerModel: string
  executorModel: string
}
export interface DualModelView {
  supported: boolean
  diagnostic?: string
  writable: boolean
  revision: number | null
  configuration: DualModelConfig
  models: readonly { id: string; name: string }[]
  workspaces: readonly { id: string; name: string }[]
}
export type Result<T> = { ok: true; value: T } | { ok: false; error: unknown }
export interface DualModelRemote {
  view(): Promise<Result<DualModelView>>
  save(input: { configuration: DualModelConfig; expectedRevision: number }): Promise<Result<DualModelView>>
  create(input: { requestId: string; workspaceId: string; expectedRevision: number }): Promise<Result<{ sessionId: string }>>
}
export interface DualModelCardProps {
  remote: DualModelRemote
  locale?: string
  onOpenSession?: (id: string) => void
}

type CreateInput = Parameters<DualModelRemote['create']>[0]
type CreateResult = Awaited<ReturnType<DualModelRemote['create']>>
interface Creation {
  readonly input: CreateInput
  flight?: Promise<CreateResult>
  sessionId?: string
}
// Keep uncertain creation identities across card unmounts, but never across Remote
// owners. The integration must retain one adapter object per account surface owner.
// No disk, global default, workspace secrets or automatic request replay is involved.
const creations = new WeakMap<DualModelRemote, Creation>()
const off: DualModelConfig = { enabled: false, plannerModel: '', executorModel: '' }
const copy = {
  en: {
    title: 'Model roles', description: 'The planning model plans and reviews acceptance. The execution model changes code and runs tests.',
    scope: 'Only new dual-model sessions use this configuration. Existing sessions and the global default stay unchanged. Models are never substituted automatically.',
    enabled: 'Enable dual-model sessions', planner: 'Planning model', executor: 'Execution model',
    acceptance: 'Acceptance always uses the planning model.', selectModel: 'Select an available model', unavailable: 'unavailable',
    modelsMissing: 'Choose two available account models to save an enabled configuration. An unavailable saved model is kept, not replaced.',
    workspace: 'Workspace for the new session', selectWorkspace: 'Select a workspace', noWorkspaces: 'No accessible workspaces are available. Reload settings after opening a workspace.',
    save: 'Save configuration', saving: 'Saving…', create: 'Create session with this configuration', creating: 'Creating session…',
    retryCreate: 'Retry the same creation request', openCreated: 'Open created session',
    reload: 'Reload settings', reloadTitle: 'Reload saved values and discard unsaved edits', loading: 'Loading model roles…',
    dirty: 'Save your changes before creating a session.', disabled: 'Dual-model sessions are off. You can save this configuration, but cannot create a dual-model session.',
    readonly: 'These settings are read-only. Ask the deployment owner to enable writes, then reload settings.',
    unsupported: 'Dual-model sessions are unavailable in this deployment. Check plugin support, then reload settings.',
    revision: 'A settings revision is unavailable. Reload settings before saving or creating a session.',
    conflict: 'These settings changed elsewhere. Reload settings to review the saved configuration before trying again.',
    modelUnavailable: 'A selected model is unavailable. Reload settings and choose available account models. No model was substituted.',
    workspaceUnavailable: 'The selected workspace is unavailable. Reload settings and choose an accessible workspace.',
    loadError: 'Could not load model roles. Reload settings to retry.',
    saveError: 'The save was not confirmed. Reload settings to check the saved configuration before trying again.',
    uncertain: 'Session creation is not confirmed. Retry the same request to recover its result without creating a duplicate. Workspace and configuration are held until confirmation.',
    pending: 'A previous creation request needs confirmation. Retry the same request; it is not replayed automatically.',
    saved: 'Saved. This configuration applies only to new dual-model sessions.', created: 'Session created.',
    openError: 'Session created, but navigation failed. Open the created session from the session list.',
    requestUnavailable: 'Secure request IDs are unavailable in this browser. Use a secure browser context before creating a session.',
  },
  zh: {
    title: '模型分工', description: '主模型负责规划与验收；执行模型负责修改代码和运行测试。',
    scope: '仅对新建的双模型会话生效。已有会话和全局默认模型保持不变。不会自动替换模型。',
    enabled: '启用双模型会话', planner: '主模型（规划）', executor: '执行模型',
    acceptance: '验收固定跟随主模型。', selectModel: '选择可用模型', unavailable: '不可用',
    modelsMissing: '启用时须选择两个当前账号可用的模型才能保存。已保存但不可用的模型会保留，不会自动替换。',
    workspace: '新会话的工作区', selectWorkspace: '选择工作区', noWorkspaces: '暂无可访问的工作区。打开工作区后重新加载设置。',
    save: '保存配置', saving: '正在保存…', create: '用此配置新建会话', creating: '正在创建会话…',
    retryCreate: '重试同一创建请求', openCreated: '打开已创建的会话',
    reload: '重新加载设置', reloadTitle: '重新读取已保存的配置，并放弃未保存的修改', loading: '正在加载模型分工…',
    dirty: '请先保存修改，再新建会话。', disabled: '双模型会话已关闭。可以保存配置，但不能新建双模型会话。',
    readonly: '当前设置为只读。请联系部署管理员启用写入后，重新加载设置。',
    unsupported: '当前部署不支持双模型会话。请检查插件支持情况后，重新加载设置。',
    revision: '无法获取设置版本。请重新加载设置后，再保存或新建会话。',
    conflict: '设置已在其他位置修改。请重新加载，检查已保存的配置后再重试。',
    modelUnavailable: '所选模型当前不可用。请重新加载设置并选择可用模型。未自动替换任何模型。',
    workspaceUnavailable: '所选工作区当前不可用。请重新加载设置并选择可访问的工作区。',
    loadError: '无法加载模型分工。请重新加载设置以重试。',
    saveError: '尚未确认保存结果。请重新加载并检查已保存的配置后再重试。',
    uncertain: '尚未确认会话创建结果。请重试同一请求以获取结果，避免重复创建。确认前将保持原工作区和配置不变。',
    pending: '上次创建请求的结果尚待确认。请重试同一请求；不会自动重新提交。',
    saved: '已保存。配置仅用于新建的双模型会话。', created: '会话已创建。',
    openError: '会话已创建，但无法自动打开。请从会话列表打开。',
    requestUnavailable: '当前浏览器无法生成安全的请求标识。请使用安全浏览器环境后再创建会话。',
  },
} as const

type Message = keyof typeof copy.en
const diagnosticMessages: Readonly<Record<string, Message>> = {
  DUAL_MODEL_UNSUPPORTED: 'unsupported',
  DUAL_MODEL_READ_ONLY: 'readonly',
  DUAL_MODEL_REVISION_CONFLICT: 'conflict',
  DUAL_MODEL_MODEL_UNAVAILABLE: 'modelUnavailable',
  DUAL_MODEL_WORKSPACE_UNAVAILABLE: 'workspaceUnavailable',
  DUAL_MODEL_DISABLED: 'disabled',
}
function diagnostic(value: unknown): Message | undefined {
  let code: unknown = value
  if (typeof value === 'object' && value !== null) {
    const details = 'details' in value ? value.details : undefined
    code = typeof details === 'object' && details !== null && 'reason' in details ? details.reason
      : 'code' in value ? value.code : undefined
  }
  return typeof code === 'string' && Object.hasOwn(diagnosticMessages, code) ? diagnosticMessages[code] : undefined
}
/** A reason alone says nothing about an earlier attempt with the same UUID. */
function notCreatedDiagnostic(value: unknown): Message | undefined {
  if (typeof value !== 'object' || value === null || !('details' in value)) return undefined
  const details = value.details
  if (typeof details !== 'object' || details === null || !('creation' in details)
    || details.creation !== 'not-created' || !('reason' in details) || typeof details.reason !== 'string') return undefined
  return diagnostic(details.reason)
}
function validRevision(value: number | null): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}
function validView(value: DualModelView): boolean {
  const namedItems = (items: DualModelView['models']) => Array.isArray(items)
    && items.every(item => item && typeof item.id === 'string' && item.id.length > 0 && typeof item.name === 'string')
    && new Set(items.map(item => item.id)).size === items.length
  return !!value && typeof value.supported === 'boolean' && typeof value.writable === 'boolean'
    && (value.revision === null || validRevision(value.revision))
    && !!value.configuration && typeof value.configuration.enabled === 'boolean'
    && typeof value.configuration.plannerModel === 'string' && typeof value.configuration.executorModel === 'string'
    && namedItems(value.models) && namedItems(value.workspaces)
}
function sameConfig(a: DualModelConfig, b: DualModelConfig): boolean {
  return a.enabled === b.enabled && a.plannerModel === b.plannerModel && a.executorModel === b.executorModel
}

const cardStyle: CSSProperties = {
  display: 'grid', gap: '14px', padding: '18px', marginTop: '16px', minWidth: 0,
  border: '1px solid color-mix(in srgb, currentColor 20%, transparent)',
  borderRadius: '14px', background: 'color-mix(in srgb, currentColor 4%, transparent)',
  overflowWrap: 'anywhere',
}
const fieldStyle: CSSProperties = { display: 'grid', gap: '6px', minWidth: 0 }
const textStyle: CSSProperties = { margin: 0, fontSize: '13px', lineHeight: 1.5 }
const labelStyle: CSSProperties = { fontSize: '13px', fontWeight: 600 }
const controlStyle: CSSProperties = {
  width: '100%', minWidth: 0, boxSizing: 'border-box', padding: '9px 11px', borderRadius: '9px', color: 'inherit',
  border: '1px solid color-mix(in srgb, currentColor 24%, transparent)',
  background: 'color-mix(in srgb, currentColor 3%, transparent)', font: 'inherit',
}
const buttonStyle: CSSProperties = {
  padding: '9px 16px', maxWidth: '100%', borderRadius: '999px', cursor: 'pointer',
  whiteSpace: 'normal', overflowWrap: 'anywhere', font: 'inherit', color: 'inherit',
  border: '1px solid color-mix(in srgb, currentColor 30%, transparent)',
  background: 'color-mix(in srgb, currentColor 10%, transparent)',
}
const styleForButton = (disabled: boolean): CSSProperties => ({ ...buttonStyle, opacity: disabled ? 0.55 : 1, cursor: disabled ? 'not-allowed' : 'pointer' })

/** Additive Models settings card. All mutations belong to the injected scoped Remote. */
export function DualModelCard(props: DualModelCardProps): ReactElement {
  const t = props.locale?.toLowerCase().startsWith('zh') ? copy.zh : copy.en
  const id = useId()
  const [view, setView] = useState<DualModelView>()
  const [draft, setDraft] = useState<DualModelConfig>(off)
  const [workspace, setWorkspace] = useState('')
  const [phase, setPhase] = useState<'loading' | 'idle' | 'saving' | 'creating'>('loading')
  const [message, setMessage] = useState<Message>()
  const [needsReload, setNeedsReload] = useState(false)
  const [pending, setPending] = useState<Creation>()
  const lifecycle = useRef({ active: false, generation: 0, busy: false })

  const load = useCallback(async () => {
    const owner = lifecycle.current
    if (!owner.active || owner.busy) return
    const generation = ++owner.generation
    const current = () => owner.active && owner.generation === generation
    owner.busy = true
    setPhase('loading')
    setMessage(undefined)
    setNeedsReload(true)
    const creation = creations.get(props.remote)
    setPending(creation)
    if (creation) setWorkspace(creation.input.workspaceId)
    try {
      const result = await props.remote.view()
      if (!current()) return
      if (!result.ok || !validView(result.value)) {
        setView(undefined)
        setMessage(!result.ok ? diagnostic(result.error) ?? 'loadError' : 'loadError')
        return
      }
      setView(result.value)
      setDraft({ ...result.value.configuration })
      setNeedsReload(false)
      if (creation) setMessage(creation.sessionId ? 'created' : 'pending')
    } catch {
      if (current()) { setView(undefined); setMessage('loadError') }
    } finally {
      if (current()) { owner.busy = false; setPhase('idle') }
    }
  }, [props.remote])

  useEffect(() => {
    const owner = lifecycle.current
    owner.active = true
    setView(undefined)
    setDraft(off)
    setWorkspace('')
    void load()
    return () => { owner.active = false; owner.generation++; owner.busy = false }
  }, [load])

  const busy = phase !== 'idle'
  const dirty = !!view && !sameConfig(draft, view.configuration)
  const models = view?.models ?? []
  const validModels = models.some(model => model.id === draft.plannerModel)
    && models.some(model => model.id === draft.executorModel)
  const disabled = busy || !!pending || needsReload || !view?.supported || !view.writable || !validRevision(view.revision)
  const saveDisabled = disabled || (draft.enabled && !validModels)
  const createDisabled = pending ? busy : disabled || dirty || !draft.enabled || !validModels
    || !view?.workspaces.some(item => item.id === workspace)

  const save = async () => {
    const owner = lifecycle.current
    if (!owner.active || owner.busy || saveDisabled || !view || !validRevision(view.revision)) return
    owner.busy = true
    const generation = owner.generation
    const current = () => owner.active && owner.generation === generation
    setPhase('saving')
    setMessage(undefined)
    try {
      const result = await props.remote.save({ configuration: { ...draft }, expectedRevision: view.revision })
      if (!current()) return
      if (!result.ok || !validView(result.value)) {
        setNeedsReload(true)
        setMessage(!result.ok ? diagnostic(result.error) ?? 'saveError' : 'saveError')
        return
      }
      setView(result.value)
      setDraft({ ...result.value.configuration })
      setMessage('saved')
    } catch {
      if (current()) { setNeedsReload(true); setMessage('saveError') }
    } finally {
      if (current()) { owner.busy = false; setPhase('idle') }
    }
  }

  const create = async () => {
    const owner = lifecycle.current
    if (!owner.active || owner.busy || createDisabled) return
    let creation = creations.get(props.remote)
    if (!creation) {
      if (!view || !validRevision(view.revision)) return
      try {
        creation = { input: { requestId: globalThis.crypto.randomUUID(), workspaceId: workspace, expectedRevision: view.revision } }
      } catch { setMessage('requestUnavailable'); return }
      creations.set(props.remote, creation)
    }
    const request = creation
    const generation = owner.generation
    const current = () => owner.active && owner.generation === generation
    owner.busy = true
    setPending(request)
    setPhase('creating')
    setMessage(undefined)
    // A remounted card joins the previous flight only after an explicit click.
    // Success is retained for remount recovery; no late response navigates away.
    if (!request.sessionId && !request.flight) {
      request.flight = Promise.resolve().then(() => props.remote.create({ ...request.input }))
        .catch((): CreateResult => ({ ok: false, error: undefined }))
        .then((result): CreateResult => {
          request.flight = undefined
          if (result?.ok === true && typeof result.value?.sessionId === 'string' && result.value.sessionId.length > 0) {
            request.sessionId = result.value.sessionId
            return { ok: true, value: { sessionId: request.sessionId } }
          }
          return { ok: false, error: result?.ok === false ? result.error : undefined }
        })
    }
    const result = request.sessionId ? { ok: true as const, value: { sessionId: request.sessionId } } : await request.flight!
    if (!current()) return
    owner.busy = false
    setPhase('idle')
    if (result.ok && typeof result.value?.sessionId === 'string' && result.value.sessionId.length > 0) {
      creations.delete(props.remote)
      setPending(undefined)
      setMessage('created')
      try { props.onOpenSession?.(result.value.sessionId) } catch { setMessage('openError') }
    } else {
      const notCreated = !result.ok ? notCreatedDiagnostic(result.error) : undefined
      if (notCreated) {
        creations.delete(props.remote)
        setPending(undefined)
        setNeedsReload(true)
        setMessage(notCreated)
      } else setMessage('uncertain')
    }
  }

  const field = (role: 'planner' | 'executor', label: string, value: string) => {
    const missing = value !== '' && !models.some(model => model.id === value)
    return createElement('div', { style: fieldStyle },
      createElement('label', { htmlFor: `${id}-${role}`, style: labelStyle }, label),
      createElement('select', {
        id: `${id}-${role}`, style: controlStyle, value, disabled,
        [`data-dsh-dual-model-${role}`]: true,
        'aria-invalid': draft.enabled && !models.some(model => model.id === value) ? true : undefined,
        'aria-describedby': `${id}-model-help`,
        onChange: (event: ChangeEvent<HTMLSelectElement>) => {
          const value = event.currentTarget.value
          if (disabled || !models.some(model => model.id === value)) return
          setMessage(undefined)
          setDraft(current => ({ ...current, [role === 'planner' ? 'plannerModel' : 'executorModel']: value }))
        },
      },
      createElement('option', { value: '', disabled: true }, t.selectModel),
      missing ? createElement('option', { value, disabled: true }, `${value} (${t.unavailable})`) : null,
      ...models.map(model => createElement('option', { key: model.id, value: model.id }, model.name || model.id))),
    )
  }
  const viewNotice: Message | undefined = !view ? undefined : !view.supported ? diagnostic(view.diagnostic) ?? 'unsupported'
    : !view.writable ? 'readonly' : !validRevision(view.revision) ? 'revision' : undefined
  const status = phase === 'loading' ? t.loading : message ? t[message] : ''
  const shownWorkspace = pending?.input.workspaceId ?? workspace

  return createElement('section', {
    style: cardStyle, 'data-dsh-dual-model-card': true, 'aria-labelledby': `${id}-title`, 'aria-busy': busy,
  },
  createElement('div', null,
    createElement('h3', { id: `${id}-title`, style: { margin: 0, fontSize: '16px' } }, t.title),
    createElement('p', { style: { ...textStyle, marginTop: '5px' } }, t.description),
    createElement('p', { style: { ...textStyle, marginTop: '6px' } }, t.scope)),
  createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '9px' } },
    createElement('input', { type: 'checkbox', id: `${id}-enabled`, checked: draft.enabled, disabled,
      style: { margin: 0, flexShrink: 0 }, 'data-dsh-dual-model-enabled': true,
      onChange: (event: ChangeEvent<HTMLInputElement>) => {
        const enabled = event.currentTarget.checked
        if (disabled) return
        setMessage(undefined)
        setDraft(current => ({ ...current, enabled }))
      } }),
    createElement('label', { htmlFor: `${id}-enabled`, style: labelStyle }, t.enabled)),
  field('planner', t.planner, draft.plannerModel),
  field('executor', t.executor, draft.executorModel),
  createElement('p', { id: `${id}-model-help`, style: textStyle }, t.acceptance,
    view && draft.enabled && !validModels ? ` ${t.modelsMissing}` : ''),
  createElement('div', { style: fieldStyle },
    createElement('label', { htmlFor: `${id}-workspace`, style: labelStyle }, t.workspace),
    createElement('select', { id: `${id}-workspace`, style: controlStyle, disabled, value: shownWorkspace,
      'data-dsh-dual-model-workspace': true,
      onChange: (event: ChangeEvent<HTMLSelectElement>) => {
        const value = event.currentTarget.value
        if (!disabled && view?.workspaces.some(item => item.id === value)) setWorkspace(value)
      } },
    createElement('option', { value: '', disabled: true }, t.selectWorkspace),
    shownWorkspace && !view?.workspaces.some(item => item.id === shownWorkspace)
      ? createElement('option', { value: shownWorkspace, disabled: true }, `${shownWorkspace} (${t.unavailable})`) : null,
    ...(view?.workspaces ?? []).map(item => createElement('option', { key: item.id, value: item.id }, item.name || item.id))),
    view && view.workspaces.length === 0 ? createElement('p', { style: textStyle }, t.noWorkspaces) : null),
  viewNotice ? createElement('p', { style: textStyle }, t[viewNotice]) : null,
  !pending && view && !viewNotice ? createElement('p', { style: textStyle }, dirty ? t.dirty : !draft.enabled ? t.disabled : '') : null,
  createElement('div', { style: { display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center', minWidth: 0 } },
    createElement('button', { type: 'button', style: styleForButton(saveDisabled), disabled: saveDisabled,
      'data-dsh-dual-model-save': true, onClick: () => { void save() } }, phase === 'saving' ? t.saving : t.save),
    createElement('button', { type: 'button', style: styleForButton(createDisabled), disabled: createDisabled,
      'data-dsh-dual-model-create': true, onClick: () => { void create() } },
    phase === 'creating' ? t.creating : pending?.sessionId ? t.openCreated : pending ? t.retryCreate : t.create)),
  createElement('div', { role: 'status', 'aria-live': 'polite', 'aria-atomic': true, style: textStyle }, status),
  createElement('button', { type: 'button', style: { ...styleForButton(busy || !!pending), justifySelf: 'start' },
    disabled: busy || !!pending, title: t.reloadTitle, 'data-dsh-dual-model-reload': true,
    onClick: () => { if (!creations.has(props.remote)) void load() } }, t.reload),
  )
}
