import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const source = await readFile(new URL('../../src/web-search-routing-card.ts', import.meta.url), 'utf8')
const notice = source.slice(source.indexOf("createElement('div', { role: 'note', style: lifecycleNoticeStyle"),
  source.indexOf("restartRequired ? createElement"))

test('lifecycle notice is version-neutral, conditional guidance rather than runtime detection', () => {
  assert.ok(notice.length > 0)
  assert.match(notice, /Desktop plugin lifecycle \/ Desktop 插件生命周期/)
  assert.match(notice, /If the plugin manager reports restart-required/)
  assert.match(notice, /fully exit and restart Desktop/)
  assert.match(notice, /do not toggle it repeatedly/)
  assert.match(notice, /This note does not detect your Desktop version or a restart requirement/)
  assert.match(notice, /若插件管理器提示 restart-required/)
  assert.match(notice, /请完全退出并重新启动 Desktop/)
  assert.match(notice, /本提示不检测 Desktop 版本或是否需要重启/)
  assert.doesNotMatch(notice, /Desktop \d|After disabling, removing, or upgrading this plugin/)
})

test('README guidance links retain the stable evidence path and separate historical observations', async () => {
  for (const name of ['README.md', 'README.zh.md']) {
    const readme = await readFile(new URL(`../../${name}`, import.meta.url), 'utf8')
    assert.match(readme, /\.\/docs\/web-lifecycle-rc2\.md#desktop-guidance/)
  }
  const evidence = await readFile(new URL('../../docs/web-lifecycle-rc2.md', import.meta.url), 'utf8')
  assert.match(evidence, /## Desktop guidance/)
  assert.match(evidence, /## Historical rc\.2 Desktop disable observation/)
  assert.match(evidence, /does not detect the installed Desktop version/)
  assert.match(evidence, /not a blanket instruction to restart after every disable, removal or upgrade/)
})
