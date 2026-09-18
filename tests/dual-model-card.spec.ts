// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DualModelCard } from '../src/dual-model-card.ts'
import type { DualModelCardProps, DualModelConfig, DualModelRemote, DualModelView, Result } from '../src/dual-model-card.ts'

const cleanups: Array<() => void> = []
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }) })
afterEach(async () => {
  await act(async () => { for (const cleanup of cleanups.splice(0)) cleanup() })
  vi.restoreAllMocks()
  document.body.replaceChildren()
})
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}
const ok = <T,>(value: T): Result<T> => ({ ok: true, value })
const failure = (code = 'UNKNOWN'): Result<never> => ({ ok: false, error: { code, message: 'PRIVATE_TOKEN_DO_NOT_RENDER' } })
function view(overrides: Partial<DualModelView> = {}): DualModelView {
  return { supported: true, writable: true, revision: 4,
    configuration: { enabled: false, plannerModel: '', executorModel: '' },
    models: [{ id: 'plan-model', name: 'Planning model' }, { id: 'code-model', name: 'Coding model' }],
    workspaces: [{ id: 'project-a', name: 'Project A' }, { id: 'project-b', name: 'Project B' }], ...overrides }
}
const enabled: DualModelConfig = { enabled: true, plannerModel: 'plan-model', executorModel: 'code-model' }
function remotes(initial = view()) {
  return {
    view: vi.fn<DualModelRemote['view']>(async () => ok(initial)),
    save: vi.fn<DualModelRemote['save']>(async input => ok(view({ configuration: input.configuration, revision: input.expectedRevision + 1 }))),
    create: vi.fn<DualModelRemote['create']>(async () => ok({ sessionId: 'created-session' })),
  }
}
async function mount(remote: DualModelRemote, options: Omit<DualModelCardProps, 'remote'> = {}) {
  const container = document.createElement('div')
  document.body.append(container)
  let root: Root | undefined = createRoot(container)
  const render = async (next: DualModelRemote = remote, props = options) => {
    await act(async () => { root!.render(createElement(DualModelCard, { remote: next, ...props })) })
  }
  const unmount = () => { root?.unmount(); root = undefined }
  cleanups.push(unmount)
  await render()
  return { container, render, unmount,
    field<T extends HTMLElement = HTMLButtonElement>(name: string): T {
      const element = container.querySelector<T>(`[data-dsh-dual-model-${name}]`)
      expect(element, name).not.toBeNull()
      return element!
    },
    text: () => container.textContent ?? '',
  }
}
type Card = Awaited<ReturnType<typeof mount>>
async function click(card: Card, name: string) { await act(async () => { card.field(name).click() }) }
async function select(card: Card, name: string, value: string) {
  await act(async () => {
    const field = card.field<HTMLSelectElement>(name)
    field.value = value
    field.dispatchEvent(new Event('change', { bubbles: true }))
  })
}
async function configure(card: Card) {
  await click(card, 'enabled')
  await select(card, 'planner', 'plan-model')
  await select(card, 'executor', 'code-model')
}

