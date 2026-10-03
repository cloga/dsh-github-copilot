// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it } from 'vitest'
import { TurnUsageNotice } from '../src/turn-usage-notice.ts'
import type { TurnUsageDiagnostic } from '../src/turn-usage-evidence.ts'

const cleanups: Array<() => void> = []
afterEach(async () => { await act(async () => cleanups.splice(0).forEach(fn => fn())); document.body.replaceChildren() })
async function mount(diagnostic: TurnUsageDiagnostic, locale = 'en') {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  cleanups.push(() => root.unmount())
  await act(async () => root.render(createElement(TurnUsageNotice, { diagnostic, locale })))
  return container
}
it('keeps the fixed-height footer compact and opens a bounded nonmodal explanation', async () => {
  const container = await mount({ localPreDispatchBlocks: 1, unreportedAttempts: 2, incompleteHistory: false })
  const trigger = container.querySelector('button')!
  expect(trigger.textContent).toBe('Turn Usage incomplete')
  expect(container.querySelector('[role=dialog]')).toBeNull()
  await act(async () => trigger.click())
  expect(container.textContent).toContain('1 local input-budget block')
  expect(container.textContent).toContain('2 other settlements')
  expect(container.textContent).toContain('not zero usage, a partial total')
  expect(container.textContent).not.toContain('tokens')
  expect(container.querySelector<HTMLElement>('[role=dialog]')?.style.maxWidth).toBe('calc(100vw - 24px)')
  expect(container.querySelector<HTMLElement>('[role=dialog]')?.style.position).toBe('fixed')
  expect(document.activeElement?.textContent).toBe('Close')
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
  expect(document.activeElement).toBe(trigger)
  expect(container.querySelector('[role=dialog]')).toBeNull()
})
it('localizes uncertainty without claiming a generic failure was not billed', async () => {
  const container = await mount({ localPreDispatchBlocks: 0, unreportedAttempts: 1, incompleteHistory: true }, 'zh-CN')
  await act(async () => container.querySelector('button')!.click())
  expect(container.querySelector('[role=dialog]')?.getAttribute('aria-label')).toBe('本轮用量统计不完整')
  expect(container.textContent).toContain('不能据此判断请求是否发出或计费')
  expect(container.textContent).toContain('本页未保留完整轮次证据')
  expect(container.textContent).not.toContain('本地输入预算拦截')
})
it('explains unknown accounting instead of inventing a reason', async () => {
  const container = await mount({ localPreDispatchBlocks: 0, unreportedAttempts: 0, incompleteHistory: false })
  await act(async () => container.querySelector('button')!.click())
  expect(container.textContent).toContain('does not identify a cause')
  expect(container.textContent).not.toContain('before provider dispatch')
})
it('dismisses on outside focus and removes its global listeners after unmount', async () => {
  const container = await mount({ localPreDispatchBlocks: 1, unreportedAttempts: 0, incompleteHistory: false })
  await act(async () => container.querySelector('button')!.click())
  const outside = document.createElement('button')
  document.body.append(outside)
  await act(async () => outside.focus())
  expect(container.querySelector('[role=dialog]')).toBeNull()
  expect(document.activeElement).toBe(outside)
})
it('explains known timeout, record identity and recovery without implying restored accounting', async () => {
  const container = await mount({ localPreDispatchBlocks: 0, unreportedAttempts: 2, incompleteHistory: false,
    requestBodyTimeouts: 1, timeoutDetails: [{ step: 2, seq: 42, recovered: true }] })
  await act(async () => container.querySelector('button')!.click())
  expect(container.textContent).toContain('1 attempt without usage has a recorded HTTP 408')
  expect(container.textContent).toContain('Step 2 · record 42')
  expect(container.textContent).toContain('same-step retry completed successfully')
  expect(container.textContent).toContain('usage is still missing')
  expect(container.textContent).toContain('1 other settlement')
  expect(container.textContent).not.toContain('COPILOT_REQUEST_BODY_TIMEOUT')
})
it('localizes unknown retry evidence and bounded detail disclosure', async () => {
  const container = await mount({ localPreDispatchBlocks: 0, unreportedAttempts: 9, incompleteHistory: true,
    requestBodyTimeouts: 9, timeoutDetails: [{ recovered: false }] }, 'zh-CN')
  await act(async () => container.querySelector('button')!.click())
  expect(container.textContent).toContain('步骤未知')
  expect(container.textContent).toContain('没有足够证据确认')
  expect(container.textContent).toContain('最多 8 条')
  expect(container.textContent).not.toContain('另有')
})
