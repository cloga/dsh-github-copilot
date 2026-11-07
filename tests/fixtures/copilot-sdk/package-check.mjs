import assert from 'node:assert/strict'
import { readFile, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = await realpath(dirname(fileURLToPath(import.meta.url)))
const readJson = async path => JSON.parse(await readFile(path, 'utf8'))
const fixture = await readJson(join(root, 'package.json'))
const lock = await readJson(join(root, 'package-lock.json'))
const sdkRoot = await realpath(join(root, 'node_modules', '@github', 'copilot-sdk'))
const installed = await readJson(join(sdkRoot, 'package.json'))
const locked = lock.packages?.['node_modules/@github/copilot-sdk']

function assertInside(parent, path) {
  const suffix = relative(parent, path)
  assert.ok(suffix && suffix !== '..' && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix))
}

assertInside(root, sdkRoot)
assert.equal(fixture.dependencies?.['@github/copilot-sdk'], '1.0.28')
assert.equal(lock.packages?.['']?.dependencies?.['@github/copilot-sdk'], '1.0.28')
assert.equal(installed.name, '@github/copilot-sdk')
assert.equal(installed.version, '1.0.28')
assert.equal(locked?.version, '1.0.28')
assert.equal(typeof locked.resolved, 'string')
assert.equal(typeof locked.integrity, 'string')

const source = new URL(locked.resolved)
assert.equal(source.protocol, 'https:')
assert.equal(source.hostname, 'registry.npmjs.org')
assert.equal(source.port, '')
assert.equal(source.username, '')
assert.equal(source.password, '')
assert.equal(source.search, '')
assert.equal(source.hash, '')
assert.equal(decodeURIComponent(source.pathname), '/@github/copilot-sdk/-/copilot-sdk-1.0.28.tgz')
assert.match(locked.integrity, /^sha512-[A-Za-z0-9+/]+={0,2}$/)
const digest = locked.integrity.slice('sha512-'.length)
assert.equal(Buffer.from(digest, 'base64').length, 64)
assert.equal(Buffer.from(digest, 'base64').toString('base64'), digest)

const entry = await realpath(fileURLToPath(import.meta.resolve('@github/copilot-sdk')))
assertInside(sdkRoot, entry)
const sdk = await import('@github/copilot-sdk')
assert.equal(typeof sdk.CopilotClient, 'function')

console.log(JSON.stringify({
  package: installed.name,
  version: installed.version,
  source: source.href,
  integrity: locked.integrity,
  evidence: 'npm-verified-install-and-public-import',
  transitiveVersionsPinnedInRepository: false,
  tierRpcExecuted: false,
  clientStarted: false,
}))
