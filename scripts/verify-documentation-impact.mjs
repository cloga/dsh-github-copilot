import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { isImportantFile } from './release-policy.mjs'

const error = code => { throw new Error(`DOCUMENTATION_IMPACT_${code}`) }
const deliveryError = code => { throw new Error(`DELIVERY_IMPACT_${code}`) }
const isDocumentation = path => path === 'README.md' || path === 'README.zh.md'
  || path === 'AGENTS.md' || path === 'CONTRIBUTING.md' || path === 'CHANGELOG.md'
  || (/^docs\/[A-Za-z0-9][A-Za-z0-9._/-]*\.md$/.test(path)
    && !path.includes('..') && !path.includes('//'))
const requiresAssessment = path => isImportantFile(path) || path.startsWith('scripts/')
  || path.startsWith('.github/workflows/') || path === 'agent-contract.json' || path === 'AGENTS.md'

function readFields(body, heading, names, fail) {
  if (typeof body !== 'string') fail('DECLARATION_REQUIRED')
  const visible = body.replace(/<!--[\s\S]*?(?:-->|$)/g, '')
  const headings = [...visible.matchAll(new RegExp(`^${heading}[ \\t]*\\r?$`, 'gm'))]
  if (headings.length !== 1) fail('DECLARATION_REQUIRED')
  const start = headings[0].index + headings[0][0].length
  const remaining = visible.slice(start)
  const end = remaining.search(/^#{1,3}[ \t]+/m)
  const section = end < 0 ? remaining : remaining.slice(0, end)
  const fields = {}
  for (const match of section.matchAll(/^- ([A-Za-z]+):[ \t]*(.*)\r?$/gm)) {
    if (!names.includes(match[1])) continue
    if (Object.hasOwn(fields, match[1])) fail('DUPLICATE_FIELD')
    fields[match[1]] = match[2].trim()
  }
  if (typeof fields.Details !== 'string' || Array.from(fields.Details).length < 20) fail('DETAILS_REQUIRED')
  return fields
}

function fieldsFromBody(body) {
  const fields = readFields(body, '### Documentation impact', ['Behavior', 'Docs', 'Details'], error)
  if (!['user-facing', 'unchanged'].includes(fields.Behavior)) error('BEHAVIOR_REQUIRED')
  return fields
}

export function assessDeliveryImpact({ changedFiles, body, baseManifest, manifest }) {
  if (!Array.isArray(changedFiles) || changedFiles.some(path => typeof path !== 'string')) deliveryError('FILES_INVALID')
  for (const value of [baseManifest, manifest]) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)
      || typeof value.version !== 'string' || value.version.length === 0) deliveryError('MANIFEST_INVALID')
  }
  const fields = readFields(body, '## Release delivery', ['Classification', 'Details', 'Authorization'], deliveryError)
  const classification = fields.Classification
  if (!['repository-only', 'plugin-update', 'explicit-plugin-artifact', 'release-recovery'].includes(classification)) {
    deliveryError('CLASSIFICATION_REQUIRED')
  }
  const important = changedFiles.some(isImportantFile)
  if (classification === 'repository-only' || classification === 'release-recovery') {
    if (important || !isDeepStrictEqual(baseManifest, manifest)) deliveryError('REPOSITORY_PACKAGE_CHANGE')
    return { classification, localInstallation: 'not-needed' }
  }
  if (classification === 'explicit-plugin-artifact') {
    if (typeof fields.Authorization !== 'string' || Array.from(fields.Authorization).length < 20) {
      deliveryError('ARTIFACT_AUTHORIZATION_REQUIRED')
    }
  } else {
    const consumerFields = ({ version, files, ...rest }) => rest
    const consumerChange = changedFiles.some(path => isImportantFile(path)
      && path !== 'package.json' && path !== 'deployment-baseline.json')
      || !isDeepStrictEqual(consumerFields(baseManifest), consumerFields(manifest))
    if (!important || !consumerChange) deliveryError('CONSUMER_CHANGE_REQUIRED')
  }
  return { classification, localInstallation: 'separate-authorization' }
}

function normalized(text, versions) {
  let value = text.replaceAll('\r\n', '\n')
  for (const version of [...versions].sort((a, b) => b.length - a.length)) {
    value = value.replaceAll(version, '<version>')
  }
  return value
}

