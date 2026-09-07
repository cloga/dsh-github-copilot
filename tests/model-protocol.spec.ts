import { Context } from '@deepseek-ai/cordis'
import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all'
import { describe, expect, it, vi } from 'vitest'
import { isPluginPreviewProvider, projectModelFacts, readCopilotCatalog, readPreviewCatalog } from '../src/model-protocol.ts'
import { GITHUB_COPILOT_PREVIEW_PROVIDER_ID } from '../src/copilot-identity.ts'

describe('plugin-local model facts', () => {
  it('does not query or require an unshipped Core metadata service', () => {
    const ctx = new Context()
    const get = vi.fn(() => { throw new Error('Core service access is not permitted') })
    ctx.get = get as typeof ctx.get
    const catalog = readCopilotCatalog(ctx)
    expect(catalog.authoritative).toBe(false)
    expect(catalog.models.length).toBeGreaterThan(0)
    expect(get).not.toHaveBeenCalled()
  })
  it('uses local native facts as authority only for the plugin-owned preview', () => {
    const catalog = readPreviewCatalog()
    expect(catalog.authoritative).toBe(true)
    expect(catalog.models).toEqual(getBuiltinModels('github-copilot').map(projectModelFacts))
  })
  it('projects owned arrays and headers without mutating the shared native catalog', () => {
    const native = getBuiltinModels('github-copilot')[0]!
    const facts = projectModelFacts(native)
    expect(facts.input).not.toBe(native.input)
    expect(facts.headers).not.toBe(native.headers)
    const before = [...native.input]
    Reflect.set(facts.input, '0', 'changed-for-test')
    expect(native.input).toEqual(before)
  })
  it('scopes preview contributions to the plugin-owned service and exact route id', () => {
    const ctx = new Context()
    ctx.get = (() => undefined) as typeof ctx.get
    expect(isPluginPreviewProvider(ctx, GITHUB_COPILOT_PREVIEW_PROVIDER_ID)).toBe(false)
    const get = vi.fn((name: string) => name === 'githubCopilotPreview'
      ? { getView: () => ({ provider: GITHUB_COPILOT_PREVIEW_PROVIDER_ID }) } : undefined)
    ctx.get = get as typeof ctx.get
    expect(isPluginPreviewProvider(ctx, 'another-preview')).toBe(false)
    expect(get).not.toHaveBeenCalled()
    expect(isPluginPreviewProvider(ctx, GITHUB_COPILOT_PREVIEW_PROVIDER_ID)).toBe(true)
  })
})
