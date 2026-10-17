import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  assessChange, assessPlan, assertDshVersionIdentity, assertReleaseMetadata, compareVersions, isImportantFile,
  isPrereleaseVersion, parseChangedFiles, parseVersion, runCli, assertReleaseLines, selectCoreRelease,
  verifyCoreReleaseAvailability,
} from '../../scripts/release-policy.mjs'

const name = 'dsh-github-copilot'
const head = 'a'.repeat(40)
const previous = 'b'.repeat(40)
const version = '0.4.0-alpha.4'
const manifest = { name, version }
const installUrl = value => `https://github.com/cloga/${name}/releases/download/v${value}/${name}-${value}.tgz`
const metadata = value => ({
  readme: `dsh plugin --profile web add ${installUrl(value)}\n`,
  readmeZh: `dsh plugin --profile web add ${installUrl(value)}\n`,
  baseline: { baseline: { source: `https://github.com/cloga/${name}` }, package: { name, version: value } },
})
const change = (overrides = {}) => assessChange({
  baseManifest: { name, version: '0.4.0-alpha.3' }, manifest, files: ['src/index.ts'],
  ...metadata(version), ...overrides,
})
const tagInfo = (overrides = {}) => ({ type: 'tag', sha: previous, manifest, isAncestor: true, ...overrides })
const plan = (overrides = {}) => assessPlan({ manifest, head, ...overrides })
const coreVersion = '0.2.1-alpha.5'
const lineVersion = '0.1.0-alpha.1.dsh.0.2.1.alpha.5'
const lineBaseline = () => ({
  ...metadata(lineVersion).baseline,
  supportedBaselines: { dsh: {
    release: coreVersion,
    baselines: ['0.2.0-rc.2', '0.2.1-alpha.4', coreVersion].map(release => ({ release })),
  } },
  releaseLines: [
    { core: '0.2.0-rc.2', version: '0.4.2-alpha.15', status: 'published' },
    { core: '0.2.1-alpha.4', version: '0.4.2-alpha.16', status: 'published' },
    { core: coreVersion, version: lineVersion, status: 'pending' },
  ],
})

test('important paths cover runtime, packaged scripts, package metadata and build inputs', () => {
  for (const path of [
    'src/index.ts', 'src/nested/file.ts', 'lib/index.js', 'scripts/check-search-composition.mjs',
    'cordis.patch.yml', 'deployment-baseline.json', 'package.json',
    'scripts/release-policy.mjs', 'scripts/select-core-release.mjs',
    'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.json', 'tsconfig.tests.json',
    'tsdown.config.ts', 'vitest.config.ts', './src/new.ts',
  ]) assert.equal(isImportantFile(path), true, path)
  for (const path of [
    'README.md', 'README.zh.md', 'AGENTS.md', 'CONTRIBUTING.md', 'docs/runtime.md',
    'agent-contract.json', 'scripts/publish-npm.mjs',
    'tests/scripts/release-policy.test.mjs', '.github/ISSUE_TEMPLATE/bug.yml',
    '.github/workflows/ci.yml', '.github\\workflows\\release.yml',
    'package.json.md', 'src-notes.md', 'scripts.md',
  ]) assert.equal(isImportantFile(path), false, path)
  assert.throws(() => isImportantFile(null), /paths must be strings/)
})

test('SemVer comparison handles prerelease precedence, numeric identifiers and builds', () => {
  for (const [newer, older] of [
    ['0.4.0-alpha.3', '0.4.0-alpha.2'], ['0.4.0-alpha.10', '0.4.0-alpha.9'],
    ['0.4.0-beta.1', '0.4.0-alpha.99'], ['0.4.0-rc.1', '0.4.0-beta.9'],
    ['0.4.0', '0.4.0-rc.99'], ['0.4.1-alpha.1', '0.4.0'],
    ['1.0.0-alpha', '1.0.0-1'], ['9007199254740993.0.0', '9007199254740992.0.0'],
  ]) {
    assert.equal(compareVersions(newer, older), 1)
    assert.equal(compareVersions(older, newer), -1)
  }
  assert.equal(compareVersions('0.4.0-alpha.3+one', '0.4.0-alpha.3+two'), 0)
  assert.deepEqual(parseVersion(version).prerelease, ['alpha', '4'])
  assert.equal(isPrereleaseVersion(version), true)
  assert.equal(isPrereleaseVersion('0.4.0'), false)
})

