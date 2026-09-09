import { readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, Message } from '@deepseek-ai/dsh-llm'
import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'
import { afterEach, describe, expect, it, vi } from 'vitest'
import previewPlugin from '../src/preview-route.ts'
import { GITHUB_COPILOT_CREDENTIAL_KEY, GITHUB_COPILOT_PREVIEW_PROVIDER_ID as PREVIEW } from '../src/copilot-identity.ts'

const require = createRequire(import.meta.url)
const RC = '0.1.2-rc.1'
const ALPHA = '0.1.3-alpha.1'
const ALPHA_015 = '0.1.5-alpha.1'
const alphaPins = new Map([
  [ALPHA, 'd347e703908d0406b7a7ef80e3a0e594d86b2215'],
  [ALPHA_015, '5dda764ed3aa172535a7967b06ff95d9cbfe536a'],
])
function packageInfo(name: string): { version: string; path: string } {
  const path = realpathSync(require.resolve(`${name}/package.json`))
  const value: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (typeof value !== 'object' || value === null || !('version' in value) || typeof value.version !== 'string') {
    throw new Error('Published Core fixture package metadata is invalid')
  }
  return { version: value.version, path }
}
const taggedEvidence = process.env.DSH_CORE_EVIDENCE === 'tagged-source-runtime'
const packageLocations = new Map([
  ['@deepseek-ai/dsh-llm', 'packages/llm/llm'],
  ['@deepseek-ai/dsh-llm-pi-ai', 'packages/llm/llm-pi-ai'],
  ['@deepseek-ai/dsh-attachment', 'packages/attachment/attachment'],
])
function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid tagged Core evidence object')
  return value as Record<string, unknown>
}
function text(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error('Invalid tagged Core evidence path or version')
  return value
}
const taggedManifestPath = taggedEvidence ? text(process.env.DSH_TAGGED_CORE_MANIFEST) : undefined
const taggedManifest = taggedManifestPath === undefined ? undefined : object(JSON.parse(readFileSync(taggedManifestPath, 'utf8')))
function selectedPackageInfo(name: string): { version: string; path: string } {
  if (taggedManifest === undefined) return packageInfo(name)
  if (!Array.isArray(taggedManifest.packages)) throw new Error('Tagged Core evidence has no package table')
  const entry = taggedManifest.packages.map(object).find(item => item.name === name)
  if (entry === undefined) throw new Error(`Tagged Core evidence is missing ${name}`)
  const relative = packageLocations.get(name)
  if (relative === undefined) throw new Error('Unexpected tagged Core evidence package')
  const root = realpathSync(text(taggedManifest.coreRoot))
  const path = realpathSync(text(entry.manifestPath))
  expect(path).toBe(realpathSync(resolve(root, relative, 'package.json')))
  expect(realpathSync(text(entry.entry))).toBe(realpathSync(resolve(root, relative, 'src/index.ts')))
  const metadata = object(JSON.parse(readFileSync(path, 'utf8')))
  expect(metadata.name).toBe(name)
  expect(entry.version).toBe(metadata.version)
  return { version: text(metadata.version), path }
}
const runtimeInfo = selectedPackageInfo('@deepseek-ai/dsh-llm')
const expectedRelease = process.env.DSH_PUBLISHED_CORE_RELEASE ?? runtimeInfo.version
// An explicitly requested alpha or tagged-source run MUST execute the file
// tests. Wrong installed packages/aliases fail identity checks rather than skip.
const runAlpha = taggedEvidence || alphaPins.has(expectedRelease) || alphaPins.has(runtimeInfo.version)
const evidenceLabel = taggedEvidence ? 'unchanged tagged-source Core fixture' : 'published unmodified Core fixture'
const MODEL = 'published-fixture-model'
const contexts: Context[] = []

async function assertRelease(): Promise<void> {
  expect([RC, ALPHA, ALPHA_015]).toContain(expectedRelease)
  for (const name of packageLocations.keys()) {
    expect(selectedPackageInfo(name).version, `${name} must match the requested ${evidenceLabel}`).toBe(expectedRelease)
  }
  if (taggedManifest !== undefined) {
    expect(alphaPins.has(expectedRelease)).toBe(true)
    expect(taggedManifest.release).toBe(expectedRelease)
    expect(taggedManifest.commit).toBe(alphaPins.get(expectedRelease))
    const identityModule = realpathSync(text(taggedManifest.identityModule))
    // The runner generates this module in its own scratch directory using
    // absolute imports, independent of the bare-import aliases under test.
    expect(dirname(identityModule)).toBe(dirname(realpathSync(taggedManifestPath!)))
    const identity: unknown = await import(/* @vite-ignore */ pathToFileURL(identityModule).href)
    const classes = object(identity)
    expect(LlmRuntime).toBe(classes.LlmRuntime)
    expect(PiAiAdapter).toBe(classes.PiAiAdapter)
    expect(Context).toBe(classes.Context)
    return
  }
  const fromAdapter = createRequire(require.resolve('@deepseek-ai/dsh-llm-pi-ai'))
  expect(realpathSync(fromAdapter.resolve('@deepseek-ai/dsh-llm'))).toBe(realpathSync(require.resolve('@deepseek-ai/dsh-llm')))
}

