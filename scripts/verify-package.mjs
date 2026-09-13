import { access, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import vm from 'node:vm'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
if (packageJson.dependencies?.['@deepseek-ai/dsh-authorization'] === undefined) {
  throw new Error('package must install the rc.2 authorization bootstrap dependency')
}
if (packageJson.dependencies?.zod === undefined) {
  throw new Error('package must install the strict Remote codec runtime dependency')
}

for (const [subpath, target] of Object.entries(packageJson.exports ?? {})) {
  if (typeof target === 'string') {
    await access(resolve(root, target))
    continue
  }
  for (const path of Object.values(target)) await access(resolve(root, path))
  if (!('types' in target) || !('default' in target)) {
    throw new Error(`package export ${subpath} must expose both types and default`)
  }
}

for (const entry of ['lib/index.js', 'lib/client.js', 'lib/remote.js']) {
  await access(resolve(root, entry))
}

const clientCode = await readFile(resolve(root, 'lib/client.js'), 'utf8')
let handoff
vm.runInNewContext(clientCode, {
  window: {
    __ModuleLoader__: {
      load(value) {
        handoff = value
      },
    },
  },
})
if (handoff?.id !== packageJson.name || typeof handoff.factory !== 'function') {
  throw new Error('built client must register the package id through window.__ModuleLoader__.load')
}
const react = await import('react')
const clientExports = handoff.factory((specifier) => {
  if (specifier === 'react') return react
  throw new Error(`built client requested undeclared loader external: ${specifier}`)
})
if (typeof clientExports.apply !== 'function' || !Array.isArray(clientExports.inject)) {
  throw new Error('built client must materialize apply and inject exports')
}

// Import the real built Host without Vitest aliases. Importing is not apply()
// and must not activate services or make a provider request.
const host = await import(pathToFileURL(resolve(root, 'lib/index.js')).href)
const baseline = JSON.parse(await readFile(resolve(root, 'deployment-baseline.json'), 'utf8'))
for (const symbol of baseline.requiredExports['.']) {
  if (!(symbol in host)) throw new Error(`built Host export is missing: ${symbol}`)
}
if (typeof host.apply !== 'function' || !Array.isArray(host.inject)) {
  throw new Error('built Host must export apply and inject')
}

const remote = (await import(pathToFileURL(resolve(root, 'lib/remote.js')).href)).default
const methods = remote.descriptors.map(descriptor => descriptor.method).sort()
if (JSON.stringify(methods) !== JSON.stringify(['cancel', 'discoverModels', 'ensureModels', 'migrationStatus', 'reconcile', 'signOut', 'start', 'status'])) {
  throw new Error('built Remote entry must expose exactly seven authorization controls and independent migrationStatus')
}
for (const descriptor of remote.descriptors) {
  if (descriptor.id !== `dsh-github-copilot:githubCopilot.${descriptor.method}`
    || descriptor.service !== 'githubCopilotAuthorization' || descriptor.namespace !== 'githubCopilot') {
    throw new Error('built Remote descriptor identity must match its exact owned service and namespace')
  }
  if (descriptor.invocation.kind !== 'direct' || descriptor.parameters.length !== 0) {
    throw new Error(`built Remote ${descriptor.namespace}/${descriptor.method} must remain a no-parameter direct call`)
  }
  const typeSymbol = descriptor.method === 'migrationStatus'
    ? 'dsh-github-copilot#GitHubCopilotMigrationStatus'
    : 'dsh-github-copilot#GitHubCopilotAuthorizationView'
  if (
    descriptor.result.mode !== 'strict'
    || descriptor.result.typeSymbol !== typeSymbol
    || typeof descriptor.result.schema?.parse !== 'function'
  ) {
    throw new Error(`built Remote ${descriptor.namespace}/${descriptor.method} must expose its own exact strict result codec`)
  }
}
const migrationCodec = remote.descriptors.find(descriptor => descriptor.method === 'migrationStatus').result.schema
const migration = {
  plugin: { name: packageJson.name, version: packageJson.version }, protocolVersion: 1,
  historyScope: 'live-agents-only', observedAt: 0,
  capabilities: { agentsList: false, sessionProjections: false, settingsCas: false, providerRegistry: false, defaultSelection: false },
  complete: { sessions: false, defaultSelection: false, routes: false }, defaultSelection: null, sessions: [],
  routes: { nativeConfigured: null, nativeRegistered: null, managedRegistered: null },
}
migrationCodec.parse(migration)
for (const invalid of [
  { ...migration, credentials: 'private' },
  { ...migration, plugin: { ...migration.plugin, installPath: 'private' } },
  { ...migration, defaultSelection: { provider: 'p', model: 'm', token: 'private' } },
  { ...migration, sessions: [{ id: 's', status: 'idle', effectiveSelection: null, selectionSource: 'unknown', activeRequestSelection: null, title: 'private' }] },
]) {
  if (migrationCodec.safeParse(invalid).success) throw new Error('built migration codec must reject private fields')
}

console.log('Verified built Host import/exports, Client loader, Remote codecs, and type/metadata presence. No live DSH activation or model calls performed.')