export function assessDocumentationImpact({ changedFiles, body, before = {}, after = {}, versions = [] }) {
  if (!Array.isArray(changedFiles) || changedFiles.some(path => typeof path !== 'string')) error('FILES_INVALID')
  if (!changedFiles.some(requiresAssessment)) return { required: false }
  const fields = fieldsFromBody(body)
  if (fields.Behavior === 'unchanged') return { required: true, behavior: 'unchanged' }
  if (!Array.isArray(versions) || versions.length !== 2
    || versions.some(version => typeof version !== 'string' || version.length === 0)) {
    error('VERSIONS_INVALID')
  }
  const docs = (fields.Docs ?? '').split(',').map(path => path.trim().replace(/^`([^`]+)`$/, '$1'))
  if (docs.some(path => !isDocumentation(path)) || new Set(docs).size !== docs.length
    || !docs.includes('README.md') || !docs.includes('README.zh.md')
    || !docs.some(path => path.startsWith('docs/'))) error('DOCS_REQUIRED')
  for (const path of docs) {
    if (!changedFiles.includes(path) || typeof after[path] !== 'string' || after[path].trim().length === 0) {
      error('DOCUMENT_NOT_CHANGED')
    }
    if (before[path] !== undefined && (typeof before[path] !== 'string'
      || normalized(before[path], versions) === normalized(after[path], versions))) {
      error('DOCUMENT_VERSION_ONLY')
    }
  }
  return { required: true, behavior: 'user-facing', docs }
}

function git(root, args) {
  const result = spawnSync('git', ['-C', root, ...args], {
    encoding: 'utf8', timeout: 15000, maxBuffer: 8 * 1024 * 1024, windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  })
  if (result.error || result.status !== 0) error('GIT_UNAVAILABLE')
  return result.stdout
}

function blobAt(root, ref, path) {
  const entry = git(root, ['ls-tree', '-z', ref, '--', path])
  if (entry === '') return undefined
  if (!/^(100644|100755) blob [a-f0-9]+\t/.test(entry) || !entry.endsWith(`\t${path}\0`)) {
    error('DOCUMENT_INVALID')
  }
  return git(root, ['show', `${ref}:${path}`])
}

async function verifyPullRequest(root, env) {
  if (env.GITHUB_EVENT_NAME !== 'pull_request' || !env.GITHUB_EVENT_PATH
    || !env.GITHUB_BASE_REF || env.GITHUB_BASE_REF.includes('\0')) error('EVENT_INVALID')
  let event
  try { event = JSON.parse(await readFile(env.GITHUB_EVENT_PATH, 'utf8')) }
  catch { error('EVENT_INVALID') }
  if (typeof event !== 'object' || event === null || typeof event.pull_request !== 'object'
    || event.pull_request === null) error('EVENT_INVALID')
  const baseRef = `refs/remotes/origin/${env.GITHUB_BASE_REF}`
  git(root, ['check-ref-format', baseRef])
  const base = git(root, ['merge-base', baseRef, 'HEAD']).trim()
  if (!/^[a-f0-9]{40,64}$/.test(base)) error('BASE_INVALID')
  const changedFiles = git(root, ['diff', '--no-renames', '--name-only', '-z', '--diff-filter=ACDMRT', `${base}...HEAD`])
    .split('\0').filter(Boolean)
  if (!changedFiles.some(requiresAssessment)) return { required: false }
  const fields = fieldsFromBody(event.pull_request.body)
  const basePackage = git(root, ['show', `${base}:package.json`])
  const headPackage = git(root, ['show', 'HEAD:package.json'])
  let baseManifest, manifest
  try {
    baseManifest = JSON.parse(basePackage)
    manifest = JSON.parse(headPackage)
  } catch { deliveryError('MANIFEST_INVALID') }
  const delivery = assessDeliveryImpact({ changedFiles, body: event.pull_request.body, baseManifest, manifest })
  if (fields.Behavior === 'unchanged') {
    return { ...assessDocumentationImpact({ changedFiles, body: event.pull_request.body }), delivery }
  }
  const before = {}
  const after = {}
  for (const path of changedFiles.filter(isDocumentation)) {
    before[path] = blobAt(root, base, path)
    after[path] = blobAt(root, 'HEAD', path)
  }
  const versions = [baseManifest.version, manifest.version]
  return { ...assessDocumentationImpact({ changedFiles, body: event.pull_request.body, before, after, versions }), delivery }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await verifyPullRequest(process.cwd(), process.env)
    console.log(JSON.stringify({ ok: true, ...result }))
  } catch (failure) {
    const code = failure instanceof Error && /^(DOCUMENTATION|DELIVERY)_IMPACT_[A-Z_]+$/.test(failure.message)
      ? failure.message : 'DOCUMENTATION_IMPACT_UNAVAILABLE'
    console.error(code)
    process.exitCode = 1
  }
}