async function runtime() {
  const ctx = new Context()
  contexts.push(ctx)
  const record = { kind: 'grant', payload: { type: 'oauth', refresh: 'synthetic-published-account',
    access: 'synthetic-published-access', expires: Date.now() + 3_600_000, availableModelIds: [MODEL] } }
  await ctx.plugin({ apply(owner: Context) {
    owner.provide('credentials', {
      readRecord: async (key: string) => { expect(key).toBe(GITHUB_COPILOT_CREDENTIAL_KEY); return record },
      listRecords: async () => [{ key: GITHUB_COPILOT_CREDENTIAL_KEY, kind: 'grant' }],
      modifyRecord: async () => { throw new Error('Synthetic fresh grant must not be refreshed') },
      deleteRecord: async () => { throw new Error('Fixture must not sign out') },
    })
  } })
  await ctx.plugin(LlmRuntime)
  const register = vi.spyOn(ctx.llm, 'registerAdapter')
  await ctx.plugin(previewPlugin)
  const adapter = register.mock.calls[0]?.[1]
  register.mockRestore()
  expect(adapter).toBeInstanceOf(PiAiAdapter)
  await ctx.get('githubCopilotPreview')!.refresh()
  return ctx
}

function packet(type: string, fields: Record<string, unknown>): string {
  return `data: ${JSON.stringify({ type, ...fields })}\n\n`
}
function nativeResponse(tool: boolean): Response {
  const reasoning = { type: 'reasoning', id: 'rs_fixture', summary: [{ type: 'summary_text', text: 'Public fixture summary.' }], encrypted_content: 'synthetic-encrypted-file-replay' }
  const output = tool ? { type: 'function_call', id: 'fc_fixture', call_id: 'call_fixture', name: 'read_fixture', arguments: '{}' }
    : { type: 'message', id: 'msg_fixture', role: 'assistant', content: [{ type: 'output_text', text: 'Fixture complete.' }] }
  return new Response([
    packet('response.created', { response: { id: 'resp_fixture' } }),
    packet('response.output_item.added', { output_index: 0, item: { type: 'reasoning', id: reasoning.id } }),
    packet('response.reasoning_summary_text.delta', { output_index: 0, summary_index: 0, delta: 'Public fixture summary.' }),
    packet('response.output_item.done', { output_index: 0, item: reasoning }),
    packet('response.output_item.added', { output_index: 1, item: output }),
    ...(tool ? [packet('response.function_call_arguments.delta', { output_index: 1, delta: '{}' })]
      : [packet('response.output_text.delta', { output_index: 1, delta: 'Fixture complete.' })]),
    packet('response.output_item.done', { output_index: 1, item: output }),
    packet('response.completed', { response: { status: 'completed', output: [reasoning, output], usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 } } }),
  ].join(''), { headers: { 'content-type': 'text/event-stream' } })
}
async function generate(ctx: Context, messages: Message[]) {
  const prepared = await ctx.llm.prepareCall({ provider: PREVIEW, model: MODEL })
  const options: GenerateOptions = { ...prepared.config, messages,
    tools: [{ name: 'read_fixture', description: 'Synthetic file tool', parameters: { type: 'object', properties: {} } }] }
  const assembler = new BlockAssembler()
  for await (const chunk of prepared.stream(options)) assembler.push(chunk)
  return { assembler, message: assembler.message({ kind: 'model', provider: PREVIEW, model: MODEL,
    ...assembler.replayState === undefined ? {} : { replayState: assembler.replayState } }) }
}

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  vi.unstubAllGlobals()
})

