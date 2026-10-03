// @vitest-environment jsdom
import { act, createElement } from 'react'
import type { ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { installAutoModelPresentation } from '../src/auto-model-presentation.ts'
import { TURN_USAGE_EVIDENCE_KEY } from '../src/turn-usage-evidence.ts'

const cleanups: Array<() => void> = []
afterEach(async () => { await act(async () => cleanups.splice(0).forEach(fn => fn())); document.body.replaceChildren() })
async function mount({ provider = 'github-copilot-preview', tokenUsage, hasEvidence = true, remoteFails = false, seq = 42, locale = 'en' }: {
  provider?: string; tokenUsage?: unknown; hasEvidence?: boolean; remoteFails?: boolean; seq?: number; locale?: string
} = {}) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  let Entry: ComponentType<Record<string, unknown>> | undefined
  const get = vi.fn(async () => ({ ok: !remoteFails, value: { mode: 'unknown' } }))
  const diagnostic = vi.fn()
  cleanups.push(installAutoModelPresentation({
    remote: { githubCopilotTurnSelection: { get } }, diagnostic,
    locale: { getLocale: () => ({ active: locale }), subscribe: () => () => {} },
    slots: {
      spec: () => ({ kind: 'list', scope: 'session' }),
      inject: (_: string, setup: () => () => void) => setup(),
      register: (_: unknown, component: ComponentType<Record<string, unknown>>) => { Entry = component; return () => {} },
    },
  }))
  const evidence = hasEvidence ? { ended: true, hasStart: true, localPreDispatchBlocks: 1, unreportedAttempts: 0 } : undefined
  const provenance = { ended: true, incomplete: true, routes: [{ provider, model: 'fixture' }] }
  const turn = { turn: 228, data: { source: (key: string) => ({
    getSnapshot: () => key === TURN_USAGE_EVIDENCE_KEY ? evidence
      : key === 'github-copilot-turn-model-provenance' ? provenance : undefined,
    subscribe: () => () => {},
  }) } }
  const snapshot = { nodes: new Map([['tail', { kind: 'turn-tail', location: { turn },
    data: { turn: 228, seq, tokenUsage, closing: { finalNode: { messageId: 'reply' } } } }]]) }
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  cleanups.push(() => root.unmount())
  if (!Entry) throw new Error('Missing fixture entry')
  await act(async () => root.render(createElement(Entry, {
    sessionId: 'fixture-session', messageId: 'reply', useChat: (selector: (value: unknown) => unknown) => selector(snapshot),
  })))
  return { container, get, diagnostic }
}
function usageButton(container: HTMLElement): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Turn Usage unavailable')
  if (!button) throw new Error('Missing fixture diagnostic trigger')
  return button
}
it('explains native missing usage even when the independent selection Remote fails', async () => {
  const { container, get } = await mount({ remoteFails: true })
  expect(container.textContent).toContain('Selection unavailable')
  await act(async () => usageButton(container).click())
  expect(container.textContent).toContain('before provider dispatch')
  expect(get).toHaveBeenCalledExactlyOnceWith('fixture-session', 228)
})
it('does not duplicate complete native usage or expose a diagnostic on other providers', async () => {
  for (const options of [{ tokenUsage: { totalTokens: 32601 } }, { provider: 'other', hasEvidence: false }, { seq: -1 }]) {
    expect((await mount(options)).container.textContent).not.toContain('Turn Usage unavailable')
  }
})
it('distinguishes unavailable historical projection from a known local block', async () => {
  const { container, diagnostic } = await mount({ hasEvidence: false })
  await act(async () => usageButton(container).click())
  expect(container.textContent).toContain('does not identify a cause')
  expect(container.textContent).toContain('Complete turn evidence is not retained')
  expect(container.textContent).not.toContain('before provider dispatch')
  expect(diagnostic).toHaveBeenCalledWith('COPILOT_TURN_USAGE_EVIDENCE_UNAVAILABLE')
})
it('localizes evidence without reading the current picker or repeating model names', async () => {
  const { container } = await mount({ locale: 'zh-CN' })
  expect(container.textContent).toContain('本轮 Usage 不可用')
  expect(container.textContent).not.toContain('fixture')
})
