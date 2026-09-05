import { gunzipSync } from 'node:zlib'
import { open, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { repositoryRoot } from './agent.mjs'

const MAX_BYTES = 32 * 1024 * 1024
const text = bytes => bytes.toString('utf8').replace(/\0.*$/su, '')

/** Inspect bounded regular tar entries in memory. Never extract or execute downloaded code. */
export function readTarball(bytes) {
  if (bytes.length > MAX_BYTES) throw new Error('Archive exceeds inspection limit')
  const tar = gunzipSync(bytes, { maxOutputLength: MAX_BYTES })
  const files = new Map()
  let offset = 0
  let terminated = false
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512)
    if (header.every(byte => byte === 0)) {
      const remaining = tar.subarray(offset)
      if (remaining.length < 1024 || remaining.length % 512 !== 0 || !remaining.every(byte => byte === 0)) {
        throw new Error('Invalid tar terminator or trailing payload')
      }
      terminated = true
      break
    }
    const checksumText = text(header.subarray(148, 156)).trim()
    if (!/^[0-7]+$/.test(checksumText)) throw new Error('Invalid tar checksum')
    const expectedChecksum = Number.parseInt(checksumText, 8)
    const checksum = header.reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0)
    if (checksum !== expectedChecksum) throw new Error('Tar checksum mismatch')
    const sizeText = text(header.subarray(124, 136)).trim()
    if (!/^[0-7]+$/.test(sizeText)) throw new Error('Invalid tar entry size')
    const size = Number.parseInt(sizeText, 8)
    const prefix = text(header.subarray(345, 500))
    const name = `${prefix ? `${prefix}/` : ''}${text(header.subarray(0, 100))}`
    const type = header[156]
    if (!name.startsWith('package/') || name.includes('\\') || name.includes(':') || name.split('/').includes('..')) {
      throw new Error('Unsafe tar entry path')
    }
    const start = offset + 512
    if (start + size > tar.length) throw new Error('Truncated tar entry')
    if (type === 0 || type === 48) {
      if (files.has(name)) throw new Error('Duplicate tar entry')
      files.set(name, tar.subarray(start, start + size))
    } else if (type !== 53 || size !== 0) {
      throw new Error('Unsupported tar entry; only regular files and directories are allowed')
    }
    offset = start + Math.ceil(size / 512) * 512
  }
  if (!terminated) throw new Error('Tar terminator is missing')
  return files
}

async function readBoundedArchive(path) {
  const handle = await open(path, 'r')
  try {
    const info = await handle.stat()
    if (!info.isFile() || info.size > MAX_BYTES) throw new Error('Archive exceeds inspection limit or is not a regular file')
    const buffer = Buffer.alloc(info.size + 1)
    let length = 0
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length)
      if (bytesRead === 0) break
      length += bytesRead
    }
    if (length > info.size) throw new Error('Archive changed during inspection')
    return buffer.subarray(0, length)
  } finally { await handle.close() }
}

export async function verifyTarball(path, root = repositoryRoot) {
  const bytes = await readBoundedArchive(path)
  const files = readTarball(bytes)
  const parse = name => {
    if (!files.has(`package/${name}`)) throw new Error(`Missing archive entry: ${name}`)
    return JSON.parse(files.get(`package/${name}`).toString('utf8'))
  }
  const expected = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
  const pkg = parse('package.json')
  const baseline = parse('deployment-baseline.json')
  for (const field of ['name', 'version', 'private']) {
    if (pkg[field] !== expected[field]) throw new Error(`Archive package ${field} differs from checkout`)
  }
  // pnpm 11 removes packageManager and the local prepare/prepack hooks. All
  // other fields (especially install scripts, imports and engines) must match.
  const expectedPacked = { ...expected }
  delete expectedPacked.packageManager
  if (expected.scripts !== undefined) {
    expectedPacked.scripts = { ...expected.scripts }
    delete expectedPacked.scripts.prepare
    delete expectedPacked.scripts.prepack
  }
  if (!isDeepStrictEqual(pkg, expectedPacked)) throw new Error('Archive manifest differs from normalized checkout metadata')
  if (baseline.package.version !== pkg.version) throw new Error('Archive baseline version mismatch')
  const required = ['cordis.patch.yml', 'README.md', 'README.zh.md', 'LICENSE', 'deployment-baseline.json',
    ...expected.files.filter(path => path.endsWith('.md')),
  ]
  for (const target of Object.values(pkg.exports)) {
    required.push(...(typeof target === 'string' ? [target] : Object.values(target)))
  }
  for (const name of required) {
    const normalized = name.replace(/^\.\//u, '')
    if (!files.has(`package/${normalized}`)) throw new Error(`Missing archive export or document: ${normalized}`)
  }
  for (const name of files.keys()) {
    const relative = name.slice('package/'.length)
    const allowed = ['package.json', ...required.map(path => path.replace(/^\.\//u, ''))].includes(relative)
      || /^lib\/(?:[a-z0-9-]+\.js(?:\.map)?|types\/[a-z0-9-]+\.d\.ts)$/u.test(relative)
      || /^docs\/images\/[a-z0-9-]+\.(?:png|gif|webp)$/u.test(relative)
    if (!allowed) throw new Error(`Unexpected file in release archive: ${relative}`)
  }
  for (const [name, content] of files) {
    if (name === 'package/package.json') continue
    const relative = name.slice('package/'.length)
    const local = await readFile(resolve(root, relative))
    if (!content.equals(local)) throw new Error(`Archive differs from verified build: ${relative}`)
  }
  for (const doc of ['README.md', 'README.zh.md']) {
    const source = files.get(`package/${doc}`).toString('utf8')
    for (const match of source.matchAll(/!\[[^\]]*\]\(\.\/([^\s)]+)\)/gu)) {
      if (!files.has(`package/${match[1]}`)) throw new Error(`Packed README image missing: ${match[1]}`)
    }
  }
  return {
    schemaVersion: 1, ok: true, package: { name: pkg.name, version: pkg.version },
    files: files.size, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
    evidence: 'Archive structure, exports, bundled media and equality to local build. No live DSH or model calls.',
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2).filter(arg => arg !== '--')
  if (args.length !== 1) throw new Error('Usage: pnpm verify:tarball -- <archive.tgz>')
  console.log(JSON.stringify(await verifyTarball(resolve(args[0])), null, 2))
}
