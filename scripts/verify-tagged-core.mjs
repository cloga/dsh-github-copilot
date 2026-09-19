import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { lstat, readFile, realpath, mkdir, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const TAGGED_CORE_RELEASES = Object.freeze({
  '0.1.2-rc.1': 'a66e4702047846cdaa10c66c9d3df3951f5ea70d',
  '0.1.3-alpha.1': 'd347e703908d0406b7a7ef80e3a0e594d86b2215',
  '0.1.5-alpha.1': '5dda764ed3aa172535a7967b06ff95d9cbfe536a',
  '0.1.5-alpha.2': 'b2e3b2a0125854567a4a5fcba75782e42fe84901',
  '0.1.5-rc.1': '183f08e9c6dde7e36cd2318eaee70b0da08fb35e',
  '0.1.5-rc.2': 'fb2c4b9e698e30edb738bca4cf0618587db7d203',
  '0.1.6-alpha.1': '0a15e36e7f82b6ed45af6fa9759f29b40dcd965d',
  '0.1.6-alpha.2': 'ddefc45fbc7f8e46dd73185e68295696d1297887',
})
const tests = ['tests/preview-route.spec.ts', 'tests/published-core.spec.ts', 'tests/single-route.spec.ts',
  'tests/search-routing.spec.ts', 'tests/routed-web.spec.ts', 'tests/deepseek-search-fallback.spec.ts']
function runtimeTests(release) {
  return ['0.1.5-alpha.1', '0.1.5-alpha.2', '0.1.5-rc.1', '0.1.5-rc.2', '0.1.6-alpha.1', '0.1.6-alpha.2'].includes(release)
    ? [...tests, ...release.startsWith('0.1.6-') ? ['tests/tool-schema-compat.spec.ts'] : [],
        ...release === '0.1.6-alpha.2' ? ['tests/fixtures/alpha2-contracts-core.fixture.ts', 'tests/fixtures/compaction-pressure-core.fixture.ts', 'tests/remote-codec.spec.ts', 'tests/dual-model-projection.spec.ts'] : [],
        'tests/fixtures/session-context-core.fixture.ts', 'tests/fixtures/remote-core.fixture.ts']
    : tests
}
const slash = value => value.replaceAll('\\', '/')
const same = (left, right) => process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right
function inside(root, path) {
  const suffix = relative(root, path)
  return suffix === '' || suffix !== '..' && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix)
}
async function physicalDirectory(path) {
  const absolute = resolve(path)
  const info = await lstat(absolute)
  if (!info.isDirectory() || info.isSymbolicLink() || !same(await realpath(absolute), absolute)) throw new Error('tagged fixture refuses linked or nonphysical directories')
  return absolute
}
async function exists(path) {
  try { return await lstat(path) } catch (error) { if (error.code === 'ENOENT') return undefined; throw error }
}
function readGit(core, args) {
  return execFileSync('git', args, { cwd: core, encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] })
}
function runtimeExport(value) {
  if (typeof value === 'string') return value
  if (!value || typeof value !== 'object') return undefined
  return runtimeExport(value.default ?? value.import)
}
async function sourceEntry(core, directory, output, tracked) {
  if (typeof output !== 'string' || !output.startsWith('./lib/') || !/\.(?:mjs|cjs|js)$/.test(output)) return undefined
  const stem = output.slice('./lib/'.length).replace(/\.(?:mjs|cjs|js)$/, '')
  const sourceStem = stem.startsWith('types/') ? stem.slice('types/'.length) : stem
  const options = [
    join(directory, 'src', `${stem}.ts`),
    join(directory, 'src', `${stem}.tsx`),
    join(directory, 'src', stem, 'index.ts'),
    ...sourceStem === stem ? [] : [
      join(directory, 'src', `${sourceStem}.ts`),
      join(directory, 'src', `${sourceStem}.tsx`),
      join(directory, 'src', sourceStem, 'index.ts'),
    ],
  ]
  const found = []
  for (const path of options) {
    if (!tracked.has(slash(relative(core, path)))) continue
    const info = await exists(path)
    if (!info?.isFile() || info.isSymbolicLink() || !same(await realpath(path), path)) throw new Error('tagged public source entry is missing or linked')
    found.push(path)
  }
  if (found.length > 1) throw new Error(`ambiguous tagged public source entry: ${output}`)
  return found[0]
}

