import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { resolve, join, isAbsolute } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const realm = 'github-copilot-original-web'
const reserved = new Set(['github-copilot-web-delegate', 'github-copilot-routed-web'])

/** Structural pre-install validation only; never imports/boots configured plugins. */
export function checkSearchComposition(entries) {
  const reasons = new Set()
  const matches = []
  function walk(rows, depth) {
    if (!Array.isArray(rows)) { reasons.add('INVALID_ENTRY_LIST'); return }
    for (const entry of rows) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) { reasons.add('INVALID_ENTRY'); continue }
      if (entry.id === 'web') matches.push({ entry, depth })
      if (entry.name === '@deepseek-ai/dsh-web' && entry.id !== 'web') reasons.add('ADDITIONAL_OFFICIAL_WEB_SERVICE')
      if (reserved.has(entry.id) || ['dsh-github-copilot/web-delegate', 'dsh-github-copilot/routed-web'].includes(entry.name)) reasons.add('ROUTING_ENTRY_CONFLICT')
      if (entry.isolate !== undefined) {
        if (!entry.isolate || typeof entry.isolate !== 'object' || Array.isArray(entry.isolate)) reasons.add('UNKNOWN_ISOLATION')
        else {
          if (Object.values(entry.isolate).some(value => value === realm)) reasons.add('ROUTING_REALM_CONFLICT')
          if (Object.values(entry.isolate).some(value => typeof value !== 'boolean' && typeof value !== 'string')) reasons.add('UNKNOWN_ISOLATION')
        }
      }
      if (entry.group === true) walk(entry.config, depth + 1)
      else if (entry.group !== undefined && entry.group !== false) reasons.add('UNKNOWN_GROUP')
    }
  }
  walk(entries, 0)
  if (matches.length !== 1) reasons.add(matches.length === 0 ? 'WEB_ROW_MISSING' : 'MULTIPLE_WEB_ROWS')
  for (const { entry, depth } of matches) {
    if (depth !== 0) reasons.add('WEB_NOT_TOP_LEVEL')
    if (entry.name !== '@deepseek-ai/dsh-web') reasons.add('CUSTOM_WEB_SERVICE')
    if (entry.disabled !== undefined && entry.disabled !== false) reasons.add('WEB_DISABLED_OR_DYNAMIC')
    if (entry.config !== undefined && (!entry.config || typeof entry.config !== 'object' || Array.isArray(entry.config)
      || Object.entries(entry.config).some(([key, value]) => !['searchProvider', 'fetchProvider'].includes(key) || typeof value !== 'string'))) reasons.add('WEB_CONFIG_REQUIRES_REVIEW')
    if (entry.isolate !== undefined && (!entry.isolate || typeof entry.isolate !== 'object' || Array.isArray(entry.isolate) || Object.keys(entry.isolate).length > 0)) reasons.add('PREEXISTING_WEB_ISOLATION')
  }
  return { schemaVersion: 1, supported: reasons.size === 0, reasons: [...reasons].sort(), scope: 'pre-install-structural-only; no boot, credentials, network or writes' }
}

/** Read the normal profile layers using public parse/resolve APIs, without loadProfile's initialization/normalization writes. */
export async function inspectProfileSearchComposition({ profileDir, home, installAnchor, patches = [] }, suppliedBoot) {
  const native = suppliedBoot ?? await import(pathToFileURL(createRequire(installAnchor).resolve('@deepseek-ai/dsh-app-boot')).href)
  const { readProfileManifest, resolveBundleDir, loadOverlayPatches, loadOptionalPatches, composeEntries } = native
  const manifest = readProfileManifest('copilot-search-preflight', profileDir)
  const layers = []
  const root = loadOptionalPatches('copilot-search-preflight', join(profileDir, 'cordis.yml'))
  if (root?.length) layers.push([{ insert: root }])
  let copilotLayers = 0
  for (const name of manifest.dsh?.profile?.bundles ?? []) {
    const directory = resolveBundleDir('copilot-search-preflight', name, installAnchor, profileDir)
    const bundle = readProfileManifest('copilot-search-preflight', directory)
    if (bundle.name === 'dsh-github-copilot') {
      copilotLayers++
      // Retain the account row so existing user overrides still resolve. Remove
      // this package's own routing layer when validating an update's pre-state.
      layers.push([{ insert: [{ id: 'github-copilot', name: 'dsh-github-copilot' }] }])
      continue
    }
    if (typeof bundle.dsh?.bundle?.patch !== 'string') throw new Error('INVALID_BUNDLE_MANIFEST')
    layers.push(loadOverlayPatches('copilot-search-preflight', resolve(directory, bundle.dsh.bundle.patch)))
  }
  if (copilotLayers === 0) layers.push([{ insert: [{ id: 'github-copilot', name: 'dsh-github-copilot' }] }])
  layers.push(loadOptionalPatches('copilot-search-preflight', join(profileDir, 'cordis.patch.yml')) ?? [])
  layers.push(loadOptionalPatches('copilot-search-preflight', join(home, 'cordis.patch.yml')) ?? [])
  for (const file of patches) layers.push(loadOverlayPatches('copilot-search-preflight', file))
  let warned = false
  const entries = composeEntries(layers, () => { warned = true })
  const result = checkSearchComposition(entries)
  if (warned) result.reasons.push('UNAPPLIED_PATCH_REQUIRES_REVIEW')
  if (copilotLayers > 1 || entries.filter(entry => entry.id === 'github-copilot').length > 1) result.reasons.push('DUPLICATE_COPILOT_ACCOUNT_ENTRY')
  result.supported = result.reasons.length === 0
  return result
}

function parse(args) {
  const result = { patches: [] }
  for (let index = 0; index < args.length; index += 2) {
    const value = args[index + 1]
    if (!value || !isAbsolute(value)) throw new Error('INVALID_ARGUMENTS')
    const names = { '--profile-dir': 'profileDir', '--home': 'home', '--install-anchor': 'installAnchor' }
    const key = Object.hasOwn(names, args[index]) ? names[args[index]] : undefined
    if (args[index] === '--patch') result.patches.push(value)
    else if (!key || result[key]) throw new Error('INVALID_ARGUMENTS')
    else result[key] = value
  }
  if (!result.profileDir || !result.home || !result.installAnchor) throw new Error('INVALID_ARGUMENTS')
  return result
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parse(process.argv.slice(2))
    // Refuse missing profiles before any public reader could initialize one.
    await readFile(join(options.profileDir, 'package.json'), 'utf8')
    const result = await inspectProfileSearchComposition(options)
    console.log(JSON.stringify(result))
    if (!result.supported) process.exitCode = 1
  } catch {
    // Parse/provider-config errors can contain credentials. Never echo them.
    console.log(JSON.stringify({ schemaVersion: 1, supported: false, reasons: ['PREFLIGHT_INPUT_OR_PUBLIC_API_FAILED'], scope: 'read-only; no boot/install attempted' }))
    process.exitCode = 2
  }
}