test('malformed and non-canonical SemVer fails closed while valid prereleases and builds pass', () => {
  for (const bad of [undefined, null, 123, '', '1', '1.0', 'v1.0.0', '01.0.0', '1.01.0', '1.0.00', '1.0.0-alpha.01', '1.0.0-', '1.0.0+', '1.0.0\n']) {
    assert.throws(() => parseVersion(bad), /canonical SemVer/)
  }
  for (const good of ['0.0.0', '1.2.3-alpha', '1.2.3-alpha.3', '1.2.3-0.3.7', '1.2.3+build.5', '1.2.3-rc.1+build.5']) {
    assert.doesNotThrow(() => parseVersion(good), good)
  }
})

test('important changes require a strictly newer SemVer; docs and tests may retain it', () => {
  assert.deepEqual(change(), { important: true, bumped: true, version })
  assert.throws(() => change({ manifest: { name, version: '0.4.0-alpha.3' } }), /strictly newer SemVer/)
  assert.deepEqual(change({
    manifest: { name, version: '0.4.0-alpha.3' }, files: ['README.md', 'tests/new.spec.ts'],
    readme: undefined, readmeZh: undefined, baseline: undefined,
  }), { important: false, bumped: false, version: '0.4.0-alpha.3' })
  assert.throws(() => change({ manifest: { name, version: '0.4.0-alpha.2' }, files: ['README.md'] }), /downgrade/)
})

test('every version bump verifies both READMEs and deployment baseline metadata', () => {
  assert.doesNotThrow(() => assertReleaseMetadata({ version, ...metadata(version) }))
  for (const [override, pattern] of [
    [{ readme: '' }, /README.md/], [{ readmeZh: '' }, /README.zh.md/],
    [{ readme: installUrl('0.4.0-alpha.40') }, /exact release install URL/],
    [{ baseline: { baseline: { source: `https://github.com/cloga/${name}` }, package: { name, version: '0.4.0-alpha.3' } } }, /deployment-baseline/],
    [{ baseline: { baseline: { source: 'https://github.com/cloga/other' }, package: { name, version } } }, /baseline.source/],
  ]) assert.throws(() => assertReleaseMetadata({ version, ...metadata(version), ...override }), pattern)
  assert.throws(() => change({ files: ['README.md'], manifest: { name, version: '0.4.0-alpha.5' } }), /README.md/)
})

test('prerelease DSH suffix exactly matches engines.dsh and the deployment baseline', () => {
  const dshVersion = '0.2.1-alpha.5'
  const qualified = lineVersion
  const qualifiedMetadata = metadata(qualified)
  qualifiedMetadata.baseline = lineBaseline()
  assert.doesNotThrow(() => assertReleaseMetadata({
    version: qualified, dshVersion, ...qualifiedMetadata,
  }))
  assert.doesNotThrow(() => assertDshVersionIdentity(qualified, dshVersion, dshVersion))
  assert.throws(() => assertDshVersionIdentity(
    '0.1.0-alpha.1.dsh.0.2.1.alpha.4', dshVersion, dshVersion,
  ), /does not match/)
  assert.throws(() => assertDshVersionIdentity(
    '0.1.1-alpha.2.dsh.0.2.1.alpha.5', dshVersion, dshVersion,
  ), /0\.1\.0-alpha/)
  assert.throws(() => assertDshVersionIdentity(
    '0.1.0-beta.2.dsh.0.2.1.alpha.5', dshVersion, dshVersion,
  ), /0\.1\.0-alpha/)
  assert.throws(() => assertDshVersionIdentity(qualified, '0.2.1-alpha.4', dshVersion), /does not match/)
  const unqualifiedMetadata = metadata('0.1.0-alpha.1')
  unqualifiedMetadata.baseline.supportedBaselines = { dsh: { release: dshVersion } }
  assert.throws(() => assertReleaseMetadata({
    version: '0.1.0-alpha.1', dshVersion, ...unqualifiedMetadata,
  }), /must include its exact DSH Core version/)
  const baseManifest = { name, version: '0.4.2-alpha.16', engines: { dsh: '0.2.1-alpha.4' } }
  const manifest = { ...baseManifest, version: qualified, engines: { dsh: dshVersion } }
  assert.deepEqual(assessChange({
    baseManifest, manifest, files: ['package.json'],
    readme: qualifiedMetadata.readme, readmeZh: qualifiedMetadata.readmeZh,
    baseline: qualifiedMetadata.baseline,
  }), { important: true, bumped: true, version: qualified })
  assert.equal(compareVersions(qualified, baseManifest.version), -1)
})

