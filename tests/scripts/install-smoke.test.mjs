import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { hostDependencies, missingDependencyProbe, versionSatisfiesPeer } from '../../scripts/verify-install-smoke.mjs'

test('generated missing-dependency probe executes and rejects unexpected success or another missing package', () => {
  const run = (dependency, entry) => spawnSync(process.execPath, ['--input-type=module', '--eval',
    missingDependencyProbe(dependency, entry)], { encoding: 'utf8' })
  const missing = 'copilot-install-smoke-nonexistent-dependency'
  const failure = run(missing, `${missing}/remote`)
  assert.equal(failure.status, 0, failure.stderr)
  assert.match(failure.stdout, /EXPECTED_MISSING_RUNTIME_DEPENDENCY/u)
  assert.equal(run(missing, 'node:fs').status, 2)
  assert.equal(run(missing, 'another-copilot-smoke-missing-package').status, 3)
})

async function packageAt(root, name, version) {
  const directory = join(root, ...name.split('/'))
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'package.json'), JSON.stringify({ name, version }))
  return directory
}

test('host peer graph distinguishes exact host packages from missing optional peers', async () => {
  const root = await mkdtemp(join(tmpdir(), 'copilot-install-smoke-'))
  try {
    const modules = join(root, 'node_modules')
    await packageAt(modules, '@deepseek-ai/cordis', '4.0.5')
    await packageAt(modules, '@deepseek-ai/dsh-client-ui-slots', '0.2.1-rc.3')
    await packageAt(modules, 'zod', '4.4.3')
    const result = await hostDependencies({
      dependencies: { zod: '4.4.3' },
      peerDependencies: {
        '@deepseek-ai/cordis': '4.0.5',
        '@deepseek-ai/dsh-client-ui-slots': '0.2.1-rc.3',
        '@deepseek-ai/dsh-web-search-deepseek': '0.2.1-rc.3',
      },
      peerDependenciesMeta: {
        '@deepseek-ai/dsh-client-ui-slots': { optional: true },
        '@deepseek-ai/dsh-web-search-deepseek': { optional: true },
      },
    }, modules)

    assert.equal(result.hostPeers['@deepseek-ai/cordis'].available, true)
    assert.equal(result.hostPeers['@deepseek-ai/cordis'].version, '4.0.5')
    assert.equal(result.hostPeers['@deepseek-ai/dsh-client-ui-slots'].available, true)
    assert.match(result.dependencies['@deepseek-ai/dsh-client-ui-slots'], /^link:/u)
    assert.equal(result.hostPeers['@deepseek-ai/dsh-web-search-deepseek'].available, false)
    assert.equal(result.dependencies['@deepseek-ai/dsh-web-search-deepseek'], undefined)
    assert.match(result.dependencies.zod, /^link:/u)
    assert.equal(versionSatisfiesPeer('4.0.5', '^4.0.0'), true)
    assert.equal(versionSatisfiesPeer('5.0.0', '^4.0.0'), false)
    const packedArchive = await hostDependencies({
      dependencies: { zod: '4.4.3' },
      peerDependencies: { '@deepseek-ai/cordis': '4.0.5' },
    }, modules, undefined, { provideRuntimeDependencies: false })
    assert.equal(packedArchive.dependencies.zod, undefined,
      'the positive smoke must let the packed archive install its own production dependencies')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a required host peer that is absent is not treated as a plugin production dependency', async () => {
  const root = await mkdtemp(join(tmpdir(), 'copilot-install-smoke-'))
  try {
    await assert.rejects(hostDependencies({
      dependencies: {},
      peerDependencies: { '@deepseek-ai/cordis': '4.0.5' },
    }, join(root, 'node_modules')), /MISSING_HOST_PEER: @deepseek-ai\/cordis/u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('CI installs the verified archive through the isolated pinned-host smoke', async () => {
  const root = join(fileURLToPath(new URL('../..', import.meta.url)))
  const workflow = await readFile(join(root, '.github/workflows/ci.yml'), 'utf8')
  const smoke = await readFile(join(root, 'scripts/verify-install-smoke.mjs'), 'utf8')
  const archiveVerification = workflow.indexOf('pnpm verify:tarball --')
  const installSmoke = workflow.indexOf('pnpm exec node scripts/verify-install-smoke.mjs --archive')
  assert.ok(archiveVerification >= 0 && installSmoke > archiveVerification)
  assert.ok(workflow.includes('--host-modules node_modules'))
  assert.ok(workflow.includes('Install verified archive and load it through the pinned Core host'))
  assert.doesNotMatch(smoke, /--registry=|registry\.npmjs\.org/u,
    'the smoke must retain the registry configured for its execution environment')
})
