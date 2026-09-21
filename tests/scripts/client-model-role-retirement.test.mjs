import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'

const root = new URL('../../', import.meta.url)
const client = readFileSync(new URL('src/client.ts', root), 'utf8')

// Dependency-free source inventory, complementary to the actual Cordis apply()
// and slot lifecycle assertions in tests/client-no-model-roles.spec.ts. This is
// not a build, browser or live-runtime acceptance claim.
test('Client entry no longer imports, exports or injects the retired role UI', () => {
  assert.doesNotMatch(client, /DualModelCard|registerDualModelUi|remote\.githubCopilotDualModel|dual-model-(?:card|ui)/)
  assert.doesNotMatch(client, /github-copilot-dual-model|Model roles|模型分工/)
})

test('Client retains neighboring account, search and usage contributions', () => {
  assert.match(client, /ctx\.inject\(\['remote\.githubCopilot', 'slots'\], registerUi\)/)
  assert.match(client, /ctx\.inject\(\['remote\.settings', 'remote\.githubCopilotSearchRouting', 'slots'\], registerSearchUi\)/)
  assert.match(client, /ctx\.inject\(\['remote\.githubCopilotUsage', 'slots'\], registerCopilotUsageUi\)/)
  for (const slot of ['settings.models.provider-card', 'settings.models.footer', 'settings.section']) {
    assert.ok(client.includes(`name: '${slot}'`), `Missing retained slot: ${slot}`)
  }
  assert.match(client, /export \{ WebSearchRoutingCard \}/)
  assert.match(client, /export \{ CopilotUsageCard \}/)
})

test('obsolete role UI components and browser fixtures are removed, not exported for old tests', () => {
  for (const path of [
    'src/dual-model-card.ts', 'src/dual-model-ui.ts', 'src/current-workspace.ts',
    'tests/dual-model-card.spec.ts', 'tests/dual-model-ui.spec.ts',
    'tests/dual-model-workspace-ui.spec.ts', 'tests/current-workspace.spec.ts',
    'tests/browser/dual-model.html', 'tests/browser/serve-dual-model.mjs',
  ]) assert.equal(existsSync(new URL(path, root)), false, `Obsolete role UI file still exists: ${path}`)
  const browser = readFileSync(new URL('tests/browser/verify-native-selects.mjs', root), 'utf8')
  assert.doesNotMatch(browser, /dual-model|\/dual\b|workspaceFlows/)
  assert.match(browser, /tests\/browser\/search-routing\.html/)
  assert.match(browser, /data-dsh-web-search-routing/)
})
