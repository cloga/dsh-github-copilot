import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { assertTaggedRuntimeClosure } from '../../scripts/tagged-runtime-closure.mjs'

const command = "pnpm install --frozen-lockfile --filter '@deepseek-ai/dsh-api-session-controller...'"
const imageOffloadCommand = "pnpm install --frozen-lockfile --filter '@deepseek-ai/dsh-compaction-image-offload...'"
const searchCommand = "pnpm install --frozen-lockfile --filter '@deepseek-ai/dsh-tool-web...' --filter '@deepseek-ai/dsh-web-search-deepseek...'"
const compactionCommand = "pnpm install --frozen-lockfile --filter '@deepseek-ai/dsh-agent-loop...' --filter '@deepseek-ai/dsh-compaction-basic...'"
const jobsCommand = "pnpm install --frozen-lockfile --filter '@deepseek-ai/dsh-jobs-local...' --filter '@deepseek-ai/dsh-commands...'"
const presetsCommand = "pnpm install --frozen-lockfile --filter '@deepseek-ai/dsh-agent-preset-registry...' --filter '@deepseek-ai/cordis-plugin-group...'"
for (const filename of ['ci.yml', 'release.yml']) {
  test(`${filename} installs unchanged native account persistence dependencies before tagged preparation`, async () => {
    const source = await readFile(new URL(`../../.github/workflows/${filename}`, import.meta.url), 'utf8')
    const blocks = source.split(/(?=^      - )/m)
    const index = blocks.findIndex(block => block.includes('Install native account persistence verification closure'))
    assert.ok(index >= 0)
    const block = blocks[index]
    assert.match(block, /working-directory: dsh-upstream/)
    assert.doesNotMatch(block, /^        if:/m)
    for (const name of ['credentials-local', 'app-boot', 'config-editor', 'settings', 'authorization']) {
      assert.ok(block.includes(`--filter '@deepseek-ai/dsh-${name}...'`))
    }
    assert.match(block, /pnpm install --frozen-lockfile/)
    assert.ok(index < blocks.findIndex(part => part.includes('node scripts/verify-tagged-core.mjs prepare')))
  })
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
    assert.throws(() => assertTaggedRuntimeClosure(source.replace(jobsCommand, 'echo omitted-jobs')), /background jobs dependency closure before preparation/)
    assert.throws(() => assertTaggedRuntimeClosure(source.replace(presetsCommand, 'echo omitted-presets')), /isolated preset dependency closure before preparation/)
    assert.throws(() => assertTaggedRuntimeClosure(source.replace(presetsCommand, `# ${presetsCommand}`)), /isolated preset dependency closure before preparation/)
    if (filename === 'ci.yml') {
      const block = source.split(/(?=^      - )/m).find(part => part.includes(compactionCommand))
      assert.doesNotMatch(block, /^        if:/m)
    }
  })
}

test('wrong installation anchor or ordering cannot satisfy the gate', () => {
  const install = `      - name: Install test closure\n        working-directory: dsh-upstream\n        run: ${command}\n      - name: Install image-offload closure\n        working-directory: dsh-upstream\n        run: ${imageOffloadCommand}\n      - name: Install search closure\n        working-directory: dsh-upstream\n        run: ${searchCommand}\n      - name: Install compaction closure\n        working-directory: dsh-upstream\n        run: ${compactionCommand}\n`
  const prepare = '      - name: Prepare runtime\n        run: |\n          node scripts/verify-tagged-core.mjs prepare --root .\n'
  const jobsStep = `      - name: Install jobs closure\n        working-directory: dsh-upstream\n        run: ${jobsCommand}\n`
  const presetsStep = `      - name: Install preset closure\n        working-directory: dsh-upstream\n        run: ${presetsCommand}\n`
  assert.equal(assertTaggedRuntimeClosure(install + jobsStep + presetsStep + prepare), true)
  assert.throws(() => assertTaggedRuntimeClosure(install + jobsStep + prepare + presetsStep), /isolated preset dependency closure before preparation/)
  assert.throws(() => assertTaggedRuntimeClosure(install + jobsStep + presetsStep.replace('working-directory: dsh-upstream', 'working-directory: .') + prepare), /isolated preset closure must run unconditionally/)
  assert.throws(() => assertTaggedRuntimeClosure(install + jobsStep + presetsStep.replace('        run:', '        if: false\n        run:') + prepare), /isolated preset closure must run unconditionally/)
  assert.throws(() => assertTaggedRuntimeClosure(install + prepare + jobsStep), /background jobs dependency closure before preparation/)
  assert.throws(() => assertTaggedRuntimeClosure(install + jobsStep.replace('working-directory: dsh-upstream', 'working-directory: .') + prepare), /background jobs closure must run unconditionally/)
  assert.throws(() => assertTaggedRuntimeClosure(install + jobsStep.replace('        run:', '        if: false\n        run:') + prepare), /background jobs closure must run unconditionally/)
  assert.throws(() => assertTaggedRuntimeClosure(prepare + install), /before preparation/)
  assert.throws(() => assertTaggedRuntimeClosure(install.replace('working-directory: dsh-upstream', 'working-directory: .') + prepare), /pinned Core checkout/)
  const compactionStep = `      - name: Install compaction closure\n        working-directory: dsh-upstream\n        run: ${compactionCommand}\n`
  assert.throws(() => assertTaggedRuntimeClosure(install.replace(compactionStep, '') + prepare + compactionStep), /compaction dependency closure before preparation/)
  assert.throws(() => assertTaggedRuntimeClosure(install.replace(compactionStep, compactionStep.replace('working-directory: dsh-upstream', 'working-directory: .')) + prepare), /compaction closure must be installed in the pinned Core checkout/)
})