/** Build exact test-only public export aliases from unchanged, tracked package manifests. */
export async function taggedCoreAliases(core, trackedPaths, release) {
  const tracked = new Set(trackedPaths)
  const packages = []
  const aliases = []
  const vendors = []
  for (const path of [...tracked].sort()) {
    if (!/^(?:packages\/[^/]+\/[^/]+|vendor\/[^/]+)\/package\.json$/.test(path)) continue
    const manifestPath = join(core, path)
    if (!same(await realpath(manifestPath), manifestPath)) throw new Error('tagged package manifest is linked')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    const name = manifest.name
    if (typeof name !== 'string' || !name.startsWith('@deepseek-ai/')) continue
    const isDsh = name.startsWith('@deepseek-ai/dsh-')
    const isCordis = name === '@deepseek-ai/cordis'
    const isVendor = path.startsWith('vendor/')
    if (!isDsh && !isVendor) continue
    if (isDsh && manifest.version !== release) throw new Error(`tagged package release differs: ${name}`)
    const directory = dirname(manifestPath)
    const exports = manifest.exports && typeof manifest.exports === 'object' ? manifest.exports : { '.': manifest.main }
    const rootEntry = await sourceEntry(core, directory, runtimeExport(exports['.']), tracked)
    if (rootEntry === undefined) continue
    packages.push({ name, version: manifest.version, manifestPath, entry: rootEntry })
    for (const [key, target] of Object.entries(exports)) {
      if (key !== '.' && (!key.startsWith('./') || key.includes('*') || key.startsWith('./src/'))) continue
      const entry = key === './package.json' ? manifestPath : await sourceEntry(core, directory, runtimeExport(target), tracked)
      if (entry === undefined) continue
      const alias = { name: key === '.' ? name : `${name}/${key.slice(2)}`, entry }
      if (isDsh || isCordis) aliases.push(alias)
      else vendors.push(alias)
    }
  }
  for (const name of ['@deepseek-ai/cordis', '@deepseek-ai/dsh-llm', '@deepseek-ai/dsh-llm-pi-ai', '@deepseek-ai/dsh-attachment']) {
    if (!packages.some(item => item.name === name)) throw new Error(`tagged checkout lacks required public entry: ${name}`)
  }
  return { packages, aliases, vendors }
}
function identitySource(report) {
  const entry = name => slash(report.packages.find(item => item.name === name).entry)
  const moduleUrl = name => pathToFileURL(report.packages.find(item => item.name === name).entry).href
  return `// Test-only unchanged tagged-source identity. Never installed as a plugin.\nimport { Context } from ${JSON.stringify(moduleUrl('@deepseek-ai/cordis'))}\nimport LlmRuntime, { LlmAdapter } from ${JSON.stringify(moduleUrl('@deepseek-ai/dsh-llm'))}\nimport { PiAiAdapter } from ${JSON.stringify(moduleUrl('@deepseek-ai/dsh-llm-pi-ai'))}\nimport { Context as PublicContext } from '@deepseek-ai/cordis'\nimport PublicRuntime, { LlmAdapter as PublicAdapter } from '@deepseek-ai/dsh-llm'\nimport { PiAiAdapter as PublicPiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'\nif (Context !== PublicContext || LlmRuntime !== PublicRuntime || LlmAdapter !== PublicAdapter || PiAiAdapter !== PublicPiAiAdapter || !(PiAiAdapter.prototype instanceof LlmAdapter)) throw new Error('TAGGED_CORE_CLASS_IDENTITY_MISMATCH')\nexport { Context, LlmRuntime, PiAiAdapter }\nexport const coreRoot = ${JSON.stringify(report.coreRoot)}\nexport const llmEntry = ${JSON.stringify(entry('@deepseek-ai/dsh-llm'))}\nexport const adapterEntry = ${JSON.stringify(entry('@deepseek-ai/dsh-llm-pi-ai'))}\nexport const attachmentEntry = ${JSON.stringify(entry('@deepseek-ai/dsh-attachment'))}\n`
}
function configSource(report) {
  return `// Isolated test resolver only; no Core build or implementation writes.\nimport { relative, isAbsolute } from 'node:path'\nimport { standardDecoratorPlugin, vitestExecArgv } from ${JSON.stringify(pathToFileURL(join(report.coreRoot, 'vitest.shared.ts')).href)}\nconst aliases = ${JSON.stringify(report.aliases)}\nconst vendors = new Map(${JSON.stringify(report.vendors.map(item => [item.name, item.entry]))})\nconst core = ${JSON.stringify(report.coreRoot)}\nconst escape = value => value.replace(/[.*+?^$\x7b\x7d()|[\x5d\\\\]/g, '\\\\$&')\nfunction isCoreSource(importer) {\n  if (!importer) return false\n  const file = importer.split('?')[0].replace(/^\\/@fs\\//, '')\n  if (file.replaceAll('\\\\', '/').includes('/node_modules/')) return false\n  const suffix = relative(core, file)\n  return suffix === '' || suffix !== '..' && !suffix.startsWith('../') && !suffix.startsWith('..\\\\') && !isAbsolute(suffix)\n}\nexport default {\n  root: ${JSON.stringify(report.pluginRoot)}, envDir: ${JSON.stringify(report.scratch)}, cacheDir: ${JSON.stringify(join(report.scratch, 'vite-cache'))},\n  resolve: { alias: aliases.map(item => ({ find: new RegExp('^' + escape(item.name) + '$'), replacement: item.entry })) },\n  plugins: [standardDecoratorPlugin(), { name: 'tagged-core-public-import-guard', enforce: 'pre', resolveId(id, importer) {\n    if (id.startsWith('@deepseek-ai/dsh-') || id === '@deepseek-ai/cordis' || id.startsWith('@deepseek-ai/cordis/')) throw new Error('TAGGED_CORE_PUBLIC_EXPORT_UNMAPPED: ' + id)\n    if (isCoreSource(importer) && vendors.has(id)) return vendors.get(id)\n    return null\n  } }],\n  test: { include: ${JSON.stringify(runtimeTests(report.release))}, setupFiles: [${JSON.stringify(report.identityModule)}],\n    execArgv: vitestExecArgv, env: { DSH_CORE_EVIDENCE: 'tagged-source-runtime', DSH_TAGGED_CORE_MANIFEST: ${JSON.stringify(report.manifestPath)}, DSH_PUBLISHED_CORE_RELEASE: ${JSON.stringify(report.release)} }\n  }\n}\n`
}

