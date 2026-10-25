import { spawnSync } from 'node:child_process'
import { open, mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { readTarball, verifyTarball } from './verify-tarball.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const slash = value => value.replaceAll('\\', '/')

function inside(parent, path) {
  const suffix = relative(parent, path)
  return suffix === '' || suffix !== '..' && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix)
}

function versionParts(value) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/u.exec(value)
  if (!match) throw new Error(`Unsupported package version ${JSON.stringify(value)}`)
  return match.slice(1, 4).map(Number)
}

export function versionSatisfiesPeer(actual, range) {
  return range.split(/\s+\|\|\s+/u).some(candidate => {
    if (!candidate.startsWith('^')) return candidate === actual
    const expected = versionParts(candidate.slice(1))
    const found = versionParts(actual)
    const minimum = found[0] > expected[0]
      || (found[0] === expected[0] && (found[1] > expected[1]
        || (found[1] === expected[1] && found[2] >= expected[2])))
    if (!minimum) return false
    if (expected[0] > 0) return found[0] === expected[0]
    if (expected[1] > 0) return found[0] === 0 && found[1] === expected[1]
    return found[0] === 0 && found[1] === 0 && found[2] === expected[2]
  })
}

async function packageAt(nodeModules, name) {
  const directory = join(nodeModules, ...name.split('/'))
  try {
    const manifestPath = join(directory, 'package.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    if (manifest.name !== name || typeof manifest.version !== 'string') return undefined
    return { directory: await realpath(directory), manifest }
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return undefined
    throw error
  }
}

export async function hostDependencies(pkg, hostModules, runtimeMissing, { provideRuntimeDependencies = true } = {}) {
  const dependencies = {}
  const hostPeers = {}
  for (const [name, range] of Object.entries(pkg.peerDependencies ?? {})) {
    const optional = pkg.peerDependenciesMeta?.[name]?.optional === true
    const found = await packageAt(hostModules, name)
    if (found === undefined) {
      if (optional) {
        hostPeers[name] = { available: false, optional: true }
        continue
      }
      throw new Error(`MISSING_HOST_PEER: ${name}@${range}`)
    }
    if (!versionSatisfiesPeer(found.manifest.version, range)) {
      throw new Error(`HOST_PEER_VERSION_MISMATCH: ${name}@${found.manifest.version} does not satisfy ${range}`)
    }
    dependencies[name] = `link:${slash(found.directory)}`
    hostPeers[name] = { available: true, version: found.manifest.version, path: found.directory, optional }
  }

  for (const name of provideRuntimeDependencies ? Object.keys(pkg.dependencies ?? {}) : []) {
    if (runtimeMissing === name) continue
    const found = await packageAt(hostModules, name)
    if (found === undefined) throw new Error(`MISSING_PLUGIN_RUNTIME_DEPENDENCY_SOURCE: ${name}`)
    if (!versionSatisfiesPeer(found.manifest.version, pkg.dependencies[name])) {
      throw new Error(`PLUGIN_RUNTIME_DEPENDENCY_VERSION_MISMATCH: ${name}@${found.manifest.version}`)
    }
    dependencies[name] = `link:${slash(found.directory)}`
  }

  const react = await packageAt(hostModules, 'react')
  if (react !== undefined && dependencies.react === undefined) dependencies.react = `link:${slash(react.directory)}`
  return { dependencies, hostPeers }
}

async function writeTree(files, destination) {
  for (const [name, bytes] of files) {
    if (name === 'package/package.json') continue
    const output = join(destination, ...name.slice('package/'.length).split('/'))
    if (!inside(destination, output)) throw new Error('Archive entry escaped fixture directory')
    await mkdir(dirname(output), { recursive: true })
    await writeFile(output, bytes, { flag: 'wx' })
  }
  await writeFile(join(destination, 'package.json'), files.get('package/package.json'), { flag: 'wx' })
}

function pnpmCommand() {
  const cli = process.env.npm_execpath
  if (typeof cli !== 'string' || cli.length === 0) {
    throw new Error('Run through the repository-pinned pnpm command so npm_execpath is available')
  }
  if (process.platform === 'win32' && /\.exe$/iu.test(cli)) return { command: cli, args: [] }
  return { command: process.execPath, args: [cli] }
}

async function readVerifiedArchive(path, expectedSha256) {
  const handle = await open(path, 'r')
  try {
    const info = await handle.stat()
    if (!info.isFile() || info.size > 32 * 1024 * 1024) throw new Error('Archive is not a bounded regular file')
    const bytes = Buffer.alloc(info.size + 1)
    let length = 0
    while (length < bytes.length) {
      const { bytesRead } = await handle.read(bytes, length, bytes.length - length, length)
      if (bytesRead === 0) break
      length += bytesRead
    }
    if (length !== info.size) throw new Error('Archive changed while being read')
    const archive = bytes.subarray(0, length)
    if (createHash('sha256').update(archive).digest('hex') !== expectedSha256) {
      throw new Error('Archive changed after tarball verification')
    }
    return archive
  } finally {
    await handle.close()
  }
}

function runPnpm(directory, args) {
  const pnpm = pnpmCommand()
  const result = spawnSync(pnpm.command, [...pnpm.args, ...args], {
    cwd: directory,
    stdio: 'inherit',
    env: { ...process.env, npm_config_ignore_scripts: 'true' },
    timeout: 180_000,
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Isolated package install failed with exit code ${result.status}`)
}

async function installFixture(directory, name, dependencies) {
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'package.json'), `${JSON.stringify({
    name,
    private: true,
    type: 'module',
    dependencies,
  }, null, 2)}\n`, { flag: 'wx' })
  runPnpm(directory, ['install', '--ignore-scripts', '--strict-peer-dependencies', '--config.auto-install-peers=false'])
}

const runtimeSmoke = `import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire, findPackageJSON } from 'node:module'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import vm from 'node:vm'
import { realpath } from 'node:fs/promises'
import { Context } from '@deepseek-ai/cordis'
import { WebRuntime } from '@deepseek-ai/dsh-web'
import * as main from 'dsh-github-copilot'
import * as webDelegate from 'dsh-github-copilot/web-delegate'
import RoutedWeb from 'dsh-github-copilot/routed-web'
import recovery from 'dsh-github-copilot/manual-compaction-recovery'
import remote from 'dsh-github-copilot/remote'
const require = createRequire(import.meta.url)
const resolvedPackage = findPackageJSON('dsh-github-copilot', import.meta.url)
assert.ok(resolvedPackage, 'installed package manifest must resolve')
const pkgPath = await realpath(resolvedPackage)
const pkg = JSON.parse(await readFile(pkgPath, 'utf8'))
const installRoot = dirname(pkgPath)
const allowedRoot = process.env.INSTALL_FIXTURE_ROOT
const realPackageRoot = await realpath(installRoot)
const realFixtureRoot = await realpath(allowedRoot)
const packageRelative = relative(realFixtureRoot, realPackageRoot)
assert.ok(packageRelative === '' || packageRelative !== '..' && !packageRelative.startsWith('..' + sep)
  && !isAbsolute(packageRelative), 'tarball installation must remain inside the isolated fixture')
assert.equal(pkg.name, 'dsh-github-copilot')
function packageEntry(manifestPath, manifest) {
  const rootExport = manifest.exports?.['.'] ?? manifest.exports
  const target = typeof rootExport === 'string' ? rootExport
    : rootExport?.import ?? rootExport?.node ?? rootExport?.default ?? manifest.main
  assert.equal(typeof target, 'string', 'runtime dependency must expose a Node entry')
  const path = resolve(dirname(manifestPath), target)
  const packageRoot = dirname(manifestPath)
  const relativePath = relative(packageRoot, path)
  assert.ok(relativePath === '' || relativePath !== '..' && !relativePath.startsWith('..' + sep)
    && !isAbsolute(relativePath), 'runtime dependency entry must stay inside its installed package')
  return pathToFileURL(path).href
}
assert.equal(typeof main.apply, 'function')
assert.ok(Array.isArray(main.inject) && main.inject.includes('credentials'))
assert.equal(typeof webDelegate.apply, 'function')
assert.deepEqual(webDelegate.inject, ['web'])
assert.equal(typeof RoutedWeb, 'function')
assert.ok(RoutedWeb.inject.includes('githubCopilotOriginalWeb'))
assert.equal(typeof recovery, 'function')
assert.ok(Array.isArray(remote.descriptors) && remote.descriptors.length > 0)
for (const name of Object.keys(pkg.dependencies)) {
  const manifestPath = findPackageJSON(name, pathToFileURL(pkgPath).href)
  assert.ok(manifestPath, 'production dependency must actually resolve: ' + name)
  const physicalDependencyManifest = await realpath(manifestPath)
  const dependencyRelative = relative(realFixtureRoot, physicalDependencyManifest)
  assert.ok(dependencyRelative === '' || dependencyRelative !== '..' && !dependencyRelative.startsWith('..' + sep)
    && !isAbsolute(dependencyRelative), 'production dependency must come from fixture install: ' + name)
  const installed = JSON.parse(await readFile(manifestPath, 'utf8'))
  assert.equal(installed.version, pkg.dependencies[name], 'production dependency version must match: ' + name)
  await import(packageEntry(manifestPath, installed))
}
for (const [name, expected] of Object.entries(JSON.parse(process.env.EXPECTED_HOST_PEERS))) {
  if (!expected.available) {
    assert.throws(() => findPackageJSON(name, pathToFileURL(pkgPath).href),
      error => error?.code === 'ERR_MODULE_NOT_FOUND' && error.message.includes(name),
      'missing optional peer must remain host-optional: ' + name)
    continue
  }
  const manifestPath = findPackageJSON(name, pathToFileURL(pkgPath).href)
  assert.ok(manifestPath, 'required host peer must actually resolve: ' + name)
  const actual = JSON.parse(await readFile(manifestPath, 'utf8'))
  assert.equal(actual.version, expected.version, 'host peer must resolve to the supplied Core package: ' + name)
  assert.equal(await realpath(dirname(manifestPath)), expected.path,
    'host peer must resolve to the explicit Core package path: ' + name)
}
const clientUrl = import.meta.resolve('dsh-github-copilot/client')
let clientRegistration
vm.runInNewContext(await readFile(new URL(clientUrl), 'utf8'), {
  window: { __ModuleLoader__: { load(value) { clientRegistration = value } } },
})
assert.equal(clientRegistration?.id, pkg.name)
assert.equal(typeof clientRegistration?.factory, 'function')
const client = clientRegistration.factory(specifier => {
  if (specifier === 'react') return require('react')
  throw new Error('unexpected client external: ' + specifier)
})
assert.equal(typeof client.apply, 'function')
assert.ok(Array.isArray(client.inject))

const context = new Context()
context.provide('credentials', Object.freeze({}))
async function mount(owner, plugin, config, entry) {
  try { return await owner.plugin(plugin, config) }
  catch (cause) { throw new Error('Host loading failed for ' + entry, { cause }) }
}
const mainFiber = await mount(context, main, {}, '.')
const webContext = new Context()
const isolatedWeb = webContext.isolate('web', Symbol('install-smoke'))
const webConfig = () => ({ searchProvider: { get: () => undefined }, fetchProvider: { get: () => undefined } })
const originalWebFiber = await mount(isolatedWeb, WebRuntime, webConfig(), 'native WebRuntime')
const delegateFiber = await mount(isolatedWeb, webDelegate, undefined, './web-delegate')
assert.ok(isolatedWeb.get('githubCopilotOriginalWeb') !== undefined, 'Web delegate must publish the native service')
const routedFiber = await mount(webContext, RoutedWeb, webConfig(), './routed-web')
assert.ok(webContext.get('web') !== undefined, 'routed Web entry must publish its facade')
for (const fiber of [routedFiber, delegateFiber, originalWebFiber, mainFiber]) await fiber.dispose()
console.log(JSON.stringify({ ok: true, hostLoading: true, packageVersion: pkg.version,
  entrypoints: ['.', './client', './remote', './routed-web', './web-delegate', './manual-compaction-recovery'],
  providerRequests: 0, credentialsAccessed: false }))
`

export function missingDependencyProbe(packageName, entrypoint) {
  return `for (const specifier of [${JSON.stringify(entrypoint)}, ${JSON.stringify(packageName)}]) {
  let missing = false
  try { await import(specifier) }
  catch (error) {
    missing = error?.code === 'ERR_MODULE_NOT_FOUND' && String(error.message).includes(${JSON.stringify(packageName)})
    if (!missing) {
      console.error(error?.code ?? 'ERROR', error?.message ?? String(error)); process.exit(3)
    }
  }
  if (!missing) process.exit(2)
}
console.log('EXPECTED_MISSING_RUNTIME_DEPENDENCY:' + ${JSON.stringify(packageName)})
`
}

async function expectLinkedDependencyFailure({ directory, name, dependencies, sourceDirectory, omitted, entrypoint }) {
  dependencies['dsh-github-copilot'] = `link:${slash(sourceDirectory)}`
  await installFixture(directory, name, dependencies)
  const probeFile = join(directory, 'expect-missing.mjs')
  await writeFile(probeFile, missingDependencyProbe(omitted, entrypoint), { flag: 'wx' })
  const result = spawnSync(process.execPath, [probeFile], {
    cwd: directory, encoding: 'utf8', timeout: 30_000,
  })
  if (result.error) throw result.error
  if (result.status !== 0 || !result.stdout.includes(`EXPECTED_MISSING_RUNTIME_DEPENDENCY:${omitted}`)) {
    throw new Error(`Directory-link regression was not detected for ${omitted}:\n${result.stderr || result.stdout}`)
  }
  return { case: name, status: 'rejected', missing: omitted }
}

export async function verifyInstalledPlugin({ archive, hostModules }) {
  const archivePath = resolve(archive)
  const hostRoot = await realpath(resolve(hostModules))
  const tarball = await verifyTarball(archivePath, root)
  const archiveBytes = await readVerifiedArchive(archivePath, tarball.sha256)
  const files = readTarball(archiveBytes)
  const pkg = JSON.parse(files.get('package/package.json').toString('utf8'))
  const coreRelease = pkg.engines?.dsh
  if (typeof coreRelease !== 'string' || coreRelease !== '0.2.1-rc.3') {
    throw new Error(`Install smoke is pinned to DSH 0.2.1-rc.3; got ${JSON.stringify(coreRelease)}`)
  }
  const scratch = await mkdtemp(join(tmpdir(), 'dsh-copilot-install-smoke-'))
  try {
    const validDirectory = join(scratch, 'packed-install')
    const valid = await hostDependencies(pkg, hostRoot, undefined, { provideRuntimeDependencies: false })
    valid.dependencies[pkg.name] = `file:${slash(archivePath)}`
    await installFixture(validDirectory, 'dsh-copilot-packed-install-smoke', valid.dependencies)
    const runner = join(validDirectory, 'load-host.mjs')
    await writeFile(runner, runtimeSmoke, { flag: 'wx' })
    const result = spawnSync(process.execPath, [runner], {
      cwd: validDirectory, encoding: 'utf8', timeout: 60_000,
      env: { ...process.env, INSTALL_FIXTURE_ROOT: validDirectory,
        EXPECTED_HOST_PEERS: JSON.stringify(valid.hostPeers) },
    })
    if (result.error) throw result.error
    if (result.status !== 0) {
      throw new Error(`Packed archive failed the target Core host load smoke:\n${result.stderr || result.stdout}`)
    }

    const negative = []
    for (const omitted of ['zod', '@earendil-works/pi-ai']) {
      const directory = join(scratch, `directory-link-missing-${omitted.replaceAll('/', '-')}`)
      const sourceDirectory = join(directory, 'directory-link-source')
      await mkdir(sourceDirectory, { recursive: true })
      await writeTree(files, sourceDirectory)
      const fixture = await hostDependencies(pkg, hostRoot, omitted)
      negative.push(await expectLinkedDependencyFailure({
        directory,
        name: `dsh-copilot-link-missing-${omitted.replaceAll('/', '-')}`,
        dependencies: fixture.dependencies,
        sourceDirectory,
        omitted,
        entrypoint: omitted === 'zod' ? 'dsh-github-copilot/remote' : 'dsh-github-copilot',
      }))
    }
    return { schemaVersion: 1, ok: true, kind: 'packed-plugin-install-smoke',
      package: { name: pkg.name, version: pkg.version }, coreRelease, archiveSha256: tarball.sha256,
      hostPeers: Object.fromEntries(Object.entries(valid.hostPeers).map(([name, peer]) =>
        [name, peer.available ? { available: true, version: peer.version } : peer])),
      installedEntrypoints: ['.', './client', './remote', './routed-web', './web-delegate', './manual-compaction-recovery'],
      negativeDirectoryLinks: negative, evidence: 'Installs the verified archive, checks runtime dependency and peer resolution, and loads plugin entries through the pinned Cordis host API. No credentials or provider requests.' }
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}

function parseArgs(args) {
  const options = {}
  if (args.length % 2 !== 0) throw new Error('usage: verify-install-smoke --archive <file.tgz> --host-modules <node_modules>')
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]
    if (!['--archive', '--host-modules'].includes(key) || options[key] !== undefined || !args[index + 1]) {
      throw new Error('invalid install smoke arguments')
    }
    options[key] = args[index + 1]
  }
  if (!options['--archive'] || !options['--host-modules']) throw new Error('missing install smoke arguments')
  return { archive: options['--archive'], hostModules: options['--host-modules'] }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify(await verifyInstalledPlugin(parseArgs(process.argv.slice(2).filter(arg => arg !== '--'))), null, 2))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
