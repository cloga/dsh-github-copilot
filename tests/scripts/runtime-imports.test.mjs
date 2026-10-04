import assert from 'node:assert/strict'
import { test } from 'node:test'
import { importsRuntimePackage } from '../../scripts/runtime-imports.mjs'

test('detects static, side-effect, dynamic and require runtime imports including subpaths', () => {
  for (const source of [
    'import { x } from "@deepseek-ai/dsh-jobs";',
    'export { x } from "@deepseek-ai/dsh-jobs";',
    'import "@deepseek-ai/dsh-jobs";',
    'await import("@deepseek-ai/dsh-jobs/view");',
    'require("@deepseek-ai/dsh-jobs");',
  ]) assert.equal(importsRuntimePackage(source, '@deepseek-ai/dsh-jobs'), true)
})

test('package metadata and unrelated packages are not runtime imports', () => {
  for (const source of [
    'const metadata = {"devDependencies":{"@deepseek-ai/dsh-jobs":"0.2.0-rc.2"}};',
    'import { x } from "@deepseek-ai/dsh-jobs-local";',
  ]) assert.equal(importsRuntimePackage(source, '@deepseek-ai/dsh-jobs'), false)
})
