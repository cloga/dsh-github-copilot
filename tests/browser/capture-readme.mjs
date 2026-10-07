import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const base = new URL(process.argv[2])
assert.equal(base.hostname, '127.0.0.1', 'Use the isolated loopback fixture server')
assert.equal(base.protocol, 'http:')
assert.ok(process.env.PLAYWRIGHT_MODULE, 'Set PLAYWRIGHT_MODULE to an existing Playwright index.mjs')
const { chromium } = await import(pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE)).href)
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge', headless: true })
const errors = [], external = [], captures = {}
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
try {
  const page = await browser.newPage({ viewport: { width: 920, height: 1000 } })
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/*', route => {
    if (new URL(route.request().url()).origin === base.origin) return route.continue()
    external.push(route.request().url()); return route.abort()
  })
  const open = async (surface, theme = 'dark') => {
    await page.goto(new URL(`/readme?surface=${surface}&theme=${theme}`, base).href)
    await page.waitForFunction(() => window.fixture?.synthetic === true)
    await page.waitForFunction(() => window.CopilotContinuation?.SessionContinuationCard !== undefined)
    if (surface === 'models') {
      await page.getByRole('button', { name: 'Manage', exact: true }).click()
      await page.getByText('Current default', { exact: true }).first().waitFor()
    }
    if (surface === 'credits') {
      await page.getByRole('button', { name: /^Credits/ }).click()
      await page.getByRole('button', { name: 'Switch account', exact: true }).waitFor()
    }
    if (surface === 'settings') await page.getByText('Collection paused · Storage ready', { exact: true }).waitFor()
  }
  const capture = async (name, locator) => {
    const bytes = await locator.screenshot({ path: resolve(root, 'docs/images', name) })
    captures[name] = hash(bytes)
  }
  await open('models')
  await page.locator('summary').filter({ hasText: 'Model preferences ·' }).click()
  await page.getByRole('checkbox', { name: /High cost/ }).first().waitFor()
  await page.locator('summary').filter({ hasText: 'New Session continuation default' }).click()
  await page.getByRole('checkbox', { name: /Enable visible-history continuation for new Sessions/ }).waitFor()
  await capture('copilot-model-preferences.png', page.locator('main'))
  await open('models')
  await page.getByRole('button', { name: 'Switch', exact: true }).click()
  await page.getByRole('button', { name: /demo-work/ }).waitFor()
  await capture('copilot-accounts.png', page.locator('main'))
  await open('credits')
  await page.getByRole('button', { name: 'Switch account', exact: true }).click()
  await page.getByRole('button', { name: /demo-work/ }).waitFor()
  assert.ok((await page.locator('[data-copilot-usage-panel]').boundingBox()).height > 400,
    'Place Credits at the composer-like bottom anchor so its quota panel is not clipped')
  await capture('copilot-accounts-credits.png', page.locator('[data-copilot-usage-panel]'))
  await open('credits')
  await page.locator('summary').filter({ hasText: 'Visible-history continuation' }).click()
  await page.getByRole('combobox', { name: 'Session policy' }).waitFor()
  await page.getByText('The active turn keeps its policy; changes apply next turn.').waitFor()
  await capture('copilot-session-continuation.png', page.locator('[data-copilot-usage-panel]'))
  await open('settings')
  await capture('copilot-search-routing.png', page.locator('main'))
  for (const width of [920, 375]) for (const theme of ['dark', 'light']) {
    await page.setViewportSize({ width, height: 1000 })
    for (const surface of ['models', 'credits', 'settings']) {
      await open(surface, theme)
      if (surface === 'models') {
        await page.locator('summary').filter({ hasText: 'Model preferences ·' }).click()
        await page.locator('summary').filter({ hasText: 'New Session continuation default' }).click()
        await page.getByRole('button', { name: 'Switch', exact: true }).click()
      }
      if (surface === 'credits') {
        await page.locator('summary').filter({ hasText: 'Visible-history continuation' }).click()
        await page.getByRole('button', { name: 'Switch account', exact: true }).click()
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false,
        `${surface}/${theme}/${width}: horizontal overflow`)
      const menu = page.locator('[popover][data-copilot-account-selector]')
      if (surface !== 'settings') {
        const bounds = await menu.boundingBox()
        assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width + 1, 'Account menu fits viewport')
        await page.keyboard.press('Escape')
        await menu.waitFor({ state: 'hidden' })
      }
    }
  }
  assert.deepEqual(errors, [], 'No page errors')
  assert.deepEqual(external, [], 'No external requests')
  const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
  const continuationBundle = await readFile(resolve(root, 'artifacts/readme-capture/continuation.js'))
  const provenance = {
    clientVersion: pkg.version,
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    source: `Local pnpm build from this ${pkg.version} release-candidate commit; not extracted from published archive bytes. Provenance accompanies packaged image assets.`,
    builtClientSha256: hash(await readFile(resolve(root, 'lib/client.js'))),
    continuationComponentBundleSha256: hash(continuationBundle),
    synthetic: true,
    fixture: 'tests/browser/readme.html',
    reproduce: 'pnpm build; pnpm exec tsdown --config tests/browser/capture-continuation.config.ts; node tests/browser/serve-search-routing.mjs; set PLAYWRIGHT_MODULE to an existing Playwright index.mjs; node tests/browser/capture-readme.mjs <printed-loopback-URL>',
    components: {
      'copilot-model-preferences.png': 'GitHubCopilotCompactAccount',
      'copilot-accounts.png': 'GitHubCopilotCompactAccount',
      'copilot-accounts-credits.png': 'CopilotUsageCard',
      'copilot-session-continuation.png': 'CopilotUsageCard + SessionContinuationCard',
      'copilot-search-routing.png': 'CopilotPluginSettingsPage',
    },
    imageSha256: captures,
    capture: { browser: `Microsoft Edge ${browser.version()}`, viewports: [920, 375], themes: ['dark', 'light'],
      horizontalOverflow: false, pageErrors: errors, externalRequests: false },
    limits: 'Actual current built Client components with synthetic settings, identities, models and quota. SessionContinuationCard is an isolated test-only bundle of the same source component, composed through the real CopilotUsageCard prop; it is not a new package export. No live OAuth, model availability, search, billing, collection, persistence or loaded Desktop proof. Desktop images are committed; narrow/light states were checked for overflow and menu dismissal, not native Desktop integration.',
  }
  await writeFile(resolve(root, 'docs/images/copilot-current-provenance.json'), JSON.stringify(provenance, null, 2) + '\n')
  console.log('Captured five current-component images; desktop/narrow, dark/light checks passed.')
} finally { await browser.close() }
