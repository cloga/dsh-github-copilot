import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
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
  { id: 'tools', name: '@deepseek-ai/dsh-tools', config: { mode: 'native' } },
  { id: 'tool-web', name: '@deepseek-ai/dsh-tool-web', config: { searchMaxResults: 1, searchMaxQueries: 1, searchTimeoutMs: 7000, fetch: false } },
]

function selection(provider: string): Agent {
  return { id: provider, session: { requestHeader: () => ({ config: { provider, model: 'synthetic-model' } }) } } as unknown as Agent
}

describe('built routed-web bundle with the public Loader', () => {
  it('preserves official row config and uses the name as a guard', () => {
    const bundle = loadOverlayPatches('test', bundlePath)
    const rows = composeEntries([[{ insert: base }], bundle])
    expect(rows.find(row => row.id === 'web')).toMatchObject({ name: '@deepseek-ai/dsh-web', config: base[0]!.config, isolate: { web: 'github-copilot-original-web' } })
    expect(rows.find(row => row.id === 'tool-web')).toEqual(base[3])
    const warnings: string[] = []
    const custom = composeEntries([[{ insert: [{ id: 'web', name: 'custom-web', config: { preserved: true } }] }], bundle], message => warnings.push(message))
    expect(custom.find(row => row.id === 'web')).toEqual({ id: 'web', name: 'custom-web', config: { preserved: true } })
    expect(warnings.join('\n')).toContain('name mismatch')
  })

  it('loads the built facade and delegate entries without changing official tools', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'copilot-route-loader-'))
    owned.push(() => rm(directory, { recursive: true, force: true }))
    const config = join(directory, 'cordis.json')
    await writeFile(config, JSON.stringify(base))
    const observed: string[] = []
    const owner = selection('github-copilot')
    const nativeOwner = selection('deepseek-official')
    // Vitest does not expose Node's internal module loader. Resolve this package's
    // public export specifiers explicitly; the real Loader still mounts the exact
    // built modules and evaluates the unchanged isolate/config patch semantics.
    const resolve = createRequire(new URL('../package.json', import.meta.url))
    const bundle = loadOverlayPatches('test', bundlePath).map(patch => patch.insert === undefined ? patch : {
      ...patch,
      insert: patch.insert.map(entry => ({ ...entry, name: entry.name?.startsWith('dsh-github-copilot/') ? pathToFileURL(resolve.resolve(entry.name)).href : entry.name })),
    })
    const patches = [...bundle, { id: 'github-copilot', disabled: true }]
    const ctx = await boot('copilot-route-test', config, patches, (root: Context) => {
      root.plugin({
        name: 'synthetic-initiators',
        apply(c) {
          new AgentRegistry(c)
          c.provide('githubCopilotSearchRouter', {
            search: async () => { observed.push('copilot'); return { content: 'Copilot result', sources: [{ url: 'https://example.com/copilot' }], truncated: false } },
          })
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
    const run = (agent: Agent, queries: string[]) => ctx.get('agents')!.withInitiator(agent, () => ctx.get('tools')!.execute({ callId: `loader-${agent.id}` as ToolCallId, name: 'web_search', arguments: { queries }, agent, signal: new AbortController().signal }))
    expect((await run(owner, ['copilot query'])).isError).toBe(false)
    expect((await run(nativeOwner, ['native query'])).isError).toBe(false)
    expect(observed).toEqual(['copilot', 'existing'])
    expect((await run(owner, ['one', 'two'])).isError).toBe(true)
    expect(observed).toHaveLength(2)
    expect(ctx.get('tools')!.get('web_search')?.timeoutMs).toBe(7000)
  })
})
