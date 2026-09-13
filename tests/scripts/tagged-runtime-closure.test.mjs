import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { assertTaggedRuntimeClosure } from '../../scripts/tagged-runtime-closure.mjs'

const command = "pnpm install --frozen-lockfile --filter '@deepseek-ai/dsh-api-session-controller...'"
const searchCommand = "pnpm install --frozen-lockfile --filter '@deepseek-ai/dsh-tool-web...' --filter '@deepseek-ai/dsh-web-search-deepseek...'"
for (const filename of ['ci.yml', 'release.yml']) {
  test(`${filename} prepares the Session/Remote runtime dependency closure`, async () => {
    const source = await readFile(new URL(`../../.github/workflows/${filename}`, import.meta.url), 'utf8')
    assert.equal(assertTaggedRuntimeClosure(source), true)
    assert.equal(assertTaggedRuntimeClosure(source.replaceAll('\r\n', '\n').replaceAll('\n', '\r\n')), true)
    assert.throws(() => assertTaggedRuntimeClosure(source.replace(command, 'echo omitted-closure')), /dependency closure before preparation/)
    assert.throws(() => assertTaggedRuntimeClosure(source.replace(command, `# ${command}`)), /dependency closure before preparation/)
    assert.throws(() => assertTaggedRuntimeClosure(source.replace(searchCommand, 'echo omitted-search')), /search dependency closure before preparation/)
  })
}

test('wrong installation anchor or ordering cannot satisfy the gate', () => {
  const install = `      - name: Install test closure\n        working-directory: dsh-upstream\n        run: ${command}\n      - name: Install search closure\n        working-directory: dsh-upstream\n        run: ${searchCommand}\n`
  const prepare = '      - name: Prepare runtime\n        run: |\n          node scripts/verify-tagged-core.mjs prepare --root .\n'
  assert.equal(assertTaggedRuntimeClosure(install + prepare), true)
  assert.throws(() => assertTaggedRuntimeClosure(prepare + install), /before preparation/)
  assert.throws(() => assertTaggedRuntimeClosure(install.replace('working-directory: dsh-upstream', 'working-directory: .') + prepare), /pinned Core checkout/)
})