test('exact-Core lines reset numbering only across verified metadata and retain historical anchors', () => {
  const options = {
    baseManifest: { name, version: '0.4.2-alpha.16', engines: { dsh: '0.2.1-alpha.4' } },
    manifest: { name, version: lineVersion, engines: { dsh: coreVersion } },
    files: ['package.json'], ...metadata(lineVersion), baseline: lineBaseline(),
  }
  assert.equal(assessChange(options).bumped, true)
  assert.throws(() => assessChange({
    ...options, manifest: { ...options.manifest, peerDependencies: { '@deepseek-ai/dsh-agent': '0.2.1-alpha.4' } },
  }), /Core peer/)
  assert.throws(() => assessChange({
    ...options, baseManifest: { ...options.baseManifest, engines: { dsh: coreVersion } },
  }), /downgrade/)
  assert.throws(() => assessChange({
    ...options, manifest: { ...options.manifest, version: lineVersion.replace('alpha.1.', 'alpha.2.') },
  }), /must start at/)
  const missingAnchor = lineBaseline()
  missingAnchor.releaseLines = missingAnchor.releaseLines.filter(row => row.core !== '0.2.1-alpha.4')
  assert.throws(() => assessChange({ ...options, baseline: missingAnchor }), /preserve the previous/)
  const next = lineVersion.replace('alpha.1.', 'alpha.2.')
  const nextBaseline = lineBaseline()
  nextBaseline.package.version = next
  nextBaseline.releaseLines[2].version = next
  assert.equal(assessChange({
    baseManifest: options.manifest, manifest: { ...options.manifest, version: next },
    files: ['src/index.ts'], ...metadata(next), baseline: nextBaseline,
  }).bumped, true)
  const build = lineVersion.replace('.dsh.', '+dsh.')
  assert.throws(() => assertDshVersionIdentity(build, coreVersion, coreVersion), /build metadata/)
  assert.throws(() => assertDshVersionIdentity(lineVersion, `^${coreVersion}`, `^${coreVersion}`), /SemVer/)
})

test('read-only exact-Core selection distinguishes published anchors, pending and unknown targets', () => {
  const baseline = lineBaseline()
  const selected = selectCoreRelease(baseline, '0.2.0-rc.2')
  assert.equal(selected.npmSpec, `${name}@0.4.2-alpha.15`)
  assert.equal(selected.archiveUrl, installUrl('0.4.2-alpha.15'))
  assert.equal(selectCoreRelease(baseline, '0.2.1-alpha.4').version, '0.4.2-alpha.16')
  assert.deepEqual(selectCoreRelease(baseline, coreVersion), {
    core: coreVersion, version: lineVersion, status: 'pending',
  })
  assert.throws(() => selectCoreRelease(baseline, '0.2.1-alpha.6'), /No release mapping/)
  assert.throws(() => selectCoreRelease(baseline, 'latest'), /SemVer/)
  assert.throws(() => assertReleaseLines({ ...baseline, releaseLines: [...baseline.releaseLines, baseline.releaseLines[0]] }), /Duplicate/)
  assert.throws(() => assertReleaseLines({
    ...baseline, releaseLines: baseline.releaseLines.map(row => ({ ...row, core: '1.0.0' })),
  }), /no exact Core baseline/)
  assert.throws(() => assertReleaseLines({
    ...baseline, package: { ...baseline.package, version: '0.1.0-alpha.9' },
  }), /differs from package/)
})

