import { Context } from '@deepseek-ai/cordis'
import { githubCopilotProvider } from '@earendil-works/pi-ai/providers/github-copilot'
import { describe, expect, it } from 'vitest'
import { installNativeCopilotHeaders } from '../src/native-copilot-headers.ts'
import { copilotPublicHeaders } from '../src/preview-provider.ts'

const endpoint = githubCopilotProvider().getModels()[0]!.baseUrl
const request = { provider: 'github-copilot', model: 'not-in-native-catalog', baseURL: endpoint }

function entries(headers: Headers): [string, string][] {
  const result: [string, string][] = []
  headers.forEach((value, name) => result.push([name, value]))
  return result
}

describe('native Copilot request headers', () => {
  it('fills only missing public IDE headers and removes its contribution on disposal', async () => {
    const ctx = new Context()
    const remove = installNativeCopilotHeaders(ctx)
    try {
      const prepare = (headers: Headers) =>
        ctx.waterfall('llm-pi-ai/request-headers', request, headers, () => headers)
      const headers = new Headers({
        'editor-version': 'explicit-editor/1', 'user-agent': 'native-attribution',
        authorization: 'Bearer synthetic-token', 'x-unrelated': 'preserved',
      })
      expect(prepare(headers)).toBe(headers)
      expect(headers.get('editor-version')).toBe('explicit-editor/1')
      expect(headers.get('editor-plugin-version')).toBe(copilotPublicHeaders()['Editor-Plugin-Version'])
      expect(headers.get('copilot-integration-id')).toBe(copilotPublicHeaders()['Copilot-Integration-Id'])
      expect(headers.get('user-agent')).toBe('native-attribution')
      expect(headers.get('authorization')).toBe('Bearer synthetic-token')
      expect(headers.get('x-unrelated')).toBe('preserved')
      const other = prepare(new Headers())
      expect(other.get('editor-version')).toBe(copilotPublicHeaders()['Editor-Version'])
      expect(other.has('authorization')).toBe(false)
      expect(other.has('user-agent')).toBe(false)
      remove()
      expect(entries(prepare(new Headers()))).toEqual([])
    } finally { remove(); await ctx.fiber.dispose() }
  })

  it('does not contribute to other routes or custom endpoints', async () => {
    const ctx = new Context()
    installNativeCopilotHeaders(ctx)
    try {
      for (const candidate of [
        { ...request, provider: 'other-provider' },
        { ...request, baseURL: 'https://example.com' },
        { ...request, baseURL: `${endpoint}/custom` },
        { ...request, baseURL: `${endpoint}?redirect=other` },
        { ...request, baseURL: 'not a URL' },
        { ...request, baseURL: endpoint.replace('https://', 'http://') },
      ]) {
        const headers = new Headers({ 'x-existing': 'preserved' })
        const next = () => headers
        expect(ctx.waterfall('llm-pi-ai/request-headers', candidate, headers, next)).toBe(headers)
        expect(entries(headers)).toEqual([['x-existing', 'preserved']])
      }
    } finally { await ctx.fiber.dispose() }
  })

  it('composes with other contributors without retaining per-request headers', async () => {
    const ctx = new Context()
    installNativeCopilotHeaders(ctx)
    ctx.on('llm-pi-ai/request-headers', (_request, headers, next) => {
      headers.set('editor-plugin-version', 'other-contributor/1')
      return next()
    })
    try {
      const first = new Headers({ 'x-request': 'one' })
      const second = new Headers({ 'x-request': 'two' })
      for (const headers of [first, second]) {
        ctx.waterfall('llm-pi-ai/request-headers', request, headers, () => headers)
        expect(headers.get('editor-plugin-version')).toBe('other-contributor/1')
      }
      expect(first.get('x-request')).toBe('one')
      expect(second.get('x-request')).toBe('two')
    } finally { await ctx.fiber.dispose() }
  })
})
