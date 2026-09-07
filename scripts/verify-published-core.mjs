import { mkdir, lstat, readdir, readFile, writeFile, realpath } from 'node:fs/promises'
import { createRequire, findPackageJSON } from 'node:module'
import { dirname, isAbsolute, join, relative, resolve, sep, extname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const PUBLISHED_CORE_RELEASES = Object.freeze(['0.1.2-rc.1', '0.1.3-alpha.1'])
const sections = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']
const rootFiles = ['tsconfig.json', 'tsconfig.tests.json', 'tsdown.config.ts', 'vitest.config.ts',
  'README.md', 'README.zh.md', 'AGENTS.md', 'CONTRIBUTING.md', 'SECURITY.md', 'LICENSE',
  'deployment-baseline.json', 'agent-contract.json']
const excluded = new Set(['node_modules', 'lib', 'artifacts', 'coverage', 'tmp', 'dist'])
const extensions = new Set(['.ts', '.tsx', '.js', '.mjs', '.json', '.md', '.yaml', '.yml', '.jsonl'])

function assertRelease(release) {
  if (!PUBLISHED_CORE_RELEASES.includes(release)) throw new Error('unsupported published Core release')
}
function samePath(a, b) { return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b }
function contains(root, path) {
  const suffix = relative(root, path)
  return suffix === '' || suffix !== '..' && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix)
}
async function physicalDirectory(path) {
  const absolute = resolve(path)
  const info = await lstat(absolute)
  if (!info.isDirectory() || info.isSymbolicLink() || !samePath(await realpath(absolute), absolute)) {
    throw new Error('fixture refuses a symlink or nonphysical directory')
  }
  return absolute
}
async function optionalInfo(path) {
  try { return await lstat(path) } catch (error) { if (error.code === 'ENOENT') return undefined; throw error }
}
function allowedName(name) {
  return !name.startsWith('.') && !excluded.has(name.toLowerCase())
    && (!['.json', '.yaml', '.yml', '.jsonl'].includes(extname(name).toLowerCase())
      || !/(?:secret|credential|(?:^|[.-])env(?:[.-]|$))/i.test(name))
}
async function collectTree(root, path, paths) {
  const info = await lstat(path)
  if (info.isSymbolicLink() || !samePath(await realpath(path), path)) throw new Error('fixture refuses a linked source')
  if (info.isDirectory()) {
    for (const name of (await readdir(path)).sort()) {
      if (allowedName(name)) await collectTree(root, join(path, name), paths)
    }
  } else if (info.isFile() && extensions.has(extname(path).toLowerCase())) paths.push(relative(root, path))
}
function fixtureManifest(original, release) {
  if (original.name !== 'dsh-github-copilot' || original.dependencies?.['@earendil-works/pi-ai'] !== '0.85.1') {
    throw new Error('fixture requires this plugin and its exact own pi-ai 0.85.1 dependency')
  }
  const manifest = { ...original, private: true, scripts: {} }
  for (const section of sections) {
    if (original[section] === undefined) continue
    manifest[section] = Object.fromEntries(Object.entries(original[section]).map(([name, version]) =>
      [name, name.startsWith('@deepseek-ai/dsh-') ? release : version]))
  }
  // The fixture owns only top-level requirements, never Core's transitive SDK resolution.
  for (const key of ['overrides', 'resolutions', 'pnpm', 'bundledDependencies', 'bundleDependencies', 'workspaces']) delete manifest[key]
  return manifest
}