test('current repository metadata and selector mapping use exact Core, not global order', async () => {
  const read = async path => JSON.parse(await readFile(new URL(`../../${path}`, import.meta.url), 'utf8'))
  const manifest = await read('package.json')
  const baseline = await read('deployment-baseline.json')
  assert.ok(manifest.files.includes('scripts/select-core-release.mjs'))
  assert.ok(manifest.files.includes('scripts/release-policy.mjs'))
  const readme = await readFile(new URL('../../README.md', import.meta.url), 'utf8')
  const readmeZh = await readFile(new URL('../../README.zh.md', import.meta.url), 'utf8')
  assertReleaseMetadata({
    version: manifest.version, dshVersion: manifest.engines.dsh, peers: manifest.peerDependencies,
    baseline, readme, readmeZh,
  })
  for (const core of ['0.2.0-rc.2', '0.2.1-alpha.4', manifest.engines.dsh]) {
    assert.equal(selectCoreRelease(baseline, core).core, core)
  }
})

test('release selector requires exact public GitHub and npm evidence before recommending install', async () => {
  const baseline = lineBaseline()
  const requests = []
  const response = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body })
  const fetchImpl = (...args) => {
    requests.push(args)
    return requests.length === 1
      ? response(200, {
        tag_name: `v${lineVersion}`, draft: false, prerelease: true,
        assets: [{ name: `${name}-${lineVersion}.tgz` }, { name: 'SHA256SUMS' }],
      })
      : response(200, { name, version: lineVersion, engines: { dsh: coreVersion } })
  }
  assert.deepEqual(await verifyCoreReleaseAvailability(baseline, coreVersion, { fetchImpl }), {
    core: coreVersion, version: lineVersion, status: 'published',
    npmSpec: `${name}@${lineVersion}`,
    releaseUrl: `https://github.com/cloga/${name}/releases/tag/v${lineVersion}`,
    archiveUrl: installUrl(lineVersion),
  })
  assert.match(requests[0][0], /api\.github\.com\/repos\/cloga\/dsh-github-copilot\/releases\/tags\/v0\.1\.0/)
  assert.match(requests[1][0], /registry\.npmjs\.org\/dsh-github-copilot\/0\.1\.0/)
  requests.length = 0
  const pending = await verifyCoreReleaseAvailability(baseline, coreVersion, {
    fetchImpl: async () => response(404, {}),
  })
  assert.deepEqual(pending, { core: coreVersion, version: lineVersion, status: 'pending' })
  let call = 0
  const incomplete = await verifyCoreReleaseAvailability(baseline, coreVersion, {
    fetchImpl: async () => ++call === 1
      ? response(200, {
        tag_name: `v${lineVersion}`, draft: false, prerelease: true,
        assets: [{ name: `${name}-${lineVersion}.tgz` }, { name: 'SHA256SUMS' }],
      })
      : response(404, {}),
  })
  assert.deepEqual(incomplete, { core: coreVersion, version: lineVersion, status: 'incomplete' })
  await assert.rejects(verifyCoreReleaseAvailability(baseline, coreVersion, {
    fetchImpl: async () => response(503, {}),
  }), /GitHub Release lookup failed/)
  await assert.rejects(verifyCoreReleaseAvailability(baseline, coreVersion, {
    fetchImpl: async () => response(200, {
      tag_name: `v${lineVersion}`, draft: true, prerelease: true,
      assets: [{ name: `${name}-${lineVersion}.tgz` }, { name: 'SHA256SUMS' }],
    }),
  }), /does not match/)
  for (const release of [
    {
      tag_name: `v${lineVersion}-wrong`, draft: false, prerelease: true,
      assets: [{ name: `${name}-${lineVersion}.tgz` }, { name: 'SHA256SUMS' }],
    },
    {
      tag_name: `v${lineVersion}`, draft: false, prerelease: true,
      assets: [{ name: `${name}-${lineVersion}.tgz` }],
    },
  ]) {
    await assert.rejects(verifyCoreReleaseAvailability(baseline, coreVersion, {
      fetchImpl: async () => response(200, release),
    }), /does not match/)
  }
  call = 0
  await assert.rejects(verifyCoreReleaseAvailability(baseline, coreVersion, {
    fetchImpl: async () => ++call === 1
      ? response(200, {
        tag_name: `v${lineVersion}`, draft: false, prerelease: true,
        assets: [{ name: `${name}-${lineVersion}.tgz` }, { name: 'SHA256SUMS' }],
      })
      : response(200, { name, version: lineVersion, engines: { dsh: '0.2.1-alpha.4' } }),
  }), /does not verify exact DSH Core/)
  baseline.releaseLines[2].status = 'published'
  await assert.rejects(verifyCoreReleaseAvailability(baseline, coreVersion, {
    fetchImpl: async () => response(404, {}),
  }), /Mapped GitHub Release/)
})

