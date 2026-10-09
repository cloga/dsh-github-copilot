import { access, readFile, readdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import vm from 'node:vm'
import { importsRuntimePackage } from './runtime-imports.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
for (const name of ['@deepseek-ai/dsh-authorization', '@deepseek-ai/schemastery']) {
  if (packageJson.dependencies?.[name] !== undefined || packageJson.optionalDependencies?.[name] !== undefined) {
    throw new Error(`package must not bundle Desktop host package ${name}`)
  }
  if (packageJson.peerDependencies?.[name] === undefined || packageJson.peerDependenciesMeta?.[name]?.optional === true) {
    throw new Error(`package must require Desktop host peer ${name}`)
  }
  if (packageJson.devDependencies?.[name] === undefined) {
    throw new Error(`package development must retain ${name}`)
  }
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
const requestedExternals = []
const clientExports = handoff.factory((specifier) => {
  requestedExternals.push(specifier)
  if (specifier === 'react') return react
  throw new Error(`built client requested undeclared loader external: ${specifier}`)
})
if (JSON.stringify(packageJson.dsh?.client?.external) !== JSON.stringify(['react'])
  || JSON.stringify([...new Set(requestedExternals)]) !== JSON.stringify(['react'])
  || packageJson.dependencies?.react !== undefined || packageJson.optionalDependencies?.react !== undefined
  || packageJson.peerDependencies?.react !== undefined || packageJson.devDependencies?.react === undefined) {
  throw new Error('built Client must load the singleton React external without adding it to the Node package graph')
}
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

const recovery = await import(pathToFileURL(resolve(root, 'lib/manual-compaction-recovery.js')).href)
if (typeof recovery.default !== 'function') throw new Error('built recovery engine must remain independently importable')
for (const file of (await readdir(resolve(root, 'lib'))).filter(file => file.endsWith('.js'))) {
  if (importsRuntimePackage(await readFile(resolve(root, 'lib', file), 'utf8'), '@deepseek-ai/dsh-jobs')) {
    throw new Error('jobs must remain a type-only development dependency, not a bundled runtime import')
  }
}
const recoveryTypes = await readFile(resolve(root, 'lib/types/manual-compaction-recovery.d.ts'), 'utf8')
if (/dsh-jobs|background-compaction/u.test(recoveryTypes)
  || packageJson.devDependencies?.['@deepseek-ai/dsh-jobs'] === undefined
  || ['dependencies', 'optionalDependencies', 'peerDependencies'].some(field => packageJson[field]?.['@deepseek-ai/dsh-jobs'] !== undefined)) {
  throw new Error('recovery public declarations and deployment must not require the jobs type dependency')
}

const remote = (await import(pathToFileURL(resolve(root, 'lib/remote.js')).href)).default
const authorizationDescriptors = remote.descriptors.filter(descriptor => descriptor.namespace === 'githubCopilot')
const roleDescriptors = remote.descriptors.filter(descriptor => descriptor.namespace === 'githubCopilotDualModel')
const catalogDescriptors = remote.descriptors.filter(descriptor => descriptor.namespace === 'githubCopilotSearchRouting')
const usageDescriptors = remote.descriptors.filter(descriptor => descriptor.namespace === 'githubCopilotUsage')
const selectionDescriptors = remote.descriptors.filter(descriptor => descriptor.namespace === 'githubCopilotTurnSelection')
const replayDescriptors = remote.descriptors.filter(descriptor => descriptor.namespace === 'githubCopilotReplayRecovery')
const accountDescriptors = remote.descriptors.filter(descriptor => descriptor.namespace === 'githubCopilotAccounts')
const sessionAccountDescriptors = remote.descriptors.filter(descriptor => descriptor.namespace === 'githubCopilotSessionAccount')
const continuationDescriptors = remote.descriptors.filter(descriptor => descriptor.namespace === 'githubCopilotSessionContinuation')
const diagnosticsDescriptors = remote.descriptors.filter(descriptor => descriptor.namespace === 'githubCopilotDiagnostics')
const methods = authorizationDescriptors.map(descriptor => descriptor.method).sort()
if (remote.descriptors.length !== 50 || JSON.stringify(methods) !== JSON.stringify(['cancel', 'discoverModels', 'ensureModels', 'excludeModel', 'migrationStatus', 'reconcile', 'restoreModel', 'setModelExcluded', 'setModelHighCost', 'signOut', 'start', 'status'])
  || JSON.stringify(roleDescriptors.map(descriptor => descriptor.method).sort()) !== JSON.stringify(['create', 'save', 'view'])
  || JSON.stringify(catalogDescriptors.map(descriptor => descriptor.method)) !== JSON.stringify(['providers'])
  || JSON.stringify(usageDescriptors.map(descriptor => descriptor.method).sort()) !== JSON.stringify(['get', 'refresh'])
  || JSON.stringify(selectionDescriptors.map(descriptor => descriptor.method)) !== JSON.stringify(['get', 'requestedModels', 'allocationSummary'])
  || JSON.stringify(replayDescriptors.map(descriptor => descriptor.method).sort()) !== JSON.stringify(['authorize', 'get', 'setEnabled'])
  || JSON.stringify(accountDescriptors.map(descriptor => descriptor.method).sort()) !== JSON.stringify(['add', 'cancel', 'ensureIdentity', 'get', 'reauthorize', 'refreshIdentity', 'removeAccount', 'switchAccount'])
  || JSON.stringify(sessionAccountDescriptors.map(descriptor => descriptor.method).sort()) !== JSON.stringify(['ensureIdentity', 'get', 'refreshIdentity', 'refreshUsage', 'set', 'turn', 'usage'])
  || JSON.stringify(continuationDescriptors.map(descriptor => descriptor.method).sort()) !== JSON.stringify(['authorizeNext', 'defaults', 'get', 'set', 'setDefault'])
  || JSON.stringify(diagnosticsDescriptors.map(descriptor => descriptor.method).sort()) !== JSON.stringify(['clear', 'get', 'recordClient', 'setAutoAllocationEnabled', 'setEnabled', 'setRequestEnabled'])) {
  throw new Error('built Remote entry must retain existing controls and independent account controls')
}
for (const descriptor of diagnosticsDescriptors) {
  const parameterized = descriptor.method === 'setEnabled' || descriptor.method === 'setAutoAllocationEnabled'
    || descriptor.method === 'setRequestEnabled'
    || descriptor.method === 'recordClient'
  if (descriptor.id !== `dsh-github-copilot:githubCopilotDiagnostics.${descriptor.method}`
    || descriptor.service !== 'githubCopilotDiagnostics' || descriptor.scope !== undefined
    || descriptor.invocation.kind !== 'direct' || descriptor.parameters.length !== (parameterized ? 1 : 0)
    || descriptor.result.mode !== 'strict' || descriptor.result.typeSymbol !== 'dsh-github-copilot#DiagnosticsView') {
    throw new Error('diagnostics Remote must preserve strict content-free direct contracts')
  }
  const snapshot = { schemaVersion: 1, coverageVersion: 1, epoch: 0, updatedAt: 0, rows: [], pending: [],
    dropped: 0, clientDropped: 0, clientUnconfirmed: 0, saturated: 0, evicted: 0, interrupted: 0 }
  const view = { enabled: false, autoAllocationEnabled: false, state: 'ready', diagnostic: 'none', dirty: false, snapshot }
  descriptor.result.schema.parse(view)
  if (descriptor.result.schema.safeParse({ ...view, credentials: 'private' }).success
    || descriptor.result.schema.safeParse({ ...view, snapshot: { ...snapshot, sessionId: 'private' } }).success) {
    throw new Error('diagnostics Remote accepts sensitive or identity fields')
  }
  if (parameterized) {
    const parameter = descriptor.parameters[0]
    const setting = descriptor.method === 'setEnabled' || descriptor.method === 'setAutoAllocationEnabled'
      || descriptor.method === 'setRequestEnabled'
    const wire = setting ? 'enabled' : 'batch'
    const typeSymbol = descriptor.method === 'setEnabled' ? 'dsh-github-copilot#DiagnosticsEnabled'
      : descriptor.method === 'setAutoAllocationEnabled' ? 'dsh-github-copilot#AutoAllocationDiagnosticsEnabled'
        : descriptor.method === 'setRequestEnabled' ? 'dsh-github-copilot#RequestDiagnosticsEnabled'
        : 'dsh-github-copilot#ClientDiagnosticsBatch'
    if (parameter.source !== 'json' || parameter.wire !== wire
      || parameter.codec.mode !== 'strict'
      || parameter.codec.typeSymbol !== typeSymbol
      || parameter.codec.schema.safeParse(setting ? 'true' : { epoch: 0, rows: [], sessionId: 'private' }).success) {
      throw new Error('diagnostics Remote accepts invalid or identifying parameters')
    }
    parameter.codec.schema.parse(setting ? false : { epoch: 0, rows: [] })
  }
}
for (const descriptor of continuationDescriptors) {
  const [agent] = descriptor.parameters
  const global = descriptor.method === 'defaults' || descriptor.method === 'setDefault'
  if (descriptor.id !== `dsh-github-copilot:githubCopilotSessionContinuation.${descriptor.method}`
    || descriptor.service !== 'githubCopilotSessionContinuation' || descriptor.scope !== undefined
    || descriptor.invocation.kind !== 'direct' || descriptor.result.mode !== 'strict'
    || !global && (agent.source !== 'lookup' || agent.lookup !== 'agent' || agent.wire !== 'agentId' || agent.codec.mode !== 'strict')
    || descriptor.parameters.length !== (descriptor.method === 'defaults' ? 0 : descriptor.method === 'setDefault' ? 2
      : descriptor.method === 'get' ? 1 : 3)) {
    throw new Error('continuation Remote must retain strict explicit Agent lookup')
  }
}
for (const descriptor of sessionAccountDescriptors) {
  const [agent] = descriptor.parameters
  if (descriptor.id !== `dsh-github-copilot:githubCopilotSessionAccount.${descriptor.method}`
    || descriptor.service !== 'githubCopilotSessionAccount' || descriptor.invocation.kind !== 'direct'
    || descriptor.scope !== undefined || descriptor.parameters.length !== (descriptor.method === 'set' ? 3 : descriptor.method === 'turn' ? 2 : 1)
    || agent.source !== 'lookup' || agent.lookup !== 'agent' || agent.wire !== 'agentId'
    || agent.codec.mode !== 'strict' || descriptor.result.mode !== 'strict') {
    throw new Error('Session account Remote must preserve explicit Agent lookup and strict contracts')
  }
  if (descriptor.method === 'set') {
    const [, account, revision] = descriptor.parameters
    if (account.codec.schema.parse(null) !== null || account.codec.schema.parse('canonical') !== 'canonical'
      || account.codec.schema.safeParse('invalid').success || revision.codec.schema.safeParse(-1).success) {
      throw new Error('Session account preference must preserve strict inheritance and CAS')
    }
  }
}
for (const descriptor of accountDescriptors) {
  const mutation = ['reauthorize', 'removeAccount', 'switchAccount'].includes(descriptor.method)
  if (descriptor.id !== `dsh-github-copilot:githubCopilotAccounts.${descriptor.method}`
    || descriptor.service !== 'githubCopilotAccounts' || descriptor.invocation.kind !== 'direct'
    || descriptor.scope !== undefined || descriptor.parameters.length !== (mutation ? 2 : 0)
    || descriptor.result.mode !== 'strict'
    || descriptor.result.typeSymbol !== 'dsh-github-copilot#CopilotAccountsView') throw new Error('account Remote identity or codec differs')
  const view = { state: 'ready', activeAccountId: 'canonical', writable: false, switchable: false, accounts: [], notices: [] }
  descriptor.result.schema.parse(view)
  if (descriptor.result.schema.safeParse({ ...view, credentials: 'private' }).success
    || descriptor.result.schema.safeParse({ ...view, activeAccountId: 'invalid' }).success) throw new Error('account Remote accepts private fields or invalid account identity')
  if (mutation) {
    const [accountId, expectedRevision] = descriptor.parameters
    if (accountId.wire !== 'accountId' || accountId.source !== 'json' || accountId.codec.mode !== 'strict'
      || accountId.codec.schema.parse('canonical') !== 'canonical' || accountId.codec.schema.safeParse('invalid').success
      || expectedRevision.wire !== 'expectedRevision' || expectedRevision.source !== 'json'
      || expectedRevision.codec.mode !== 'strict' || expectedRevision.codec.schema.parse(0) !== 0
      || expectedRevision.codec.schema.safeParse(-1).success) throw new Error('account Remote must retain strict selector CAS parameters')
  }
}
for (const descriptor of replayDescriptors) {
  if (descriptor.id !== `dsh-github-copilot:githubCopilotReplayRecovery.${descriptor.method}`
    || descriptor.service !== 'githubCopilotReplayRecovery' || descriptor.invocation.kind !== 'direct'
    || descriptor.scope !== undefined || descriptor.parameters[0].lookup !== 'agent'
    || descriptor.parameters[0].wire !== 'agentId' || descriptor.parameters[0].source !== 'lookup'
    || descriptor.parameters.length !== (descriptor.method === 'get' ? 1 : 3)
    || descriptor.result.mode !== 'strict'
    || descriptor.result.typeSymbol !== 'dsh-github-copilot#ReplayRecoveryView') throw new Error('replay recovery Remote binding differs')
  descriptor.result.schema.parse({ state: 'unavailable' })
  if (descriptor.result.schema.safeParse({ state: 'unavailable', input: [] }).success) {
    throw new Error('replay recovery Remote accepts request content')
  }
}
const selection = selectionDescriptors[0]
const requested = selectionDescriptors[1]
const allocation = selectionDescriptors[2]
if (allocation.id !== 'dsh-github-copilot:githubCopilotTurnSelection.allocationSummary'
  || allocation.service !== 'githubCopilotTurnSelection' || allocation.invocation.kind !== 'direct'
  || allocation.scope !== undefined || allocation.parameters.length !== 1
  || allocation.parameters[0].source !== 'lookup' || allocation.parameters[0].lookup !== 'agent'
  || allocation.parameters[0].wire !== 'agentId' || allocation.result.mode !== 'strict'
  || allocation.result.typeSymbol !== 'dsh-github-copilot#AutoAllocationSummary') {
  throw new Error('allocation observations must retain explicit native Agent lookup')
}
const emptyAllocation = { policyVersion: 'high-cost-v1', scope: 'viewed-session-host-lifetime',
  status: 'not-collected', retainedDecisions: 0, noFitDecisions: 0, rowsTruncated: false,
  completeHistory: false, observationStart: null, observationEnd: null, rows: [] }
allocation.result.schema.parse(emptyAllocation)
if (allocation.result.schema.safeParse({ ...emptyAllocation, credentials: 'private' }).success
  || allocation.result.schema.safeParse({ ...emptyAllocation, completeHistory: true }).success) {
  throw new Error('allocation observations accept sensitive fields or fabricated complete history')
}
if (requested.id !== 'dsh-github-copilot:githubCopilotTurnSelection.requestedModels'
  || requested.invocation.kind !== 'direct' || requested.scope !== undefined
  || requested.parameters[0].source !== 'lookup' || requested.parameters[0].lookup !== 'agent'
  || requested.parameters[1].wire !== 'turn' || requested.result.mode !== 'strict'
  || requested.result.typeSymbol !== 'dsh-github-copilot#RequestedModels'
  || requested.result.schema.safeParse({ routes: [], incomplete: true, content: 'private' }).success) {
  throw new Error('requested model evidence must retain explicit lookup and strict content-free results')
}
if (selection.id !== 'dsh-github-copilot:githubCopilotTurnSelection.get'
  || selection.service !== 'githubCopilotTurnSelection' || selection.invocation.kind !== 'direct'
  || selection.scope !== undefined
  || selection.parameters.length !== 2 || selection.parameters[0].source !== 'lookup'
  || selection.parameters[0].lookup !== 'agent' || selection.parameters[0].wire !== 'agentId'
  || selection.parameters[0].codec.typeSymbol !== '@deepseek-ai/dsh-session/types#SessionId'
  || selection.parameters[1].source !== 'json' || selection.parameters[1].wire !== 'turn'
  || selection.result.mode !== 'strict' || selection.result.typeSymbol !== 'dsh-github-copilot#TurnSelection') {
  throw new Error('turn selection Remote must retain explicit Session arguments and native agent lookup without ambient scope projection')
}
selection.result.schema.parse({ mode: 'manual' })
if (selection.result.schema.safeParse({ mode: 'manual', model: 'invented' }).success
  || selection.parameters[1].codec.schema.safeParse(-1).success) throw new Error('turn selection Remote accepts invalid evidence or turn')
if (typeof clientExports.CopilotUsageCard !== 'function') throw new Error('built Client must export the account usage card')
for (const descriptor of usageDescriptors) {
  if (descriptor.id !== `dsh-github-copilot:githubCopilotUsage.${descriptor.method}`
    || descriptor.service !== 'githubCopilotUsage' || descriptor.invocation.kind !== 'direct'
    || descriptor.parameters.length !== 0 || descriptor.result.mode !== 'strict'
    || descriptor.result.typeSymbol !== 'dsh-github-copilot#CopilotUsageView') throw new Error('quota Remote identity or codec differs')
  const view = { state: 'ready', billing: 'credits', budget: 'pooled', used: 10, observedAt: 1 }
  descriptor.result.schema.parse(view)
  if (descriptor.result.schema.safeParse({ ...view, credentials: 'private' }).success
    || descriptor.result.schema.safeParse({ ...view, remaining: 20 }).success) {
    throw new Error('quota Remote accepts private fields or fabricated pooled balances')
  }
}
const catalog = catalogDescriptors[0]
if (catalog.id !== 'dsh-github-copilot:githubCopilotSearchRouting.providers'
  || catalog.service !== 'githubCopilotSearchRouting' || catalog.invocation.kind !== 'direct'
  || catalog.parameters.length !== 0 || catalog.result.mode !== 'strict'
  || catalog.result.typeSymbol !== 'dsh-github-copilot#SearchProviderCatalog') throw new Error('search catalog Remote identity or codec differs')
catalog.result.schema.parse({ supported: true, providers: [{ id: 'fixture-provider' }] })
if (catalog.result.schema.safeParse({ supported: true, providers: [{ id: 'fixture-provider', credentials: 'private' }] }).success) {
  throw new Error('search catalog output accepts private provider fields')
}
for (const descriptor of authorizationDescriptors) {
  if (descriptor.id !== `dsh-github-copilot:githubCopilot.${descriptor.method}`
    || descriptor.service !== 'githubCopilotAuthorization' || descriptor.namespace !== 'githubCopilot') {
    throw new Error('built Remote descriptor identity must match its exact owned service and namespace')
  }
  const highCostPreference = descriptor.method === 'setModelHighCost'
  const narrowPreference = descriptor.method === 'setModelExcluded' || highCostPreference
  const modelPreference = narrowPreference || descriptor.method === 'excludeModel' || descriptor.method === 'restoreModel'
  if (descriptor.invocation.kind !== 'direct'
    || descriptor.parameters.length !== (narrowPreference ? 2 : modelPreference ? 1 : 0)) {
    throw new Error(`built Remote ${descriptor.namespace}/${descriptor.method} has an unexpected direct-call parameter contract`)
  }
  if (modelPreference) {
    const parameter = descriptor.parameters[0]
    if (parameter.name !== 'modelId' || parameter.wire !== 'modelId' || parameter.source !== 'json'
      || parameter.codec.mode !== 'strict'
      || parameter.codec.schema.parse('gpt-5.4') !== 'gpt-5.4'
      || parameter.codec.schema.safeParse('').success) {
      throw new Error(`built Remote ${descriptor.namespace}/${descriptor.method} must retain the strict exact modelId parameter`)
    }
  }
  const typeSymbol = descriptor.method === 'migrationStatus'
    ? 'dsh-github-copilot#GitHubCopilotMigrationStatus'
    : narrowPreference ? 'dsh-github-copilot#GitHubCopilotModelPreferencesView'
    : 'dsh-github-copilot#GitHubCopilotAuthorizationView'
  if (
    descriptor.result.mode !== 'strict'
    || descriptor.result.typeSymbol !== typeSymbol
    || typeof descriptor.result.schema?.parse !== 'function'
  ) {
    throw new Error(`built Remote ${descriptor.namespace}/${descriptor.method} must expose its own exact strict result codec`)
  }
  if (narrowPreference) {
    const parameter = descriptor.parameters[1]
    const field = highCostPreference ? 'highCost' : 'excluded'
    if (parameter.name !== field || parameter.wire !== field || parameter.source !== 'json'
      || parameter.codec.mode !== 'strict'
      || parameter.codec.typeSymbol !== (highCostPreference
        ? 'dsh-github-copilot#GitHubCopilotModelHighCost' : 'dsh-github-copilot#GitHubCopilotModelExcluded')
      || parameter.codec.schema.parse(true) !== true || parameter.codec.schema.parse(false) !== false
      || parameter.codec.schema.safeParse('false').success) {
      throw new Error('narrow model preference Remote must retain its strict boolean argument')
    }
    const preferences = { state: 'ready', writable: true, revision: 1,
      excludedModelIds: ['gpt-5.4'], highCostModelIds: ['gpt-5.4'], lockedModelIds: [], unavailableExcludedModelIds: [] }
    descriptor.result.schema.parse(preferences)
    if (descriptor.result.schema.safeParse({ ...preferences, credentials: 'private' }).success
      || descriptor.result.schema.safeParse({ ...preferences, revision: -1 }).success) {
      throw new Error('narrow exclusion Remote accepts private fields or invalid revision')
    }
  }
}
if ('DualModelCard' in clientExports) throw new Error('built Client must not export the retired model-role settings card')
const roleView = { supported: false, writable: false, revision: null,
  configuration: { enabled: false, plannerModel: '', executorModel: '' }, models: [], workspaces: [] }
for (const descriptor of roleDescriptors) {
  if (descriptor.id !== `dsh-github-copilot:githubCopilotDualModel.${descriptor.method}`
    || descriptor.service !== 'githubCopilotDualModel' || descriptor.invocation.kind !== 'direct') {
    throw new Error('built model-role descriptor must use its independent exact identity')
  }
  const create = descriptor.method === 'create', view = descriptor.method === 'view'
  const expectedType = `dsh-github-copilot#${create ? 'DualModelCreateResult' : 'DualModelView'}`
  if (descriptor.result.mode !== 'strict' || descriptor.result.typeSymbol !== expectedType
    || descriptor.parameters.length !== (view ? 0 : 1)) throw new Error('built model-role codecs or arity differ')
  const expected = create ? { sessionId: 'fixture-session' } : roleView
  descriptor.result.schema.parse(expected)
  if (descriptor.result.schema.safeParse({ ...expected, credential: 'private' }).success) throw new Error('model-role output accepts private fields')
  if (!view) {
    const parameter = descriptor.parameters[0]
    if (parameter.name !== 'input' || parameter.wire !== 'input' || parameter.source !== 'json'
      || parameter.codec.mode !== 'strict' || parameter.codec.typeSymbol !== `dsh-github-copilot#${create ? 'DualModelCreateRequest' : 'DualModelSaveRequest'}`) {
      throw new Error('built model-role input must retain its exact strict JSON contract')
    }
    const input = create ? { requestId: '993601ac-140a-4fe5-a841-80fc14d249f9', workspaceId: 'workspace', expectedRevision: 0 }
      : { configuration: roleView.configuration, expectedRevision: 0 }
    parameter.codec.schema.parse(input)
    if (parameter.codec.schema.safeParse({ ...input, globalDefault: true }).success
      || parameter.codec.schema.safeParse({ ...input, expectedRevision: -1 }).success) throw new Error('built model-role input accepts invalid scope or revision')
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