describe('scoped Copilot dual-model card in the real React DOM', () => {
  it.each([true, false])('pairs theme foregrounds with opaque select and option surfaces (writable=%s)', async writable => {
    const remote = remotes(view({ writable }))
    const card = await mount(remote)
    for (const name of ['planner', 'executor', 'workspace']) {
      const control = card.field<HTMLSelectElement>(name)
      expect(control.style.backgroundColor).toBe('var(--dsw-alias-bg-layer-1, Canvas)')
      expect(control.style.color).toBe(writable ? 'var(--dsw-alias-label-primary, CanvasText)' : 'var(--dsw-alias-label-secondary, GrayText)')
      for (const option of Array.from(control.options)) {
        expect(option.style.backgroundColor).toBe('var(--dsw-alias-bg-layer-1, Canvas)')
        expect(option.style.color).toBe(option.disabled ? 'var(--dsw-alias-label-secondary, GrayText)' : 'var(--dsw-alias-label-primary, CanvasText)')
      }
    }
    expect(remote.save).not.toHaveBeenCalled()
    expect(remote.create).not.toHaveBeenCalled()
  })

  it('keeps unavailable saved model and workspace options themed without replacing their values', async () => {
    const configuration = { ...enabled, plannerModel: 'retired-model' }
    const remote = remotes(view({ configuration }))
    const card = await mount(remote)
    await select(card, 'workspace', 'project-b')
    remote.view.mockResolvedValueOnce(ok(view({ configuration, workspaces: [{ id: 'project-a', name: 'Project A' }] })))
    await click(card, 'reload')
    for (const [name, value] of [['planner', 'retired-model'], ['workspace', 'project-b']] as const) {
      const control = card.field<HTMLSelectElement>(name)
      expect(control.value).toBe(value)
      const option = Array.from(control.options).find(item => item.value === value)!
      expect(option.disabled).toBe(true)
      expect(option.style.backgroundColor).toBe('var(--dsw-alias-bg-layer-1, Canvas)')
      expect(option.style.color).toBe('var(--dsw-alias-label-secondary, GrayText)')
    }
    expect(remote.save).not.toHaveBeenCalled()
    expect(remote.create).not.toHaveBeenCalled()
  })
  it.each([['en-US', 'Model roles', 'Save configuration'], ['zh-CN', '模型分工', '保存配置']] as const)(
    'renders localized, labeled controls and defaults off: %s', async (locale, title, save) => {
      const remote = remotes()
      const card = await mount(remote, { locale })
      expect(card.text()).toContain(title)
      expect(card.field('save').textContent).toBe(save)
      expect(card.field<HTMLInputElement>('enabled').checked).toBe(false)
      expect(card.field('create').disabled).toBe(true)
      expect(card.container.querySelector('input:not([type="checkbox"])')).toBeNull()
      for (const name of ['enabled', 'planner', 'executor', 'workspace']) {
        const control = card.field(name)
        expect(control.id).not.toBe('')
        expect(card.container.querySelector(`label[for="${control.id}"]`)).not.toBeNull()
      }
      expect(card.container.querySelector('[aria-live="polite"]')).not.toBeNull()
      expect(remote.save).not.toHaveBeenCalled()
      expect(remote.create).not.toHaveBeenCalled()
    })

  it('requires two catalog models, saves with CAS, and creates only the saved configuration', async () => {
    const remote = remotes()
    const onOpenSession = vi.fn()
    const card = await mount(remote, { onOpenSession })
    await click(card, 'enabled')
    expect(card.field('save').disabled).toBe(true)
    await select(card, 'planner', 'plan-model')
    expect(card.field('save').disabled).toBe(true)
    await select(card, 'executor', 'code-model')
    await select(card, 'workspace', 'project-b')
    expect(card.field('create').disabled).toBe(true)
    expect(card.text()).toContain('Save your changes before creating a session')
    await click(card, 'save')
    expect(remote.save).toHaveBeenCalledExactlyOnceWith({ configuration: enabled, expectedRevision: 4 })
    expect(card.text()).toContain('Acceptance always uses the planning model')
    expect(card.text()).toContain('global default')
    await click(card, 'create')
    expect(remote.create).toHaveBeenCalledExactlyOnceWith({ requestId: expect.any(String), workspaceId: 'project-b', expectedRevision: 5 })
    expect(remote.create.mock.calls[0]![0].requestId).toMatch(/^[0-9a-f-]{36}$/i)
    expect(onOpenSession).toHaveBeenCalledExactlyOnceWith('created-session')
  })

  it('allows saving off with unavailable models but never creates or silently replaces them', async () => {
    const remote = remotes(view({ configuration: { ...enabled, plannerModel: 'retired-model' } }))
    const card = await mount(remote)
    expect(card.field<HTMLSelectElement>('planner').value).toBe('retired-model')
    expect(card.text()).toContain('retired-model')
    expect(card.text()).toContain('unavailable')
    expect(card.field('save').disabled).toBe(true)
    expect(card.field('create').disabled).toBe(true)
    await click(card, 'enabled')
    expect(card.field('save').disabled).toBe(false)
    await click(card, 'save')
    expect(remote.save).toHaveBeenCalledExactlyOnceWith({ expectedRevision: 4,
      configuration: { ...enabled, enabled: false, plannerModel: 'retired-model' } })
  })

  it.each([{ writable: false }, { revision: null }, { supported: false, diagnostic: 'PRIVATE_TOKEN_DO_NOT_RENDER' }])(
    'fails closed for unavailable, readonly, or missing CAS views: %j', async overrides => {
      const remote = remotes(view({ configuration: enabled, ...overrides }))
      const card = await mount(remote)
      expect(card.field('save').disabled).toBe(true)
      expect(card.field('create').disabled).toBe(true)
      expect(card.field<HTMLInputElement>('enabled').disabled).toBe(true)
      expect(card.text()).not.toContain('PRIVATE_')
      await click(card, 'save')
      await click(card, 'create')
      expect(remote.save).not.toHaveBeenCalled()
      expect(remote.create).not.toHaveBeenCalled()
    })

  it('remains read-only while loading and retries a failed load without revealing remote errors', async () => {
    const remote = remotes()
    const pending = deferred<Result<DualModelView>>()
    remote.view.mockReturnValueOnce(pending.promise)
    const card = await mount(remote)
    expect(card.text()).toContain('Loading')
    expect(card.field('save').disabled).toBe(true)
    await act(async () => { pending.resolve(failure()) })
    expect(card.text()).not.toContain('PRIVATE_')
    expect(card.text()).toContain('Could not load')
    await click(card, 'reload')
    expect(remote.view).toHaveBeenCalledTimes(2)
    expect(card.field<HTMLInputElement>('enabled').disabled).toBe(false)
  })

  it('requires explicit reload after conflict and does not replace a dirty draft automatically', async () => {
    const remote = remotes()
    remote.save.mockResolvedValueOnce(failure('DUAL_MODEL_REVISION_CONFLICT'))
    const card = await mount(remote)
    await configure(card)
    await click(card, 'save')
    expect(card.text()).toContain('changed elsewhere')
    expect(card.field<HTMLSelectElement>('planner').value).toBe('plan-model')
    expect(card.field('save').disabled).toBe(true)
    expect(remote.view).toHaveBeenCalledTimes(1)
    remote.view.mockResolvedValueOnce(ok(view({ configuration: enabled, revision: 9 })))
    await click(card, 'reload')
    await select(card, 'executor', 'plan-model')
    await click(card, 'save')
    expect(remote.save.mock.calls[1]![0].expectedRevision).toBe(9)
  })

  it('fails closed if models disappear after an explicit reload', async () => {
    const remote = remotes(view({ configuration: enabled }))
    const card = await mount(remote)
    await select(card, 'workspace', 'project-a')
    expect(card.field('create').disabled).toBe(false)
    remote.view.mockResolvedValueOnce(ok(view({ configuration: enabled, models: [] })))
    await click(card, 'reload')
    expect(card.field<HTMLSelectElement>('planner').value).toBe('plan-model')
    expect(card.field<HTMLSelectElement>('executor').value).toBe('code-model')
    expect(card.field('save').disabled).toBe(true)
    expect(card.field('create').disabled).toBe(true)
  })

  it('rejects synchronous duplicate save clicks before React commits disabled state', async () => {
    const remote = remotes()
    const pending = deferred<Result<DualModelView>>()
    remote.save.mockReturnValueOnce(pending.promise)
    const card = await mount(remote)
    await configure(card)
    await act(async () => { card.field('save').click(); card.field('save').click() })
    expect(remote.save).toHaveBeenCalledTimes(1)
    expect(card.field('reload').disabled).toBe(true)
    await act(async () => { pending.resolve(ok(view({ configuration: enabled, revision: 5 }))) })
    expect(card.text()).toContain('Saved')
  })

  it('retries an uncertain creation with the identical request, workspace and revision, never automatically', async () => {
    const remote = remotes(view({ configuration: enabled }))
    const pending = deferred<Result<{ sessionId: string }>>()
    remote.create.mockReturnValueOnce(pending.promise)
    const onOpenSession = vi.fn()
    const card = await mount(remote, { onOpenSession })
    await select(card, 'workspace', 'project-a')
    await act(async () => { card.field('create').click(); card.field('create').click() })
    expect(remote.create).toHaveBeenCalledTimes(1)
    const original = remote.create.mock.calls[0]![0]
    await act(async () => { pending.reject(new Error('PRIVATE_NETWORK_ERROR')) })
    expect(card.text()).toContain('not confirmed')
    expect(card.text()).not.toContain('PRIVATE_')
    expect(card.field('workspace').disabled).toBe(true)
    expect(card.field('reload').disabled).toBe(true)
    expect(card.field('save').disabled).toBe(true)
    expect(remote.create).toHaveBeenCalledTimes(1)
    await click(card, 'create')
    expect(remote.create.mock.calls[1]![0]).toEqual(original)
    expect(onOpenSession).toHaveBeenCalledExactlyOnceWith('created-session')
  })

  it('retains an uncertain request across unmount with the same Remote owner', async () => {
    const remote = remotes(view({ configuration: enabled }))
    remote.create.mockResolvedValueOnce(failure())
    const oldOpen = vi.fn()
    const first = await mount(remote, { onOpenSession: oldOpen })
    await select(first, 'workspace', 'project-b')
    await click(first, 'create')
    const input = remote.create.mock.calls[0]![0]
    await act(async () => { first.unmount() })
    const nextOpen = vi.fn()
    const second = await mount(remote, { onOpenSession: nextOpen })
    expect(remote.create).toHaveBeenCalledTimes(1)
    expect(second.field<HTMLSelectElement>('workspace').value).toBe('project-b')
    await click(second, 'create')
    expect(remote.create.mock.calls[1]![0]).toEqual(input)
    expect(oldOpen).not.toHaveBeenCalled()
    expect(nextOpen).toHaveBeenCalledExactlyOnceWith('created-session')
  })

  it.each([['en-US', 'Session created.', 'Open created session'], ['zh-CN', '会话已创建。', '打开已创建的会话']] as const)(
    'shows confirmed status after unmount and recovers without another request: %s', async (locale, status, action) => {
    const remote = remotes(view({ configuration: enabled }))
    const pending = deferred<Result<{ sessionId: string }>>()
    remote.create.mockReturnValueOnce(pending.promise)
    const oldOpen = vi.fn()
    const first = await mount(remote, { onOpenSession: oldOpen })
    await select(first, 'workspace', 'project-a')
    await click(first, 'create')
    await act(async () => { first.unmount() })
    await act(async () => { pending.resolve(ok({ sessionId: 'late-created' })) })
    expect(oldOpen).not.toHaveBeenCalled()
    const nextOpen = vi.fn()
    const second = await mount(remote, { onOpenSession: nextOpen, locale })
    expect(second.container.querySelector('[role="status"]')?.textContent).toBe(status)
    expect(second.field('create').textContent).toBe(action)
    expect(second.text()).not.toContain('needs confirmation')
    expect(second.text()).not.toContain('尚待确认')
    await click(second, 'create')
    expect(remote.create).toHaveBeenCalledTimes(1)
    expect(nextOpen).toHaveBeenCalledExactlyOnceWith('late-created')
  })

  it('ignores responses from an old Remote generation', async () => {
    const old = remotes()
    const pending = deferred<Result<DualModelView>>()
    old.view.mockReturnValueOnce(pending.promise)
    const card = await mount(old)
    const next = remotes(view({ revision: 17, configuration: enabled }))
    await card.render(next)
    await act(async () => { pending.resolve(ok(view({ revision: 99 }))) })
    expect(card.field<HTMLInputElement>('enabled').checked).toBe(true)
    await select(card, 'workspace', 'project-a')
    await click(card, 'create')
    expect(next.create.mock.calls[0]![0].expectedRevision).toBe(17)
    expect(old.create).not.toHaveBeenCalled()
  })

  it('maps only the exact published Remote error details reason, never its message', async () => {
    const remote = remotes()
    remote.save.mockResolvedValueOnce({ ok: false, error: { code: 'copilot/dual-model',
      message: 'PRIVATE_TOKEN_DO_NOT_RENDER', details: { reason: 'DUAL_MODEL_REVISION_CONFLICT' } } })
    const card = await mount(remote, { locale: 'zh-Hant' })
    await configure(card)
    await click(card, 'save')
    expect(card.text()).toContain('设置已在其他位置修改')
    expect(card.text()).not.toContain('PRIVATE_')
    expect(card.field('save').disabled).toBe(true)
  })

  it.each(['load', 'save'] as const)('sanitizes thrown %s errors and enables explicit reload', async operation => {
    const remote = remotes()
    if (operation === 'load') remote.view.mockRejectedValueOnce(new Error('PRIVATE_LOAD_FAILURE'))
    else remote.save.mockRejectedValueOnce(new Error('PRIVATE_SAVE_FAILURE'))
    const card = await mount(remote)
    if (operation === 'save') { await configure(card); await click(card, 'save') }
    expect(card.text()).not.toContain('PRIVATE_')
    expect(card.field('save').disabled).toBe(true)
    expect(card.field('reload').disabled).toBe(false)
    await click(card, 'reload')
    expect(remote.view).toHaveBeenCalledTimes(2)
    expect(card.field<HTMLInputElement>('enabled').disabled).toBe(false)
  })

  it('rejects malformed view and save payloads without rendering unknown fields', async () => {
    const remote = remotes()
    remote.view.mockResolvedValueOnce(ok({ ...view(), models: null, diagnostic: 'PRIVATE_DIAGNOSTIC' } as never))
    const card = await mount(remote)
    expect(card.text()).toContain('Could not load')
    expect(card.text()).not.toContain('PRIVATE_')
    await click(card, 'reload')
    await configure(card)
    remote.save.mockResolvedValueOnce(ok(view({ revision: Number.NaN })))
    await click(card, 'save')
    expect(card.text()).toContain('save was not confirmed')
    expect(card.field('create').disabled).toBe(true)
  })

  it.each([undefined, { ok: true, value: { sessionId: '' } }])('keeps request identity for malformed creation responses: %j', async result => {
    const remote = remotes(view({ configuration: enabled }))
    remote.create.mockResolvedValueOnce(result as never)
    const card = await mount(remote)
    await select(card, 'workspace', 'project-a')
    await click(card, 'create')
    expect(card.text()).toContain('not confirmed')
    expect(card.field('create').disabled).toBe(false)
    await click(card, 'create')
    expect(remote.create.mock.calls[1]![0]).toEqual(remote.create.mock.calls[0]![0])
  })

  it('generates distinct accessible control ids for simultaneous cards', async () => {
    const first = await mount(remotes())
    const second = await mount(remotes())
    for (const name of ['enabled', 'planner', 'executor', 'workspace']) {
      expect(first.field(name).id).not.toBe(second.field(name).id)
    }
  })

  it('joins an in-flight request after explicit remount retry without dispatching another creation', async () => {
    const remote = remotes(view({ configuration: enabled }))
    const pending = deferred<Result<{ sessionId: string }>>()
    remote.create.mockReturnValueOnce(pending.promise)
    const first = await mount(remote)
    await select(first, 'workspace', 'project-a')
    await click(first, 'create')
    await act(async () => { first.unmount() })
    const onOpenSession = vi.fn()
    const second = await mount(remote, { onOpenSession })
    expect(remote.create).toHaveBeenCalledTimes(1)
    await click(second, 'create')
    expect(remote.create).toHaveBeenCalledTimes(1)
    await act(async () => { pending.resolve(ok({ sessionId: 'joined-session' })) })
    expect(onOpenSession).toHaveBeenCalledExactlyOnceWith('joined-session')
  })

  it('retains the request when creation fails after unmount, without invoking an old callback', async () => {
    const remote = remotes(view({ configuration: enabled }))
    const pending = deferred<Result<{ sessionId: string }>>()
    remote.create.mockReturnValueOnce(pending.promise)
    const onOpenSession = vi.fn()
    const first = await mount(remote, { onOpenSession })
    await select(first, 'workspace', 'project-b')
    await click(first, 'create')
    const input = remote.create.mock.calls[0]![0]
    await act(async () => { first.unmount() })
    await act(async () => { pending.reject(new Error('PRIVATE_LATE_ERROR')) })
    const second = await mount(remote)
    expect(onOpenSession).not.toHaveBeenCalled()
    await click(second, 'create')
    expect(remote.create.mock.calls[1]![0]).toEqual(input)
  })

  it.each(['save', 'create'] as const)('ignores a late %s result after replacement by another Remote owner', async operation => {
    const old = remotes(view({ configuration: enabled }))
    const savePending = deferred<Result<DualModelView>>()
    const createPending = deferred<Result<{ sessionId: string }>>()
    old.save.mockReturnValueOnce(savePending.promise)
    old.create.mockReturnValueOnce(createPending.promise)
    const onOpenSession = vi.fn()
    const card = await mount(old, { onOpenSession })
    await select(card, 'workspace', 'project-a')
    await click(card, operation)
    const next = remotes(view({ revision: 17 }))
    await card.render(next)
    await act(async () => {
      savePending.resolve(ok(view({ configuration: enabled, revision: 99 })))
      createPending.resolve(ok({ sessionId: 'old-session' }))
    })
    expect(onOpenSession).not.toHaveBeenCalled()
    expect(card.field<HTMLInputElement>('enabled').checked).toBe(false)
    expect(card.field<HTMLSelectElement>('workspace').value).toBe('')
    await configure(card)
    await click(card, 'save')
    expect(next.save.mock.calls[0]![0].expectedRevision).toBe(17)
  })

  it('does not create when secure request identity generation fails', async () => {
    vi.spyOn(globalThis.crypto, 'randomUUID').mockImplementationOnce(() => { throw new Error('PRIVATE_CRYPTO_ERROR') })
    const remote = remotes(view({ configuration: enabled }))
    const card = await mount(remote)
    await select(card, 'workspace', 'project-a')
    await click(card, 'create')
    expect(remote.create).not.toHaveBeenCalled()
    expect(card.text()).toContain('Secure request IDs are unavailable')
    expect(card.text()).not.toContain('PRIVATE_')
  })

  it('does not turn navigation failure into another session creation', async () => {
    const remote = remotes(view({ configuration: enabled }))
    const card = await mount(remote, { onOpenSession: () => { throw new Error('PRIVATE_NAVIGATION_ERROR') } })
    await select(card, 'workspace', 'project-a')
    await click(card, 'create')
    expect(remote.create).toHaveBeenCalledTimes(1)
    expect(card.text()).toContain('Session created, but navigation failed')
    expect(card.text()).not.toContain('PRIVATE_')
  })

  it.each(['DUAL_MODEL_UNSUPPORTED', 'DUAL_MODEL_WORKSPACE_UNAVAILABLE']) (
    'retains the original receipt after response loss and a retry returning %s', async reason => {
      const remote = remotes(view({ configuration: enabled }))
      const receipts = new Map<string, string>()
      let attempts = 0
      remote.create.mockImplementation(async input => {
        attempts++
        if (attempts === 2) return { ok: false, error: { code: 'copilot/dual-model',
          message: 'PRIVATE_RETRY_ERROR', details: { reason, creation: 'uncertain' } } }
        const known = receipts.get(input.requestId)
        if (known) return ok({ sessionId: known })
        receipts.set(input.requestId, `created-${receipts.size + 1}`)
        if (attempts === 1) throw new Error('PRIVATE_RESPONSE_LOST_AFTER_CREATION')
        return ok({ sessionId: receipts.get(input.requestId)! })
      })
      const onOpenSession = vi.fn()
      const card = await mount(remote, { onOpenSession })
      await select(card, 'workspace', 'project-b')
      await click(card, 'create')
      expect(receipts.size).toBe(1)
      expect(onOpenSession).not.toHaveBeenCalled()
      const original = remote.create.mock.calls[0]![0]
      await click(card, 'create')
      expect(card.text()).toContain('not confirmed')
      expect(card.text()).not.toContain('PRIVATE_')
      expect(card.field('workspace').disabled).toBe(true)
      expect(card.field('save').disabled).toBe(true)
      expect(card.field('reload').disabled).toBe(true)
      expect(card.field('create').disabled).toBe(false)
      expect(remote.create).toHaveBeenCalledTimes(2)
      await click(card, 'create')
      expect(remote.create).toHaveBeenCalledTimes(3)
      expect(remote.create.mock.calls.map(([input]) => input)).toEqual([original, original, original])
      expect(receipts.size).toBe(1)
      expect(onOpenSession).toHaveBeenCalledExactlyOnceWith('created-1')
    })

  it.each([
    { code: 'DUAL_MODEL_WORKSPACE_UNAVAILABLE' },
    { code: 'copilot/dual-model', details: { reason: 'DUAL_MODEL_UNSUPPORTED' } },
    { code: 'DUAL_MODEL_WORKSPACE_UNAVAILABLE', creation: 'not-created' },
    { code: 'DUAL_MODEL_WORKSPACE_UNAVAILABLE', details: { creation: 'not-created' } },
    { code: 'copilot/dual-model', details: { reason: 'UNKNOWN_REASON', creation: 'not-created' } },
  ])('never releases a receipt without an explicit known-reason no-creation proof: %j', async error => {
    const remote = remotes(view({ configuration: enabled }))
    remote.create.mockResolvedValueOnce({ ok: false, error })
    const card = await mount(remote)
    await select(card, 'workspace', 'project-a')
    await click(card, 'create')
    const original = remote.create.mock.calls[0]![0]
    expect(card.text()).toContain('not confirmed')
    expect(card.field('workspace').disabled).toBe(true)
    expect(card.field('reload').disabled).toBe(true)
    await click(card, 'create')
    expect(remote.create.mock.calls[1]![0]).toEqual(original)
  })

  it('clears a known failure only with explicit Host proof that no session was created', async () => {
    const remote = remotes(view({ configuration: enabled }))
    remote.create.mockResolvedValueOnce({ ok: false, error: { code: 'copilot/dual-model',
      message: 'PRIVATE_PRECREATE_ERROR', details: { reason: 'DUAL_MODEL_WORKSPACE_UNAVAILABLE', creation: 'not-created' } } })
    const card = await mount(remote)
    await select(card, 'workspace', 'project-a')
    await click(card, 'create')
    expect(card.text()).toContain('workspace is unavailable')
    expect(card.field('reload').disabled).toBe(false)
    expect(card.field('create').disabled).toBe(true)
    expect(card.text()).not.toContain('PRIVATE_')
    const firstRequest = remote.create.mock.calls[0]![0]
    await click(card, 'reload')
    await click(card, 'create')
    expect(remote.create).toHaveBeenCalledTimes(2)
    expect(remote.create.mock.calls[1]![0].requestId).not.toBe(firstRequest.requestId)
  })
})