test('plan releases a missing tag or exact annotated tag at HEAD with prerelease state', () => {
  const expected = { release: true, tag: `v${version}`, sha: head, prerelease: true }
  assert.deepEqual(plan(), expected)
  assert.deepEqual(plan({ tagInfo: tagInfo({ sha: head }) }), expected)
})

test('0.4.0 promotion keeps stable metadata, exact README URLs and stable release state', () => {
  const stable = '0.4.0'
  const stableMetadata = metadata(stable)
  assert.doesNotThrow(() => assertReleaseMetadata({ version: stable, ...stableMetadata }))
  assert.deepEqual(assessPlan({ manifest: { name, version: stable }, head }), {
    release: true, tag: `v${stable}`, sha: head, prerelease: false,
  })
})

test('plan reconciles the exact tagged commit after docs-only commits', () => {
  const expected = { release: true, tag: `v${version}`, sha: previous, prerelease: true }
  assert.deepEqual(plan({ tagInfo: tagInfo(), files: ['README.md', 'tests/a.spec.ts'] }), expected)
  assert.deepEqual(plan({ tagInfo: tagInfo(), files: [] }), expected)
})

test('release infrastructure changes reconcile the existing tagged bytes without a version bump', () => {
  const files = [
    'agent-contract.json',
    'docs/npm-distribution.md',
    'scripts/publish-npm.mjs',
    'tests/scripts/release-policy.test.mjs',
    '.github/workflows/release.yml',
  ]
  assert.deepEqual(assessChange({
    baseManifest: manifest,
    manifest,
    files,
  }), { important: false, bumped: false, version })
  assert.deepEqual(plan({ tagInfo: tagInfo(), files }), {
    release: true,
    tag: `v${version}`,
    sha: previous,
    prerelease: true,
  })
})

test('plan fails on unreleased important changes and divergent or invalid tags', () => {
  for (const path of [
    'src/index.ts',
    'package.json',
    'deployment-baseline.json',
    'scripts/check-search-composition.mjs',
    'tsdown.config.ts',
  ]) {
    assert.throws(() => plan({ tagInfo: tagInfo(), files: [path] }), /merged important changes lack a new version/)
  }
  assert.throws(() => plan({ tagInfo: tagInfo({ isAncestor: false }), files: ['README.md'] }), /not an ancestor/)
  assert.throws(() => plan({ tagInfo: tagInfo({ type: 'commit' }) }), /annotated tag/)
  assert.throws(() => plan({ tagInfo: tagInfo({ manifest: { name, version: '0.4.0-alpha.3' } }) }), /does not match/)
  assert.throws(() => plan({ head: 'main' }), /full Git commit SHA/)
})

test('tag recovery requires the exact current annotated tag at HEAD', () => {
  assert.equal(plan({ githubRef: `refs/tags/v${version}`, tagInfo: tagInfo({ sha: head }) }).release, true)
  assert.throws(() => plan({ githubRef: 'refs/tags/v0.4.0-alpha.2', tagInfo: tagInfo({ sha: head }) }), /Tag recovery requires/)
  assert.throws(() => plan({ githubRef: `refs/tags/v${version}` }), /existing annotated tag/)
  assert.throws(() => plan({ githubRef: `refs/tags/v${version}`, tagInfo: tagInfo(), files: ['README.md'] }), /point to HEAD/)
})

test('NUL-separated changed paths preserve whitespace and reject line-oriented output', () => {
  assert.deepEqual(parseChangedFiles('src/a b.ts\0docs/a\nb.md\0'), ['src/a b.ts', 'docs/a\nb.md'])
  assert.deepEqual(parseChangedFiles(''), [])
  assert.throws(() => parseChangedFiles('src/index.ts\n'), /NUL-terminated/)
})

