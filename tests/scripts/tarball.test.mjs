import assert from 'node:assert/strict'
import { test } from 'node:test'
import { gzipSync } from 'node:zlib'
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readTarball, verifyTarball } from '../../scripts/verify-tarball.mjs'

function entry(name, content, type = '0') {
  const header = Buffer.alloc(512)
  header.write(name, 0, 100)
  header.write('0000644\0', 100, 8)
  header.write(content.length.toString(8).padStart(11, '0') + '\0', 124, 12)
  header.fill(32, 148, 156)
  header.write(type, 156, 1)
  header.write('ustar\0', 257, 6)
  const sum = header.reduce((a, b) => a + b, 0)
  header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8)
  const body = Buffer.alloc(Math.ceil(content.length / 512) * 512)
  body.write(content)
  return Buffer.concat([header, body])
}
const pack = files => gzipSync(Buffer.concat([...files, Buffer.alloc(1024)]))

test('tar inspector refuses traversal, duplicate entries, links, corruption and truncation', () => {
  assert.equal(readTarball(pack([entry('package/README.md', 'hello')])).size, 1)
  assert.throws(() => readTarball(pack([entry('package/../secret', '')])), /Unsafe/)
  assert.throws(() => readTarball(pack([entry('package/x', ''), entry('package/x', '')])), /Duplicate/)
  assert.throws(() => readTarball(pack([entry('package/link', '', '2')])), /Unsupported/)
  const damaged = entry('package/x', '')
  damaged[10] ^= 1
  assert.throws(() => readTarball(pack([damaged])), /checksum mismatch/)
  assert.throws(() => readTarball(gzipSync(entry('package/x', 'hello').subarray(0, 512))), /Truncated/)
  assert.throws(() => readTarball(gzipSync(Buffer.concat([entry('package/x', ''), Buffer.alloc(512)]))), /terminator/)
  assert.throws(() => readTarball(gzipSync(Buffer.concat([entry('package/x', ''), Buffer.alloc(512), entry('package/extra', '')]))), /trailing payload/)
  assert.throws(() => readTarball(gzipSync(Buffer.concat([entry('package/x', ''), Buffer.alloc(1024), entry('package/extra', '')]))), /trailing payload/)
})

test('archive validation catches missing exports, stale builds and absent README media', async () => {
  const root = await mkdtemp(join(tmpdir(), 'copilot-tarball-'))
  try {
    const pkg = { name: 'test', version: '1.0.0', private: true, files: [], exports: { '.': { default: './lib/index.js', types: './lib/types/index.d.ts' } }, dependencies: {}, peerDependencies: {}, dsh: {} }
    const data = new Map([
      ['package.json', JSON.stringify(pkg)],
      ['deployment-baseline.json', JSON.stringify({ package: { version: '1.0.0' } })],
      ['README.md', '![preview](./docs/images/example.png)'],
      ['README.zh.md', 'guide'], ['LICENSE', 'license'], ['cordis.patch.yml', '[]'],
      ['lib/index.js', 'host'], ['lib/client.js', 'client'], ['lib/remote.js', 'remote'],
      ['lib/types/index.d.ts', 'types'], ['docs/images/example.png', 'synthetic'],
    ])
    for (const [path, content] of data) {
      const full = join(root, path)
      await mkdir(join(full, '..'), { recursive: true })
      await writeFile(full, content)
    }
    const archive = join(root, 'test.tgz')
    const save = async () => writeFile(archive, pack([...data].map(([path, content]) => entry('package/' + path, content))))
    await save()
    assert.equal((await verifyTarball(archive, root)).ok, true)
    for (const mutation of [
      { scripts: { postinstall: 'echo unexpected-install-behavior' } },
      { type: 'commonjs' },
      { engines: { node: '>=99' } },
      { imports: { '#package.json': './other.json' } },
      { optionalDependencies: { unexpected: '1.0.0' } },
    ]) {
      data.set('package.json', JSON.stringify({ ...pkg, ...mutation }))
      await save()
      await assert.rejects(verifyTarball(archive, root), /manifest differs/)
    }
    data.set('package.json', JSON.stringify(pkg))
    data.delete('lib/types/index.d.ts')
    await save()
    await assert.rejects(verifyTarball(archive, root), /Missing archive export/)
    data.set('lib/types/index.d.ts', 'types')
    data.set('lib/index.js', 'stale')
    await save()
    await assert.rejects(verifyTarball(archive, root), /differs from verified build/)
    data.set('lib/index.js', 'host')
    data.set('lib/types/index.d.ts', 'stale-types')
    await save()
    await assert.rejects(verifyTarball(archive, root), /differs from verified build/)
    data.set('lib/types/index.d.ts', 'types')
    data.set('docs/images/example.png', 'stale-media')
    await save()
    await assert.rejects(verifyTarball(archive, root), /differs from verified build/)
    data.set('docs/images/example.png', 'synthetic')
    data.delete('docs/images/example.png')
    await save()
    await assert.rejects(verifyTarball(archive, root), /Packed README image missing/)
    data.set('.env', 'synthetic-secret')
    await save()
    await assert.rejects(verifyTarball(archive, root), /Unexpected file/)
  } finally { await rm(root, { recursive: true, force: true }) }
})
