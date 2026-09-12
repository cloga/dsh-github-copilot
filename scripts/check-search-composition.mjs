import { createRequire } from 'node:module'
import { isDeepStrictEqual } from 'node:util'
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
    if (entry.group === true || Object.keys(entry).some(key => !['id', 'name', 'config', 'disabled', 'group', 'isolate'].includes(key))) reasons.add('WEB_ENTRY_REQUIRES_REVIEW')
    if (entry.disabled !== undefined && entry.disabled !== false) reasons.add('WEB_DISABLED_OR_DYNAMIC')
    if (entry.config !== undefined && (!entry.config || typeof entry.config !== 'object' || Array.isArray(entry.config)
      || Object.entries(entry.config).some(([key, value]) => !['searchProvider', 'fetchProvider'].includes(key) || typeof value !== 'string'))) reasons.add('WEB_CONFIG_REQUIRES_REVIEW')
    if (entry.isolate !== undefined && (!entry.isolate || typeof entry.isolate !== 'object' || Array.isArray(entry.isolate) || Object.keys(entry.isolate).length > 0)) reasons.add('PREEXISTING_WEB_ISOLATION')
  }
  return { schemaVersion: 1, supported: reasons.size === 0, reasons: [...reasons].sort(), scope: 'pre-install-structural-only; no boot, credentials, network or writes' }
}

function reportCandidate(reasons) {
  return { schemaVersion: 1, supported: reasons.size === 0, reasons: [...reasons].sort(), scope: 'candidate-structural-only; no boot, credentials, network or writes' }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function hasExpression(value) {
  if (!value || typeof value !== 'object') return false
  return Object.entries(value).some(([key, child]) => key === '__jsExpr' || key === '__js' || hasExpression(child))
}

function accountRows(entries) {
  const matches = []
  for (const entry of entries) {
    if (!isRecord(entry)) continue
    if (entry.id === 'github-copilot' || entry.name === 'dsh-github-copilot') matches.push(entry)
    if (entry.group === true && Array.isArray(entry.config)) matches.push(...accountRows(entry.config))
  }
  return matches
}

/** Only the bundle's reviewed, static service wiring is automatically supported. */
function routingRowValid(entry, name, isolated, account = false) {
  if (!entry || entry.name !== name) return false
  const keys = ['id', 'name', 'disabled', 'group', 'isolate', ...(account ? ['config'] : [])]
  if (Object.keys(entry).some(key => !keys.includes(key))) return false
  if (entry.disabled !== undefined && entry.disabled !== false) return false
  if (entry.group !== undefined && entry.group !== false) return false
  if (isolated) {
    if (!isDeepStrictEqual(entry.isolate, { web: realm })) return false
  } else if (entry.isolate !== undefined && (!isRecord(entry.isolate) || Object.keys(entry.isolate).length !== 0)) return false
  return entry.config === undefined || (account && isRecord(entry.config) && !hasExpression(entry.config))
}

function candidateViable(entries, baseline) {
  const original = baseline.find(entry => entry.id === 'web')
  const web = entries.find(entry => entry.id === 'web')
  if (!original || !web || !isDeepStrictEqual(web.isolate, { web: realm })) return false
  for (const [id, name, isolated, account] of [
    ['github-copilot-web-delegate', 'dsh-github-copilot/web-delegate', true, false],
    ['github-copilot-routed-web', 'dsh-github-copilot/routed-web', false, false],
    ['github-copilot', 'dsh-github-copilot', false, true],
  ]) {
    const matches = entries.filter(entry => entry.id === id)
    if (matches.length !== 1 || !routingRowValid(matches[0], name, isolated, account)) return false
  }
  // Apart from the two new service rows and the original web's realm, the
  // candidate must preserve the entire routing-free tree, including user config.
  // These are parsed, owned config objects, never live Loader/Service objects.
  const restored = entries.filter(entry => !reserved.has(entry.id)).map(entry => {
    if (entry.id !== 'web') return entry
    const copy = { ...entry }
    if (Object.hasOwn(original, 'isolate')) copy.isolate = original.isolate
    else delete copy.isolate
    return copy
  })
  return isDeepStrictEqual(restored, baseline)
}

/** Read and compose the proposed normal launch without loadProfile's initialization/normalization writes. */
export async function inspectProfileSearchComposition({ profileDir, home, installAnchor, patches = [] }, suppliedBoot) {
  const native = suppliedBoot ?? await import(pathToFileURL(createRequire(installAnchor).resolve('@deepseek-ai/dsh-app-boot')).href)
  const { readProfileManifest, resolveBundleDir, loadOverlayPatches, loadOptionalPatches, composeEntries } = native
  const bin = 'copilot-search-preflight'
  const manifest = readProfileManifest(bin, profileDir)
  const reasons = new Set()
  // Public CLI prepareProfile rewrites cordis.yml to [] before normal launch.
  // Never certify rows that only exist in that disposable file, or rewrite it.
  const root = loadOptionalPatches(bin, join(profileDir, 'cordis.yml'))
  if (root?.length) return reportCandidate(new Set(['NONEMPTY_DISPOSABLE_PROFILE_ROOT']))
  const candidate = loadOverlayPatches(bin, fileURLToPath(new URL('../cordis.patch.yml', import.meta.url)))
  const layers = []
  const baselineLayers = []
  let copilotLayers = 0
  let candidateIndex
  function addCandidate() {
    candidateIndex ??= layers.length
    layers.push(candidate)
    // The routing-free comparison retains the account row and its user config.
    baselineLayers.push([{ insert: [{ id: 'github-copilot', name: 'dsh-github-copilot' }] }])
  }
  for (const name of manifest.dsh?.profile?.bundles ?? []) {
    const directory = resolveBundleDir(bin, name, installAnchor, profileDir)
    const bundle = readProfileManifest(bin, directory)
    if (bundle.name === 'dsh-github-copilot') {
      copilotLayers++
      // Updating replaces our existing slot, not its position in bundle order.
      addCandidate()
      continue
    }
    if (typeof bundle.dsh?.bundle?.patch !== 'string') throw new Error('INVALID_BUNDLE_MANIFEST')
    const layer = loadOverlayPatches(bin, resolve(directory, bundle.dsh.bundle.patch))
    layers.push(layer)
    baselineLayers.push(layer)
  }
  if (copilotLayers === 0) addCandidate()
  const late = [
    loadOptionalPatches(bin, join(profileDir, 'cordis.patch.yml')) ?? [],
    loadOptionalPatches(bin, join(home, 'cordis.patch.yml')) ?? [],
    ...patches.map(file => loadOverlayPatches(bin, file)),
  ]
  const warn = () => reasons.add('UNAPPLIED_PATCH_REQUIRES_REVIEW')
  // Public composeEntries flattens each complete stack in one pass. Repeatedly
  // patching a previously composed tree would change the include's id index.
  const beforeGuard = composeEntries(layers.slice(0, candidateIndex), warn)
  const baseline = composeEntries([...baselineLayers, ...late], warn)
  for (const entries of [beforeGuard, baseline]) {
    for (const reason of checkSearchComposition(entries).reasons) reasons.add(reason)
  }
  const entries = composeEntries([...layers, ...late], warn)
  if (copilotLayers > 1 || accountRows(entries).length !== 1) reasons.add('DUPLICATE_COPILOT_ACCOUNT_ENTRY')
  if (!candidateViable(entries, baseline)) reasons.add('CANDIDATE_ROUTING_NOT_VIABLE')
  return reportCandidate(reasons)
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
