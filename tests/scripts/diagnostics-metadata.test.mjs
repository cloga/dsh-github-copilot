import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

test('diagnostics metadata retains JSON attributes for unbundled Node imports', async () => {
  for (const entry of ['diagnostics-host', 'diagnostics-client']) {
    const source = await readFile(new URL(`../../src/${entry}.ts`, import.meta.url), 'utf8')
    assert.match(source, /import packageJson from '#package\.json' with \{ type: 'json' \}/)
  }
})
