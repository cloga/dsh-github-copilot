import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { assertTaggedRuntimeClosure } from '../../scripts/tagged-runtime-closure.mjs'

const command = "pnpm install --frozen-lockfile --filter '@deepseek-ai/dsh-api-session-controller...'"
const imageOffloadCommand = "pnpm install --frozen-lockfile --filter '@deepseek-ai/dsh-compaction-image-offload...'"
const searchCommand = "pnpm install --frozen-lockfile --filter '@deepseek-ai/dsh-tool-web...' --filter '@deepseek-ai/dsh-web-search-deepseek...'"
const compactionCommand = "pnpm install --frozen-lockfile --filter '@deepseek-ai/dsh-agent-loop...' --filter '@deepseek-ai/dsh-compaction-basic...'"
for (const filename of ['ci.yml', 'release.yml']) {
  test(`${filename} prepares the Session/Remote runtime dependency closure`, async () => {
    const source = await readFile(new URL(`../../.github/workflows/${filename}`, import.meta.url), 'utf8')
    assert.equal(assertTaggedRuntimeClosure(source), true)
    assert.equal(assertTaggedRuntimeClosure(source.replaceAll('\r\n', '\n').replaceAll('\n', '\r\n')), true)
    assert.throws(() => assertTaggedRuntimeClosure(source.replace(command, 'echo omitted-closure')), /dependency closure before preparation/)
    assert.throws(() => assertTaggedRuntimeClosure(source.replace(command, `# ${command}`)), /dependency closure before preparation/)
    assert.throws(() => assertTaggedRuntimeClosure(source.replace(imageOffloadCommand, 'echo omitted-image-offload')), /image-offload dependency closure before preparation/)
    assert.throws(() => assertTaggedRuntimeClosure(source.replace(searchCommand, 'echo omitted-search')), /search dependency closure before preparation/)
    assert.throws(() => assertTaggedRuntimeClosure(source.replace(compactionCommand, 'echo omitted-compaction')), /compaction dependency closure before preparation/)
    assert.throws(() => assertTaggedRuntimeClosure(source.replace(compactionCommand, `# ${compactionCommand}`)), /compaction dependency closure before preparation/)
    if (filename === 'ci.yml') {
      const block = source.split(/(?=^      - )/m).find(part => part.includes(compactionCommand))
      assert.match(block, /^        if: matrix\.dsh\.release == '0\.1\.6-alpha\.2'\s*$/m)
    }
  })
}

test('wrong installation anchor or ordering cannot satisfy the gate', () => {
  const install = `      - name: Install test closure\n        working-directory: dsh-upstream\n        run: ${command}\n      - name: Install image-offload closure\n        working-directory: dsh-upstream\n        run: ${imageOffloadCommand}\n      - name: Install search closure\n        working-directory: dsh-upstream\n        run: ${searchCommand}\n      - name: Install compaction closure\n        working-directory: dsh-upstream\n        run: ${compactionCommand}\n`
  const prepare = '      - name: Prepare runtime\n        run: |\n          node scripts/verify-tagged-core.mjs prepare --root .\n'
  assert.equal(assertTaggedRuntimeClosure(install + prepare), true)
  assert.throws(() => assertTaggedRuntimeClosure(prepare + install), /before preparation/)
  assert.throws(() => assertTaggedRuntimeClosure(install.replace('working-directory: dsh-upstream', 'working-directory: .') + prepare), /pinned Core checkout/)
  const compactionStep = `      - name: Install compaction closure\n        working-directory: dsh-upstream\n        run: ${compactionCommand}\n`
  assert.throws(() => assertTaggedRuntimeClosure(install.replace(compactionStep, '') + prepare + compactionStep), /compaction dependency closure before preparation/)
  assert.throws(() => assertTaggedRuntimeClosure(install.replace(compactionStep, compactionStep.replace('working-directory: dsh-upstream', 'working-directory: .')) + prepare), /compaction closure must be installed in the pinned Core checkout/)
})