/** Prepare an independent plugin fixture; never install, execute or modify Core or the source checkout. */
export async function preparePublishedCoreFixture({ root, target, release }) {
  assertRelease(release)
  const source = await physicalDirectory(root)
  const destination = resolve(target)
  if (contains(source, destination) || contains(destination, source)) throw new Error('fixture target must be separate from its source checkout')
  await physicalDirectory(dirname(destination))
  if (await optionalInfo(destination)) throw new Error('fixture target already exists')
  const packagePath = join(source, 'package.json')
  if (!(await lstat(packagePath)).isFile() || !samePath(await realpath(packagePath), packagePath)) throw new Error('fixture refuses a linked package manifest')
  const original = JSON.parse(await readFile(packagePath, 'utf8'))
  const manifest = fixtureManifest(original, release)
  const paths = []
  for (const tree of ['src', 'tests']) await collectTree(source, join(source, tree), paths)
  for (const name of rootFiles) {
    const path = join(source, name)
    const info = await optionalInfo(path)
    if (info === undefined) continue
    if (!info.isFile() || info.isSymbolicLink() || !samePath(await realpath(path), path)) throw new Error('fixture refuses a linked config')
    paths.push(name)
  }
  await mkdir(destination) // Exclusive: a concurrently created target is never reused.
  await physicalDirectory(destination)
  for (const path of paths) {
    const input = join(source, path)
    const output = join(destination, path)
    if (!(await lstat(input)).isFile() || !samePath(await realpath(input), input)) throw new Error('fixture source changed during preparation')
    await mkdir(dirname(output), { recursive: true })
    if (!samePath(await realpath(dirname(output)), dirname(output))) throw new Error('fixture target ancestor changed during preparation')
    await writeFile(output, await readFile(input), { flag: 'wx' })
  }
  await physicalDirectory(destination)
  await writeFile(join(destination, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' })
  const report = { schemaVersion: 1, kind: 'published-core-fixture', root: destination, release,
    files: paths.length + 1, ownPi: manifest.dependencies['@earendil-works/pi-ai'],
    coreDependencies: Object.fromEntries(sections.flatMap(section => Object.entries(manifest[section] ?? {})
      .filter(([name]) => name.startsWith('@deepseek-ai/dsh-')))),
    executed: { install: false, build: false, tests: false },
  }
  await writeFile(join(destination, 'published-core-fixture.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' })
  return report
}

async function publicPackage(root, anchor, name) {
  const manifestPath = findPackageJSON(name, pathToFileURL(anchor).href)
  if (manifestPath === undefined) throw new Error(`missing fixture package: ${name}`)
  const physicalManifest = await realpath(manifestPath)
  if (!contains(root, physicalManifest)) throw new Error(`fixture package resolves outside its isolated closure: ${name}`)
  const manifest = JSON.parse(await readFile(physicalManifest, 'utf8'))
  if (manifest.name !== name) throw new Error(`fixture package identity mismatch: ${name}`)
  // Public Core and Cordis root exports have a default condition. pi-ai is import-only.
  const entry = name === '@earendil-works/pi-ai'
    ? join(dirname(physicalManifest), manifest.exports?.['.']?.import ?? manifest.main)
    : createRequire(anchor).resolve(name)
  const physicalEntry = await realpath(entry)
  if (!contains(root, physicalEntry)) throw new Error(`fixture entry resolves outside its isolated closure: ${name}`)
  return { name, version: manifest.version, manifest: physicalManifest, entry: physicalEntry }
}

/** Inspect installed public classes and resolution identity; no apply(), login or model request. */
export async function inspectPublishedCoreFixture({ root, release }) {
  assertRelease(release)
  const fixture = await physicalDirectory(root)
  const anchor = join(fixture, 'package.json')
  const manifest = JSON.parse(await readFile(anchor, 'utf8'))
  if (manifest.name !== 'dsh-github-copilot' || manifest.dependencies?.['@earendil-works/pi-ai'] !== '0.85.1') {
    throw new Error('not a prepared plugin fixture')
  }
  const names = [...new Set(sections.flatMap(section => Object.keys(manifest[section] ?? {})))]
    .filter(name => name.startsWith('@deepseek-ai/dsh-'))
  const packages = []
  for (const name of names) {
    for (const section of sections) {
      if (manifest[section]?.[name] !== undefined && manifest[section][name] !== release) throw new Error(`fixture Core requirement differs: ${name}`)
    }
    const found = await publicPackage(fixture, anchor, name)
    if (found.version !== release) throw new Error(`fixture Core artifact version differs: ${name}`)
    packages.push(found)
  }
  const adapter = packages.find(entry => entry.name === '@deepseek-ai/dsh-llm-pi-ai')
  const llm = packages.find(entry => entry.name === '@deepseek-ai/dsh-llm')
  if (!adapter || !llm) throw new Error('fixture requires the public adapter and LlmRuntime')
  const cordis = await publicPackage(fixture, anchor, '@deepseek-ai/cordis')
  const adapterCordis = await publicPackage(fixture, adapter.entry, '@deepseek-ai/cordis')
  const llmCordis = await publicPackage(fixture, llm.entry, '@deepseek-ai/cordis')
  const adapterLlm = await publicPackage(fixture, adapter.entry, '@deepseek-ai/dsh-llm')
  if (![adapterCordis.entry, llmCordis.entry].every(path => samePath(path, cordis.entry)) || !samePath(adapterLlm.entry, llm.entry)) {
    throw new Error('fixture resolves multiple Cordis or LlmAdapter identities')
  }
  const [core, runtime, framework] = await Promise.all([adapter, llm, cordis].map(entry => import(pathToFileURL(entry.entry).href)))
  if (typeof framework.Context !== 'function' || typeof runtime.LlmAdapter !== 'function'
    || typeof runtime.default !== 'function' || typeof core.PiAiAdapter !== 'function'
    || !(core.PiAiAdapter.prototype instanceof runtime.LlmAdapter)
    || typeof core.Config !== 'function' || typeof core.PiAiAdapter.prototype.prepareCall !== 'function') {
    throw new Error('published Core public class identity or API differs')
  }
  const ownPi = await publicPackage(fixture, anchor, '@earendil-works/pi-ai')
  const adapterPi = await publicPackage(fixture, adapter.entry, '@earendil-works/pi-ai')
  if (ownPi.version !== '0.85.1') throw new Error('fixture changed the plugin own pi version')
  return { schemaVersion: 1, kind: 'published-core-identity', release, root: fixture, packages, cordis,
    ownPi, adapterPi, classIdentity: true, executed: { apply: false, modelRequests: false, compatibilityTests: false } }
}

function argumentsOf(args) {
  const [mode, ...rest] = args
  if (!['prepare', 'inspect'].includes(mode) || rest.length % 2) throw new Error('usage: prepare --root <checkout> --target <new dir> --release <version>; inspect --root <fixture> --release <version>')
  const options = {}
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index]
    if (!['--root', '--target', '--release'].includes(key) || options[key.slice(2)] !== undefined || !rest[index + 1]) throw new Error('invalid fixture arguments')
    options[key.slice(2)] = rest[index + 1]
  }
  if (!options.root || !options.release || mode === 'prepare' && !options.target || mode === 'inspect' && options.target) throw new Error('missing or unexpected fixture arguments')
  return { mode, options }
}
if (process.argv[1] && samePath(resolve(process.argv[1]), fileURLToPath(import.meta.url))) {
  try {
    const { mode, options } = argumentsOf(process.argv.slice(2))
    const report = await (mode === 'prepare' ? preparePublishedCoreFixture(options) : inspectPublishedCoreFixture(options))
    console.log(JSON.stringify(report, null, 2))
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