function cliFixture({ steps = [], committed = {}, env = {} } = {}) {
  const pending = [...steps]
  const logs = []
  const outputs = []
  const defaults = {
    'package.json': JSON.stringify(manifest), 'README.md': metadata(version).readme,
    'README.zh.md': metadata(version).readmeZh, 'deployment-baseline.json': JSON.stringify(metadata(version).baseline),
    ...committed,
  }
  return {
    run: args => runCli(args, {
      cwd: '.', env,
      git: argv => {
        if (argv.length === 2 && argv[0] === 'show' && argv[1].startsWith('HEAD:')) {
          const file = argv[1].slice(5)
          assert.ok(file in defaults, `Unexpected committed read ${file}`)
          return { status: 0, stdout: defaults[file] }
        }
        const next = pending.shift()
        assert.ok(next, `Unexpected git call ${JSON.stringify(argv)}`)
        assert.deepEqual(argv, next[0])
        return typeof next[1] === 'object' ? next[1] : { status: 0, stdout: next[1] }
      },
      appendOutput: (path, text) => outputs.push({ path, text }), log: text => logs.push(JSON.parse(text)),
    }),
    done: () => assert.equal(pending.length, 0), logs, outputs,
  }
}
const baseSteps = (base, files = 'src/index.ts\0') => [
  [['show', `${base}:package.json`], JSON.stringify({ name, version: '0.4.0-alpha.3' })],
  [['diff', '--name-only', '-z', '--no-renames', base, 'HEAD', '--'], files],
]
const planSteps = ({ exists = false, sha = previous, files = 'README.md\0', ancestor = true } = {}) => {
  const ref = `refs/tags/v${version}`
  const steps = [
    [['rev-parse', '--verify', 'HEAD^{commit}'], `${head}\n`],
    [['show-ref', '--verify', '--quiet', ref], exists ? '' : { status: 1, stdout: '' }],
  ]
  if (exists) {
    steps.push([['cat-file', '-t', ref], 'tag\n'], [['rev-parse', '--verify', `${ref}^{commit}`], `${sha}\n`], [['show', `${ref}:package.json`], JSON.stringify(manifest)])
    if (sha !== head) steps.push(
      [['merge-base', '--is-ancestor', sha, head], ancestor ? '' : { status: 1, stdout: '' }],
      [['diff', '--name-only', '-z', '--no-renames', sha, 'HEAD', '--'], files],
    )
  }
  return steps
}

test('CLI base assesses committed metadata and changed paths with argv-only git calls', () => {
  const fixture = cliFixture({ steps: baseSteps('origin/main') })
  assert.deepEqual(fixture.run(['--base', 'origin/main']), { important: true, bumped: true, version })
  fixture.done()
  assert.deepEqual(fixture.logs, [{ important: true, bumped: true, version }])
})

test('CLI plan writes release, tag, exact SHA and prerelease outputs', () => {
  for (const options of [{}, { exists: true, sha: head }, { exists: true }]) {
    const fixture = cliFixture({ steps: planSteps(options), env: { GITHUB_OUTPUT: 'out' } })
    const decision = fixture.run(['--plan'])
    fixture.done()
    assert.deepEqual(fixture.outputs, [{ path: 'out', text: `release=${decision.release}\ntag=v${version}\nsha=${decision.sha}\nprerelease=true\n` }])
  }
})

test('CLI plan reconciles docs-only post-tag commits and rejects important post-tag commits', () => {
  const docs = cliFixture({ steps: planSteps({ exists: true }) })
  assert.deepEqual(docs.run(['--plan']), { release: true, tag: `v${version}`, sha: previous, prerelease: true })
  docs.done()
  const important = cliFixture({ steps: planSteps({ exists: true, files: 'src/index.ts\0' }) })
  assert.throws(() => important.run(['--plan']), /lack a new version/)
  important.done()
})

test('CLI rejects malformed arguments, refs, JSON and git failures', () => {
  for (const args of [[], ['--base'], ['--plan', 'extra'], ['--unknown']]) assert.throws(() => cliFixture().run(args), /Usage/)
  for (const base of ['', '--output=x', 'HEAD\nother']) assert.throws(() => cliFixture().run(['--base', base]), /non-option Git ref/)
  assert.throws(() => cliFixture({ committed: { 'package.json': '{' } }).run(['--plan']), /Cannot parse package.json/)
  const broken = cliFixture({ steps: [[['rev-parse', '--verify', 'HEAD^{commit}'], { status: 128, stderr: 'broken repository' }]] })
  assert.throws(() => broken.run(['--plan']), /broken repository/)
  broken.done()
})
