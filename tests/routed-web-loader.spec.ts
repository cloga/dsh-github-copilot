import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { boot, composeEntries, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { AgentRegistry } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolCallId } from '@deepseek-ai/dsh-llm'

const packageRoot = fileURLToPath(new URL('../', import.meta.url))
const bundlePath = fileURLToPath(new URL('../cordis.patch.yml', import.meta.url))
const owned: Array<() => Promise<void>> = []
afterEach(async () => { for (const dispose of owned.splice(0).reverse()) await dispose() })

const base = [
  { id: 'web', name: '@deepseek-ai/dsh-web', config: { searchProvider: 'existing-search', fetchProvider: 'existing-fetch' } },
  { id: 'system-prompt', name: '@deepseek-ai/dsh-system-prompt' },
  { id: 'tools', name: '@deepseek-ai/dsh-tools' },
  { id: 'tool-executor-native', name: '@deepseek-ai/dsh-tool-executor-native' },
  { id: 'tool-web', name: '@deepseek-ai/dsh-tool-web', config: { searchMaxResults: 1, searchMaxQueries: 1, searchTimeoutMs: 7000, fetch: false } },
]

function selection(provider: string): Agent {
  return { id: provider, session: { requestHeader: () => ({ config: { provider, model: 'synthetic-model' } }) } } as unknown as Agent
}

describe('native web bundle with the public Loader', () => {
  it('preserves official and custom web entries without adding a facade', () => {
    const bundle = loadOverlayPatches('test', bundlePath)
    const rows = composeEntries([[{ insert: base }], bundle])
    expect(rows.find(row => row.id === 'web')).toEqual(base[0])
    expect(rows.find(row => row.id === 'tool-web')).toEqual(base[4])
    const custom = composeEntries([[{ insert: [{ id: 'web', name: 'custom-web', config: { preserved: true } }] }], bundle])
    expect(custom.find(row => row.id === 'web')).toEqual({ id: 'web', name: 'custom-web', config: { preserved: true } })
    expect(rows.some(row => row.id === 'github-copilot-routed-web' || row.id === 'github-copilot-web-delegate')).toBe(false)
  })

  it('loads and executes the original web provider for every model route', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'copilot-route-loader-'))
    owned.push(() => rm(directory, { recursive: true, force: true }))
    const config = join(directory, 'cordis.json')
    await writeFile(config, JSON.stringify(base))
    const observed: string[] = []
    const owner = selection('github-copilot')
    const nativeOwner = selection('deepseek-official')
    const bundle = loadOverlayPatches('test', bundlePath)
    const patches = [...bundle, { id: 'github-copilot', disabled: true }]
    const ctx = await boot('copilot-route-test', config, patches, (root: Context) => {
      root.plugin({
        name: 'synthetic-initiators',
        apply(c) {
          new AgentRegistry(c)
        },
      })
      root.plugin({
        name: 'synthetic-upstream-providers', inject: ['web'],
        apply(c) {
          c.web.registerSearchProvider({ id: 'existing-search', available: () => true, search: async () => { observed.push('existing'); return { sources: [{ url: 'https://example.com/existing' }], truncated: false } } })
        },
      })
    }, pathToFileURL(join(packageRoot, 'package.json')).href)
    owned.push(async () => { await ctx.fiber.dispose() })
    const run = (agent: Agent, queries: string[]) => ctx.get('agents')!.withInitiator(agent, async () => {
      const batch = await ctx.get('tools')!.execute({ agent, signal: new AbortController().signal,
        calls: [{ type: 'tool-call', id: `loader-${agent.id}` as ToolCallId,
          name: 'web_search', arguments: JSON.stringify({ queries }) }] })
      if (batch.results.length !== 1) throw new Error('expected one tool result')
      return batch.results[0]!.result
    })
    expect((await run(owner, ['copilot query'])).isError).toBe(false)
    expect((await run(nativeOwner, ['native query'])).isError).toBe(false)
    expect(observed).toEqual(['existing', 'existing'])
    expect((await run(owner, ['one', 'two'])).isError).toBe(true)
    expect(observed).toHaveLength(2)
    expect(ctx.get('tools')!.get('web_search')?.timeoutMs).toBe(7000)
  }, 30_000) // Real Loader cold imports compete with the full suite's parallel workers.
})