/** Prepare only runner-owned config/identity files; read Core and plugin source without changing either. */
export async function prepareTaggedCoreFixture({ root, core, target, release }, { git = readGit, runner } = {}) {
  const expected = TAGGED_CORE_RELEASES[release]
  if (expected === undefined) throw new Error('unsupported tagged Core release')
  const pluginRoot = await physicalDirectory(root)
  const coreRoot = await physicalDirectory(core)
  const scratch = resolve(target)
  if (inside(pluginRoot, scratch) || inside(coreRoot, scratch) || inside(scratch, pluginRoot) || inside(scratch, coreRoot)) throw new Error('tagged fixture scratch must be outside both source trees')
  await physicalDirectory(dirname(scratch))
  if (await exists(scratch)) throw new Error('tagged fixture target already exists')
  const plugin = JSON.parse(await readFile(join(pluginRoot, 'package.json'), 'utf8'))
  if (plugin.name !== 'dsh-github-copilot' || plugin.dependencies?.['@earendil-works/pi-ai'] !== '0.85.1') throw new Error('tagged fixture requires the plugin own pi-ai 0.85.1')
  const commit = git(coreRoot, ['rev-parse', '--verify', 'HEAD']).trim()
  if (commit !== expected) throw new Error('tagged Core commit does not match the exact release pin')
  if (git(coreRoot, ['status', '--porcelain=v1', '--untracked-files=no']).trim()) throw new Error('tagged Core tracked sources must be clean')
  const tracked = git(coreRoot, ['ls-files', '-z']).split('\0').filter(Boolean)
  if (!tracked.includes('vitest.shared.ts')) throw new Error('tagged Core standard decorator test helper is missing')
  const inventory = await taggedCoreAliases(coreRoot, tracked, release)
  const require = createRequire(join(pluginRoot, 'package.json'))
  const vitestCli = runner ?? join(dirname(require.resolve('vitest/package.json')), 'vitest.mjs')
  for (const path of [...runtimeTests(release).map(name => join(pluginRoot, name)), vitestCli, join(coreRoot, 'vitest.shared.ts')]) {
    if (!(await lstat(path)).isFile()) throw new Error('tagged fixture runner input is missing')
  }
  const configPath = join(scratch, 'vitest.config.mts')
  const identityModule = join(scratch, 'identity.ts')
  const manifestPath = join(scratch, 'tagged-core-fixture.json')
  const report = { schemaVersion: 1, kind: 'tagged-source-runtime', coreRoot, release, commit,
    pluginRoot, scratch, configPath, identityModule, manifestPath, ...inventory,
    runner: { command: process.execPath, args: [vitestCli, 'run', '--config', configPath], cwd: pluginRoot },
    executed: { install: false, build: false, tests: false },
  }
  await mkdir(scratch)
  await physicalDirectory(scratch)
  for (const [path, content] of [[identityModule, identitySource(report)], [configPath, configSource(report)], [manifestPath, `${JSON.stringify(report, null, 2)}\n`]]) {
    await writeFile(path, content, { flag: 'wx' })
  }
  return report
}
function parseArgs(args) {
  const [mode, ...rest] = args
  if (mode !== 'prepare' || rest.length % 2) throw new Error('usage: prepare --root <plugin> --core <clean tagged Core> --target <fresh scratch> --release <version>')
  const options = {}
  for (let index = 0; index < rest.length; index += 2) {
    const name = rest[index]?.slice(2)
    if (!['root', 'core', 'target', 'release'].includes(name) || rest[index] !== `--${name}` || !rest[index + 1] || options[name] !== undefined) throw new Error('invalid tagged fixture arguments')
    options[name] = rest[index + 1]
  }
  if (['root', 'core', 'target', 'release'].some(name => !options[name])) throw new Error('missing tagged fixture argument')
  return options
}
if (process.argv[1] && same(resolve(process.argv[1]), fileURLToPath(import.meta.url))) {
  try { console.log(JSON.stringify(await prepareTaggedCoreFixture(parseArgs(process.argv.slice(2))), null, 2)) }
  catch (error) { console.error(error.message); process.exitCode = 1 }
}