describe(evidenceLabel, () => {
  it(`uses the exact requested ${taggedEvidence ? 'tagged-source' : 'published'} runtime and the plugin-owned public adapter subclass`, async () => {
    await assertRelease()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Identity check must not perform network requests') }))
    await runtime()
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it.skipIf(!runAlpha).each(['top-level', 'nested-tool-result'] as const)(
    'alpha.1 projects %s files before native dispatch while preserving encrypted replay', async placement => {
      await assertRelease()
      expect(alphaPins.has(runtimeInfo.version)).toBe(true)
      expect(runtimeInfo.version).toBe(expectedRelease)
      const requests: Record<string, unknown>[] = []
      vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: RequestInit) => {
        const url = String(input)
        expect(new URL(url).origin).toBe('https://api.individual.githubcopilot.com')
        if (url.endsWith('/models')) return new Response(JSON.stringify({ data: [{ id: MODEL, name: 'Published fixture',
          model_picker_enabled: true, policy: { state: 'enabled' }, supported_endpoints: ['/responses'], capabilities: {
            supports: { streaming: true, tool_calls: true, vision: false, reasoning_effort: ['high'] },
            limits: { max_context_window_tokens: 64000, max_prompt_tokens: 64000, max_output_tokens: 8000 },
          } }] }), { headers: { 'content-type': 'application/json' } })
        expect(url).toBe('https://api.individual.githubcopilot.com/responses')
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer synthetic-published-access')
        requests.push(JSON.parse(String(init?.body)))
        return nativeResponse(requests.length === 1)
      }))
      const ctx = await runtime()
      const attachment = Object.freeze({ attachmentId: `sha256:${'b'.repeat(64)}`, name: 'fixture.txt', bytes: 23 })
      const fileHostPath = vi.fn((ref: unknown) => { expect(ref).toEqual(attachment); return 'C:/private-host/fixture.txt' })
      const processPathFromHostPath = vi.fn((path: string) => { expect(path).toBe('C:/private-host/fixture.txt'); return '/execution-world/fixture.txt' })
      await ctx.plugin({ apply(owner: Context) {
        owner.provide('attachments', { fileHostPath })
        owner.provide('fs', { processPathFromHostPath })
      } })
      if (!('fileRequestText' in ctx.llm) || typeof ctx.llm.fileRequestText !== 'function') {
        throw new Error('Requested alpha.1 runtime is missing public fileRequestText')
      }
      const expectedHandle: unknown = ctx.llm.fileRequestText(attachment)
      expect(expectedHandle).toContain('verbatim read-only copy')
      expect(expectedHandle).toContain('/execution-world/fixture.txt')
      const first = await generate(ctx, [createUserMessage({ content: [{ type: 'text', text: 'Return the synthetic file tool.' }], source: { kind: 'user' } })])
      expect(first.assembler.finish).toEqual({ kind: 'tool-calls' })
      expect(first.message.source).toMatchObject({ replayState: { response: { provider: PREVIEW, model: MODEL } } })
      const replaySource = first.message.source
      const tool = first.message.content.find(block => block.type === 'tool-call')
      if (tool?.type !== 'tool-call') throw new Error('Expected a native tool call in the first turn')
      const file = { type: 'file', attachment }
      // rc.1's published type union predates files. This is a synthetic alpha-only
      // input boundary, checked above against the actual alpha package and public
      // fileRequestText; no implementation or Core type declarations are patched.
      const fileMessage = (placement === 'top-level'
        ? { id: 'synthetic-file-user', role: 'user', source: { kind: 'user' }, content: [file] }
        : { id: 'synthetic-file-tool', role: 'user', source: { kind: 'tool', callId: tool.id },
            content: [{ type: 'tool-result', toolCallId: tool.id, isError: false, content: [file] }] }) as unknown as Message
      const toolResult: Message = { id: 'synthetic-result' as Message['id'], role: 'user', source: { kind: 'tool', callId: tool.id },
        content: [{ type: 'tool-result', toolCallId: tool.id, isError: false, content: [{ type: 'text', text: 'Synthetic result.' }] }] }
      const history = placement === 'top-level' ? [first.message, toolResult, fileMessage] : [first.message, fileMessage]
      const second = await generate(ctx, history)
      expect(second.assembler.finish).toEqual({ kind: 'stop' })
      expect(requests).toHaveLength(2)
      const body = requests[1]!
      expect(body.input).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'reasoning', encrypted_content: 'synthetic-encrypted-file-replay' })]))
      const serialized = JSON.stringify(body.input)
      expect(serialized).toContain(JSON.stringify(expectedHandle).slice(1, -1))
      expect(serialized).not.toContain('private-host')
      expect(serialized).not.toMatch(/"type":"(?:input_file|file)"/)
      expect(fileHostPath).toHaveBeenCalled()
      expect(processPathFromHostPath).toHaveBeenCalled()
      expect(first.message.source).toBe(replaySource)
      if (placement === 'top-level') expect(fileMessage.content[0]).toBe(file)
      else {
        const block = fileMessage.content[0]
        if (block?.type !== 'tool-result') throw new Error('Original nested file fixture was changed')
        expect(block.content[0]).toBe(file)
      }
      expect(second.message.content).toContainEqual({ type: 'text', text: 'Fixture complete.' })
      expect(JSON.stringify(second.message.content)).not.toContain('synthetic-encrypted-file-replay')
    },
  )
})
