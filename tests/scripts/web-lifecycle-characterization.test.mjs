import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { fileURLToPath } from 'node:url'

test('model integration overlay leaves native Web ownership unchanged', async () => {
  const bundle = fileURLToPath(new URL('../../cordis.patch.yml', import.meta.url))
  const patches = loadOverlayPatches('test', bundle)
  assert.deepEqual(patches, [{
    insert: [{ id: 'github-copilot', name: 'dsh-github-copilot' }],
  }])
})

test('historical Web lifecycle reproduction remains attributable to its original revision', async () => {
  const evidence = await readFile(new URL('../../docs/web-lifecycle-rc2.md', import.meta.url), 'utf8')
  assert.match(evidence, /Historical evidence/)
  assert.match(evidence, /cb6bccbc861d1e09097abd5127772b9115a70c5a/)
  assert.match(evidence, /not the current model-integration candidate/)
  assert.match(evidence, /cannot be reproduced by running the current candidate's tests/)
})
