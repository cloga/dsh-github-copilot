/** Optional browser proof using an already available Playwright module; no dependency install. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const args = process.argv.slice(2)
const allowed = new Set(['--playwright-module', '--output', '--channel', '--headless'])
for (const arg of args) if (arg.startsWith('--')) assert.ok(allowed.has(arg), `Unknown option: ${arg}`)
const option = (name, fallback) => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1] }
const modulePath = option('--playwright-module')
assert.ok(modulePath, 'Pass --playwright-module pointing to an existing Playwright module; this fixture never installs one')
const out = resolve(option('--output', resolve(root, 'artifacts/dark-selects')))
const channel = option('--channel', 'msedge')
const require = createRequire(resolve(root, 'package.json'))
const routes = new Map([
  ['/dual', [resolve(root, 'tests/browser/dual-model.html'), 'text/html']],
  ['/search', [resolve(root, 'tests/browser/search-routing.html'), 'text/html']],
  ['/client.js', [resolve(root, 'lib/client.js'), 'text/javascript']],
  ['/react.js', [resolve(dirname(require.resolve('react/package.json')), 'umd/react.development.js'), 'text/javascript']],
  ['/react-dom.js', [resolve(dirname(require.resolve('react-dom/package.json')), 'umd/react-dom.development.js'), 'text/javascript']],
])
const server = createServer(async (req, res) => {
  const route = routes.get(new URL(req.url, 'http://fixture.invalid').pathname)
  if (req.method !== 'GET' || !route) { res.writeHead(404); res.end(); return }
  try { res.writeHead(200, { 'Content-Type': route[1], 'Cache-Control': 'no-store' }); res.end(await readFile(route[0])) }
  catch { res.writeHead(500); res.end('Build the plugin before running the fixture.') }
})
await new Promise(done => server.listen(0, '127.0.0.1', done))
const origin = `http://127.0.0.1:${server.address().port}`
let browser
const results = [], errors = []
const contrast = (a, b) => {
  const luminance = color => {
    const values = color.match(/[\d.]+/g)?.map(Number)
    assert.ok(values && values.length >= 3, `Unexpected computed color: ${color}`)
    assert.ok(values.length === 3 || values[3] === 1, 'Control surfaces must be opaque')
    const rgb = values.slice(0, 3).map(n => n / 255).map(n => n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4)
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722
  }
  const x = luminance(a), y = luminance(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}
try {
  await mkdir(out, { recursive: true })
  const { chromium } = await import(pathToFileURL(resolve(modulePath)).href)
  browser = await chromium.launch({ channel, headless: args.includes('--headless') })
  const context = await browser.newContext({ viewport: { width: 900, height: 900 }, colorScheme: 'light', locale: 'en-US' })
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  for (const [surface, selector, count] of [
    ['dual', '[data-dsh-dual-model-card] select', 2],
    ['search', '[data-dsh-web-search-routing] select', 2],
  ]) {
    await page.goto(`${origin}/${surface}?theme=dark&uaScheme=light&lang=en`)
    await page.locator(`${selector}:enabled`).first().waitFor()
    await page.evaluate(selector => { window.fixture.selectBeforeThemeChange = document.querySelector(selector) }, selector)
    const inspect = async (label, background, foreground) => {
      const controls = await page.locator(selector).evaluateAll(elements => elements.map(element => {
        const style = getComputedStyle(element)
        return { color: style.color, background: style.backgroundColor, disabled: element.disabled, value: element.value,
          options: [...element.options].map(option => { const s = getComputedStyle(option); return { color: s.color, background: s.backgroundColor, disabled: option.disabled } }) }
      }))
      assert.equal(controls.length, count)
      for (const control of controls) {
        assert.equal(control.background, background); assert.equal(control.color, foreground)
        assert.ok(contrast(control.color, control.background) >= 4.5)
        for (const option of control.options) {
          assert.equal(option.background, background)
          assert.ok(contrast(option.color, option.background) >= 4.5)
        }
      }
      const state = await page.evaluate(selector => ({ sameNode: window.fixture.selectBeforeThemeChange === document.querySelector(selector),
        writes: window.fixture.calls.length, overflow: document.documentElement.scrollWidth > innerWidth,
        scheme: getComputedStyle(document.documentElement).colorScheme }), selector)
      assert.equal(state.sameNode, true); assert.equal(state.writes, 0); assert.equal(state.overflow, false)
      results.push({ surface, case: label, controls, ...state })
    }
    await inspect('dark app with light UA', 'rgb(32, 33, 36)', 'rgb(237, 237, 237)')
    await page.screenshot({ path: resolve(out, `${surface}-dark-controls.png`) })
    await page.evaluate(() => window.fixture.setTheme('light'))
    await inspect('light app without remount', 'rgb(255, 255, 255)', 'rgb(36, 36, 36)')
    await page.screenshot({ path: resolve(out, `${surface}-light-controls.png`) })
    await page.setViewportSize({ width: 375, height: 812 })
    await page.evaluate(() => window.fixture.setTheme('dark'))
    await inspect('narrow dark app', 'rgb(32, 33, 36)', 'rgb(237, 237, 237)')
    await page.screenshot({ path: resolve(out, `${surface}-narrow.png`), fullPage: true })
    await page.setViewportSize({ width: 900, height: 900 })
    await page.evaluate(() => {
      for (const name of ['--dsw-alias-bg-layer-1', '--dsw-alias-label-primary', '--dsw-alias-label-secondary', '--dsw-alias-border-l2']) document.body.style.setProperty(name, 'initial')
    })
    const fallback = await page.locator(selector).first().evaluate(element => ({ color: getComputedStyle(element).color, background: getComputedStyle(element).backgroundColor }))
    assert.ok(contrast(fallback.color, fallback.background) >= 4.5)
    results.push({ surface, case: 'missing-token system fallback', ...fallback })
  }
  // The role card has no destination picker: creation follows an explicit current
  // workspace prop, while saving and drafts remain independent of navigation.
  const workspaceFlows = []
  for (const locale of ['en', 'zh']) {
    const labels = locale === 'en'
      ? { enable: 'Enable dual-model sessions', planner: 'Planning model', executor: 'Execution model', save: 'Save configuration', create: 'Create session with this configuration', retry: 'Retry the same creation request' }
      : { enable: '启用双模型会话', planner: '主模型（规划）', executor: '执行模型', save: '保存配置', create: '用此配置新建会话', retry: '重试同一创建请求' }
    await page.setViewportSize({ width: locale === 'en' ? 900 : 375, height: 900 })
    await page.goto(`${origin}/dual?theme=dark&lang=${locale}&workspace=none`)
    await page.getByLabel(labels.enable, { exact: true }).check()
    await page.getByLabel(labels.planner, { exact: true }).selectOption('account-planner')
    await page.getByLabel(labels.executor, { exact: true }).selectOption('account-executor')
    assert.equal(await page.locator('[data-dsh-dual-model-card] select').count(), 2)
    await page.getByRole('button', { name: labels.save, exact: true }).click()
    await page.waitForFunction(() => window.fixture.calls.length === 1)
    assert.equal(await page.getByRole('button', { name: labels.create, exact: true }).isDisabled(), true)
    const save = await page.evaluate(() => window.fixture.calls[0])
    assert.deepEqual(Object.keys(save.input).sort(), ['configuration', 'expectedRevision'])
    await page.evaluate(() => window.fixture.setWorkspace('demo-workspace'))
    const destination = page.locator('[data-dsh-dual-model-workspace]')
    await page.waitForFunction(() => document.querySelector('[data-dsh-dual-model-workspace]')?.getAttribute('data-workspace-id') === 'demo-workspace')
    await page.getByLabel(labels.executor, { exact: true }).selectOption('account-planner')
    await page.evaluate(() => window.fixture.setWorkspace('second-workspace'))
    await page.waitForFunction(() => document.querySelector('[data-dsh-dual-model-workspace]')?.getAttribute('data-workspace-id') === 'second-workspace')
    assert.equal(await page.getByLabel(labels.executor, { exact: true }).inputValue(), 'account-planner')
    await page.getByRole('button', { name: labels.save, exact: true }).click()
    await page.waitForFunction(() => window.fixture.calls.length === 2)
    await page.evaluate(() => window.fixture.setWorkspace('unknown-workspace'))
    await page.waitForFunction(() => document.querySelector('[data-dsh-dual-model-workspace]')?.getAttribute('data-workspace-id') === 'unknown-workspace')
    assert.equal(await page.getByRole('button', { name: labels.create, exact: true }).isDisabled(), true)
    await page.evaluate(() => {
      window.fixture.setWorkspace('second-workspace')
      const original = window.fixture.remote.create
      let first = true
      window.fixture.remote.create = async input => {
        if (first) { first = false; window.fixture.calls.push({ method: 'create', input }); throw new Error('Synthetic uncertain result') }
        return original(input)
      }
    })
    await page.getByRole('button', { name: labels.create, exact: true }).click()
    await page.getByRole('button', { name: labels.retry, exact: true }).waitFor()
    await page.evaluate(() => window.fixture.setWorkspace('demo-workspace'))
    assert.equal(await destination.getAttribute('data-workspace-id'), 'second-workspace')
    assert.equal(await page.evaluate(() => window.fixture.calls.filter(c => c.method === 'create').length), 1)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    await page.screenshot({ path: resolve(out, `workspace-${locale}-pending.png`), fullPage: true })
    await page.getByRole('button', { name: labels.retry, exact: true }).click()
    await page.waitForFunction(() => window.fixture.opened !== undefined)
    const creates = await page.evaluate(() => window.fixture.calls.filter(c => c.method === 'create'))
    assert.equal(creates.length, 2)
    assert.deepEqual(creates[0].input, creates[1].input)
    assert.equal(creates[0].input.workspaceId, 'second-workspace')
    workspaceFlows.push({ locale, savesWithoutWorkspace: true, draftPreserved: true, unknownBlocked: true, retryInputPreserved: true })
  }
  assert.deepEqual(errors, [])
  const evidence = { channel, browserVersion: browser.version(), synthetic: true, results, workspaceFlows, errors,
    popupNote: 'These are page/control captures. Computed option styles do not attest Windows native popup painting; inspect the expanded native popup separately.' }
  await writeFile(resolve(out, 'results.json'), JSON.stringify(evidence, null, 2))
  console.log(JSON.stringify({ ok: true, channel, browserVersion: browser.version(), cases: results.length, workspaceFlows: workspaceFlows.length, output: out, synthetic: true }))
} finally {
  await browser?.close()
  await new Promise(done => server.close(done))
}
